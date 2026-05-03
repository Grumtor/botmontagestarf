"""File-serving endpoints for protected media.

URL pattern: /api/files/{kind}/{...}

  - asset/{asset_id}             → a font asset by DB id
  - template_clip/{tid}/{fid}    → a fixed clip stored under a template
  - template_overlay/{tid}/{fid} → an image/audio overlay used by a layer
  - template_thumb/{tid}         → the template's thumbnail
  - render/{job_id}              → the ZIP archive of a finished render job
  - render_item/{job_id}/{idx}   → one of a render job's individual MP4 outputs
"""

from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.api.templates import find_template_file
from app.db import get_db
from app.db.models import Asset, RenderJob, Template
from app.storage import template_thumb_path

router = APIRouter(prefix="/api/files", tags=["files"])


@router.get("/asset/{asset_id}")
def serve_asset(asset_id: int, db: Session = Depends(get_db)) -> FileResponse:
    rec = db.get(Asset, asset_id)
    if rec is None:
        raise HTTPException(404, "Asset not found")
    p = Path(rec.file_path)
    if not p.is_file():
        raise HTTPException(404, "Asset file missing on disk")
    return FileResponse(p)


@router.get("/template_clip/{template_id}/{file_id}")
def serve_template_clip(
    template_id: int, file_id: str, db: Session = Depends(get_db)
) -> FileResponse:
    if db.get(Template, template_id) is None:
        raise HTTPException(404, "Template not found")
    p = find_template_file(template_id, file_id, "clip")
    if p is None or not p.is_file():
        raise HTTPException(404, "Clip file not found")
    return FileResponse(p)


@router.get("/template_clip_thumb/{template_id}/{file_id}")
def serve_template_clip_thumb(
    template_id: int, file_id: str, db: Session = Depends(get_db)
) -> FileResponse:
    """Serve the JPEG thumbnail extracted from a fixed clip at upload."""
    from app.storage import template_clips_dir

    if db.get(Template, template_id) is None:
        raise HTTPException(404, "Template not found")
    p = template_clips_dir(template_id) / f"{file_id}_thumb.jpg"
    if not p.is_file():
        raise HTTPException(404, "Thumbnail not found")
    return FileResponse(p, media_type="image/jpeg")


@router.get("/template_overlay/{template_id}/{file_id}")
def serve_template_overlay(
    template_id: int, file_id: str, db: Session = Depends(get_db)
) -> FileResponse:
    if db.get(Template, template_id) is None:
        raise HTTPException(404, "Template not found")
    p = find_template_file(template_id, file_id, "overlay")
    if p is None or not p.is_file():
        raise HTTPException(404, "Overlay file not found")
    return FileResponse(p)


@router.get("/template_thumb/{template_id}")
def serve_template_thumb(
    template_id: int, db: Session = Depends(get_db)
) -> FileResponse:
    if db.get(Template, template_id) is None:
        raise HTTPException(404, "Template not found")
    p = template_thumb_path(template_id)
    if not p.is_file():
        raise HTTPException(404, "No thumbnail")
    return FileResponse(p)


@router.get("/render/{job_id}")
def serve_render_zip(job_id: int, db: Session = Depends(get_db)) -> FileResponse:
    rec = db.get(RenderJob, job_id)
    if rec is None or not rec.output_zip_path:
        raise HTTPException(404, "Render ZIP not available")
    p = Path(rec.output_zip_path)
    if not p.is_file():
        raise HTTPException(404, "ZIP file missing on disk")
    return FileResponse(p, media_type="application/zip", filename=f"render_{job_id}.zip")


@router.get("/render_item/{job_id}/{index}")
def serve_render_item(
    job_id: int, index: int, db: Session = Depends(get_db)
) -> FileResponse:
    rec = db.get(RenderJob, job_id)
    if rec is None:
        raise HTTPException(404, "Job not found")
    files = list(rec.output_files or [])
    if index < 0 or index >= len(files):
        raise HTTPException(404, "Output index out of range")
    p = Path(files[index])
    if not p.is_file():
        raise HTTPException(404, "Output file missing")
    return FileResponse(p, media_type="video/mp4", filename=p.name)
