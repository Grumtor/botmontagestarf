"""Pillow-based text + Apple emoji compositor.

Used as a replacement for ffmpeg's `drawtext` filter when a text layer
contains emojis (drawtext can only use a single font and shows "NO GLYPH"
tofu for emoji codepoints not present in Inter / Montserrat).

For each text layer that contains at least one emoji, the pipeline calls
`render_text_layer_to_png(...)` which produces a transparent canvas-sized
PNG. ffmpeg then `overlay`s that PNG on top of the video instead of running
`drawtext`.

The layout aims to match the canvas preview pixel-for-pixel:
  - font_size_pct → px relative to canvas height
  - max_width_pct → px relative to canvas width
  - layer x_pct/y_pct/width_pct/height_pct → bounding box on canvas
  - text aligned (left/center/right) horizontally inside the bbox
  - text vertically centered inside the bbox
  - styles plain / highlight / stroke
  - emoji glyphs inlined at 1em, baseline-aligned with the text run
"""

from __future__ import annotations

import hashlib
import logging
from pathlib import Path
from typing import Any, Optional

import regex
from PIL import Image, ImageDraw, ImageFont

from app.render.emoji_pack import get_apple_emoji_png

log = logging.getLogger(__name__)

# Match a single grapheme that includes an Extended_Pictographic codepoint
# OR a Regional Indicator Symbol (= flag composant, ex: 🇫🇷 = U+1F1EB +
# U+1F1F7). Extended_Pictographic seul ne couvre PAS les RIS, donc les
# drapeaux passaient à travers. Même fix que côté frontend apple-emoji.ts.
# `\X` (grapheme cluster) regroupe correctement la paire RIS d'un drapeau.
_EMOJI_GRAPHEME_RE = regex.compile(r"\X")
_HAS_EMOJI_CODEPOINT_RE = regex.compile(
    r"[\p{Extended_Pictographic}\p{Regional_Indicator}]"
)


def text_contains_emoji(text: str) -> bool:
    return bool(_HAS_EMOJI_CODEPOINT_RE.search(text or ""))


# ---- segmentation ---------------------------------------------------


def _segments(text: str) -> list[tuple[str, str]]:
    """Split into a list of (kind, value) tuples where kind ∈ {"text","emoji"}.

    Adjacent text segments are merged into a single run.
    """
    out: list[tuple[str, str]] = []
    buf: list[str] = []
    for grapheme in _EMOJI_GRAPHEME_RE.findall(text or ""):
        if _HAS_EMOJI_CODEPOINT_RE.search(grapheme):
            if buf:
                out.append(("text", "".join(buf)))
                buf = []
            out.append(("emoji", grapheme))
        else:
            buf.append(grapheme)
    if buf:
        out.append(("text", "".join(buf)))
    return out


# ---- token-level layout ---------------------------------------------


class _Token:
    """Minimum unit on a line: a word, a single space, a newline marker, or
    an emoji glyph. Each token knows its width in pixels."""

    __slots__ = ("kind", "value", "width", "image")

    def __init__(self, kind: str, value: str, width: float, image: Optional[Image.Image] = None):
        self.kind = kind  # "word" | "space" | "newline" | "emoji"
        self.value = value
        self.width = width
        self.image = image


def _tokenize(
    text: str,
    font: ImageFont.FreeTypeFont,
    emoji_size: int,
) -> list[_Token]:
    tokens: list[_Token] = []
    for kind, value in _segments(text):
        if kind == "emoji":
            img = _load_emoji_image(value, emoji_size)
            if img is None:
                # Fallback: render the literal char(s) in the text font; will
                # likely show tofu but we honour the user's input as best we can.
                w = _text_width(value, font)
                tokens.append(_Token("word", value, w))
            else:
                tokens.append(_Token("emoji", value, float(emoji_size), image=img))
            continue

        # Plain text run — split into word/space/newline tokens.
        i = 0
        while i < len(value):
            ch = value[i]
            if ch == "\n":
                tokens.append(_Token("newline", "", 0.0))
                i += 1
                continue
            if ch == " ":
                w = _text_width(" ", font)
                tokens.append(_Token("space", " ", w))
                i += 1
                continue
            # Accumulate a "word" until next space/newline.
            j = i
            while j < len(value) and value[j] not in (" ", "\n"):
                j += 1
            word = value[i:j]
            tokens.append(_Token("word", word, _text_width(word, font)))
            i = j
    return tokens


def _text_width(s: str, font: ImageFont.FreeTypeFont) -> float:
    if not s:
        return 0.0
    try:
        return font.getlength(s)
    except Exception:
        bbox = font.getbbox(s)
        return float(bbox[2] - bbox[0])


