"""Clip-based ffmpeg pipeline.

A template's main track is a list of clips:
  - `fixed`       → references a video file uploaded with the template
  - `placeholder` → at render time, gets filled by a user-supplied video

For each render we:
  1. Resolve every placeholder clip to a real source file.
  2. For each clip, build a video+audio sub-chain (trim/scale to 1080×1920
     centred crop, optional audio at the clip's volume).
  3. Concat all clip sub-chains into a single video+audio stream.
  4. Apply text/image/gif/emoji overlays on top.
  5. Mix in the optional `audio_overlay` (background music) on the audio.
  6. Encode H.264/AAC.

Text drawtext + image/gif overlay logic is shared with the live preview path.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

OUTPUT_W = 1080
OUTPUT_H = 1920


# ---- escapes ---------------------------------------------------------

def _esc_drawtext(text: str) -> str:
    out: list[str] = []
    for ch in text:
        if ch in "\\:,'%":
            out.append("\\" + ch)
        else:
            out.append(ch)
    return "".join(out)


def _esc_path(path: str) -> str:
    return path.replace("\\", "\\\\").replace(":", "\\:")


# ---- inputs ----------------------------------------------------------

@dataclass
class ClipInput:
    """One ffmpeg `-i` input corresponding to one clip on the main track."""
    path: Path
    trim_in: float
    trim_out: Optional[float]   # None = take everything from trim_in to end
    audio_enabled: bool
    audio_volume: float
    # If set, force the clip to exactly this duration: trim if longer,
    # pad with last frame (and silence) if shorter. Used by placeholders
    # whose duration is fixed by the template, regardless of the source.
    target_duration: Optional[float] = None
    # If True, the source is a still image — ffmpeg input uses
    # `-loop 1 -framerate FPS -t target_duration` so the image becomes a
    # video of the right length. target_duration must be set.
    is_image: bool = False


@dataclass
class OverlayInput:
    """One ffmpeg `-i` input corresponding to a layer's image/gif file."""
    path: Path
    is_animated: bool   # GIF → needs -ignore_loop 0


# ---- text drawtext ---------------------------------------------------

