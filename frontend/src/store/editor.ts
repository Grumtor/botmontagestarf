import { create } from "zustand";
import {
  AudioOverlayConfigSchema,
  ClipSchema,
  ExtraClipSchema,
  LayerSchema,
  Templates,
  type AudioOverlayConfig,
  type Clip,
  type ExtraClip,
  type FixedClip,
  type FontMeta,
  type ImageClip,
  type Layer,
  type LayerType,
  type PlaceholderClip,
  type Template,
  type TemplateLanguage,
} from "@/lib/api";
import {
  defaultLayerData,
  makeFixedClip,
  makeImageClip,
  makePlaceholderClip,
} from "@/lib/editor-types";
import { ensureFontLoaded, precomputeWrapLines } from "@/lib/text-wrap";
import { parseTextData } from "@/lib/api";

const MAX_EXTRA_TRACKS = 4; // 5 total - main track 1
const EXTRA_CLIP_DEFAULT_DURATION = 3.0;

export type ExtraTrack = {
  id: string;
  name: string;
  clips: ExtraClip[];
};

const SAVE_DEBOUNCE_MS = 500;

let saveTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Recompute `data.precomputed_lines` for a text layer using the browser's
 * canvas.measureText (DOM-matching metrics). Called from patchLayer /
 * patchLayerData after any mutation that could affect wrap.
 *
 * The backend reads `data.precomputed_lines` at render time and skips
 * its own PIL-based wrap when this is set → guarantees that the rendered
 * output matches what the preview displays, regardless of font / size /
 * layer width / text content.
 *
 * Font-loading dance : custom @font-face fonts (Montserrat Bold etc.)
 * are downloaded async with `font-display: swap`. If we call
 * canvas.measureText before they're loaded, the canvas silently falls
 * back to system-ui → wrap is completely wrong (was the cause of the
 * "ça change rien après mon fix" bug). When the font isn't ready yet,
 * we leave precomputed_lines absent for now and kick a background load
 * that re-patches the layer once the font is decoded.
 */
function withPrecomputedLines(layer: Layer): Layer {
  if (layer.type !== "text") return layer;
  const td = parseTextData(layer.data);
  const lines = precomputeWrapLines({
    text: td.text,
    font_id: td.font_id,
    font_size_pct: td.font_size_pct,
    max_width_pct: td.max_width_pct,
    width_pct: layer.width_pct,
    letter_spacing: td.letter_spacing,
    bold: td.bold,
    italic: td.italic,
  });
  if (lines === null) {
    // Font likely not loaded yet (or SSR). Kick the font load and
    // re-patch this layer once it resolves so the autosave eventually
    // ships the right lines to the backend. Idempotent : if already
    // loaded, the .then runs immediately.
    const fontSizePx = (td.font_size_pct / 100) * 1920;
    if (fontSizePx >= 1 && typeof document !== "undefined") {
      const layerId = layer.id;
      ensureFontLoaded(td.font_id, fontSizePx, td.bold, td.italic).then(() => {
        // Use a microtask delay so we don't re-enter set() from
        // within this same set() call.
        queueMicrotask(() => {
          const store = useEditorStore.getState();
          const cur = store.layers.find((l) => l.id === layerId);
          if (!cur || cur.type !== "text") return;
          // patchLayerData({}) is a no-op data merge, but the
          // wrapping withPrecomputedLines now sees the font ready
          // and will compute proper lines this time.
          store.patchLayerData(layerId, {});
        });
      });
    }
    return layer;
  }
  return {
    ...layer,
    data: {
      ...layer.data,
      precomputed_lines: lines,
    },
  };
}

// ----- undo / redo -------------------------------------------------------

const MAX_HISTORY = 50;

/** Subset of the store that's eligible for undo/redo — the "document"
 *  (anything that the autosave persists). Pure ephemeral state like
 *  currentTime / isPlaying / selection / saving flags is excluded. */
type DocSnapshot = {
  clips: Clip[];
  extraTracks: ExtraTrack[];
  layers: Layer[];
  audioOverlay: AudioOverlayConfig;
};

