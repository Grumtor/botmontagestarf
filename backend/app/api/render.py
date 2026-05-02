import logging
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.db.models import Asset, AssetType, Template, VideoSource
from app.render.pipeline import build_ffmpeg_command

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/render", tags=["render"])


class PreviewRequest(BaseModel):
    template_id: int
    source_id: int


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


def _resolve_overlay_path(template: Template, db: Session) -> Optional[Path]:
    overlay = template.audio_overlay or {}
    asset_id = overlay.get("asset_id")
    if not asset_id:
        return None
    asset = db.get(Asset, asset_id)
    if asset is None or asset.type != AssetType.audio:
        return None
    p = Path(asset.file_path)
    return p if p.is_file() else None


@router.post("/preview")
def render_preview(
    payload: PreviewRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> FileResponse:
    template = db.get(Template, payload.template_id)
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")

    source = db.get(VideoSource, payload.source_id)
    if source is None:
        raise HTTPException(status_code=404, detail="Source not found")

    src_path = Path(source.file_path)
    if not src_path.is_file():
        raise HTTPException(status_code=404, detail="Source file missing on disk")

    # Render to a temp file. Cleanup is scheduled as a background task that
    # runs after the FileResponse has finished streaming.
    tmp = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
    tmp.close()
    output_path = Path(tmp.name)

    overlay_path = _resolve_overlay_path(template, db)
    cmd = build_ffmpeg_command(
        _template_to_dict(template),
        src_path,
        output_path,
        overlay_audio_path=overlay_path,
    )
    log.info("Running preview ffmpeg: %s", " ".join(cmd))

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            check=True,
            timeout=120,
        )
    except subprocess.CalledProcessError as e:
        output_path.unlink(missing_ok=True)
        stderr = e.stderr.decode("utf-8", errors="replace")[-1000:]
        log.error("ffmpeg failed:\n%s", stderr)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"ffmpeg failed: {stderr.splitlines()[-1] if stderr else 'unknown'}",
        )
    except subprocess.TimeoutExpired:
        output_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="ffmpeg timed out",
        )

    if not output_path.is_file() or output_path.stat().st_size == 0:
        output_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail="Empty output file")

    background_tasks.add_task(_safe_unlink, output_path)
    return FileResponse(
        path=output_path,
        media_type="video/mp4",
        filename="preview.mp4",
    )


def _safe_unlink(p: Path) -> None:
    try:
        p.unlink(missing_ok=True)
    except Exception as e:
        log.warning("failed to unlink %s: %s", p, e)
