"""Batch render entry point — clip-based, runs in a background thread.

A job's `assignments` is a list of:
    { template_id: int, fills: { clip_id: token }, _gen?: int }

For each entry, we resolve all file references via gather_render_inputs(),
run ffmpeg (full quality), apply optional QuickTime spoofing, and ZIP
everything at the end. Temp upload tokens are deleted after processing.

Phase 29 — `metadata_profile["naming"]` controls how files are named
in the final ZIP : "iphone" → IMG_xxxx.MOV (Apple-style), "default" →
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
from app.db.models import JobStatus, RenderJob, Template
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
        # Phase 29 — track (file_path, gen_idx) so we can group outputs
        # into `Generation N/` subdirs in the final ZIP when generations > 1.
        output_entries: list[tuple[str, int]] = []
        max_gen = 1

        for i, assign in enumerate(assignments):
            template_id = assign.get("template_id")
            fills = dict(assign.get("fills") or {})
            gen_idx = int(assign.get("_gen") or 1)
            if gen_idx > max_gen:
                max_gen = gen_idx

            template = db.get(Template, template_id)
            if template is None:
                log.warning("Template %s not found, skipping", template_id)
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
                log.exception("Render failed for assignment %d: %s", i, e)
                raise RuntimeError(f"assignment {i} failed: {e}") from e

            consumed_tokens.update(fills.values())

            if spoof_enabled:
                try:
                    apply_quicktime_metadata(output_path, metadata_profile)
                except Exception as e:
                    log.exception("metadata spoof failed for %s: %s", output_path, e)

            output_files.append(str(output_path))
            output_entries.append((str(output_path), gen_idx))
            job.output_files = list(output_files)
            job.progress = int((i + 1) / total * 100)
            db.commit()

        # ZIP all outputs. Phase 29 — Apple-style naming optionnel +
        # group by pass when max_gen > 1 (each pass in its own subdir).
        # Le label du sous-dossier vient de `metadata_profile.pass_label`
        # — "Generation" par défaut (generations multiplier), "Tirage"
        # pour le random reroll (Phase 29c).
        naming = str(metadata_profile.get("naming") or "default").lower()
        pass_label = str(metadata_profile.get("pass_label") or "Generation")
        multi_gen = max_gen > 1
        zip_path = RENDERS_DIR / f"{job.id}.zip"
        # Sort by gen_idx so output is grouped consistently in the ZIP.
        sorted_entries = sorted(output_entries, key=lambda e: (e[1], e[0]))
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_STORED) as zf:
            if naming == "iphone":
                counter = random.randint(1500, 9000)
                for f, gen_idx in sorted_entries:
                    base_arc = f"IMG_{counter:04d}.MOV"
                    counter += 1
                    arcname = (
                        f"{pass_label} {gen_idx}/{base_arc}"
                        if multi_gen
                        else base_arc
                    )
                    zf.write(f, arcname=arcname)
            else:
                for f, gen_idx in sorted_entries:
                    base_arc = Path(f).name
                    arcname = (
                        f"{pass_label} {gen_idx}/{base_arc}"
                        if multi_gen
                        else base_arc
                    )
                    zf.write(f, arcname=arcname)

        job.output_zip_path = str(zip_path)
        job.status = JobStatus.done
        job.progress = 100
        job.finished_at = datetime.now(timezone.utc)
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
