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
from app.db.models import Template, TemplateLanguage, User
from app.media import MediaError, make_video_thumb, video_metadata
from app.storage import (
    find_template_cover,
    template_clips_dir,
    template_cover_path,
    template_dir,
    template_overlays_dir,
)
from app.users import require_user

router = APIRouter(prefix="/api/templates", tags=["templates"])


def _get_owned_template(db: Session, tid: int, user: User) -> Template:
    """Fetch a template and verify ownership. Raises 404 if not found
    OR not owned by `user`. We deliberately return 404 (not 403) to
    avoid leaking the existence of templates owned by other users."""
    template = db.get(Template, tid)
    if template is None or template.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Template not found")
    return template

UPLOAD_MAX_BYTES = 500 * 1024 * 1024
CHUNK = 1024 * 1024
ALLOWED_VIDEO_CLIP_EXTS = {".mp4", ".mov"}
ALLOWED_IMAGE_CLIP_EXTS = {".png", ".jpg", ".jpeg"}
ALLOWED_CLIP_EXTS = ALLOWED_VIDEO_CLIP_EXTS | ALLOWED_IMAGE_CLIP_EXTS
ALLOWED_OVERLAY_EXTS = {
    ".png", ".jpg", ".jpeg", ".gif",
    ".mp3", ".wav", ".m4a",
    # Video accepted as audio source — at upload time we ffmpeg-extract
    # the audio track and replace the file on disk with a .m4a (Phase 25).
    ".mp4", ".mov",
}
VIDEO_AUDIO_EXTS = {".mp4", ".mov"}


# ---- schemas ---------------------------------------------------------

class TemplateBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    language: TemplateLanguage = TemplateLanguage.US
    description: Optional[str] = None
    # Phase 36b — free-form sub-tags (per user). Multiple per template.
    # Filter logic on /templates et wizard render = AND (intersection).
    # Each tag : max 60 chars, no leading/trailing whitespace, no empty
    # strings (frontend should sanitize ; we re-check here defensively).
    tags: list[str] = Field(default_factory=list)


class TemplateCreate(TemplateBase):
    pass


class TemplateUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    language: Optional[TemplateLanguage] = None
    description: Optional[str] = None
    # Phase 36b — full replace of the tag list on update. `[]` clears,
    # absent = no change (exclude_unset pattern).
    tags: Optional[list[str]] = None
    clips: Optional[list] = None
    extra_tracks: Optional[list] = None
    layers: Optional[list] = None
    audio_overlay: Optional[dict] = None


def _sanitize_tags(tags: Optional[list[str]]) -> list[str]:
    """Trim, drop empties, dedupe (case-insensitive but keep first-seen casing),
    cap individual tag length at 60 chars + max 20 tags per template."""
    if not tags:
        return []
    seen: set[str] = set()
    out: list[str] = []
    for raw in tags:
        if not isinstance(raw, str):
            continue
        t = raw.strip()
        if not t:
            continue
        if len(t) > 60:
            t = t[:60]
        key = t.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(t)
        if len(out) >= 20:
            break
    return out


class TemplateRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: Optional[str]
    language: TemplateLanguage
    tags: list[str] = Field(default_factory=list)
    clips: list
    layers: list
    audio_overlay: dict
    thumbnail_path: Optional[str]
    cover_ext: Optional[str] = None
    cover_time_sec: Optional[float] = None
    extra_tracks: list = Field(default_factory=list)
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


class CoverFromTimeRequest(BaseModel):
    time_sec: float = Field(ge=0)


class CoverResponse(BaseModel):
    cover_ext: str
    cover_time_sec: float


# ---- routes ----------------------------------------------------------

