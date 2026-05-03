import logging
from contextlib import asynccontextmanager
from pathlib import Path

from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.assets import router as assets_router
from app.api.files import router as files_router
from app.api.fonts import router as fonts_router
from app.api.jobs import router as jobs_router
from app.api.render import router as render_router
from app.api.templates import router as templates_router
from app.auth.routes import router as auth_router
from app.config import settings
from app.middleware import AuthMiddleware
from app.storage import ensure_dirs, install_builtin_fonts

log = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).resolve().parent.parent


def _run_migrations() -> None:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    cfg.set_main_option("sqlalchemy.url", settings.database_url)
    command.upgrade(cfg, "head")


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        ensure_dirs()
    except Exception as e:
        log.exception("ensure_dirs failed: %s", e)

    try:
        install_builtin_fonts()
    except Exception as e:
        log.exception("install_builtin_fonts failed: %s", e)

    # Migrations are no longer run at boot — they hang on Railway when
    # DATABASE_URL is misconfigured. Run them manually after deploy via
    # Railway CLI: `railway run --service <name> alembic upgrade head`
    # or expose them through a dedicated admin endpoint.
    yield


app = FastAPI(title="bot-montage", version="0.1.0", lifespan=lifespan)

# CORS first so the auth middleware doesn't strip headers from preflight.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(AuthMiddleware)

app.include_router(auth_router)
app.include_router(templates_router)
app.include_router(assets_router)
app.include_router(fonts_router)
app.include_router(files_router)
app.include_router(render_router)
app.include_router(jobs_router)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/api/_admin/migrate")
def run_migrations_endpoint(secret: str) -> dict:
    """One-shot migration runner. Pass ?secret=<JWT_SECRET> as query param.
    Use only at first deploy / after schema changes."""
    if secret != settings.jwt_secret:
        return {"ok": False, "detail": "forbidden"}
    try:
        _run_migrations()
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "detail": str(e)[:500]}
