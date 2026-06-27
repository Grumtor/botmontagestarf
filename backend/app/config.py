"""Local-only config. No env required to run — everything has a sensible
default for a single-machine setup. Override via env vars or a `.env` next
to the backend if you really want to."""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


# Default data root: <repo>/data/ (gitignored). Created at boot if missing.
_DEFAULT_DATA_DIR = (Path(__file__).resolve().parents[2] / "data").as_posix()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Single SQLite file inside data_dir; WAL mode set at startup so the
    # render worker can write while the API reads.
    data_dir: str = _DEFAULT_DATA_DIR

    # Allow CORS for the local Next dev server. Add more origins via comma
    # separation if you ever expose through a tunnel.
    cors_origins: str = "http://localhost:3000"

    # Worker concurrency for the in-process render queue.
    # Phase 39 — bump 1 → 2. ffmpeg sature un CPU par render mais le
    # VPS en a 4+ et l'API a besoin de respirer. 2 = 2 renders en
    # parallèle, 3 si la dernière instance OS/process est dispo
    # mais en pratique 2 suffit pour les batches typiques.
    render_workers: int = 2

    # ----- Auth (Phase 30) ------------------------------------------
    # Argon2id hash of the master password. Generate via
    # `python set_password.py`. If empty, auth is DISABLED (legacy
    # behavior — local-only single-machine setup).
    botmontage_password_hash: str = ""
    # HMAC secret used to sign session cookies. Generate via
    # `python -c "import secrets; print(secrets.token_hex(32))"`.
    # Rotating it logs everyone out.
    botmontage_session_secret: str = ""
    # Cookie domain. Empty = use exact host (works for localhost dev and
    # single-host prod). Set to `.grumtor.com` to share cookies between
    # bot.grumtor.com (frontend) and api.grumtor.com (backend).
    botmontage_session_cookie_domain: str = ""
    # Session lifetime in seconds. Default 30 jours — bon compromis
    # entre confort utilisateur (pas de re-login chaque jour) et fenêtre
    # de compromission d'un cookie volé (max 30 jours avant que le
    # browser le drop). Cookie est HttpOnly + Secure + SameSite=Strict.
    # Override via env si besoin (mais ne pas dépasser 90 jours).
    botmontage_session_max_age: int = 60 * 60 * 24 * 30

    # ----- Multi-tenant (Phase 33) ----------------------------------
    # Username assigned to the bootstrap admin if the users table is empty.
    # The password hash comes from BOTMONTAGE_PASSWORD_HASH above (legacy
    # field), so existing single-user installs upgrade in place without
    # losing access.
    botmontage_admin_username: str = "admin"

    @property
    def database_url(self) -> str:
        return f"sqlite:///{self.data_dir}/botmontage.db"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