@router.post("", response_model=TemplateRead, status_code=status.HTTP_201_CREATED)
def create_template(
    payload: TemplateCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
) -> Template:
    # Phase 33 — per-user template count cap (admin = unlimited via
    # user.max_templates == None).
    if user.max_templates is not None:
        from sqlalchemy import func as sa_func, select as sa_select
        n = db.scalar(
            sa_select(sa_func.count())
            .select_from(Template)
            .where(Template.owner_id == user.id)
        ) or 0
        if n >= user.max_templates:
            raise HTTPException(
                status_code=403,
                detail=(
                    f"Limite atteinte : tu as déjà {n} templates "
                    f"(max {user.max_templates}). Supprime-en un ou "
                    f"demande à l'admin d'augmenter ta limite."
                ),
            )
    template = Template(
        owner_id=user.id,
        name=payload.name,
        language=payload.language,
        description=payload.description,
        tags=_sanitize_tags(payload.tags),
        clips=[],
        extra_tracks=[],
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
    user: User = Depends(require_user),
) -> list[Template]:
    q = db.query(Template).filter(Template.owner_id == user.id)
    if language is not None:
        q = q.filter(Template.language == language)
    return q.order_by(Template.updated_at.desc()).all()


@router.get("/{template_id}", response_model=TemplateRead)
def get_template(
    template_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
) -> Template:
    return _get_owned_template(db, template_id, user)


@router.put("/{template_id}", response_model=TemplateRead)
def update_template(
    template_id: int,
    payload: TemplateUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
) -> Template:
    template = _get_owned_template(db, template_id, user)
    for field, value in payload.model_dump(exclude_unset=True).items():
        if field == "tags":
            # Sanitize (trim, dedupe case-insensitively, cap at 20 × 60 chars).
            value = _sanitize_tags(value)
        setattr(template, field, value)
    db.commit()
    db.refresh(template)
    return template


@router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_template(
    template_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
) -> None:
    template = _get_owned_template(db, template_id, user)
    shutil.rmtree(template_dir(template_id), ignore_errors=True)
    db.delete(template)
    db.commit()


