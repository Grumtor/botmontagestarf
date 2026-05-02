import logging
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.db import get_db
from app.db.models import VideoSource
from app.media import MediaError, make_video_thumb, video_metadata
from app.storage import SOURCES_DIR, SOURCE_THUMBS_DIR

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/sources", tags=["sources"])

MAX_BYTES = 500 * 1024 * 1024  # 500 MB
ALLOWED_EXTS = {".mp4", ".mov"}
CHUNK = 1024 * 1024


class SourceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    original_filename: str
    duration_sec: Optional[float]
    width: Optional[int]
    height: Optional[int]
    thumbnail_path: Optional[str]
    uploaded_at: datetime


@router.post("/upload", response_model=SourceRead, status_code=status.HTTP_201_CREATED)
async def upload_source(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> VideoSource:
    original = file.filename or "unknown"
    ext = Path(original).suffix.lower()
    if ext not in ALLOWED_EXTS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Unsupported extension {ext!r}; allowed: {', '.join(sorted(ALLOWED_EXTS))}",
        )

    file_uuid = uuid.uuid4().hex
    dest = SOURCES_DIR / f"{file_uuid}{ext}"

    total = 0
    try:
        with dest.open("wb") as out:
            while True:
                chunk = await file.read(CHUNK)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_BYTES:
                    raise HTTPException(
                        status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        f"File too large (max {MAX_BYTES // (1024 * 1024)} MB)",
                    )
                out.write(chunk)
    except HTTPException:
        dest.unlink(missing_ok=True)
        raise
    except Exception:
        dest.unlink(missing_ok=True)
        raise

    try:
        duration, width, height = video_metadata(dest)
    except MediaError as e:
        dest.unlink(missing_ok=True)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Invalid video: {e}")

    thumb = SOURCE_THUMBS_DIR / f"{file_uuid}.jpg"
    thumb_path: Optional[str]
    try:
        make_video_thumb(dest, thumb)
        thumb_path = str(thumb)
    except MediaError as e:
        log.warning("thumbnail generation failed for %s: %s", dest, e)
        thumb_path = None

    rec = VideoSource(
        original_filename=original,
        file_path=str(dest),
        duration_sec=duration,
        width=width,
        height=height,
        thumbnail_path=thumb_path,
    )
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return rec


@router.get("", response_model=list[SourceRead])
def list_sources(db: Session = Depends(get_db)) -> list[VideoSource]:
    return db.query(VideoSource).order_by(VideoSource.uploaded_at.desc()).all()


@router.delete("/{source_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_source(source_id: int, db: Session = Depends(get_db)) -> None:
    rec = db.get(VideoSource, source_id)
    if rec is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Source not found")

    Path(rec.file_path).unlink(missing_ok=True)
    if rec.thumbnail_path:
        Path(rec.thumbnail_path).unlink(missing_ok=True)
    db.delete(rec)
    db.commit()
