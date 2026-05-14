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

    @property
    def database_url(self) -> str:
        return f"sqlite:///{self.data_dir}/botmontage.db"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
