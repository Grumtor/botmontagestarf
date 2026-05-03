import logging
import shutil
from pathlib import Path
from typing import Optional

log = logging.getLogger(__name__)

DATA_DIR = Path("/data")

# Persistent font library (Inter, Montserrat + user uploads).
ASSETS_DIR = DATA_DIR / "assets"
ASSET_DIRS: dict[str, Path] = {
    "font": ASSETS_DIR / "fonts",
}

# Per-template assets (fixed clips + overlays uploaded for a specific template).
TEMPLATES_DIR = DATA_DIR / "templates"

# Temp storage for user-uploaded videos awaiting a render batch (one file per
# token). Cleaned up after the job that consumed them completes.
TEMP_DIR = DATA_DIR / "temp"

# Final outputs of render jobs.
RENDERS_DIR = DATA_DIR / "renders"

BUILTIN_FONTS_META: dict[str, str] = {
    "inter": "Inter",
    "montserrat": "Montserrat",
}

BUILTIN_FONT_SOURCES: dict[str, list[str]] = {
    "inter": [
        "/usr/share/fonts/opentype/inter/Inter.otf",
        "/usr/share/fonts/opentype/inter/Inter-Regular.otf",
        "/usr/share/fonts/truetype/inter/Inter-Regular.ttf",
        "/usr/share/fonts/inter/Inter-Regular.otf",
        "/usr/share/fonts/inter/Inter-VariableFont_slnt,wght.ttf",
    ],
    "montserrat": [
        "/usr/share/fonts/truetype/montserrat/Montserrat-Regular.ttf",
        "/usr/share/fonts/opentype/montserrat/Montserrat-Regular.otf",
    ],
}


def ensure_dirs() -> None:
    for d in (
        ASSETS_DIR,
        TEMPLATES_DIR,
        TEMP_DIR,
        RENDERS_DIR,
        *ASSET_DIRS.values(),
    ):
        d.mkdir(parents=True, exist_ok=True)


def template_dir(template_id: int) -> Path:
    return TEMPLATES_DIR / str(template_id)


def template_clips_dir(template_id: int) -> Path:
    p = template_dir(template_id) / "clips"
    p.mkdir(parents=True, exist_ok=True)
    return p


def template_overlays_dir(template_id: int) -> Path:
    p = template_dir(template_id) / "overlays"
    p.mkdir(parents=True, exist_ok=True)
    return p


def template_thumb_path(template_id: int) -> Path:
    return template_dir(template_id) / "thumb.jpg"


def builtin_font_path(font_id: str) -> Optional[Path]:
    if font_id not in BUILTIN_FONTS_META:
        return None
    for ext in (".otf", ".ttf"):
        p = ASSET_DIRS["font"] / f"{font_id}{ext}"
        if p.is_file():
            return p
    return None


def install_builtin_fonts() -> None:
    """Copy bundled Inter/Montserrat from apt packages to /data/assets/fonts.
    No-op if already installed."""
    for font_id, candidates in BUILTIN_FONT_SOURCES.items():
        if builtin_font_path(font_id) is not None:
            continue
        for candidate in candidates:
            src = Path(candidate)
            if src.is_file():
                dst = ASSET_DIRS["font"] / f"{font_id}{src.suffix}"
                shutil.copy(src, dst)
                log.info("Installed built-in font %s from %s", font_id, src)
                break
        else:
            log.warning(
                "Built-in font %r not installed: none of the candidate paths exist",
                font_id,
            )
