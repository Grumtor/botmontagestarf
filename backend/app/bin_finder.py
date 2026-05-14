"""Find media tooling executables (exiftool, ffmpeg, AtomicParsley...) on
disk even when the user's PATH doesn't have the package-manager dirs.

On Windows this is a recurring annoyance: Scoop installs to
`C:\\Users\\<user>\\scoop\\shims\\` but only adds it to the *user* PATH
— which the current uvicorn process may not see if it was launched
from a terminal that started before the install. Same dance for
Chocolatey / WinGet.

This module hides that mess: every backend call goes through
`find_exe("exiftool")` instead of relying on `subprocess` to do its own
PATH lookup. We try `shutil.which()` first (PATH lookup), then a
hand-curated list of fallbacks per OS.
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path
from typing import Optional


def _windows_candidates(name: str) -> list[Path]:
    """Common per-OS install directories for media CLI tools."""
    home = Path.home()
    return [
        home / "scoop" / "shims" / f"{name}.exe",
        home / "scoop" / "apps" / name / "current" / f"{name}.exe",
        Path("C:/ProgramData/chocolatey/bin") / f"{name}.exe",
        Path("C:/Program Files") / name / f"{name}.exe",
        Path("C:/Program Files (x86)") / name / f"{name}.exe",
        Path(f"C:/{name}/{name}.exe"),
    ]


def _posix_candidates(name: str) -> list[Path]:
    return [
        Path(f"/usr/local/bin/{name}"),
        Path(f"/usr/bin/{name}"),
        Path(f"/opt/homebrew/bin/{name}"),
        Path(f"/opt/local/bin/{name}"),
    ]


def find_exe(name: str) -> Optional[str]:
    """Return the path to an executable, or None if it can't be found."""
    via_path = shutil.which(name)
    if via_path:
        return via_path

    candidates = (
        _windows_candidates(name) if os.name == "nt" else _posix_candidates(name)
    )
    for p in candidates:
        try:
            if p.is_file():
                return str(p)
        except OSError:
            continue
    return None


# Convenience wrappers for the tools we actually call. They return either
# the discovered path or the bare name (so subprocess raises a clear
# FileNotFoundError if even the fallback search fails).

def exiftool_exe() -> str:
    return find_exe("exiftool") or "exiftool"


def ffmpeg_exe() -> str:
    return find_exe("ffmpeg") or "ffmpeg"


def ffprobe_exe() -> str:
    return find_exe("ffprobe") or "ffprobe"


def atomicparsley_exe() -> str:
    # AtomicParsley's casing varies (AtomicParsley, atomicparsley) — try both.
    return find_exe("AtomicParsley") or find_exe("atomicparsley") or "AtomicParsley"


# ---- ffmpeg env helper ---------------------------------------------

# Some Windows ffmpeg builds (notably the gyan.dev one shipped via WinGet)
# refuse to start the drawtext filter unless libfontconfig can find a
# config file. The drawtext filter does NOT actually need fontconfig
# when we pass `fontfile=...`, but the lib initialises it eagerly and
# crashes if there's nothing on disk.
#
# We bundle `backend/fontconfig/fonts.conf` (a minimal stub) and point
# FONTCONFIG_FILE at it for every ffmpeg subprocess so the issue is
# patched once and forever, regardless of which ffmpeg build is on PATH.
_FONTCONFIG_FILE = (
    Path(__file__).resolve().parent.parent / "fontconfig" / "fonts.conf"
)


def ffmpeg_env() -> dict:
    """Build an env dict for `subprocess.run([ffmpeg, …], env=...)` that
    makes drawtext happy on every platform. Inherits os.environ so PATH,
    HOME, AppData etc. all work."""
    env = os.environ.copy()
    if _FONTCONFIG_FILE.is_file():
        env["FONTCONFIG_FILE"] = str(_FONTCONFIG_FILE)
        env["FONTCONFIG_PATH"] = str(_FONTCONFIG_FILE.parent)
    return env
