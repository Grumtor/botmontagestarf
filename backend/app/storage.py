import logging
import shutil
from pathlib import Path
from typing import Optional

from app.config import settings

log = logging.getLogger(__name__)

# Local data root (defaults to <repo>/data, override via DATA_DIR env).
DATA_DIR = Path(settings.data_dir)

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

# Lazy-cached Apple emoji PNG glyphs (one PNG per unified codepoints string).
# Populated on demand by app.render.emoji_pack from the emoji-datasource-apple
# CDN; only emojis the user actually puts into a caption ever get downloaded.
APPLE_EMOJI_DIR = DATA_DIR / "apple_emojis"

# Repo-level fallback: drop TTF/OTF files into backend/fonts/ to bundle
# them. Filenames must match the IDs below (e.g. `optimistic_display.ttf`).
_REPO_FONTS = Path(__file__).resolve().parents[1] / "fonts"


def _repo_candidates(*basenames: str) -> list[str]:
    """Generate candidate paths for a font slot under backend/fonts/.
    Tries each basename with both .ttf and .otf extensions."""
    out: list[str] = []
    for base in basenames:
        for ext in (".ttf", ".otf"):
            out.append(str(_REPO_FONTS / f"{base}{ext}"))
    return out


# Each slot: id, display name, group (used to build picker sections).
# Groups: "system" (Inter / Montserrat), "instagram_pwa" (the Meta PWA UI
# fonts: Optimistic, IG UI, FB Narrow), "instagram_reels" (the 5 caption
# styles : Classic / Modern / Typewriter / Strong / Neon).
BUILTIN_FONTS_META: dict[str, dict[str, str]] = {
    "inter":              {"name": "Inter",                "group": "system"},
    "montserrat":         {"name": "Montserrat",           "group": "system"},
    "montserrat_bold":    {"name": "Montserrat Bold",      "group": "system"},
    "optimistic_display": {"name": "Optimistic Display",   "group": "instagram_pwa"},
    "optimistic_medium":  {"name": "Optimistic Medium",    "group": "instagram_pwa"},
    "optimistic_variable":{"name": "Optimistic Variable",  "group": "instagram_pwa"},
    "ig_ui_semibold":     {"name": "IG UI SemiBold",       "group": "instagram_pwa"},
    "ig_ui_bold":         {"name": "IG UI Bold",           "group": "instagram_pwa"},
    "fb_narrow":          {"name": "FB Narrow",            "group": "instagram_pwa"},
    "reels_classic":      {"name": "Classic",              "group": "instagram_reels"},
    "reels_modern":       {"name": "Modern",               "group": "instagram_reels"},
    "reels_typewriter":   {"name": "Typewriter",           "group": "instagram_reels"},
    "reels_strong":       {"name": "Strong",               "group": "instagram_reels"},
    "reels_neon":         {"name": "Neon",                 "group": "instagram_reels"},
}

FONT_GROUP_LABELS: dict[str, str] = {
    "system":           "Système",
    "instagram_pwa":    "Instagram (PWA)",
    "instagram_reels":  "Instagram Reels",
}

