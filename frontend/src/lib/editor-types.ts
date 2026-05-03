import type {
  Clip,
  FixedClip,
  FontId,
  LayerType,
  PlaceholderClip,
} from "@/lib/api";

// ===== layers ========================================================

export const LAYER_TYPES: { type: LayerType; label: string }[] = [
  { type: "text", label: "Texte" },
  { type: "image", label: "Image" },
  { type: "gif", label: "GIF" },
  { type: "emoji", label: "Emoji" },
];

export const LAYER_LABELS: Record<LayerType, string> = LAYER_TYPES.reduce(
  (acc, x) => ({ ...acc, [x.type]: x.label }),
  {} as Record<LayerType, string>,
);

export const LAYER_COLORS: Record<LayerType, string> = {
  text: "rgba(59, 130, 246, 0.55)",
  image: "rgba(34, 197, 94, 0.55)",
  gif: "rgba(168, 85, 247, 0.55)",
  emoji: "rgba(234, 179, 8, 0.55)",
};

export function defaultLayerData(type: LayerType): Record<string, unknown> {
  if (type === "text") {
    return {
      text: "Texte",
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
  // image / gif / emoji default — file_id null until user uploads
  return { file_id: null, rotation_deg: 0, opacity: 1, ratio_locked: true };
}

// ===== fonts =========================================================

export function fontFamily(fontId: FontId): string {
  return `bm-font-${fontId}`;
}

// ===== clips =========================================================

export function clipDuration(clip: Clip): number {
  if (clip.type === "fixed") {
    if (clip.trim_out != null) return Math.max(0, clip.trim_out - clip.trim_in);
    return Math.max(0, (clip.source_duration_sec ?? 0) - clip.trim_in);
  }
  return Math.max(0, clip.duration_sec);
}

export function totalDuration(clips: Clip[]): number {
  return clips.reduce((s, c) => s + clipDuration(c), 0);
}

export function clipStartTimes(clips: Clip[]): number[] {
  const out: number[] = [];
  let cursor = 0;
  for (const c of clips) {
    out.push(cursor);
    cursor += clipDuration(c);
  }
  return out;
}

/** Map an output time to (clipIndex, localTime within that clip).
 * Returns null if past the end. */
export function timelineToClip(
  outputTime: number,
  clips: Clip[],
): { clipIndex: number; localTime: number } | null {
  let cursor = 0;
  for (let i = 0; i < clips.length; i++) {
    const dur = clipDuration(clips[i]);
    const end = cursor + dur;
    const last = i === clips.length - 1;
    if (outputTime < end || (last && outputTime <= end)) {
      return { clipIndex: i, localTime: outputTime - cursor };
    }
    cursor = end;
  }
  return null;
}

// ===== misc ==========================================================

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

export function formatTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const m = Math.floor(safe / 60);
  const s = Math.floor(safe % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function makeFixedClip(
  fileId: string,
  durationSec: number | null,
  width: number | null,
  height: number | null,
): FixedClip {
  return {
    id: crypto.randomUUID(),
    type: "fixed",
    file_id: fileId,
    source_duration_sec: durationSec,
    source_width: width,
    source_height: height,
    trim_in: 0,
    trim_out: durationSec,
    audio_enabled: true,
    audio_volume: 1.0,
  };
}

export function makePlaceholderClip(durationSec: number = 3.0): PlaceholderClip {
  return {
    id: crypto.randomUUID(),
    type: "placeholder",
    duration_sec: durationSec,
    trim_in: 0,
    trim_out: null,
    audio_enabled: true,
    audio_volume: 1.0,
  };
}
