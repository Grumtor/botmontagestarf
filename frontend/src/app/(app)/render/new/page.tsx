"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Rocket,
  Upload,
  X,
  Shuffle,
  Layers,
  ListChecks,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ClipSchema,
  Render,
  Templates,
  type PlaceholderClip,
  type Template,
  type TemplateLanguage,
} from "@/lib/api";
import { cn } from "@/lib/utils";

// ===== types =========================================================

type Pending = {
  id: string;
  name: string;
  size: number;
  progress: number;
  token: string | null;
  error: string | null;
};

type WizardMode = "all" | "random" | "per_video";

const ALLOWED_EXTS = [".mp4", ".mov"];

// ===== spoofing constants (mirror RunRenderDialog) ===================

const COUNTRIES = [
  { value: "USA", label: "USA" },
  { value: "Canada", label: "Canada" },
  { value: "France", label: "France" },
  { value: "UK", label: "UK" },
  { value: "Spain", label: "Espagne" },
  { value: "Italy", label: "Italie" },
  { value: "Germany", label: "Allemagne" },
  { value: "Mexico", label: "Mexique" },
  { value: "Brazil", label: "Brésil" },
  { value: "Australia", label: "Australie" },
  { value: "Japan", label: "Japon" },
  { value: "Netherlands", label: "Pays-Bas" },
];
const COUNTRY_LANG: Record<string, string> = {
  USA: "en-US",
  Canada: "en-CA",
  France: "fr-FR",
  UK: "en-GB",
  Spain: "es-ES",
  Italy: "it-IT",
  Germany: "de-DE",
  Mexico: "es-MX",
  Brazil: "pt-BR",
  Australia: "en-AU",
  Japan: "ja-JP",
  Netherlands: "nl-NL",
};
const MODELS = [
  "iPhone 16",
  "iPhone 16 Plus",
  "iPhone 16 Pro",
  "iPhone 16 Pro Max",
  "iPhone 17",
  "iPhone 17 Pro",
  "iPhone 17 Pro Max",
];
const LANGUAGES = [
  "en-US",
  "en-CA",
  "en-GB",
  "en-AU",
  "fr-FR",
  "es-ES",
  "es-MX",
  "it-IT",
  "de-DE",
  "pt-BR",
  "ja-JP",
  "nl-NL",
];

