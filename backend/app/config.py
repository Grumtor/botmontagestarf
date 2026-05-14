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
    render_workers: int = 1

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
    # Session lifetime in seconds. Default 10 years = "permanent" cookie.
    # Cookie is HttpOnly + Secure + SameSite=Lax in all cases.
    botmontage_session_max_age: int = 60 * 60 * 24 * 3650

    @property
    def database_url(self) -> str:
        return f"sqlite:///{self.data_dir}/botmontage.db"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
