"""Admin-only endpoints for user management (Phase 33 — Phase 2 SaaS).

All routes require the caller to be authenticated AND have role=admin.
Anything that fails authz returns 403.

Endpoints :
  GET    /api/admin/users           → list all users
  POST   /api/admin/users           → create a new user
  GET    /api/admin/users/{id}      → get one user
  PATCH  /api/admin/users/{id}      → update fields (role, priority,
                                       max_templates, render_credits,
                                       is_active, username)
  POST   /api/admin/users/{id}/password → reset password
  POST   /api/admin/users/{id}/credits  → top-up render_credits (additive)
  DELETE /api/admin/users/{id}      → hard delete (cascades to templates/
                                       render_jobs + wipes their files)
"""
from __future__ import annotations

import logging
import shutil
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import hash_password
from app.bin_finder import ffprobe_exe
from app.db import get_db
from app.db.models import RenderJob, Template, User, UserPriority, UserRole
from app.storage import RENDERS_DIR, template_dir
from app.users import require_admin

import json
import subprocess
from pathlib import Path

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin", tags=["admin"])


# ---- shared schemas --------------------------------------------------

class UserSummary(BaseModel):
    """Public-safe view of a user — no password hash."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    role: UserRole
    priority: UserPriority
    max_templates: Optional[int]
    # Phase 39 — Float depuis Phase 38 (0.5 crédit/spoof). Avant : int
    # qui tronquait silencieusement les .5 → admin voyait "12 crédits"
    # alors que la DB en avait 12.5.
    render_credits: float
    is_active: bool
    # extra computed counts for the admin table view
    template_count: int = 0
    job_count: int = 0


class UserCreate(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=4, max_length=512)
    role: UserRole = UserRole.user
    priority: UserPriority = UserPriority.normal
    # null = unlimited. Default 5 for new regular users.
    max_templates: Optional[int] = Field(default=5, ge=0)
    render_credits: float = Field(default=50.0, ge=0)


class UserUpdate(BaseModel):
    """All fields optional — only provided ones get patched. Password is
    a separate endpoint (POST .../password) to avoid leaking it in
    audit logs that might persist body payloads."""
    username: Optional[str] = Field(default=None, min_length=1, max_length=64)
    role: Optional[UserRole] = None
    priority: Optional[UserPriority] = None
    max_templates: Optional[int] = Field(default=None, ge=0)
    render_credits: Optional[float] = Field(default=None, ge=0)
    is_active: Optional[bool] = None


class PasswordReset(BaseModel):
    password: str = Field(min_length=4, max_length=512)


class CreditsTopUp(BaseModel):
    amount: int = Field(gt=0, le=1_000_000)


# ---- helpers ---------------------------------------------------------

def _summarize(db: Session, u: User) -> UserSummary:
    """Build a UserSummary with the computed counts. Single small query
    per user — fine for the typical 10-50 users this app will have."""
    from sqlalchemy import func as sa_func
    t_count = db.scalar(
        select(sa_func.count()).select_from(Template)
        .where(Template.owner_id == u.id)
    ) or 0
    j_count = db.scalar(
        select(sa_func.count()).select_from(RenderJob)
        .where(RenderJob.owner_id == u.id)
    ) or 0
    return UserSummary(
        id=u.id,
        username=u.username,
        role=u.role,
        priority=u.priority,
        max_templates=u.max_templates,
        render_credits=u.render_credits,
        is_active=u.is_active,
        template_count=int(t_count),
        job_count=int(j_count),
    )


def _purge_user_files(db: Session, user_id: int) -> None:
    """Wipe templates / renders folders for every row owned by user_id.
    Must be called BEFORE the cascade DELETE so we still see the IDs.
    Best-effort : log + continue on errors so the DB cleanup still runs."""
    template_ids = db.scalars(
        select(Template.id).where(Template.owner_id == user_id)
    ).all()
    for tid in template_ids:
        try:
            shutil.rmtree(template_dir(tid), ignore_errors=True)
        except Exception as e:
            log.warning("purge template %s files failed: %s", tid, e)

    job_ids = db.scalars(
        select(RenderJob.id).where(RenderJob.owner_id == user_id)
    ).all()
    for jid in job_ids:
        # Each job has both a directory of outputs and the ZIP next to it.
        d = RENDERS_DIR / str(jid)
        zip_path = RENDERS_DIR / f"{jid}.zip"
        try:
            shutil.rmtree(d, ignore_errors=True)
            zip_path.unlink(missing_ok=True)
        except Exception as e:
            log.warning("purge job %s files failed: %s", jid, e)


# ---- routes ----------------------------------------------------------

@router.get("/users", response_model=list[UserSummary])
def list_users(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> list[UserSummary]:
    users = db.scalars(select(User).order_by(User.created_at.asc())).all()
    return [_summarize(db, u) for u in users]


@router.post(
    "/users",
    response_model=UserSummary,
    status_code=status.HTTP_201_CREATED,
)
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> UserSummary:
    # Admin role implicitly = unlimited templates + huge credits (we
    # ignore the form values and force the defaults).
    is_admin = payload.role == UserRole.admin
    user = User(
        username=payload.username,
        password_hash=hash_password(payload.password),
        role=payload.role,
        priority=payload.priority,
        max_templates=None if is_admin else payload.max_templates,
        render_credits=10**9 if is_admin else payload.render_credits,
        is_active=True,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, f"Username {payload.username!r} déjà utilisé")
    db.refresh(user)

    # Phase 37 — seed le nouvel user avec les 2 tags par défaut "FR"
    # et "US" dans sa library. Évite que sa page /tags soit vide à
    # la 1ère connexion. Il peut les renommer / supprimer librement.
    from app.db.models import Tag as _Tag
    for name in ("FR", "US"):
        db.add(_Tag(owner_id=user.id, name=name))
    try:
        db.commit()
    except Exception:
        log.exception("Failed to seed default tags for new user %s", user.id)
        db.rollback()

    return _summarize(db, user)


@router.get("/users/{user_id}", response_model=UserSummary)
def get_user(
    user_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> UserSummary:
    u = db.get(User, user_id)
    if u is None:
        raise HTTPException(404, "User non trouvé")
    return _summarize(db, u)


@router.patch("/users/{user_id}", response_model=UserSummary)
def update_user(
    user_id: int,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> UserSummary:
    u = db.get(User, user_id)
    if u is None:
        raise HTTPException(404, "User non trouvé")

    # Don't let the admin deactivate / demote themselves by accident — that
    # would lock them out of the admin page on next refresh.
    if u.id == admin.id:
        if payload.is_active is False:
            raise HTTPException(
                400, "Tu ne peux pas désactiver ton propre compte."
            )
        if payload.role is not None and payload.role != UserRole.admin:
            raise HTTPException(
                400, "Tu ne peux pas retirer ton propre role admin."
            )

    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(u, key, value)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Username déjà utilisé")
    db.refresh(u)
    return _summarize(db, u)


@router.post("/users/{user_id}/password")
def reset_password(
    user_id: int,
    payload: PasswordReset,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> dict:
    # FastAPI 0.115 rejette `status_code=204` + un corps de réponse
    # (même implicite). On retourne 200 + {"ok": true}.
    u = db.get(User, user_id)
    if u is None:
        raise HTTPException(404, "User non trouvé")
    u.password_hash = hash_password(payload.password)
    db.commit()
    return {"ok": True}


@router.post(
    "/users/{user_id}/credits",
    response_model=UserSummary,
)
def top_up_credits(
    user_id: int,
    payload: CreditsTopUp,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> UserSummary:
    """Additive top-up. Use PATCH /users/{id} body {render_credits: N}
    if you want to SET the exact value instead."""
    u = db.get(User, user_id)
    if u is None:
        raise HTTPException(404, "User non trouvé")
    u.render_credits = (u.render_credits or 0) + payload.amount
    db.commit()
    db.refresh(u)
    return _summarize(db, u)


@router.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    """Hard delete : DROP the user row + cascade-delete his templates,
    jobs, AND wipe his files on disk."""
    # FastAPI 0.115 + status 204 = pas de body autorisé. On retourne
    # 200 + {"ok": true} comme partout ailleurs.
    if user_id == admin.id:
        raise HTTPException(
            400, "Tu ne peux pas supprimer ton propre compte."
        )
    u = db.get(User, user_id)
    if u is None:
        raise HTTPException(404, "User non trouvé")

    # Wipe files BEFORE the DB cascade so we still know the IDs.
    _purge_user_files(db, user_id)
    db.delete(u)
    db.commit()
    return {"ok": True}


# ---- debug / diagnostic ------------------------------------------------

@router.get("/debug/probe/{job_id}")
def debug_probe_job_outputs(
    job_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> dict:
    """Run ffprobe on every output file of a render job and return the
    full per-stream JSON.

    Used to diagnose audio/video container issues that show different
    behaviour across players (e.g. son OK desktop / muet iOS Photos
    despite la barre de niveau qui bouge → typiquement channel_layout
    weird, track flags exotiques, ou samples décodés mais inroutables
    par le hardware decoder).

    Returns one entry per output file with:
      - path : absolute path on disk
      - size_bytes
      - format : container-level info (duration, bitrate, tags)
      - streams : list of {codec_type, codec_name, profile, sample_rate,
                  channels, channel_layout, bit_rate, duration,
                  disposition (default/forced/etc.), tags...}
      - error : if ffprobe failed
    """
    job = db.get(RenderJob, job_id)
    if job is None:
        raise HTTPException(404, "Job non trouvé")

    files = list(job.output_files or [])
    if not files:
        return {
            "job_id": job_id,
            "status": job.status,
            "message": "No output files yet",
            "items": [],
        }

    probe = ffprobe_exe()
    items: list[dict] = []
    for f in files:
        path = Path(f)
        if not path.is_absolute():
            path = RENDERS_DIR / path
        entry: dict = {
            "path": str(path),
            "exists": path.is_file(),
        }
        if not path.is_file():
            items.append(entry)
            continue
        try:
            entry["size_bytes"] = path.stat().st_size
        except OSError:
            entry["size_bytes"] = None
        try:
            result = subprocess.run(
                [
                    probe,
                    "-v", "error",
                    "-show_format",
                    "-show_streams",
                    "-print_format", "json",
                    str(path),
                ],
                capture_output=True,
                text=True,
                timeout=15,
                check=False,
            )
            if result.returncode != 0:
                entry["error"] = f"ffprobe rc={result.returncode}: {result.stderr[:500]}"
            else:
                try:
                    entry["probe"] = json.loads(result.stdout)
                except json.JSONDecodeError as e:
                    entry["error"] = f"invalid JSON from ffprobe: {e}"
        except FileNotFoundError:
            entry["error"] = "ffprobe binary not found on server"
        except subprocess.TimeoutExpired:
            entry["error"] = "ffprobe timed out (>15s)"
        items.append(entry)

    return {
        "job_id": job_id,
        "status": job.status,
        "count": len(items),
        "items": items,
    }


@router.get("/debug/template-text/{template_id}")
def debug_template_text_layers(
    template_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> dict:
    """Dump tous les text layers d'un template avec leur precomputed_lines
    et les params clés (font, font_size_pct, max_width_pct, width_pct).

    Permet de vérifier si le frontend envoie bien les lignes pré-wrappées
    au backend, et ce que le backend va effectivement dessiner."""
    tpl = db.get(Template, template_id)
    if tpl is None:
        raise HTTPException(404, "Template non trouvé")

    out: list[dict] = []
    layers = tpl.layers if isinstance(tpl.layers, list) else []
    for layer in layers:
        if not isinstance(layer, dict):
            continue
        if layer.get("type") != "text":
            continue
        data = layer.get("data") or {}
        entry = {
            "layer_id": layer.get("id"),
            "text": data.get("text"),
            "font_id": data.get("font_id"),
            "font_size_pct": data.get("font_size_pct"),
            "max_width_pct": data.get("max_width_pct"),
            "width_pct": layer.get("width_pct"),
            "height_pct": layer.get("height_pct"),
            "bold": data.get("bold"),
            "italic": data.get("italic"),
            "letter_spacing": data.get("letter_spacing"),
            "precomputed_lines": data.get("precomputed_lines"),
            "precomputed_lines_present": isinstance(
                data.get("precomputed_lines"), list
            ) and len(data.get("precomputed_lines") or []) > 0,
        }
        out.append(entry)

    return {
        "template_id": template_id,
        "template_name": tpl.name,
        "text_layer_count": len(out),
        "layers": out,
    }
