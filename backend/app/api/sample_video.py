"""Sample placeholder video — single global file used as the visual
filler whenever a template preview would otherwise show a black
placeholder. Uploaded once via this API, reused by every template
preview. (Phase 17.)
"""

from __future__ import annotations

import logging
import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

from app.db.models import User
from app.media import MediaError, video_metadata
from app.storage import (
    SAMPLE_VIDEO_PATH,
    invalidate_template_previews,
)
from app.users import require_admin, require_user

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/sample_video", tags=["sample_video"])

ALLOWED_EXTS = {".mp4", ".mov", ".m4v"}
MAX_BYTES = 200 * 1024 * 1024  # 200 MB (sample shouldn't be huge)


class SampleVideoInfo(BaseModel):
    exists: bool
    size_bytes: int | None = None
    duration_sec: float | None = None
    width: int | None = None
    height: int | None = None


@router.get("/info", response_model=SampleVideoInfo)
def get_info(_user: User = Depends(require_user)) -> SampleVideoInfo:
    if not SAMPLE_VIDEO_PATH.is_file():
        return SampleVideoInfo(exists=False)
    try:
        size = SAMPLE_VIDEO_PATH.stat().st_size
    except OSError:
        size = None
    try:
        duration, width, height = video_metadata(SAMPLE_VIDEO_PATH)
    except MediaError:
        duration, width, height = None, None, None
    return SampleVideoInfo(
        exists=True,
        size_bytes=size,
        duration_sec=duration,
        width=width,
        height=height,
    )


@router.get("")
def serve(_user: User = Depends(require_user)) -> FileResponse:
    if not SAMPLE_VIDEO_PATH.is_file():
        raise HTTPException(404, "Aucune vidéo exemple uploadée")
    return FileResponse(
        SAMPLE_VIDEO_PATH,
        media_type="video/mp4",
        headers={"Cache-Control": "no-cache"},
    )


@router.post("", response_model=SampleVideoInfo, status_code=status.HTTP_201_CREATED)
async def upload(
    file: UploadFile = File(...),
    _admin: User = Depends(require_admin),
) -> SampleVideoInfo:
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXTS:
        raise HTTPException(
            400,
            f"Extension {ext or '(none)'} non supportée. MP4 / MOV / M4V uniquement.",
        )

    # Stream to a temp path, then atomically replace the live file. Avoids
    # a half-written file blocking previews if the upload aborts.
    SAMPLE_VIDEO_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = SAMPLE_VIDEO_PATH.with_suffix(SAMPLE_VIDEO_PATH.suffix + ".part")
    size = 0
    try:
        with tmp.open("wb") as out:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_BYTES:
                    out.close()
                    tmp.unlink(missing_ok=True)
                    raise HTTPException(
                        400,
                        f"Fichier trop gros (>{MAX_BYTES // (1024 * 1024)} MB)",
                    )
                out.write(chunk)
        tmp.replace(SAMPLE_VIDEO_PATH)
    except HTTPException:
        raise
    except Exception as e:
        tmp.unlink(missing_ok=True)
        log.exception("sample video upload failed: %s", e)
        raise HTTPException(500, f"Upload failed: {e}")

    invalidate_template_previews()
    return get_info()


@router.delete("")
def delete_sample(_admin: User = Depends(require_admin)) -> Response:
    if SAMPLE_VIDEO_PATH.is_file():
        try:
            SAMPLE_VIDEO_PATH.unlink()
        except Exception as e:
            log.warning("could not delete sample video: %s", e)
            raise HTTPException(500, f"Could not delete: {e}")
    invalidate_template_previews()
    return Response(status_code=204)
