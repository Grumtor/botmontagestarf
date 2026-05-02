import { z } from "zod";

// ---- schemas ----------------------------------------------------------

export const TemplateLanguageSchema = z.enum(["FR", "US"]);
export type TemplateLanguage = z.infer<typeof TemplateLanguageSchema>;

export const LayerTypeSchema = z.enum([
  "text",
  "image",
  "gif",
  "emoji",
  "audio",
  "effect",
  "animation",
]);
export type LayerType = z.infer<typeof LayerTypeSchema>;

export const LayerSchema = z.object({
  id: z.string(),
  type: LayerTypeSchema,
  start_time: z.number(),
  end_time: z.number(),
  x_pct: z.number(),
  y_pct: z.number(),
  width_pct: z.number(),
  height_pct: z.number(),
  z_index: z.number(),
  data: z.record(z.unknown()).default({}),
});
export type Layer = z.infer<typeof LayerSchema>;

// Tolerant: backend might temporarily return non-conforming items;
// downstream code re-parses each item through LayerSchema.safeParse.
const RawLayersSchema = z.array(z.unknown());

export const TransitionTypeSchema = z.enum([
  "cut",
  "fade",
  "slide-left",
  "slide-right",
  "zoomblur",
  "glitch",
]);
export type TransitionType = z.infer<typeof TransitionTypeSchema>;

export const TransitionSchema = z.object({
  type: TransitionTypeSchema,
  duration: z.number(),
});
export type Transition = z.infer<typeof TransitionSchema>;

export const SourceSegmentSchema = z.object({
  in_time: z.number(),
  out_time: z.number(),
  transition_to_next: TransitionSchema,
});
export type SourceSegment = z.infer<typeof SourceSegmentSchema>;

const RawSegmentsSchema = z.array(z.unknown());

export const AudioSourceConfigSchema = z.object({
  volume: z.number().default(1.0),
  enabled: z.boolean().default(true),
});
export type AudioSourceConfig = z.infer<typeof AudioSourceConfigSchema>;

export const AudioOverlayConfigSchema = z.object({
  asset_id: z.number().nullable().default(null),
  volume: z.number().default(1.0),
  start_offset: z.number().default(0),
  trim_in: z.number().default(0),
});
export type AudioOverlayConfig = z.infer<typeof AudioOverlayConfigSchema>;

export const TemplateSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string().nullable(),
  duration_sec: z.number(),
  language: TemplateLanguageSchema,
  layers: RawLayersSchema,
  source_segments: RawSegmentsSchema.default([]),
  audio_source: AudioSourceConfigSchema.default({ volume: 1.0, enabled: true }),
  audio_overlay: AudioOverlayConfigSchema.default({
    asset_id: null,
    volume: 1.0,
    start_offset: 0,
    trim_in: 0,
  }),
  thumbnail_path: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Template = z.infer<typeof TemplateSchema>;

export const TemplateCreateSchema = z.object({
  name: z.string().min(1).max(200),
  language: TemplateLanguageSchema,
  duration_sec: z.number().min(1).max(90),
  description: z.string().optional(),
});
export type TemplateCreateInput = z.infer<typeof TemplateCreateSchema>;

export const TemplateUpdateSchema = TemplateCreateSchema.partial().extend({
  layers: z.array(LayerSchema).optional(),
  source_segments: z.array(SourceSegmentSchema).optional(),
  audio_source: AudioSourceConfigSchema.optional(),
  audio_overlay: AudioOverlayConfigSchema.optional(),
});
export type TemplateUpdateInput = z.infer<typeof TemplateUpdateSchema>;

// ---- client -----------------------------------------------------------

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  schema: z.ZodType<T>,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail);
  }
  return schema.parse(await res.json());
}

async function requestVoid(path: string, init?: RequestInit): Promise<void> {
  const res = await fetch(path, {
    ...init,
    credentials: "include",
    headers: { ...(init?.headers ?? {}) },
  });
  if (!res.ok && res.status !== 204) {
    throw new ApiError(res.status, res.statusText);
  }
}

// ---- sources ----------------------------------------------------------

export const SourceSchema = z.object({
  id: z.number(),
  original_filename: z.string(),
  duration_sec: z.number().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  thumbnail_path: z.string().nullable(),
  uploaded_at: z.string(),
});
export type Source = z.infer<typeof SourceSchema>;