function docSnapshot(s: {
  clips: Clip[];
  extraTracks: ExtraTrack[];
  layers: Layer[];
  audioOverlay: AudioOverlayConfig;
}): DocSnapshot {
  return {
    clips: s.clips,
    extraTracks: s.extraTracks,
    layers: s.layers,
    audioOverlay: s.audioOverlay,
  };
}

function docChanged(a: DocSnapshot, b: DocSnapshot): boolean {
  return (
    a.clips !== b.clips ||
    a.extraTracks !== b.extraTracks ||
    a.layers !== b.layers ||
    a.audioOverlay !== b.audioOverlay
  );
}

type EditorState = {
  template: Template | null;
  clips: Clip[];
  // Phase 26b — extra video tracks (max 4 entries, so 5 total with main).
  // Each track holds clips with absolute `start_time`. Track index in this
  // array maps to visual priority: index 0 = first extra track (just above
  // main), last index = on top.
  extraTracks: ExtraTrack[];
  layers: Layer[];
  audioOverlay: AudioOverlayConfig;

  selectedClipId: string | null;
  // Phase 26b — when a clip on an extra track is selected, we also store
  // the track id so the inspector knows which track's clip to patch.
  selectedExtraTrackId: string | null;
  selectedLayerId: string | null;
  audioSelected: boolean;

  currentTime: number;
  isPlaying: boolean;
  fonts: FontMeta[];
  saving: boolean;
  saveError: string | null;

  // ----- undo / redo (Phase 31) -----
  past: DocSnapshot[];
  future: DocSnapshot[];
  /** True while undo/redo is in flight, so the auto-history subscriber
   *  doesn't re-record the restored state into past. */
  _isReplaying: boolean;
  undo: () => void;
  redo: () => void;

  loadTemplate: (template: Template) => void;
  loadFonts: (fonts: FontMeta[]) => void;

  patchTemplate: (
    patch: Partial<
      Pick<
        Template,
        "name" | "language" | "description" | "tags" | "cover_ext" | "cover_time_sec"
      >
    >,
  ) => void;
  setLanguage: (lang: TemplateLanguage) => void;

  // ----- clips -----
  addFixedClip: (
    fileId: string,
    durationSec: number | null,
    width: number | null,
    height: number | null,
  ) => FixedClip;
  addImageClip: (
    fileId: string,
    width: number | null,
    height: number | null,
    durationSec?: number,
  ) => ImageClip;
  addPlaceholderClip: (durationSec?: number) => PlaceholderClip;
  patchClip: (id: string, patch: Partial<Clip>) => void;
  deleteClip: (id: string) => void;
  reorderClips: (fromIdx: number, toIdx: number) => void;
  /** Phase 27 — split a main-track clip in two at the timeline-absolute
   *  time `atTime`. Returns true if the cut was applied. */
  splitMainClip: (clipId: string, atTime: number) => boolean;

  // ----- extra tracks (Phase 26b) -----
  addExtraTrack: () => ExtraTrack | null;   // returns null if MAX reached
  deleteExtraTrack: (trackId: string) => void;
  renameExtraTrack: (trackId: string, name: string) => void;
  /** Add a fixed video clip to an extra track at startTime. */
  addExtraFixedClip: (
    trackId: string,
    fileId: string,
    sourceDuration: number | null,
    width: number | null,
    height: number | null,
    startTime: number,
    clipDuration?: number,
  ) => ExtraClip | null;
  /** Add a still image clip to an extra track. */
  addExtraImageClip: (
    trackId: string,
    fileId: string,
    width: number | null,
    height: number | null,
    startTime: number,
    durationSec?: number,
  ) => ExtraClip | null;
  /** Add a placeholder clip on an extra track (uses sample video at render). */
  addExtraPlaceholderClip: (
    trackId: string,
    startTime: number,
    durationSec?: number,
  ) => ExtraClip | null;
  patchExtraClip: (
    trackId: string,
    clipId: string,
    patch: Partial<ExtraClip>,
  ) => void;
  deleteExtraClip: (trackId: string, clipId: string) => void;
  /** Phase 27 — split an extra-track clip at timeline-absolute time. */
  splitExtraClip: (
    trackId: string,
    clipId: string,
    atTime: number,
  ) => boolean;

  // ----- layers -----
  addLayer: (type: LayerType) => Layer;
  patchLayer: (id: string, patch: Partial<Layer>) => void;
  patchLayerData: (id: string, patch: Record<string, unknown>) => void;
  deleteLayer: (id: string) => void;
  reorderLayers: (fromIdx: number, toIdx: number) => void;

  // ----- selection / playback -----
  setSelectedClipId: (id: string | null) => void;
  setSelectedExtraClip: (trackId: string | null, clipId: string | null) => void;
  setSelectedLayerId: (id: string | null) => void;
  setAudioSelected: (b: boolean) => void;
  setCurrentTime: (t: number) => void;
  setIsPlaying: (b: boolean) => void;

  // ----- audio overlay -----
  patchAudioOverlay: (patch: Partial<AudioOverlayConfig>) => void;

  saveNow: () => Promise<void>;
};

