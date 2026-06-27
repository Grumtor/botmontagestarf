"""SQLite engine for local-only mode.

The render worker is in-process (ThreadPoolExecutor), so we share the
engine across threads. SQLAlchemy + SQLite need `check_same_thread=False`
to allow that, and WAL is set at first connection so reads don't block
writes during a render.
"""

from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings

# Ensure the SQLite parent dir exists before the engine tries to open the
# file (the lifespan's ensure_dirs() runs later, but we may import this
# module from tools/scripts that don't go through the lifespan).
Path(settings.data_dir).mkdir(parents=True, exist_ok=True)

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False},
    pool_pre_ping=True,
    future=True,
)


@event.listens_for(Engine, "connect")
def _set_sqlite_pragmas(dbapi_connection, _connection_record):
    """Enable WAL and FK enforcement on every new SQLite connection."""
    cur = dbapi_connection.cursor()
    try:
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA synchronous=NORMAL")
        cur.execute("PRAGMA foreign_keys=ON")
        # Phase 39 — busy_timeout=5s : si une autre connexion tient le
        # lock (le worker render fait un commit en plein milieu d'un
        # SELECT API), on attend jusqu'à 5s au lieu de raise
        # SQLITE_BUSY immédiatement. Évite les 500 random sous charge.
        cur.execute("PRAGMA busy_timeout=5000")
    finally:
        cur.close()


SessionLocal = sessionmaker(
    autocommit=False, autoflush=False, bind=engine, future=True
)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


__all__ = ["Base", "engine", "SessionLocal", "get_db"]
