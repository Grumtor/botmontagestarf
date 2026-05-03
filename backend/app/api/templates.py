"""Templates API for the clip-based model.

A template owns:
  - clips: ordered list of clips on the main track. Each is `fixed` (a video
    file uploaded with the template) or `placeholder` (a slot to be filled by
    a user-supplied video at render time).
  - layers: text/image/gif/emoji overlays positioned in time AND on the canvas.
  - audio_overlay: optional second audio track (music).

Files uploaded for fixed clips and overlay images/audio live under
/data/templates/{template_id}/. Frontend references them by `file_id` returned
by the upload endpoint.
"""

import shutil
import subprocess
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.db.models import Template, TemplateLanguage
from app.media import MediaError, make_video_thumb, video_metadata
from app.storage import (
    template_clips_dir,
    template_dir,
    template_overlays_dir,
)

router = APIRouter(prefix="/api/templates", tags=["templates"])

UPLOAD_MAX_BYTES = 500 * 1024 * 1024
CHUNK = 1024 * 1024
ALLOWED_VIDEO_CLIP_EXTS = {".mp4", ".mov"}
ALLOWED_IMAGE_CLIP_EXTS = {".png", ".jpg", ".jpeg"}
ALLOWED_CLIP_EXTS = ALLOWED_VIDEO_CLIP_EXTS | ALLOWED_IMAGE_CLIP_EXTS
ALLOWED_OVERLAY_EXTS = {
    ".png", ".jpg", ".jpeg", ".gif",
    ".mp3", ".wav", ".m4a",
}


# ---- schemas ---------------------------------------------------------

class TemplateBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    language: TemplateLanguage = TemplateLanguage.US
    description: Optional[str] = None


class TemplateCreate(TemplateBase):
    pass


class TemplateUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    language: Optional[TemplateLanguage] = None
    description: Optional[str] = None
    clips: Optional[list] = None
    layers: Optional[list] = None
    audio_overlay: Optional[dict] = None


class TemplateRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: Optional[str]
    language: TemplateLanguage
    clips: list
    layers: list
    audio_overlay: dict
    thumbnail_path: Optional[str]
    created_at: datetime
    updated_at: datetime


class ClipUploadResponse(BaseModel):
    file_id: str
    kind: str  # "video" | "image"
    duration_sec: Optional[float]
    width: Optional[int]
    height: Optional[int]


class OverlayUploadResponse(BaseModel):
    file_id: str


# ---- routes ----------------------------------------------------------

@router.post("", response_model=TemplateRead, status_code=status.HTTP_201_CREATED)
def create_template(
    payload: TemplateCreate, db: Session = Depends(get_db)
) -> Template:
    template = Template(
        name=payload.name,
        language=payload.language,
        description=payload.description,
        clips=[],
        layers=[],
        audio_overlay={
            "file_id": None,
            "volume": 1.0,
            "start_offset": 0.0,
            "trim_in": 0.0,
        },
    )
    db.add(template)
    db.commit()
    db.refresh(template)
    return template


@router.get("", response_model=list[TemplateRead])
def list_templates(
    language: Optional[TemplateLanguage] = Query(default=None),
    db: Session = Depends(get_db),
) -> list[Template]:
    q = db.query(Template)
    if language is not None:
        q = q.filter(Template.language == language)
    return q.order_by(Template.updated_at.desc()).all()


@router.get("/{template_id}", response_model=TemplateRead)
def get_template(template_id: int, db: Session = Depends(get_db)) -> Template:
    template = db.get(Template, template_id)
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")
    return template


@router.put("/{template_id}", response_model=TemplateRead)
def update_template(
    template_id: int, payload: TemplateUpdate, db: Session = Depends(get_db)
) -> Template:
    template = db.get(Template, template_id)
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(template, field, value)
    db.commit()
    db.refresh(template)
    return template


@router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_template(template_id: int, db: Session = Depends(get_db)) -> None:
    template = db.get(Template, template_id)
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")
    # Wipe the per-template folder (clips + overlays + thumbnail).
    shutil.rmtree(template_dir(template_id), ignore_errors=True)
    db.delete(template)
    db.commit()


