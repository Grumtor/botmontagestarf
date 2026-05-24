"use client";

import type { CSSProperties } from "react";
import { fontFamily } from "@/lib/editor-types";
import type { TextLayerData } from "@/lib/api";
import { parseTextWithEmojis } from "@/lib/apple-emoji";

/**
 * Renders the text content of a text layer inside the layer's bounding box.
 * The bounding box itself is positioned by the parent CanvasLayer wrapper
 * (in % of the canvas). Font size uses `cqh` so it scales with the canvas
 * height — requires the canvas root to have `container-type: size`.
 *
 * Emojis embedded in the text are rendered as Apple emoji PNGs from the
 * emoji-datasource-apple jsdelivr CDN. Plain text segments use the configured
 * font.
 */
export function TextLayerContent({
  data,
  text,
}: {
  data: TextLayerData;
  text: string;
}) {
  const justify =
    data.align === "left"
      ? "flex-start"
      : data.align === "right"
      ? "flex-end"
      : "center";

  const containerStyle: CSSProperties = {
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: justify,
    pointerEvents: "none",
    opacity: typeof data.opacity === "number" ? data.opacity : 1,
  };

  const baseTextStyle: CSSProperties = {
    fontFamily: `'${fontFamily(data.font_id)}', system-ui, sans-serif`,
    fontSize: `${data.font_size_pct}cqh`,
    color: data.color,
    fontWeight: data.bold ? 700 : 400,
    fontStyle: data.italic ? "italic" : "normal",
    textAlign: data.align,
    lineHeight: data.line_height,
    letterSpacing: `${data.letter_spacing}em`,
    // Phase 33b — Le wrap doit matcher exactement ce que fait le backend
    // (text_renderer.py), qui cap par min(max_width_pct, layer_w). Le
    // `cqw` est relatif à la canvas root, le `100%` est relatif au
    // parent (= le layer wrapper, qui fait width_pct% de la canvas).
    // Avec `min(...)`, on cap par le plus petit des deux — alignement
    // pixel-perfect avec le backend.
    maxWidth: `min(${data.max_width_pct}cqw, 100%)`,
    margin: 0,
    padding: 0,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    pointerEvents: "auto",
  };

  if (data.style === "highlight") {
    // Outer span paints the background (per-line) thanks to box-decoration-break: clone.
    return (
      <div style={containerStyle}>
        <div style={{ ...baseTextStyle, color: undefined }}>
          <span
            style={{
              color: data.color,
              backgroundColor: data.highlight_color,
              padding: `${data.highlight_padding * 0.25}px ${data.highlight_padding}px`,
              boxDecorationBreak: "clone",
              WebkitBoxDecorationBreak: "clone",
            }}
          >
            <RenderedText text={text} />
          </span>
        </div>
      </div>
    );
  }

  if (data.style === "stroke") {
    const sw = data.stroke_width;
    const sc = data.stroke_color;
    const shadows = [
      [sw, 0],
      [-sw, 0],
      [0, sw],
      [0, -sw],
      [sw, sw],
      [-sw, -sw],
      [sw, -sw],
      [-sw, sw],
    ]
      .map(([x, y]) => `${x}px ${y}px 0 ${sc}`)
      .join(", ");
    return (
      <div style={containerStyle}>
        <div
          style={{
            ...baseTextStyle,
            WebkitTextStroke: `${sw}px ${sc}`,
            textShadow: shadows,
            paintOrder: "stroke fill",
          }}
        >
          <RenderedText text={text} />
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={baseTextStyle}>
        <RenderedText text={text} />
      </div>
    </div>
  );
}

/**
 * Splits the input string into text + Apple emoji <img> spans.
 * Emoji images are sized at 1em so they match the surrounding font-size.
 */
function RenderedText({ text }: { text: string }) {
  const segments = parseTextWithEmojis(text);
  if (segments.length === 0) return null;
  return (
    <>
      {segments.map((seg, i) =>
        seg.kind === "text" ? (
          <span key={i}>{seg.value}</span>
        ) : (
          <img
            key={i}
            src={seg.url}
            alt={seg.native}
            draggable={false}
            style={{
              height: "1em",
              width: "1em",
              display: "inline-block",
              verticalAlign: "-0.15em",
              objectFit: "contain",
              // Strip any inherited stroke/shadow effects so the PNG glyph
              // stays crisp inside stroke-styled text.
              WebkitTextStroke: 0,
              textShadow: "none",
            }}
          />
        ),
      )}
    </>
  );
}
