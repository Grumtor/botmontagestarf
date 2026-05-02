"""Central ffmpeg pipeline.

build_filter_complex(template, **ctx) is the single function that converts a
template into an ffmpeg filter graph. Used by:

    - POST /api/render/preview  (fast, 720p, no overlays)
    - process_render_job task   (full quality, all overlays)

Pipeline order:
  1. Source segments → trim each + concat
  2. Effect layers (with timeline enable)
  3. Animation layers (zoom/pan/shake expressions)
  4. Final scale + crop to output WxH
  5. Visual overlays in z_index order:
        - text  → drawtext (highlight via box=1, stroke via bordercolor)
        - image / gif / emoji → scale [+ rotate] + overlay
  6. Audio chain (source per-segment trim+concat+volume + overlay adelay,
                  optional amix)
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Optional

OUTPUT_W = 720
OUTPUT_H = 1280


# ---- escapes ----------------------------------------------------------

def _esc_drawtext(text: str) -> str:
    """Escape arbitrary text for an unquoted drawtext text= value."""
    out: list[str] = []
    for ch in text:
        if ch in "\\:,'%":
            out.append("\\" + ch)
        else:
            out.append(ch)
    return "".join(out)


def _esc_path(path: str) -> str:
    """Escape a fontfile path for drawtext."""
    return path.replace("\\", "\\\\").replace(":", "\\:")


# ---- effects ----------------------------------------------------------

def _effect_filter(layer: dict) -> Optional[str]:
    data = layer.get("data") or {}
    kind = data.get("type", "saturation")
    force = float(data.get("force", 0))
    if kind == "saturation":
        sat = max(0.0, 1.0 + force / 100.0)
        return f"eq=saturation={sat:.3f}"
    if kind == "brightness":
        b = max(-1.0, min(1.0, force / 100.0))
        return f"eq=brightness={b:.3f}"
    if kind == "contrast":
        c = max(0.0, 1.0 + force / 100.0)
        return f"eq=contrast={c:.3f}"
    if kind == "vignette":
        return "vignette=PI/4"
    if kind == "blur":
        r = max(0.0, min(20.0, force / 100.0 * 20))
        return f"boxblur={r:.2f}:1"
    return None


def _animation_filter(layer: dict) -> Optional[str]:
    data = layer.get("data") or {}
    preset = data.get("preset", "zoom_in_slow")
    force = float(data.get("force", 1.0))
    if preset == "zoom_in_slow":
        return _zoom_crop(f"(1+{0.05 * force:.4f}*t)")
    if preset == "zoom_in_punch":
        return _zoom_crop(f"(1+{0.5 * force:.4f}*(1-exp(-3*t)))")
    if preset == "zoom_out_slow":
        return _zoom_crop(f"max(1\\,{1 + 0.3 * force:.3f}-{0.05 * force:.4f}*t)")
    if preset == "pan_left_right":
        rate = 0.05 * force
        return (
            "crop=w='iw*0.85':h='ih':"
            f"x='min(iw-out_w\\,iw*{rate:.4f}*t)':y='0'"
        )
    if preset == "pan_right_left":
        rate = 0.05 * force
        return (
            "crop=w='iw*0.85':h='ih':"
            f"x='max(0\\,iw-out_w-iw*{rate:.4f}*t)':y='0'"
        )
    if preset == "shake":
        amp = 8 * force
        return (
            "crop=w='iw-20':h='ih-20':"
            f"x='10+{amp:.2f}*sin(t*30)':y='10+{amp:.2f}*cos(t*30)'"
        )
    return None


def _zoom_crop(z_expr: str) -> str:
    return (
        f"crop=w='iw/{z_expr}':h='ih/{z_expr}':"
        f"x='(iw-iw/{z_expr})/2':y='(ih-ih/{z_expr})/2'"
    )


# ---- video chain (segments + effects + animations + scale) ------------

def _build_video_chains(template: dict, output_w: int, output_h: int) -> list[str]:
    layers = template.get("layers") or []
    segments = template.get("source_segments") or []

    chains: list[str] = []

    if segments:
        seg_labels = []
        for i, seg in enumerate(segments):
            in_t = float(seg.get("in_time", 0))
            out_t = float(seg.get("out_time", 0))
            label = f"sv{i}"
            chains.append(
                f"[0:v]trim=start={in_t}:end={out_t},setpts=PTS-STARTPTS[{label}]"
            )
            seg_labels.append(f"[{label}]")
        if len(segments) == 1:
            chains.append(f"{seg_labels[0]}null[base]")
        else:
            chains.append(
                f"{''.join(seg_labels)}concat=n={len(segments)}:v=1:a=0[base]"
            )
    else:
        chains.append("[0:v]setpts=PTS-STARTPTS[base]")

    current = "base"
    for i, layer in enumerate(l for l in layers if l.get("type") == "effect"):
        flt = _effect_filter(layer)
        if not flt:
            continue
        next_label = f"e{i}"
        start = float(layer.get("start_time", 0))
        end = float(layer.get("end_time", 0))
        chains.append(
            f"[{current}]{flt}:enable='between(t\\,{start}\\,{end})'[{next_label}]"
        )
        current = next_label

    for i, layer in enumerate(l for l in layers if l.get("type") == "animation"):
        flt = _animation_filter(layer)
        if not flt:
            continue
        next_label = f"a{i}"
        chains.append(f"[{current}]{flt}[{next_label}]")
        current = next_label

    chains.append(
        f"[{current}]scale={output_w}:{output_h}:force_original_aspect_ratio=increase,"
        f"crop={output_w}:{output_h}[scaled]"
    )
    return chains


# ---- visual overlays --------------------------------------------------

def _drawtext_filter(
    layer: dict,
    font_path: Path,
    output_w: int,
    output_h: int,
    text: str,
) -> str:
    data = layer.get("data") or {}
    font_size = max(8, int(float(data.get("font_size_pct", 5)) / 100 * output_h))
    color = str(data.get("color", "#FFFFFF")).lstrip("#")

    x_pct = float(layer.get("x_pct", 25))
    y_pct = float(layer.get("y_pct", 35))
    w_pct = float(layer.get("width_pct", 50))
    h_pct = float(layer.get("height_pct", 30))

    align = data.get("align", "center")
    if align == "left":
        x_expr = f"(w*{x_pct / 100:.4f})"
    elif align == "right":
        x_expr = f"(w*{(x_pct + w_pct) / 100:.4f})-tw"
    else:
        x_expr = f"(w*{(x_pct + w_pct / 2) / 100:.4f})-tw/2"
    y_expr = f"(h*{(y_pct + h_pct / 2) / 100:.4f})-th/2"

    opts = [
        f"fontfile={_esc_path(str(font_path))}",
        f"text={_esc_drawtext(text)}",
        f"fontsize={font_size}",
        f"fontcolor=0x{color}",
        f"x={x_expr}",
        f"y={y_expr}",
    ]

    style = data.get("style", "plain")
    if style == "highlight":
        hl = str(data.get("highlight_color", "#FFEB3B")).lstrip("#")
        pad = int(data.get("highlight_padding", 6))
        opts.append("box=1")
        opts.append(f"boxcolor=0x{hl}")
        opts.append(f"boxborderw={max(0, pad)}")
    elif style == "stroke":
        sc = str(data.get("stroke_color", "#000000")).lstrip("#")
        sw = int(float(data.get("stroke_width", 4)))
        opts.append(f"bordercolor=0x{sc}")
        opts.append(f"borderw={max(1, sw)}")

    start = float(layer.get("start_time", 0))
    end = float(layer.get("end_time", 0))
    opts.append(f"enable='between(t\\,{start}\\,{end})'")

    return "drawtext=" + ":".join(opts)


def _resolve_text(
    layer: dict, pools: dict[str, list[str]], pool_index: int
) -> str:
    data = layer.get("data") or {}
    fallback = str(data.get("text", ""))
    pool = pools.get(layer.get("id"), []) if pools else []
    valid = [v for v in pool if v.strip()]
    if not valid:
        return fallback
    return valid[pool_index % len(valid)]


def _resolve_font_path(
    layer: dict, font_paths: dict[Any, Path]
) -> Optional[Path]:
    if not font_paths:
        return None
    data = layer.get("data") or {}
    font_id = data.get("font_id", "inter")
    if font_id in font_paths:
        return font_paths[font_id]
    if "inter" in font_paths:
        return font_paths["inter"]
    return next(iter(font_paths.values()), None)


# ---- audio chain ------------------------------------------------------

def _build_audio_chains(
    template: dict, has_overlay_input: bool, overlay_audio_idx: int
) -> tuple[list[str], Optional[str]]:
    audio_source = template.get("audio_source") or {}
    audio_overlay = template.get("audio_overlay") or {}
    segments = template.get("source_segments") or []

    src_enabled = bool(audio_source.get("enabled", True))
    src_volume = float(audio_source.get("volume", 1.0))
    overlay_volume = float(audio_overlay.get("volume", 1.0))
    overlay_start = float(audio_overlay.get("start_offset", 0.0))
    overlay_trim = float(audio_overlay.get("trim_in", 0.0))

    chains: list[str] = []
    src_label: Optional[str] = None
    overlay_label: Optional[str] = None

    if src_enabled:
        if segments:
            seg_a_labels = []
            for i, seg in enumerate(segments):
                in_t = float(seg.get("in_time", 0))
                out_t = float(seg.get("out_time", 0))
                label = f"sa{i}"
                chains.append(
                    f"[0:a]atrim=start={in_t}:end={out_t},asetpts=PTS-STARTPTS[{label}]"
                )
                seg_a_labels.append(f"[{label}]")
            if len(segments) == 1:
                chains.append(f"{seg_a_labels[0]}anull[base_a]")
            else:
                chains.append(
                    f"{''.join(seg_a_labels)}concat=n={len(segments)}:v=0:a=1[base_a]"
                )
        else:
            chains.append("[0:a]asetpts=PTS-STARTPTS[base_a]")
        chains.append(f"[base_a]volume={src_volume:.3f}[src_a]")
        src_label = "src_a"

    if has_overlay_input:
        chain = (
            f"[{overlay_audio_idx}:a]atrim=start={overlay_trim:.3f},"
            "asetpts=PTS-STARTPTS"
        )
        chain += f",volume={overlay_volume:.3f}"
        delay_ms = max(0, int(overlay_start * 1000))
        if delay_ms > 0:
            chain += f",adelay={delay_ms}:all=1"
        chain += "[ovl_a]"
        chains.append(chain)
        overlay_label = "ovl_a"

    if src_label and overlay_label:
        chains.append(
            f"[{src_label}][{overlay_label}]"
            "amix=inputs=2:duration=first:dropout_transition=0[mix_a]"
        )
        return chains, "mix_a"
    if src_label:
        return chains, src_label
    if overlay_label:
        return chains, overlay_label
    return chains, None


# ---- public API -------------------------------------------------------

def build_filter_complex(
    template: dict,
    *,
    has_overlay_audio: bool = False,
    overlay_audio_idx: int = 1,
    visual_inputs: Optional[dict[str, int]] = None,
    font_paths: Optional[dict[Any, Path]] = None,
    pools: Optional[dict[str, list[str]]] = None,
    pool_index: int = 0,
    output_w: int = OUTPUT_W,
    output_h: int = OUTPUT_H,
) -> tuple[str, str, Optional[str]]:
    """Returns (filter_complex_string, video_label, audio_label_or_None)."""
    visual_inputs = visual_inputs or {}
    font_paths = font_paths or {}
    pools = pools or {}

    chains = _build_video_chains(template, output_w, output_h)

    layers = template.get("layers") or []
    overlay_layers = [
        l for l in layers if l.get("type") in ("text", "image", "gif", "emoji")
    ]
    overlay_layers.sort(key=lambda l: l.get("z_index", 0))

    current = "scaled"
    for i, layer in enumerate(overlay_layers):
        layer_type = layer.get("type")

        if layer_type == "text":
            font_path = _resolve_font_path(layer, font_paths)
            if font_path is None:
                continue
            text = _resolve_text(layer, pools, pool_index)
            if not text:
                continue
            next_label = f"tx{i}"
            chains.append(
                f"[{current}]{_drawtext_filter(layer, font_path, output_w, output_h, text)}[{next_label}]"
            )
            current = next_label
            continue

        # image / gif / emoji
        input_idx = visual_inputs.get(layer.get("id"))
        if input_idx is None:
            continue

        data = layer.get("data") or {}
        opacity = max(0.0, min(1.0, float(data.get("opacity", 1.0))))
        rotation = float(data.get("rotation_deg", 0))

        layer_w = max(1, int(float(layer.get("width_pct", 30)) / 100 * output_w))
        layer_h = max(1, int(float(layer.get("height_pct", 30)) / 100 * output_h))
        x_px = int(float(layer.get("x_pct", 25)) / 100 * output_w)
        y_px = int(float(layer.get("y_pct", 25)) / 100 * output_h)

        scale_label = f"sc{i}"
        scale_chain = (
            f"[{input_idx}:v]scale={layer_w}:{layer_h}:flags=fast_bilinear,"
            f"format=rgba,colorchannelmixer=aa={opacity:.3f}"
        )
        if rotation != 0:
            rad = rotation * 3.141592653589793 / 180
            scale_chain += (
                f",rotate={rad:.4f}:c=none:"
                f"ow=rotw({rad:.4f}):oh=roth({rad:.4f})"
            )
        scale_chain += f"[{scale_label}]"
        chains.append(scale_chain)

        next_label = f"ov{i}"
        start = float(layer.get("start_time", 0))
        end = float(layer.get("end_time", 0))
        chains.append(
            f"[{current}][{scale_label}]overlay=x={x_px}:y={y_px}:"
            f"enable='between(t\\,{start}\\,{end})'[{next_label}]"
        )
        current = next_label

    if current != "out":
        chains.append(f"[{current}]copy[out]")

    audio_chains, audio_label = _build_audio_chains(
        template, has_overlay_audio, overlay_audio_idx
    )
    chains.extend(audio_chains)

    return ";".join(chains), "out", audio_label


def build_ffmpeg_command(
    template: dict,
    source_path: Path,
    output_path: Path,
    *,
    overlay_audio_path: Optional[Path] = None,
    crf: int = 28,
    preset: str = "ultrafast",
) -> list[str]:
    """Preview command — fast, 720p, no visual overlays."""
    has_overlay = overlay_audio_path is not None
    inputs: list[str] = ["-i", str(source_path)]
    if has_overlay:
        inputs.extend(["-i", str(overlay_audio_path)])

    fc, video_label, audio_label = build_filter_complex(
        template,
        has_overlay_audio=has_overlay,
        overlay_audio_idx=1,
    )

    args: list[str] = ["ffmpeg", "-y", *inputs, "-filter_complex", fc]
    args.extend(["-map", f"[{video_label}]"])
    if audio_label:
        args.extend(["-map", f"[{audio_label}]", "-c:a", "aac", "-b:a", "128k"])
    else:
        args.append("-an")
    args.extend(
        [
            "-c:v",
            "libx264",
            "-preset",
            preset,
            "-crf",
            str(crf),
            "-pix_fmt",
            "yuv420p",
            "-shortest",
            str(output_path),
        ]
    )
    return args


def build_batch_render_command(
    template: dict,
    source_path: Path,
    output_path: Path,
    *,
    overlay_audio_path: Optional[Path] = None,
    asset_paths: dict[int, Path],
    font_paths: dict[Any, Path],
    pools: dict[str, list[str]],
    pool_index: int = 0,
    output_w: int = 1080,
    output_h: int = 1920,
    fps: int = 30,
    crf: int = 18,
    preset: str = "slow",
    audio_bitrate: str = "192k",
) -> list[str]:
    """Full-quality batch render. Includes drawtext + image/gif overlays."""
    layers = template.get("layers") or []

    inputs: list[str] = ["-i", str(source_path)]
    next_idx = 1

    overlay_audio_idx = next_idx
    if overlay_audio_path:
        inputs.extend(["-i", str(overlay_audio_path)])
        next_idx += 1

    visual_inputs: dict[str, int] = {}
    for layer in layers:
        if layer.get("type") not in ("image", "gif", "emoji"):
            continue
        data = layer.get("data") or {}
        asset_id = data.get("asset_id")
        path = asset_paths.get(asset_id) if asset_id else None
        if path is None or not path.is_file():
            continue
        if layer["type"] == "gif":
            inputs.extend(["-ignore_loop", "0"])
        inputs.extend(["-i", str(path)])
        visual_inputs[layer["id"]] = next_idx
        next_idx += 1

    fc, video_label, audio_label = build_filter_complex(
        template,
        has_overlay_audio=overlay_audio_path is not None,
        overlay_audio_idx=overlay_audio_idx,
        visual_inputs=visual_inputs,
        font_paths=font_paths,
        pools=pools,
        pool_index=pool_index,
        output_w=output_w,
        output_h=output_h,
    )

    args: list[str] = ["ffmpeg", "-y", *inputs, "-filter_complex", fc]
    args.extend(["-map", f"[{video_label}]"])
    if audio_label:
        args.extend(
            [
                "-map",
                f"[{audio_label}]",
                "-c:a",
                "aac",
                "-b:a",
                audio_bitrate,
                "-ac",
                "2",
            ]
        )
    else:
        args.append("-an")

    args.extend(
        [
            "-c:v",
            "libx264",
            "-preset",
            preset,
            "-crf",
            str(crf),
            "-pix_fmt",
            "yuv420p",
            "-r",
            str(fps),
            "-shortest",
            str(output_path),
        ]
    )
    return args