@router.post(
    "/{template_id}/duplicate",
    response_model=TemplateRead,
    status_code=status.HTTP_201_CREATED,
)
def duplicate_template(
    template_id: int, db: Session = Depends(get_db)
) -> Template:
    src = db.get(Template, template_id)
    if src is None:
        raise HTTPException(status_code=404, detail="Template not found")

    clone = Template(
        name=f"{src.name} (copy)",
        description=src.description,
        language=src.language,
        clips=[],
        layers=list(src.layers or []),
        audio_overlay=dict(src.audio_overlay or {}),
    )
    db.add(clone)
    db.commit()
    db.refresh(clone)

    # Copy the source template's clip + overlay files under the new ID,
    # preserving file_ids so the cloned `clips`/`layers`/`audio_overlay`
    # references still resolve.
    new_clips: list[dict] = []
    for clip in src.clips or []:
        c = dict(clip)
        if c.get("type") == "fixed" and c.get("file_id"):
            old_dir = template_clips_dir(src.id)
            new_dir = template_clips_dir(clone.id)
            for f in old_dir.glob(f"{c['file_id']}.*"):
                shutil.copy(f, new_dir / f.name)
        new_clips.append(c)
    clone.clips = new_clips

    src_overlays = template_overlays_dir(src.id)
    if src_overlays.is_dir():
        new_overlays = template_overlays_dir(clone.id)
        for f in src_overlays.iterdir():
            shutil.copy(f, new_overlays / f.name)

    db.commit()
    db.refresh(clone)
    return clone


# ---- file uploads scoped to a template -------------------------------

async def _stream_to_disk(file: UploadFile, dest: Path) -> int:
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
                        status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        f"File too large (max {UPLOAD_MAX_BYTES // (1024 * 1024)} MB)",
                    )
                out.write(chunk)
    except HTTPException:
        dest.unlink(missing_ok=True)
        raise
    return total


@router.post(
    "/{template_id}/clips/upload",
    response_model=ClipUploadResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_clip(
    template_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> ClipUploadResponse:
    """Upload a fixed video clip for a template. Returns a file_id the
    frontend embeds in `template.clips[i].file_id`."""
    if db.get(Template, template_id) is None:
        raise HTTPException(404, "Template not found")

    original = file.filename or "clip"
    ext = Path(original).suffix.lower()
    if ext not in ALLOWED_CLIP_EXTS:
        raise HTTPException(
            400,
            f"Unsupported extension {ext!r}; allowed: "
            f"{', '.join(sorted(ALLOWED_CLIP_EXTS))}",
        )

    is_image = ext in ALLOWED_IMAGE_CLIP_EXTS
    kind = "image" if is_image else "video"

    file_id = uuid.uuid4().hex
    dest = template_clips_dir(template_id) / f"{file_id}{ext}"
    await _stream_to_disk(file, dest)

    duration: Optional[float]
    width: Optional[int]
    height: Optional[int]

    if is_image:
        # For static images we don't have a video duration. Frontend will
        # set its own duration_sec on the placeholder-style image clip.
        # Use ffprobe to get dimensions.
        try:
            info = video_metadata(dest)
            _, width, height = info
        except MediaError:
            width, height = (None, None)
        duration = None
        # For thumbnail of an image clip: just copy/scale the image as JPEG.
        thumb_path = template_clips_dir(template_id) / f"{file_id}_thumb.jpg"
        try:
            import subprocess
            subprocess.run(
                [
                    "ffmpeg", "-y",
                    "-i", str(dest),
                    "-vf", "scale=90:160:force_original_aspect_ratio=decrease,pad=90:160:(ow-iw)/2:(oh-ih)/2:black",
                    "-frames:v", "1",
                    "-q:v", "3",
                    str(thumb_path),
                ],
                capture_output=True, check=True, timeout=15,
            )
        except Exception:
            pass
    else:
        try:
            duration, width, height = video_metadata(dest)
        except MediaError:
            duration, width, height = (None, None, None)
        thumb_path = template_clips_dir(template_id) / f"{file_id}_thumb.jpg"
        try:
            make_video_thumb(dest, thumb_path, width=90, height=160)
        except MediaError:
            pass

    return ClipUploadResponse(
        file_id=file_id,
        kind=kind,
        duration_sec=duration,
        width=width,
        height=height,
    )


@router.post(
    "/{template_id}/overlays/upload",
    response_model=OverlayUploadResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_overlay(
    template_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> OverlayUploadResponse:
    """Upload an image/gif/audio used by a layer or audio_overlay of a
    specific template."""
    if db.get(Template, template_id) is None:
        raise HTTPException(404, "Template not found")

    original = file.filename or "overlay"
    ext = Path(original).suffix.lower()
    if ext not in ALLOWED_OVERLAY_EXTS:
        raise HTTPException(
            400,
            f"Unsupported extension {ext!r}; allowed: "
            f"{', '.join(sorted(ALLOWED_OVERLAY_EXTS))}",
        )

    file_id = uuid.uuid4().hex
    dest = template_overlays_dir(template_id) / f"{file_id}{ext}"
    await _stream_to_disk(file, dest)

    return OverlayUploadResponse(file_id=file_id)


def find_template_file(template_id: int, file_id: str, kind: str) -> Optional[Path]:
    """Look up the on-disk path of a clip or overlay file by its file_id.
    `kind` ∈ {'clip', 'overlay'}."""
    base = (
        template_clips_dir(template_id)
        if kind == "clip"
        else template_overlays_dir(template_id)
    )
    for p in base.glob(f"{file_id}.*"):
        return p
    return None
