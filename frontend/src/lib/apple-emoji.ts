// Apple emoji rendering helpers.
//
// We use the emoji-mart dataset to map a native emoji string (e.g. "👍🏼" or
// "👨‍💻") to its "unified" codepoint string (e.g. "1f44d-1f3fc"). That string
// then maps directly to a PNG on the emoji-datasource-apple jsdelivr CDN.
//
// Used by:
//   - components/editor/emoji-picker.tsx (pick emojis with Apple set)
//   - components/editor/text-layer.tsx   (render emojis as Apple PNG glyphs)

import data from "@emoji-mart/data";

const APPLE_EMOJI_BASE =
  "https://cdn.jsdelivr.net/npm/emoji-datasource-apple@15.1.2/img/apple/64";

type EmojiSkin = { native?: string; unified?: string };
type EmojiEntry = { skins?: EmojiSkin[] };
type EmojiMartData = { emojis: Record<string, EmojiEntry> };

const NATIVE_TO_UNIFIED: Map<string, string> = (() => {
  const map = new Map<string, string>();
  const emojis = (data as unknown as EmojiMartData).emojis ?? {};
  for (const id in emojis) {
    const skins = emojis[id]?.skins ?? [];
    for (const skin of skins) {
      if (skin.native && skin.unified) {
        map.set(skin.native, skin.unified.toLowerCase());
      }
    }
  }
  return map;
})();

/** PNG URL on jsdelivr for an Apple emoji glyph, or null if unknown. */
export function getAppleEmojiUrl(native: string): string | null {
  const unified = NATIVE_TO_UNIFIED.get(native);
  if (unified) return `${APPLE_EMOJI_BASE}/${unified}.png`;
  // Fallback: derive unified from codepoints (strip FE0F variation selector).
  const cps: string[] = [];
  for (const ch of native) {
    const cp = ch.codePointAt(0);
    if (cp == null) continue;
    if (cp === 0xfe0f) continue;
    cps.push(cp.toString(16));
  }
  if (cps.length === 0) return null;
  return `${APPLE_EMOJI_BASE}/${cps.join("-")}.png`;
}

const EMOJI_RE = /\p{Extended_Pictographic}/u;

export type TextSegment =
  | { kind: "text"; value: string }
  | { kind: "emoji"; native: string; url: string };

/**
 * Splits text into runs of plain text and emoji graphemes.
 * Uses Intl.Segmenter so multi-codepoint emojis (skin tones, ZWJ sequences,
 * flags, keycaps) stay grouped as a single segment.
 */
export function parseTextWithEmojis(text: string): TextSegment[] {
  if (!text) return [];

  // Old browsers without Intl.Segmenter — fallback to plain text.
  if (typeof Intl === "undefined" || typeof Intl.Segmenter === "undefined") {
    return [{ kind: "text", value: text }];
  }

  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const out: TextSegment[] = [];
  let buffer = "";

  for (const { segment } of segmenter.segment(text)) {
    if (EMOJI_RE.test(segment)) {
      const url = getAppleEmojiUrl(segment);
      if (url) {
        if (buffer) {
          out.push({ kind: "text", value: buffer });
          buffer = "";
        }
        out.push({ kind: "emoji", native: segment, url });
        continue;
      }
    }
    buffer += segment;
  }
  if (buffer) out.push({ kind: "text", value: buffer });
  return out;
}

/** True if the text contains at least one emoji glyph. */
export function hasEmoji(text: string): boolean {
  return EMOJI_RE.test(text);
}
