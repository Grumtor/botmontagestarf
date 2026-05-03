import enum
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    DateTime,
    Enum as SAEnum,
    Float,
    Integer,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
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


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    password_hash: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Template(Base):
    """A template = a single-track timeline of clips. Each clip is either:
      - "fixed": a video file uploaded with the template (intro, outro, branding)
      - "placeholder": a slot that gets filled by a user-supplied video at render time

    The total reel duration = sum of (fixed.trim_out - fixed.trim_in)
                            + sum of (user video durations) for placeholders.
    """

    __tablename__ = "templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    language: Mapped[TemplateLanguage] = mapped_column(
        SAEnum(TemplateLanguage, name="template_language", create_type=False),
        default=TemplateLanguage.US,
        server_default="US",
        nullable=False,
    )
    # Ordered list of clips on the main video track.
    clips: Mapped[list] = mapped_column(
        JSONB, default=list, server_default=text("'[]'::jsonb"), nullable=False
    )
    # Overlays on top of the video (text / image / gif / emoji).
    layers: Mapped[list] = mapped_column(
        JSONB, default=list, server_default=text("'[]'::jsonb"), nullable=False
    )
    # Optional second audio track (music).
    audio_overlay: Mapped[dict] = mapped_column(
        JSONB,
        default=dict,
        server_default=text(
            "'{\"file_id\": null, \"volume\": 1.0, \"start_offset\": 0, \"trim_in\": 0}'::jsonb"
        ),
        nullable=False,
    )
    thumbnail_path: Mapped[Optional[str]] = mapped_column(String, nullable=True)
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
        SAEnum(AssetType, name="asset_type", create_type=False), nullable=False
    )
    file_path: Mapped[str] = mapped_column(String, nullable=False)
    name: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class RenderJob(Base):
    """One job spawns N renders. Each render = one template + a mapping
    of placeholder clip_id → uploaded video token."""

    __tablename__ = "render_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[JobStatus] = mapped_column(
        SAEnum(JobStatus, name="job_status", create_type=False),
        default=JobStatus.queued,
        server_default="queued",
        nullable=False,
    )
    # Each entry: { template_id, fills: [{clip_id, token}] }
    assignments: Mapped[list] = mapped_column(
        JSONB, default=list, server_default=text("'[]'::jsonb"), nullable=False
    )
    metadata_profile: Mapped[dict] = mapped_column(
        JSONB, default=dict, server_default=text("'{}'::jsonb"), nullable=False
    )
    output_zip_path: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    output_files: Mapped[list] = mapped_column(
        JSONB, default=list, server_default=text("'[]'::jsonb"), nullable=False
    )
    progress: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    finished_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
