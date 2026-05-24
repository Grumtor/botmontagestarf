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

from app.bin_finder import ffmpeg_exe

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
    # Per-clip color filter: "none" (default) or "bw" (grayscale).
    color_filter: str = "none"
    # Optional sub-range (local clip seconds) where the color filter applies.
    # None = filter on the whole clip ; both set = filter only between
    # [filter_start_sec, filter_end_sec]. Outside the range the source
    # colors are preserved.
    filter_start_sec: Optional[float] = None
    filter_end_sec: Optional[float] = None
    # New freeze model — inserts a held frame INSIDE the clip at the
    # given local position (sec from clip start in natural play time).
    # freeze_at_sec None = no freeze. freeze_duration_sec > 0 adds that
    # many seconds of held frame at the position, with optional
    # independent B&W via freeze_filter ("none" | "bw"). Audio goes
    # silent during the freeze.
    freeze_at_sec: Optional[float] = None
    freeze_duration_sec: float = 0.0
    freeze_filter: str = "none"
    # Legacy field — kept for backward compat on unmigrated templates
    # (extends the clip's tail by N seconds of held frame). New code
    # should use the freeze_at/duration/filter trio above.
    freeze_tail_sec: float = 0.0


@dataclass
class OverlayInput:
    """One ffmpeg `-i` input corresponding to a layer's image/gif file."""
    path: Path
    is_animated: bool   # GIF → needs -ignore_loop 0


@dataclass
class ExtraClipInput:
    """One ffmpeg `-i` input for a clip on an extra track (Phase 26b).
    Unlike main-track ClipInput, extra clips have ABSOLUTE positioning
    on the timeline (`start_time`) and a fixed `duration_sec`. They are
    rendered as full-canvas overlays on top of the main track, and
    their audio is mixed with adelay matching their start time.

    Phase 28 — `video_enabled=False` keeps the audio in the mix but
    skips the video overlay so the underlying tracks stay visible
    (use case: pull only the soundtrack from a clip)."""
    path: Path
    start_time: float        # absolute timeline position
    duration_sec: float      # how long the clip plays in the timeline
    trim_in: float
    trim_out: Optional[float]
    audio_enabled: bool
    audio_volume: float
    is_image: bool = False
    video_enabled: bool = True
    color_filter: str = "none"
    filter_start_sec: Optional[float] = None
    filter_end_sec: Optional[float] = None
    freeze_at_sec: Optional[float] = None
    freeze_duration_sec: float = 0.0
    freeze_filter: str = "none"
    freeze_tail_sec: float = 0.0


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

    # Opacity 0..1 applied via the @<alpha> suffix on each color. Stays
    # backward-compatible — when omitted (legacy templates) we treat it as
    # fully opaque.
    try:
        opacity = max(0.0, min(1.0, float(data.get("opacity", 1.0))))
    except (TypeError, ValueError):
        opacity = 1.0
    alpha_suffix = f"@{opacity:.3f}" if opacity < 1.0 else ""

    opts = [
        f"fontfile={_esc_path(str(font_path))}",
        f"text={_esc_drawtext(text)}",
        f"fontsize={font_size}",
        f"fontcolor=0x{color}{alpha_suffix}",
        f"x={x_expr}",
        f"y={y_expr}",
    ]

    style = data.get("style", "plain")
    if style == "highlight":
        hl = str(data.get("highlight_color", "#FFEB3B")).lstrip("#")
        pad = int(data.get("highlight_padding", 6))
        opts.append("box=1")
        opts.append(f"boxcolor=0x{hl}{alpha_suffix}")
        opts.append(f"boxborderw={max(0, pad)}")
    elif style == "stroke":
        sc = str(data.get("stroke_color", "#000000")).lstrip("#")
        sw = int(float(data.get("stroke_width", 4)))
        opts.append(f"bordercolor=0x{sc}{alpha_suffix}")
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


# ---- freeze helpers (new in-clip freeze model) ----------------------