// ===== helpers =======================================================

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function defaultJobName(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `Batch ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getPlaceholders(t: Template): PlaceholderClip[] {
  const out: PlaceholderClip[] = [];
  for (const item of t.clips ?? []) {
    const r = ClipSchema.safeParse(item);
    if (r.success && r.data.type === "placeholder") {
      out.push(r.data);
    }
  }
  return out;
}

// ===== page ==========================================================

export default function RenderWizardPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1 — uploads
  const [uploads, setUploads] = useState<Pending[]>([]);

  // Step 2 — template selection
  const [allTemplates, setAllTemplates] = useState<Template[] | null>(null);
  const [langFilter, setLangFilter] = useState<TemplateLanguage | "ALL">("ALL");
  const [mode, setMode] = useState<WizardMode>("all");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [perVideoTpl, setPerVideoTpl] = useState<Record<string, number>>({});

  // Step 3 — confirm
  const [jobName, setJobName] = useState(defaultJobName());
  const [spoofEnabled, setSpoofEnabled] = useState(false);
  const [model, setModel] = useState("iPhone 17 Pro");
  const [country, setCountry] = useState("USA");
  const [language, setLanguage] = useState("en-US");
  const [dateWindow, setDateWindow] = useState(7);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Lazy-load templates when entering step 2
  useEffect(() => {
    if (step !== 2 || allTemplates !== null) return;
    let cancelled = false;
    Templates.list().then((t) => {
      if (!cancelled) setAllTemplates(t);
    });
    return () => {
      cancelled = true;
    };
  }, [step, allTemplates]);

  // Templates that have at least one placeholder are usable in batch mode.
  const usableTemplates = useMemo(() => {
    return (allTemplates ?? []).filter((t) => getPlaceholders(t).length > 0);
  }, [allTemplates]);

  const visibleTemplates = useMemo(() => {
    if (langFilter === "ALL") return usableTemplates;
    return usableTemplates.filter((t) => t.language === langFilter);
  }, [usableTemplates, langFilter]);

  const readyVideos = uploads.filter((u) => u.token);
  const allVideosReady =
    uploads.length > 0 && readyVideos.length === uploads.length;

  // Reels count (depends on mode)
  const reelCount = useMemo(() => {
    const v = readyVideos.length;
    const t = selectedIds.size;
    if (v === 0 || (mode !== "per_video" && t === 0)) return 0;
    if (mode === "all") return v * t;
    if (mode === "random") return v;
    if (mode === "per_video") {
      // Count videos that have a template assigned
      return readyVideos.filter((u) => perVideoTpl[u.id] != null).length;
    }
    return 0;
  }, [readyVideos, selectedIds, mode, perVideoTpl]);

  const overLimit = reelCount > 50;

  // ===== step 1 actions ===========================================

  function patchPending(id: string, patch: Partial<Pending>) {
    setUploads((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  function removePending(id: string) {
    setUploads((prev) => prev.filter((p) => p.id !== id));
  }

  async function onFiles(files: File[]) {
    const allowed = files.filter((f) =>
      ALLOWED_EXTS.some((e) => f.name.toLowerCase().endsWith(e)),
    );
    if (allowed.length === 0) return;
    const additions: Pending[] = allowed.map((f) => ({
      id: crypto.randomUUID(),
      name: f.name,
      size: f.size,
      progress: 0,
      token: null,
      error: null,
    }));
    setUploads((prev) => [...prev, ...additions]);

    await Promise.all(
      additions.map(async (p, i) => {
        try {
          const res = await Render.uploadUserVideo(allowed[i], (pct) => {
            patchPending(p.id, { progress: pct });
          });
          patchPending(p.id, { token: res.token, progress: 100 });
        } catch (err) {
          patchPending(p.id, {
            error: err instanceof Error ? err.message : "Erreur",
          });
        }
      }),
    );
  }

  // ===== step 2 actions ===========================================

  function toggleTemplate(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllVisible() {
    setSelectedIds(new Set(visibleTemplates.map((t) => t.id)));
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  // ===== step 3: build assignments + launch =======================

  function buildAssignments(): {
    template_id: number;
    fills: Record<string, string>;
  }[] {
    if (!allTemplates) return [];
    const tplById = new Map(allTemplates.map((t) => [t.id, t]));
    const out: { template_id: number; fills: Record<string, string> }[] = [];
    const fillFor = (tpl: Template, token: string) => {
      const fills: Record<string, string> = {};
      for (const p of getPlaceholders(tpl)) {
        // Same video fills every placeholder of this template.
        fills[p.id] = token;
      }
      return fills;
    };

    if (mode === "all") {
      for (const tplId of selectedIds) {
        const tpl = tplById.get(tplId);
        if (!tpl) continue;
        for (const v of readyVideos) {
          if (!v.token) continue;
          out.push({ template_id: tpl.id, fills: fillFor(tpl, v.token) });
        }
      }
    } else if (mode === "random") {
      const tplIds = Array.from(selectedIds);
      if (tplIds.length === 0) return [];
      // Shuffle template order so the video → template mapping varies.
      const pool = [...tplIds].sort(() => Math.random() - 0.5);
      readyVideos.forEach((v, i) => {
        if (!v.token) return;
        const tpl = tplById.get(pool[i % pool.length]);
        if (!tpl) return;
        out.push({ template_id: tpl.id, fills: fillFor(tpl, v.token) });
      });
    } else {
      // per_video
      for (const v of readyVideos) {
        const tplId = perVideoTpl[v.id];
        if (tplId == null || !v.token) continue;
        const tpl = tplById.get(tplId);
        if (!tpl) continue;
        out.push({ template_id: tpl.id, fills: fillFor(tpl, v.token) });
      }
    }

    return out;
  }

  async function onLaunch() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const assignments = buildAssignments();
      if (assignments.length === 0) {
        throw new Error("Rien à rendre — vérifie les sélections.");
      }
      const job = await Render.batch(jobName, assignments, {
        enabled: spoofEnabled,
        model,
        country,
        language,
        date_window_days: dateWindow,
      });
      router.push(`/jobs/${job.id}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSubmitting(false);
    }
  }

  // ===== validation per step =====================================

  const canGoNext = (() => {
    if (step === 1) return allVideosReady;
    if (step === 2) {
      if (mode === "per_video") {
        // Every uploaded video must have a template chosen.
        return readyVideos.every((v) => perVideoTpl[v.id] != null);
      }
      return selectedIds.size > 0;
    }
    return false;
  })();

  // ===== render ===================================================

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Nouveau render</h1>
        <p className="text-sm text-muted-foreground">
          Drop tes vidéos, choisis tes templates, lance le batch.
        </p>
      </div>

      <Stepper step={step} />

      <div className="rounded-lg border border-border bg-card p-5">
        {step === 1 && (
          <Step1Upload
            uploads={uploads}
            onFiles={onFiles}
            onRemove={removePending}
          />
        )}
        {step === 2 && (
          <Step2Templates
            mode={mode}
            setMode={setMode}
            langFilter={langFilter}
            setLangFilter={setLangFilter}
            templates={visibleTemplates}
            allTemplatesLoaded={allTemplates !== null}
            selectedIds={selectedIds}
            onToggle={toggleTemplate}
            onSelectAll={selectAllVisible}
            onClear={clearSelection}
            videos={readyVideos}
            perVideoTpl={perVideoTpl}
            setPerVideoTpl={setPerVideoTpl}
          />
        )}
        {step === 3 && (
          <Step3Confirm
            jobName={jobName}
            setJobName={setJobName}
            spoofEnabled={spoofEnabled}
            setSpoofEnabled={setSpoofEnabled}
            model={model}
            setModel={setModel}
            country={country}
            setCountry={(c) => {
              setCountry(c);
              const fb = COUNTRY_LANG[c];
              if (fb) setLanguage(fb);
            }}
            language={language}
            setLanguage={setLanguage}
            dateWindow={dateWindow}
            setDateWindow={setDateWindow}
            videoCount={readyVideos.length}
            templateCount={selectedIds.size}
            mode={mode}
            reelCount={reelCount}
            overLimit={overLimit}
            error={submitError}
          />
        )}
      </div>

      {/* Bottom action bar */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          onClick={() => {
            if (step === 1) router.push("/");
            else setStep((step - 1) as 1 | 2 | 3);
          }}
          disabled={submitting}
        >
          <ArrowLeft className="h-4 w-4" />
          {step === 1 ? "Annuler" : "Retour"}
        </Button>

        {step < 3 ? (
          <Button
            onClick={() => setStep((step + 1) as 1 | 2 | 3)}
            disabled={!canGoNext}
          >
            Suivant
            <ArrowRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            onClick={onLaunch}
            disabled={submitting || reelCount === 0 || overLimit}
          >
            <Rocket className="h-4 w-4" />
            {submitting
              ? "Envoi…"
              : `Lancer ${reelCount} reel${reelCount > 1 ? "s" : ""}`}
          </Button>
        )}
      </div>
    </div>
  );
}