@router.post(
    "/{template_id}/duplicate",
    response_model=TemplateRead,
    status_code=status.HTTP_201_CREATED,
)
def duplicate_template(
    template_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
) -> Template:
    src = _get_owned_template(db, template_id, user)
    # Apply the template-count limit to duplications too.
    if user.max_templates is not None:
        from sqlalchemy import func as sa_func, select as sa_select
        n = db.scalar(
            sa_select(sa_func.count())
            .select_from(Template)
            .where(Template.owner_id == user.id)
        ) or 0
        if n >= user.max_templates:
            raise HTTPException(
                status_code=403,
                detail=(
                    f"Limite atteinte : tu as déjà {n} templates "
                    f"(max {user.max_templates})."
                ),
            )

    clone = Template(
        owner_id=user.id,
        name=f"{src.name} (copy)",
        description=src.description,
        language=src.language,
        clips=[],
        extra_tracks=[],
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

    # Phase 26b — duplicate extra tracks too. Each track's clip files
    # already live in the same `clips` dir under file_id, so the loop
    # above already copied them via the main-track clips loop IF those
    # file_ids overlap. Extra-track clips with their own file_ids need
    # to be copied separately.
    new_extra_tracks: list[dict] = []
    for track in src.extra_tracks or []:
        t = dict(track)
        new_track_clips: list[dict] = []
        for clip in track.get("clips") or []:
            c = dict(clip)
            if c.get("type") in ("fixed", "image") and c.get("file_id"):
                old_dir = template_clips_dir(src.id)
                new_dir = template_clips_dir(clone.id)
                for f in old_dir.glob(f"{c['file_id']}.*"):
                    target = new_dir / f.name
                    if not target.exists():
                        shutil.copy(f, target)
            new_track_clips.append(c)
        t["clips"] = new_track_clips
        new_extra_tracks.append(t)
    clone.extra_tracks = new_extra_tracks

    src_overlays = template_overlays_dir(src.id)
    if src_overlays.is_dir():
        new_overlays = template_overlays_dir(clone.id)
        for f in src_overlays.iterdir():
            shutil.copy(f, new_overlays / f.name)

    # Copy custom cover if present.
    src_cover = find_template_cover(src.id)
    if src_cover is not None and src.cover_ext:
        new_cover = template_cover_path(clone.id, src.cover_ext)
        new_cover.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(src_cover, new_cover)
        clone.cover_ext = src.cover_ext
        clone.cover_time_sec = src.cover_time_sec

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
    user: User = Depends(require_user),
) -> ClipUploadResponse:
    """Upload a fixed video clip for a template. Returns a file_id the
    frontend embeds in `template.clips[i].file_id`."""
    _get_owned_template(db, template_id, user)

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
            from app.bin_finder import ffmpeg_env, ffmpeg_exe
            subprocess.run(
                [
                    ffmpeg_exe(), "-y",
                    "-i", str(dest),
                    "-vf", "scale=90:160:force_original_aspect_ratio=decrease,pad=90:160:(ow-iw)/2:(oh-ih)/2:black",
                    "-frames:v", "1",
                    "-q:v", "3",
                    str(thumb_path),
                ],
                capture_output=True, check=True, timeout=15,
                env=ffmpeg_env(),
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

        # Phase 27 — Filmstrip thumbnail. Generate a wide JPEG with one
        # frame per second (capped) tiled horizontally, so the timeline
        # block can show what's actually inside the video. Used as a
        # background-image stretched to the clip's render width.
        if duration and duration > 0:
            try:
                from app.bin_finder import ffmpeg_env, ffmpeg_exe

                # 1 frame per second, but cap so we don't generate
                # absurdly wide JPEGs for long clips.
                n_frames = max(2, min(60, int(duration)))
                fps_sample = n_frames / float(duration)
                strip_path = (
                    template_clips_dir(template_id)
                    / f"{file_id}_strip.jpg"
                )
                subprocess.run(
                    [
                        ffmpeg_exe(),
                        "-y",
                        "-i",
                        str(dest),
                        "-vf",
                        (
                            f"fps={fps_sample:.4f},"
                            f"scale=80:60:force_original_aspect_ratio=decrease,"
                            f"pad=80:60:(ow-iw)/2:(oh-ih)/2:color=black,"
                            f"tile={n_frames}x1"
                        ),
                        "-frames:v",
                        "1",
                        "-q:v",
                        "5",
                        str(strip_path),
                    ],
                    capture_output=True,
                    check=True,
                    timeout=60,
                    env=ffmpeg_env(),
                )
            except Exception:
                # Filmstrip is best-effort — main thumbnail still works.
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
    user: User = Depends(require_user),
) -> OverlayUploadResponse:
    """Upload an image/gif/audio used by a layer or audio_overlay of a
    specific template."""
    _get_owned_template(db, template_id, user)

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

    # If a video was uploaded as audio overlay, ffmpeg-extract its audio
    # track to .m4a and remove the video file. The pipeline then sees a
    # normal m4a overlay — same code path as a real audio upload.
    if ext in VIDEO_AUDIO_EXTS:
        from app.bin_finder import ffmpeg_env, ffmpeg_exe

        m4a_path = template_overlays_dir(template_id) / f"{file_id}.m4a"
        try:
            subprocess.run(
                [
                    ffmpeg_exe(), "-y",
                    "-i", str(dest),
                    "-vn",                 # drop video stream
                    "-c:a", "aac",         # re-encode to AAC (safe baseline)
                    "-b:a", "192k",
                    str(m4a_path),
                ],
                capture_output=True,
                check=True,
                timeout=120,
                env=ffmpeg_env(),
            )
        except subprocess.CalledProcessError as e:
            stderr = e.stderr.decode("utf-8", errors="replace") if e.stderr else ""
            dest.unlink(missing_ok=True)
            m4a_path.unlink(missing_ok=True)
            raise HTTPException(
                500,
                f"Audio extraction failed: {stderr[-200:] or 'unknown error'}",
            ) from e
        except subprocess.TimeoutExpired as e:
            dest.unlink(missing_ok=True)
            m4a_path.unlink(missing_ok=True)
            raise HTTPException(500, "Audio extraction timed out") from e

        # Replace the source video with the extracted m4a.
        dest.unlink(missing_ok=True)

    return OverlayUploadResponse(file_id=file_id)


