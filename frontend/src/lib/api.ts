import { z } from "zod";

// ===== shared HTTP client ============================================

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

// ===== fonts =========================================================

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

// ===== layers (overlays on top of the video) =========================

export const LayerTypeSchema = z.enum(["text", "image", "gif", "emoji"]);
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

// ----- text layer data ----------------------------------------------

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

// ----- visual asset layer data (image/gif/emoji) --------------------
// Per-template files now (no global asset library). file_id refers to
// /data/templates/{template_id}/overlays/{file_id}.{ext}.

export const AssetLayerDataSchema = z.object({
  file_id: z.string().nullable().default(null),
  rotation_deg: z.number().default(0),
  opacity: z.number().default(1),
  ratio_locked: z.boolean().default(true),
});
export type AssetLayerData = z.infer<typeof AssetLayerDataSchema>;

export function parseAssetData(data: unknown): AssetLayerData {
  const r = AssetLayerDataSchema.safeParse(data ?? {});
  return r.success
    ? r.data
    : { file_id: null, rotation_deg: 0, opacity: 1, ratio_locked: true };
}

// ===== clips on the main video track =================================

export const ClipBaseSchema = z.object({
  id: z.string(),
  audio_enabled: z.boolean().default(true),
  audio_volume: z.number().default(1.0),
  trim_in: z.number().default(0),
  trim_out: z.number().nullable().default(null),
});

export const FixedClipSchema = ClipBaseSchema.extend({
  type: z.literal("fixed"),
  file_id: z.string(),
  source_duration_sec: z.number().nullable().default(null),
  source_width: z.number().nullable().default(null),
  source_height: z.number().nullable().default(null),
});
export type FixedClip = z.infer<typeof FixedClipSchema>;

export const ImageClipSchema = ClipBaseSchema.extend({
  type: z.literal("image"),
  file_id: z.string(),
  duration_sec: z.number().default(3.0),
  source_width: z.number().nullable().default(null),
  source_height: z.number().nullable().default(null),
});
export type ImageClip = z.infer<typeof ImageClipSchema>;

export const PlaceholderClipSchema = ClipBaseSchema.extend({
  type: z.literal("placeholder"),
  duration_sec: z.number().default(3.0),
});
export type PlaceholderClip = z.infer<typeof PlaceholderClipSchema>;

export const ClipSchema = z.discriminatedUnion("type", [
  FixedClipSchema,
  ImageClipSchema,
  PlaceholderClipSchema,
]);
export type Clip = z.infer<typeof ClipSchema>;

// Tolerant during loading — we re-validate per clip in the store.
const RawClipsSchema = z.array(z.unknown());

// ===== audio overlay (optional music track) ==========================

export const AudioOverlayConfigSchema = z.object({
  file_id: z.string().nullable(),
  volume: z.number(),
  start_offset: z.number(),
  trim_in: z.number(),
});
export type AudioOverlayConfig = z.infer<typeof AudioOverlayConfigSchema>;

// ===== templates =====================================================

export const TemplateLanguageSchema = z.enum(["FR", "US"]);
export type TemplateLanguage = z.infer<typeof TemplateLanguageSchema>;

const RawLayersSchema = z.array(z.unknown());

export const TemplateSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string().nullable(),
  language: TemplateLanguageSchema,
  clips: RawClipsSchema,
  layers: RawLayersSchema,
  audio_overlay: AudioOverlayConfigSchema,
  thumbnail_path: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Template = z.infer<typeof TemplateSchema>;

export const TemplateCreateSchema = z.object({
  name: z.string().min(1).max(200),
  language: TemplateLanguageSchema,
  description: z.string().optional(),
});
export type TemplateCreateInput = z.infer<typeof TemplateCreateSchema>;

export const TemplateUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  language: TemplateLanguageSchema.optional(),
  description: z.string().optional(),
  clips: z.array(ClipSchema).optional(),
  layers: z.array(LayerSchema).optional(),
  audio_overlay: AudioOverlayConfigSchema.optional(),
});
export type TemplateUpdateInput = z.infer<typeof TemplateUpdateSchema>;

const ClipUploadResponseSchema = z.object({
  file_id: z.string(),
  kind: z.enum(["video", "image"]).default("video"),
  duration_sec: z.number().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
});
export type ClipUploadResponse = z.infer<typeof ClipUploadResponseSchema>;

const OverlayUploadResponseSchema = z.object({
  file_id: z.string(),
});
export type OverlayUploadResponse = z.infer<typeof OverlayUploadResponseSchema>;

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

  uploadClip: async (
    templateId: number,
    file: File,
    onProgress?: (pct: number) => void,
  ): Promise<ClipUploadResponse> =>
    multipartUpload(
      `/api/templates/${templateId}/clips/upload`,
      file,
      ClipUploadResponseSchema,
      onProgress,
    ),

  uploadOverlay: async (
    templateId: number,
    file: File,
    onProgress?: (pct: number) => void,
  ): Promise<OverlayUploadResponse> =>
    multipartUpload(
      `/api/templates/${templateId}/overlays/upload`,
      file,
      OverlayUploadResponseSchema,
      onProgress,
    ),
};

// ===== render ========================================================

const RenderUploadResponseSchema = z.object({ token: z.string() });

export const Render = {
  uploadUserVideo: async (
    file: File,
    onProgress?: (pct: number) => void,
  ): Promise<{ token: string }> =>
    multipartUpload(
      "/api/render/upload",
      file,
      RenderUploadResponseSchema,
      onProgress,
    ),

  preview: async (
    templateId: number,
    fills: { clip_id: string; token: string }[],
  ): Promise<Blob> => {
    const res = await fetch("/api/render/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template_id: templateId, fills }),
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
    assignments: { template_id: number; fills: Record<string, string> }[],
    metadata_profile: {
      enabled: boolean;
      method?: string;
      model?: string;
      country?: string;
      language?: string;
      date_window_days?: number;
    },
  ) =>
    request(JobReadSchema, "/api/render/batch", {
      method: "POST",
      body: JSON.stringify({ name, assignments, metadata_profile }),
    }),
};

// ===== jobs / dashboard =============================================

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
  render_count: z.number(),
});
export type DashboardStats = z.infer<typeof DashboardStatsSchema>;

export const Jobs = {
  list: () => request(z.array(JobSummarySchema), "/api/jobs"),
  get: (id: number) => request(JobReadSchema, `/api/jobs/${id}`),
};

export const Dashboard = {
  stats: () => request(DashboardStatsSchema, "/api/dashboard/stats"),
};

// ===== multipart upload helper (XHR for progress) ====================

function multipartUpload<T>(
  url: string,
  file: File,
  schema: z.ZodType<T>,
  onProgress?: (pct: number) => void,
  fieldName: string = "file",
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const fd = new FormData();
    fd.append(fieldName, file, file.name);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", url, true);
    xhr.withCredentials = true;

    xhr.upload.addEventListener("progress", (evt) => {
      if (onProgress && evt.lengthComputable) {
        onProgress(Math.round((evt.loaded / evt.total) * 100));
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        let detail = xhr.statusText || "Upload failed";
        try {
          const body = JSON.parse(xhr.responseText);
          if (body?.detail) detail = body.detail;
        } catch {
          /* not JSON */
        }
        reject(new ApiError(xhr.status, detail));
        return;
      }
      try {
        resolve(schema.parse(JSON.parse(xhr.responseText)));
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });

    xhr.addEventListener("error", () =>
      reject(new ApiError(0, "Network error")),
    );
    xhr.addEventListener("abort", () =>
      reject(new ApiError(0, "Upload aborted")),
    );

    xhr.send(fd);
  });
}
