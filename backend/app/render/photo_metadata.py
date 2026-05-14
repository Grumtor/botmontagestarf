"""Photo EXIF/XMP metadata spoofing — same spirit as the QuickTime metadata
spoofer for videos, but for still images.

For each photo in a batch we tirage **independently**:
  - DateTimeOriginal / DateTimeDigitized / DateTime — random in window
  - GPS lat/lon/alt — jiggled around the chosen city's coords
  - Lens (focal length, aperture) — random pick from the model's lens list
  - ISO, ExposureTime, FNumber — realistic ranges per model
  - WhiteBalance / ExposureMode / MeteringMode — sensible iPhone defaults
  - Filesystem mtime aligned with DateTimeOriginal

So 50 photos in a batch all look like they were captured at slightly
different times in slightly different spots, with slightly different camera
settings — credible iPhone shooting session.

Output preserves the input format (JPEG → JPEG, HEIC → HEIC, PNG → PNG).
exiftool handles all common formats, no pixel data ever touched.
"""

from __future__ import annotations

import json
import logging
import os
import random
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.bin_finder import exiftool_exe
from app.render.exiftool_batch import BatchExifTool

log = logging.getLogger(__name__)

COUNTRIES_PATH = Path(__file__).parent / "countries.json"
LENSES_PATH = Path(__file__).parent / "iphone_lenses.json"
SOFTWARE_VERSION = "iOS 18.2.1"
DEFAULT_MODEL = "iPhone 17 Pro"
DEFAULT_LENSES = {
    "lenses": [
        {
            "label": "iPhone back triple camera 7.0mm f/1.78",
            "focal_real": 7.0,
            "focal_35mm": 24,
            "aperture": 1.78,
        }
    ],
    "iso_min": 24,
    "iso_max": 3200,
    "shutter_min_us": 1000,
    "shutter_max_us": 33333,
}


def _load_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


# ---- per-photo random profile ----------------------------------------


def _pick_creation_dt(date_window_days: int, tz_offset_hours: int) -> datetime:
    seconds_back = random.uniform(0, max(1, date_window_days) * 86400)
    tz = timezone(timedelta(hours=tz_offset_hours))
    return datetime.now(tz) - timedelta(seconds=seconds_back)


def _format_exif_dt(dt: datetime) -> str:
    """exiftool format with timezone, e.g. '2026:05:03 14:23:45+02:00'."""
    base = dt.strftime("%Y:%m:%d %H:%M:%S")
    offset = dt.strftime("%z") or "+0000"
    return f"{base}{offset[:3]}:{offset[3:]}"


def _format_subsec(dt: datetime) -> str:
    """SubSecTime format (3-digit fractional second)."""
    return f"{dt.microsecond // 1000:03d}"


def _shutter_to_apex(seconds: float) -> str:
    """ShutterSpeedValue is APEX. APEX = log2(1/seconds)."""
    import math

    if seconds <= 0:
        return "0"
    return f"{math.log2(1.0 / seconds):.4f}"


def _aperture_to_apex(fnum: float) -> str:
    """ApertureValue APEX = 2 * log2(fnum)."""
    import math

    if fnum <= 0:
        return "0"
    return f"{2 * math.log2(fnum):.4f}"


# ---- exiftool invocation ---------------------------------------------


