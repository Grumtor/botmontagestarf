"""Pillow renderer for "snap" filter layers (Snapchat-style caption bar).

A snap layer = full-canvas-width semi-transparent dark bar with white
centred bold text. Position vertically at a Y picked at random per render
between `data.y_pct_min` and `data.y_pct_max`. Text is one variation
randomly picked from `data.text_pool` (or the static `data.text` when
the pool is empty).

Apple emojis are rendered exactly like in `text_renderer` — same CDN, same
PNG glyphs. Single source of truth across editor canvas and ffmpeg output.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Optional

from PIL import Image, ImageDraw, ImageFont

from app.render.emoji_pack import get_apple_emoji_png
from app.render.text_renderer import (
    _segments,
    _wrap_tokens,
    _Token,
    _text_width,
)

log = logging.getLogger(__name__)

# Hardcoded Snap aesthetics — matches the iOS Snap caption bar.
BAR_RGBA = (0, 0, 0, int(0.45 * 255))  # 45% black
TEXT_RGBA = (255, 255, 255, 255)        # solid white
PADDING_FACTOR = 0.55                    # vertical padding ≈ 55% of font size
H_PADDING_FACTOR = 0.7                   # horizontal padding ≈ 70% of font size


def _tokenize_for_snap(
    text: str,
    font: ImageFont.FreeTypeFont,
    emoji_size: int,
) -> list[_Token]:
    tokens: list[_Token] = []
    for kind, value in _segments(text):
        if kind == "emoji":
            png = get_apple_emoji_png(value)
            if png is None:
                tokens.append(_Token("word", value, _text_width(value, font)))
                continue
            try:
                img = Image.open(png).convert("RGBA")
                if img.size != (emoji_size, emoji_size):
                    img = img.resize((emoji_size, emoji_size), Image.LANCZOS)
            except Exception as e:
                log.warning("snap emoji load %s failed: %s", png, e)
                tokens.append(_Token("word", value, _text_width(value, font)))
                continue
            tokens.append(_Token("emoji", value, float(emoji_size), image=img))
            continue

        i = 0
        while i < len(value):
            ch = value[i]
            if ch == "\n":
                tokens.append(_Token("newline", "", 0.0))
                i += 1
                continue
            if ch == " ":
                tokens.append(_Token("space", " ", _text_width(" ", font)))
                i += 1
                continue
            j = i
            while j < len(value) and value[j] not in (" ", "\n"):
                j += 1
            word = value[i:j]
            tokens.append(_Token("word", word, _text_width(word, font)))
            i = j
    return tokens


def render_snap_layer_to_png(
    layer: dict[str, Any],
    font_path: Optional[Path],
    output_w: int,
    output_h: int,
    out_path: Path,
) -> Optional[Path]:
    """Render a snap layer to a transparent canvas-sized PNG.

    The bar is full canvas width, vertically positioned at the layer's
    `y_pct` (which the backend has pre-randomized within y_pct_min/max).
    Returns out_path, or None on hard failure.
    """
    data = layer.get("data") or {}
    text = str(data.get("text") or "")
    if not text:
        return None

    font_size_px = int(max(10, float(data.get("font_size_px", 36))))

    if font_path is None:
        return None

    try:
        font = ImageFont.truetype(str(font_path), size=font_size_px)
    except Exception as e:
        log.warning("snap font load %s failed: %s", font_path, e)
        return None

    try:
        ascent, descent = font.getmetrics()
    except Exception:
        ascent, descent = font_size_px, int(font_size_px * 0.2)
    base_line_h = ascent + descent

    pad_y = int(round(font_size_px * PADDING_FACTOR))
    pad_x = int(round(font_size_px * H_PADDING_FACTOR))

    # Bar width = canvas width. Effective text width = canvas width minus
    # horizontal padding on both sides.
    max_text_w = float(output_w - 2 * pad_x)

    emoji_size = int(round(font_size_px * 0.95))
    tokens = _tokenize_for_snap(text, font, emoji_size)
    lines = _wrap_tokens(tokens, max_text_w)

    if not lines or all(not ln.tokens for ln in lines):
        return None

    line_spacing = int(round(base_line_h * 1.15))
    text_block_h = len(lines) * line_spacing
    bar_h = text_block_h + 2 * pad_y

    # Layer Y in canvas pixels (the backend picks a random y_pct from the
    # range before calling us; we just honour it).
    y_pct = float(layer.get("y_pct", 50))
    bar_y = int(round((y_pct / 100.0) * output_h))
    # Centre the bar around the picked Y so the layer's "anchor" feels
    # natural — same behaviour as Snap caption position.
    bar_y -= bar_h // 2
    # Clamp inside the canvas
    bar_y = max(0, min(bar_y, output_h - bar_h))

    canvas = Image.new("RGBA", (output_w, output_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    # Bar background — full width, semi-transparent dark.
    draw.rectangle(
        [0, bar_y, output_w, bar_y + bar_h],
        fill=BAR_RGBA,
    )

    # Centre text block vertically inside the bar.
    text_y0 = bar_y + pad_y

    for li, line in enumerate(lines):
        if not line.tokens:
            continue
        line_w = line.width
        x_start = (output_w - line_w) / 2
        y_line = text_y0 + li * line_spacing
        cursor = x_start
        for tok in line.tokens:
            if tok.kind == "emoji" and tok.image is not None:
                em_y = int(y_line + (base_line_h - emoji_size) / 2)
                canvas.alpha_composite(tok.image, (int(cursor), em_y))
                cursor += tok.width
                continue
            if tok.kind == "word":
                draw.text(
                    (int(cursor), int(y_line)),
                    tok.value,
                    font=font,
                    fill=TEXT_RGBA,
                )
                cursor += tok.width
                continue
            # space
            cursor += tok.width

    out_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out_path, "PNG", optimize=True)
    return out_path