# ---- "use clip audio as overlay" ------------------------------------

@router.post(
    "/{template_id}/clips/{clip_id}/use-as-overlay",
    response_model=TemplateRead,
)
def use_clip_audio_as_overlay(
    template_id: int,
    clip_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
) -> Template:
    """Extract the audio of one of the template's fixed clips and set it
    as the global audio overlay (Phase 25 feature B). Mutes the source
    clip automatically so we don't double-up during its playtime.

    Use case: user wants the timeline's audio bed to come from a real
    video clip while the visual is a placeholder for the first N seconds."""
    from app.bin_finder import ffmpeg_env, ffmpeg_exe

    template = _get_owned_template(db, template_id, user)

    clips = list(template.clips or [])
    target_idx: Optional[int] = None
    target_clip: Optional[dict] = None
    # Phase 28c — search the main track first, then extra tracks.
    extra_track_idx: Optional[int] = None
    extra_clip_idx: Optional[int] = None
    for i, c in enumerate(clips):
        if c.get("id") == clip_id:
            target_idx = i
            target_clip = dict(c)
            break

    extra_tracks_data = list(template.extra_tracks or [])
    if target_clip is None:
        for ti, track in enumerate(extra_tracks_data):
            tclips = track.get("clips") or []
            for ci, c in enumerate(tclips):
                if c.get("id") == clip_id:
                    extra_track_idx = ti
                    extra_clip_idx = ci
                    target_clip = dict(c)
                    break
            if target_clip is not None:
                break

    if target_clip is None:
        raise HTTPException(404, f"Clip {clip_id!r} not found in template")
    if target_clip.get("type") != "fixed":
        raise HTTPException(
            400,
            "Seuls les clips fixed peuvent fournir un audio overlay.",
        )
    file_id = target_clip.get("file_id")
    if not file_id:
        raise HTTPException(400, "Clip has no file_id")

    src_path = find_template_file(template_id, file_id, "clip")
    if src_path is None or not src_path.is_file():
        raise HTTPException(404, "Source clip file missing on disk")

    # Extract full audio of the source video to a fresh overlay m4a.
    new_file_id = uuid.uuid4().hex
    m4a_path = template_overlays_dir(template_id) / f"{new_file_id}.m4a"
    try:
        subprocess.run(
            [
                ffmpeg_exe(), "-y",
                "-i", str(src_path),
                "-vn",
                "-c:a", "aac",
                "-b:a", "192k",
                str(m4a_path),
            ],
            capture_output=True,
            check=True,
            timeout=180,
            env=ffmpeg_env(),
        )
    except subprocess.CalledProcessError as e:
        stderr = e.stderr.decode("utf-8", errors="replace") if e.stderr else ""
        m4a_path.unlink(missing_ok=True)
        raise HTTPException(
            500,
            f"Audio extraction failed: {stderr[-200:] or 'unknown error'}",
        ) from e
    except subprocess.TimeoutExpired as e:
        m4a_path.unlink(missing_ok=True)
        raise HTTPException(500, "Audio extraction timed out") from e

    if not m4a_path.is_file():
        raise HTTPException(500, "Audio extraction produced no file")

    # Update the template:
    # - audio_overlay → new m4a, reset volume/offset/trim to neutral
    # - source clip → audio_enabled=False (avoids doubling during its play range)
    # - if the source is on an extra track, also set video_enabled=False
    #   so the underlying tracks stay visible (full audio-only behaviour).
    target_clip["audio_enabled"] = False
    if extra_track_idx is not None:
        target_clip["video_enabled"] = False
        track = dict(extra_tracks_data[extra_track_idx])
        track_clips = list(track.get("clips") or [])
        track_clips[extra_clip_idx] = target_clip
        track["clips"] = track_clips
        extra_tracks_data[extra_track_idx] = track
        template.extra_tracks = extra_tracks_data
    else:
        clips[target_idx] = target_clip
        template.clips = clips
    template.audio_overlay = {
        "file_id": new_file_id,
        "volume": 1.0,
        "start_offset": 0.0,
        "trim_in": 0.0,
    }
    db.commit()
    db.refresh(template)
    return template


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


