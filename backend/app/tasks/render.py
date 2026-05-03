"""Celery batch render task — clip-based.

A job's `assignments` is now a list of:
    { template_id: int, fills: { clip_id: token } }

For each entry, we resolve all file references via gather_render_inputs(),
run ffmpeg (full quality), apply optional QuickTime spoofing, and ZIP
everything at the end. Temp upload tokens are deleted after processing.
"""

from __future__ import annotations

import logging
import re
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from app.celery_app import celery_app
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


@celery_app.task(name="process_render_job")
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

        for i, assign in enumerate(assignments):
            template_id = assign.get("template_id")
            fills = dict(assign.get("fills") or {})

            template = db.get(Template, template_id)
            if template is None:
                log.warning("Template %s not found, skipping", template_id)
                continue

            file_name = f"{_slug(template.name, 'tpl')}_{i}.mp4"
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
            job.output_files = list(output_files)
            job.progress = int((i + 1) / total * 100)
            db.commit()

        # ZIP all outputs
        zip_path = RENDERS_DIR / f"{job.id}.zip"
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_STORED) as zf:
            for f in output_files:
                zf.write(f, arcname=Path(f).name)

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
