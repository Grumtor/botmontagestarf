/**
 * Pre-wrap text into lines using the browser's CanvasRenderingContext2D.
 *
 * Why this exists : the backend uses PIL (Pillow) which has slightly
 * different text metrics than the browser's HarfBuzz-based rasteriser
 * (kerning, ligatures, sub-pixel positioning). For small font sizes
 * the diff is invisible. For caption-size text (60+ px) on the 1080×1920
 * canvas, the cumulative diff per word can make the backend wrap 1-2
 * words earlier OR later than the preview — visible as extra lines or
 * text spilling out of the frame.
 *
 * Fix : compute the wrap on the frontend with the same metrics the
 * preview uses (canvas.measureText, which matches DOM rendering pixel-
 * for-pixel), and pass the resulting lines to the backend through
 * `data.precomputed_lines`. The backend skips its own wrap when this
 * field is present and just draws line-by-line.
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
 * Single offscreen canvas reused for all measurements (cheap, no DOM
 * cost). We only need its 2D context's measureText().
 */
let _measureCtx: CanvasRenderingContext2D | null = null;
function getCtx(): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null; // SSR guard
  if (_measureCtx) return _measureCtx;
  const cv = document.createElement("canvas");
  const ctx = cv.getContext("2d");
  if (!ctx) return null;
  _measureCtx = ctx;
  return ctx;
}

function buildCssFont(
  fontFamilyName: string,
  fontSizePx: number,
  bold: boolean,
  italic: boolean,
): string {
  const weight = bold ? "700" : "400";
  const style = italic ? "italic" : "normal";
  // Quote family in case it has weird chars; include the same generic
  // fallback used by the preview (text-layer.tsx) so the measurement
  // matches what the user sees on screen.
  return `${style} ${weight} ${fontSizePx}px '${fontFamilyName}', system-ui, sans-serif`;
}

function measureWidth(ctx: CanvasRenderingContext2D, text: string): number {
  if (!text) return 0;
  return ctx.measureText(text).width;
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
  ctx: CanvasRenderingContext2D,
  emojiWidthPx: number,
  extraLetterPx: number,
): Token[] {
  const tokens: Token[] = [];
  const spaceWidth = measureWidth(ctx, " ");
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
      let w = measureWidth(ctx, word);
      // Letter-spacing bump (CSS letter-spacing is additive per gap).
      if (extraLetterPx && word.length > 1) {
        w += extraLetterPx * (word.length - 1);
      }
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
 * True iff the requested font is already loaded into the document's
 * font set. Critical because `font-display: swap` means our @font-face
 * fonts download asynchronously — if we call canvas.measureText before
 * the font is loaded, the canvas silently falls back to system-ui and
 * the metrics are completely wrong (= the bug the user kept seeing
 * even after we shipped the pre-wrap : the wrap was computed against
 * a totally different font than what the DOM eventually rendered).
 */
export function isFontReady(
  fontId: FontId,
  fontSizePx: number,
  bold: boolean,
  italic: boolean,
): boolean {
  if (typeof document === "undefined" || !document.fonts) return false;
  const spec = buildCssFont(fontFamily(fontId), fontSizePx, bold, italic);
  try {
    return document.fonts.check(spec);
  } catch {
    return false;
  }
}

/**
 * Kick the browser to actually download + decode the requested font.
 * Resolves once it's available for canvas.measureText. No-op if already
 * loaded. Use this when fontsReady is false to wait for the load.
 */
export async function ensureFontLoaded(
  fontId: FontId,
  fontSizePx: number,
  bold: boolean,
  italic: boolean,
): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  const spec = buildCssFont(fontFamily(fontId), fontSizePx, bold, italic);
  try {
    await document.fonts.load(spec);
  } catch {
    // Swallow — caller will see precomputeWrapLines return null and
    // fall back to the backend wrap.
  }
}

/**
 * Compute the pre-wrapped lines for a text layer. Returns null if we
 * can't run reliably (SSR, no canvas, OR the requested font isn't
 * loaded yet — in which case canvas.measureText would silently use
 * the wrong font and produce a bogus wrap). The caller should leave
 * `precomputed_lines` empty in that case and trigger ensureFontLoaded
 * + retry once the font is available.
 */
export function precomputeWrapLines(input: PrecomputeInput): string[] | null {
  const ctx = getCtx();
  if (!ctx) return null;
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

  ctx.font = buildCssFont(
    fontFamily(input.font_id),
    fontSizePx,
    input.bold,
    input.italic,
  );

  const emojiWidthPx = fontSizePx * 0.95; // matches backend `emoji_size`
  const extraLetterPx = Math.round(input.letter_spacing * fontSizePx);

  const tokens = tokenize(input.text, ctx, emojiWidthPx, extraLetterPx);
  return wrapTokens(tokens, maxWidthPx);
}
