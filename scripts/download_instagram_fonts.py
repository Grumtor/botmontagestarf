"""Helper script to download the Instagram / Meta fonts into backend/fonts/.

Run once after `git pull` (or whenever you want to refresh the fonts).
The script tries multiple known mirrors for each font slot. Files that
already exist on disk are skipped.

Usage:
    python scripts/download_instagram_fonts.py

Or just from the repo root:
    py -3 scripts/download_instagram_fonts.py

NOTE
----
These fonts are technically Meta proprietary. Bundling them in the repo
would be questionable, hence we fetch them at install time from public
font archives that mirror them. This is for **local personal use only**
— if you redistribute the rendered videos, the fonts inside them are
your call.

If a slot fails to download, no harm done: the picker simply shows
"non installée" next to that font and you keep using the others.
"""

from __future__ import annotations

import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
FONTS_DIR = REPO_ROOT / "backend" / "fonts"

# (filename --> list of candidate URLs to try in order)
# These come from font-archive mirrors that reupload the Meta fonts. URLs
# go stale; if a font fails, search "<font name> github" or font.style and
# add a new mirror to the list below.
FONTS: dict[str, list[str]] = {
    # ---- System defaults --------------------------------------------
    "inter.ttf": [
        "https://github.com/google/fonts/raw/main/ofl/inter/Inter%5Bopsz%2Cwght%5D.ttf",
    ],
    "montserrat.ttf": [
        "https://github.com/google/fonts/raw/main/ofl/montserrat/Montserrat%5Bwght%5D.ttf",
    ],
    "montserrat_bold.ttf": [
        "https://github.com/JulietaUla/Montserrat/raw/master/fonts/ttf/Montserrat-Bold.ttf",
    ],

    # ---- Instagram PWA UI -------------------------------------------
    # The real Meta fonts (Optimistic, Instagram Sans, FB Narrow) are
    # proprietary and don't have stable public mirrors — instead we ship
    # close free equivalents from Google Fonts that look ~85% identical.
    # If you find the real .ttf, drop them in backend/fonts/ with the same
    # filename and the picker will use them instead.
    #
    # Optimistic Display ~ Plus Jakarta Sans (geometric humanist sans)
    "optimistic_display.ttf": [
        "https://github.com/google/fonts/raw/main/ofl/plusjakartasans/PlusJakartaSans%5Bwght%5D.ttf",
    ],
    "optimistic_medium.ttf": [
        "https://github.com/google/fonts/raw/main/ofl/plusjakartasans/PlusJakartaSans%5Bwght%5D.ttf",
    ],
    "optimistic_variable.ttf": [
        "https://github.com/google/fonts/raw/main/ofl/plusjakartasans/PlusJakartaSans%5Bwght%5D.ttf",
    ],
    # Instagram Sans ~ Inter (Meta's UI font is heavily inspired by Inter)
    "ig_ui_semibold.ttf": [
        "https://github.com/rsms/inter/raw/master/docs/font-files/Inter-SemiBold.otf",
        "https://github.com/google/fonts/raw/main/ofl/inter/Inter%5Bopsz%2Cwght%5D.ttf",
    ],
    "ig_ui_bold.ttf": [
        "https://github.com/rsms/inter/raw/master/docs/font-files/Inter-Bold.otf",
        "https://github.com/google/fonts/raw/main/ofl/inter/Inter%5Bopsz%2Cwght%5D.ttf",
    ],
    # FB Narrow ~ Barlow Condensed (the closest free condensed sans)
    "fb_narrow.ttf": [
        "https://github.com/google/fonts/raw/main/ofl/barlowcondensed/BarlowCondensed-Bold.ttf",
        "https://github.com/google/fonts/raw/main/ofl/robotocondensed/RobotoCondensed%5Bwght%5D.ttf",
    ],

    # ---- Instagram Reels caption styles -----------------------------
    # Meta has never released these — what follows are free Google Fonts
    # equivalents that match the look of the iOS Reels editor presets.
    "reels_classic.ttf": [
        # Heavy chunky display — Bowlby One SC
        "https://github.com/google/fonts/raw/main/ofl/bowlbyonesc/BowlbyOneSC-Regular.ttf",
    ],
    "reels_modern.ttf": [
        # Clean variable sans — Plus Jakarta Sans
        "https://github.com/google/fonts/raw/main/ofl/plusjakartasans/PlusJakartaSans%5Bwght%5D.ttf",
    ],
    "reels_typewriter.ttf": [
        # Special Elite is Apache-licensed → it's under apache/, not ofl/
        "https://github.com/google/fonts/raw/main/apache/specialelite/SpecialElite-Regular.ttf",
        # Fallback: Courier Prime
        "https://github.com/google/fonts/raw/main/ofl/courierprime/CourierPrime-Regular.ttf",
    ],
    "reels_strong.ttf": [
        # Tall condensed — Bebas Neue
        "https://github.com/google/fonts/raw/main/ofl/bebasneue/BebasNeue-Regular.ttf",
    ],
    "reels_neon.ttf": [
        # Handwritten cursive — Pacifico
        "https://github.com/google/fonts/raw/main/ofl/pacifico/Pacifico-Regular.ttf",
    ],
}


def _download(url: str, dest: Path) -> bool:
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "bot-montage-fontfetch/1.0"},
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            if resp.status != 200:
                return False
            data = resp.read()
        if len(data) < 1024:
            # likely an HTML error page, skip
            return False
        tmp = dest.with_suffix(dest.suffix + ".part")
        tmp.write_bytes(data)
        tmp.replace(dest)
        return True
    except urllib.error.HTTPError as e:
        print(f"  ->{url} --> HTTP {e.code}", file=sys.stderr)
        return False
    except Exception as e:
        print(f"  ->{url} --> {e.__class__.__name__}: {e}", file=sys.stderr)
        return False


def main() -> int:
    FONTS_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Fonts target dir: {FONTS_DIR}")

    ok = 0
    skipped = 0
    failed: list[str] = []

    for filename, urls in FONTS.items():
        dest = FONTS_DIR / filename
        if dest.is_file() and dest.stat().st_size > 1024:
            print(f"  [skip] {filename} (already present)")
            skipped += 1
            continue
        success = False
        for url in urls:
            print(f"  [try ] {filename} <- {url}")
            if _download(url, dest):
                size_kb = dest.stat().st_size // 1024
                print(f"  [ok  ] {filename} ({size_kb} KB)")
                success = True
                break
        if success:
            ok += 1
        else:
            failed.append(filename)
            print(f"  [FAIL] {filename}")

    print()
    print(f"Done. installed={ok}, already_there={skipped}, failed={len(failed)}")
    if failed:
        print()
        print("Some fonts couldn't be auto-downloaded. You can either:")
        print("  - Search GitHub / font.style for a working mirror and update")
        print(f"    scripts/download_instagram_fonts.py with a new URL")
        print(f"  - Or manually drop the .ttf into {FONTS_DIR}")
        for f in failed:
            print(f"      --> {f}")

    # Always exit 0 — partial success is fine, the picker handles missing slots.
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
