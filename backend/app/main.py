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
from app.api.pools import router as pools_router
from app.api.render import router as render_router
from app.api.sources import router as sources_router
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
        log.info("Ensuring data directories…")
        ensure_dirs()
    except Exception as e:
        log.exception("ensure_dirs failed: %s", e)

    try:
        log.info("Installing built-in fonts…")
        install_builtin_fonts()
    except Exception as e:
        log.exception("install_builtin_fonts failed: %s", e)

    try:
        log.info("Running database migrations…")
        _run_migrations()
        log.info("Migrations complete.")
    except Exception as e:
        log.exception("migrations failed: %s", e)

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
app.include_router(pools_router)
app.include_router(sources_router)
app.include_router(assets_router)
app.include_router(fonts_router)
app.include_router(files_router)
app.include_router(render_router)
app.include_router(jobs_router)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}
