from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.db.models import Template, TemplateLanguage

router = APIRouter(prefix="/api/templates", tags=["templates"])


# ---- schemas ------------------------------------------------------------

class TemplateBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    language: TemplateLanguage = TemplateLanguage.US
    duration_sec: float = Field(default=5.0, ge=1.0, le=90.0)
    description: Optional[str] = None


class TemplateCreate(TemplateBase):
    pass


class TemplateUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    language: Optional[TemplateLanguage] = None
    duration_sec: Optional[float] = Field(default=None, ge=1.0, le=90.0)
    description: Optional[str] = None
    layers: Optional[list] = None
    source_segments: Optional[list] = None
    audio_source: Optional[dict] = None
    audio_overlay: Optional[dict] = None


class TemplateRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: Optional[str]
    duration_sec: float
    language: TemplateLanguage
    layers: list
    source_segments: list
    audio_source: dict
    audio_overlay: dict
    thumbnail_path: Optional[str]
    created_at: datetime
    updated_at: datetime


def _default_segments(duration_sec: float) -> list:
    return [
        {
            "in_time": 0.0,
            "out_time": float(duration_sec),
            "transition_to_next": {"type": "cut", "duration": 0.3},
        }
    ]


def _default_audio_source() -> dict:
    return {"volume": 1.0, "enabled": True}


def _default_audio_overlay() -> dict:
    return {"asset_id": None, "volume": 1.0, "start_offset": 0.0, "trim_in": 0.0}


# ---- routes -------------------------------------------------------------

@router.post("", response_model=TemplateRead, status_code=status.HTTP_201_CREATED)
def create_template(payload: TemplateCreate, db: Session = Depends(get_db)) -> Template:
    template = Template(
        name=payload.name,
        language=payload.language,
        duration_sec=payload.duration_sec,
        description=payload.description,
        layers=[],
        source_segments=_default_segments(payload.duration_sec),
        audio_source=_default_audio_source(),
        audio_overlay=_default_audio_overlay(),
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
    query = db.query(Template)
    if language is not None:
        query = query.filter(Template.language == language)
    return query.order_by(Template.updated_at.desc()).all()


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
    db.delete(template)
    db.commit()


@router.post("/{template_id}/duplicate", response_model=TemplateRead, status_code=status.HTTP_201_CREATED)
def duplicate_template(template_id: int, db: Session = Depends(get_db)) -> Template:
    source = db.get(Template, template_id)
    if source is None:
        raise HTTPException(status_code=404, detail="Template not found")

    clone = Template(
        name=f"{source.name} (copy)",
        description=source.description,
        duration_sec=source.duration_sec,
        language=source.language,
        layers=list(source.layers) if source.layers else [],
        source_segments=(
            list(source.source_segments)
            if source.source_segments
            else _default_segments(source.duration_sec)
        ),
        audio_source=dict(source.audio_source) if source.audio_source else _default_audio_source(),
        audio_overlay=dict(source.audio_overlay) if source.audio_overlay else _default_audio_overlay(),
        thumbnail_path=source.thumbnail_path,
    )
    db.add(clone)
    db.commit()
    db.refresh(clone)
    return clone
