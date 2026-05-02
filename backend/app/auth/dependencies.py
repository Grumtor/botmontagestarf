from fastapi import Cookie, HTTPException, status

from app.auth.security import decode_access_token

COOKIE_NAME = "auth_token"


def require_auth(auth_token: str | None = Cookie(default=None, alias=COOKIE_NAME)) -> dict:
    if not auth_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    try:
        payload = decode_access_token(auth_token)
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    if not payload.get("authenticated"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    return payload