BUILTIN_FONT_SOURCES: dict[str, list[str]] = {
    "inter": [
        *_repo_candidates("inter", "Inter-Regular", "Inter"),
        # Linux (Debian/Ubuntu apt fonts-inter)
        "/usr/share/fonts/opentype/inter/Inter.otf",
        "/usr/share/fonts/opentype/inter/Inter-Regular.otf",
        "/usr/share/fonts/truetype/inter/Inter-Regular.ttf",
        "/usr/share/fonts/inter/Inter-Regular.otf",
        "/usr/share/fonts/inter/Inter-VariableFont_slnt,wght.ttf",
        # macOS (Homebrew font-inter)
        "/Library/Fonts/Inter-Regular.otf",
        str(Path.home() / "Library/Fonts/Inter-Regular.otf"),
        # Windows (manual install)
        "C:/Windows/Fonts/Inter-Regular.ttf",
        "C:/Windows/Fonts/Inter.ttf",
    ],
    "montserrat": [
        *_repo_candidates("montserrat", "Montserrat-Regular", "Montserrat"),
        # Linux
        "/usr/share/fonts/truetype/montserrat/Montserrat-Regular.ttf",
        "/usr/share/fonts/opentype/montserrat/Montserrat-Regular.otf",
        # macOS
        "/Library/Fonts/Montserrat-Regular.ttf",
        str(Path.home() / "Library/Fonts/Montserrat-Regular.ttf"),
        # Windows
        "C:/Windows/Fonts/Montserrat-Regular.ttf",
    ],
    "montserrat_bold": [
        *_repo_candidates("montserrat_bold", "Montserrat-Bold"),
        # Linux
        "/usr/share/fonts/truetype/montserrat/Montserrat-Bold.ttf",
        # macOS
        "/Library/Fonts/Montserrat-Bold.ttf",
        str(Path.home() / "Library/Fonts/Montserrat-Bold.ttf"),
        # Windows
        "C:/Windows/Fonts/Montserrat-Bold.ttf",
    ],
    # All other slots only look in backend/fonts/ — drop your TTF/OTF there.
    "optimistic_display":  _repo_candidates("optimistic_display", "OptimisticDisplay", "Optimistic-Display"),
    "optimistic_medium":   _repo_candidates("optimistic_medium",  "OptimisticMedium",  "Optimistic-Medium"),
    "optimistic_variable": _repo_candidates("optimistic_variable","OptimisticVariable","Optimistic-Variable"),
    "ig_ui_semibold":      _repo_candidates("ig_ui_semibold",     "IGUI-SemiBold",     "InstagramSans-SemiBold"),
    "ig_ui_bold":          _repo_candidates("ig_ui_bold",         "IGUI-Bold",         "InstagramSans-Bold"),
    "fb_narrow":           _repo_candidates("fb_narrow",          "FBNarrow",          "FacebookNarrow"),
    "reels_classic":       _repo_candidates("reels_classic",      "Reels-Classic"),
    "reels_modern":        _repo_candidates("reels_modern",       "Reels-Modern"),
    "reels_typewriter":    _repo_candidates("reels_typewriter",   "Reels-Typewriter"),
    "reels_strong":        _repo_candidates("reels_strong",       "Reels-Strong"),
    "reels_neon":          _repo_candidates("reels_neon",         "Reels-Neon"),
}


def ensure_dirs() -> None:
    for d in (
        ASSETS_DIR,
        TEMPLATES_DIR,
        TEMP_DIR,
        RENDERS_DIR,
        APPLE_EMOJI_DIR,
        *ASSET_DIRS.values(),
    ):
        d.mkdir(parents=True, exist_ok=True)


PLACEHOLDER_PREVIEW_PATH = DATA_DIR / "_placeholder_preview.mp4"

# Optional user-uploaded "sample" video used as the visual filler whenever
# a template preview would otherwise have a black placeholder. Single
# global file shared by every template (Phase 17).
SAMPLE_VIDEO_PATH = DATA_DIR / "sample_placeholder.mp4"


def placeholder_fallback_path() -> Path:
    """Return the video that should fill empty placeholders during preview
    rendering. Prefers the user's uploaded sample, falls back to the 30s
    black mp4 generated at boot."""
    if SAMPLE_VIDEO_PATH.is_file() and SAMPLE_VIDEO_PATH.stat().st_size > 0:
        return SAMPLE_VIDEO_PATH
    return PLACEHOLDER_PREVIEW_PATH


def invalidate_template_previews() -> int:
    """Delete cached template preview MP4s so the next 'Aperçu rendu'
    re-generates them with whatever the current placeholder fallback is.
    Called when the sample video is uploaded/replaced/deleted."""
    if not TEMPLATES_DIR.is_dir():
        return 0
    deleted = 0
    for tpl_dir in TEMPLATES_DIR.iterdir():
        if not tpl_dir.is_dir():
            continue
        preview = tpl_dir / "preview.mp4"
        if preview.is_file():
            try:
                preview.unlink()
                deleted += 1
            except Exception as e:
                log.warning("could not delete %s: %s", preview, e)
    if deleted:
        log.info("Invalidated %d cached template preview(s)", deleted)
    return deleted