/** Compute a clip's "natural" duration (excl. freeze, excl. tail). */
function naturalDur(clip: { type: string; trim_in?: number; trim_out?: number | null; source_duration_sec?: number | null; duration_sec?: number }): number {
  if (clip.type === "fixed") {
    if (clip.trim_out != null)
      return Math.max(0, clip.trim_out - (clip.trim_in ?? 0));
    return Math.max(0, (clip.source_duration_sec ?? 0) - (clip.trim_in ?? 0));
  }
  return Math.max(0, clip.duration_sec ?? 0);
}

/** Migrate the legacy `freeze_tail_sec` field to the new freeze model.
 *  Old templates set freeze_tail_sec > 0 to hold the last frame after
 *  the natural end. New model represents the same effect as a freeze
 *  positioned AT the natural end. We only migrate when the new fields
 *  are still untouched (avoid clobbering a user-set freeze_at). */
function migrateFreeze<T extends { freeze_tail_sec?: number; freeze_at_sec?: number | null; freeze_duration_sec?: number } & Parameters<typeof naturalDur>[0]>(clip: T): T {
  const tail = clip.freeze_tail_sec ?? 0;
  if (tail > 0 && (clip.freeze_at_sec == null) && (clip.freeze_duration_sec ?? 0) === 0) {
    return {
      ...clip,
      freeze_at_sec: naturalDur(clip),
      freeze_duration_sec: tail,
      freeze_tail_sec: 0,
    };
  }
  return clip;
}

function parseClips(raw: unknown[]): Clip[] {
  const out: Clip[] = [];
  for (const item of raw) {
    const r = ClipSchema.safeParse(item);
    if (r.success) out.push(migrateFreeze(r.data) as Clip);
  }
  return out;
}

function parseLayers(raw: unknown[]): Layer[] {
  const out: Layer[] = [];
  for (const item of raw) {
    const r = LayerSchema.safeParse(item);
    if (r.success) out.push(r.data);
  }
  return out.sort((a, b) => a.z_index - b.z_index);
}

function parseAudioOverlay(raw: unknown): AudioOverlayConfig {
  const r = AudioOverlayConfigSchema.safeParse(raw ?? {});
  return r.success
    ? r.data
    : { file_id: null, volume: 1.0, start_offset: 0, trim_in: 0 };
}

function parseExtraTracks(raw: unknown): ExtraTrack[] {
  if (!Array.isArray(raw)) return [];
  const out: ExtraTrack[] = [];
  for (const t of raw) {
    if (!t || typeof t !== "object") continue;
    const obj = t as Record<string, unknown>;
    const id = typeof obj.id === "string" ? obj.id : null;
    const name = typeof obj.name === "string" ? obj.name : "Track";
    if (!id) continue;
    const rawClips = Array.isArray(obj.clips) ? obj.clips : [];
    const clips: ExtraClip[] = [];
    for (const c of rawClips) {
      const r = ExtraClipSchema.safeParse(c);
      if (r.success) clips.push(migrateFreeze(r.data) as ExtraClip);
    }
    out.push({ id, name, clips });
  }
  return out.slice(0, MAX_EXTRA_TRACKS);
}

