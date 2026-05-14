"""Debug startup script — imports things one at a time with explicit
flushing so we can see EXACTLY where the boot hangs.

Usage (from `backend/`):
    python -u debug_start.py

The `-u` flag forces unbuffered stdout. Each import / step prints its
status before and after so a hang is immediately visible (last line
printed = where it hangs)."""

import sys
import time

# Force every print to flush IMMEDIATELY — PowerShell buffers heavily
# otherwise and we'd see nothing during long ops.
def p(msg: str) -> None:
    print(msg, flush=True)
    sys.stdout.flush()


p("=" * 60)
p("debug_start.py — diagnostic boot")
p("=" * 60)
p(f"Python: {sys.version.split()[0]}")
p(f"Cwd: {__import__('os').getcwd()}")
p("")

# ---- imports phase ----
t0 = time.time()
p("[1] Import fastapi…")
import fastapi  # noqa: F401
p(f"    OK (fastapi {fastapi.__version__})")

p("[2] Import uvicorn…")
import uvicorn  # noqa: F401
p(f"    OK (uvicorn {uvicorn.__version__})")

p("[3] Import sqlalchemy…")
import sqlalchemy  # noqa: F401
p(f"    OK (sqlalchemy {sqlalchemy.__version__})")

p("[4] Import app.config…")
from app.config import settings
p(f"    OK (data_dir={settings.data_dir})")

p("[5] Import app.db (engine / Base)…")
from app.db import Base, engine
p(f"    OK (engine={engine.url})")

p("[6] Import app.db.models…")
import app.db.models  # noqa: F401
p("    OK")

p("[7] Import app.storage…")
from app.storage import (
    cleanup_orphan_temp_uploads,
    ensure_dirs,
    ensure_placeholder_preview,
    install_builtin_fonts,
)
p("    OK")

p("[8] Import app.worker…")
from app.worker import start_worker, stop_worker  # noqa: F401
p("    OK")

p("[9] Import app.api.* routers (one by one)…")
import_targets = [
    "app.api.templates",
    "app.api.assets",
    "app.api.fonts",
    "app.api.files",
    "app.api.render",
    "app.api.jobs",
    "app.api.photos",
    "app.api.vas",
    "app.api.sample_video",
]
for mod in import_targets:
    p(f"    [9.x] {mod}…")
    __import__(mod)
    p(f"    [9.x] {mod} OK")

p(f"[ALL IMPORTS] done in {time.time()-t0:.1f}s")
p("")

# ---- lifespan ops phase ----
p("=" * 60)
p("Now running each lifespan step manually:")
p("=" * 60)

p("[A] ensure_dirs…")
t = time.time()
ensure_dirs()
p(f"    OK ({time.time()-t:.2f}s)")

p("[B] create_all (SQLite schema)…")
t = time.time()
Base.metadata.create_all(bind=engine)
p(f"    OK ({time.time()-t:.2f}s)")

p("[C] column migrations (sqlalchemy inspect + ALTER TABLE)…")
t = time.time()
from sqlalchemy import inspect, text
inspector = inspect(engine)
existing_cols = {c["name"] for c in inspector.get_columns("templates")}
p(f"    existing template cols: {sorted(existing_cols)}")
for col_name, col_def in [
    ("cover_ext", "VARCHAR"),
    ("cover_time_sec", "FLOAT"),
    ("extra_tracks", "JSON NOT NULL DEFAULT '[]'"),
]:
    if col_name not in existing_cols:
        p(f"    + adding col {col_name}…")
        with engine.begin() as conn:
            conn.execute(text(f"ALTER TABLE templates ADD COLUMN {col_name} {col_def}"))
        p(f"    + {col_name} added")
    else:
        p(f"    = {col_name} already present")
p(f"    OK ({time.time()-t:.2f}s)")

p("[D] install_builtin_fonts…")
t = time.time()
install_builtin_fonts()
p(f"    OK ({time.time()-t:.2f}s)")

p("[E] ensure_placeholder_preview (may run ffmpeg up to 60s on 1st boot)…")
t = time.time()
ensure_placeholder_preview()
p(f"    OK ({time.time()-t:.2f}s)")

p("[F] cleanup_orphan_temp_uploads…")
t = time.time()
cleanup_orphan_temp_uploads(max_age_hours=24)
p(f"    OK ({time.time()-t:.2f}s)")

p("[G] start_worker…")
t = time.time()
start_worker()
p(f"    OK ({time.time()-t:.2f}s)")

stop_worker()

p("")
p("=" * 60)
p("✓ ALL CHECKS PASSED. The backend should start fine.")
p("Now run: uvicorn app.main:app --port 8000")
p("=" * 60)
