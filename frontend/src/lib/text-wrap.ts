/**
 * Pre-wrap text into lines using a hidden DOM <span> for measurement.
 *
 * Why this exists : the backend uses PIL (Pillow) which has slightly
 * different text metrics than the browser's HarfBuzz-based rasteriser
 * (kerning, ligatures, sub-pixel positioning). For small font sizes
 * the diff is invisible. For caption-size text (60+ px) on the 1080×1920
 * canvas, the cumulative diff per word can make the backend wrap 1-2
 * words earlier OR later than the preview — visible as extra lines or
 * text spilling out of the frame.
 *
 * Fix : compute the wrap on the frontend with the SAME rendering path
 * the preview uses (DOM <span> + getBoundingClientRect), and pass the
 * resulting lines to the backend through `data.precomputed_lines`.
 * The backend skips its own wrap when this field is present and just
 * draws line-by-line.
 *
 * Why DOM measurement and NOT canvas.measureText : we tried
 * canvas.measureText first but Chrome has a bug where the canvas can
 * silently fall back to monospace/system-ui even after the font has
 * loaded (chromium issues/40698829). The canvas font fallback chain
 * also doesn't always match the DOM's, especially for @font-face
 * fonts. Measuring via a hidden DOM span is guaranteed identical to
 * how the preview will render.
 *
 * Mirrors the tokenization + line-fill logic of
 * `backend/app/render/text_renderer.py` (_tokenize + _wrap_tokens) so
 * that newline handling, leading-space trimming, etc. behave the same.
 */

import { fontFamily } from "@/lib/editor-types";
import type { FontId } from "@/lib/api";

// Backend renders the final video at 1080×1920. All "pct" fields in the
// layer data resolve against these dimensions. We measure in render-pixels
// so the layout we compute is the layout the backend will draw.
const RENDER_W = 1080;
const RENDER_H = 1920;

// Regexes mirror the backend's `_segments` split. We treat any character
// classified as a grapheme containing an Emoji/Extended_Pictographic/
// Regional_Indicator codepoint as a single emoji token; everything else
// goes through word/space/newline tokenization.
const EMOJI_GRAPHEME_RE = /\p{Extended_Pictographic}(\u{FE0F}|\u{200D}\p{Extended_Pictographic})*|\p{Regional_Indicator}{2}/gu;

type Token =
  | { kind: "word"; value: string; width: number }
  | { kind: "space"; width: number }
  | { kind: "newline" }
  | { kind: "emoji"; value: string; width: number };

/**
 * DOM-based text measurement (replaced canvas.measureText after the
 * Chrome bug + canvas font-fallback drift bit us twice in a row).
 *
 * We use a hidden `<span>` instead of an offscreen canvas so the
 * measurement uses **literally the same font resolution + shaping**
 * the DOM uses to render the preview. Guarantees pixel-perfect
 * agreement between what the user sees on screen and what we send
 * to the backend.
 *
 * The span is created once and reused across calls (set textContent +
 * read offsetWidth = ~0.1ms). Hidden via visibility:hidden +
 * position:absolute + pointer-events:none so it doesn't affect layout
 * or interaction.
 */
let _measureSpan: HTMLSpanElement | null = null;
function getMeasureSpan(): HTMLSpanElement | null {
  if (typeof document === "undefined" || !document.body) return null;
  if (_measureSpan && _measureSpan.isConnected) return _measureSpan;
  const span = document.createElement("span");
  span.setAttribute("aria-hidden", "true");
  span.style.position = "absolute";
  span.style.visibility = "hidden";
  span.style.pointerEvents = "none";
  span.style.top = "-9999px";
  span.style.left = "-9999px";
  span.style.whiteSpace = "pre";
  span.style.margin = "0";
  span.style.padding = "0";
  span.style.border = "0";
  // Keep the box exactly text-width so offsetWidth = actual rendered
  // width (no inline-block padding artefacts).
  span.style.display = "inline-block";
  document.body.appendChild(span);
  _measureSpan = span;
  return span;
}

function applySpanFont(
  span: HTMLSpanElement,
  fontFamilyName: string,
  fontSizePx: number,
  bold: boolean,
  italic: boolean,
  letterSpacingEm: number,
): void {
  span.style.fontFamily = `'${fontFamilyName}', system-ui, sans-serif`;
  span.style.fontSize = `${fontSizePx}px`;
  span.style.fontWeight = bold ? "700" : "400";
  span.style.fontStyle = italic ? "italic" : "normal";
  span.style.letterSpacing = `${letterSpacingEm}em`;
}