def _natural_dur_for(clip: "ClipInput | ExtraClipInput") -> float:
    """Clip duration WITHOUT any freeze. For main-track ClipInput this
    is target_duration (placeholders/images) or trim_out - trim_in.
    For ExtraClipInput it's clip.duration_sec (set by the caller)."""
    target = getattr(clip, "target_duration", None)
    if target is not None:
        return max(0.0, float(target))
    duration_sec = getattr(clip, "duration_sec", None)
    if duration_sec is not None:
        return max(0.0, float(duration_sec))
    if clip.trim_out is not None:
        return max(0.0, clip.trim_out - clip.trim_in)
    return 0.0


def _bw_filter_token(
    color_filter: str,
    seg_start: float,
    seg_end: float,
    range_start: Optional[float],
    range_end: Optional[float],
) -> str:
    """Return the ffmpeg filter snippet (with trailing comma) to apply
    a B&W effect on a sub-segment, given the parent clip's filter range.
    The segment spans local times [seg_start, seg_end] in clip-local
    coords ; we map the BW range into that local frame and emit only
    if there's actual overlap."""
    if color_filter != "bw":
        return ""
    has_range = (
        range_start is not None
        and range_end is not None
        and range_end > range_start >= 0
    )
    if not has_range:
        return "format=gray,format=yuv420p,"
    # Map the global range to local seg coords (seg local time = 0..seg_dur).
    lo = max(0.0, (range_start or 0.0) - seg_start)
    hi = min(seg_end - seg_start, (range_end or 0.0) - seg_start)
    if hi <= lo:
        return ""  # no overlap → no filter
    return f"hue=s=0:enable='between(t\\,{lo:.3f}\\,{hi:.3f})',"