# ---- custom cover (templates page card image) ------------------------
#
# A "cover" is a single JPEG frame extracted from the template's preview
# MP4 at a user-chosen timestamp. The user picks the moment via a
# scrubber in the editor; the backend ffmpegs that frame and stores it
# under `template_dir/cover.jpg`. Click-to-play on the card still uses
# the preview MP4 — the cover is just the static thumbnail shown when
# paused.

@router.post(
    "/{template_id}/cover/from-time",
    response_model=CoverResponse,
    status_code=status.HTTP_201_CREATED,
)
def set_cover_from_time(
    template_id: int,
    payload: CoverFromTimeRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
) -> CoverResponse:
    """Extract a frame from the cached preview MP4 at `time_sec` and
    save it as the template's cover image. Requires a preview to exist
    (user has to click "Régénérer aperçu" first if there isn't one)."""
    from app.bin_finder import ffmpeg_env, ffmpeg_exe
    from app.storage import template_preview_path

    template = _get_owned_template(db, template_id, user)

    preview_path = template_preview_path(template_id)
    if not preview_path.is_file():
        raise HTTPException(
            400,
            "Aucun aperçu disponible. Génère d'abord un aperçu rendu.",
        )

    # Wipe any previous cover (we always write JPEG now, but a legacy
    # cover.png/.webp from earlier code path may still be there).
    prev = find_template_cover(template_id)
    if prev is not None:
        prev.unlink(missing_ok=True)

    cover_ext = "jpg"
    dest = template_cover_path(template_id, cover_ext)
    dest.parent.mkdir(parents=True, exist_ok=True)

    # Place `-ss` BEFORE `-i` for fast seek (uses keyframe index instead
    # of decoding from start). Negligible accuracy loss is fine for a
    # static thumbnail. `-frames:v 1` writes exactly one frame.
    cmd = [
        ffmpeg_exe(),
        "-y",
        "-ss", f"{payload.time_sec:.3f}",
        "-i", str(preview_path),
        "-frames:v", "1",
        "-q:v", "3",
        str(dest),
    ]
    try:
        subprocess.run(
            cmd,
            capture_output=True,
            check=True,
            timeout=30,
            env=ffmpeg_env(),
        )
    except subprocess.CalledProcessError as e:
        stderr = e.stderr.decode("utf-8", errors="replace") if e.stderr else ""
        raise HTTPException(
            500,
            f"Frame extraction failed: {stderr[-200:] or 'unknown error'}",
        ) from e
    except subprocess.TimeoutExpired as e:
        raise HTTPException(500, "Frame extraction timed out") from e

    if not dest.is_file():
        raise HTTPException(500, "Frame extraction produced no file")

    template.cover_ext = cover_ext
    template.cover_time_sec = float(payload.time_sec)
    db.commit()
    return CoverResponse(
        cover_ext=cover_ext,
        cover_time_sec=float(payload.time_sec),
    )


@router.delete(
    "/{template_id}/cover",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_cover(
    template_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
) -> None:
    """Drop the custom cover and revert to the auto-extracted thumbnail."""
    template = _get_owned_template(db, template_id, user)
    prev = find_template_cover(template_id)
    if prev is not None:
        prev.unlink(missing_ok=True)
    template.cover_ext = None
    template.cover_time_sec = None
    db.commit()
