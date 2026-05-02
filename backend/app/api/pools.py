from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.db.models import Template, TextPool

router = APIRouter(prefix="/api/templates", tags=["pools"])


class PoolUpdate(BaseModel):
    items: list[str]


@router.get("/{template_id}/pools", response_model=dict[str, list[str]])
def list_pools(template_id: int, db: Session = Depends(get_db)) -> dict[str, list[str]]:
    if db.get(Template, template_id) is None:
        raise HTTPException(status_code=404, detail="Template not found")
    pools = db.query(TextPool).filter(TextPool.template_id == template_id).all()
    return {p.layer_id: list(p.items or []) for p in pools}


@router.put(
    "/{template_id}/pools/{layer_id}",
    response_model=dict[str, list[str]],
)
def upsert_pool(
    template_id: int,
    layer_id: str,
    payload: PoolUpdate,
    db: Session = Depends(get_db),
) -> dict[str, list[str]]:
    if db.get(Template, template_id) is None:
        raise HTTPException(status_code=404, detail="Template not found")

    pool = (
        db.query(TextPool)
        .filter_by(template_id=template_id, layer_id=layer_id)
        .first()
    )
    if pool is None:
        pool = TextPool(
            template_id=template_id, layer_id=layer_id, items=payload.items
        )
        db.add(pool)
    else:
        pool.items = payload.items
    db.commit()
    return {layer_id: payload.items}
