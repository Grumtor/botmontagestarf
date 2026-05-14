"""Single-user authentication for bot-montage (Phase 30).

Why so simple : it's a single-user setup, no signup, no email reset, no
"forgot my password". Just one password, hashed once, verified on
login. A signed cookie carries the session forever (until logout).

Security stack:
- Argon2id for password hashing (OWASP 2024 recommended, GPU/ASIC-hard)
- HMAC-SHA256 for session token signing via itsdangerous
- HttpOnly + Secure + SameSite=Lax cookie (immune to XSS theft + CSRF)
- In-memory rate limit on /api/auth/login (5/min/IP, 15-min lockout
  after 10 failed attempts)
- All non-auth endpoints reject 401 if cookie absent/invalid
"""
from __future__ import annotations

import logging
import time
from typing import Optional

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from fastapi import Cookie, HTTPException, Request, status
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from app.config import settings

log = logging.getLogger(__name__)

# OWASP 2024 Argon2id parameters: 64 MiB memory, 3 iterations, 4 lanes.
# These knobs make brute-force on consumer GPUs cost ~years per password.
_HASHER = PasswordHasher(
    time_cost=3,
    memory_cost=64 * 1024,
    parallelism=4,
)

COOKIE_NAME = "bm_session"


def auth_enabled() -> bool:
    """Auth is enabled only when BOTH a password hash AND a session
    secret are configured. Missing either → legacy open mode (every
    endpoint reachable without login). Useful for the initial local
    setup before the user has run set_password.py."""
    return bool(
        settings.botmontage_password_hash
        and settings.botmontage_session_secret
    )


def hash_password(plain: str) -> str:
    """Generate an Argon2id hash for the given plain-text password.
    Result starts with `$argon2id$...`. Store this in
    BOTMONTAGE_PASSWORD_HASH — NEVER the plain password."""
    return _HASHER.hash(plain)


def verify_password(plain: str) -> bool:
    """Constant-time verify against the configured hash. Returns
    True only on exact match; False on any failure (no info leak)."""
    h = settings.botmontage_password_hash
    if not h:
        return False
    try:
        return _HASHER.verify(h, plain)
    except (VerifyMismatchError, InvalidHashError, Exception) as e:
        # Don't log the password (obviously) — only the failure type.
        log.warning("password verify failed: %s", type(e).__name__)
        return False


# ----- session token (signed cookie payload) -------------------------

_SERIALIZER_SALT = "bm-session-v1"


def _serializer() -> URLSafeTimedSerializer:
    """Build the itsdangerous serializer from the configured secret.
    A rotation of the secret invalidates every existing session."""
    secret = settings.botmontage_session_secret or "dev-insecure-fallback"
    return URLSafeTimedSerializer(secret, salt=_SERIALIZER_SALT)


def create_session_token() -> str:
    """Create a signed token marking the holder as authenticated.
    Payload is minimal — no PII (it's single-user anyway). Signature
    via HMAC-SHA256 makes it tamper-proof : flipping any character
    invalidates the signature."""
    payload = {"v": 1, "iat": int(time.time())}
    return _serializer().dumps(payload)


def verify_session_token(token: str) -> bool:
    """Validate a signed token : signature OK + age within max_age.
    Returns True iff both pass."""
    try:
        _serializer().loads(
            token,
            max_age=settings.botmontage_session_max_age,
        )
        return True
    except SignatureExpired:
        return False
    except BadSignature:
        return False
    except Exception as e:
        log.warning("session token parse failed: %s", type(e).__name__)
        return False


# ----- FastAPI dependency --------------------------------------------

def require_auth(request: Request) -> None:
    """Use as `Depends(require_auth)` on any protected endpoint.
    Returns nothing on success, raises 401 otherwise. No-op when
    auth is disabled (no password configured)."""
    if not auth_enabled():
        return  # legacy open mode
    token = request.cookies.get(COOKIE_NAME)
    if not token or not verify_session_token(token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )


# ----- rate limit for the login endpoint -----------------------------
#
# In-memory dict, per-IP. Resets on backend restart. Fine for a
# single-user single-server setup ; would need Redis if we ever scaled.

_RATE: dict[str, dict[str, float]] = {}
_RATE_WINDOW_SEC = 60       # window for the "X attempts per minute" cap
_RATE_MAX_PER_WINDOW = 5    # cap inside the window
_LOCKOUT_AFTER = 10         # total failures before long lockout
_LOCKOUT_DURATION = 15 * 60 # 15-minute lockout


def _now() -> float:
    return time.time()


def rate_check(ip: str) -> Optional[float]:
    """Return None if the request is allowed, or the seconds to wait
    if the IP is rate-limited / locked out."""
    entry = _RATE.setdefault(ip, {"attempts_total": 0, "window_start": 0, "window_count": 0, "locked_until": 0})

    # Lockout state ?
    if entry["locked_until"] > _now():
        return entry["locked_until"] - _now()

    # Window state (reset if older than _RATE_WINDOW_SEC).
    if _now() - entry["window_start"] > _RATE_WINDOW_SEC:
        entry["window_start"] = _now()
        entry["window_count"] = 0

    if entry["window_count"] >= _RATE_MAX_PER_WINDOW:
        return _RATE_WINDOW_SEC - (_now() - entry["window_start"])

    return None


def rate_record_attempt(ip: str, *, success: bool) -> None:
    """Record an attempt (success resets the counters, failure
    increments and may trigger lockout)."""
    entry = _RATE.setdefault(ip, {"attempts_total": 0, "window_start": 0, "window_count": 0, "locked_until": 0})
    if success:
        entry["attempts_total"] = 0
        entry["window_count"] = 0
        entry["locked_until"] = 0
        return
    entry["window_count"] += 1
    entry["attempts_total"] += 1
    if entry["attempts_total"] >= _LOCKOUT_AFTER:
        entry["locked_until"] = _now() + _LOCKOUT_DURATION
        entry["attempts_total"] = 0
        log.warning("IP %s locked out after %d failed login attempts", ip, _LOCKOUT_AFTER)
