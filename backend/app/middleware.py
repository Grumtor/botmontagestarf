from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.auth.dependencies import COOKIE_NAME
from app.auth.security import decode_access_token

# Routes under /api/* that don't require auth.
_PUBLIC_API_PREFIXES = ("/api/auth/",)
_PUBLIC_API_PATHS = {"/api/health"}


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        # Only enforce auth on /api/* routes. Non-API routes (docs, static)
        # are not protected here — the Next.js middleware gates the UI.
        if not path.startswith("/api/"):
            return await call_next(request)

        if path in _PUBLIC_API_PATHS or any(path.startswith(p) for p in _PUBLIC_API_PREFIXES):
            return await call_next(request)

        token = request.cookies.get(COOKIE_NAME)
        if not token:
            return JSONResponse({"detail": "Not authenticated"}, status_code=401)

        try:
            payload = decode_access_token(token)
        except Exception:
            return JSONResponse({"detail": "Invalid token"}, status_code=401)

        if not payload.get("authenticated"):
            return JSONResponse({"detail": "Invalid token"}, status_code=401)

        return await call_next(request)
