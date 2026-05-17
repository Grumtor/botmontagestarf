"""Render input resolution + ffmpeg invocation, shared by preview and batch.

Resolves a Template's clip references (file_ids → on-disk paths), substitutes
placeholder slots with user-uploaded videos (token → /data/temp/{token}.ext),
gathers font and overlay file paths, then calls into pipeline.build_render_command.
"""

from __future__ import annotations

import copy
import logging
import random
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.db.models import Asset, AssetType, Template
from app.render.pipeline import (
    OUTPUT_H,
    OUTPUT_W,
    ClipInput,
    ExtraClipInput,
    OverlayInput,
    build_render_command,
)
from app.render.text_renderer import (
    cache_key_for_layer,
    render_text_layer_to_png,
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
    extra_clips: list[ExtraClipInput]   # Phase 26b — flattened from extra_tracks
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


# ---- per-render randomization for text layers ----------------------
#
# `placement_mode == "random"` + `placement_zone = {x_pct, y_pct, width_pct, height_pct}`
#   → re-roll x_pct/y_pct so the layer's bbox sits anywhere inside the zone.
#
# `text_pool` non-empty
#   → replace `data.text` with a uniformly random pick from the pool.
#
# Both are independent. Each call to gather_render_inputs() rolls fresh, so
# every output reel in a batch gets its own placement + text variation.

def _collect_zones(data: dict[str, Any]) -> list[dict[str, Any]]:
    """Gather the layer's placement zones. Supports both the legacy
    `placement_zone` (single) and the new `placement_zones` (array)."""
    zones: list[dict[str, Any]] = []
    arr = data.get("placement_zones")
    if isinstance(arr, list):
        for z in arr:
            if isinstance(z, dict):
                zones.append(z)
    legacy = data.get("placement_zone")
    if isinstance(legacy, dict) and legacy not in zones:
        zones.append(legacy)
    return zones


def _randomize_text_layer(layer: dict[str, Any]) -> dict[str, Any]:
    if layer.get("type") != "text":
        return layer

    data = layer.get("data") or {}
    text_pool = data.get("text_pool")
    placement_mode = data.get("placement_mode") or "fixed"
    zones = _collect_zones(data) if placement_mode == "random" else []

    needs_clone = bool(
        (text_pool and isinstance(text_pool, list) and len(text_pool) > 0)
        or zones
    )
    if not needs_clone:
        return layer

    new_layer = copy.deepcopy(layer)
    new_data = new_layer.setdefault("data", {})

    # 1. Random text variation pick
    if text_pool and isinstance(text_pool, list):
        non_empty = [t for t in text_pool if isinstance(t, str) and t.strip()]
        if non_empty:
            new_data["text"] = random.choice(non_empty)

    # 2. Random placement: pick one zone uniformly, then a random position
    # inside it.
    if zones:
        zone = random.choice(zones)
        try:
            zx = float(zone.get("x_pct", 0))
            zy = float(zone.get("y_pct", 0))
            zw = float(zone.get("width_pct", 100))
            zh = float(zone.get("height_pct", 100))
        except (TypeError, ValueError):
            return new_layer

        lw = float(new_layer.get("width_pct", 50))
        lh = float(new_layer.get("height_pct", 30))
        # If the layer bbox is bigger than the zone, just centre it.
        max_dx = max(0.0, zw - lw)
        max_dy = max(0.0, zh - lh)
        new_layer["x_pct"] = round(zx + random.uniform(0.0, max_dx), 4)
        new_layer["y_pct"] = round(zy + random.uniform(0.0, max_dy), 4)

    return new_layer


def _randomize_layers(layers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for l in layers:
        # Backward compat: legacy "snap" layers from removed feature are
        # silently dropped instead of crashing the render.
        if l.get("type") == "snap":
            continue
        out.append(_randomize_text_layer(l))
    return out


# ---- Phase 23 : full-span overlay extension in auto-duration mode -----
# When the template is "all placeholders" (Phase 18 auto-duration), the
# output reel can be longer or shorter than the template's nominal
# duration. Overlays whose timing covers the *entire* template should
# follow that stretch so a 7s upload over a 5s template doesn't end up
# with 2s of bare video. Overlays that only span a slice keep their
# absolute timings (the user picked a specific moment, leave it).

_FULLSPAN_EPS = 0.1   # 100 ms slack so a slider-rolled 4.98 still counts as "5"


def _clip_actual_duration(c: ClipInput) -> float:
    """Effective output duration of a resolved clip — mirrors how the
    pipeline trims/loops it. Used to compute the auto-duration total."""
    if c.target_duration is not None:
        return float(c.target_duration)
    if c.trim_out is not None:
        return max(0.0, float(c.trim_out) - float(c.trim_in))
    return 0.0


def _extend_fullspan_overlays(
    layers: list[dict[str, Any]],
    template_total: float,
    actual_total: float,
) -> list[dict[str, Any]]:
    """Patch end_time on overlays whose [start, end] spans the full
    nominal template duration so they keep covering the whole reel after
    auto-duration changes the output length.

    Detection: start_time ~= 0 AND end_time ~= template_total (with
    `_FULLSPAN_EPS` tolerance so slider rounding doesn't trip us up).
    Overlays not full-span are returned untouched."""
    if template_total <= 0 or actual_total <= 0:
        return layers
    if abs(actual_total - template_total) < 0.01:
        return layers   # nominal == actual, nothing to stretch
    out: list[dict[str, Any]] = []
    for layer in layers:
        try:
            start = float(layer.get("start_time", 0) or 0)
            end = float(layer.get("end_time", 0) or 0)
        except (TypeError, ValueError):
            out.append(layer)
            continue
        if start <= 0.001 and end >= template_total - _FULLSPAN_EPS:
            new_layer = copy.deepcopy(layer)
            new_layer["end_time"] = actual_total
            out.append(new_layer)
        else:
            out.append(layer)
    return out


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
        color_filter = str(clip.get("filter", "none") or "none")
        freeze_tail = max(0.0, float(clip.get("freeze_tail_sec", 0) or 0))

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
                    color_filter=color_filter,
                    freeze_tail_sec=freeze_tail,
                )
            )
        elif ctype == "image":
            file_id = clip.get("file_id")
            if not file_id:
                raise ValueError(f"Image clip {clip.get('id')!r} has no file_id")
            path = _find_with_glob(template_clips_dir(template_id), file_id)
            if path is None:
                raise ValueError(
                    f"Image clip file {file_id!r} missing on disk for template {template_id}"
                )
            target_dur = float(clip.get("duration_sec", 3.0))
            resolved_clips.append(
                ClipInput(
                    path=path,
                    trim_in=0,
                    trim_out=None,
                    audio_enabled=False,
                    audio_volume=0.0,
                    target_duration=target_dur,
                    is_image=True,
                    color_filter=color_filter,
                    freeze_tail_sec=freeze_tail,
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
                    color_filter=color_filter,
                    freeze_tail_sec=freeze_tail,
                )
            )
        else:
            raise ValueError(f"Unknown clip type {ctype!r}")

    if not resolved_clips:
        raise ValueError("Template has no clips to render")

    # ---- Auto-duration mode (Phase 18) ------------------------------
    # When the template is "habillage léger" — i.e. ALL clips are
    # placeholders, no fixed videos and no images — drop the rigid
    # `target_duration` so each placeholder plays at its source video's
    # natural length. The output reel ends up as long as the user-
    # uploaded video (or sample) itself, which is what you want when
    # the template is just text overlays floating over user footage.
    #
    # We ffprobe each source to populate trim_out so the audio chain
    # (silent fallback) matches the video duration in the concat. Image
    # placeholders are excluded — they have no native duration and need
    # the template's `duration_sec` to know how long to loop.
    all_placeholder_template = all(
        c.get("type") == "placeholder" for c in clips_data
    )
    # Phase 28f/g — auto-duration ne s'applique QUE dans 2 conditions :
    #   - render réel (preview = sample globale, on respecte le nominal)
    #   - aucune extra track avec du contenu (pure overlay template)
    # Si l'user a placé des clips sur Track 2/3/etc, il a designé une
    # durée précise pour son montage → on respecte ses placeholder
    # durations. Sinon une vidéo source de 7s ferait dépasser le
    # montage de 6s et on rendrait 1s de "vidéo source toute nue" à
    # la fin, ce qui n'est pas voulu.
    in_preview_mode = fill_missing_placeholders_with is not None
    has_content_extras = any(
        bool(t.get("clips")) for t in (template.extra_tracks or [])
    )
    template_total_duration = 0.0
    actual_total_duration = 0.0
    if (
        all_placeholder_template
        and not in_preview_mode
        and not has_content_extras
    ):
        from app.media import video_metadata

        # Nominal template length = what the user designed for. Used by
        # _extend_fullspan_overlays below to detect overlays that cover
        # the whole reel.
        template_total_duration = sum(
            float(c.get("duration_sec", 3.0)) for c in clips_data
        )

        for c in resolved_clips:
            if c.is_image:
                continue
            try:
                duration, _, _ = video_metadata(c.path)
            except Exception as e:
                log.warning(
                    "auto-duration ffprobe failed for %s: %s — keeping fixed duration",
                    c.path, e,
                )
                continue
            if duration and duration > 0:
                c.target_duration = None
                if c.trim_out is None:
                    c.trim_out = c.trim_in + duration

        # Recompute the actual output length AFTER auto-duration: each
        # placeholder now plays its source's natural duration.
        actual_total_duration = sum(
            _clip_actual_duration(c) for c in resolved_clips
        )

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

    # Re-roll text variation pool + random placement zone for each render.
    # gather_render_inputs() is called once per output assignment, so each
    # reel in a batch gets a fresh tirage.
    randomized_layers = _randomize_layers(layers)

    # Phase 23 — only meaningful in auto-duration mode. When the actual
    # output ends up longer/shorter than the template's nominal length,
    # overlays designed to cover the WHOLE reel (start=0, end=template_total)
    # are stretched to match. Slice overlays keep their absolute timings.
    if all_placeholder_template:
        randomized_layers = _extend_fullspan_overlays(
            randomized_layers,
            template_total=template_total_duration,
            actual_total=actual_total_duration,
        )

    # ---- Phase 26b — extra tracks resolution ------------------------
    # We flatten all clips across all extra tracks into a single list,
    # ordered bottom-up by track index (track index 0 in extra_tracks =
    # rendered first → covered by later tracks), then by start_time
    # within each track. Higher-index tracks are rendered LAST in the
    # pipeline so they end up on top of earlier ones.
    extra_clips_flat: list[ExtraClipInput] = []
    for track in (template.extra_tracks or []):
        track_clips = track.get("clips") or []
        # Sort by start_time so overlays with the same track index are
        # composed left-to-right (just to give a deterministic order;
        # they don't temporally overlap on a single track usually).
        for clip in sorted(
            track_clips, key=lambda c: float(c.get("start_time", 0))
        ):
            ctype = clip.get("type", "fixed")
            audio_enabled_x = bool(clip.get("audio_enabled", True))
            audio_volume_x = float(clip.get("audio_volume", 1.0))
            video_enabled_x = bool(clip.get("video_enabled", True))
            start_time = float(clip.get("start_time", 0))
            color_filter_x = str(clip.get("filter", "none") or "none")
            freeze_tail_x = max(0.0, float(clip.get("freeze_tail_sec", 0) or 0))
            # duration_sec: explicit field wins. For fixed extra clips
            # the frontend stores the timeline duration implicitly via
            # trim_out (see editor.ts addExtraFixedClip), so fall back
            # to trim_out - trim_in. Without this fallback, fixed clips
            # added without manual trimming defaulted to 3.0s and got
            # their audio chopped at 3s in the render pipeline.
            raw_dur = clip.get("duration_sec")
            if raw_dur is not None:
                duration_sec = float(raw_dur)
            else:
                ti = float(clip.get("trim_in") or 0)
                to = clip.get("trim_out")
                duration_sec = (
                    max(0.1, float(to) - ti) if to is not None else 3.0
                )

            if ctype == "fixed" or ctype == "image":
                file_id = clip.get("file_id")
                if not file_id:
                    log.warning(
                        "Extra-track %s clip %r has no file_id; skipping",
                        ctype, clip.get("id"),
                    )
                    continue
                path = _find_with_glob(template_clips_dir(template_id), file_id)
                if path is None:
                    log.warning(
                        "Extra-track %s clip file %s missing; skipping",
                        ctype, file_id,
                    )
                    continue
                is_image = ctype == "image"
                extra_clips_flat.append(
                    ExtraClipInput(
                        path=path,
                        start_time=start_time,
                        duration_sec=duration_sec,
                        trim_in=float(clip.get("trim_in", 0)),
                        trim_out=(
                            float(clip["trim_out"])
                            if clip.get("trim_out") is not None
                            else None
                        ),
                        audio_enabled=False if is_image else audio_enabled_x,
                        audio_volume=0.0 if is_image else audio_volume_x,
                        is_image=is_image,
                        video_enabled=video_enabled_x,
                        color_filter=color_filter_x,
                        freeze_tail_sec=freeze_tail_x,
                    )
                )
            elif ctype == "placeholder":
                # Extra-track placeholders don't fit the current "filled
                # at render-time" workflow (which is keyed by main-track
                # clip ids only). For now they fall back to the global
                # sample placeholder file when present.
                if fill_missing_placeholders_with is None:
                    log.warning(
                        "Extra-track placeholder %r has no fallback; skipping",
                        clip.get("id"),
                    )
                    continue
                fallback = fill_missing_placeholders_with
                if not fallback.is_file():
                    log.warning(
                        "Extra-track placeholder fallback file missing: %s; skipping",
                        fallback,
                    )
                    continue
                extra_clips_flat.append(
                    ExtraClipInput(
                        path=fallback,
                        start_time=start_time,
                        duration_sec=duration_sec,
                        trim_in=float(clip.get("trim_in", 0)),
                        trim_out=(
                            float(clip["trim_out"])
                            if clip.get("trim_out") is not None
                            else None
                        ),
                        audio_enabled=audio_enabled_x,
                        audio_volume=audio_volume_x,
                        video_enabled=video_enabled_x,
                        color_filter=color_filter_x,
                        freeze_tail_sec=freeze_tail_x,
                    )
                )
            else:
                log.warning(
                    "Unknown extra-track clip type %r; skipping", ctype,
                )

    return RenderContext(
        clips=resolved_clips,
        extra_clips=extra_clips_flat,
        overlay_inputs=overlay_inputs,
        overlay_audio_path=overlay_audio_path,
        overlay_audio_config=audio_overlay_cfg,
        layers=randomized_layers,
        font_paths=font_paths,
    )


