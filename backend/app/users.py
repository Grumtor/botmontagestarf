"""Multi-tenant user helpers (Phase 33).

FastAPI dependencies that resolve the authenticated user from the
session cookie and load the matching row from the DB. Routers use
these instead of the lower-level `require_auth` / `current_user_id`
when they need the actual User instance (for ownership filtering,
role checks, credit decrement, etc.).
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.auth import auth_enabled, current_user_id
from app.db import get_db
from app.db.models import User, UserRole

log = logging.getLogger(__name__)


def get_current_user(
    request: Request,
    db: Session = Depends(get_db),
) -> Optional[User]:
    """Return the authenticated User row. None when auth is disabled
    (legacy open mode). Raises 401 if the cookie is missing/invalid,
    403 if the user has been deactivated.

    NOTE: when auth is disabled this returns None — routers should
    handle that explicitly (probably by skipping ownership filters in
    that legacy mode). Once we have a bootstrapped admin, auth is
    always enabled in practice.
    """
    if not auth_enabled():
        return None
    uid = current_user_id(request)
    if uid is None:
        # Should not happen — current_user_id raises 401 when auth is on.
        return None
    user = db.get(User, uid)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session invalide (user inconnu)",
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Compte désactivé",
        )
    return user


def require_user(
    user: Optional[User] = Depends(get_current_user),
) -> User:
    """Like get_current_user, but raises 401 when auth is disabled too.
    Use on endpoints that absolutely need a user record (ownership
    queries, credit decrement, etc.)."""
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentification requise",
        )
    return user


def require_admin(
    user: User = Depends(require_user),
) -> User:
    """Use on admin-only endpoints (/api/admin/*). Raises 403 if the
    authenticated user is not an admin."""
    if user.role != UserRole.admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Réservé aux administrateurs",
        )
    return user
