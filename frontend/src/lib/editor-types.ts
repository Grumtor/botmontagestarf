import type {
  AnimationPreset,
  EffectType,
  FontId,
  LayerType,
  SourceSegment,
  TransitionType,
} from "@/lib/api";

export const EFFECT_TYPES: { type: EffectType; label: string }[] = [
  { type: "saturation", label: "Saturation" },
  { type: "brightness", label: "Brightness" },
  { type: "contrast", label: "Contrast" },
  { type: "vignette", label: "Vignette" },
  { type: "blur", label: "Blur" },
];

export const ANIMATION_PRESETS: { preset: AnimationPreset; label: string }[] = [
  { preset: "zoom_in_slow", label: "Zoom in slow" },
  { preset: "zoom_in_punch", label: "Zoom in punch" },
  { preset: "zoom_out_slow", label: "Zoom out slow" },
  { preset: "pan_left_right", label: "Pan ←→" },
  { preset: "pan_right_left", label: "Pan →←" },
  { preset: "shake", label: "Shake" },
];

export function effectForceRange(type: EffectType): { min: number; max: number } {
  if (type === "vignette" || type === "blur") return { min: 0, max: 100 };
  return { min: -100, max: 100 };
}

// ---- source segments helpers ----------------------------------------

export const TRANSITION_TYPES: { type: TransitionType; label: string }[] = [
  { type: "cut", label: "Cut" },
  { type: "fade", label: "Fade" },
  { type: "slide-left", label: "Slide ←" },
  { type: "slide-right", label: "Slide →" },
  { type: "zoomblur", label: "Zoom blur" },
  { type: "glitch", label: "Glitch" },
];

export function segmentDuration(seg: SourceSegment): number {
  return Math.max(0, seg.out_time - seg.in_time);
}

export function segmentOutputStarts(segments: SourceSegment[]): number[] {
  const starts: number[] = [];
  let cursor = 0;
  for (const seg of segments) {
    starts.push(cursor);
    cursor += segmentDuration(seg);
  }
  return starts;
}

export function totalSegmentDuration(segments: SourceSegment[]): number {
  return segments.reduce((s, seg) => s + segmentDuration(seg), 0);
}

/** Map an output time to (segmentIndex, sourceTime). Returns null past end. */
export function outputToSource(
  outputTime: number,
  segments: SourceSegment[],
): { segmentIndex: number; sourceTime: number } | null {
  let cursor = 0;
  for (let i = 0; i < segments.length; i++) {
    const dur = segmentDuration(segments[i]);
    const end = cursor + dur;
    const last = i === segments.length - 1;
    if (outputTime < end || (last && outputTime <= end)) {
      return {
        segmentIndex: i,
        sourceTime: segments[i].in_time + (outputTime - cursor),
      };
    }
    cursor = end;
  }
  return null;
}

export function fontFamily(fontId: FontId): string {
  return `bm-font-${fontId}`;
}

export function defaultLayerData(type: LayerType): Record<string, unknown> {
  if (type === "text") {
    return {
      text: "Hello",
      font_id: "inter",
      font_size_pct: 5,
      color: "#FFFFFF",
      align: "center",
      style: "plain",
      highlight_color: "#FFEB3B",
      highlight_padding: 6,
      stroke_color: "#000000",
      stroke_width: 4,
      max_width_pct: 80,
      line_height: 1.2,
      letter_spacing: 0,
      bold: false,
      italic: false,
    };
  }
  if (type === "effect") {
    return { type: "saturation", force: 0 };
  }
  if (type === "animation") {
    return { preset: "zoom_in_slow", force: 1.0 };
  }
  return {};
}

export const LAYER_TYPES: { type: LayerType; label: string }[] = [
  { type: "text", label: "Texte" },
  { type: "image", label: "Image" },
  { type: "gif", label: "GIF" },
  { type: "emoji", label: "Emoji" },
  { type: "audio", label: "Audio overlay" },
  { type: "effect", label: "Effet" },
  { type: "animation", label: "Animation" },
];

export const LAYER_LABELS: Record<LayerType, string> = LAYER_TYPES.reduce(
  (acc, x) => ({ ...acc, [x.type]: x.label }),
  {} as Record<LayerType, string>,
);

// rgba so the underlying canvas/video shows through
export const LAYER_COLORS: Record<LayerType, string> = {
  text: "rgba(59, 130, 246, 0.55)",
  image: "rgba(34, 197, 94, 0.55)",
  gif: "rgba(168, 85, 247, 0.55)",
  emoji: "rgba(234, 179, 8, 0.55)",
  audio: "rgba(244, 114, 182, 0.55)",
  effect: "rgba(249, 115, 22, 0.55)",
  animation: "rgba(239, 68, 68, 0.55)",
};

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

export function formatTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const m = Math.floor(safe / 60);
  const s = Math.floor(safe % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
