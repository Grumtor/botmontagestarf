import { create } from "zustand";
import {
  AudioOverlayConfigSchema,
  AudioSourceConfigSchema,
  LayerSchema,
  Pools,
  SourceSegmentSchema,
  Templates,
  type Asset,
  type AudioOverlayConfig,
  type AudioSourceConfig,
  type FontMeta,
  type Layer,
  type LayerType,
  type SourceSegment,
  type Template,
  type TemplateLanguage,
  type Transition,
} from "@/lib/api";
import { defaultLayerData, outputToSource } from "@/lib/editor-types";

const SAVE_DEBOUNCE_MS = 500;
const POOL_SAVE_DEBOUNCE_MS = 500;

let saveTimer: ReturnType<typeof setTimeout> | null = null;
const poolTimers = new Map<string, ReturnType<typeof setTimeout>>();

type EditorState = {
  template: Template | null;
  layers: Layer[];
  selectedLayerId: string | null;
  currentTime: number;
  isPlaying: boolean;
  previewSourceId: number | null;
  saving: boolean;
  saveError: string | null;

  fonts: FontMeta[];
  pools: Record<string, string[]>;
  sourceSegments: SourceSegment[];
  audioSource: AudioSourceConfig;
  audioOverlay: AudioOverlayConfig;
  audioSelection: "source" | "overlay" | null;

  loadTemplate: (template: Template) => void;
  splitAtCurrentTime: () => void;
  trimSegmentEdge: (
    segmentIndex: number,
    edge: "left" | "right",
    newSourceTime: number,
  ) => void;
  setSegmentTransition: (segmentIndex: number, transition: Transition) => void;
  patchAudioSource: (patch: Partial<AudioSourceConfig>) => void;
  patchAudioOverlay: (patch: Partial<AudioOverlayConfig>) => void;
  setAudioSelection: (sel: "source" | "overlay" | null) => void;
  loadFonts: (fonts: FontMeta[]) => void;
  loadPools: (pools: Record<string, string[]>) => void;

  patchTemplate: (
    patch: Partial<Pick<Template, "name" | "language" | "duration_sec" | "description">>,
  ) => void;
  setLanguage: (lang: TemplateLanguage) => void;

  addLayer: (type: LayerType) => Layer;
  addAssetLayer: (
    type: "image" | "gif" | "emoji",
    asset: Asset,
    naturalWidth: number,
    naturalHeight: number,
  ) => Layer;
  patchLayer: (id: string, patch: Partial<Layer>) => void;
  patchLayerData: (id: string, patch: Record<string, unknown>) => void;
  deleteLayer: (id: string) => void;
  reorderLayers: (fromIdx: number, toIdx: number) => void;

  setPool: (layerId: string, items: string[]) => void;

  setSelectedLayerId: (id: string | null) => void;
  setCurrentTime: (t: number) => void;
  setIsPlaying: (b: boolean) => void;
  setPreviewSourceId: (id: number | null) => void;

  saveNow: () => Promise<void>;
};

function parseLayers(raw: unknown[]): Layer[] {
  const out: Layer[] = [];
  for (const item of raw) {
    const r = LayerSchema.safeParse(item);
    if (r.success) out.push(r.data);
  }
  return out.sort((a, b) => a.z_index - b.z_index);
}

function parseSegments(raw: unknown[]): SourceSegment[] {
  const out: SourceSegment[] = [];
  for (const item of raw) {
    const r = SourceSegmentSchema.safeParse(item);
    if (r.success) out.push(r.data);
  }
  return out;
}

function defaultSegments(durationSec: number): SourceSegment[] {
  return [
    {
      in_time: 0,
      out_time: durationSec,
      transition_to_next: { type: "cut", duration: 0.3 },
    },
  ];
}

function parseAudioSource(raw: unknown): AudioSourceConfig {
  const r = AudioSourceConfigSchema.safeParse(raw ?? {});
  return r.success ? r.data : { volume: 1.0, enabled: true };
}

function parseAudioOverlay(raw: unknown): AudioOverlayConfig {
  const r = AudioOverlayConfigSchema.safeParse(raw ?? {});
  return r.success
    ? r.data
    : { asset_id: null, volume: 1.0, start_offset: 0, trim_in: 0 };
}

