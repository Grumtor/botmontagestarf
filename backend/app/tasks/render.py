"""Batch render entry point — clip-based, runs in a background thread.

A job's `assignments` is a list of:
    { template_id: int, fills: { clip_id: token }, _gen?: int }

For each entry, we resolve all file references via gather_render_inputs(),
run ffmpeg (full quality), apply optional QuickTime spoofing, and ZIP
everything at the end. Temp upload tokens are deleted after processing.

Phase 29 — `metadata_profile["naming"]` controls how files are named
in the final ZIP : "iphone" → IMG_xxxx.mp4 (Apple-style naming), "default" →
{slug(template)}_{i}.mp4. The naming applies only to the ZIP arcnames,
the on-disk render outputs keep their internal scheme.

Called by `app.worker.queue_render_job` from the API after a job row is
created. Pure function — no Celery, no Redis, no magic.
"""

from __future__ import annotations

import logging
import random
import re
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from app.db import SessionLocal
from app.db.models import JobStatus, RenderJob, Template, User
from app.render.batch_runner import gather_render_inputs, run_render
from app.render.metadata import apply_quicktime_metadata
from app.storage import RENDERS_DIR, TEMP_DIR

log = logging.getLogger(__name__)

FFMPEG_TIMEOUT_SEC = 60 * 30


def _slug(name: str, fallback: str = "x") -> str:
    s = re.sub(r"[^a-zA-Z0-9_-]+", "_", name).strip("_")
    return (s or fallback)[:50]


