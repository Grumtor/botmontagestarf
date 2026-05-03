"""Render endpoints.

Flow:
  1. Frontend uploads each user video for the placeholders via POST /api/render/upload.
     Each upload returns a short-lived token that maps to a file in /data/temp/.
  2. Frontend submits POST /api/render/batch with the assignments referencing
     those tokens. The Celery worker resolves them and runs the pipeline.
  3. The preview endpoint runs synchronously for a single template + fills.
"""

import logging
import subprocess
import tempfile
import uuid
from pathlib import Path
from typing import Optional

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    HTTPException,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.db.models import Template
from app.render.batch_runner import gather_render_inputs, run_render
from app.storage import TEMP_DIR

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/render", tags=["render"])

UPLOAD_MAX_BYTES = 500 * 1024 * 1024
CHUNK = 1024 * 1024
ALLOWED_USER_VIDEO_EXTS = {".mp4", ".mov"}


class UploadResponse(BaseModel):
    token: str


class PreviewFill(BaseModel):
    clip_id: str
    token: str


class PreviewRequest(BaseModel):
    template_id: int
    fills: list[PreviewFill] = []


@router.post("/upload", response_model=UploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_user_video(file: UploadFile = File(...)) -> UploadResponse:
    """Stash a user-supplied video in /data/temp/. Returns a token the
    frontend embeds in subsequent /preview or /batch requests."""
    original = file.filename or "video.mp4"
    ext = Path(original).suffix.lower()
    if ext not in ALLOWED_USER_VIDEO_EXTS:
        raise HTTPException(400, f"Unsupported extension {ext!r}; allowed: mp4, mov")

    token = uuid.uuid4().hex
    dest = TEMP_DIR / f"{token}{ext}"

    total = 0
    try:
        with dest.open("wb") as out:
            while True:
                chunk = await file.read(CHUNK)
                if not chunk:
                    break
                total += len(chunk)
                if total > UPLOAD_MAX_BYTES:
                    raise HTTPException(
                        413, f"File too large (max {UPLOAD_MAX_BYTES // (1024 * 1024)} MB)"
                    )
                out.write(chunk)
    except HTTPException:
        dest.unlink(missing_ok=True)
        raise

    return UploadResponse(token=token)


@router.post("/preview")
def render_preview(
    payload: PreviewRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> FileResponse:
    """Render a single preview MP4 for one template + given fills.
    Lower quality (CRF 28, ultrafast) than batch outputs."""
    template = db.get(Template, payload.template_id)
    if template is None:
        raise HTTPException(404, "Template not found")

    fills = {f.clip_id: f.token for f in payload.fills}

    tmp = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
    tmp.close()
    output_path = Path(tmp.name)

    try:
        ctx = gather_render_inputs(db, template, fills)
        run_render(
            template=template,
            ctx=ctx,
            output_path=output_path,
            crf=28,
            preset="ultrafast",
            timeout=180,
        )
    except Exception as e:
        output_path.unlink(missing_ok=True)
        raise HTTPException(500, f"Render failed: {e}")

    background_tasks.add_task(_safe_unlink, output_path)
    return FileResponse(path=output_path, media_type="video/mp4", filename="preview.mp4")


def _safe_unlink(p: Path) -> None:
    try:
        p.unlink(missing_ok=True)
    except Exception as e:
        log.warning("failed to unlink %s: %s", p, e)
