"""Font asset management. In the new clip-based model, fonts are the only
persistent library. All other "assets" (images, audio, gifs, emojis used in a
template) are uploaded per-template into /data/templates/{id}/."""

import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.db import get_db
from app.db.models import Asset, AssetType, User
from app.storage import ASSET_DIRS
from app.users import require_admin, require_user

router = APIRouter(prefix="/api/assets", tags=["assets"])

MAX_BYTES = 50 * 1024 * 1024  # 50 MB is plenty for a font file
CHUNK = 1024 * 1024
ALLOWED_FONT_EXTS = {".ttf", ".otf"}


class AssetRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    type: AssetType
    name: Optional[str]
    uploaded_at: datetime


@router.post("/upload", response_model=AssetRead, status_code=status.HTTP_201_CREATED)
async def upload_font(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> Asset:
    original = file.filename or "unknown"
    ext = Path(original).suffix.lower()
    if ext not in ALLOWED_FONT_EXTS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Only TTF/OTF fonts can be uploaded as persistent assets",
        )

    file_uuid = uuid.uuid4().hex
    dest_dir = ASSET_DIRS["font"]
    dest = dest_dir / f"{file_uuid}{ext}"

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

    rec = Asset(type=AssetType.font, file_path=str(dest), name=original)
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return rec


@router.get("", response_model=list[AssetRead])
def list_fonts(
    db: Session = Depends(get_db),
    _user: User = Depends(require_user),
) -> list[Asset]:
    return (
        db.query(Asset)
        .filter(Asset.type == AssetType.font)
        .order_by(Asset.uploaded_at.desc())
        .all()
    )


@router.delete("/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_font(
    asset_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> None:
    rec = db.get(Asset, asset_id)
    if rec is None or rec.type != AssetType.font:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Font not found")
    Path(rec.file_path).unlink(missing_ok=True)
    db.delete(rec)
    db.commit()
