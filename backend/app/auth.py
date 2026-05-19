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
    """Legacy single-user verify against the env hash. Kept for the
    bootstrap-admin code path. Returns True only on exact match."""
    return verify_password_against(plain, settings.botmontage_password_hash or "")


def verify_password_against(plain: str, password_hash: str) -> bool:
    """Constant-time verify of `plain` against an arbitrary Argon2id
    `password_hash`. Returns True iff they match, False on any failure
    (no info leak)."""
    if not password_hash:
        return False
    try:
        return _HASHER.verify(password_hash, plain)
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


def create_session_token(user_id: int) -> str:
    """Create a signed token carrying the user_id. Signature via
    HMAC-SHA256 makes it tamper-proof : flipping any character
    invalidates the signature."""
    payload = {"v": 2, "uid": user_id, "iat": int(time.time())}
    return _serializer().dumps(payload)


def parse_session_token(token: str) -> Optional[int]:
    """Validate a signed token and return the user_id, or None on
    failure (bad sig, expired, malformed)."""
    try:
        payload = _serializer().loads(
            token,
            max_age=settings.botmontage_session_max_age,
        )
        if not isinstance(payload, dict):
            return None
        uid = payload.get("uid")
        if isinstance(uid, int):
            return uid
        return None
    except SignatureExpired:
        return None
    except BadSignature:
        return None
    except Exception as e:
        log.warning("session token parse failed: %s", type(e).__name__)
        return None


def verify_session_token(token: str) -> bool:
    """Back-compat alias. True iff the token decodes to a valid user_id."""
    return parse_session_token(token) is not None


# ----- FastAPI dependencies ------------------------------------------

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


def current_user_id(request: Request) -> Optional[int]:
    """Return the authenticated user_id, or None when auth is disabled
    (legacy open mode). When auth is enabled and no valid token is
    present, raises 401."""
    if not auth_enabled():
        return None
    token = request.cookies.get(COOKIE_NAME)
    uid = parse_session_token(token) if token else None
    if uid is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    return uid


# ----- rate limit for the login endpoint -----------------------------
#
# In-memory dict, per-IP. Resets on backend restart. Fine for a
# single-user single-server setup ; would need Redis if we ever scaled.

_RATE: dict[str, dict[str, float]] = {}
_RATE_WINDOW_SEC = 60       # window for the "X attempts per minute" cap
_RATE_MAX_PER_WINDOW = 5    # cap inside the window
_LOCKOUT_AFTER = 10         # total failures before long lockout
_LOCKOUT_DURATION = 15 * 60 # 15-minute lockout

# Per-username rate limit (in addition to per-IP). Blocks brute force on
# a specific account even when the attacker rotates through IPs (which
# is trivial behind any CDN / VPN). Independent counters & lockouts.
_USERNAME_RATE: dict[str, dict[str, float]] = {}
_USERNAME_RATE_MAX_PER_WINDOW = 5
_USERNAME_LOCKOUT_AFTER = 10
_USERNAME_LOCKOUT_DURATION = 15 * 60


def _now() -> float:
    return time.time()


def extract_client_ip(request: Request) -> str:
    """Extract the real client IP, taking proxy headers into account.

    Behind Cloudflare Tunnel, `request.client.host` is the tunnel's
    local socket, not the actual user. We honour CF-Connecting-IP
    first (CF-only, easy to spoof if the backend was direct-accessible
    but here it's only reachable via cloudflared so it's trusted) then
    X-Forwarded-For (standard reverse-proxy header), finally fall back
    to the socket address."""
    cf_ip = request.headers.get("cf-connecting-ip")
    if cf_ip:
        return cf_ip.strip()
    xff = request.headers.get("x-forwarded-for")
    if xff:
        # XFF can be a comma-separated chain ; the FIRST entry is the
        # original client (subsequent entries = intermediate proxies).
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _check_bucket(
    entry: dict[str, float],
    window_sec: float,
    max_per_window: int,
) -> Optional[float]:
    """Shared logic for both per-IP and per-username rate buckets."""
    if entry["locked_until"] > _now():
        return entry["locked_until"] - _now()
    if _now() - entry["window_start"] > window_sec:
        entry["window_start"] = _now()
        entry["window_count"] = 0
    if entry["window_count"] >= max_per_window:
        return window_sec - (_now() - entry["window_start"])
    return None


def rate_check(ip: str, username: Optional[str] = None) -> Optional[float]:
    """Return None if the request is allowed, or the seconds to wait
    if either the IP OR the username is rate-limited / locked out."""
    ip_entry = _RATE.setdefault(
        ip,
        {"attempts_total": 0, "window_start": 0, "window_count": 0, "locked_until": 0},
    )
    delay = _check_bucket(ip_entry, _RATE_WINDOW_SEC, _RATE_MAX_PER_WINDOW)
    if delay is not None:
        return delay

    if username:
        u_entry = _USERNAME_RATE.setdefault(
            username,
            {"attempts_total": 0, "window_start": 0, "window_count": 0, "locked_until": 0},
        )
        delay = _check_bucket(
            u_entry, _RATE_WINDOW_SEC, _USERNAME_RATE_MAX_PER_WINDOW
        )
        if delay is not None:
            return delay
    return None


def _record_in_bucket(
    entry: dict[str, float],
    *,
    success: bool,
    lockout_after: int,
    lockout_duration: float,
    label: str,
) -> None:
    if success:
        entry["attempts_total"] = 0
        entry["window_count"] = 0
        entry["locked_until"] = 0
        return
    entry["window_count"] += 1
    entry["attempts_total"] += 1
    if entry["attempts_total"] >= lockout_after:
        entry["locked_until"] = _now() + lockout_duration
        entry["attempts_total"] = 0
        log.warning(
            "%s locked out after %d failed login attempts",
            label, lockout_after,
        )


def rate_record_attempt(
    ip: str, *, success: bool, username: Optional[str] = None
) -> None:
    """Record an attempt (success resets the counters, failure
    increments). Both per-IP and per-username (if given) buckets are
    updated independently."""
    ip_entry = _RATE.setdefault(
        ip,
        {"attempts_total": 0, "window_start": 0, "window_count": 0, "locked_until": 0},
    )
    _record_in_bucket(
        ip_entry,
        success=success,
        lockout_after=_LOCKOUT_AFTER,
        lockout_duration=_LOCKOUT_DURATION,
        label=f"IP {ip}",
    )
    if username:
        u_entry = _USERNAME_RATE.setdefault(
            username,
            {"attempts_total": 0, "window_start": 0, "window_count": 0, "locked_until": 0},
        )
        _record_in_bucket(
            u_entry,
            success=success,
            lockout_after=_USERNAME_LOCKOUT_AFTER,
            lockout_duration=_USERNAME_LOCKOUT_DURATION,
            label=f"username {username!r}",
        )