def _build_exiftool_args(
    filepath: Path,
    *,
    model: str,
    country_data: dict,
    lens_data: dict,
    date_window_days: int,
    language: str,
) -> tuple[list[str], datetime]:
    cdata = country_data
    city = random.choice(cdata["cities"])

    # GPS jiggle: a few hundred meters of variability across photos in the
    # same batch (~0.005° ≈ 500 m at the equator).
    lat = round(city["lat"] + random.uniform(-0.005, 0.005), 6)
    lon = round(city["lon"] + random.uniform(-0.005, 0.005), 6)
    altitude = round(random.uniform(2.0, 80.0), 2)

    creation_dt = _pick_creation_dt(date_window_days, int(cdata.get("tz_offset_hours", 0)))
    creation_exif = _format_exif_dt(creation_dt)
    subsec = _format_subsec(creation_dt)

    lens = random.choice(lens_data["lenses"])
    iso = random.randint(int(lens_data["iso_min"]), int(lens_data["iso_max"]))
    shutter_us = random.randint(int(lens_data["shutter_min_us"]), int(lens_data["shutter_max_us"]))
    shutter_sec = shutter_us / 1_000_000.0
    fnumber = float(lens["aperture"])
    focal_real = float(lens["focal_real"])
    focal_35 = int(lens["focal_35mm"])

    # Realistic iPhone defaults — same values shown in iOS Photos for
    # almost every shot (auto-WB, pattern metering, normal exposure).
    args: list[str] = [
        exiftool_exe(),
        "-overwrite_original",
        "-q",
        "-q",
        # Make / Model / Software
        "-Make=Apple",
        f"-Model={model}",
        f"-Software={SOFTWARE_VERSION}",
        f"-HostComputer={model}",
        # Dates (every flavour exiftool knows about)
        f"-DateTimeOriginal={creation_exif}",
        f"-CreateDate={creation_exif}",
        f"-ModifyDate={creation_exif}",
        f"-DateTimeDigitized={creation_exif}",
        f"-OffsetTime={creation_exif[-6:]}",
        f"-OffsetTimeOriginal={creation_exif[-6:]}",
        f"-OffsetTimeDigitized={creation_exif[-6:]}",
        f"-SubSecTime={subsec}",
        f"-SubSecTimeOriginal={subsec}",
        f"-SubSecTimeDigitized={subsec}",
        # Lens
        f"-LensMake=Apple",
        f"-LensModel={lens['label']}",
        f"-FocalLength={focal_real} mm",
        f"-FocalLengthIn35mmFormat={focal_35}",
        f"-FNumber={fnumber}",
        f"-ApertureValue={_aperture_to_apex(fnumber)}",
        f"-MaxApertureValue={_aperture_to_apex(fnumber)}",
        # Exposure
        f"-ExposureTime={shutter_sec:.6f}",
        f"-ShutterSpeedValue={_shutter_to_apex(shutter_sec)}",
        f"-ISO={iso}",
        f"-ISOSpeedRatings={iso}",
        "-ExposureProgram=Program AE",
        "-ExposureMode=Auto",
        "-MeteringMode=MultiSegment",
        "-WhiteBalance=Auto",
        "-Flash=Off, Did not fire",
        "-LightSource=Unknown",
        "-SceneCaptureType=Standard",
        "-SceneType=Directly photographed",
        "-CustomRendered=Normal",
        "-DigitalZoomRatio=1",
        "-FocalPlaneXResolution=2835",
        "-FocalPlaneYResolution=2835",
        "-FocalPlaneResolutionUnit=cm",
        # Color / orientation
        "-ColorSpace=sRGB",
        "-ExifImageWidth<ImageWidth",
        "-ExifImageHeight<ImageHeight",
        # GPS
        f"-GPSLatitude={abs(lat):.6f}",
        f"-GPSLatitudeRef={'N' if lat >= 0 else 'S'}",
        f"-GPSLongitude={abs(lon):.6f}",
        f"-GPSLongitudeRef={'E' if lon >= 0 else 'W'}",
        f"-GPSAltitude={altitude:.3f}",
        f"-GPSAltitudeRef={'0' if altitude >= 0 else '1'}",
        f"-GPSPosition={lat:.6f} {lon:.6f}",
        f"-GPSDateStamp={creation_dt.strftime('%Y:%m:%d')}",
        f"-GPSTimeStamp={creation_dt.strftime('%H:%M:%S')}",
        "-GPSSpeedRef=K",
        "-GPSSpeed=0",
        "-GPSImgDirectionRef=T",
        f"-GPSImgDirection={random.randint(0, 359)}",
        "-GPSDestBearingRef=T",
        f"-GPSDestBearing={random.randint(0, 359)}",
        # Country / city / language
        f"-Country={cdata['country_name']}",
        f"-Country-PrimaryLocationName={cdata['country_name']}",
        f"-CountryCode={cdata['country_code']}",
        f"-City={city['city']}",
        f"-State={city.get('state', '')}",
        f"-Sub-location={city['city']}",
        f"-Location={city['city']}",
        f"-XMP:Country={cdata['country_name']}",
        f"-XMP:CountryCode={cdata['country_code']}",
        f"-XMP:City={city['city']}",
        f"-XMP:State={city.get('state', '')}",
        f"-XMP:Location={city['city']}",
        f"-Language={language}",
        # Convenient summary in the IPTC keywords (some apps inspect them)
        f"-XMP:CreatorTool={SOFTWARE_VERSION}",
        str(filepath),
    ]
    return args, creation_dt


