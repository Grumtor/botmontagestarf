from pathlib import Path
from typing import Union

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.db.models import Asset, AssetType
from app.storage import BUILTIN_FONTS_META, builtin_font_path

router = APIRouter(prefix="/api/fonts", tags=["fonts"])


class FontMeta(BaseModel):
    id: Union[str, int]
    name: str
    builtin: bool


@router.get("", response_model=list[FontMeta])
def list_fonts(db: Session = Depends(get_db)) -> list[FontMeta]:
    items: list[FontMeta] = [
        FontMeta(id=fid, name=fname, builtin=True)
        for fid, fname in BUILTIN_FONTS_META.items()
    ]
    uploaded = (
        db.query(Asset)
        .filter(Asset.type == AssetType.font)
        .order_by(Asset.uploaded_at.desc())
        .all()
    )
    items.extend(
        FontMeta(id=a.id, name=a.name or f"Font {a.id}", builtin=False) for a in uploaded
    )
    return items


@router.get("/{font_id}")
def get_font(font_id: str, db: Session = Depends(get_db)) -> FileResponse:
    if font_id in BUILTIN_FONTS_META:
        path = builtin_font_path(font_id)
        if path is None:
            raise HTTPException(status_code=404, detail="Built-in font missing on disk")
        return FileResponse(path)

    try:
        numeric = int(font_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Unknown font")

    asset = db.get(Asset, numeric)
    if asset is None or asset.type != AssetType.font:
        raise HTTPException(status_code=404, detail="Font not found")

    p = Path(asset.file_path)
    if not p.is_file():
        raise HTTPException(status_code=404, detail="Font file missing on disk")

    return FileResponse(p)
