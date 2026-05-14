"""Virtual Assistants (VAs) — persistent labels + account counts used to
structure bulk exports.

A VA = `{ id, name, account_count }`. At export time the user picks one,
and the backend duplicates every input asset into `account_count` folders
("Compte 1", "Compte 2", …), each with independently spoofed metadata.

Reused across photos and (later) reels — same VA list serves both.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import get_db
from app.db.models import VirtualAssistant

router = APIRouter(prefix="/api/vas", tags=["vas"])


class VARead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    account_count: int
    created_at: datetime
    updated_at: datetime


class VACreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    account_count: int = Field(default=1, ge=1, le=500)


class VAUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    account_count: int | None = Field(default=None, ge=1, le=500)


@router.get("", response_model=list[VARead])
def list_vas(db: Session = Depends(get_db)) -> list[VirtualAssistant]:
    return db.execute(
        select(VirtualAssistant).order_by(VirtualAssistant.created_at.asc())
    ).scalars().all()


@router.post("", response_model=VARead, status_code=status.HTTP_201_CREATED)
def create_va(payload: VACreate, db: Session = Depends(get_db)) -> VirtualAssistant:
    va = VirtualAssistant(name=payload.name, account_count=payload.account_count)
    db.add(va)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, f"VA name {payload.name!r} déjà utilisé")
    db.refresh(va)
    return va


@router.put("/{va_id}", response_model=VARead)
def update_va(
    va_id: int, payload: VAUpdate, db: Session = Depends(get_db)
) -> VirtualAssistant:
    va = db.get(VirtualAssistant, va_id)
    if va is None:
        raise HTTPException(404, "VA non trouvé")
    if payload.name is not None:
        va.name = payload.name
    if payload.account_count is not None:
        va.account_count = payload.account_count
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, f"VA name {payload.name!r} déjà utilisé")
    db.refresh(va)
    return va


@router.delete("/{va_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_va(va_id: int, db: Session = Depends(get_db)) -> None:
    va = db.get(VirtualAssistant, va_id)
    if va is None:
        raise HTTPException(404, "VA non trouvé")
    db.delete(va)
    db.commit()