def _load_emoji_image(native: str, target_px: int) -> Optional[Image.Image]:
    p = get_apple_emoji_png(native)
    if p is None:
        return None
    try:
        img = Image.open(p).convert("RGBA")
    except Exception as e:
        log.warning("PIL failed to open emoji %s: %s", p, e)
        return None
    # Always resize to target_px (the source PNGs are usually 64px). LANCZOS
    # gives us crisp downscale; for upscaling above 64 the result is a bit soft
    # but caption emojis are rarely > 80–100px tall in practice.
    if img.size != (target_px, target_px):
        img = img.resize((target_px, target_px), Image.LANCZOS)
    return img


# ---- line-fill -------------------------------------------------------


class _Line:
    __slots__ = ("tokens", "width", "ascent_emoji_lift")

    def __init__(self) -> None:
        self.tokens: list[_Token] = []
        self.width: float = 0.0


def _wrap_tokens(tokens: list[_Token], max_width: float) -> list[_Line]:
    lines: list[_Line] = [_Line()]
    cur = lines[0]

    def push_new_line() -> None:
        nonlocal cur
        cur = _Line()
        lines.append(cur)

    for tok in tokens:
        if tok.kind == "newline":
            push_new_line()
            continue

        if tok.kind == "space":
            # Skip leading spaces on a fresh line.
            if not cur.tokens:
                continue
            # Don't allow spaces alone past max_width; just drop overflow space.
            if cur.width + tok.width > max_width:
                push_new_line()
                continue
            cur.tokens.append(tok)
            cur.width += tok.width
            continue

        # word / emoji
        if cur.width + tok.width <= max_width or not cur.tokens:
            cur.tokens.append(tok)
            cur.width += tok.width
        else:
            # Drop trailing space on the line we're closing.
            if cur.tokens and cur.tokens[-1].kind == "space":
                cur.width -= cur.tokens[-1].width
                cur.tokens.pop()
            push_new_line()
            cur.tokens.append(tok)
            cur.width += tok.width

    # Trim trailing whitespace tokens from each line.
    for line in lines:
        while line.tokens and line.tokens[-1].kind == "space":
            line.width -= line.tokens[-1].width
            line.tokens.pop()
    return lines


# ---- main entry -----------------------------------------------------


