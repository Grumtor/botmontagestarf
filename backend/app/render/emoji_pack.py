"""Apple emoji PNG pack — lazy CDN download with on-disk cache.

Each emoji char (e.g. "👍🏼" or "👨‍💻") maps to a PNG glyph in
`emoji-datasource-apple` which we lazily fetch from jsdelivr the first time
it's encountered, then cache under `/data/apple_emojis/{unified}.png`.

The Pillow text renderer pastes those PNGs inline with the text to give the
final ffmpeg-rendered video the same Apple emoji look as the editor canvas
preview.

We keep the resolution at 64px since most caption emojis are rendered ≤ 80px
tall on the final 1080×1920 reel — the 64 set is small (~1MB total) and crisp
enough at typical caption sizes. For the rare oversize use case, the pack
could be regenerated against the 160px set without changing this module's
public API.
"""

from __future__ import annotations

import logging
import threading
import urllib.error
import urllib.request
from pathlib import Path
from typing import Optional

log = logging.getLogger(__name__)

APPLE_EMOJI_DIR_NAME = "apple_emojis"
# Phase 32 — bump 15.1.2 → 16.0.0.
#
# 15.1.2 = Unicode 15.1 (sept 2023, iOS 17.4). Tous les emojis ajoutés
# par Unicode 16 (sept 2024, iOS 18.4+) renvoyaient un 404 sur jsdelivr
# et le rendu affichait un tofu (□) à leur place :
#   🫩 face with bags under eyes
#   🪾 leafless tree
#   🪏 shovel
#   🫟 splatter
#   🇨🇶 flag: Sark
#   🪮 hair pick
#   ...
#
# Le caching disk des PNG déjà téléchargés reste valide (le naming
# `{unified}.png` est stable d'une version à l'autre). Au restart, le
# _NEGATIVE_CACHE en mémoire est vidé donc les emojis qui avaient
# échoué seront re-tentés contre la nouvelle version.
APPLE_EMOJI_VERSION = "16.0.0"
# emoji-datasource-apple ships sized PNGs at 16/20/32/64/160. 64 is plenty
# crisp for caption-size emoji in a 1920px-tall reel.
APPLE_EMOJI_PX = 64

_CDN_BASE = (
    f"https://cdn.jsdelivr.net/npm/emoji-datasource-apple@{APPLE_EMOJI_VERSION}"
    f"/img/apple/{APPLE_EMOJI_PX}"
)
_TIMEOUT = 5  # seconds
_NEGATIVE_CACHE: set[str] = set()  # unifieds we tried and got 404 on
_LOCK = threading.Lock()


def _resolve_pack_dir() -> Path:
    # Imported here to avoid a circular import via storage → __init__ chains.
    from app.storage import DATA_DIR

    p = DATA_DIR / APPLE_EMOJI_DIR_NAME
    p.mkdir(parents=True, exist_ok=True)
    return p


def _candidate_unifieds(native: str) -> list[str]:
    """All plausible "unified" codepoint strings for a native emoji char.

    The emoji-datasource naming is finicky around the FE0F variation selector
    (some emojis include it in the filename, others don't). We try with FE0F
    preserved first, then with FE0F stripped — whichever exists wins.
    """
    cps_all: list[str] = []
    cps_no_fe0f: list[str] = []
    for ch in native:
        cp = ord(ch)
        cps_all.append(f"{cp:x}")
        if cp != 0xFE0F:
            cps_no_fe0f.append(f"{cp:x}")
    out = ["-".join(cps_all)]
    no_fe0f = "-".join(cps_no_fe0f)
    if no_fe0f and no_fe0f != out[0]:
        out.append(no_fe0f)
    return out


def _try_download(unified: str, dest: Path) -> bool:
    url = f"{_CDN_BASE}/{unified}.png"
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "bot-montage/1.0 (+emoji-fetcher)"},
        )
        with urllib.request.urlopen(req, timeout=_TIMEOUT) as resp:
            if resp.status != 200:
                return False
            data = resp.read()
        # Write atomically to dodge partial files on crash mid-write.
        tmp = dest.with_suffix(dest.suffix + ".tmp")
        tmp.write_bytes(data)
        tmp.replace(dest)
        return True
    except urllib.error.HTTPError as e:
        if e.code != 404:
            log.warning("emoji fetch %s → HTTP %s", unified, e.code)
        return False
    except Exception as e:
        log.warning("emoji fetch %s failed: %s", unified, e)
        return False


def get_apple_emoji_png(native: str) -> Optional[Path]:
    """Return a local Path to the Apple PNG glyph for the given native
    emoji char (potentially multi-codepoint), or None if unavailable.

    Lazily downloads on first miss, then caches forever.
    """
    if not native:
        return None

    pack_dir = _resolve_pack_dir()

    for unified in _candidate_unifieds(native):
        if unified in _NEGATIVE_CACHE:
            continue
        dest = pack_dir / f"{unified}.png"
        if dest.is_file() and dest.stat().st_size > 0:
            return dest
        # Single-flight download per process — multiple render workers hit the
        # same fresh emoji exactly once.
        with _LOCK:
            if dest.is_file() and dest.stat().st_size > 0:
                return dest
            if _try_download(unified, dest):
                return dest
            _NEGATIVE_CACHE.add(unified)

    log.info("no Apple emoji glyph for %r (tried %s)", native, _candidate_unifieds(native))
    return None