def apply_photo_metadata(
    filepath: Path,
    profile: dict,
    batch_tool: "BatchExifTool | None" = None,
) -> dict:
    """Spoof EXIF/XMP metadata for one image. profile keys:
      model: e.g. "iPhone 17 Pro"
      country: key into countries.json (e.g. "USA")
      language: optional override; defaults to the country's language
      date_window_days: random date within the last N days (default 7)

    When `batch_tool` is provided (a long-lived exiftool process started
    by the caller via `with BatchExifTool() as bt`), we send the args
    through it instead of spawning a fresh `exiftool.exe` per call.
    Saves ~250 ms / photo on Windows. The one-shot path stays as
    fallback so this function is still safe to call standalone.

    Returns a small dict describing the rolled values (for logging/debug).
    Each call independently randomises everything.
    """
    countries = _load_json(COUNTRIES_PATH)
    lenses = _load_json(LENSES_PATH)

    model = profile.get("model") or DEFAULT_MODEL
    country_key = profile.get("country") or "USA"
    cdata = countries.get(country_key, countries["USA"])
    lens_data = lenses.get(model, DEFAULT_LENSES)
    language = profile.get("language") or cdata["language"]
    date_window_days = int(profile.get("date_window_days", 7))

    args, creation_dt = _build_exiftool_args(
        filepath,
        model=model,
        country_data=cdata,
        lens_data=lens_data,
        date_window_days=date_window_days,
        language=language,
    )

    if batch_tool is not None:
        # Skip args[0] (the exiftool exe) and the duplicate `-overwrite_original`,
        # `-q`, `-q` flags — those are already passed via `-common_args` in
        # BatchExifTool's launch command.
        skip = {"-overwrite_original", "-q"}
        batch_args = [a for a in args[1:] if a not in skip]
        ok, err = batch_tool.run(batch_args)
        if not ok:
            log.warning("batch exiftool failed on %s: %s", filepath, err[:500])
    else:
        try:
            result = subprocess.run(args, capture_output=True, text=True)
        except FileNotFoundError as exc:
            raise RuntimeError(
                "exiftool n'est pas installé ou pas dans le PATH. "
                "Installe-le : Windows `scoop install exiftool` · "
                "macOS `brew install exiftool` · "
                "Linux `apt install libimage-exiftool-perl`"
            ) from exc

        if result.returncode != 0:
            log.warning(
                "exiftool returned %s on %s. stderr=%s",
                result.returncode, filepath, result.stderr[-500:],
            )

    # Align filesystem mtime with the EXIF date.
    try:
        ts = creation_dt.timestamp()
        os.utime(filepath, (ts, ts))
    except Exception as e:
        log.warning("os.utime failed on %s: %s", filepath, e)

    return {
        "model": model,
        "country": country_key,
        "creation": creation_dt.isoformat(),
    }
