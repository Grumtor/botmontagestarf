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

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager

from app.api.assets import router as assets_router
from app.api.auth import router as auth_router
from app.api.files import router as files_router
from app.api.fonts import router as fonts_router
from app.api.jobs import router as jobs_router
from app.api.photos import router as photos_router
from app.api.render import router as render_router
from app.api.sample_video import router as sample_video_router
from app.api.admin import router as admin_router
from app.api.templates import router as templates_router
from app.auth import COOKIE_NAME, auth_enabled, verify_session_token
from app.config import settings
from app.db import Base, engine
from app.storage import (
    cleanup_old_renders,
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
        # Phase 32 — drop the legacy virtual_assistants table (feature
        # removed entirely). DROP IF EXISTS is idempotent.
        all_tables = set(inspector.get_table_names())
        if "virtual_assistants" in all_tables:
            with engine.begin() as conn:
                conn.execute(text("DROP TABLE IF EXISTS virtual_assistants"))
            _step("    - virtual_assistants dropped")

        # Phase 33 — multi-tenant: add owner_id columns to templates +
        # render_jobs. Nullable until bootstrap-admin step below assigns
        # ownership of legacy rows.
        if "owner_id" not in existing_cols:
            with engine.begin() as conn:
                conn.execute(
                    text("ALTER TABLE templates ADD COLUMN owner_id INTEGER")
                )
            _step("    + templates.owner_id added")
        rj_cols = {c["name"] for c in inspector.get_columns("render_jobs")}
        if "owner_id" not in rj_cols:
            with engine.begin() as conn:
                conn.execute(
                    text("ALTER TABLE render_jobs ADD COLUMN owner_id INTEGER")
                )
            _step("    + render_jobs.owner_id added")

        # Phase 35 — UI language per user (fr / en).
        users_cols = {c["name"] for c in inspector.get_columns("users")}
        if "language" not in users_cols:
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "ALTER TABLE users ADD COLUMN language VARCHAR "
                        "NOT NULL DEFAULT 'fr'"
                    )
                )
            _step("    + users.language added (default 'fr')")
        _step("    [OK] migrations OK")
    except Exception as e:
        _step(f"    [FAIL] migrations failed: {e}")
        log.exception("template column migration failed: %s", e)

    # Phase 33 — bootstrap admin user if the users table is empty AND a
    # legacy BOTMONTAGE_PASSWORD_HASH is set. The legacy hash becomes the
    # admin's password (no need to re-set anything). All existing
    # templates / render_jobs are assigned owner_id = admin.id so they
    # remain accessible.
    _step("3b/7 bootstrap admin user (if needed)…")
    try:
        from sqlalchemy import func as sa_func, select, update
        from app.db import SessionLocal
        from app.db.models import User, UserRole, UserPriority, Template, RenderJob
        with SessionLocal() as db:
            n_users = db.scalar(select(sa_func.count()).select_from(User))
            if n_users == 0:
                legacy_hash = settings.botmontage_password_hash
                if legacy_hash:
                    admin = User(
                        username=getattr(
                            settings, "botmontage_admin_username", "admin"
                        ),
                        password_hash=legacy_hash,
                        role=UserRole.admin,
                        priority=UserPriority.high,
                        max_templates=None,           # unlimited
                        render_credits=10**9,         # effectively unlimited
                        is_active=True,
                    )
                    db.add(admin)
                    db.commit()
                    db.refresh(admin)
                    # Assign every existing template + render_job to this
                    # admin so we don't end up with orphans after the FK
                    # check tightens.
                    db.execute(
                        update(Template).where(Template.owner_id.is_(None))
                        .values(owner_id=admin.id)
                    )
                    db.execute(
                        update(RenderJob).where(RenderJob.owner_id.is_(None))
                        .values(owner_id=admin.id)
                    )
                    db.commit()
                    _step(
                        f"    + admin user '{admin.username}' created "
                        f"(id={admin.id}) + legacy rows assigned"
                    )
                else:
                    _step(
                        "    [WARN] users table empty AND no legacy "
                        "BOTMONTAGE_PASSWORD_HASH — auth disabled until "
                        "you set one (or seed an admin manually)"
                    )
            else:
                _step(f"    [OK] {n_users} user(s) already present")
    except Exception as e:
        _step(f"    [FAIL] bootstrap admin failed: {e}")
        log.exception("bootstrap admin failed: %s", e)

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
    _step("6/7 cleanup_orphan_temp_uploads + cleanup_old_renders…")
    try:
        n_temp = cleanup_orphan_temp_uploads(max_age_hours=24)
        # Phase 34 — purge des renders > 30 jours pour ne pas faire
        # exploser le disque. La row DB du job reste (avec output_files
        # vide), juste le ZIP + le dossier outputs disparaissent.
        n_renders = cleanup_old_renders(max_age_days=30)
        _step(
            f"    [OK] cleanup OK (temp={n_temp}, renders={n_renders})"
        )
    except Exception as e:
        _step(f"    [FAIL] cleanup failed: {e}")
        log.exception("cleanup_orphan_temp_uploads / cleanup_old_renders failed: %s", e)

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
    # Hygiène : on liste explicitement les méthodes et les headers
    # plutôt que "*". `allow_credentials=True` combiné à un wildcard
    # `allow_origins` serait refusé par le navigateur de toutes façons,
    # mais autant fermer la porte à la configuration ambiguë.
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Requested-With"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    """Inject hardening headers on every response. Cloudflare en ajoute
    déjà certains mais on les met explicitement pour ne pas dépendre
    d'eux."""
    response = await call_next(request)
    # Empêche le browser de "deviner" le content-type (mitige XSS via
    # contenu uploadé servi comme HTML).
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    # Bloque le framing — l'app ne doit pas pouvoir être embed dans une
    # iframe externe (mitige clickjacking).
    response.headers.setdefault("X-Frame-Options", "DENY")
    # Limite le leak d'URL via le Referer header.
    response.headers.setdefault(
        "Referrer-Policy", "strict-origin-when-cross-origin"
    )
    # CSP minimaliste sur les routes API (renvoient du JSON, pas
    # d'exécution JS). Pour les pages HTML (servies par Next.js, pas
    # par FastAPI), c'est Next qui doit poser sa propre CSP.
    if request.url.path.startswith("/api/"):
        response.headers.setdefault(
            "Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'"
        )
    return response