export const useEditorStore = create<EditorState>((set, get) => ({
  past: [],
  future: [],
  _isReplaying: false,

  undo: () => {
    const s = get();
    const last = s.past[s.past.length - 1];
    if (!last) return;
    const present = docSnapshot(s);
    set({
      _isReplaying: true,
      past: s.past.slice(0, -1),
      future: [...s.future, present],
      ...last,
    });
    // Clear the flag on the next tick so any cascading store updates
    // (e.g. selection clearing) don't re-trigger the auto-history push.
    queueMicrotask(() => set({ _isReplaying: false }));
    schedule(get);
  },

  redo: () => {
    const s = get();
    const next = s.future[s.future.length - 1];
    if (!next) return;
    const present = docSnapshot(s);
    set({
      _isReplaying: true,
      past: [...s.past, present],
      future: s.future.slice(0, -1),
      ...next,
    });
    queueMicrotask(() => set({ _isReplaying: false }));
    schedule(get);
  },

  template: null,
  clips: [],
  extraTracks: [],
  layers: [],
  audioOverlay: { file_id: null, volume: 1.0, start_offset: 0, trim_in: 0 },

  selectedClipId: null,
  selectedExtraTrackId: null,
  selectedLayerId: null,
  audioSelected: false,

  currentTime: 0,
  isPlaying: false,
  fonts: [],
  saving: false,
  saveError: null,

  loadTemplate: (template) => {
    // Loading a template is NOT an undoable action — we mark this
    // mutation as a replay so the auto-history subscriber skips it,
    // then we manually reset past/future and the lastDocSnap baseline.
    //
    // Phase 34 — On force le recompute des precomputed_lines pour
    // chaque text layer au chargement. Les templates créés avant
    // Phase 34 n'ont pas ces lines stockées ; recomputer ici garantit
    // que le premier render après le load utilisera les lines à jour
    // (sinon le backend fallback sur PIL wrap → mismatch potentiel).
    // Les templates récents ont déjà des lines correctes, mais le
    // recompute reste sûr (idempotent).
    const layers = parseLayers(template.layers).map((l) =>
      withPrecomputedLines(l),
    );
    set({
      _isReplaying: true,
      template,
      clips: parseClips(template.clips),
      extraTracks: parseExtraTracks(template.extra_tracks),
      layers,
      audioOverlay: parseAudioOverlay(template.audio_overlay),
      selectedClipId: null,
      selectedExtraTrackId: null,
      selectedLayerId: null,
      audioSelected: false,
      currentTime: 0,
      isPlaying: false,
      past: [],
      future: [],
    });
    queueMicrotask(() => set({ _isReplaying: false }));
  },

  loadFonts: (fonts) => set({ fonts }),

  patchTemplate: (patch) => {
    set((s) => (s.template ? { template: { ...s.template, ...patch } } : s));
    schedule(get);
  },

  setLanguage: (lang) => {
    set((s) => (s.template ? { template: { ...s.template, language: lang } } : s));
    schedule(get);
  },

  // ----- clips -----

  addFixedClip: (fileId, durationSec, width, height) => {
    const clip = makeFixedClip(fileId, durationSec, width, height);
    set((s) => ({ clips: [...s.clips, clip], selectedClipId: clip.id }));
    schedule(get);
    return clip;
  },

  addImageClip: (fileId, width, height, durationSec = 3.0) => {
    const clip = makeImageClip(fileId, width, height, durationSec);
    set((s) => ({ clips: [...s.clips, clip], selectedClipId: clip.id }));
    schedule(get);
    return clip;
  },

  addPlaceholderClip: (durationSec = 3.0) => {
    const clip = makePlaceholderClip(durationSec);
    set((s) => ({ clips: [...s.clips, clip], selectedClipId: clip.id }));
    schedule(get);
    return clip;
  },

  patchClip: (id, patch) => {
    set((s) => ({
      clips: s.clips.map((c) =>
        c.id === id ? ({ ...c, ...patch } as Clip) : c,
      ),
    }));
    schedule(get);
  },

  deleteClip: (id) => {
    set((s) => ({
      clips: s.clips.filter((c) => c.id !== id),
      selectedClipId: s.selectedClipId === id ? null : s.selectedClipId,
    }));
    schedule(get);
  },

  reorderClips: (fromIdx, toIdx) => {
    set((s) => {
      if (fromIdx === toIdx) return s;
      const next = [...s.clips];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return { clips: next };
    });
    schedule(get);
  },

  splitMainClip: (clipId, atTime) => {
    let didSplit = false;
    set((s) => {
      const idx = s.clips.findIndex((c) => c.id === clipId);
      if (idx < 0) return s;
      const clip = s.clips[idx];
      // Compute the clip's absolute start on the timeline.
      let absStart = 0;
      for (let i = 0; i < idx; i++) {
        const c = s.clips[i];
        if (c.type === "fixed") {
          absStart +=
            c.trim_out != null
              ? Math.max(0, c.trim_out - c.trim_in)
              : Math.max(0, (c.source_duration_sec ?? 0) - c.trim_in);
        } else {
          absStart += c.duration_sec;
        }
      }
      const dur =
        clip.type === "fixed"
          ? clip.trim_out != null
            ? Math.max(0, clip.trim_out - clip.trim_in)
            : Math.max(0, (clip.source_duration_sec ?? 0) - clip.trim_in)
          : clip.duration_sec;
      const localCut = atTime - absStart;
      // Refuse cuts outside (or too close to the edges of) the clip.
      if (localCut <= 0.05 || localCut >= dur - 0.05) return s;

      let firstHalf: Clip;
      let secondHalf: Clip;

      // Freeze belongs inside ONE clip — after a split we drop it on
      // both halves (simpler than trying to route it) so the user can
      // re-add it on whichever half they want.
      const freezeReset = {
        freeze_at_sec: null,
        freeze_duration_sec: 0,
        freeze_filter: "none" as const,
        freeze_tail_sec: 0,
      };
      if (clip.type === "fixed") {
        const cutSourceTime = clip.trim_in + localCut;
        firstHalf = {
          ...clip,
          trim_out: cutSourceTime,
          ...freezeReset,
        } as Clip;
        secondHalf = {
          ...clip,
          id: crypto.randomUUID(),
          trim_in: cutSourceTime,
          trim_out: clip.trim_out,
          ...freezeReset,
        } as Clip;
      } else if (clip.type === "image") {
        firstHalf = {
          ...clip,
          duration_sec: localCut,
          ...freezeReset,
        } as Clip;
        secondHalf = {
          ...clip,
          id: crypto.randomUUID(),
          duration_sec: dur - localCut,
          ...freezeReset,
        } as Clip;
      } else {
        // placeholder
        firstHalf = {
          ...clip,
          duration_sec: localCut,
          ...freezeReset,
        } as Clip;
        secondHalf = {
          ...clip,
          id: crypto.randomUUID(),
          duration_sec: dur - localCut,
          ...freezeReset,
        } as Clip;
      }
      const next = [...s.clips];
      next.splice(idx, 1, firstHalf, secondHalf);
      didSplit = true;
      return { clips: next, selectedClipId: firstHalf.id };
    });
    if (didSplit) schedule(get);
    return didSplit;
  },

  // ----- extra tracks (Phase 26b) -----

  addExtraTrack: () => {
    const s = get();
    if (s.extraTracks.length >= MAX_EXTRA_TRACKS) return null;
    const track: ExtraTrack = {
      id: crypto.randomUUID(),
      name: `Track ${s.extraTracks.length + 2}`,
      clips: [],
    };
    set({ extraTracks: [...s.extraTracks, track] });
    schedule(get);
    return track;
  },

  deleteExtraTrack: (trackId) => {
    set((s) => ({
      extraTracks: s.extraTracks.filter((t) => t.id !== trackId),
      selectedExtraTrackId:
        s.selectedExtraTrackId === trackId ? null : s.selectedExtraTrackId,
      selectedClipId:
        s.selectedExtraTrackId === trackId ? null : s.selectedClipId,
    }));
    schedule(get);
  },

  renameExtraTrack: (trackId, name) => {
    set((s) => ({
      extraTracks: s.extraTracks.map((t) =>
        t.id === trackId ? { ...t, name } : t,
      ),
    }));
    schedule(get);
  },

  addExtraFixedClip: (
    trackId,
    fileId,
    sourceDuration,
    width,
    height,
    startTime,
    clipDuration,
  ) => {
    const dur = clipDuration ?? sourceDuration ?? EXTRA_CLIP_DEFAULT_DURATION;
    const clip: ExtraClip = {
      id: crypto.randomUUID(),
      type: "fixed",
      file_id: fileId,
      start_time: Math.max(0, startTime),
      trim_in: 0,
      trim_out: null,
      audio_enabled: true,
      audio_volume: 1.0,
      video_enabled: true,
      source_duration_sec: sourceDuration,
      source_width: width,
      source_height: height,
      filter: "none",
      filter_start_sec: null,
      filter_end_sec: null,
      freeze_at_sec: null,
      freeze_duration_sec: 0,
      freeze_filter: "none",
      freeze_tail_sec: 0,
    };
    // Persist a clip-level "duration" via trim_out so the pipeline knows
    // when the clip ends on the timeline. We use trim_out = trim_in + dur.
    clip.trim_out = clip.trim_in + dur;
    let added = false;
    set((s) => {
      const next = s.extraTracks.map((t) => {
        if (t.id !== trackId) return t;
        added = true;
        return { ...t, clips: [...t.clips, clip] };
      });
      return added
        ? {
            extraTracks: next,
            selectedClipId: clip.id,
            selectedExtraTrackId: trackId,
            selectedLayerId: null,
            audioSelected: false,
          }
        : s;
    });
    if (added) schedule(get);
    return added ? clip : null;
  },

  addExtraImageClip: (
    trackId,
    fileId,
    width,
    height,
    startTime,
    durationSec = EXTRA_CLIP_DEFAULT_DURATION,
  ) => {
    const clip: ExtraClip = {
      id: crypto.randomUUID(),
      type: "image",
      file_id: fileId,
      start_time: Math.max(0, startTime),
      duration_sec: durationSec,
      trim_in: 0,
      trim_out: null,
      audio_enabled: false,
      audio_volume: 0,
      video_enabled: true,
      source_width: width,
      source_height: height,
      filter: "none",
      filter_start_sec: null,
      filter_end_sec: null,
      freeze_at_sec: null,
      freeze_duration_sec: 0,
      freeze_filter: "none",
      freeze_tail_sec: 0,
    };
    let added = false;
    set((s) => {
      const next = s.extraTracks.map((t) => {
        if (t.id !== trackId) return t;
        added = true;
        return { ...t, clips: [...t.clips, clip] };
      });
      return added
        ? {
            extraTracks: next,
            selectedClipId: clip.id,
            selectedExtraTrackId: trackId,
            selectedLayerId: null,
            audioSelected: false,
          }
        : s;
    });
    if (added) schedule(get);
    return added ? clip : null;
  },

  addExtraPlaceholderClip: (
    trackId,
    startTime,
    durationSec = EXTRA_CLIP_DEFAULT_DURATION,
  ) => {
    const clip: ExtraClip = {
      id: crypto.randomUUID(),
      type: "placeholder",
      start_time: Math.max(0, startTime),
      duration_sec: durationSec,
      trim_in: 0,
      trim_out: null,
      audio_enabled: true,
      audio_volume: 1.0,
      video_enabled: true,
      filter: "none",
      filter_start_sec: null,
      filter_end_sec: null,
      freeze_at_sec: null,
      freeze_duration_sec: 0,
      freeze_filter: "none",
      freeze_tail_sec: 0,
    };
    let added = false;
    set((s) => {
      const next = s.extraTracks.map((t) => {
        if (t.id !== trackId) return t;
        added = true;
        return { ...t, clips: [...t.clips, clip] };
      });
      return added
        ? {
            extraTracks: next,
            selectedClipId: clip.id,
            selectedExtraTrackId: trackId,
            selectedLayerId: null,
            audioSelected: false,
          }
        : s;
    });
    if (added) schedule(get);
    return added ? clip : null;
  },

  patchExtraClip: (trackId, clipId, patch) => {
    set((s) => ({
      extraTracks: s.extraTracks.map((t) => {
        if (t.id !== trackId) return t;
        return {
          ...t,
          clips: t.clips.map((c) =>
            c.id === clipId ? ({ ...c, ...patch } as ExtraClip) : c,
          ),
        };
      }),
    }));
    schedule(get);
  },

  deleteExtraClip: (trackId, clipId) => {
    set((s) => ({
      extraTracks: s.extraTracks.map((t) =>
        t.id === trackId
          ? { ...t, clips: t.clips.filter((c) => c.id !== clipId) }
          : t,
      ),
      selectedClipId:
        s.selectedClipId === clipId ? null : s.selectedClipId,
      selectedExtraTrackId:
        s.selectedClipId === clipId ? null : s.selectedExtraTrackId,
    }));
    schedule(get);
  },

  splitExtraClip: (trackId, clipId, atTime) => {
    let didSplit = false;
    set((s) => {
      const trackIdx = s.extraTracks.findIndex((t) => t.id === trackId);
      if (trackIdx < 0) return s;
      const track = s.extraTracks[trackIdx];
      const clipIdx = track.clips.findIndex((c) => c.id === clipId);
      if (clipIdx < 0) return s;
      const clip = track.clips[clipIdx];
      const localCut = atTime - clip.start_time;
      const dur =
        clip.type === "fixed"
          ? clip.trim_out != null
            ? Math.max(0, clip.trim_out - clip.trim_in)
            : Math.max(0, (clip.source_duration_sec ?? 0) - clip.trim_in)
          : clip.duration_sec;
      if (localCut <= 0.05 || localCut >= dur - 0.05) return s;

      let firstHalf: ExtraClip;
      let secondHalf: ExtraClip;
      // Same as splitMainClip — drop freeze on both halves to keep the
      // semantics predictable.
      const freezeReset = {
        freeze_at_sec: null,
        freeze_duration_sec: 0,
        freeze_filter: "none" as const,
        freeze_tail_sec: 0,
      };
      if (clip.type === "fixed") {
        const cutSourceTime = clip.trim_in + localCut;
        firstHalf = {
          ...clip,
          trim_out: cutSourceTime,
          ...freezeReset,
        } as ExtraClip;
        secondHalf = {
          ...clip,
          id: crypto.randomUUID(),
          start_time: clip.start_time + localCut,
          trim_in: cutSourceTime,
          trim_out: clip.trim_out,
          ...freezeReset,
        } as ExtraClip;
      } else {
        firstHalf = {
          ...clip,
          duration_sec: localCut,
          ...freezeReset,
        } as ExtraClip;
        secondHalf = {
          ...clip,
          id: crypto.randomUUID(),
          start_time: clip.start_time + localCut,
          duration_sec: dur - localCut,
          ...freezeReset,
        } as ExtraClip;
      }
      const newClips = [...track.clips];
      newClips.splice(clipIdx, 1, firstHalf, secondHalf);
      const newExtraTracks = [...s.extraTracks];
      newExtraTracks[trackIdx] = { ...track, clips: newClips };
      didSplit = true;
      return {
        extraTracks: newExtraTracks,
        selectedClipId: firstHalf.id,
        selectedExtraTrackId: trackId,
      };
    });
    if (didSplit) schedule(get);
    return didSplit;
  },

  // ----- layers -----

  addLayer: (type) => {
    const s = get();
    const layer: Layer = {
      id: crypto.randomUUID(),
      type,
      start_time: 0,
      end_time: 3,
      x_pct: 25,
      y_pct: 35,
      width_pct: 50,
      height_pct: 30,
      z_index: s.layers.length,
      data: defaultLayerData(type),
    };
    set({ layers: [...s.layers, layer], selectedLayerId: layer.id });
    schedule(get);
    return layer;
  },

  patchLayer: (id, patch) => {
    set((s) => ({
      layers: s.layers.map((l) =>
        l.id === id
          ? withPrecomputedLines({ ...l, ...patch })
          : l,
      ),
    }));
    schedule(get);
  },

  patchLayerData: (id, patch) => {
    set((s) => ({
      layers: s.layers.map((l) =>
        l.id === id
          ? withPrecomputedLines({ ...l, data: { ...l.data, ...patch } })
          : l,
      ),
    }));
    schedule(get);
  },

  deleteLayer: (id) => {
    set((s) => {
      const next = s.layers
        .filter((l) => l.id !== id)
        .map((l, i) => ({ ...l, z_index: i }));
      return {
        layers: next,
        selectedLayerId: s.selectedLayerId === id ? null : s.selectedLayerId,
      };
    });
    schedule(get);
  },

  reorderLayers: (fromIdx, toIdx) => {
    set((s) => {
      if (fromIdx === toIdx) return s;
      const next = [...s.layers];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return { layers: next.map((l, i) => ({ ...l, z_index: i })) };
    });
    schedule(get);
  },

  // ----- audio overlay -----

  patchAudioOverlay: (patch) => {
    set((s) => ({ audioOverlay: { ...s.audioOverlay, ...patch } }));
    schedule(get);
  },

  // ----- selection / playback -----

  setSelectedClipId: (id) =>
    set({
      selectedClipId: id,
      selectedExtraTrackId: id ? null : get().selectedExtraTrackId,
      selectedLayerId: id ? null : get().selectedLayerId,
      audioSelected: id ? false : get().audioSelected,
    }),

  setSelectedExtraClip: (trackId, clipId) =>
    set({
      selectedClipId: clipId,
      selectedExtraTrackId: trackId,
      selectedLayerId: clipId ? null : get().selectedLayerId,
      audioSelected: clipId ? false : get().audioSelected,
    }),

  setSelectedLayerId: (id) =>
    set({
      selectedLayerId: id,
      selectedClipId: id ? null : get().selectedClipId,
      selectedExtraTrackId: id ? null : get().selectedExtraTrackId,
      audioSelected: id ? false : get().audioSelected,
    }),

  setAudioSelected: (b) =>
    set({
      audioSelected: b,
      selectedClipId: b ? null : get().selectedClipId,
      selectedExtraTrackId: b ? null : get().selectedExtraTrackId,
      selectedLayerId: b ? null : get().selectedLayerId,
    }),

  setCurrentTime: (t) => set({ currentTime: t }),
  setIsPlaying: (b) => set({ isPlaying: b }),

  saveNow: async () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    await persist(get);
  },
}));

