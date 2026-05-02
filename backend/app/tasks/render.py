"""Celery batch render task.

Reads a RenderJob's assignments [(source_id, template_id), ...], runs the full
pipeline for each pair (using build_batch_render_command), optionally applies
QuickTime spoofing, then ZIPs the outputs.
"""

from __future__ import annotations

import logging
import re
import subprocess
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.celery_app import celery_app
from app.db import SessionLocal
from app.db.models import (
    Asset,
    AssetType,
    JobStatus,
    RenderJob,
    Template,
    TextPool,
    VideoSource,
)
from app.render.metadata import apply_quicktime_metadata
from app.render.pipeline import build_batch_render_command
from app.storage import RENDERS_DIR, builtin_font_path

log = logging.getLogger(__name__)

FFMPEG_TIMEOUT = 60 * 30  # 30 min per render


def _slug(name: str, fallback: str = "x") -> str:
    s = re.sub(r"[^a-zA-Z0-9_-]+", "_", name).strip("_")
    return (s or fallback)[:50]


def _template_to_dict(t: Template) -> dict:
    return {
        "id": t.id,
        "name": t.name,
        "duration_sec": t.duration_sec,
        "layers": list(t.layers or []),
        "source_segments": list(t.source_segments or []),
        "audio_source": dict(t.audio_source or {}),
        "audio_overlay": dict(t.audio_overlay or {}),
    }


def _gather_render_context(db, template: Template) -> dict[str, Any]:
    layers = template.layers or []

    asset_paths: dict[int, Path] = {}
    for layer in layers:
        if layer.get("type") not in ("image", "gif", "emoji"):
            continue
        asset_id = (layer.get("data") or {}).get("asset_id")
        if asset_id:
            asset = db.get(Asset, asset_id)
            if asset and Path(asset.file_path).is_file():
                asset_paths[asset_id] = Path(asset.file_path)

    font_paths: dict[Any, Path] = {}
    for layer in layers:
        if layer.get("type") != "text":
            continue
        font_id = (layer.get("data") or {}).get("font_id", "inter")
        if font_id in font_paths:
            continue
        path: Path | None = None
        if isinstance(font_id, str):
            path = builtin_font_path(font_id)
        elif isinstance(font_id, int):
            asset = db.get(Asset, font_id)
            if asset and asset.type == AssetType.font:
                path = Path(asset.file_path)
        if path and path.is_file():
            font_paths[font_id] = path

    # Always have inter available as a final fallback for drawtext.
    if "inter" not in font_paths:
        p = builtin_font_path("inter")
        if p and p.is_file():
            font_paths["inter"] = p

    pools_records = (
        db.query(TextPool).filter(TextPool.template_id == template.id).all()
    )
    pools = {p.layer_id: list(p.items or []) for p in pools_records}

    overlay_audio_path: Path | None = None
    overlay = template.audio_overlay or {}
    overlay_id = overlay.get("asset_id")
    if overlay_id:
        a = db.get(Asset, overlay_id)
        if a and a.type == AssetType.audio and Path(a.file_path).is_file():
            overlay_audio_path = Path(a.file_path)

    return {
        "asset_paths": asset_paths,
        "font_paths": font_paths,
        "pools": pools,
        "overlay_audio_path": overlay_audio_path,
    }


@celery_app.task(name="process_render_job")
def process_render_job(job_id: int) -> None:
    db = SessionLocal()
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

        # Per-template render counter (drives pool variant index).
        template_counts: dict[int, int] = {}
        output_files: list[str] = []

        for i, assignment in enumerate(assignments):
            src_id = assignment.get("source_id")
            tmpl_id = assignment.get("template_id")

            template = db.get(Template, tmpl_id)
            source = db.get(VideoSource, src_id)
            if template is None or source is None:
                log.warning(
                    "Skipping assignment %s: template=%s source=%s",
                    i, tmpl_id, src_id,
                )
                continue

            src_path = Path(source.file_path)
            if not src_path.is_file():
                log.warning("Skipping: source file missing %s", src_path)
                continue

            ctx = _gather_render_context(db, template)
            pool_index = template_counts.get(tmpl_id, 0)
            template_counts[tmpl_id] = pool_index + 1

            file_name = (
                f"{_slug(source.original_filename or f'src{src_id}', 'src')}_"
                f"{_slug(template.name, 'tpl')}_{i}.mp4"
            )
            output_path = out_dir / file_name

            cmd = build_batch_render_command(
                _template_to_dict(template),
                src_path,
                output_path,
                overlay_audio_path=ctx["overlay_audio_path"],
                asset_paths=ctx["asset_paths"],
                font_paths=ctx["font_paths"],
                pools=ctx["pools"],
                pool_index=pool_index,
            )
            log.info("Render %d/%d → %s", i + 1, total, output_path.name)

            try:
                subprocess.run(
                    cmd,
                    capture_output=True,
                    check=True,
                    timeout=FFMPEG_TIMEOUT,
                )
            except subprocess.CalledProcessError as e:
                stderr = e.stderr.decode("utf-8", errors="replace")[-1500:]
                log.error("ffmpeg failed for %s:\n%s", output_path, stderr)
                raise RuntimeError(
                    f"ffmpeg failed on {output_path.name}: "
                    f"{stderr.splitlines()[-1] if stderr else 'unknown'}"
                ) from e

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
        db.close()
