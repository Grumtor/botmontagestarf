"""File-serving endpoints for protected media.

URL pattern: /api/files/{kind}/{...}

  - asset/{asset_id}             → a font asset by DB id (global = all users)
  - template_clip/{tid}/{fid}    → a fixed clip stored under a template
  - template_overlay/{tid}/{fid} → an image/audio overlay used by a layer
  - template_thumb/{tid}         → the template's thumbnail
  - render/{job_id}              → the ZIP archive of a finished render job
  - render_item/{job_id}/{idx}   → one of a render job's individual MP4 outputs

Phase 33 — multi-tenant : tous les endpoints qui dépendent d'un template
ou d'un job vérifient l'ownership. 404 (pas 403) pour ne pas leak
l'existence d'objets appartenant à d'autres users.
"""

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.api.templates import find_template_file
from app.db import get_db
from app.db.models import Asset, RenderJob, Template, User
from app.storage import find_template_cover, template_thumb_path
from app.users import require_user

router = APIRouter(prefix="/api/files", tags=["files"])


def _check_template_access(db: Session, template_id: int, user: User) -> None:
    """404 if the template doesn't exist OR isn't owned by `user`."""
    template = db.get(Template, template_id)
    if template is None or template.owner_id != user.id:
        raise HTTPException(404, "Template not found")


def _get_owned_job(db: Session, job_id: int, user: User) -> RenderJob:
    rec = db.get(RenderJob, job_id)
    if rec is None or rec.owner_id != user.id:
        raise HTTPException(404, "Job not found")
    return rec


@router.get("/asset/{asset_id}")
def serve_asset(
    asset_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
) -> FileResponse:
    # Fonts are shared across all users (pas sensitives). Le `require_user`
    # garantit juste que personne d'anonyme ne télécharge.
    rec = db.get(Asset, asset_id)
    if rec is None:
        raise HTTPException(404, "Asset not found")
    p = Path(rec.file_path)
    if not p.is_file():
        raise HTTPException(404, "Asset file missing on disk")
    return FileResponse(p)


@router.get("/template_clip/{template_id}/{file_id}")
def serve_template_clip(
    template_id: int,
    file_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
) -> FileResponse:
    _check_template_access(db, template_id, user)
    p = find_template_file(template_id, file_id, "clip")
    if p is None or not p.is_file():
        raise HTTPException(404, "Clip file not found")
    return FileResponse(p)


@router.get("/template_clip_thumb/{template_id}/{file_id}")
def serve_template_clip_thumb(
    template_id: int,
    file_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
) -> FileResponse:
    """Serve the JPEG thumbnail extracted from a fixed clip at upload."""
    from app.storage import template_clips_dir

    _check_template_access(db, template_id, user)
    p = template_clips_dir(template_id) / f"{file_id}_thumb.jpg"
    if not p.is_file():
        raise HTTPException(404, "Thumbnail not found")
    return FileResponse(p, media_type="image/jpeg")


@router.get("/template_clip_strip/{template_id}/{file_id}")
def serve_template_clip_strip(
    template_id: int,
    file_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
) -> FileResponse:
    """Serve the wide filmstrip JPEG generated at upload time (Phase 27).
    The frontend uses it as a background-image stretched horizontally
    across the clip block so the user can see what's inside the video."""
    from app.storage import template_clips_dir

    _check_template_access(db, template_id, user)
    p = template_clips_dir(template_id) / f"{file_id}_strip.jpg"
    if not p.is_file():
        raise HTTPException(404, "Filmstrip not found")
    return FileResponse(p, media_type="image/jpeg")


@router.get("/template_overlay/{template_id}/{file_id}")
def serve_template_overlay(
    template_id: int,
    file_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
) -> FileResponse:
    _check_template_access(db, template_id, user)
    p = find_template_file(template_id, file_id, "overlay")
    if p is None or not p.is_file():
        raise HTTPException(404, "Overlay file not found")
    return FileResponse(p)


@router.get("/template_thumb/{template_id}")
def serve_template_thumb(
    template_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
) -> FileResponse:
    _check_template_access(db, template_id, user)
    p = template_thumb_path(template_id)
    if not p.is_file():
        raise HTTPException(404, "No thumbnail")
    return FileResponse(p)


@router.get("/template_cover/{template_id}")
def serve_template_cover(
    template_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
) -> FileResponse:
    """User-uploaded cover image used by the /templates grid card.
    404 when no custom cover — frontend falls back to template_thumb."""
    _check_template_access(db, template_id, user)
    p = find_template_cover(template_id)
    if p is None or not p.is_file():
        raise HTTPException(404, "No custom cover")
    media = {
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "png": "image/png",
        "webp": "image/webp",
    }.get(p.suffix.lstrip(".").lower(), "application/octet-stream")
    return FileResponse(p, media_type=media)


@router.get("/template_preview/{template_id}")
def serve_template_preview(
    template_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
) -> FileResponse:
    """Cached preview MP4 of a template (last "Aperçu rendu" output)."""
    from app.storage import template_preview_path

    _check_template_access(db, template_id, user)
    p = template_preview_path(template_id)
    if not p.is_file():
        raise HTTPException(404, "No preview yet")
    return FileResponse(p, media_type="video/mp4")


@router.get("/render/{job_id}")
def serve_render_zip(
    job_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
) -> FileResponse:
    rec = _get_owned_job(db, job_id, user)
    if not rec.output_zip_path:
        raise HTTPException(404, "Render ZIP not available")
    p = Path(rec.output_zip_path)
    if not p.is_file():
        raise HTTPException(404, "ZIP file missing on disk")
    return FileResponse(p, media_type="application/zip", filename=f"render_{job_id}.zip")


@router.get("/render_item/{job_id}/{index}")
def serve_render_item(
    job_id: int,
    index: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
) -> FileResponse:
    rec = _get_owned_job(db, job_id, user)
    files = list(rec.output_files or [])
    if index < 0 or index >= len(files):
        raise HTTPException(404, "Output index out of range")
    p = Path(files[index])
    if not p.is_file():
        raise HTTPException(404, "Output file missing")
    # If iPhone naming was selected at render time, surface the matching
    # IMG_*.mp4 filename in the Content-Disposition so the per-file
    # download has the same name as the ZIP entries.
    mp = rec.metadata_profile or {}
    apple_map = mp.get("apple_name_by_path") or {}
    download_name = apple_map.get(str(p)) or apple_map.get(p.name) or p.name
    return FileResponse(p, media_type="video/mp4", filename=download_name)
