from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.db import get_db
from app.db.models import Asset, RenderJob, Template, VideoSource

router = APIRouter(prefix="/api/files", tags=["files"])

KINDS = {"source", "source_thumb", "asset", "template_thumb", "render"}


def _resolve_path(kind: str, item_id: int, db: Session) -> Optional[str]:
    if kind == "source":
        rec = db.get(VideoSource, item_id)
        return rec.file_path if rec else None
    if kind == "source_thumb":
        rec = db.get(VideoSource, item_id)
        return rec.thumbnail_path if rec else None
    if kind == "asset":
        rec = db.get(Asset, item_id)
        return rec.file_path if rec else None
    if kind == "template_thumb":
        rec = db.get(Template, item_id)
        return rec.thumbnail_path if rec else None
    if kind == "render":
        rec = db.get(RenderJob, item_id)
        return rec.output_zip_path if rec else None
    return None


@router.get("/{kind}/{item_id}")
def serve_file(kind: str, item_id: int, db: Session = Depends(get_db)) -> FileResponse:
    if kind not in KINDS:
        raise HTTPException(status_code=404, detail=f"Unknown kind {kind!r}")

    path = _resolve_path(kind, item_id, db)
    if not path:
        raise HTTPException(status_code=404, detail="Not found")

    p = Path(path)
    if not p.is_file():
        raise HTTPException(status_code=404, detail="File missing on disk")

    return FileResponse(p)


@router.get("/render_item/{job_id}/{index}")
def serve_render_item(
    job_id: int, index: int, db: Session = Depends(get_db)
) -> FileResponse:
    """Serve one of a job's individual rendered MP4 outputs by index."""
    rec = db.get(RenderJob, job_id)
    if rec is None:
        raise HTTPException(status_code=404, detail="Job not found")
    files = list(rec.output_files or [])
    if index < 0 or index >= len(files):
        raise HTTPException(status_code=404, detail="Output index out of range")
    p = Path(files[index])
    if not p.is_file():
        raise HTTPException(status_code=404, detail="Output file missing")
    return FileResponse(p, media_type="video/mp4", filename=p.name)