def _drawtext_filter(
    layer: dict,
    font_path: Path,
    text: str,
    output_w: int,
    output_h: int,
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


# ---- public API ------------------------------------------------------

def build_render_command(
    *,
    clips: list[ClipInput],
    overlay_inputs: dict[str, OverlayInput],
    overlay_audio_path: Optional[Path],
    overlay_audio_config: dict,
    layers: list[dict],
    font_paths: dict[Any, Path],
    output_path: Path,
    output_w: int = OUTPUT_W,
    output_h: int = OUTPUT_H,
    fps: int = 30,
    crf: int = 18,
    preset: str = "slow",
    text_png_inputs: Optional[dict[str, Path]] = None,
) -> list[str]:
    """Build the full ffmpeg argv for one render.

    `clips` is the full sequence (fixed + already-resolved placeholders).
    `overlay_inputs` maps layer.id → OverlayInput for each visual layer
    that needs an additional input file.
    `text_png_inputs` maps text-layer.id → pre-rendered transparent PNG path
    (canvas-sized) for text layers containing emojis. When present we use
    an `overlay` filter at (0,0) instead of drawtext, so emoji glyphs that
    would tofu under FreeType ("NO GLYPH") get rendered as Apple PNGs.
    """
    text_png_inputs = text_png_inputs or {}
    inputs: list[str] = []
    next_idx = 0
    clip_input_indices: list[int] = []

    # 1. Inputs for each clip on the main track
    for clip in clips:
        if clip.is_image:
            dur = clip.target_duration or 3.0
            inputs.extend([
                "-loop", "1",
                "-framerate", str(fps),
                "-t", f"{dur:.3f}",
                "-i", str(clip.path),
            ])
        else:
            inputs.extend(["-i", str(clip.path)])
        clip_input_indices.append(next_idx)
        next_idx += 1

    overlay_audio_idx = -1
    if overlay_audio_path:
        inputs.extend(["-i", str(overlay_audio_path)])
        overlay_audio_idx = next_idx
        next_idx += 1

    # 2. Inputs for each visual overlay (image/gif)
    overlay_layer_input_idx: dict[str, int] = {}
    for layer_id, ov in overlay_inputs.items():
        if ov.is_animated:
            inputs.extend(["-ignore_loop", "0"])
        inputs.extend(["-i", str(ov.path)])
        overlay_layer_input_idx[layer_id] = next_idx
        next_idx += 1

    # 2b. Inputs for each pre-rendered text PNG (canvas-sized, transparent).
    text_png_input_idx: dict[str, int] = {}
    for layer_id, png_path in text_png_inputs.items():
        inputs.extend(["-i", str(png_path)])
        text_png_input_idx[layer_id] = next_idx
        next_idx += 1

    # 3. Build the filter graph: per-clip trim + scale + concat
    chains: list[str] = []
    seg_v_labels: list[str] = []
    seg_a_labels: list[str] = []

    for i, clip in enumerate(clips):
        in_idx = clip_input_indices[i]
        v_label = f"cv{i}"
        a_label = f"ca{i}"

        # Video sub-chain: trim, scale+crop, optionally force exact duration.
        v_chain = f"[{in_idx}:v]"
        if clip.trim_out is not None:
            v_chain += f"trim=start={clip.trim_in}:end={clip.trim_out},"
        elif clip.trim_in > 0:
            v_chain += f"trim=start={clip.trim_in},"
        v_chain += "setpts=PTS-STARTPTS,"
        v_chain += (
            f"scale={output_w}:{output_h}:force_original_aspect_ratio=increase,"
            f"crop={output_w}:{output_h},"
        )
        if clip.target_duration is not None:
            # Pad with cloned last frame for as long as needed, then trim to
            # exactly target_duration. tpad's stop_duration is "extra after
            # the source", so we use a generous value and let trim cap us.
            td = max(0.1, clip.target_duration)
            v_chain += (
                f"tpad=stop_mode=clone:stop_duration={td:.3f},"
                f"trim=duration={td:.3f},setpts=PTS-STARTPTS,"
            )
        v_chain += f"fps={fps}"
        v_chain += f"[{v_label}]"
        chains.append(v_chain)
        seg_v_labels.append(f"[{v_label}]")

        # Audio sub-chain (always emit something so concat sees v=1:a=1).
        # Image clips have no audio source → always emit silence.
        if clip.audio_enabled and clip.audio_volume > 0 and not clip.is_image:
            a_chain = f"[{in_idx}:a]"
            if clip.trim_out is not None:
                a_chain += f"atrim=start={clip.trim_in}:end={clip.trim_out},"
            elif clip.trim_in > 0:
                a_chain += f"atrim=start={clip.trim_in},"
            a_chain += "asetpts=PTS-STARTPTS,"
            a_chain += f"volume={clip.audio_volume:.3f}"
            if clip.target_duration is not None:
                td = max(0.1, clip.target_duration)
                a_chain += (
                    f",apad=whole_dur={td:.3f},"
                    f"atrim=duration={td:.3f},asetpts=PTS-STARTPTS"
                )
            a_chain += f"[{a_label}]"
        else:
            # Silent audio matching the clip's expected duration.
            if clip.target_duration is not None:
                dur = clip.target_duration
            elif clip.trim_out is not None:
                dur = clip.trim_out - clip.trim_in
            else:
                dur = 0
            a_chain = (
                f"anullsrc=channel_layout=stereo:sample_rate=44100"
                f":duration={max(0.1, dur):.3f}[{a_label}]"
            )
        chains.append(a_chain)
        seg_a_labels.append(f"[{a_label}]")

    # 4. Concat all clip sub-chains into one main stream
    n = len(clips)
    if n == 0:
        raise ValueError("No clips to render")
    interleaved = "".join(
        f"{seg_v_labels[i]}{seg_a_labels[i]}" for i in range(n)
    )
    chains.append(
        f"{interleaved}concat=n={n}:v=1:a=1[main_v][main_a]"
    )

    # 5. Apply visual overlays (text drawtext + image/gif overlay)
    sorted_layers = sorted(layers, key=lambda l: l.get("z_index", 0))
    current_v = "main_v"
    for i, layer in enumerate(sorted_layers):
        layer_type = layer.get("type")

        if layer_type == "text":
            text = str((layer.get("data") or {}).get("text", ""))
            if not text:
                continue
            layer_id = layer.get("id")
            png_idx = text_png_input_idx.get(layer_id) if layer_id else None
            start = float(layer.get("start_time", 0))
            end = float(layer.get("end_time", 0))

            if png_idx is not None:
                # Pre-rendered Apple-emoji-aware PNG; overlay full canvas.
                next_label = f"tx{i}"
                chains.append(
                    f"[{current_v}][{png_idx}:v]"
                    f"overlay=0:0:enable='between(t\\,{start}\\,{end})'"
                    f"[{next_label}]"
                )
                current_v = next_label
                continue

            font_path = _resolve_font_path(layer, font_paths)
            if not font_path:
                continue
            next_label = f"tx{i}"
            chains.append(
                f"[{current_v}]"
                f"{_drawtext_filter(layer, font_path, text, output_w, output_h)}"
                f"[{next_label}]"
            )
            current_v = next_label
            continue

        if layer_type in ("image", "gif", "emoji"):
            input_idx = overlay_layer_input_idx.get(layer.get("id"))
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
                f"[{current_v}][{scale_label}]overlay=x={x_px}:y={y_px}:"
                f"enable='between(t\\,{start}\\,{end})'[{next_label}]"
            )
            current_v = next_label

    if current_v != "out_v":
        chains.append(f"[{current_v}]copy[out_v]")

    # 6. Audio: optionally mix overlay (background music) into main_a
    audio_label = "main_a"
    if overlay_audio_path:
        ov = overlay_audio_config or {}
        ov_volume = float(ov.get("volume", 1.0))
        ov_start = float(ov.get("start_offset", 0.0))
        ov_trim = float(ov.get("trim_in", 0.0))
        chain = f"[{overlay_audio_idx}:a]atrim=start={ov_trim:.3f},asetpts=PTS-STARTPTS"
        chain += f",volume={ov_volume:.3f}"
        delay_ms = max(0, int(ov_start * 1000))
        if delay_ms > 0:
            chain += f",adelay={delay_ms}:all=1"
        chain += "[ovl_a]"
        chains.append(chain)
        chains.append(
            "[main_a][ovl_a]amix=inputs=2:duration=first:dropout_transition=0[mix_a]"
        )
        audio_label = "mix_a"

    fc = ";".join(chains)

    args: list[str] = ["ffmpeg", "-y", *inputs, "-filter_complex", fc]
    args.extend(["-map", "[out_v]", "-map", f"[{audio_label}]"])
    args.extend(
        [
            "-c:v", "libx264",
            "-preset", preset,
            "-crf", str(crf),
            "-pix_fmt", "yuv420p",
            "-r", str(fps),
            "-c:a", "aac",
            "-b:a", "192k",
            "-ac", "2",
            "-shortest",
            str(output_path),
        ]
    )
    return args