function measureWidth(span: HTMLSpanElement, text: string): number {
  if (!text) return 0;
  span.textContent = text;
  // getBoundingClientRect returns fractional pixels, more precise than
  // offsetWidth which rounds to integers.
  return span.getBoundingClientRect().width;
}

/** Split text into runs of either plain text or single emoji graphemes,
 *  preserving order. Mirrors backend `_segments`. */
function segmentText(text: string): Array<{ kind: "text" | "emoji"; value: string }> {
  if (!text) return [];
  const out: Array<{ kind: "text" | "emoji"; value: string }> = [];
  let lastIdx = 0;
  // We need to iterate emoji graphemes in order with their indices.
  EMOJI_GRAPHEME_RE.lastIndex = 0;
  for (const match of text.matchAll(EMOJI_GRAPHEME_RE)) {
    const idx = match.index ?? 0;
    if (idx > lastIdx) {
      out.push({ kind: "text", value: text.slice(lastIdx, idx) });
    }
    out.push({ kind: "emoji", value: match[0] });
    lastIdx = idx + match[0].length;
  }
  if (lastIdx < text.length) {
    out.push({ kind: "text", value: text.slice(lastIdx) });
  }
  // Some random graphemes can slip through if the regex misses combining
  // sequences — they'll just render as plain text, which is fine.
  return out;
}

function tokenize(
  text: string,
  span: HTMLSpanElement,
  emojiWidthPx: number,
): Token[] {
  const tokens: Token[] = [];
  // Letter-spacing is already baked into the span style, so measureWidth
  // returns widths that include letter-spacing. No need to apply it
  // again on top.
  const spaceWidth = measureWidth(span, " ");
  for (const seg of segmentText(text)) {
    if (seg.kind === "emoji") {
      tokens.push({ kind: "emoji", value: seg.value, width: emojiWidthPx });
      continue;
    }
    const value = seg.value;
    let i = 0;
    while (i < value.length) {
      const ch = value[i];
      if (ch === "\n") {
        tokens.push({ kind: "newline" });
        i += 1;
        continue;
      }
      if (ch === " ") {
        tokens.push({ kind: "space", width: spaceWidth });
        i += 1;
        continue;
      }
      // Accumulate until next space/newline.
      let j = i;
      while (j < value.length && value[j] !== " " && value[j] !== "\n") {
        j += 1;
      }
      const word = value.slice(i, j);
      const w = measureWidth(span, word);
      tokens.push({ kind: "word", value: word, width: w });
      i = j;
    }
  }
  return tokens;
}

/** Greedy line-fill — mirrors backend `_wrap_tokens`. */
function wrapTokens(tokens: Token[], maxWidth: number): string[] {
  type Line = { tokens: Token[]; width: number };
  const lines: Line[] = [{ tokens: [], width: 0 }];
  let cur = lines[0];
  const pushNewLine = () => {
    cur = { tokens: [], width: 0 };
    lines.push(cur);
  };

  for (const tok of tokens) {
    if (tok.kind === "newline") {
      pushNewLine();
      continue;
    }
    if (tok.kind === "space") {
      // Skip leading spaces on a fresh line.
      if (cur.tokens.length === 0) continue;
      if (cur.width + tok.width > maxWidth) {
        pushNewLine();
        continue;
      }
      cur.tokens.push(tok);
      cur.width += tok.width;
      continue;
    }
    // word | emoji
    if (cur.width + tok.width <= maxWidth || cur.tokens.length === 0) {
      cur.tokens.push(tok);
      cur.width += tok.width;
    } else {
      // Drop trailing space on the closing line.
      const last = cur.tokens[cur.tokens.length - 1];
      if (last && last.kind === "space") {
        cur.width -= last.width;
        cur.tokens.pop();
      }
      pushNewLine();
      cur.tokens.push(tok);
      cur.width += tok.width;
    }
  }

  // Trim trailing whitespace tokens from each line.
  for (const ln of lines) {
    while (ln.tokens.length > 0) {
      const last = ln.tokens[ln.tokens.length - 1];
      if (last.kind !== "space") break;
      ln.width -= last.width;
      ln.tokens.pop();
    }
  }

  // Serialise tokens back into plain strings the backend will draw verbatim.
  return lines.map((ln) =>
    ln.tokens
      .map((t) => (t.kind === "word" || t.kind === "emoji" ? t.value : " "))
      .join(""),
  );
}