def process_render_job(job_id: int) -> None:
    db = SessionLocal()
    consumed_tokens: set[str] = set()
    try:
        job = db.get(RenderJob, job_id)
        if job is None:
            log.error("RenderJob %s not found", job_id)
            return

        job.status = JobStatus.running
        job.progress = 0
        job.error = None
        job.output_files = []
        db.commit()

        assignments = list(job.assignments or [])
        total = len(assignments)
        if total == 0:
            job.status = JobStatus.done
            job.progress = 100
            job.finished_at = datetime.now(timezone.utc)
            db.commit()
            return

        metadata_profile = dict(job.metadata_profile or {})
        spoof_enabled = bool(metadata_profile.get("enabled"))

        out_dir = RENDERS_DIR / str(job.id)
        out_dir.mkdir(parents=True, exist_ok=True)
        output_files: list[str] = []
        # Phase 29 — track (file_path, gen_idx, order_idx) so we can group
        # outputs into `Generation N/` subdirs in the final ZIP when
        # generations > 1.
        # Phase 36 — `order_idx` = position de l'assignment dans la liste
        # envoyée par le frontend. On l'utilise comme clé de tri secondaire
        # pour préserver l'ordre voulu (v1×t1, v1×t2, v2×t1…) au lieu de
        # trier par nom de fichier (qui re-groupait par template name).
        output_entries: list[tuple[str, int, int]] = []
        max_gen = 1
        # Phase 36 — per-assignment failure tracking. When one render
        # blows up (e.g. ffmpeg refused a corrupted/too-small input),
        # we DON'T fail the whole batch anymore — we record the error
        # and keep going. At the end, partial success gets a status=done
        # with the failed_assignments list populated, AND we refund the
        # corresponding credits to the user.
        failed_assignments: list[dict] = []

        for i, assign in enumerate(assignments):
            template_id = assign.get("template_id")
            fills = dict(assign.get("fills") or {})
            gen_idx = int(assign.get("_gen") or 1)
            if gen_idx > max_gen:
                max_gen = gen_idx

            template = db.get(Template, template_id)
            if template is None:
                log.warning("Template %s not found, skipping", template_id)
                failed_assignments.append({
                    "index": i,
                    "template_id": template_id,
                    "template_name": None,
                    "error": f"Template {template_id} introuvable",
                })
                # Always consume the tokens of a skipped assignment so
                # they get cleaned up at the end (the user already
                # uploaded the video — we just couldn't use it here).
                consumed_tokens.update(fills.values())
                job.progress = int((i + 1) / total * 100)
                db.commit()
                continue

            # Filename inclut le gen index pour pas collisionner sur disk
            # quand le même (template, fills) est rendu plusieurs fois.
            gen_suffix = f"_g{gen_idx}" if gen_idx > 1 else ""
            file_name = f"{_slug(template.name, 'tpl')}_{i}{gen_suffix}.mp4"
            output_path = out_dir / file_name

            try:
                ctx = gather_render_inputs(db, template, fills)
                run_render(
                    template=template,
                    ctx=ctx,
                    output_path=output_path,
                    crf=18,
                    preset="slow",
                    timeout=FFMPEG_TIMEOUT_SEC,
                )
            except Exception as e:
                # Phase 36 — isolate the failure : log it, record it on
                # the job for the UI, but DON'T raise. The next render
                # in the loop still runs. Refund credit handled below.
                log.exception(
                    "Render failed for assignment %d (template=%s): %s",
                    i, template.name if template else template_id, e,
                )
                err_msg = str(e)
                # Trim very long ffmpeg stderr dumps so the JSON stays
                # readable in the UI ; full trace is in the server log.
                if len(err_msg) > 600:
                    err_msg = err_msg[:600] + "… (tronqué)"
                failed_assignments.append({
                    "index": i,
                    "template_id": template_id,
                    "template_name": template.name,
                    "error": err_msg,
                })
                # Still consume the tokens (they're "used up" from the
                # user's POV — the upload happened).
                consumed_tokens.update(fills.values())
                # If a half-written output exists, drop it so we don't
                # ZIP a corrupt file later.
                try:
                    output_path.unlink(missing_ok=True)
                except Exception:
                    pass
                job.progress = int((i + 1) / total * 100)
                job.failed_assignments = list(failed_assignments)
                db.commit()
                continue

            consumed_tokens.update(fills.values())

            if spoof_enabled:
                try:
                    apply_quicktime_metadata(output_path, metadata_profile)
                except Exception as e:
                    log.exception("metadata spoof failed for %s: %s", output_path, e)

            output_files.append(str(output_path))
            output_entries.append((str(output_path), gen_idx, i))
            job.output_files = list(output_files)
            job.progress = int((i + 1) / total * 100)
            db.commit()

        # Phase 36 — refund credits for failed assignments. The user
        # was charged 1 credit per assignment at create_batch time ;
        # we give back 1 per failure so they're only billed for actual
        # successful renders.
        n_failed = len(failed_assignments)
        if n_failed > 0 and job.owner_id:
            try:
                u = db.get(User, job.owner_id)
                if u is not None:
                    u.render_credits = (u.render_credits or 0) + n_failed
                    db.commit()
                    log.info(
                        "Refunded %d credits to user %s for failed assignments in job %s",
                        n_failed, u.username, job.id,
                    )
            except Exception:
                log.exception("Failed to refund credits for job %s", job.id)
                db.rollback()

        # If EVERY assignment failed, there's nothing to ZIP — mark
        # the job as failed instead of done with an empty ZIP.
        if not output_entries:
            job.status = JobStatus.failed
            job.error = (
                f"Tous les rendus ont échoué ({n_failed}/{total}). "
                "Crédits remboursés."
            )
            job.progress = 100
            job.finished_at = datetime.now(timezone.utc)
            job.failed_assignments = list(failed_assignments)
            db.commit()
            return

        # ZIP all outputs. Phase 29 — Apple-style naming optionnel +
        # group by pass when max_gen > 1 (each pass in its own subdir).
        # Le label du sous-dossier vient de `metadata_profile.pass_label`
        # — "Generation" par défaut (generations multiplier), "Tirage"
        # pour le random reroll (Phase 29c).
        naming = str(metadata_profile.get("naming") or "default").lower()
        pass_label = str(metadata_profile.get("pass_label") or "Generation")
        multi_gen = max_gen > 1
        zip_path = RENDERS_DIR / f"{job.id}.zip"
        # Sort primary by gen_idx (groups passes when generations > 1),
        # secondary by the original assignment index — preserves the
        # frontend's intended ordering (Phase 36 : v1×t1, v1×t2, v2×t1…
        # instead of grouping by template name).
        sorted_entries = sorted(output_entries, key=lambda e: (e[1], e[2]))

        # Pre-compute the apple-style filename per output path so the
        # individual download endpoint (/api/files/render_item/...) can
        # return the same names as the ZIP. Without this, the ZIP shows
        # IMG_*.mp4 but per-file downloads show template_*.mp4 — looks
        # like the option is broken to the user.
        #
        # Extension : `.mp4` (et pas `.MOV`) parce que les apps de
        # messagerie (WhatsApp/Telegram) re-encodent les vidéos et leur
        # parser QuickTime sur du `.MOV` non-réellement-QT laissait
        # tomber l'audio. .mp4 garde tout le monde dans le code path
        # MP4 standard. Le préfixe IMG_ + le compteur 4 chiffres
        # gardent l'apparence "capture iPhone" suffisamment.
        apple_name_by_path: dict[str, str] = {}
        if naming == "iphone":
            counter = random.randint(1500, 9000)
            for f, _gen_idx, _order_idx in sorted_entries:
                apple_name_by_path[f] = f"IMG_{counter:04d}.mp4"
                counter += 1

        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_STORED) as zf:
            for f, gen_idx, _order_idx in sorted_entries:
                base_arc = (
                    apple_name_by_path[f] if naming == "iphone" else Path(f).name
                )
                arcname = (
                    f"{pass_label} {gen_idx}/{base_arc}"
                    if multi_gen
                    else base_arc
                )
                zf.write(f, arcname=arcname)

        # Persist the apple-name mapping into the job's metadata_profile
        # so the file-serve endpoint can read it back. Stored as a dict
        # keyed by absolute path to avoid index drift.
        if apple_name_by_path:
            mp = dict(job.metadata_profile or {})
            mp["apple_name_by_path"] = apple_name_by_path
            job.metadata_profile = mp

        job.output_zip_path = str(zip_path)
        job.status = JobStatus.done
        job.progress = 100
        job.finished_at = datetime.now(timezone.utc)
        # Phase 36 — persist the per-item failure list so the UI can
        # show "5/6 ok, 1 failed (reason)" instead of just success.
        job.failed_assignments = list(failed_assignments)
        if n_failed > 0:
            job.error = (
                f"Batch terminé avec {n_failed}/{total} échecs. "
                f"Crédits remboursés : {n_failed}."
            )
        db.commit()

    except Exception as e:
        log.exception("Render job %s failed: %s", job_id, e)
        try:
            job = db.get(RenderJob, job_id)
            if job is not None:
                job.status = JobStatus.failed
                job.error = str(e)[:1000]
                job.finished_at = datetime.now(timezone.utc)
                db.commit()
        except Exception:
            db.rollback()
    finally:
        # Cleanup temp upload files used by this job
        for token in consumed_tokens:
            for p in TEMP_DIR.glob(f"{token}.*"):
                try:
                    p.unlink(missing_ok=True)
                except Exception:
                    pass
        db.close()