def _build_inside_freeze_video(
    clip: "ClipInput | ExtraClipInput",
    in_idx: int,
    out_label: str,
    fps: int,
    output_w: int,
    output_h: int,
) -> list[str]:
    """Generate a 3-segment split-concat video chain for a clip with an
    active in-clip freeze. Outputs to [out_label]. Images are special-
    cased (no real split, just an extended single chain)."""
    chains: list[str] = []
    natural = _natural_dur_for(clip)
    freeze_at = max(0.0, min(natural, float(clip.freeze_at_sec or 0.0)))
    freeze_dur = max(0.1, float(clip.freeze_duration_sec))

    if clip.is_image:
        # Image: nothing to split — just extend total duration by freeze_dur
        # (the image looks the same anyway). The freeze_filter applies to
        # the freeze window via enable='between(t, freeze_at, freeze_at+dur)'.
        v = f"[{in_idx}:v]setpts=PTS-STARTPTS,"
        v += (
            f"scale={output_w}:{output_h}:force_original_aspect_ratio=increase,"
            f"crop={output_w}:{output_h},"
        )
        total = natural + freeze_dur
        v += (
            f"tpad=stop_mode=clone:stop_duration={total:.3f},"
            f"trim=duration={total:.3f},setpts=PTS-STARTPTS,"
        )
        # Clip-wide filter first.
        v += _bw_filter_token(
            clip.color_filter, 0.0, natural,
            getattr(clip, "filter_start_sec", None),
            getattr(clip, "filter_end_sec", None),
        )
        # Freeze filter window on top.
        if clip.freeze_filter == "bw":
            v += (
                f"hue=s=0:enable='between(t\\,{freeze_at:.3f}\\,"
                f"{freeze_at + freeze_dur:.3f})',"
            )
        v += f"fps={fps}[{out_label}]"
        chains.append(v)
        return chains

    # Real video / placeholder source : split into 3 streams.
    pre_src = f"_{out_label}_pre_src"
    fr_src = f"_{out_label}_fr_src"
    post_src = f"_{out_label}_post_src"
    pre_done = f"_{out_label}_pre"
    fr_done = f"_{out_label}_fr"
    post_done = f"_{out_label}_post"

    chains.append(f"[{in_idx}:v]split=3[{pre_src}][{fr_src}][{post_src}]")

    src_freeze_t = clip.trim_in + freeze_at
    src_end = clip.trim_in + natural

    # PRE: 0..freeze_at in clip-local time.
    pre = f"[{pre_src}]trim=start={clip.trim_in:.3f}:end={src_freeze_t:.3f},"
    pre += "setpts=PTS-STARTPTS,"
    pre += (
        f"scale={output_w}:{output_h}:force_original_aspect_ratio=increase,"
        f"crop={output_w}:{output_h},"
    )
    pre += _bw_filter_token(
        clip.color_filter, 0.0, freeze_at,
        getattr(clip, "filter_start_sec", None),
        getattr(clip, "filter_end_sec", None),
    )
    pre += f"fps={fps}[{pre_done}]"
    chains.append(pre)

    # FREEZE: 1 frame at freeze_at, tpad clone to freeze_dur. Optional
    # independent B&W via freeze_filter.
    frame_dt = 1.0 / max(1, fps)
    fr = f"[{fr_src}]trim=start={src_freeze_t:.3f}:end={src_freeze_t + frame_dt:.3f},"
    fr += "setpts=PTS-STARTPTS,"
    fr += (
        f"scale={output_w}:{output_h}:force_original_aspect_ratio=increase,"
        f"crop={output_w}:{output_h},"
    )
    fr += (
        f"tpad=stop_mode=clone:stop_duration={freeze_dur:.3f},"
        f"trim=duration={freeze_dur:.3f},setpts=PTS-STARTPTS,"
    )
    if clip.freeze_filter == "bw":
        fr += "format=gray,format=yuv420p,"
    fr += f"fps={fps}[{fr_done}]"
    chains.append(fr)

    # POST: freeze_at..natural in clip-local time.
    post_local_dur = max(0.0, natural - freeze_at)
    post = f"[{post_src}]trim=start={src_freeze_t:.3f}:end={src_end:.3f},"
    post += "setpts=PTS-STARTPTS,"
    post += (
        f"scale={output_w}:{output_h}:force_original_aspect_ratio=increase,"
        f"crop={output_w}:{output_h},"
    )
    # Map the global filter range into post-local coords.
    fs = getattr(clip, "filter_start_sec", None)
    fe = getattr(clip, "filter_end_sec", None)
    post += _bw_filter_token(
        clip.color_filter, freeze_at, freeze_at + post_local_dur,
        fs, fe,
    )
    post += f"fps={fps}[{post_done}]"
    chains.append(post)

    chains.append(
        f"[{pre_done}][{fr_done}][{post_done}]"
        f"concat=n=3:v=1[{out_label}]"
    )
    return chains


def _build_inside_freeze_audio(
    clip: "ClipInput | ExtraClipInput",
    in_idx: int,
    out_label: str,
) -> list[str]:
    """Audio chain matching the 3-segment freeze split. Pre + post
    keep the source audio, the freeze window is replaced by silence
    (matches user expectation : a held frame goes silent)."""
    chains: list[str] = []
    natural = _natural_dur_for(clip)
    freeze_at = max(0.0, min(natural, float(clip.freeze_at_sec or 0.0)))
    freeze_dur = max(0.1, float(clip.freeze_duration_sec))
    src_freeze_t = clip.trim_in + freeze_at
    src_end = clip.trim_in + natural

    has_real_audio = (
        clip.audio_enabled and clip.audio_volume > 0 and not clip.is_image
    )

    if not has_real_audio:
        # No source audio → silence for the whole total duration.
        total = natural + freeze_dur
        chains.append(
            f"anullsrc=channel_layout=stereo:sample_rate=44100"
            f":duration={max(0.1, total):.3f}[{out_label}]"
        )
        return chains

    pre_src = f"_{out_label}_pre_src"
    post_src = f"_{out_label}_post_src"
    pre_done = f"_{out_label}_pre"
    fr_done = f"_{out_label}_fr"
    post_done = f"_{out_label}_post"

    chains.append(f"[{in_idx}:a]asplit=2[{pre_src}][{post_src}]")

    # PRE audio
    pre = f"[{pre_src}]atrim=start={clip.trim_in:.3f}:end={src_freeze_t:.3f},"
    pre += "asetpts=PTS-STARTPTS,"
    pre += f"volume={clip.audio_volume:.3f}[{pre_done}]"
    chains.append(pre)

    # FREEZE = silence
    chains.append(
        f"anullsrc=channel_layout=stereo:sample_rate=44100"
        f":duration={freeze_dur:.3f}[{fr_done}]"
    )

    # POST audio
    post = f"[{post_src}]atrim=start={src_freeze_t:.3f}:end={src_end:.3f},"
    post += "asetpts=PTS-STARTPTS,"
    post += f"volume={clip.audio_volume:.3f}[{post_done}]"
    chains.append(post)

    chains.append(
        f"[{pre_done}][{fr_done}][{post_done}]"
        f"concat=n=3:v=0:a=1[{out_label}]"
    )
    return chains