export const Sources = {
  list: () => request(z.array(SourceSchema), "/api/sources"),
  delete: (id: number) => requestVoid(`/api/sources/${id}`, { method: "DELETE" }),
};

// ---- fonts ------------------------------------------------------------

export const FontIdSchema = z.union([z.string(), z.number()]);
export type FontId = z.infer<typeof FontIdSchema>;

export const FontMetaSchema = z.object({
  id: FontIdSchema,
  name: z.string(),
  builtin: z.boolean(),
});
export type FontMeta = z.infer<typeof FontMetaSchema>;

export const Fonts = {
  list: () => request(z.array(FontMetaSchema), "/api/fonts"),
};

// ---- text layer data --------------------------------------------------

export const TextStyleSchema = z.enum(["plain", "highlight", "stroke"]);
export type TextStyle = z.infer<typeof TextStyleSchema>;

export const TextAlignSchema = z.enum(["left", "center", "right"]);
export type TextAlign = z.infer<typeof TextAlignSchema>;

export const TextLayerDataSchema = z.object({
  text: z.string().default(""),
  font_id: FontIdSchema.default("inter"),
  font_size_pct: z.number().default(5),
  color: z.string().default("#FFFFFF"),
  align: TextAlignSchema.default("center"),
  style: TextStyleSchema.default("plain"),
  highlight_color: z.string().default("#FFEB3B"),
  highlight_padding: z.number().default(6),
  stroke_color: z.string().default("#000000"),
  stroke_width: z.number().default(4),
  max_width_pct: z.number().default(80),
  line_height: z.number().default(1.2),
  letter_spacing: z.number().default(0),
  bold: z.boolean().default(false),
  italic: z.boolean().default(false),
});
export type TextLayerData = z.infer<typeof TextLayerDataSchema>;

export function parseTextData(data: unknown): TextLayerData {
  const r = TextLayerDataSchema.safeParse(data ?? {});
  return r.success ? r.data : TextLayerDataSchema.parse({});
}

// ---- visual asset layer data (image / gif / emoji) --------------------

export const AssetLayerDataSchema = z.object({
  asset_id: z.number(),
  rotation_deg: z.number().default(0),
  opacity: z.number().default(1),
  ratio_locked: z.boolean().default(true),
});
export type AssetLayerData = z.infer<typeof AssetLayerDataSchema>;

export function parseAssetData(data: unknown): AssetLayerData {
  const r = AssetLayerDataSchema.safeParse(data ?? {});
  return r.success
    ? r.data
    : { asset_id: 0, rotation_deg: 0, opacity: 1, ratio_locked: true };
}

// ---- effect layer data ------------------------------------------------

export const EffectTypeSchema = z.enum([
  "saturation",
  "brightness",
  "contrast",
  "vignette",
  "blur",
]);
export type EffectType = z.infer<typeof EffectTypeSchema>;

export const EffectLayerDataSchema = z.object({
  type: EffectTypeSchema.default("saturation"),
  force: z.number().default(0),
});
export type EffectLayerData = z.infer<typeof EffectLayerDataSchema>;

export function parseEffectData(data: unknown): EffectLayerData {
  const r = EffectLayerDataSchema.safeParse(data ?? {});
  return r.success ? r.data : { type: "saturation", force: 0 };
}

// ---- animation layer data ---------------------------------------------

export const AnimationPresetSchema = z.enum([
  "zoom_in_slow",
  "zoom_in_punch",
  "zoom_out_slow",
  "pan_left_right",
  "pan_right_left",
  "shake",
]);
export type AnimationPreset = z.infer<typeof AnimationPresetSchema>;

export const AnimationLayerDataSchema = z.object({
  preset: AnimationPresetSchema.default("zoom_in_slow"),
  force: z.number().default(1.0),
});
export type AnimationLayerData = z.infer<typeof AnimationLayerDataSchema>;

export function parseAnimationData(data: unknown): AnimationLayerData {
  const r = AnimationLayerDataSchema.safeParse(data ?? {});
  return r.success ? r.data : { preset: "zoom_in_slow", force: 1.0 };
}

// ---- render preview + batch + jobs ------------------------------------

