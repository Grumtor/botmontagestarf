import json
import subprocess
from pathlib import Path
from typing import Optional


class MediaError(Exception):
    """Raised when ffprobe or ffmpeg fails."""


def ffprobe(path: Path) -> dict:
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-print_format",
                "json",
                "-show_format",
                "-show_streams",
                str(path),
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        return json.loads(result.stdout)
    except subprocess.CalledProcessError as e:
        raise MediaError(f"ffprobe failed: {e.stderr[:200]}") from e
    except json.JSONDecodeError as e:
        raise MediaError(f"ffprobe returned invalid JSON: {e}") from e


def video_metadata(
    path: Path,
) -> tuple[Optional[float], Optional[int], Optional[int]]:
    """Returns (duration_sec, width, height). Any of them can be None."""
    info = ffprobe(path)

    duration: Optional[float] = None
    fmt = info.get("format", {})
    if "duration" in fmt:
        try:
            duration = float(fmt["duration"])
        except (TypeError, ValueError):
            duration = None

    width: Optional[int] = None
    height: Optional[int] = None
    for stream in info.get("streams", []):
        if stream.get("codec_type") == "video":
            width = stream.get("width")
            height = stream.get("height")
            break

    return duration, width, height


def make_video_thumb(
    video_path: Path, thumb_path: Path, width: int = 540, height: int = 960
) -> None:
    """Extracts 1 frame at ~1s, scales to {width}x{height} with letterbox padding."""
    vf = (
        f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
        f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:black"
    )
    try:
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-ss",
                "1",
                "-i",
                str(video_path),
                "-vframes",
                "1",
                "-vf",
                vf,
                "-q:v",
                "2",
                str(thumb_path),
            ],
            capture_output=True,
            check=True,
        )
    except subprocess.CalledProcessError as e:
        msg = e.stderr.decode("utf-8", errors="replace")[-200:]
        raise MediaError(f"ffmpeg failed: {msg}") from e
