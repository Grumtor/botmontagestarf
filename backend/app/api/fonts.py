from pathlib import Path
from typing import Optional, Union

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.db.models import Asset, AssetType
from app.storage import (
    BUILTIN_FONTS_META,
    FONT_GROUP_LABELS,
    builtin_font_path,
)

router = APIRouter(prefix="/api/fonts", tags=["fonts"])


class FontMeta(BaseModel):
    id: Union[str, int]
    name: str
    builtin: bool
    # Phase 9: grouping for the picker (System / Instagram PWA / Instagram Reels).
    # User-uploaded fonts go into "user".
    group: str
    group_label: str
    # False when a built-in slot is declared but the TTF/OTF isn't on disk yet.
    # The picker greys those out and points the user to backend/fonts/.
    installed: bool = True


@router.get("", response_model=list[FontMeta])
def list_fonts(db: Session = Depends(get_db)) -> list[FontMeta]:
    items: list[FontMeta] = []
    for fid, meta in BUILTIN_FONTS_META.items():
        group = meta["group"]
        items.append(
            FontMeta(
                id=fid,
                name=meta["name"],
                builtin=True,
                group=group,
                group_label=FONT_GROUP_LABELS.get(group, group.title()),
                installed=builtin_font_path(fid) is not None,
            )
        )

    uploaded = (
        db.query(Asset)
        .filter(Asset.type == AssetType.font)
        .order_by(Asset.uploaded_at.desc())
        .all()
    )
    for a in uploaded:
        items.append(
            FontMeta(
                id=a.id,
                name=a.name or f"Font {a.id}",
                builtin=False,
                group="user",
                group_label="Polices uploadées",
                installed=Path(a.file_path).is_file(),
            )
        )
    return items


def _font_response(path: Path) -> FileResponse:
    """Serve a TTF/OTF/WOFF with the right MIME so browsers accept it as
    `@font-face`. FastAPI's default mimetype inference falls back to
    `text/plain` for these extensions, which Chrome/Firefox refuse to
    treat as a font (silently → fallback to system font, as if the picker
    did nothing)."""
    ext = path.suffix.lower()
    mime = {
        ".ttf": "font/ttf",
        ".otf": "font/otf",
        ".woff": "font/woff",
        ".woff2": "font/woff2",
    }.get(ext, "application/octet-stream")
    return FileResponse(
        path,
        media_type=mime,
        headers={
            # Static font file, fine to cache aggressively.
            "Cache-Control": "public, max-age=31536000, immutable",
            "Access-Control-Allow-Origin": "*",
        },
    )


@router.get("/{font_id}")
def get_font(font_id: str, db: Session = Depends(get_db)) -> FileResponse:
    if font_id in BUILTIN_FONTS_META:
        path = builtin_font_path(font_id)
        if path is None:
            raise HTTPException(status_code=404, detail="Built-in font missing on disk")
        return _font_response(path)

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

    return _font_response(p)