export const useEditorStore = create<EditorState>((set, get) => ({
  template: null,
  layers: [],
  selectedLayerId: null,
  currentTime: 0,
  isPlaying: false,
  previewSourceId: null,
  saving: false,
  saveError: null,
  fonts: [],
  pools: {},
  sourceSegments: [],
  audioSource: { volume: 1.0, enabled: true },
  audioOverlay: { asset_id: null, volume: 1.0, start_offset: 0, trim_in: 0 },
  audioSelection: null,

  loadTemplate: (template) => {
    const parsedSegments = parseSegments(template.source_segments ?? []);
    const segments =
      parsedSegments.length > 0
        ? parsedSegments
        : defaultSegments(template.duration_sec);
    set({
      template,
      layers: parseLayers(template.layers),
      sourceSegments: segments,
      audioSource: parseAudioSource(template.audio_source),
      audioOverlay: parseAudioOverlay(template.audio_overlay),
      audioSelection: null,
      selectedLayerId: null,
      currentTime: 0,
      isPlaying: false,
    });
    if (parsedSegments.length === 0) schedule(get);
  },

  patchAudioSource: (patch) => {
    set((s) => ({ audioSource: { ...s.audioSource, ...patch } }));
    schedule(get);
  },

  patchAudioOverlay: (patch) => {
    set((s) => ({ audioOverlay: { ...s.audioOverlay, ...patch } }));
    schedule(get);
  },

  setAudioSelection: (sel) =>
    set({ audioSelection: sel, selectedLayerId: sel ? null : get().selectedLayerId }),

  splitAtCurrentTime: () => {
    const s = get();
    const t = s.currentTime;
    const found = outputToSource(t, s.sourceSegments);
    if (!found) return;
    const { segmentIndex, sourceTime } = found;
    const seg = s.sourceSegments[segmentIndex];
    // Avoid degenerate splits at the very edges.
    if (sourceTime <= seg.in_time + 0.05) return;
    if (sourceTime >= seg.out_time - 0.05) return;

    const newA: SourceSegment = {
      in_time: seg.in_time,
      out_time: sourceTime,
      transition_to_next: { type: "cut", duration: 0.3 },
    };
    const newB: SourceSegment = {
      in_time: sourceTime,
      out_time: seg.out_time,
      transition_to_next: seg.transition_to_next,
    };
    const next = [...s.sourceSegments];
    next.splice(segmentIndex, 1, newA, newB);
    set({ sourceSegments: next });
    schedule(get);
  },

  trimSegmentEdge: (segmentIndex, edge, newSourceTime) => {
    set((s) => {
      const segs = [...s.sourceSegments];
      const seg = segs[segmentIndex];
      if (!seg) return s;
      const MIN = 0.1;
      if (edge === "left") {
        const clamped = Math.max(0, Math.min(newSourceTime, seg.out_time - MIN));
        segs[segmentIndex] = { ...seg, in_time: clamped };
      } else {
        const clamped = Math.max(seg.in_time + MIN, newSourceTime);
        segs[segmentIndex] = { ...seg, out_time: clamped };
      }
      return { sourceSegments: segs };
    });
    schedule(get);
  },

  setSegmentTransition: (segmentIndex, transition) => {
    set((s) => ({
      sourceSegments: s.sourceSegments.map((seg, i) =>
        i === segmentIndex ? { ...seg, transition_to_next: transition } : seg,
      ),
    }));
    schedule(get);
  },

  loadFonts: (fonts) => set({ fonts }),
  loadPools: (pools) => set({ pools }),

  patchTemplate: (patch) => {
    set((s) => (s.template ? { template: { ...s.template, ...patch } } : s));
    schedule(get);
  },

  setLanguage: (lang) => {
    set((s) => (s.template ? { template: { ...s.template, language: lang } } : s));
    schedule(get);
  },

  addLayer: (type) => {
    const s = get();
    if (!s.template) throw new Error("template not loaded");
    const layer: Layer = {
      id: crypto.randomUUID(),
      type,
      start_time: 0,
      end_time: s.template.duration_sec,
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

  addAssetLayer: (type, asset, naturalWidth, naturalHeight) => {
    const s = get();
    if (!s.template) throw new Error("template not loaded");

    // Canvas is 9:16. Convert asset's natural pixel ratio into canvas-% ratio:
    //   heightPct = widthPct * (canvasW/canvasH) * (assetH/assetW)
    const widthPct = 30;
    const canvasAspect = 9 / 16;
    const validNatural = naturalWidth > 0 && naturalHeight > 0;
    const heightPct = validNatural
      ? widthPct * canvasAspect * (naturalHeight / naturalWidth)
      : 30;

    const layer: Layer = {
      id: crypto.randomUUID(),
      type,
      start_time: 0,
      end_time: s.template.duration_sec,
      x_pct: (100 - widthPct) / 2,
      y_pct: (100 - heightPct) / 2,
      width_pct: widthPct,
      height_pct: heightPct,
      z_index: s.layers.length,
      data: {
        asset_id: asset.id,
        rotation_deg: 0,
        opacity: 1,
        ratio_locked: true,
      },
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

  setPool: (layerId, items) => {
    set((s) => ({ pools: { ...s.pools, [layerId]: items } }));
    const existing = poolTimers.get(layerId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(async () => {
      poolTimers.delete(layerId);
      const s = get();
      if (!s.template) return;
      try {
        await Pools.put(s.template.id, layerId, items);
      } catch (err) {
        console.error("pool autosave failed", err);
      }
    }, POOL_SAVE_DEBOUNCE_MS);
    poolTimers.set(layerId, timer);
  },

  setSelectedLayerId: (id) =>
    set({ selectedLayerId: id, audioSelection: id ? null : get().audioSelection }),
  setCurrentTime: (t) => set({ currentTime: t }),
  setIsPlaying: (b) => set({ isPlaying: b }),
  setPreviewSourceId: (id) => set({ previewSourceId: id }),

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
      duration_sec: s.template.duration_sec,
      layers: s.layers,
      source_segments: s.sourceSegments,
      audio_source: s.audioSource,
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