export const JobStatusSchema = z.enum(["queued", "running", "done", "failed"]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const JobSummarySchema = z.object({
  id: z.number(),
  name: z.string(),
  status: JobStatusSchema,
  progress: z.number(),
  created_at: z.string(),
  finished_at: z.string().nullable(),
  output_count: z.number(),
  has_zip: z.boolean(),
});
export type JobSummary = z.infer<typeof JobSummarySchema>;

export const JobReadSchema = z.object({
  id: z.number(),
  name: z.string(),
  status: JobStatusSchema,
  assignments: z.array(z.unknown()),
  metadata_profile: z.record(z.unknown()),
  output_zip_path: z.string().nullable(),
  output_files: z.array(z.string()),
  progress: z.number(),
  error: z.string().nullable(),
  created_at: z.string(),
  finished_at: z.string().nullable(),
});
export type JobRead = z.infer<typeof JobReadSchema>;

export const DashboardStatsSchema = z.object({
  template_count: z.number(),
  source_count: z.number(),
  render_count: z.number(),
});
export type DashboardStats = z.infer<typeof DashboardStatsSchema>;

export type BatchAssignment = { source_id: number; template_id: number };
export type BatchMetadataProfile = {
  enabled: boolean;
  method?: string;
  model?: string;
  country?: string;
  language?: string;
  date_window_days?: number;
};

export const Render = {
  preview: async (templateId: number, sourceId: number): Promise<Blob> => {
    const res = await fetch("/api/render/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template_id: templateId, source_id: sourceId }),
      credentials: "include",
    });
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const body = await res.json();
        detail = body.detail ?? detail;
      } catch {
        /* not JSON */
      }
      throw new ApiError(res.status, detail);
    }
    return res.blob();
  },
  batch: (
    name: string,
    assignments: BatchAssignment[],
    metadata_profile: BatchMetadataProfile,
  ) =>
    request(JobReadSchema, "/api/render/batch", {
      method: "POST",
      body: JSON.stringify({ name, assignments, metadata_profile }),
    }),
};

export const Jobs = {
  list: () => request(z.array(JobSummarySchema), "/api/jobs"),
  get: (id: number) => request(JobReadSchema, `/api/jobs/${id}`),
};

export const Dashboard = {
  stats: () => request(DashboardStatsSchema, "/api/dashboard/stats"),
};

// ---- pools ------------------------------------------------------------

const PoolMapSchema = z.record(z.array(z.string()));

export const Pools = {
  list: (templateId: number) =>
    request(PoolMapSchema, `/api/templates/${templateId}/pools`),
  put: (templateId: number, layerId: string, items: string[]) =>
    request(PoolMapSchema, `/api/templates/${templateId}/pools/${layerId}`, {
      method: "PUT",
      body: JSON.stringify({ items }),
    }),
};

// ---- assets -----------------------------------------------------------

export const AssetTypeSchema = z.enum(["image", "gif", "emoji", "font", "audio"]);
export type AssetType = z.infer<typeof AssetTypeSchema>;

export const AssetSchema = z.object({
  id: z.number(),
  type: AssetTypeSchema,
  name: z.string().nullable(),
  uploaded_at: z.string(),
});
export type Asset = z.infer<typeof AssetSchema>;

export const Assets = {
  list: (type?: AssetType) => {
    const qs = type ? `?type=${type}` : "";
    return request(z.array(AssetSchema), `/api/assets${qs}`);
  },
  delete: (id: number) => requestVoid(`/api/assets/${id}`, { method: "DELETE" }),
};

// ---- templates --------------------------------------------------------

export const Templates = {
  list: (language?: TemplateLanguage) => {
    const qs = language ? `?language=${language}` : "";
    return request(z.array(TemplateSchema), `/api/templates${qs}`);
  },
  get: (id: number) => request(TemplateSchema, `/api/templates/${id}`),
  create: (data: TemplateCreateInput) =>
    request(TemplateSchema, "/api/templates", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (id: number, data: TemplateUpdateInput) =>
    request(TemplateSchema, `/api/templates/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  delete: (id: number) => requestVoid(`/api/templates/${id}`, { method: "DELETE" }),
  duplicate: (id: number) =>
    request(TemplateSchema, `/api/templates/${id}/duplicate`, { method: "POST" }),
};