def render_text_layer_to_png(
    layer: dict[str, Any],
    font_path: Path,
    output_w: int,
    output_h: int,
    out_path: Path,
) -> Optional[Path]:
    """Render a text layer to a transparent canvas-sized PNG.

    Returns out_path on success, None on hard failure (caller should fall back
    to drawtext or skip the layer).
    """
    data = layer.get("data") or {}
    text = str(data.get("text") or "")
    if not text:
        return None

    font_size = max(8, int(float(data.get("font_size_pct", 5)) / 100 * output_h))
    try:
        opacity = max(0.0, min(1.0, float(data.get("opacity", 1.0))))
    except (TypeError, ValueError):
        opacity = 1.0
    color = _apply_opacity(_hex(data.get("color", "#FFFFFF")), opacity)
    align = str(data.get("align", "center"))
    style = str(data.get("style", "plain"))
    line_height = float(data.get("line_height", 1.2))
    letter_spacing_em = float(data.get("letter_spacing", 0.0))
    max_width_pct = float(data.get("max_width_pct", 80))

    x_pct = float(layer.get("x_pct", 25))
    y_pct = float(layer.get("y_pct", 35))
    w_pct = float(layer.get("width_pct", 50))
    h_pct = float(layer.get("height_pct", 30))

    layer_x = int(x_pct / 100 * output_w)
    layer_y = int(y_pct / 100 * output_h)
    layer_w = int(w_pct / 100 * output_w)
    layer_h = int(h_pct / 100 * output_h)

    # Frontend uses `cqw` (canvas width) for max-width — same here.
    # Cap par layer_w pour matcher le frontend (text-layer.tsx applique
    # `min(${max_width_pct}cqw, 100%)` où le 100% = layer wrapper width).
    max_text_w = max(50.0, max_width_pct / 100 * output_w)
    max_text_w = min(max_text_w, float(layer_w))

    # Phase 33c — REVERT du × 0.98 introduit en 33b.
    #
    # Le × 0.98 visait à éviter que le backend wrap plus tard que le
    # frontend (cas "Texteqsdqsdqsdqs" qui sortait du frame). Mais il
    # crée le bug INVERSE pour d'autres contenus : ex "Mais t'as que
    # 18 ans" qui tient sur 1 ligne en preview mais wrap en 2 lignes
    # au backend ("Mais t'as que 18" + "ans"). Le 0.98 sur-réduit le
    # max_text_w → wrap trop précoce.
    #
    # Cause de fond : PIL n'utilise pas le même text shaper que le
    # browser (HarfBuzz). Selon le contenu (chars répétitifs vs
    # apostrophes/chiffres vs ligatures), PIL peut sur-estimer OU
    # sous-estimer la largeur. Pas de constante magique qui fixe les
    # 2 cas en même temps.
    #
    # Vraie solution propre = pre-wrap côté frontend avec
    # canvas.measureText puis envoi des lignes pré-wrappées au
    # backend qui les dessine sans recalcul. À implémenter en
    # Phase 34. En attendant, on retire la marge artificielle qui
    # casse plus de cas qu'elle n'en répare.

    try:
        font = ImageFont.truetype(str(font_path), size=font_size)
    except Exception as e:
        log.warning("PIL truetype load %s failed: %s", font_path, e)
        return None

    # Ascent / descent / line spacing.
    try:
        ascent, descent = font.getmetrics()
    except Exception:
        ascent, descent = font_size, int(font_size * 0.2)
    base_line_h = ascent + descent
    # CSS-equivalent line spacing: line-height multiplies the font-size,
    # NOT the natural ascent+descent box. Using ascent+descent here would
    # give a noticeably more spaced-out output than the editor canvas
    # (which uses CSS), since most fonts have ascent+descent ≈ 1.1-1.3 ×
    # font_size. Multiplying by font_size keeps the two paths in sync.
    line_spacing = int(round(font_size * line_height))

    # Letter spacing — Pillow doesn't directly support it, so we render
    # character-by-character when ≠ 0. Cheap to skip when the user leaves
    # it at the default 0.
    extra_letter_px = int(round(letter_spacing_em * font_size))

    emoji_size = int(round(font_size * 0.95))  # tiny pad below cap height

    # Phase 34 — Pre-wrapped lines provided by the frontend ?
    #
    # If `data.precomputed_lines` is a non-empty list of strings, the
    # frontend has already computed the wrap using canvas.measureText
    # (which uses the exact same metrics as the browser DOM that
    # rendered the editor preview). We skip our own wrap and tokenize
    # each pre-computed line as a single line — guarantees that the
    # rendered output matches the preview pixel-for-pixel, regardless
    # of font / size / max-width / text content.
    #
    # Fallback : when the field is absent (legacy templates) or empty
    # (frontend couldn't measure for some reason), we wrap here with
    # PIL metrics like before. Backwards-compatible.
    precomputed = data.get("precomputed_lines")
    if isinstance(precomputed, list) and any(
        isinstance(ln, str) for ln in precomputed
    ):
        lines = []
        for ln in precomputed:
            line_text = str(ln) if isinstance(ln, str) else ""
            line = _Line()
            for tok in _tokenize(line_text, font, emoji_size):
                if tok.kind == "newline":
                    continue
                if extra_letter_px and tok.kind == "word":
                    tok.width += extra_letter_px * max(0, len(tok.value) - 1)
                line.tokens.append(tok)
                line.width += tok.width
            # Same trailing-space trim as _wrap_tokens applies.
            while line.tokens and line.tokens[-1].kind == "space":
                line.width -= line.tokens[-1].width
                line.tokens.pop()
            lines.append(line)
    else:
        tokens = _tokenize(text, font, emoji_size)
        # Letter-spacing: bump word widths so wrap accounts for it.
        if extra_letter_px:
            for t in tokens:
                if t.kind == "word":
                    t.width += extra_letter_px * max(0, len(t.value) - 1)
        lines = _wrap_tokens(tokens, max_text_w)

    if not lines or all(not ln.tokens for ln in lines):
        return None

    text_block_h = len(lines) * line_spacing

    # Vertically centre inside the layer bbox.
    y_top = layer_y + max(0, (layer_h - text_block_h) // 2)

    # Create canvas.
    canvas = Image.new("RGBA", (output_w, output_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    # Style-specific paint params. Opacity scales every coloured run.
    stroke_w = 0
    stroke_color = (0, 0, 0, 255)
    if style == "stroke":
        stroke_w = max(1, int(float(data.get("stroke_width", 4))))
        stroke_color = _apply_opacity(_hex(data.get("stroke_color", "#000000")), opacity)
    hl_color: Optional[tuple[int, int, int, int]] = None
    hl_pad_x = 0
    hl_pad_y = 0
    if style == "highlight":
        hl_color = _apply_opacity(_hex(data.get("highlight_color", "#FFEB3B")), opacity)
        pad = int(data.get("highlight_padding", 6))
        hl_pad_x = max(0, pad)
        hl_pad_y = max(0, int(pad * 0.25))

    for li, line in enumerate(lines):
        if not line.tokens:
            continue

        # Horizontal alignment.
        if align == "left":
            x_start = float(layer_x)
        elif align == "right":
            x_start = float(layer_x + layer_w - line.width)
        else:
            x_start = float(layer_x + (layer_w - line.width) / 2)

        y_line = y_top + li * line_spacing

        # Highlight: paint a coloured rect spanning each line's text run.
        if hl_color is not None:
            draw.rectangle(
                [
                    x_start - hl_pad_x,
                    y_line - hl_pad_y,
                    x_start + line.width + hl_pad_x,
                    y_line + base_line_h + hl_pad_y,
                ],
                fill=hl_color,
            )

        # Now paint each token.
        cursor = x_start
        for tok in line.tokens:
            if tok.kind == "emoji" and tok.image is not None:
                # Centre emoji vertically within the text line so it sits
                # baseline-ish — same visual feel as the canvas preview.
                em_y = int(y_line + (base_line_h - emoji_size) / 2)
                em_img = tok.image
                if opacity < 1.0:
                    # Multiply emoji's alpha channel by the layer opacity.
                    alpha = em_img.split()[-1].point(lambda a: int(a * opacity))
                    em_img = em_img.copy()
                    em_img.putalpha(alpha)
                canvas.alpha_composite(em_img, (int(cursor), em_y))
                cursor += tok.width
                continue

            if tok.kind == "word":
                if extra_letter_px:
                    # Render glyph-by-glyph to apply letter spacing.
                    for ch in tok.value:
                        _draw_glyph(
                            draw,
                            (int(cursor), int(y_line)),
                            ch,
                            font,
                            color,
                            stroke_w,
                            stroke_color,
                        )
                        cursor += _text_width(ch, font) + extra_letter_px
                else:
                    _draw_glyph(
                        draw,
                        (int(cursor), int(y_line)),
                        tok.value,
                        font,
                        color,
                        stroke_w,
                        stroke_color,
                    )
                    cursor += tok.width
                continue

            # space
            cursor += tok.width

    # Save the canvas.
    out_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out_path, "PNG", optimize=True)
    return out_path


def _draw_glyph(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int],
    text: str,
    font: ImageFont.FreeTypeFont,
    color: tuple[int, int, int, int],
    stroke_w: int,
    stroke_color: tuple[int, int, int, int],
) -> None:
    if stroke_w > 0:
        draw.text(xy, text, font=font, fill=color,
                  stroke_width=stroke_w, stroke_fill=stroke_color)
    else:
        draw.text(xy, text, font=font, fill=color)


def _hex(value: Any) -> tuple[int, int, int, int]:
    """Parse a #RRGGBB / #RGB / 'red' value to an RGBA tuple."""
    s = str(value or "#FFFFFF").strip()
    if s.startswith("#"):
        s = s[1:]
    if len(s) == 3:
        s = "".join(c * 2 for c in s)
    if len(s) != 6:
        return (255, 255, 255, 255)
    try:
        r = int(s[0:2], 16)
        g = int(s[2:4], 16)
        b = int(s[4:6], 16)
        return (r, g, b, 255)
    except ValueError:
        return (255, 255, 255, 255)


def _apply_opacity(rgba: tuple[int, int, int, int], opacity: float) -> tuple[int, int, int, int]:
    """Multiply an RGBA tuple's alpha channel by opacity (0..1)."""
    if opacity >= 1.0:
        return rgba
    if opacity <= 0.0:
        return (rgba[0], rgba[1], rgba[2], 0)
    return (rgba[0], rgba[1], rgba[2], max(0, min(255, int(round(rgba[3] * opacity)))))


def cache_key_for_layer(layer: dict[str, Any], output_w: int, output_h: int) -> str:
    """Stable hash to dedupe identical text layers across renders within the
    same batch. Caller can use this to name temp PNGs."""
    data = layer.get("data") or {}
    keys = (
        layer.get("type"),
        data.get("text"),
        data.get("font_id"),
        data.get("font_size_pct"),
        data.get("color"),
        data.get("align"),
        data.get("style"),
        data.get("highlight_color"),
        data.get("highlight_padding"),
        data.get("stroke_color"),
        data.get("stroke_width"),
        data.get("max_width_pct"),
        data.get("line_height"),
        data.get("letter_spacing"),
        layer.get("x_pct"),
        layer.get("y_pct"),
        layer.get("width_pct"),
        layer.get("height_pct"),
        output_w,
        output_h,
    )
    h = hashlib.sha1(repr(keys).encode("utf-8")).hexdigest()[:16]
    return h
