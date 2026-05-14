"""Login / logout / session endpoints (Phase 30).

POST /api/auth/login   { password } → 204 + Set-Cookie
POST /api/auth/logout  → 204 + Set-Cookie expiré
GET  /api/auth/me      → 200 if authed, 401 sinon
GET  /api/auth/status  → { auth_enabled: bool, authenticated: bool }
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from app.auth import (
    COOKIE_NAME,
    auth_enabled,
    create_session_token,
    rate_check,
    rate_record_attempt,
    verify_password,
    verify_session_token,
)
from app.config import settings

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginIn(BaseModel):
    password: str = Field(min_length=1, max_length=512)


def _set_session_cookie(response: Response, token: str) -> None:
    """Set the session cookie with secure flags. We use SameSite=Lax so
    cross-subdomain (bot.grumtor.com ↔ api.grumtor.com) navigations
    keep the cookie. Domain optional via env var for prod setups."""
    domain = settings.botmontage_session_cookie_domain or None
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=settings.botmontage_session_max_age,
        httponly=True,
        secure=True,
        samesite="lax",
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
) -> dict:
    """Verify password, set a signed session cookie on success.
    Returns 200 + {ok:true} on success ; 401 on bad password ;
    429 if rate-limited. All error responses are deliberately vague
    to not leak info."""
    if not auth_enabled():
        # Auth is off (legacy open mode). Login is a no-op : we still
        # set the cookie so the frontend's "logged in?" check works.
        token = create_session_token()
        _set_session_cookie(response, token)
        return {"ok": True, "auth_enabled": False}

    ip = request.client.host if request.client else "unknown"
    retry_after = rate_check(ip)
    if retry_after is not None:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Trop de tentatives. Réessaie dans {int(retry_after)}s.",
            headers={"Retry-After": str(int(retry_after))},
        )

    ok = verify_password(payload.password)
    rate_record_attempt(ip, success=ok)

    if not ok:
        # Same wording for "no such user" and "bad password" — but
        # we only have one user here, so this just means bad password.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Identifiants invalides",
        )

    token = create_session_token()
    _set_session_cookie(response, token)
    return {"ok": True}


@router.post("/logout")
def logout(response: Response) -> dict:
    """Clear the session cookie. The signed token isn't invalidated
    server-side (stateless) but the browser drops it. If you want
    real revocation, rotate BOTMONTAGE_SESSION_SECRET."""
    _clear_session_cookie(response)
    return {"ok": True}


@router.get(
    "/me",
    status_code=status.HTTP_200_OK,
)
def me(request: Request) -> dict:
    """Return 200 if authenticated, 401 otherwise. Tiny endpoint the
    frontend can hit on page load to check session validity."""
    if not auth_enabled():
        return {"authenticated": True, "auth_enabled": False}
    token = request.cookies.get(COOKIE_NAME)
    if not token or not verify_session_token(token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    return {"authenticated": True, "auth_enabled": True}


@router.get(
    "/status",
    status_code=status.HTTP_200_OK,
)
def status_endpoint(request: Request) -> dict:
    """Non-protected endpoint : tells the frontend whether auth is
    enabled at all + whether the current request is authenticated.
    Used by the login page to skip auth if disabled."""
    token = request.cookies.get(COOKIE_NAME)
    return {
        "auth_enabled": auth_enabled(),
        "authenticated": bool(
            token and verify_session_token(token)
        ),
    }