# ---- public API ------------------------------------------------------

def build_render_command(
    *,
    clips: list[ClipInput],
    extra_clips: Optional[list[ExtraClipInput]] = None,
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
    extra_clips = extra_clips or []
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

    # 1b. Inputs for each extra-track clip (Phase 26b).
    extra_input_indices: list[int] = []
    for ex in extra_clips:
        if ex.is_image:
            inputs.extend([
                "-loop", "1",
                "-framerate", str(fps),
                "-t", f"{ex.duration_sec:.3f}",
                "-i", str(ex.path),
            ])
        else:
            inputs.extend(["-i", str(ex.path)])
        extra_input_indices.append(next_idx)
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

        # New freeze model — inserted INSIDE the clip at a chosen position.
        # Takes precedence over the legacy freeze_tail_sec.
        freeze_active = (
            clip.freeze_at_sec is not None and clip.freeze_duration_sec > 0
        )
        freeze_tail = (
            0.0 if freeze_active else max(0.0, clip.freeze_tail_sec)
        )

        # When freeze_active, we delegate to the split-concat helper that
        # outputs to [v_label] / [a_label]. Skips all the per-clip
        # inline logic below.
        if freeze_active:
            chains.extend(
                _build_inside_freeze_video(
                    clip, in_idx, v_label, fps, output_w, output_h,
                )
            )
            chains.extend(
                _build_inside_freeze_audio(clip, in_idx, a_label)
            )
            seg_v_labels.append(f"[{v_label}]")
            seg_a_labels.append(f"[{a_label}]")
            continue

        # Video sub-chain: trim, scale+crop, optionally force exact duration,
        # optionally apply color filter, optionally freeze last frame N sec.
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
        if freeze_tail > 0:
            v_chain += (
                f"tpad=stop_mode=clone:stop_duration={freeze_tail:.3f},"
            )
        if clip.color_filter == "bw":
            fs = clip.filter_start_sec
            fe = clip.filter_end_sec
            has_range = (
                fs is not None and fe is not None and fe > fs >= 0
            )
            if has_range:
                # Sub-range B&W : desaturate only between [fs, fe] using
                # hue=s=0 with the temporal enable option. Outside the
                # range, original colors are kept. Commas inside enable
                # must be escaped (filter-chain separator).
                v_chain += (
                    f"hue=s=0:enable='between(t\\,{fs:.3f}\\,{fe:.3f})',"
                )
            else:
                # Full-clip B&W : format=gray drops chroma entirely
                # (cheapest path) then back to yuv420p for the encoder.
                v_chain += "format=gray,format=yuv420p,"
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
            if freeze_tail > 0:
                # Pad with silence for the freeze tail (audio always goes
                # quiet during a freeze frame — matches user expectation).
                base_dur = (
                    clip.target_duration
                    if clip.target_duration is not None
                    else (clip.trim_out - clip.trim_in)
                    if clip.trim_out is not None
                    else 0.0
                )
                total = max(0.1, base_dur + freeze_tail)
                a_chain += (
                    f",apad=whole_dur={total:.3f},"
                    f"atrim=duration={total:.3f},asetpts=PTS-STARTPTS"
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
            dur += freeze_tail
            a_chain = (
                f"anullsrc=channel_layout=stereo:sample_rate=44100"
                f":duration={max(0.1, dur):.3f}[{a_label}]"
            )
        chains.append(a_chain)
        seg_a_labels.append(f"[{a_label}]")

    # 4. Concat all clip sub-chains into one main stream.
    # Phase 28f — output duration = MAX(main, extras, layers) = la durée
    # du "montage entier" du user. Les extras qui dépassent la main
    # track sont visibles parce qu'on pad main_v avec du noir + main_a
    # avec du silence jusqu'à cette durée. C'est la track la plus
    # longue (toutes pistes confondues) qui dicte la durée du reel.
    n = len(clips)
    if n == 0:
        raise ValueError("No clips to render")
    interleaved = "".join(
        f"{seg_v_labels[i]}{seg_a_labels[i]}" for i in range(n)
    )

    def _freeze_extra_sec(c: "ClipInput | ExtraClipInput") -> float:
        # Either the new in-clip freeze OR the legacy tail freeze
        # contributes to the timeline duration, never both.
        if c.freeze_at_sec is not None and c.freeze_duration_sec > 0:
            return max(0.0, float(c.freeze_duration_sec))
        return max(0.0, float(c.freeze_tail_sec))

    main_total = 0.0
    for c in clips:
        if c.target_duration is not None:
            main_total += c.target_duration
        elif c.trim_out is not None:
            main_total += max(0.0, c.trim_out - c.trim_in)
        main_total += _freeze_extra_sec(c)
    extras_end = max(
        (
            ex.start_time
            + max(0.1, ex.duration_sec)
            + _freeze_extra_sec(ex)
            for ex in extra_clips
        ),
        default=0.0,
    )
    layers_end = max(
        (float(l.get("end_time", 0)) for l in layers),
        default=0.0,
    )
    target_duration = max(main_total, extras_end, layers_end)
    pad_amount = max(0.0, target_duration - main_total)

    if pad_amount > 0.05:
        # Concat to scratch labels first, then tpad/apad to target.
        chains.append(
            f"{interleaved}concat=n={n}:v=1:a=1[main_v_pre][main_a_pre]"
        )
        chains.append(
            f"[main_v_pre]tpad=stop_mode=add:stop_duration={pad_amount:.3f}"
            f":color=black[main_v]"
        )
        chains.append(
            f"[main_a_pre]apad=whole_dur={target_duration:.3f}[main_a]"
        )
    else:
        chains.append(
            f"{interleaved}concat=n={n}:v=1:a=1[main_v][main_a]"
        )

    # 4b. Composite extra-track clips ON TOP of [main_v]. Each extra clip
    # is a full-canvas overlay with absolute timeline positioning. Higher
    # index in `extra_clips` = higher priority (rendered last → on top).
    # Audio of each extra clip is collected for the final amix.
    # Phase 28 — clips with `video_enabled=False` skip the visual overlay
    # but still contribute their audio (audio-only source).
    current_v = "main_v"
    extra_audio_labels: list[str] = []
    for i, ex in enumerate(extra_clips):
        ex_in_idx = extra_input_indices[i]
        # New in-clip freeze takes precedence ; freeze_tail is legacy.
        freeze_active = (
            ex.freeze_at_sec is not None and ex.freeze_duration_sec > 0
        )
        freeze_tail_ex = (
            0.0 if freeze_active else max(0.0, ex.freeze_tail_sec)
        )
        td = max(0.1, ex.duration_sec)
        total_ex = (
            td + max(0.1, ex.freeze_duration_sec)
            if freeze_active
            else td + freeze_tail_ex
        )

        if ex.video_enabled:
            scaled_label = f"ev{i}"
            if freeze_active:
                # Delegate the 3-segment split-concat to the helper,
                # then delay to the absolute start_time.
                concat_label = f"_ex{i}_concat"
                chains.extend(
                    _build_inside_freeze_video(
                        ex, ex_in_idx, concat_label,
                        fps, output_w, output_h,
                    )
                )
                chains.append(
                    f"[{concat_label}]setpts=PTS+{ex.start_time:.3f}/TB"
                    f"[{scaled_label}]"
                )
            else:
                # Legacy single-chain video. Trim, scale+crop, tpad to
                # total_ex, optional BW, fps, then delay.
                v_chain = f"[{ex_in_idx}:v]"
                if not ex.is_image:
                    if ex.trim_out is not None:
                        v_chain += f"trim=start={ex.trim_in}:end={ex.trim_out},"
                    elif ex.trim_in > 0:
                        v_chain += f"trim=start={ex.trim_in},"
                v_chain += "setpts=PTS-STARTPTS,"
                v_chain += (
                    f"scale={output_w}:{output_h}:force_original_aspect_ratio=increase,"
                    f"crop={output_w}:{output_h},"
                )
                v_chain += (
                    f"tpad=stop_mode=clone:stop_duration={total_ex:.3f},"
                    f"trim=duration={total_ex:.3f},setpts=PTS-STARTPTS,"
                )
                if ex.color_filter == "bw":
                    fs = ex.filter_start_sec
                    fe = ex.filter_end_sec
                    if fs is not None and fe is not None and fe > fs >= 0:
                        v_chain += (
                            f"hue=s=0:enable='between(t\\,{fs:.3f}\\,{fe:.3f})',"
                        )
                    else:
                        v_chain += "format=gray,format=yuv420p,"
                v_chain += f"fps={fps},"
                v_chain += f"setpts=PTS+{ex.start_time:.3f}/TB[{scaled_label}]"
                chains.append(v_chain)

            # Overlay onto current_v. enable=between(t,start,start+total)
            # so the base shows through outside this range.
            next_v = f"ext{i}"
            end_t = ex.start_time + total_ex
            chains.append(
                f"[{current_v}][{scaled_label}]"
                f"overlay=0:0:enable='between(t\\,{ex.start_time:.3f}\\,{end_t:.3f})'"
                f"[{next_v}]"
            )
            current_v = next_v
        # else: video_enabled=False → no visual overlay for this clip,
        # the lower tracks stay visible. Audio chain below still runs.

        # Audio sub-chain for this extra clip if enabled and not an image.
        if ex.audio_enabled and ex.audio_volume > 0 and not ex.is_image:
            a_label = f"ea{i}"
            if freeze_active:
                # 3-segment audio (pre + silence + post), then adelay.
                pre_concat = f"_ex{i}_a_concat"
                chains.extend(
                    _build_inside_freeze_audio(ex, ex_in_idx, pre_concat)
                )
                delay_ms = max(0, int(ex.start_time * 1000))
                if delay_ms > 0:
                    chains.append(
                        f"[{pre_concat}]adelay={delay_ms}:all=1[{a_label}]"
                    )
                else:
                    chains.append(f"[{pre_concat}]acopy[{a_label}]")
            else:
                a_chain = f"[{ex_in_idx}:a]"
                if ex.trim_out is not None:
                    a_chain += f"atrim=start={ex.trim_in}:end={ex.trim_out},"
                elif ex.trim_in > 0:
                    a_chain += f"atrim=start={ex.trim_in},"
                a_chain += "asetpts=PTS-STARTPTS,"
                a_chain += f"volume={ex.audio_volume:.3f},"
                a_chain += f"atrim=duration={td:.3f},asetpts=PTS-STARTPTS"
                delay_ms = max(0, int(ex.start_time * 1000))
                if delay_ms > 0:
                    a_chain += f",adelay={delay_ms}:all=1"
                a_chain += f"[{a_label}]"
                chains.append(a_chain)
            extra_audio_labels.append(a_label)

    # 5. Apply visual overlays (text drawtext + image/gif overlay)
    sorted_layers = sorted(layers, key=lambda l: l.get("z_index", 0))
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

    # 6. Audio: mix all sources together
    # - main_a (always present, from the main track concat)
    # - ovl_a (optional, the audio_overlay aka music)
    # - ea0, ea1, ... (one per audio-enabled extra clip, with adelay)
    # When >1 source, amix with `duration=first` so the timeline length
    # is anchored on main_a.
    audio_label = "main_a"
    audio_inputs: list[str] = ["main_a"]

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
        audio_inputs.append("ovl_a")

    audio_inputs.extend(extra_audio_labels)

    if len(audio_inputs) > 1:
        joined = "".join(f"[{lbl}]" for lbl in audio_inputs)
        # Phase 28f — `duration=longest` : main_a est désormais paddé
        # avec du silence à la durée du montage (étape 4). Les extras
        # qui ont du son au-delà de la main concat seront mixés avec
        # ce silence jusqu'à la fin du montage. `normalize=0` (Phase 28b)
        # garde chaque source à son volume d'origine.
        chains.append(
            f"{joined}amix=inputs={len(audio_inputs)}"
            f":duration=longest:dropout_transition=0:normalize=0[mix_a]"
        )
        audio_label = "mix_a"

    # Phase 30 — Normalisation finale du flux audio avant mux.
    #
    # Bug visé : son OK sur PC, MUET sur téléphone (iOS + Android),
    # peu importe la plateforme de partage (Telegram, Discord, direct
    # download). Symptôme classique d'un AAC mal-formé : les decoders
    # software desktop (VLC, Chrome) sont tolérants et jouent quand
    # même, les hardware decoders mobile sont stricts et drop le track
    # silencieusement.
    #
    # Cause : sources MP4 hétérogènes (44.1k/48k, mono/stereo, s16/fltp)
    # qui entrent dans `concat` puis `amix` sans normalisation. Le
    # résultat peut avoir des sample tables incohérentes que le hardware
    # decoder mobile refuse.
    #
    # Fix : on force le flux final dans le format canonique
    # 48000 Hz / float planar / stereo AVANT l'encodage AAC. C'est
    # exactement ce qu'attendent iOS et Android comme entrée standard.
    chains.append(
        f"[{audio_label}]aresample=48000,"
        f"aformat=sample_fmts=fltp:channel_layouts=stereo[a_out]"
    )
    audio_label = "a_out"

    fc = ";".join(chains)

    args: list[str] = [ffmpeg_exe(), "-y", *inputs, "-filter_complex", fc]
    args.extend(["-map", "[out_v]", "-map", f"[{audio_label}]"])
    args.extend(
        [
            "-c:v", "libx264",
            "-preset", preset,
            "-crf", str(crf),
            "-pix_fmt", "yuv420p",
            # Match real iPhone captures — also the most widely supported
            # H.264 config on mobile decoders.
            "-profile:v", "high",
            "-level", "4.0",
            "-r", str(fps),
            "-c:a", "aac",
            # Force LC-AAC explicite (Low Complexity) — le profil le
            # plus universellement supporté par les hardware decoders
            # mobile. Sans flag, ffmpeg peut basculer sur HE-AAC à
            # certains bitrates, ce que Android < 9 et certains chipsets
            # iPhone ne décodent pas en hardware → audio muet.
            "-profile:a", "aac_low",
            "-b:a", "192k",
            "-ac", "2",
            # 48 kHz is what iPhone/iOS record at and what mobile MP4
            # decoders expect. Without an explicit -ar, ffmpeg keeps the
            # source rate which can be 44.1/22.05/anything → some mobile
            # players silently drop the audio track.
            "-ar", "48000",
            # Move the moov atom to the start of the file so mobile
            # players can begin decoding (incl. audio sample tables)
            # without having to seek to the end. Mandatory for any video
            # consumed via Photos / WhatsApp / Instagram on phone.
            "-movflags", "+faststart",
            "-shortest",
            str(output_path),
        ]
    )
    return args