# Phase 30 — auth middleware. Protects every /api/* endpoint by
# default. Bypassed routes : /api/health (uptime check), /api/auth/*
# (login/logout/status endpoints themselves), and OPTIONS preflights.
# Returns 401 on missing/invalid cookie. No-op when auth is disabled.
_PUBLIC_PREFIXES = ("/api/health", "/api/auth/")


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path
    # Always allow CORS preflights.
    if request.method == "OPTIONS":
        return await call_next(request)
    # Public endpoints (no auth required).
    if any(path.startswith(p) for p in _PUBLIC_PREFIXES):
        return await call_next(request)
    # Non-API routes (none currently, but keep safe).
    if not path.startswith("/api/"):
        return await call_next(request)
    # Auth check (no-op if auth disabled).
    if not auth_enabled():
        return await call_next(request)
    token = request.cookies.get(COOKIE_NAME)
    if not token or not verify_session_token(token):
        return JSONResponse(
            status_code=status.HTTP_401_UNAUTHORIZED,
            content={"detail": "Not authenticated"},
        )
    return await call_next(request)


# Routes
app.include_router(auth_router)         # /api/auth/* — public
app.include_router(templates_router)
app.include_router(assets_router)
app.include_router(fonts_router)
app.include_router(files_router)
app.include_router(render_router)
app.include_router(jobs_router)
app.include_router(photos_router)
app.include_router(sample_video_router)
app.include_router(admin_router)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}
