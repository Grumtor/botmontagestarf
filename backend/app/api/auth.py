"""Login / logout / session endpoints (Phase 30 + Phase 33 multi-user).

POST /api/auth/login   { username, password } → 200 + Set-Cookie (user_id)
POST /api/auth/logout  → 200 + Set-Cookie expiré
GET  /api/auth/me      → 200 + user info if authed, 401 sinon
GET  /api/auth/status  → { auth_enabled: bool, authenticated: bool }
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import (
    COOKIE_NAME,
    auth_enabled,
    create_session_token,
    extract_client_ip,
    rate_check,
    rate_record_attempt,
    verify_password_against,
)
from app.config import settings
from app.db import get_db
from app.db.models import User, UserRole
from app.users import require_user

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=512)


class UserOut(BaseModel):
    """Public-safe view of a User (no password hash)."""
    id: int
    username: str
    role: str
    priority: str
    max_templates: int | None
    render_credits: int
    is_active: bool

    @classmethod
    def from_orm(cls, u: User) -> "UserOut":
        return cls(
            id=u.id,
            username=u.username,
            role=u.role.value,
            priority=u.priority.value,
            max_templates=u.max_templates,
            render_credits=u.render_credits,
            is_active=u.is_active,
        )


def _set_session_cookie(response: Response, token: str) -> None:
    """Set the session cookie with secure flags. SameSite=Lax so cross-
    subdomain navigations keep the cookie."""
    domain = settings.botmontage_session_cookie_domain or None
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=settings.botmontage_session_max_age,
        httponly=True,
        secure=True,
        # SameSite=Strict bloque la transmission du cookie sur TOUTE
        # requête cross-site (y compris navigation top-level depuis un
        # site externe). bot.grumtor.com et api.grumtor.com sont same-
        # site via la registrable domain — la communication entre les
        # 2 reste fonctionnelle.
        samesite="strict",
        path="/",
        domain=domain,
    )


def _clear_session_cookie(response: Response) -> None:
    domain = settings.botmontage_session_cookie_domain or None
    response.delete_cookie(
        key=COOKIE_NAME,
        path="/",
        domain=domain,
    )


@router.post("/login")
def login(
    payload: LoginIn,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> dict:
    """Verify username+password, set a signed session cookie carrying
    the user_id on success. Returns 200 + {ok:true, user:{...}}. 401
    on bad credentials ; 429 if rate-limited. All error responses are
    deliberately vague to not leak info (is-it-a-bad-username vs
    bad-password indistinguishable)."""
    # Use the REAL client IP (CF-Connecting-IP / X-Forwarded-For)
    # behind the Cloudflare Tunnel — otherwise everyone shares the
    # tunnel's local socket IP and is rate-limited together.
    ip = extract_client_ip(request)
    retry_after = rate_check(ip, username=payload.username)
    if retry_after is not None:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Trop de tentatives. Réessaie dans {int(retry_after)}s.",
            headers={"Retry-After": str(int(retry_after))},
        )

    # Lookup by username (case-sensitive). Empty result and bad-password
    # cases are both treated as a generic 401 to avoid leaking which
    # usernames exist.
    user: User | None = db.execute(
        select(User).where(User.username == payload.username)
    ).scalar_one_or_none()

    ok = (
        user is not None
        and user.is_active
        and verify_password_against(payload.password, user.password_hash)
    )
    rate_record_attempt(ip, success=ok, username=payload.username)

    if not ok or user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Identifiants invalides",
        )

    token = create_session_token(user.id)
    _set_session_cookie(response, token)
    return {"ok": True, "user": UserOut.from_orm(user).model_dump()}


@router.post("/logout")
def logout(response: Response) -> dict:
    """Clear the session cookie. The signed token isn't invalidated
    server-side (stateless) but the browser drops it."""
    _clear_session_cookie(response)
    return {"ok": True}


@router.get(
    "/me",
    status_code=status.HTTP_200_OK,
)
def me(user: User = Depends(require_user)) -> dict:
    """Return the currently-authed user's profile (no password hash)."""
    return {
        "authenticated": True,
        "auth_enabled": True,
        "user": UserOut.from_orm(user).model_dump(),
    }


@router.get(
    "/status",
    status_code=status.HTTP_200_OK,
)
def status_endpoint(request: Request, db: Session = Depends(get_db)) -> dict:
    """Non-protected endpoint : tells the frontend whether auth is
    enabled at all + whether the current request is authenticated.
    Used by the login page to skip auth if disabled."""
    from app.auth import parse_session_token
    token = request.cookies.get(COOKIE_NAME)
    uid = parse_session_token(token) if token else None
    is_authed = False
    if auth_enabled() and uid is not None:
        u = db.get(User, uid)
        is_authed = u is not None and u.is_active
    return {
        "auth_enabled": auth_enabled(),
        "authenticated": is_authed,
    }
