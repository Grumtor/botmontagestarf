import enum
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    JSON,
    DateTime,
    Enum as SAEnum,
    Float,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class TemplateLanguage(str, enum.Enum):
    FR = "FR"
    US = "US"


class AssetType(str, enum.Enum):
    """Only `font` is used in the new model. Other values are kept for
    historical reasons (existing rows in the DB) but no new uploads accept
    anything other than `font`."""
    image = "image"
    gif = "gif"
    emoji = "emoji"
    font = "font"
    audio = "audio"


class JobStatus(str, enum.Enum):
    queued = "queued"
    running = "running"
    done = "done"
    failed = "failed"


class Template(Base):
    """A template = a single-track timeline of clips. Each clip is either:
      - "fixed": a video file uploaded with the template (intro, outro, branding)
      - "image": a still image looped for a fixed duration on the main track
      - "placeholder": a slot that gets filled by a user-supplied video at render time
    """

    __tablename__ = "templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    language: Mapped[TemplateLanguage] = mapped_column(
        SAEnum(TemplateLanguage, name="template_language"),
        default=TemplateLanguage.US,
        nullable=False,
    )
    # Ordered list of clips on the main video track (track 1 = bottom of
    # the visual stack, fills the timeline sequentially).
    clips: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    # Phase 26b — extra video tracks layered ON TOP of the main one.
    # Up to 4 extra tracks (so 5 total). Each extra track contains clips
    # with ABSOLUTE `start_time` (free positioning). Higher track index =
    # higher visual priority (covers the lower tracks during its time
    # range, plein écran). Empty list → legacy single-track behavior.
    # Shape: [{id, name, clips: [{id, type, file_id, start_time,
    # duration_sec, trim_in, trim_out, audio_enabled, audio_volume, ...}]}]
    extra_tracks: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    # Overlays on top of the video (text / image / gif / emoji).
    layers: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    # Optional second audio track (music).
    audio_overlay: Mapped[dict] = mapped_column(
        JSON,
        default=lambda: {"file_id": None, "volume": 1.0, "start_offset": 0, "trim_in": 0},
        nullable=False,
    )
    thumbnail_path: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    # Custom cover for the /templates grid card: frame extracted from the
    # preview MP4 at user-chosen `cover_time_sec`. `cover_ext` = "jpg"
    # when present (the file we wrote on disk), None otherwise. We keep
    # the time around so reopening the picker pre-positions the slider.
    cover_ext: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    cover_time_sec: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class Asset(Base):
    """Persistent, reusable assets. In the new model, only fonts are stored
    here (Inter and Montserrat are pre-installed; users can upload more).
    Per-template overlays/clips live in /data/templates/{id}/ instead."""

    __tablename__ = "assets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    type: Mapped[AssetType] = mapped_column(
        SAEnum(AssetType, name="asset_type"), nullable=False
    )
    file_path: Mapped[str] = mapped_column(String, nullable=False)
    name: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class VirtualAssistant(Base):
    """A "Virtual Assistant" is a persistent label + account count used to
    organise bulk exports. One VA has N accounts; at export time we
    duplicate every input file into N folders (one per account), each
    with independently spoofed metadata and a (random) iPhone model.

    Reused across photo exports and (eventually) reel exports.
    """

    __tablename__ = "virtual_assistants"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    account_count: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class RenderJob(Base):
    """One job spawns N renders. Each render = one template + a mapping
    of placeholder clip_id → uploaded video token."""

    __tablename__ = "render_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[JobStatus] = mapped_column(
        SAEnum(JobStatus, name="job_status"),
        default=JobStatus.queued,
        nullable=False,
    )
    # Each entry: { template_id, fills: {clip_id: token} }
    assignments: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    metadata_profile: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    output_zip_path: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    output_files: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    progress: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    finished_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
