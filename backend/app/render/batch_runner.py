"""Render input resolution + ffmpeg invocation, shared by preview and batch.

Resolves a Template's clip references (file_ids → on-disk paths), substitutes
placeholder slots with user-uploaded videos (token → /data/temp/{token}.ext),
gathers font and overlay file paths, then calls into pipeline.build_render_command.
"""

from __future__ import annotations

import logging
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.db.models import Asset, AssetType, Template
from app.render.pipeline import (
    ClipInput,
    OverlayInput,
    build_render_command,
)
from app.storage import (
    PLACEHOLDER_PREVIEW_PATH,
    TEMP_DIR,
    builtin_font_path,
    template_clips_dir,
    template_overlays_dir,
)

log = logging.getLogger(__name__)


@dataclass
class RenderContext:
    clips: list[ClipInput]
    overlay_inputs: dict[str, OverlayInput]   # layer_id → OverlayInput
    overlay_audio_path: Optional[Path]
    overlay_audio_config: dict
    layers: list[dict]
    font_paths: dict[Any, Path]


def _find_with_glob(base: Path, file_id: str) -> Optional[Path]:
    for p in base.glob(f"{file_id}.*"):
        return p
    return None


def _resolve_token(token: str) -> Optional[Path]:
    for p in TEMP_DIR.glob(f"{token}.*"):
        return p
    return None


def gather_render_inputs(
    db: Session,
    template: Template,
    fills: dict[str, str],
    *,
    fill_missing_placeholders_with: Optional[Path] = None,
) -> RenderContext:
    """Resolve all file references for one render.
    fills: { placeholder clip_id → upload token }
    fill_missing_placeholders_with: if set, placeholders without a fill use
      this video instead of raising. Used for preview rendering of a template
      that hasn't been filled yet."""
    template_id = template.id
    clips_data = list(template.clips or [])

    resolved_clips: list[ClipInput] = []
    for clip in clips_data:
        ctype = clip.get("type", "fixed")
        audio_enabled = bool(clip.get("audio_enabled", True))
        audio_volume = float(clip.get("audio_volume", 1.0))

        if ctype == "fixed":
            file_id = clip.get("file_id")
            if not file_id:
                raise ValueError(f"Fixed clip {clip.get('id')!r} has no file_id")
            path = _find_with_glob(template_clips_dir(template_id), file_id)
            if path is None:
                raise ValueError(
                    f"Fixed clip file {file_id!r} missing on disk for template {template_id}"
                )
            resolved_clips.append(
                ClipInput(
                    path=path,
                    trim_in=float(clip.get("trim_in", 0)),
                    trim_out=(
                        float(clip["trim_out"])
                        if clip.get("trim_out") is not None
                        else None
                    ),
                    audio_enabled=audio_enabled,
                    audio_volume=audio_volume,
                )
            )
        elif ctype == "placeholder":
            clip_id = clip.get("id")
            token = fills.get(clip_id)
            path: Optional[Path] = None
            if token:
                path = _resolve_token(token)
                if path is None:
                    raise ValueError(f"Upload token {token!r} not found in /data/temp")
            else:
                if fill_missing_placeholders_with is None:
                    raise ValueError(f"No fill provided for placeholder clip {clip_id!r}")
                path = fill_missing_placeholders_with
                if not path.is_file():
                    raise ValueError(
                        f"Placeholder fallback file missing: {path}"
                    )
            target_dur = float(clip.get("duration_sec", 3.0))
            resolved_clips.append(
                ClipInput(
                    path=path,
                    trim_in=float(clip.get("trim_in", 0)),
                    trim_out=(
                        float(clip["trim_out"])
                        if clip.get("trim_out") is not None
                        else None
                    ),
                    audio_enabled=audio_enabled,
                    audio_volume=audio_volume,
                    target_duration=target_dur,
                )
            )
        else:
            raise ValueError(f"Unknown clip type {ctype!r}")

    if not resolved_clips:
        raise ValueError("Template has no clips to render")

    # Visual overlays needing a file input
    layers = list(template.layers or [])
    overlay_inputs: dict[str, OverlayInput] = {}
    for layer in layers:
        ltype = layer.get("type")
        if ltype not in ("image", "gif", "emoji"):
            continue
        data = layer.get("data") or {}
        file_id = data.get("file_id")
        if not file_id:
            continue
        path = _find_with_glob(template_overlays_dir(template_id), file_id)
        if path is None:
            log.warning(
                "Overlay file %s for layer %s missing; skipping",
                file_id, layer.get("id"),
            )
            continue
        overlay_inputs[layer["id"]] = OverlayInput(
            path=path, is_animated=(ltype == "gif")
        )

    # Audio overlay
    audio_overlay_cfg = dict(template.audio_overlay or {})
    overlay_audio_path: Optional[Path] = None
    audio_file_id = audio_overlay_cfg.get("file_id")
    if audio_file_id:
        overlay_audio_path = _find_with_glob(
            template_overlays_dir(template_id), audio_file_id
        )

    # Fonts referenced by text layers
    font_paths: dict[Any, Path] = {}
    for layer in layers:
        if layer.get("type") != "text":
            continue
        font_id = (layer.get("data") or {}).get("font_id", "inter")
        if font_id in font_paths:
            continue
        path: Optional[Path] = None
        if isinstance(font_id, str):
            path = builtin_font_path(font_id)
        elif isinstance(font_id, int):
            asset = db.get(Asset, font_id)
            if asset and asset.type == AssetType.font:
                path = Path(asset.file_path)
        if path and path.is_file():
            font_paths[font_id] = path
    if "inter" not in font_paths:
        p = builtin_font_path("inter")
        if p and p.is_file():
            font_paths["inter"] = p

    return RenderContext(
        clips=resolved_clips,
        overlay_inputs=overlay_inputs,
        overlay_audio_path=overlay_audio_path,
        overlay_audio_config=audio_overlay_cfg,
        layers=layers,
        font_paths=font_paths,
    )


def run_render(
    *,
    template: Template,
    ctx: RenderContext,
    output_path: Path,
    crf: int = 18,
    preset: str = "slow",
    timeout: int = 1800,
) -> None:
    """Invoke ffmpeg synchronously; raise on failure."""
    cmd = build_render_command(
        clips=ctx.clips,
        overlay_inputs=ctx.overlay_inputs,
        overlay_audio_path=ctx.overlay_audio_path,
        overlay_audio_config=ctx.overlay_audio_config,
        layers=ctx.layers,
        font_paths=ctx.font_paths,
        output_path=output_path,
        crf=crf,
        preset=preset,
    )
    log.info("ffmpeg %s", " ".join(cmd))
    try:
        subprocess.run(cmd, capture_output=True, check=True, timeout=timeout)
    except subprocess.CalledProcessError as e:
        stderr = e.stderr.decode("utf-8", errors="replace")[-1500:]
        log.error("ffmpeg failed:\n%s", stderr)
        raise RuntimeError(
            f"ffmpeg failed: {stderr.splitlines()[-1] if stderr else 'unknown'}"
        ) from e