def ensure_placeholder_preview() -> Path:
    """Generate a 30s black 1080x1920 mp4 once. Used as a synthetic source
    when previewing a template whose placeholder slots haven't been filled
    by the user yet."""
    import subprocess

    from app.bin_finder import ffmpeg_exe

    p = PLACEHOLDER_PREVIEW_PATH
    if p.is_file():
        return p
    cmd = [
        ffmpeg_exe(),
        "-y",
        "-f", "lavfi",
        "-i", "color=color=black:size=1080x1920:duration=30:rate=30",
        "-f", "lavfi",
        "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "64k",
        "-shortest",
        str(p),
    ]
    try:
        from app.bin_finder import ffmpeg_env
        subprocess.run(cmd, check=True, capture_output=True, timeout=60, env=ffmpeg_env())
    except Exception as e:
        log.warning("Failed to generate placeholder preview: %s", e)
    return p


def template_preview_path(template_id: int) -> Path:
    return template_dir(template_id) / "preview.mp4"


def cleanup_orphan_temp_uploads(max_age_hours: int = 24) -> int:
    """Delete files in /data/temp older than max_age_hours.
    These are user video uploads from a render dialog the user abandoned.
    Returns the number of files deleted."""
    import time

    if not TEMP_DIR.is_dir():
        return 0
    cutoff = time.time() - max_age_hours * 3600
    deleted = 0
    for p in TEMP_DIR.iterdir():
        if not p.is_file():
            continue
        try:
            if p.stat().st_mtime < cutoff:
                p.unlink(missing_ok=True)
                deleted += 1
        except Exception as e:
            log.warning("failed to clean %s: %s", p, e)
    if deleted:
        log.info("Cleaned %d orphan temp upload(s) older than %dh", deleted, max_age_hours)
    return deleted


def cleanup_old_renders(max_age_days: int = 30) -> int:
    """Bandwidth/disk saver : delete /data/renders/{jid}/ + {jid}.zip
    older than `max_age_days`. The DB row for the job is kept (the user
    sees an entry with `output_files=[]` and `has_zip=False`, which the
    UI treats as "expired"). Returns the number of jobs purged.

    Conservative on errors : log + continue so a single bad path doesn't
    block all the other cleanups."""
    import time

    if not RENDERS_DIR.is_dir():
        return 0
    cutoff = time.time() - max_age_days * 86400
    purged = 0
    for p in RENDERS_DIR.iterdir():
        try:
            if p.stat().st_mtime >= cutoff:
                continue
        except Exception:
            continue
        try:
            if p.is_dir():
                import shutil
                shutil.rmtree(p, ignore_errors=True)
                purged += 1
            elif p.is_file() and p.suffix == ".zip":
                p.unlink(missing_ok=True)
                purged += 1
        except Exception as e:
            log.warning("cleanup_old_renders: failed on %s: %s", p, e)
    if purged:
        log.info(
            "Cleaned %d render(s) older than %d days", purged, max_age_days
        )
    return purged


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


def template_cover_path(template_id: int, ext: str) -> Path:
    """User-uploaded cover image for the /templates grid card. The
    extension is whatever the user uploaded (jpg/png/webp) — stored in
    `templates.cover_ext` so we can resolve the on-disk file."""
    safe_ext = ext.lower().lstrip(".")
    return template_dir(template_id) / f"cover.{safe_ext}"


def find_template_cover(template_id: int) -> Optional[Path]:
    """Best-effort lookup: scan the template dir for any `cover.*` file.
    Useful when we don't know the stored extension (defensive)."""
    base = template_dir(template_id)
    if not base.exists():
        return None
    for p in base.glob("cover.*"):
        if p.is_file():
            return p
    return None


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
