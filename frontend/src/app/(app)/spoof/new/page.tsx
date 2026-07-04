"use client";

/**
 * Phase 38 — Spoof-only wizard.
 *
 * Petit wizard à 2 étapes qui permet d'appliquer le spoof iPhone à
 * une liste de vidéos sans passer par un template. Pas de timeline,
 * pas de rendu ffmpeg, juste de la réécriture metadata (et zip).
 *
 * Step 1 — Upload des vidéos (drag-drop), même endpoint que le
 *          wizard render (POST /api/render/upload). On garde le
 *          token retourné par le serveur.
 * Step 2 — Nom du batch + options spoof (country / iPhone model /
 *          language / date_window_days / naming). Cost display
 *          0.5 crédit par vidéo, warning si crédits insuffisants.
 *          Au click → POST /api/spoof/batch, redirect /jobs/{id}.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Sparkles,
  Upload,
  X,
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
import { Render, Spoof } from "@/lib/api";
import {
  COUNTRIES,
  COUNTRY_LANG,
  DEFAULT_MODEL,
  LANGUAGES,
  MODELS,
} from "@/lib/spoof-options";
import { notifyUserRefresh, useCurrentUser } from "@/hooks/use-current-user";
import { useToast } from "@/hooks/use-toast";
import { useT } from "@/lib/i18n";
import { cn, formatCredits } from "@/lib/utils";

// ===== types =========================================================

type Pending = {
  id: string;
  name: string;
  size: number;
  progress: number;
  token: string | null;
  error: string | null;
  // Phase 38b — when the upload is retried (network blip), this holds
  // the current attempt number (2 or 3). Affiché à côté de la barre
  // de progression pour informer l'user qu'on retente plutôt que
  // d'afficher un échec définitif tout de suite.
  retryAttempt?: number;
};

const ALLOWED_EXTS = [".mp4", ".mov"];

// ===== helpers =======================================================

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function defaultJobName(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `Spoof ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ===== page ==========================================================

export default function SpoofWizardPage() {
  const router = useRouter();
  const t = useT();
  const { toast } = useToast();
  const me = useCurrentUser();

  const [step, setStep] = useState<1 | 2>(1);

  // Step 1 — uploads
  const [uploads, setUploads] = useState<Pending[]>([]);

  // Step 2 — spoof options + launch
  const [jobName, setJobName] = useState(defaultJobName());
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [country, setCountry] = useState("USA");
  const [language, setLanguage] = useState("en-US");
  const [dateWindow, setDateWindow] = useState(7);
  const [iphoneNaming, setIphoneNaming] = useState(true);
  // Phase 40 — nombre de copies spoofées par vidéo (multi-comptes).
  const [copies, setCopies] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const readyVideos = uploads.filter((u) => u.token);
  const allVideosReady =
    uploads.length > 0 && readyVideos.length === uploads.length;

  // ===== cost (0.5 credit / video / copie) =========================

  const totalCost = readyVideos.length * copies * Spoof.COST_PER_VIDEO;
  const creditsShortBy =
    me && me.role !== "admin"
      ? Math.max(0, totalCost - me.render_credits)
      : 0;
  const insufficientCredits = creditsShortBy > 0;

  // ===== step 1 actions ===========================================

  function patchPending(id: string, patch: Partial<Pending>) {
    setUploads((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    );
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
          const res = await Render.uploadUserVideo(
            allowed[i],
            (pct) => {
              patchPending(p.id, { progress: pct });
            },
            (attempt) => {
              // Phase 38b — retry auto sur blip réseau (Cloudflare
              // Tunnel + lent réseau peut faire fail 1 upload sur 20).
              // 3 tentatives avec backoff exponentiel ; on affiche le
              // numéro de tentative à l'user pour qu'il sache qu'on
              // retente plutôt que de croire que c'est cassé.
              patchPending(p.id, { retryAttempt: attempt, progress: 0 });
            },
          );
          patchPending(p.id, {
            token: res.token,
            progress: 100,
            retryAttempt: undefined,
          });
        } catch (err) {
          patchPending(p.id, {
            error: err instanceof Error ? err.message : "Erreur",
            retryAttempt: undefined,
          });
        }
      }),
    );
  }

  // ===== launch ====================================================

  async function onLaunch() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const tokens = readyVideos
        .map((v) => v.token)
        .filter((tok): tok is string => Boolean(tok));
      if (tokens.length === 0) {
        throw new Error(t("spoof.empty_upload"));
      }
      const job = await Spoof.batch({
        name: jobName,
        tokens,
        metadata_profile: {
          enabled: true,
          model,
          country,
          language,
          date_window_days: dateWindow,
        },
        naming: iphoneNaming ? "iphone" : "default",
        generations: copies,
      });
      // Le backend a décrémenté les crédits → notifier la sidebar.
      notifyUserRefresh();
      toast({ title: t("toast.render.launched") });
      router.push(`/jobs/${job.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erreur";
      setSubmitError(message);
      toast({ title: t("toast.render.failed"), description: message });
    } finally {
      setSubmitting(false);
    }
  }

  // ===== validation per step =======================================

  const canGoNext = step === 1 ? allVideosReady : false;

  // ===== render ====================================================

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("spoof.title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("spoof.subtitle")}</p>
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
          <Step2Options
            jobName={jobName}
            setJobName={setJobName}
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
            iphoneNaming={iphoneNaming}
            setIphoneNaming={setIphoneNaming}
            copies={copies}
            setCopies={setCopies}
            videoCount={readyVideos.length}
            totalCost={totalCost}
            insufficientCredits={insufficientCredits}
            creditsShortBy={creditsShortBy}
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
            else setStep(1);
          }}
          disabled={submitting}
        >
          <ArrowLeft className="h-4 w-4" />
          {step === 1 ? t("common.cancel") : t("common.back")}
        </Button>

        {step === 1 ? (
          <Button onClick={() => setStep(2)} disabled={!canGoNext}>
            {t("common.next")}
            <ArrowRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            onClick={onLaunch}
            disabled={
              submitting || readyVideos.length === 0 || insufficientCredits
            }
          >
            <Sparkles className="h-4 w-4" />
            {submitting ? t("spoof.launching") : t("spoof.launch")}
          </Button>
        )}
      </div>
    </div>
  );
}

// ===== stepper =======================================================

function Stepper({ step }: { step: 1 | 2 }) {
  const t = useT();
  const items: { n: 1 | 2; label: string }[] = [
    { n: 1, label: t("spoof.step.upload") },
    { n: 2, label: t("spoof.step.options") },
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
//
// Adapté du Step1Upload du wizard render. Même comportement (drag-drop,
// progress bars, upload parallèle, suppression individuelle) mais
// strings via "spoof.*" / "render.wizard.upload.*" (réutilisation
// directe des labels FR/EN du wizard render — pas la peine de
// dupliquer).

function Step1Upload({
  uploads,
  onFiles,
  onRemove,
}: {
  uploads: Pending[];
  onFiles: (files: File[]) => void;
  onRemove: (id: string) => void;
}) {
  const t = useT();
  const [drag, setDrag] = useState(false);
  const ready = uploads.filter((u) => u.token).length;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">
          {t("render.wizard.upload.title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("render.wizard.upload.desc")}
        </p>
      </div>

      <label
        htmlFor="spoof-upload"
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
          {t("render.wizard.upload.drop")}{" "}
          <span className="text-primary underline">
            {t("render.wizard.upload.browse")}
          </span>
        </div>
        <div className="text-xs text-muted-foreground">
          {t("render.wizard.upload.formats")}
        </div>
        <input
          id="spoof-upload"
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
              {uploads.length > 1
                ? t("render.wizard.upload.ready_plural", {
                    ready,
                    total: uploads.length,
                  })
                : t("render.wizard.upload.ready", {
                    ready,
                    total: uploads.length,
                  })}
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
                  <span className="text-xs text-emerald-400">
                    {t("render.wizard.upload.video_ready")}
                  </span>
                ) : (
                  <div className="flex items-center gap-2">
                    {u.retryAttempt && (
                      <span className="text-xs text-amber-400">
                        {t("upload.retrying", { n: u.retryAttempt })}
                      </span>
                    )}
                    <Progress value={u.progress} className="w-32" />
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => onRemove(u.id)}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={t("common.remove")}
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

function Step2Options({
  jobName,
  setJobName,
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
  iphoneNaming,
  setIphoneNaming,
  copies,
  setCopies,
  videoCount,
  totalCost,
  insufficientCredits,
  creditsShortBy,
  error,
}: {
  jobName: string;
  setJobName: (s: string) => void;
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
  iphoneNaming: boolean;
  setIphoneNaming: (b: boolean) => void;
  copies: number;
  setCopies: (n: number) => void;
  videoCount: number;
  totalCost: number;
  insufficientCredits: boolean;
  creditsShortBy: number;
  error: string | null;
}) {
  const t = useT();

  return (
    <div className="space-y-5">
      <label className="flex flex-col gap-1.5 text-sm">
        <span>{t("spoof.batch_name")}</span>
        <Input value={jobName} onChange={(e) => setJobName(e.target.value)} />
      </label>

      <div className="space-y-3 rounded-md border border-border bg-card p-3">
        {/* Modèle iPhone — défaut, "Changer" pour swap */}
        <div className="space-y-1.5">
          <div className="text-xs text-muted-foreground">
            {t("render.spoof.camera_profile")}
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-md border border-border bg-background px-2.5 py-1 text-[11px]">
              📱 {model}
            </span>
            <button
              type="button"
              onClick={() => setShowModelPicker(!showModelPicker)}
              className="text-[11px] text-muted-foreground underline transition hover:text-foreground"
            >
              {showModelPicker ? t("common.collapse") : t("common.change")}
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
            label={t("render.spoof.country")}
            value={country}
            options={COUNTRIES}
            onChange={setCountry}
          />
          <SelectField
            label={t("render.spoof.language")}
            value={language}
            options={LANGUAGES.map((l) => ({ value: l, label: l }))}
            onChange={setLanguage}
          />
        </div>

        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">
            {t("render.spoof.date_window", { n: dateWindow })}
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

        {/* Phase 40 — copies par vidéo (multi-comptes). Chaque copie a
            une metadata iPhone re-randomisée → fingerprint différent. */}
        <div className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">
            {t("spoof.copies.label")}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCopies(Math.max(1, copies - 1))}
              disabled={copies <= 1}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-lg transition hover:bg-accent/50 disabled:opacity-40"
              aria-label="-"
            >
              −
            </button>
            <input
              type="number"
              min={1}
              max={20}
              value={copies}
              onChange={(e) => {
                const v = Math.round(Number(e.target.value));
                setCopies(Math.max(1, Math.min(20, Number.isFinite(v) ? v : 1)));
              }}
              className="h-8 w-16 rounded-md border border-border bg-background text-center"
            />
            <button
              type="button"
              onClick={() => setCopies(Math.min(20, copies + 1))}
              disabled={copies >= 20}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-lg transition hover:bg-accent/50 disabled:opacity-40"
              aria-label="+"
            >
              +
            </button>
            <span className="text-[10px] text-muted-foreground">
              {t("spoof.copies.hint")}
            </span>
          </div>
        </div>

        {/* Naming radio : "iphone" (IMG_xxxx.MOV) ou "default" (garde
            le nom source). Représenté comme un toggle deux options. */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setIphoneNaming(true)}
            className={cn(
              "flex flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-xs transition",
              iphoneNaming
                ? "border-primary bg-accent"
                : "border-border bg-background hover:border-ring",
            )}
          >
            <span className="font-medium">
              {t("render.wizard.naming.iphone_title")}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {t("render.wizard.naming.iphone.subtitle")}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setIphoneNaming(false)}
            className={cn(
              "flex flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-xs transition",
              !iphoneNaming
                ? "border-primary bg-accent"
                : "border-border bg-background hover:border-ring",
            )}
          >
            <span className="font-medium">
              {t("render.wizard.naming.default_title")}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {t("render.wizard.naming.default.subtitle", {
                tmpl: "{nom_source}.mp4",
              })}
            </span>
          </button>
        </div>
      </div>

      {/* Cost display */}
      <div className="rounded-md border border-border bg-card p-4 text-sm">
        <div className="font-medium">
          {copies > 1
            ? t("spoof.cost_copies", {
                n: videoCount,
                c: copies,
                total: formatCredits(totalCost),
              })
            : t("spoof.cost", {
                n: videoCount,
                total: formatCredits(totalCost),
              })}
        </div>
        {insufficientCredits && (
          <p className="mt-1 text-[11px] text-destructive">
            ⚠{" "}
            {t("spoof.insufficient_credits", {
              missing: formatCredits(creditsShortBy),
            })}
          </p>
        )}
      </div>

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
