import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.db import get_db
from app.db.models import Asset, AssetType
from app.storage import ASSET_DIRS

router = APIRouter(prefix="/api/assets", tags=["assets"])

MAX_BYTES = 500 * 1024 * 1024
CHUNK = 1024 * 1024

ALLOWED_EXTS_BY_TYPE: dict[AssetType, set[str]] = {
    AssetType.image: {".png", ".jpg", ".jpeg"},
    AssetType.gif: {".gif"},
    AssetType.emoji: {".png", ".jpg", ".jpeg"},
    AssetType.font: {".ttf", ".otf"},
    AssetType.audio: {".mp3", ".wav", ".m4a"},
}


class AssetRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    type: AssetType
    name: Optional[str]
    uploaded_at: datetime


@router.post("/upload", response_model=AssetRead, status_code=status.HTTP_201_CREATED)
async def upload_asset(
    type: AssetType = Query(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> Asset:
    original = file.filename or "unknown"
    ext = Path(original).suffix.lower()
    allowed = ALLOWED_EXTS_BY_TYPE[type]
    if ext not in allowed:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Unsupported extension {ext!r} for type {type.value!r}; allowed: {', '.join(sorted(allowed))}",
        )

    file_uuid = uuid.uuid4().hex
    dest_dir = ASSET_DIRS[type.value]
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
    except Exception:
        dest.unlink(missing_ok=True)
        raise

    rec = Asset(type=type, file_path=str(dest), name=original)
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return rec


@router.get("", response_model=list[AssetRead])
def list_assets(
    type: Optional[AssetType] = Query(default=None),
    db: Session = Depends(get_db),
) -> list[Asset]:
    q = db.query(Asset)
    if type is not None:
        q = q.filter(Asset.type == type)
    return q.order_by(Asset.uploaded_at.desc()).all()


@router.delete("/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_asset(asset_id: int, db: Session = Depends(get_db)) -> None:
    rec = db.get(Asset, asset_id)
    if rec is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Asset not found")

    Path(rec.file_path).unlink(missing_ok=True)
    db.delete(rec)
    db.commit()
