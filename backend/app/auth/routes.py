from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel

from app.auth.dependencies import COOKIE_NAME, require_auth
from app.auth.security import create_access_token, verify_password
from app.config import settings

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    password: str


class LoginResponse(BaseModel):
    ok: bool


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest, response: Response) -> LoginResponse:
    if not verify_password(payload.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid password"
        )
    token = create_access_token()
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        secure=False,  # set True behind HTTPS in prod
        samesite="lax",
        max_age=settings.jwt_expire_hours * 3600,
        path="/",
    )
    return LoginResponse(ok=True)


@router.post("/logout", response_model=LoginResponse)
def logout(response: Response) -> LoginResponse:
    response.delete_cookie(key=COOKIE_NAME, path="/")
    return LoginResponse(ok=True)


@router.get("/me")
def me(_: dict = Depends(require_auth)) -> dict:
    return {"authenticated": True}