// ===== stepper =======================================================

function Stepper({ step }: { step: 1 | 2 | 3 }) {
  const items: { n: 1 | 2 | 3; label: string }[] = [
    { n: 1, label: "Upload" },
    { n: 2, label: "Templates" },
    { n: 3, label: "Confirmation" },
  ];
  return (
    <div className="flex items-center gap-3">
      {items.map((it, i) => {
        const active = step === it.n;
        const done = step > it.n;
        return (
          <div key={it.n} className="flex flex-1 items-center gap-3">
            <div
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition",
                active && "border-primary bg-primary text-primary-foreground",
                done && "border-emerald-600 bg-emerald-600 text-white",
                !active && !done && "border-border bg-card text-muted-foreground",
              )}
            >
              {done ? <Check className="h-4 w-4" /> : it.n}
            </div>
            <span
              className={cn(
                "text-sm",
                active ? "font-medium" : "text-muted-foreground",
              )}
            >
              {it.label}
            </span>
            {i < items.length - 1 && (
              <div
                className={cn(
                  "h-px flex-1 bg-border",
                  done && "bg-emerald-600",
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ===== step 1 ========================================================

function Step1Upload({
  uploads,
  onFiles,
  onRemove,
}: {
  uploads: Pending[];
  onFiles: (files: File[]) => void;
  onRemove: (id: string) => void;
}) {
  const [drag, setDrag] = useState(false);
  const ready = uploads.filter((u) => u.token).length;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Uploade tes vidéos</h2>
        <p className="text-sm text-muted-foreground">
          Drop autant de vidéos que tu veux (.mp4 / .mov) — qualité d&apos;origine
          conservée, pas de réencodage côté navigateur.
        </p>
      </div>

      <label
        htmlFor="wizard-upload"
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          onFiles(Array.from(e.dataTransfer.files ?? []));
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-10 text-center transition",
          drag && "border-ring bg-accent/30",
        )}
      >
        <Upload className="h-8 w-8 text-muted-foreground" />
        <div className="text-sm">
          Drop tes vidéos ici ou{" "}
          <span className="text-primary underline">parcours</span>
        </div>
        <div className="text-xs text-muted-foreground">
          MP4 / MOV — multi-fichiers OK
        </div>
        <input
          id="wizard-upload"
          type="file"
          accept="video/mp4,video/quicktime,.mp4,.mov"
          multiple
          className="hidden"
          onChange={(e) => {
            onFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </label>

      {uploads.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {ready}/{uploads.length} vidéo{uploads.length > 1 ? "s" : ""} prêt
              {ready > 1 ? "es" : "e"}
            </span>
          </div>
          <div className="space-y-1.5">
            {uploads.map((u) => (
              <div
                key={u.id}
                className="flex items-center gap-3 rounded-md border border-border bg-background/40 p-2.5 text-sm"
              >
                <div className="flex-1 truncate">
                  <div className="truncate font-medium">{u.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatBytes(u.size)}
                  </div>
                </div>
                {u.error ? (
                  <span className="text-xs text-destructive">{u.error}</span>
                ) : u.token ? (
                  <span className="text-xs text-emerald-400">✓ prêt</span>
                ) : (
                  <Progress value={u.progress} className="w-32" />
                )}
                <button
                  type="button"
                  onClick={() => onRemove(u.id)}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label="Retirer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ===== step 2 ========================================================

function Step2Templates({
  mode,
  setMode,
  langFilter,
  setLangFilter,
  templates,
  allTemplatesLoaded,
  selectedIds,
  onToggle,
  onSelectAll,
  onClear,
  videos,
  perVideoTpl,
  setPerVideoTpl,
}: {
  mode: WizardMode;
  setMode: (m: WizardMode) => void;
  langFilter: TemplateLanguage | "ALL";
  setLangFilter: (v: TemplateLanguage | "ALL") => void;
  templates: Template[];
  allTemplatesLoaded: boolean;
  selectedIds: Set<number>;
  onToggle: (id: number) => void;
  onSelectAll: () => void;
  onClear: () => void;
  videos: Pending[];
  perVideoTpl: Record<string, number>;
  setPerVideoTpl: React.Dispatch<React.SetStateAction<Record<string, number>>>;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Choisis tes templates</h2>
        <p className="text-sm text-muted-foreground">
          {mode === "all" &&
            "Chaque vidéo sera rendue avec chacun des templates sélectionnés."}
          {mode === "random" &&
            "Chaque vidéo sera assignée aléatoirement à un des templates sélectionnés."}
          {mode === "per_video" &&
            "Choisis un template précis pour chacune de tes vidéos."}
        </p>
      </div>

      {/* Mode picker */}
      <div className="grid grid-cols-3 gap-2">
        <ModeCard
          active={mode === "all"}
          onClick={() => setMode("all")}
          icon={<Layers className="h-4 w-4" />}
          title="Toutes les templates"
          subtitle="N vidéos × M templates"
        />
        <ModeCard
          active={mode === "random"}
          onClick={() => setMode("random")}
          icon={<Shuffle className="h-4 w-4" />}
          title="Random Mix"
          subtitle="Chaque vidéo → 1 template aléatoire"
        />
        <ModeCard
          active={mode === "per_video"}
          onClick={() => setMode("per_video")}
          icon={<ListChecks className="h-4 w-4" />}
          title="Per-video"
          subtitle="1 template par vidéo (manuel)"
        />
      </div>

      {/* Language filter + select-all */}
      {mode !== "per_video" && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Langue :</span>
            {(["ALL", "FR", "US"] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLangFilter(l)}
                className={cn(
                  "rounded-md border px-2.5 py-1 transition",
                  langFilter === l
                    ? "border-primary bg-accent"
                    : "border-border hover:bg-accent/50",
                )}
              >
                {l === "ALL" ? "Toutes" : l === "FR" ? "🇫🇷 FR" : "🇺🇸 US"}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">
              {selectedIds.size} sélectionné{selectedIds.size > 1 ? "s" : ""}
            </span>
            <button
              type="button"
              onClick={onSelectAll}
              className="rounded-md border border-border px-2 py-1 transition hover:bg-accent/50"
            >
              Tout sélectionner
            </button>
            <button
              type="button"
              onClick={onClear}
              className="rounded-md border border-border px-2 py-1 transition hover:bg-accent/50"
            >
              Vider
            </button>
          </div>
        </div>
      )}

      {!allTemplatesLoaded ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : mode === "per_video" ? (
        <PerVideoAssign
          videos={videos}
          allTemplates={templates}
          perVideoTpl={perVideoTpl}
          setPerVideoTpl={setPerVideoTpl}
        />
      ) : templates.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Aucun template avec placeholder pour ce filtre. Crée un template avec
          au moins 1 placeholder pour batch-render.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {templates.map((t) => {
            const selected = selectedIds.has(t.id);
            const placeholderCount = t.clips.reduce<number>((acc, c) => {
              const r = ClipSchema.safeParse(c);
              return acc + (r.success && r.data.type === "placeholder" ? 1 : 0);
            }, 0);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onToggle(t.id)}
                className={cn(
                  "group relative flex flex-col overflow-hidden rounded-lg border-2 bg-card text-left transition",
                  selected
                    ? "border-primary ring-2 ring-primary/40"
                    : "border-border hover:border-ring",
                )}
              >
                <div className="relative aspect-[9/16] w-full bg-black">
                  <img
                    src={`/api/files/template_thumb/${t.id}`}
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                  {selected && (
                    <div className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Check className="h-3 w-3" />
                    </div>
                  )}
                </div>
                <div className="p-2 text-xs">
                  <div className="truncate font-medium">{t.name}</div>
                  <div className="text-muted-foreground">
                    {t.language === "FR" ? "🇫🇷 FR" : "🇺🇸 US"}
                    {" · "}
                    {placeholderCount} trou{placeholderCount > 1 ? "s" : ""}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ModeCard({
  active,
  onClick,
  icon,
  title,
  subtitle,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col gap-1 rounded-lg border-2 p-3 text-left transition",
        active
          ? "border-primary bg-accent"
          : "border-border bg-card hover:border-ring",
      )}
    >
      <span className="flex items-center gap-2 text-sm font-medium">
        {icon}
        {title}
      </span>
      <span className="text-xs text-muted-foreground">{subtitle}</span>
    </button>
  );
}

function PerVideoAssign({
  videos,
  allTemplates,
  perVideoTpl,
  setPerVideoTpl,
}: {
  videos: Pending[];
  allTemplates: Template[];
  perVideoTpl: Record<string, number>;
  setPerVideoTpl: React.Dispatch<React.SetStateAction<Record<string, number>>>;
}) {
  if (videos.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Aucune vidéo prête. Reviens à l&apos;étape 1.
      </p>
    );
  }
  if (allTemplates.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Aucun template avec placeholder.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {videos.map((v) => (
        <div
          key={v.id}
          className="flex items-center gap-3 rounded-md border border-border bg-background/40 p-2.5 text-sm"
        >
          <div className="flex-1 truncate">
            <div className="truncate font-medium">{v.name}</div>
            <div className="text-xs text-muted-foreground">
              {formatBytes(v.size)}
            </div>
          </div>
          <Select
            value={perVideoTpl[v.id]?.toString() ?? ""}
            onValueChange={(value) => {
              const num = Number(value);
              setPerVideoTpl((prev) => ({ ...prev, [v.id]: num }));
            }}
          >
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Choisir un template…" />
            </SelectTrigger>
            <SelectContent>
              {allTemplates.map((t) => (
                <SelectItem key={t.id} value={t.id.toString()}>
                  {t.name} ({t.language})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ))}
    </div>
  );
}

// ===== step 3 ========================================================

function Step3Confirm({
  jobName,
  setJobName,
  spoofEnabled,
  setSpoofEnabled,
  model,
  setModel,
  country,
  setCountry,
  language,
  setLanguage,
  dateWindow,
  setDateWindow,
  videoCount,
  templateCount,
  mode,
  reelCount,
  overLimit,
  error,
}: {
  jobName: string;
  setJobName: (s: string) => void;
  spoofEnabled: boolean;
  setSpoofEnabled: (b: boolean) => void;
  model: string;
  setModel: (s: string) => void;
  country: string;
  setCountry: (s: string) => void;
  language: string;
  setLanguage: (s: string) => void;
  dateWindow: number;
  setDateWindow: (n: number) => void;
  videoCount: number;
  templateCount: number;
  mode: WizardMode;
  reelCount: number;
  overLimit: boolean;
  error: string | null;
}) {
  const modeLabel =
    mode === "all"
      ? "Toutes les templates"
      : mode === "random"
        ? "Random Mix"
        : "Per-video";

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Confirme et lance</h2>
        <p className="text-sm text-muted-foreground">
          Dernière étape — donne un nom au batch et active le spoofing si tu veux
          que les outputs passent pour des captures iPhone.
        </p>
      </div>

      <label className="flex flex-col gap-1.5 text-sm">
        <span>Nom du batch</span>
        <Input value={jobName} onChange={(e) => setJobName(e.target.value)} />
      </label>

      <div className="space-y-3">
        <button
          type="button"
          onClick={() => setSpoofEnabled(!spoofEnabled)}
          className={cn(
            "flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm transition",
            spoofEnabled
              ? "border-primary bg-accent"
              : "border-border hover:bg-accent/50",
          )}
        >
          <span>Spoofer les métadonnées (iPhone)</span>
          <span className="text-muted-foreground">
            {spoofEnabled ? "ON" : "OFF"}
          </span>
        </button>

        {spoofEnabled && (
          <div className="space-y-3 rounded-md border border-border bg-card p-3">
            <div className="grid grid-cols-2 gap-3">
              <SelectField
                label="Profil camera"
                value={model}
                options={MODELS.map((m) => ({ value: m, label: m }))}
                onChange={setModel}
              />
              <SelectField
                label="Pays"
                value={country}
                options={COUNTRIES}
                onChange={setCountry}
              />
            </div>
            <SelectField
              label="Langue"
              value={language}
              options={LANGUAGES.map((l) => ({ value: l, label: l }))}
              onChange={setLanguage}
            />
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">
                Date dans les {dateWindow} derniers jours
              </span>
              <input
                type="range"
                min={1}
                max={30}
                step={1}
                value={dateWindow}
                onChange={(e) => setDateWindow(Number(e.target.value))}
                className="w-full accent-primary"
              />
            </label>
          </div>
        )}
      </div>

      <div className="rounded-md border border-border bg-card p-4 text-sm">
        <div className="mb-2 font-medium">Récap</div>
        <ul className="space-y-1 text-muted-foreground">
          <li>• {videoCount} vidéo{videoCount > 1 ? "s" : ""} uploadée{videoCount > 1 ? "s" : ""}</li>
          {mode !== "per_video" && (
            <li>
              • {templateCount} template{templateCount > 1 ? "s" : ""} sélectionné
              {templateCount > 1 ? "s" : ""}
            </li>
          )}
          <li>• Mode : {modeLabel}</li>
          <li>
            •{" "}
            <span className="font-semibold text-foreground">
              {reelCount} reel{reelCount > 1 ? "s" : ""}
            </span>{" "}
            seront générés
          </li>
          {spoofEnabled && (
            <li>
              • Spoofing : {model} / {country} / {language}
            </li>
          )}
        </ul>
      </div>

      {overLimit && (
        <p className="text-sm text-destructive">
          Maximum 50 reels par batch — réduis le nombre de vidéos ou de templates.
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