def _render_text_pngs(
    ctx: "RenderContext",
    output_path: Path,
    output_w: int,
    output_h: int,
) -> dict[str, Path]:
    """Pre-render text layers containing emoji as Pillow PNG overlays —
    ffmpeg's `drawtext` can't fallback fonts so emoji glyphs would render
    as tofu. Each PNG is canvas-sized so the pipeline just `overlay`s it
    at (0,0). Cached by content hash.
    """
    out: dict[str, Path] = {}
    cache_dir = output_path.parent / "_text_pngs"
    for layer in ctx.layers:
        layer_type = layer.get("type")
        layer_id = layer.get("id")
        if not layer_id:
            continue
        data = layer.get("data") or {}

        # ----- Text layer (any) -----
        # Originally we only sent emoji-containing texts through Pillow
        # because plain text could ride drawtext (faster, no extra IO).
        # But on Windows ffmpeg builds with `--enable-libfontconfig`,
        # drawtext crashes hard (0xC0000005 access violation) at filter
        # init even with `fontfile=…` because libfontconfig has no
        # default config to chew on. Pillow has none of that fragility,
        # so we route ALL text through it — pixel-perfect and portable.
        if layer_type == "text":
            text = str(data.get("text") or "")
            if not text:
                continue
            font_id = data.get("font_id", "inter")
            font_path = (
                ctx.font_paths.get(font_id)
                or ctx.font_paths.get("inter")
                or next(iter(ctx.font_paths.values()), None)
            )
            if not font_path:
                log.warning(
                    "text layer %s has emoji but no font path; falling back to drawtext",
                    layer_id,
                )
                continue
            key = cache_key_for_layer(layer, output_w, output_h)
            png_path = cache_dir / f"{key}.png"
            if not png_path.is_file():
                try:
                    rendered = render_text_layer_to_png(
                        layer=layer,
                        font_path=font_path,
                        output_w=output_w,
                        output_h=output_h,
                        out_path=png_path,
                    )
                    if rendered is None:
                        continue
                except Exception as e:
                    log.exception(
                        "render_text_layer_to_png failed for layer %s: %s",
                        layer_id, e,
                    )
                    continue
            out[str(layer_id)] = png_path
            continue

    return out


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
    text_png_inputs = _render_text_pngs(ctx, output_path, OUTPUT_W, OUTPUT_H)
    cmd = build_render_command(
        clips=ctx.clips,
        extra_clips=ctx.extra_clips,
        overlay_inputs=ctx.overlay_inputs,
        overlay_audio_path=ctx.overlay_audio_path,
        overlay_audio_config=ctx.overlay_audio_config,
        layers=ctx.layers,
        font_paths=ctx.font_paths,
        output_path=output_path,
        crf=crf,
        preset=preset,
        text_png_inputs=text_png_inputs,
    )
    log.info("ffmpeg %s", " ".join(cmd))
    try:
        from app.bin_finder import ffmpeg_env
        subprocess.run(
            cmd,
            capture_output=True,
            check=True,
            timeout=timeout,
            env=ffmpeg_env(),
        )
    except subprocess.CalledProcessError as e:
        # ffmpeg may write the actual error on stdout or stderr depending
        # on the issue, and after a long banner. Log BOTH streams in full
        # so we can post-mortem; show the user the meaningful error
        # lines, falling back to the tail.
        stderr = e.stderr.decode("utf-8", errors="replace") if e.stderr else ""
        stdout = e.stdout.decode("utf-8", errors="replace") if e.stdout else ""
        full = stderr + ("\n--- STDOUT ---\n" + stdout if stdout.strip() else "")
        log.error(
            "ffmpeg failed (rc=%s)\nCMD: %s\n--- STDERR ---\n%s\n--- STDOUT ---\n%s",
            e.returncode, " ".join(str(c) for c in cmd), stderr, stdout,
        )

        meaningful: list[str] = []
        for line in full.splitlines():
            ls = line.strip()
            if not ls:
                continue
            low = ls.lower()
            # Skip the harmless banner lines (avoid matching "error" inside e.g. "errors per second")
            if low.startswith("ffmpeg version") or low.startswith("built with") or low.startswith("configuration:") or low.startswith("lib"):
                continue
            if any(kw in low for kw in ("error", "invalid", "failed", "no such", "could not", "unknown", "unable", "permission")):
                meaningful.append(ls)

        if not meaningful:
            tail = [ln for ln in full.splitlines() if ln.strip()][-8:]
            meaningful = tail

        msg = " | ".join(meaningful[-3:]) if meaningful else f"unknown error (rc={e.returncode})"
        raise RuntimeError(f"ffmpeg failed: {msg[:800]}") from e