export type PrecomputeInput = {
  text: string;
  font_id: FontId;
  font_size_pct: number;
  max_width_pct: number;
  width_pct: number;
  letter_spacing: number;
  bold: boolean;
  italic: boolean;
};

/**
 * True iff the requested font is actually loaded and rendering in the
 * DOM (not a fallback). We test this by comparing the width of a
 * reference string rendered with the custom font (then a known
 * different fallback) against the same string rendered with that
 * fallback alone. If widths differ, the browser IS using our font.
 * If they match, it fell back = font not loaded.
 *
 * Works regardless of canvas/DOM API quirks because we measure
 * directly via the same DOM rendering path the preview uses.
 */
export function isFontReady(
  fontId: FontId,
  fontSizePx: number,
  bold: boolean,
  italic: boolean,
): boolean {
  const span = getMeasureSpan();
  if (!span) return false;

  const family = fontFamily(fontId);
  const weight = bold ? "700" : "400";
  const style = italic ? "italic" : "normal";
  const sample = "WiQg.,!";

  // First : measure with our font, fallback to monospace.
  span.style.fontFamily = `'${family}', monospace`;
  span.style.fontSize = `${fontSizePx}px`;
  span.style.fontWeight = weight;
  span.style.fontStyle = style;
  span.style.letterSpacing = "0";
  span.textContent = sample;
  const wCustom = span.getBoundingClientRect().width;

  // Then : measure with monospace alone.
  span.style.fontFamily = "monospace";
  const wMono = span.getBoundingClientRect().width;

  return Math.abs(wCustom - wMono) > 0.5;
}

/**
 * Kick the browser to actually download + decode the requested font.
 * Resolves once it's available. No-op if already loaded. Use this
 * when isFontReady() returns false to trigger the load + retry.
 */
export async function ensureFontLoaded(
  fontId: FontId,
  fontSizePx: number,
  bold: boolean,
  italic: boolean,
): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  const family = fontFamily(fontId);
  const weight = bold ? "700" : "400";
  const style = italic ? "italic" : "normal";
  const spec = `${style} ${weight} ${fontSizePx}px '${family}'`;
  try {
    await document.fonts.load(spec);
  } catch {
    // Swallow — caller will see precomputeWrapLines return null and
    // fall back to the backend wrap.
  }
}

/**
 * Compute the pre-wrapped lines for a text layer. Returns null if we
 * can't run reliably (SSR, no DOM, OR the requested font isn't loaded
 * yet — in which case the measurement would silently use a fallback
 * font and produce a bogus wrap). The caller should leave
 * `precomputed_lines` empty in that case and trigger ensureFontLoaded
 * + retry once the font is available.
 *
 * Implementation note : measurement uses a hidden DOM <span>, not
 * canvas.measureText, because canvas has font-resolution quirks that
 * don't match the DOM exactly (Chrome bug + different fallback chain
 * for canvas vs DOM). The DOM-based measurement is guaranteed to
 * match what the preview renders pixel-for-pixel.
 */
export function precomputeWrapLines(input: PrecomputeInput): string[] | null {
  const span = getMeasureSpan();
  if (!span) return null;
  if (!input.text) return [];

  const fontSizePx = (input.font_size_pct / 100) * RENDER_H;
  if (fontSizePx < 1) return [];

  if (!isFontReady(input.font_id, fontSizePx, input.bold, input.italic)) {
    return null;
  }

  // Match backend cap: min(max_width_pct % canvas_w, layer_width_pct % canvas_w).
  const maxWidthPx = Math.max(
    50,
    Math.min(
      (input.max_width_pct / 100) * RENDER_W,
      (input.width_pct / 100) * RENDER_W,
    ),
  );

  applySpanFont(
    span,
    fontFamily(input.font_id),
    fontSizePx,
    input.bold,
    input.italic,
    input.letter_spacing,
  );

  const emojiWidthPx = fontSizePx * 0.95; // matches backend `emoji_size`

  const tokens = tokenize(input.text, span, emojiWidthPx);
  return wrapTokens(tokens, maxWidthPx);
}
