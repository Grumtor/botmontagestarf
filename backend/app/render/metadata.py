"""QuickTime metadata spoofing.

apply_quicktime_metadata() combines three layers:
  1. Binary patch of the ftyp atom — sets MajorBrand to 'qt  ' so ffprobe
     reports major_brand=qt (Apple-recorded look).
  2. Apple atom-level metadata via mutagen.mp4 (com.apple.quicktime.*).
  3. XMP / standard metadata via exiftool (GPS, country, dates).

Country/city + dates are randomised per render so each output looks like a
distinct iPhone capture.
"""

from __future__ import annotations

import json
import logging
import random
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from mutagen.mp4 import MP4, MP4FreeForm

from app.bin_finder import exiftool_exe

log = logging.getLogger(__name__)

COUNTRIES_PATH = Path(__file__).parent / "countries.json"
SOFTWARE_VERSION = "18.2.1"


def load_countries() -> dict:
    with COUNTRIES_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


# ---- ftyp binary patch ------------------------------------------------

# Phase 31 — On ne réécrit PLUS le major_brand en `qt  `.
#
# Bug visé : son décodé mais inaudible sur iOS Photos / iPhone (la
# barre de niveau bouge mais aucun son ne sort des haut-parleurs).
#
# Cause racine : quand le container est tagué `major_brand=qt  `, iOS
# Photos bascule sur son codec path "QuickTime natif Apple" — qui
# attend un track audio encodé par le hardware iPhone (codec/path
# Apple-spécifique). Notre AAC est produit par Lavc (ffmpeg) : iOS
# arrive à décoder les samples (d'où la barre qui bouge) mais ne sait
# pas les router vers les haut-parleurs parce que le format ne matche
# pas le profil "QuickTime hardware Apple". Sur PC (VLC, Chrome) le
# decoder software ignore cette distinction et lit normalement.
#
# Fix : on garde `mp42` (ou ce qu'avait ffmpeg) en major_brand → iOS
# utilise son codec path MP4 standard qui lit notre AAC sans souci.
# On ajoute `qt  ` aux compatible_brands pour préserver la "QuickTime
# vibe" auprès des parsers qui scrutent cette liste.
#
# Le spoof iPhone reste 100% effectif via les atoms Apple
# (com.apple.quicktime.{make,model,software,creationdate,location.*})
# + les tags exiftool (GPS, country, dates), qui sont ce que TikTok /
# Instagram regardent réellement pour le fingerprint hardware.

MP4_BRAND = b"mp42"
QT_BRAND = b"qt  "
# Ordre : major-compatible d'abord (mp42, isom, mp41), puis qt en
# bonus pour les parsers QuickTime stricts.
DEFAULT_COMPATIBLE = [b"mp42", b"isom", b"mp41", b"qt  "]


def patch_ftyp_to_qt(filepath: Path) -> None:
    """No-op depuis Phase 31c.

    Le rewrite du ftyp atom (même juste pour ajouter `qt  ` aux
    compatible_brands) participait à faire basculer iOS Photos sur
    son codec path Apple natif → audio muet sur iPhone. Test
    empirique : sans aucune modification du container, iOS lit
    l'audio normalement.

    Function name + signature conservés pour ne pas casser les
    callers existants (apply_quicktime_metadata). On peut la
    réactiver derrière un toggle si TikTok/Insta exigent un jour
    le `qt  ` brand au niveau container."""
    return


# ---- mutagen MP4 atoms ------------------------------------------------

def _ff(value: str) -> MP4FreeForm:
    return MP4FreeForm(value.encode("utf-8"), dataformat=1)


def write_mp4_atoms(filepath: Path, *, model: str, creation_iso: str, iso6709: str) -> None:
    """No-op depuis Phase 31c.

    Test empirique sur iPhone (job 51, ffprobe via
    /api/admin/debug/probe) confirme : retirer juste `make` et
    `model` ne suffit pas — la simple présence des atoms
    `com.apple.quicktime.{software, creationdate, location.*}`
    suffit à faire basculer iOS Photos sur son codec path "vraie
    vidéo iPhone hardware" → audio décodé mais non routé → muet
    sur le téléphone (la barre de niveau bouge mais aucun son).

    Workaround : on n'écrit PLUS aucun atom QT. Le spoof iPhone
    reste effectif via write_exiftool() (tags EXIF/XMP : GPS,
    Country, City, dates) qui sont ce que les fingerprinters
    TikTok/Insta scrutent en priorité.

    Function name + signature conservés pour ne pas casser
    apply_quicktime_metadata. Si TikTok/Insta exigent un jour
    explicitement des atoms QT, on pourra réintroduire derrière
    un toggle UI "Spoof agressif — bloque la lecture iOS"."""
    _ = (filepath, model, creation_iso, iso6709)  # silence unused warnings
    return


# ---- exiftool ---------------------------------------------------------

