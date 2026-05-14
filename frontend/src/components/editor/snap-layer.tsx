"use client";

import type { CSSProperties } from "react";

import { parseTextWithEmojis } from "@/lib/apple-emoji";
import type { SnapLayerData } from "@/lib/api";

/**
 * Snapchat-style caption bar overlay.
 *
 * Visual signature (matches the iOS Snap app):
 *   - Full canvas width (edge to edge)
 *   - Semi-transparent black background (~40% opacity)
 *   - Centred white text, bold sans, slightly tighter spacing
 *   - Auto-height based on font size + vertical padding
 *
 * In the editor we render the bar at the layer's `y_pct` (sample
 * position). The actual render-time vertical position is randomised by
 * the backend between `y_pct_min` and `y_pct_max`. The user controls
 * those values from the inspector — the canvas is a preview.
 *
 * Emojis are rendered as Apple PNG glyphs (same as text layers).
 */
export function SnapLayerContent({
  data,
}: {
  data: SnapLayerData;
}) {
  // Pick the first non-empty variation for display, fall back to `text`.
  const display =
    data.text_pool.find((t) => t.trim().length > 0) ?? data.text ?? "";

  const fontPx = Math.max(10, data.font_size_px);
  const padY = Math.round(fontPx * 0.55);
  const padX = Math.round(fontPx * 0.7);

  const containerStyle: CSSProperties = {
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "none",
    backgroundColor: "rgba(0, 0, 0, 0.45)",
    paddingTop: padY,
    paddingBottom: padY,
    paddingLeft: padX,
    paddingRight: padX,
    overflow: "hidden",
  };

  const textStyle: CSSProperties = {
    fontSize: `${fontPx}px`,
    fontWeight: 600,
    color: "#FFFFFF",
    fontFamily: "system-ui, -apple-system, 'Helvetica Neue', sans-serif",
    textAlign: "center",
    lineHeight: 1.15,
    margin: 0,
    padding: 0,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    pointerEvents: "auto",
  };

  const segments = parseTextWithEmojis(display);

  return (
    <div style={containerStyle}>
      <div style={textStyle}>
        {segments.map((seg, i) =>
          seg.kind === "text" ? (
            <span key={i}>{seg.value}</span>
          ) : (
            /* eslint-disable-next-line @next/next/no-img-element */
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
              }}
            />
          ),
        )}
      </div>
    </div>
  );
}
