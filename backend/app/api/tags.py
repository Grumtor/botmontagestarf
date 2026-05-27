"""Tag library CRUD — Phase 37.

The user manages their own tag library here :
  GET    /api/tags             → list all tags (sorted alpha)
  POST   /api/tags             → create one
  PATCH  /api/tags/{id}        → rename (cascades to all templates that
                                  have the old name)
  DELETE /api/tags/{id}        → delete (cascades : removes the name
                                  from every template that had it)

Template.tags stays a free-form list[str] of names (no FK). The library
table is the source of truth for which tags EXIST per user ; templates
just reference them by name. This keeps reads cheap (no JOIN per
template card) and write semantics simple (a rename = one UPDATE on
the library + one bulk UPDATE on templates).
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import get_db
from app.db.models import Tag, Template, User
from app.users import require_user

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tags", tags=["tags"])


# ---- schemas ---------------------------------------------------------

class TagRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    # Number of templates currently using this tag — useful for the UI
    # to show "Sport (3 templates)" + warn before delete.
    usage_count: int = 0


class TagCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)


class TagUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=60)


# ---- helpers ---------------------------------------------------------

def _normalize(name: str) -> str:
    """Trim + collapse internal whitespace. Don't lowercase — keep
    the user's casing. Dedupe at higher level is case-insensitive."""
    return " ".join(name.strip().split())


def _count_usage_for_tags(db: Session, owner_id: int) -> dict[str, int]:
    """Count how many of the user's templates carry each tag name.
    Returns a dict {tag_name_lowercase: count}. Cheap : one SELECT
    of the templates' `tags` arrays."""
    rows = (
        db.query(Template.tags)
        .filter(Template.owner_id == owner_id)
        .all()
    )
    counts: dict[str, int] = {}
    for (tags,) in rows:
        if not isinstance(tags, list):
            continue
        seen_in_this_template: set[str] = set()
        for t in tags:
            if not isinstance(t, str):
                continue
            key = t.lower()
            if key in seen_in_this_template:
                continue
            seen_in_this_template.add(key)
            counts[key] = counts.get(key, 0) + 1
    return counts


# ---- routes ----------------------------------------------------------

@router.get("", response_model=list[TagRead])
def list_tags(
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
) -> list[TagRead]:
    """List the user's tags, sorted alpha (case-insensitive), with usage
    counts so the UI can show "Sport (3 templates)"."""
    rows = (
        db.query(Tag)
        .filter(Tag.owner_id == user.id)
        .order_by(Tag.name.collate("NOCASE") if False else Tag.name)
        .all()
    )
    counts = _count_usage_for_tags(db, user.id)
    out = [
        TagRead(
            id=t.id,
            name=t.name,
            usage_count=counts.get(t.name.lower(), 0),
        )
        for t in rows
    ]
    # Python sort here so we don't depend on DB collation quirks.
    out.sort(key=lambda r: r.name.lower())
    return out


@router.post("", response_model=TagRead, status_code=status.HTTP_201_CREATED)
def create_tag(
    payload: TagCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
) -> TagRead:
    name = _normalize(payload.name)
    if not name:
        raise HTTPException(400, "Nom de tag vide")

    # Case-insensitive existence check.
    existing = (
        db.query(Tag)
        .filter(Tag.owner_id == user.id)
        .all()
    )
    for t in existing:
        if t.name.lower() == name.lower():
            raise HTTPException(409, f"Le tag « {t.name} » existe déjà")

    tag = Tag(owner_id=user.id, name=name)
    db.add(tag)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, f"Le tag « {name} » existe déjà")
    db.refresh(tag)
    return TagRead(id=tag.id, name=tag.name, usage_count=0)


@router.patch("/{tag_id}", response_model=TagRead)
def rename_tag(
    tag_id: int,
    payload: TagUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
) -> TagRead:
    """Rename a tag. Propagates to every template that currently uses
    the old name : we walk the user's templates and replace the old
    string with the new one in their `tags` array. JSON arrays don't
    support a bulk SQL UPDATE on SQLite, so we do it row-by-row in
    Python — fast enough for realistic tag counts."""
    new_name = _normalize(payload.name)
    if not new_name:
        raise HTTPException(400, "Nom de tag vide")

    tag = db.get(Tag, tag_id)
    if tag is None or tag.owner_id != user.id:
        raise HTTPException(404, "Tag non trouvé")

    if tag.name == new_name:
        # No-op rename — just return current state with usage count.
        counts = _count_usage_for_tags(db, user.id)
        return TagRead(
            id=tag.id, name=tag.name, usage_count=counts.get(tag.name.lower(), 0)
        )

    # Block rename to a name that already exists (case-insensitive).
    for t in db.query(Tag).filter(Tag.owner_id == user.id).all():
        if t.id != tag.id and t.name.lower() == new_name.lower():
            raise HTTPException(409, f"Le tag « {t.name} » existe déjà")

    old_name = tag.name
    tag.name = new_name

    # Propagate to templates : replace old_name → new_name in each
    # template's tags array (case-insensitive match on old).
    templates = (
        db.query(Template).filter(Template.owner_id == user.id).all()
    )
    old_lower = old_name.lower()
    for tpl in templates:
        tags = list(tpl.tags or [])
        changed = False
        new_tags: list[str] = []
        seen_lower: set[str] = set()
        for entry in tags:
            if not isinstance(entry, str):
                new_tags.append(entry)
                continue
            if entry.lower() == old_lower:
                # Replace with new name (skip if would dupe).
                if new_name.lower() in seen_lower:
                    changed = True  # we dropped a now-duplicate entry
                    continue
                new_tags.append(new_name)
                seen_lower.add(new_name.lower())
                changed = True
            else:
                if entry.lower() in seen_lower:
                    continue
                new_tags.append(entry)
                seen_lower.add(entry.lower())
        if changed:
            tpl.tags = new_tags

    db.commit()
    db.refresh(tag)

    counts = _count_usage_for_tags(db, user.id)
    return TagRead(
        id=tag.id, name=tag.name, usage_count=counts.get(tag.name.lower(), 0)
    )


@router.delete("/{tag_id}")
def delete_tag(
    tag_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
) -> dict:
    """Delete the tag from the library AND remove it from every template
    that had it. Idempotent : ok if no template uses it. Returns the
    number of templates that were touched so the UI can show
    "Removed from 3 templates"."""
    tag = db.get(Tag, tag_id)
    if tag is None or tag.owner_id != user.id:
        raise HTTPException(404, "Tag non trouvé")

    old_lower = tag.name.lower()
    templates = (
        db.query(Template).filter(Template.owner_id == user.id).all()
    )
    n_touched = 0
    for tpl in templates:
        tags = list(tpl.tags or [])
        new_tags = [
            entry for entry in tags
            if not (isinstance(entry, str) and entry.lower() == old_lower)
        ]
        if len(new_tags) != len(tags):
            tpl.tags = new_tags
            n_touched += 1

    db.delete(tag)
    db.commit()
    return {"ok": True, "templates_touched": n_touched}
