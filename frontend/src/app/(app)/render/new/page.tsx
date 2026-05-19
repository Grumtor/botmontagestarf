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
import { notifyUserRefresh, useCurrentUser } from "@/hooks/use-current-user";
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
  "iPhone 16 Pro",
  "iPhone 16 Pro Max",
  "iPhone 17",
  "iPhone 17 Pro",
  "iPhone 17 Pro Max",
];
const DEFAULT_MODEL = "iPhone 17";
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
  // Per-video → array of template ids. Each (video, template) pair = 1 reel,
  // so sélection multiple permet de croiser une vidéo avec plusieurs templates.
  const [perVideoTpl, setPerVideoTpl] = useState<Record<string, number[]>>({});

  // Step 3 — confirm
  const [jobName, setJobName] = useState(defaultJobName());
  const [spoofEnabled, setSpoofEnabled] = useState(false);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [country, setCountry] = useState("USA");
  const [language, setLanguage] = useState("en-US");
  const [dateWindow, setDateWindow] = useState(7);
  // Phase 29 — multiplicateur "Générations" + naming Apple-style.
  const [generations, setGenerations] = useState(1);
  const [iphoneNaming, setIphoneNaming] = useState(true);
  // Phase 29c — random reroll : nombre de passes random. Chaque pass
  // re-shuffle l'attribution vidéo↔template, donc mappings différents
  // entre les passes. N'apparaît qu'en mode "random". Max = nombre
  // de templates sélectionnés (au-delà, le shuffle se répète vainement).
  const [randomPasses, setRandomPasses] = useState(1);
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

  // Reels count (depends on mode). Phase 29 — multiplie par
  // `generations` (chaque generation = 1 copie supplémentaire de
  // chaque assignment avec metadata indépendante). Phase 29c — en
  // mode random, le multiplicateur effectif est `randomPasses`
  // (chaque pass = nouveau mapping vidéo→template, différent des
  // générations).
  const baseReelCount = useMemo(() => {
    const v = readyVideos.length;
    const t = selectedIds.size;
    if (v === 0 || (mode !== "per_video" && t === 0)) return 0;
    if (mode === "all") return v * t;
    if (mode === "random") return v;
    if (mode === "per_video") {
      // Sum of templates picked per video (each pair = 1 reel).
      return readyVideos.reduce(
        (acc, u) => acc + (perVideoTpl[u.id]?.length ?? 0),
        0,
      );
    }
    return 0;
  }, [readyVideos, selectedIds, mode, perVideoTpl]);
  // En mode random : multi-pass via randomPasses (mappings différents).
  // Autres modes : generations classique (metadata uniquement).
  const effectiveMultiplier = mode === "random" ? randomPasses : generations;
  const reelCount = baseReelCount * effectiveMultiplier;

  const overLimit = reelCount > 500;

  // Phase 33 — gating sur les crédits du user. 1 reel = 1 crédit.
  // Les admins ont des crédits "infinis" (10^9) donc le test passe
  // tout le temps. Le bouton "Lancer" est désactivé quand on a
  // moins de crédits que de reels demandés.
  const me = useCurrentUser();
  const creditsShortBy =
    me && me.role !== "admin"
      ? Math.max(0, reelCount - me.render_credits)
      : 0;
  const insufficientCredits = creditsShortBy > 0;

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
    gen_idx?: number;
  }[] {
    if (!allTemplates) return [];
    const tplById = new Map(allTemplates.map((t) => [t.id, t]));
    const out: {
      template_id: number;
      fills: Record<string, string>;
      gen_idx?: number;
    }[] = [];
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
      // Phase 29c — multi-pass random reroll. Pour chaque pass on
      // re-shuffle l'ordre des templates et on assigne chaque vidéo à
      // une template fresh. `gen_idx` est posé sur l'assignment pour
      // que le backend skip son propre multiplier et groupe les outputs
      // dans `Tirage N/` au ZIP.
      const passes = Math.max(1, randomPasses);
      for (let pass = 0; pass < passes; pass++) {
        const pool = [...tplIds].sort(() => Math.random() - 0.5);
        readyVideos.forEach((v, i) => {
          if (!v.token) return;
          const tpl = tplById.get(pool[i % pool.length]);
          if (!tpl) return;
          out.push({
            template_id: tpl.id,
            fills: fillFor(tpl, v.token),
            gen_idx: pass + 1,
          });
        });
      }
    } else {
      // per_video — chaque (vidéo, template) sélectionné = 1 reel.
      for (const v of readyVideos) {
        if (!v.token) continue;
        const tplIds = perVideoTpl[v.id] ?? [];
        for (const tplId of tplIds) {
          const tpl = tplById.get(tplId);
          if (!tpl) continue;
          out.push({ template_id: tpl.id, fills: fillFor(tpl, v.token) });
        }
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
      const job = await Render.batch(
        jobName,
        assignments,
        {
          enabled: spoofEnabled,
          model,
          country,
          language,
          date_window_days: dateWindow,
        },
        // Generations slider est inactif en mode random (frontend a déjà
        // multi-passed). Sinon legacy multiplier.
        mode === "random" ? 1 : generations,
        iphoneNaming ? "iphone" : "default",
        // Phase 29c — label des sous-dossiers ZIP. "Tirage N/" en mode
        // random (mappings différents par pass), "Generation N/" sinon
        // (metadata différentes pour mêmes assignments).
        mode === "random" ? "Tirage" : "Generation",
      );
      // Le backend a décrémenté les crédits → on notifie la sidebar pour
      // qu'elle re-fetch /api/auth/me et affiche le nouveau compteur.
      notifyUserRefresh();
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
        // Every uploaded video must have at least one template picked.
        return readyVideos.every(
          (v) => (perVideoTpl[v.id]?.length ?? 0) > 0,
        );
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
            showModelPicker={showModelPicker}
            setShowModelPicker={setShowModelPicker}
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
            generations={generations}
            setGenerations={setGenerations}
            randomPasses={randomPasses}
            setRandomPasses={setRandomPasses}
            iphoneNaming={iphoneNaming}
            setIphoneNaming={setIphoneNaming}
            videoCount={readyVideos.length}
            templateCount={selectedIds.size}
            mode={mode}
            baseReelCount={baseReelCount}
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
          <div className="flex flex-col items-end gap-1">
            {insufficientCredits && me && (
              <p className="text-[11px] text-destructive">
                ⚠ {creditsShortBy} crédit{creditsShortBy > 1 ? "s" : ""}{" "}
                manquant{creditsShortBy > 1 ? "s" : ""} ({me.render_credits}{" "}
                dispo, {reelCount} demandés). Demande à l&apos;admin.
              </p>
            )}
            <Button
              onClick={onLaunch}
              disabled={
                submitting ||
                reelCount === 0 ||
                overLimit ||
                insufficientCredits
              }
            >
              <Rocket className="h-4 w-4" />
              {submitting
                ? "Envoi…"
                : `Lancer ${reelCount} reel${reelCount > 1 ? "s" : ""}`}
            </Button>
          </div>
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
  perVideoTpl: Record<string, number[]>;
  setPerVideoTpl: React.Dispatch<
    React.SetStateAction<Record<string, number[]>>
  >;
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
            "Choisis un ou plusieurs templates par vidéo. 1 reel par paire (vidéo × template)."}
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
          subtitle="N templates par vidéo (manuel)"
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
                  <WizardTemplatePreview template={t} />
                  {selected && (
                    <div className="absolute right-1.5 top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
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

/**
 * Preview de template dans le wizard de render. Chaîne de fallback :
 *   1. Cover custom (si l'user a piqué une frame via Phase 24)
 *   2. Premier frame du preview MP4 (si l'user a déjà cliqué "Aperçu rendu")
 *   3. Auto-thumb extrait à l'upload du premier clip vidéo
 *   4. Rien (carré noir)
 *
 * Le `<video preload="metadata">` charge juste la metadata + la première
 * frame, donc c'est léger même avec 20 templates en grille.
 */
function WizardTemplatePreview({ template }: { template: Template }) {
  const [coverFailed, setCoverFailed] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [thumbFailed, setThumbFailed] = useState(false);

  const ts = new Date(template.updated_at).getTime();

  if (template.cover_ext && !coverFailed) {
    return (
      <img
        src={`/api/files/template_cover/${template.id}?t=${ts}`}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        onError={() => setCoverFailed(true)}
      />
    );
  }
  if (!previewFailed) {
    return (
      // eslint-disable-next-line jsx-a11y/media-has-caption
      <video
        src={`/api/files/template_preview/${template.id}?t=${ts}`}
        muted
        playsInline
        preload="metadata"
        className="absolute inset-0 h-full w-full object-cover"
        onError={() => setPreviewFailed(true)}
      />
    );
  }
  if (!thumbFailed) {
    return (
      <img
        src={`/api/files/template_thumb/${template.id}`}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        onError={() => setThumbFailed(true)}
      />
    );
  }
  return (
    <div className="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground">
      Pas d&apos;aperçu
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
  perVideoTpl: Record<string, number[]>;
  setPerVideoTpl: React.Dispatch<
    React.SetStateAction<Record<string, number[]>>
  >;
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

  const toggle = (videoId: string, tplId: number) => {
    setPerVideoTpl((prev) => {
      const cur = prev[videoId] ?? [];
      const next = cur.includes(tplId)
        ? cur.filter((x) => x !== tplId)
        : [...cur, tplId];
      return { ...prev, [videoId]: next };
    });
  };
  const setAll = (videoId: string) => {
    setPerVideoTpl((prev) => ({
      ...prev,
      [videoId]: allTemplates.map((t) => t.id),
    }));
  };
  const clearAll = (videoId: string) => {
    setPerVideoTpl((prev) => ({ ...prev, [videoId]: [] }));
  };

  return (
    <div className="space-y-3">
      {videos.map((v) => {
        const picked = perVideoTpl[v.id] ?? [];
        return (
          <div
            key={v.id}
            className="rounded-md border border-border bg-background/40 p-3 text-sm"
          >
            <div className="mb-2 flex items-center gap-3">
              <div className="flex-1 truncate">
                <div className="truncate font-medium">{v.name}</div>
                <div className="text-xs text-muted-foreground">
                  {formatBytes(v.size)} · {picked.length} template
                  {picked.length > 1 ? "s" : ""} sélectionné
                  {picked.length > 1 ? "s" : ""}
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setAll(v.id)}
                  className="rounded-md border border-border px-2 py-1 transition hover:bg-accent/50"
                >
                  Tout
                </button>
                <button
                  type="button"
                  onClick={() => clearAll(v.id)}
                  disabled={picked.length === 0}
                  className="rounded-md border border-border px-2 py-1 transition hover:bg-accent/50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Aucun
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {allTemplates.map((t) => {
                const on = picked.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggle(v.id, t.id)}
                    className={cn(
                      "rounded-md border px-2 py-1 text-xs transition",
                      on
                        ? "border-primary bg-primary/15 text-primary"
                        : "border-border bg-background/60 hover:border-ring",
                    )}
                  >
                    {t.name}{" "}
                    <span className="text-[10px] text-muted-foreground">
                      ({t.language})
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
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
  showModelPicker,
  setShowModelPicker,
  country,
  setCountry,
  language,
  setLanguage,
  dateWindow,
  setDateWindow,
  generations,
  setGenerations,
  randomPasses,
  setRandomPasses,
  iphoneNaming,
  setIphoneNaming,
  videoCount,
  templateCount,
  mode,
  baseReelCount,
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
  showModelPicker: boolean;
  setShowModelPicker: (b: boolean) => void;
  country: string;
  setCountry: (s: string) => void;
  language: string;
  setLanguage: (s: string) => void;
  dateWindow: number;
  setDateWindow: (n: number) => void;
  generations: number;
  setGenerations: (n: number) => void;
  randomPasses: number;
  setRandomPasses: (n: number) => void;
  iphoneNaming: boolean;
  setIphoneNaming: (b: boolean) => void;
  videoCount: number;
  templateCount: number;
  mode: WizardMode;
  baseReelCount: number;
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
          <OnOffBadge enabled={spoofEnabled} />
        </button>

        {spoofEnabled && (
          <div className="space-y-3 rounded-md border border-border bg-card p-3">
            {/* Modèle iPhone — défaut, "Changer" pour swap */}
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">Profil camera</div>
              <div className="flex items-center gap-2">
                <span className="rounded-md border border-border bg-background px-2.5 py-1 text-[11px]">
                  📱 {model}
                </span>
                <button
                  type="button"
                  onClick={() => setShowModelPicker(!showModelPicker)}
                  className="text-[11px] text-muted-foreground underline transition hover:text-foreground"
                >
                  {showModelPicker ? "Replier" : "Changer"}
                </button>
              </div>
              {showModelPicker && (
                <div className="flex flex-wrap gap-1.5 rounded-md border border-border bg-background/40 p-2">
                  {MODELS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        setModel(m);
                        setShowModelPicker(false);
                      }}
                      className={cn(
                        "rounded-md border px-2.5 py-1 text-[11px] transition",
                        m === model
                          ? "border-primary bg-accent"
                          : "border-border hover:bg-accent/50",
                      )}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <SelectField
                label="Pays"
                value={country}
                options={COUNTRIES}
                onChange={setCountry}
              />
              <SelectField
                label="Langue"
                value={language}
                options={LANGUAGES.map((l) => ({ value: l, label: l }))}
                onChange={setLanguage}
              />
            </div>

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

        {/* Phase 29 — Multiplicateur (Générations ou Random reroll) +
            naming Apple iPhone. En mode "random" on affiche un slider
            "Tirages random" qui re-shuffle l'attribution vidéo↔template
            à chaque pass (mappings différents). En mode "all" /
            "per-video" on affiche "Générations" qui duplique les mêmes
            assignments avec metadata différentes. Mutually exclusive. */}
        <div className="grid grid-cols-2 gap-3 rounded-md border border-border bg-card p-3">
          {mode === "random" ? (
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">
                Tirages random : <strong>{randomPasses}</strong>
                {randomPasses > 1 && (
                  <span className="ml-1 text-[10px] text-primary">
                    → {reelCount} reels (mappings différents)
                  </span>
                )}
              </span>
              <input
                type="range"
                min={1}
                max={Math.max(1, templateCount)}
                step={1}
                value={Math.min(randomPasses, Math.max(1, templateCount))}
                onChange={(e) =>
                  setRandomPasses(Number(e.target.value))
                }
                className="w-full accent-primary"
              />
              <span className="text-[10px] text-muted-foreground">
                Chaque tirage = nouveau shuffle vidéo↔template. Sortie en{" "}
                <code>Tirage N/</code> dans le ZIP. Max = nb templates
                sélectionnés ({templateCount}).
              </span>
            </label>
          ) : (
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">
                Nombre de générations : <strong>{generations}</strong>
                {generations > 1 && (
                  <span className="ml-1 text-[10px] text-primary">
                    → {reelCount} reels au total
                  </span>
                )}
              </span>
              <input
                type="range"
                min={1}
                max={10}
                step={1}
                value={generations}
                onChange={(e) => setGenerations(Number(e.target.value))}
                className="w-full accent-primary"
              />
              <span className="text-[10px] text-muted-foreground">
                {baseReelCount} base × {generations} = {reelCount} reel
                {reelCount > 1 ? "s" : ""}, chacun avec EXIF différentes.
              </span>
            </label>
          )}
          <button
            type="button"
            onClick={() => setIphoneNaming(!iphoneNaming)}
            className={cn(
              "flex flex-col items-start justify-center gap-0.5 rounded-md border px-3 py-2 text-xs transition",
              iphoneNaming
                ? "border-primary bg-accent"
                : "border-border bg-background hover:border-ring",
            )}
            title="Renomme les MP4 en IMG_xxxx.MOV (style iPhone)"
          >
            <span className="font-medium">
              {iphoneNaming ? "📱 Naming Apple iPhone" : "Naming par défaut"}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {iphoneNaming
                ? "IMG_xxxx.MOV, compteur continu"
                : "Garde {nom_template}_{i}.mp4"}
            </span>
          </button>
        </div>

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
          Maximum 500 reels par batch — réduis le nombre de vidéos, de
          templates ou de générations (ou lance en plusieurs batchs).
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

/** Green/red ON-OFF pill, replaces the muted "ON"/"OFF" text on the
 *  spoofing toggle. Same component as run-render-dialog. */
function OnOffBadge({ enabled }: { enabled: boolean }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1",
        enabled
          ? "bg-emerald-500/20 text-emerald-300 ring-emerald-500/40"
          : "bg-red-500/20 text-red-300 ring-red-500/40",
      )}
    >
      {enabled ? "ON" : "OFF"}
    </span>
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
