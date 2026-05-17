import type {
  Clip,
  FixedClip,
  FontId,
  ImageClip,
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
  text: "rgba(59, 130, 246, 0.55)",      // bleu
  image: "rgba(34, 197, 94, 0.55)",      // vert
  gif: "rgba(236, 72, 153, 0.55)",       // rose
  emoji: "rgba(249, 115, 22, 0.55)",     // orange
};

// ===== clip color palette (Phase 26c) =================================
//
// Consistent colors across the main track, extra tracks, and the
// inspector. Tailwind class strings — keep in sync with how they're used
// (bg-* / border-* / text-*).
export const CLIP_COLORS = {
  fixed: {
    bg: "bg-violet-700/80",
    hover: "hover:bg-violet-600/80",
    chip: "bg-violet-500/90",
  },
  image: {
    bg: "bg-emerald-700/80",
    hover: "hover:bg-emerald-600/80",
    chip: "bg-emerald-500/90",
  },
  placeholder: {
    bg: "bg-yellow-700/30",
    border: "border-dashed border-yellow-500/70",
    chip: "bg-yellow-500/90",
  },
};

export function defaultLayerData(type: LayerType): Record<string, unknown> {
  if (type === "text") {
    // Defaults choisis par le user (Phase 25) : Montserrat Bold + contour
    // 3px + saut de ligne serré style Insta. Tous les autres champs gardent
    // leurs valeurs neutres legacy.
    return {
      text: "Texte",
      font_id: "montserrat_bold",
      font_size_pct: 5,
      color: "#FFFFFF",
      align: "center",
      style: "stroke",
      highlight_color: "#FFEB3B",
      highlight_padding: 6,
      stroke_color: "#000000",
      stroke_width: 3,
      max_width_pct: 80,
      line_height: 0.95,
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
  const freezeTail = Math.max(0, (clip as { freeze_tail_sec?: number }).freeze_tail_sec ?? 0);
  if (clip.type === "fixed") {
    if (clip.trim_out != null)
      return Math.max(0, clip.trim_out - clip.trim_in) + freezeTail;
    return Math.max(0, (clip.source_duration_sec ?? 0) - clip.trim_in) + freezeTail;
  }
  // image and placeholder both expose duration_sec
  return Math.max(0, clip.duration_sec) + freezeTail;
}

export function totalDuration(clips: Clip[]): number {
  return clips.reduce((s, c) => s + clipDuration(c), 0);
}

/** Phase 28 — total duration considering all tracks (main + extras +
 *  layers + audio overlay). Used to size the timeline so the user sees
 *  EVERYTHING that exists, not just the main track. */
export function timelineDuration(opts: {
  clips: Clip[];
  extraTracks?: { clips: { type: "fixed" | "image" | "placeholder";
    start_time: number; trim_in: number; trim_out: number | null;
    duration_sec?: number; source_duration_sec?: number | null;
    freeze_tail_sec?: number;
  }[] }[];
  layers?: { end_time: number }[];
}): number {
  let max = totalDuration(opts.clips);
  for (const t of opts.extraTracks ?? []) {
    for (const c of t.clips) {
      const freezeTail = Math.max(0, c.freeze_tail_sec ?? 0);
      const dur =
        c.type === "fixed"
          ? c.trim_out != null
            ? Math.max(0, c.trim_out - c.trim_in) + freezeTail
            : Math.max(0, (c.source_duration_sec ?? 0) - c.trim_in) + freezeTail
          : Math.max(0, c.duration_sec ?? 0) + freezeTail;
      const end = c.start_time + dur;
      if (end > max) max = end;
    }
  }
  for (const l of opts.layers ?? []) {
    if (l.end_time > max) max = l.end_time;
  }
  return max;
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
    filter: "none",
    filter_start_sec: null,
    filter_end_sec: null,
    freeze_tail_sec: 0,
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
    filter: "none",
    filter_start_sec: null,
    filter_end_sec: null,
    freeze_tail_sec: 0,
  };
}

export function makeImageClip(
  fileId: string,
  width: number | null,
  height: number | null,
  durationSec: number = 3.0,
): ImageClip {
  return {
    id: crypto.randomUUID(),
    type: "image",
    file_id: fileId,
    duration_sec: durationSec,
    source_width: width,
    source_height: height,
    trim_in: 0,
    trim_out: null,
    audio_enabled: false,
    audio_volume: 0,
    filter: "none",
    filter_start_sec: null,
    filter_end_sec: null,
    freeze_tail_sec: 0,
  };
}
