"""FastAPI app for the local-only setup.

No auth, no Alembic, no admin endpoints. Schema is created on first boot
via `Base.metadata.create_all()`. The render worker is started as a
ThreadPoolExecutor in the same process and stopped on shutdown.
"""

import logging
import sys

# Force UTF-8 on stdout/stderr so Unicode characters (— ✓ etc) don't
# crash on Windows where the default console codepage is cp1252. NSSM
# captures stdout to a file so the cp1252 encoder gets used otherwise.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from app.api.assets import router as assets_router
from app.api.files import router as files_router
from app.api.fonts import router as fonts_router
from app.api.jobs import router as jobs_router
from app.api.photos import router as photos_router
from app.api.render import router as render_router
from app.api.sample_video import router as sample_video_router
from app.api.templates import router as templates_router
from app.api.vas import router as vas_router
from app.config import settings
from app.db import Base, engine
from app.storage import (
    cleanup_orphan_temp_uploads,
    ensure_dirs,
    ensure_placeholder_preview,
    install_builtin_fonts,
)
from app.worker import start_worker, stop_worker

log = logging.getLogger(__name__)


def _step(msg: str) -> None:
    """Print + flush so the user can SEE which lifespan step we're at,
    even when uvicorn buffers logs. Crucial on Windows where ffmpeg
    subprocesses sometimes hang invisibly."""
    print(f"[lifespan] {msg}", flush=True)
    sys.stdout.flush()


@asynccontextmanager
async def lifespan(app: FastAPI):
    _step("lifespan start")

    # Filesystem
    _step("1/7 ensure_dirs…")
    try:
        ensure_dirs()
        _step("    [OK] ensure_dirs OK")
    except Exception as e:
        _step(f"    [FAIL] ensure_dirs failed: {e}")
        log.exception("ensure_dirs failed: %s", e)

    # SQLite schema — idempotent, fast, no migrations needed in local mode.
    _step("2/7 create_all (SQLite schema)…")
    try:
        Base.metadata.create_all(bind=engine)
        _step("    [OK] create_all OK")
    except Exception as e:
        _step(f"    [FAIL] create_all failed: {e}")
        log.exception("create_all failed: %s", e)

    # Lightweight column-add migration for existing DBs (create_all only
    # creates new tables, it doesn't ALTER existing ones). Safe to run on
    # every boot — only adds missing nullable columns.
    _step("3/7 column migrations (cover_ext, cover_time_sec, extra_tracks)…")
    try:
        from sqlalchemy import inspect, text
        inspector = inspect(engine)
        existing_cols = {c["name"] for c in inspector.get_columns("templates")}
        if "cover_ext" not in existing_cols:
            with engine.begin() as conn:
                conn.execute(
                    text("ALTER TABLE templates ADD COLUMN cover_ext VARCHAR")
                )
            _step("    + cover_ext added")
        if "cover_time_sec" not in existing_cols:
            with engine.begin() as conn:
                conn.execute(
                    text("ALTER TABLE templates ADD COLUMN cover_time_sec FLOAT")
                )
            _step("    + cover_time_sec added")
        if "extra_tracks" not in existing_cols:
            with engine.begin() as conn:
                # SQLite stores JSON as TEXT under the hood. Default '[]'
                # so existing rows have an empty list (legacy single-track).
                conn.execute(
                    text(
                        "ALTER TABLE templates ADD COLUMN extra_tracks JSON "
                        "NOT NULL DEFAULT '[]'"
                    )
                )
            _step("    + extra_tracks added")
        _step("    [OK] migrations OK")
    except Exception as e:
        _step(f"    [FAIL] migrations failed: {e}")
        log.exception("template column migration failed: %s", e)

    # Built-in fonts (Inter / Montserrat from system packages, copied into
    # the data dir so the renderer always finds them at a stable path).
    _step("4/7 install_builtin_fonts…")
    try:
        install_builtin_fonts()
        _step("    [OK] install_builtin_fonts OK")
    except Exception as e:
        _step(f"    [FAIL] install_builtin_fonts failed: {e}")
        log.exception("install_builtin_fonts failed: %s", e)

    # 30s black mp4 used as a placeholder source for unfilled previews.
    # This calls ffmpeg with `-f lavfi color=black` and a 60s timeout.
    # Skipped if the file already exists. If it hangs (Defender scan,
    # zombie ffmpeg) the timeout will fire and we continue.
    _step("5/7 ensure_placeholder_preview (may run ffmpeg, ~60s on 1st boot)…")
    try:
        ensure_placeholder_preview()
        _step("    [OK] ensure_placeholder_preview OK")
    except Exception as e:
        _step(f"    [FAIL] ensure_placeholder_preview failed: {e}")
        log.exception("ensure_placeholder_preview failed: %s", e)

    # Garbage-collect uploads from abandoned dialogs older than 24h.
    _step("6/7 cleanup_orphan_temp_uploads…")
    try:
        cleanup_orphan_temp_uploads(max_age_hours=24)
        _step("    [OK] cleanup OK")
    except Exception as e:
        _step(f"    [FAIL] cleanup failed: {e}")
        log.exception("cleanup_orphan_temp_uploads failed: %s", e)

    # Background render worker
    _step("7/7 start_worker…")
    start_worker()
    _step("    [OK] worker started")
    _step("lifespan READY — server is now listening")
    try:
        yield
    finally:
        _step("lifespan shutdown — stop_worker")
        stop_worker()


app = FastAPI(title="bot-montage", version="0.2.0-local", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(templates_router)
app.include_router(assets_router)
app.include_router(fonts_router)
app.include_router(files_router)
app.include_router(render_router)
app.include_router(jobs_router)
app.include_router(photos_router)
app.include_router(vas_router)
app.include_router(sample_video_router)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}
