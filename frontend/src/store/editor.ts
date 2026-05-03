import { create } from "zustand";
import {
  AudioOverlayConfigSchema,
  ClipSchema,
  LayerSchema,
  Templates,
  type AudioOverlayConfig,
  type Clip,
  type FixedClip,
  type FontMeta,
  type Layer,
  type LayerType,
  type PlaceholderClip,
  type Template,
  type TemplateLanguage,
} from "@/lib/api";
import {
  defaultLayerData,
  makeFixedClip,
  makePlaceholderClip,
} from "@/lib/editor-types";

const SAVE_DEBOUNCE_MS = 500;

let saveTimer: ReturnType<typeof setTimeout> | null = null;

type EditorState = {
  template: Template | null;
  clips: Clip[];
  layers: Layer[];
  audioOverlay: AudioOverlayConfig;

  selectedClipId: string | null;
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
    patch: Partial<Pick<Template, "name" | "language" | "description">>,
  ) => void;
  setLanguage: (lang: TemplateLanguage) => void;

  // ----- clips -----
  addFixedClip: (
    fileId: string,
    durationSec: number | null,
    width: number | null,
    height: number | null,
  ) => FixedClip;
  addPlaceholderClip: (durationSec?: number) => PlaceholderClip;
  patchClip: (id: string, patch: Partial<Clip>) => void;
  deleteClip: (id: string) => void;
  reorderClips: (fromIdx: number, toIdx: number) => void;

  // ----- layers -----
  addLayer: (type: LayerType) => Layer;
  patchLayer: (id: string, patch: Partial<Layer>) => void;
  patchLayerData: (id: string, patch: Record<string, unknown>) => void;
  deleteLayer: (id: string) => void;
  reorderLayers: (fromIdx: number, toIdx: number) => void;

  // ----- selection / playback -----
  setSelectedClipId: (id: string | null) => void;
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

export const useEditorStore = create<EditorState>((set, get) => ({
  template: null,
  clips: [],
  layers: [],
  audioOverlay: { file_id: null, volume: 1.0, start_offset: 0, trim_in: 0 },

  selectedClipId: null,
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
      layers: parseLayers(template.layers),
      audioOverlay: parseAudioOverlay(template.audio_overlay),
      selectedClipId: null,
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
      selectedLayerId: id ? null : get().selectedLayerId,
      audioSelected: id ? false : get().audioSelected,
    }),

  setSelectedLayerId: (id) =>
    set({
      selectedLayerId: id,
      selectedClipId: id ? null : get().selectedClipId,
      audioSelected: id ? false : get().audioSelected,
    }),

  setAudioSelected: (b) =>
    set({
      audioSelected: b,
      selectedClipId: b ? null : get().selectedClipId,
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