function schedule(get: () => EditorState) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void persist(get);
  }, SAVE_DEBOUNCE_MS);
}

async function persist(get: () => EditorState) {
  const s = get();
  if (!s.template) return;
  useEditorStore.setState({ saving: true, saveError: null });
  try {
    await Templates.update(s.template.id, {
      name: s.template.name,
      language: s.template.language,
      description: s.template.description ?? undefined,
      // Phase 36b — free-form sub-tags (multi). Trim + filter empties
      // client-side ; the backend re-sanitises (dedupe, max 20) so this
      // is purely cosmetic for snappier UX feedback.
      tags: Array.isArray(s.template.tags)
        ? s.template.tags.map((t) => t.trim()).filter(Boolean)
        : [],
      clips: s.clips,
      extra_tracks: s.extraTracks,
      layers: s.layers,
      audio_overlay: s.audioOverlay,
    });
    useEditorStore.setState({ saving: false });
  } catch (err) {
    useEditorStore.setState({
      saving: false,
      saveError: err instanceof Error ? err.message : "save failed",
    });
  }
}

// ----- auto-record undo history -----------------------------------------
//
// Subscribes once at module load. Whenever the "document" portion of the
// store changes (clips / extraTracks / layers / audioOverlay reference
// changes via setState), capture the PREVIOUS snapshot into the past
// stack and clear the future. Skipped during undo/redo replay so the
// restored state isn't immediately re-recorded.

let _lastDocSnap: DocSnapshot = docSnapshot(useEditorStore.getState());

useEditorStore.subscribe((state) => {
  if (state._isReplaying) {
    // Refresh our last snapshot so the next user action records the
    // post-replay state as the new baseline.
    _lastDocSnap = docSnapshot(state);
    return;
  }
  const next = docSnapshot(state);
  if (!docChanged(_lastDocSnap, next)) return;
  // Capture the OLD snapshot (= what undo should restore to), then
  // update our cached "last" to the new one. The new past array is
  // capped to MAX_HISTORY to bound memory.
  const captured = _lastDocSnap;
  _lastDocSnap = next;
  useEditorStore.setState({
    past: [...state.past, captured].slice(-MAX_HISTORY),
    future: [],
  });
});
