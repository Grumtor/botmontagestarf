import { z } from "zod";

// ===== shared HTTP client ============================================

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * For multipart uploads (photos, video, render-source) we BYPASS the
 * Next.js dev proxy and hit the backend directly. The dev proxy buffers
 * the entire body before forwarding, which chokes / drops on big payloads
 * (50+ photos = 200MB+). Backend has CORS allowed for localhost:3000.
 *
 * In production / behind a real reverse proxy you'd point this at the
 * same origin (no CORS needed). Override via NEXT_PUBLIC_BACKEND_URL.
 */
const BACKEND_DIRECT_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

function direct(path: string): string {
  // path always starts with `/api/...`. Prepend the backend origin.
  return `${BACKEND_DIRECT_URL}${path}`;
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

// ===== auth (Phase 30) ===============================================
//
// Note : on appelle le backend directement (pas via le proxy Next.js)
// pour que le cookie de session soit bien posé sur le domaine racine
// (.grumtor.com) et partagé entre bot.* et api.*.

// Phase 33 — public-safe view of the authenticated user.
export const UserMeSchema = z.object({
  id: z.number(),
  username: z.string(),
  role: z.enum(["admin", "user"]),
  priority: z.enum(["high", "normal", "low"]),
  max_templates: z.number().nullable(),
  render_credits: z.number(),
  is_active: z.boolean(),
});
export type UserMe = z.infer<typeof UserMeSchema>;

export const Auth = {
  /** Logout : invalide le cookie côté serveur ET côté client. */
  logout: async (): Promise<void> => {
    try {
      await fetch(`${BACKEND_DIRECT_URL}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch {
      /* ignore — on redirige quand même */
    }
    window.location.href = "/login";
  },

  /** Quick "am I logged in?" probe — returns true/false sans throw. */
  me: async (): Promise<boolean> => {
    try {
      const res = await fetch(`${BACKEND_DIRECT_URL}/api/auth/me`, {
        credentials: "include",
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  /** Fetch the current user's profile (id, username, role, priority,
   *  max_templates, render_credits). Returns null on 401. */
  whoami: async (): Promise<UserMe | null> => {
    try {
      const res = await fetch(`${BACKEND_DIRECT_URL}/api/auth/me`, {
        credentials: "include",
      });
      if (!res.ok) return null;
      const body = await res.json();
      const r = UserMeSchema.safeParse(body?.user);
      return r.success ? r.data : null;
    } catch {
      return null;
    }
  },
};

// ===== fonts =========================================================

export const FontIdSchema = z.union([z.string(), z.number()]);
export type FontId = z.infer<typeof FontIdSchema>;

export const FontMetaSchema = z.object({
  id: FontIdSchema,
  name: z.string(),
  builtin: z.boolean(),
  group: z.string(),
  group_label: z.string(),
  installed: z.boolean(),
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

export const PlacementModeSchema = z.enum(["fixed", "random"]);
export type PlacementMode = z.infer<typeof PlacementModeSchema>;

export const PlacementZoneSchema = z.object({
  x_pct: z.number(),
  y_pct: z.number(),
  width_pct: z.number(),
  height_pct: z.number(),
});
export type PlacementZone = z.infer<typeof PlacementZoneSchema>;

export const TextLayerDataSchema = z.object({
  text: z.string().default(""),
  // Pool of text variations — each render picks one at random. Empty / single
  // entry behaves like a static text. Each string can contain newlines.
  text_pool: z.array(z.string()).default([]),
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
  opacity: z.number().default(1),
  // Random placement (per render). When `fixed`, the layer's own
  // x_pct/y_pct are used as-is. When `random`, the backend picks one
  // zone uniformly at random from `placement_zones`, then a random
  // position inside it. `placement_zone` (singular) is kept for
  // backward compatibility with templates from before multi-zone.
  placement_mode: PlacementModeSchema.default("fixed"),
  placement_zone: PlacementZoneSchema.nullable().default(null),
  placement_zones: z.array(PlacementZoneSchema).default([]),
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

export const ClipFilterSchema = z.enum(["none", "bw"]);
export type ClipFilter = z.infer<typeof ClipFilterSchema>;

export const ClipBaseSchema = z.object({
  id: z.string(),
  audio_enabled: z.boolean().default(true),
  audio_volume: z.number().default(1.0),
  trim_in: z.number().default(0),
  trim_out: z.number().nullable().default(null),
  /** Per-clip color filter. "none" = source colors, "bw" = grayscale.
   *  Applies to the video portions (pre + post the freeze), NOT to the
   *  freeze sub-segment itself (which has its own `freeze_filter`). */
  filter: ClipFilterSchema.default("none"),
  /** Optional time range (in local clip seconds, from 0) during which the
   *  filter applies. Both null = filter on the whole clip. Either set =
   *  filter only between [filter_start_sec, filter_end_sec]. */
  filter_start_sec: z.number().nullable().default(null),
  filter_end_sec: z.number().nullable().default(null),
  /** Freeze sub-segment INSIDE the clip. Position is given in local clip
   *  seconds (0 = clip start, naturalDur = clip end). null = no freeze.
   *  A freeze of duration D inserts D seconds of held last-frame at that
   *  position — the clip total duration grows by D. The freeze can have
   *  its own independent B&W via `freeze_filter`. */
  freeze_at_sec: z.number().nullable().default(null),
  freeze_duration_sec: z.number().default(0),
  freeze_filter: ClipFilterSchema.default("none"),
  /** Legacy field (pre-refonte) — freeze appended at the end of the clip.
   *  Kept for backward compat ; auto-migrated to freeze_at_sec=naturalDur
   *  on first load. New code should use the trio above. */
  freeze_tail_sec: z.number().default(0),
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

// ===== extra tracks (Phase 26b multi-track) ==========================
//
// Track 1 = `template.clips` (sequential, fills the timeline). Tracks 2-5
// live in `template.extra_tracks`, each with clips placed at ABSOLUTE
// `start_time` on the timeline (free positioning, can have gaps).
// Visual priority bottom-up: higher track index covers lower tracks.

export const ExtraClipBaseSchema = ClipBaseSchema.extend({
  /** ABSOLUTE position on the timeline where this clip starts. */
  start_time: z.number().default(0),
  /** Phase 28 — when false, the clip's video doesn't overlay the
   *  underlying tracks (audio still mixed). Use case: pull just the
   *  soundtrack from a clip while the visual stays on track 1. */
  video_enabled: z.boolean().default(true),
});

export const ExtraFixedClipSchema = ExtraClipBaseSchema.extend({
  type: z.literal("fixed"),
  file_id: z.string(),
  source_duration_sec: z.number().nullable().default(null),
  source_width: z.number().nullable().default(null),
  source_height: z.number().nullable().default(null),
});

export const ExtraImageClipSchema = ExtraClipBaseSchema.extend({
  type: z.literal("image"),
  file_id: z.string(),
  duration_sec: z.number().default(3.0),
  source_width: z.number().nullable().default(null),
  source_height: z.number().nullable().default(null),
});

export const ExtraPlaceholderClipSchema = ExtraClipBaseSchema.extend({
  type: z.literal("placeholder"),
  duration_sec: z.number().default(3.0),
});

export const ExtraClipSchema = z.discriminatedUnion("type", [
  ExtraFixedClipSchema,
  ExtraImageClipSchema,
  ExtraPlaceholderClipSchema,
]);
export type ExtraClip = z.infer<typeof ExtraClipSchema>;

export const ExtraTrackSchema = z.object({
  id: z.string(),
  name: z.string(),
  clips: z.array(z.unknown()).default([]),
});
export type ExtraTrack = z.infer<typeof ExtraTrackSchema>;

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
  // Phase 26b — kept tolerant (z.unknown()) at the schema layer; we
  // re-validate strict in the store via ExtraTrackSchema/ExtraClipSchema.
  // No default → backend always sends [] post-migration so it's safe to
  // require. Old API responses (pre-migration) would fail loud.
  extra_tracks: z.array(z.unknown()),
  layers: RawLayersSchema,
  audio_overlay: AudioOverlayConfigSchema,
  thumbnail_path: z.string().nullable(),
  cover_ext: z.string().nullable().optional(),
  cover_time_sec: z.number().nullable().optional(),
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
  // Tolerant on update — server stores raw JSON anyway.
  extra_tracks: z.array(z.unknown()).optional(),
  layers: z.array(LayerSchema).optional(),
  audio_overlay: AudioOverlayConfigSchema.optional(),
});
export type TemplateUpdateInput = z.infer<typeof TemplateUpdateSchema>;

const ClipUploadResponseSchema = z.object({
  file_id: z.string(),
  kind: z.enum(["video", "image"]),
  duration_sec: z.number().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
});
export type ClipUploadResponse = z.infer<typeof ClipUploadResponseSchema>;

const OverlayUploadResponseSchema = z.object({
  file_id: z.string(),
});
export type OverlayUploadResponse = z.infer<typeof OverlayUploadResponseSchema>;

const CoverResponseSchema = z.object({
  cover_ext: z.string(),
  cover_time_sec: z.number(),
});
export type CoverResponse = z.infer<typeof CoverResponseSchema>;

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

  /** Pick a frame from the template's preview MP4 at `time_sec` and use
   * it as the cover image for the /templates grid card. Requires a
   * preview to exist (404 → tell the user to generate one first). */
  setCoverFromTime: (templateId: number, timeSec: number) =>
    request(
      CoverResponseSchema,
      `/api/templates/${templateId}/cover/from-time`,
      {
        method: "POST",
        body: JSON.stringify({ time_sec: timeSec }),
      },
    ),

  /** Drop the custom cover, revert to auto-extracted thumbnail. */
  deleteCover: (id: number) =>
    requestVoid(`/api/templates/${id}/cover`, { method: "DELETE" }),

  /** Phase 25 (B): extract the audio of a fixed clip and use it as the
   * global audio_overlay (auto-mutes the source clip). Returns the
   * updated template — caller should refresh the editor store. */
  useClipAudioAsOverlay: (templateId: number, clipId: string) =>
    request(
      TemplateSchema,
      `/api/templates/${templateId}/clips/${clipId}/use-as-overlay`,
      { method: "POST" },
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
    assignments: {
      template_id: number;
      fills: Record<string, string>;
      /** Phase 29c — frontend-side multi-pass annotation. Set when the
       *  wizard has already pre-rolled multi-pass assignments (random
       *  reroll mode) — backend respects this and skips its own
       *  multiplier. */
      gen_idx?: number;
    }[],
    metadata_profile: {
      enabled: boolean;
      method?: string;
      model?: string;
      country?: string;
      language?: string;
      date_window_days?: number;
    },
    /** Phase 29 — multiplie chaque assignment N fois avec metadata
     *  indépendante par copie. Default 1. Ignoré si les assignments
     *  envoyés portent déjà un `gen_idx`. */
    generations: number = 1,
    /** Phase 29 — naming style des MP4 dans le ZIP final.
     *  "iphone" → IMG_xxxx.MOV (default), "default" → noms templates */
    naming: "iphone" | "default" = "iphone",
    /** Phase 29c — label des sous-dossiers de groupement dans le ZIP.
     *  "Generation" par défaut. "Tirage" pour le random reroll mode. */
    pass_label: string = "Generation",
  ) =>
    request(JobReadSchema, "/api/render/batch", {
      method: "POST",
      body: JSON.stringify({
        name,
        assignments,
        metadata_profile,
        generations,
        naming,
        pass_label,
      }),
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

// ===== sample placeholder video (Phase 17) ===========================
//
// Single global file used as the visual filler whenever a template
// preview would show a black placeholder. Uploaded once via the
// templates page header.

export const SampleVideoInfoSchema = z.object({
  exists: z.boolean(),
  size_bytes: z.number().nullable(),
  duration_sec: z.number().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
});
export type SampleVideoInfo = z.infer<typeof SampleVideoInfoSchema>;

export const SampleVideo = {
  info: () => request(SampleVideoInfoSchema, "/api/sample_video/info"),
  upload: async (file: File, onProgress?: (pct: number) => void) =>
    multipartUpload(
      "/api/sample_video",
      file,
      SampleVideoInfoSchema,
      onProgress,
    ),
  delete: () => requestVoid("/api/sample_video", { method: "DELETE" }),
  /** URL of the served file. Add a cache-busting timestamp when re-rendering
   *  after an upload so the <video> element actually refetches. */
  url: (cacheBust?: number) =>
    cacheBust ? `/api/sample_video?t=${cacheBust}` : "/api/sample_video",
};

// ===== photos (bulk EXIF metadata spoofing) ==========================

export type PhotoSpoofProfile = {
  /** One or more iPhone models. Random pick per photo. */
  models: string[];
  country: string;
  language?: string;
  date_window_days: number;
  /** Phase 29 — Number of "generations" : duplicate output set N times
   *  with fresh randomized metadata (different iPhone model, GPS, ISO,
   *  date) for each pass. Default 1. Range 1-10. */
  generations?: number;
  /** Phase 29 — Naming style. "iphone" → IMG_xxxx.{EXT} continuous
   *  counter starting random in [1500, 9000]. "default" → keep
   *  source names. */
  naming?: "iphone" | "default";
};

export type PhotoSpoofResult = {
  zipBlob: Blob;
  spoofedCount: number;
  skippedCount: number;
};

export const Photos = {
  /** Upload N images with a spoofing profile, get back a ZIP of the
   *  metadata-rewritten files. Each photo gets an INDEPENDENT random
   *  tirage of date / GPS / lens / ISO / aperture / exposure. */
  spoof: async (
    files: File[],
    profile: PhotoSpoofProfile,
    onProgress?: (pct: number) => void,
  ): Promise<PhotoSpoofResult> => {
    return new Promise<PhotoSpoofResult>((resolve, reject) => {
      const fd = new FormData();
      for (const f of files) fd.append("files", f, f.name);
      for (const m of profile.models) fd.append("models", m);
      fd.append("country", profile.country);
      if (profile.language) fd.append("language", profile.language);
      fd.append("date_window_days", String(profile.date_window_days));
      if (profile.generations && profile.generations > 1) {
        fd.append("generations", String(profile.generations));
      }
      if (profile.naming) fd.append("naming", profile.naming);

      const xhr = new XMLHttpRequest();
      // Direct backend (bypass Next.js dev proxy — chokes on big batches).
      xhr.open("POST", direct("/api/photos/spoof"), true);
      xhr.responseType = "blob";
      xhr.withCredentials = true;

      xhr.upload.addEventListener("progress", (evt) => {
        if (onProgress && evt.lengthComputable) {
          onProgress(Math.round((evt.loaded / evt.total) * 100));
        }
      });

      xhr.addEventListener("load", () => {
        if (xhr.status < 200 || xhr.status >= 300) {
          let detail = xhr.statusText || "Spoof failed";
          // The error body is a JSON Blob — read it.
          if (xhr.response instanceof Blob) {
            xhr.response.text().then((txt) => {
              try {
                const body = JSON.parse(txt);
                if (body?.detail) detail = body.detail;
              } catch {
                /* leave statusText */
              }
              reject(new ApiError(xhr.status, detail));
            }).catch(() => reject(new ApiError(xhr.status, detail)));
          } else {
            reject(new ApiError(xhr.status, detail));
          }
          return;
        }
        const spoofedCount = Number(xhr.getResponseHeader("X-Spoofed-Count") ?? files.length);
        const skippedCount = Number(xhr.getResponseHeader("X-Skipped-Count") ?? 0);
        resolve({ zipBlob: xhr.response as Blob, spoofedCount, skippedCount });
      });

      xhr.addEventListener("error", () =>
        reject(new ApiError(0, "Network error")),
      );
      xhr.addEventListener("abort", () =>
        reject(new ApiError(0, "Upload aborted")),
      );

      xhr.send(fd);
    });
  },
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
    // Bypass Next.js dev proxy for uploads — its body buffer chokes on
    // 100+ MB multipart payloads. CORS is allowed on the backend.
    xhr.open("POST", direct(url), true);
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
