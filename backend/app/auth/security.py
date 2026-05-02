from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from app.config import settings

# Hash the configured password ONCE at boot. This means we never keep the
# plaintext beyond startup and every login attempt does a constant-time
# bcrypt comparison.
_PASSWORD_HASH: bytes = bcrypt.hashpw(
    settings.backend_password.encode("utf-8"), bcrypt.gensalt()
)


def verify_password(plain_password: str) -> bool:
    return bcrypt.checkpw(plain_password.encode("utf-8"), _PASSWORD_HASH)


def create_access_token() -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "authenticated": True,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=settings.jwt_expire_hours)).timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict:
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