def write_exiftool(
    filepath: Path,
    *,
    lat: float,
    lon: float,
    altitude: float,
    country_name: str,
    country_code: str,
    city: str,
    state: str,
    language: str,
    creation_exif: str,
) -> None:
    args: list[str] = [
        exiftool_exe(),
        "-overwrite_original",
        "-q",
        "-q",
        f"-GPSLatitude={abs(lat):.6f}",
        f"-GPSLatitudeRef={'N' if lat >= 0 else 'S'}",
        f"-GPSLongitude={abs(lon):.6f}",
        f"-GPSLongitudeRef={'E' if lon >= 0 else 'W'}",
        f"-GPSAltitude={altitude:.3f}",
        f"-GPSAltitudeRef={'0' if altitude >= 0 else '1'}",
        f"-GPSPosition={lat:.6f} {lon:.6f}",
        f"-Country={country_name}",
        f"-Country-PrimaryLocationName={country_name}",
        f"-CountryCode={country_code}",
        f"-City={city}",
        f"-State={state}",
        f"-Location={city}",
        f"-Language={language}",
        f"-XMP:Country={country_name}",
        f"-XMP:CountryCode={country_code}",
        f"-XMP:City={city}",
        f"-XMP:State={state}",
        f"-CreateDate={creation_exif}",
        f"-ModifyDate={creation_exif}",
        f"-TrackCreateDate={creation_exif}",
        f"-MediaCreateDate={creation_exif}",
        f"-TrackModifyDate={creation_exif}",
        f"-MediaModifyDate={creation_exif}",
        str(filepath),
    ]
    try:
        result = subprocess.run(args, capture_output=True, text=True)
    except FileNotFoundError as exc:
        # Windows: WinError 2 → exiftool.exe missing from PATH.
        raise RuntimeError(
            "exiftool n'est pas installé ou pas dans le PATH. "
            "Installe-le : Windows `scoop install exiftool` · "
            "macOS `brew install exiftool` · "
            "Linux `apt install libimage-exiftool-perl`"
        ) from exc

    if result.returncode != 0:
        log.warning(
            "exiftool returned %s on %s. stderr=%s",
            result.returncode,
            filepath,
            result.stderr[-500:],
        )


# ---- public API -------------------------------------------------------

def _format_dates(days_window: int, tz_offset_hours: int) -> tuple[str, str]:
    """Returns (iso8601_with_colon_offset, exiftool_format)."""
    seconds_back = random.uniform(0, max(1, days_window) * 86400)
    tz = timezone(timedelta(hours=tz_offset_hours))
    creation_dt = datetime.now(tz) - timedelta(seconds=seconds_back)

    base = creation_dt.strftime("%Y-%m-%dT%H:%M:%S")
    offset = creation_dt.strftime("%z") or "+0000"
    iso = f"{base}{offset[:3]}:{offset[3:]}"

    exif_base = creation_dt.strftime("%Y:%m:%d %H:%M:%S")
    exif = f"{exif_base}{offset[:3]}:{offset[3:]}"
    return iso, exif


def _format_iso6709(lat: float, lon: float, alt: float) -> str:
    s_lat = "+" if lat >= 0 else "-"
    s_lon = "+" if lon >= 0 else "-"
    s_alt = "+" if alt >= 0 else "-"
    return f"{s_lat}{abs(lat):.4f}{s_lon}{abs(lon):.4f}{s_alt}{abs(alt):.3f}/"


def apply_quicktime_metadata(filepath: Path, profile: dict) -> None:
    """Apply binary + atom + exif metadata. profile keys:
      model: e.g. "iPhone 17 Pro"
      country: key into countries.json (e.g. "USA")
      language: optional override; defaults to country's language
      date_window_days: random date within last N days (default 7)
    """
    countries = load_countries()
    country_key = profile.get("country", "USA")
    cdata = countries.get(country_key, countries["USA"])

    city = random.choice(cdata["cities"])
    lat = round(city["lat"] + random.uniform(-0.05, 0.05), 6)
    lon = round(city["lon"] + random.uniform(-0.05, 0.05), 6)
    altitude = float(random.randint(0, 200))

    iso_qt, iso_exif = _format_dates(
        days_window=int(profile.get("date_window_days", 7)),
        tz_offset_hours=int(cdata.get("tz_offset_hours", 0)),
    )

    iso6709 = _format_iso6709(lat, lon, altitude)
    language = profile.get("language") or cdata["language"]
    model = profile.get("model", "iPhone 17 Pro")

    log.info(
        "Spoofing %s as %s · %s/%s · %s · GPS=%.4f,%.4f",
        filepath.name, model, country_key, city["city"], iso_qt, lat, lon,
    )

    # Each step is independent — wrap to keep partial success.
    try:
        patch_ftyp_to_qt(filepath)
    except Exception as e:
        log.exception("ftyp patch failed: %s", e)

    try:
        write_mp4_atoms(
            filepath,
            model=model,
            creation_iso=iso_qt,
            iso6709=iso6709,
        )
    except Exception as e:
        log.exception("mutagen atoms failed: %s", e)

    try:
        write_exiftool(
            filepath,
            lat=lat,
            lon=lon,
            altitude=altitude,
            country_name=cdata["country_name"],
            country_code=cdata["country_code"],
            city=city["city"],
            state=city.get("state", ""),
            language=language,
            creation_exif=iso_exif,
        )
    except Exception as e:
        log.exception("exiftool failed: %s", e)
