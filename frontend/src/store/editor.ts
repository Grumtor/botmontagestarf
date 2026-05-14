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

const MAX_EXTRA_TRACKS = 4; // 5 total - main track 1
const EXTRA_CLIP_DEFAULT_DURATION = 3.0;

export type ExtraTrack = {
  id: string;
  name: string;
  clips: ExtraClip[];
};

const SAVE_DEBOUNCE_MS = 500;

let saveTimer: ReturnType<typeof setTimeout> | null = null;

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

  loadTemplate: (template: Template) => void;
  loadFonts: (fonts: FontMeta[]) => void;

  patchTemplate: (
    patch: Partial<
      Pick<
        Template,
        "name" | "language" | "description" | "cover_ext" | "cover_time_sec"
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

function parseClips(raw: unknown[]): Clip[] {
  const out: Clip[] = [];
  for (const item of raw) {
    const r = ClipSchema.safeParse(item);
    if (r.success) out.push(r.data);
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
      if (r.success) clips.push(r.data);
    }
    out.push({ id, name, clips });
  }
  return out.slice(0, MAX_EXTRA_TRACKS);
}

export const useEditorStore = create<EditorState>((set, get) => ({
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

  loadTemplate: (template) =>
    set({
      template,
      clips: parseClips(template.clips),
      extraTracks: parseExtraTracks(template.extra_tracks),
      layers: parseLayers(template.layers),
      audioOverlay: parseAudioOverlay(template.audio_overlay),
      selectedClipId: null,
      selectedExtraTrackId: null,
      selectedLayerId: null,
      audioSelected: false,
      currentTime: 0,
      isPlaying: false,
    }),

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

      if (clip.type === "fixed") {
        const cutSourceTime = clip.trim_in + localCut;
        firstHalf = { ...clip, trim_out: cutSourceTime } as Clip;
        secondHalf = {
          ...clip,
          id: crypto.randomUUID(),
          trim_in: cutSourceTime,
          trim_out: clip.trim_out,
        } as Clip;
      } else if (clip.type === "image") {
        firstHalf = { ...clip, duration_sec: localCut } as Clip;
        secondHalf = {
          ...clip,
          id: crypto.randomUUID(),
          duration_sec: dur - localCut,
        } as Clip;
      } else {
        // placeholder
        firstHalf = { ...clip, duration_sec: localCut } as Clip;
        secondHalf = {
          ...clip,
          id: crypto.randomUUID(),
          duration_sec: dur - localCut,
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
      if (clip.type === "fixed") {
        const cutSourceTime = clip.trim_in + localCut;
        firstHalf = { ...clip, trim_out: cutSourceTime } as ExtraClip;
        secondHalf = {
          ...clip,
          id: crypto.randomUUID(),
          start_time: clip.start_time + localCut,
          trim_in: cutSourceTime,
          trim_out: clip.trim_out,
        } as ExtraClip;
      } else {
        firstHalf = { ...clip, duration_sec: localCut } as ExtraClip;
        secondHalf = {
          ...clip,
          id: crypto.randomUUID(),
          start_time: clip.start_time + localCut,
          duration_sec: dur - localCut,
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
    // Snap layers are full-canvas-width bars with auto-computed height.
    // Defaults reflect that (x=0, w=100, y at 50% canvas, h auto-ish).
    const isSnap = type === "snap";
    const layer: Layer = {
      id: crypto.randomUUID(),
      type,
      start_time: 0,
      end_time: 3,
      x_pct: isSnap ? 0 : 25,
      y_pct: isSnap ? 50 : 35,
      width_pct: isSnap ? 100 : 50,
      height_pct: isSnap ? 8 : 30,
      z_index: s.layers.length,
      data: defaultLayerData(type),
    };
    set({ layers: [...s.layers, layer], selectedLayerId: layer.id });
    schedule(get);
    return layer;
  },

  patchLayer: (id, patch) => {
    set((s) => ({
      layers: s.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    }));
    schedule(get);
  },

  patchLayerData: (id, patch) => {
    set((s) => ({
      layers: s.layers.map((l) =>
        l.id === id ? { ...l, data: { ...l.data, ...patch } } : l,
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
