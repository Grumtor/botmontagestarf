"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Rocket, Trash2, Upload, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  type PlaceholderClip,
  type Template,
} from "@/lib/api";
import { cn } from "@/lib/utils";

// ---- spoofing constants (same as old wizard) ------------------------

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

const ALLOWED_EXTS = [".mp4", ".mov"];

type Props = {
  template: Template | null;
  onClose: () => void;
};

type Pending = {
  id: string; // local-only
  name: string;
  progress: number;
  token: string | null;
  error: string | null;
};

function defaultJobName(tpl?: string): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return tpl ? `${tpl} · ${stamp}` : `Render ${stamp}`;
}

export function RunRenderDialog({ template, onClose }: Props) {
  const router = useRouter();

  // Parse placeholders in their timeline order.
  const placeholders = useMemo<PlaceholderClip[]>(() => {
    if (!template) return [];
    const out: PlaceholderClip[] = [];
    for (const item of template.clips ?? []) {
      const r = ClipSchema.safeParse(item);
      if (r.success && r.data.type === "placeholder") {
        out.push(r.data);
      }
    }
    return out;
  }, [template]);

  const [uploads, setUploads] = useState<Record<string, Pending[]>>({});
  const [jobName, setJobName] = useState("");
  const [spoofEnabled, setSpoofEnabled] = useState(false);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [country, setCountry] = useState("USA");
  const [language, setLanguage] = useState("en-US");
  const [dateWindow, setDateWindow] = useState(7);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state when template changes (open/close cycle).
  useEffect(() => {
    if (template) {
      setUploads({});
      setJobName(defaultJobName(template.name));
      setSpoofEnabled(false);
      setModel(DEFAULT_MODEL);
      setShowModelPicker(false);
      setCountry("USA");
      setLanguage("en-US");
      setDateWindow(7);
      setSubmitting(false);
      setError(null);
    }
  }, [template?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function onCountryChange(c: string) {
    setCountry(c);
    const fallback = COUNTRY_LANG[c];
    if (fallback) setLanguage(fallback);
  }

  function patchPending(
    placeholderId: string,
    pendingId: string,
    patch: Partial<Pending>,
  ) {
    setUploads((prev) => ({
      ...prev,
      [placeholderId]: (prev[placeholderId] ?? []).map((p) =>
        p.id === pendingId ? { ...p, ...patch } : p,
      ),
    }));
  }

  function removePending(placeholderId: string, pendingId: string) {
    setUploads((prev) => ({
      ...prev,
      [placeholderId]: (prev[placeholderId] ?? []).filter((p) => p.id !== pendingId),
    }));
  }

  async function onFiles(placeholderId: string, files: File[]) {
    const allowed = files.filter((f) =>
      ALLOWED_EXTS.some((e) => f.name.toLowerCase().endsWith(e)),
    );
    if (allowed.length === 0) return;
    const additions: Pending[] = allowed.map((f) => ({
      id: crypto.randomUUID(),
      name: f.name,
      progress: 0,
      token: null,
      error: null,
    }));
    setUploads((prev) => ({
      ...prev,
      [placeholderId]: [...(prev[placeholderId] ?? []), ...additions],
    }));

    await Promise.all(
      additions.map(async (p, i) => {
        try {
          const res = await Render.uploadUserVideo(allowed[i], (pct) => {
            patchPending(placeholderId, p.id, { progress: pct });
          });
          patchPending(placeholderId, p.id, { token: res.token, progress: 100 });
        } catch (err) {
          patchPending(placeholderId, p.id, {
            error: err instanceof Error ? err.message : "Erreur",
          });
        }
      }),
    );
  }

  // Drop counts and pairing logic
  const counts = placeholders.map((p) => uploads[p.id]?.length ?? 0);
  const validCounts = placeholders.map((p) =>
    (uploads[p.id] ?? []).filter((u) => u.token).length,
  );
  const allPlaceholdersHaveSomething =
    placeholders.length === 0 || counts.every((c) => c > 0);
  const allCountsEqual =
    placeholders.length === 0 ||
    counts.every((c) => c === counts[0]);
  const allUploaded =
    placeholders.length === 0 ||
    validCounts.every((c, i) => c === counts[i] && c > 0);
  const renderCount = placeholders.length === 0 ? 1 : counts[0] ?? 0;
  const overLimit = renderCount > 50;

  async function onLaunch() {
    if (!template) return;
    setSubmitting(true);
    setError(null);
    try {
      // Build assignments: one per output reel.
      const assignments: { template_id: number; fills: Record<string, string> }[] = [];
      if (placeholders.length === 0) {
        assignments.push({ template_id: template.id, fills: {} });
      } else {
        const N = renderCount;
        for (let i = 0; i < N; i++) {
          const fills: Record<string, string> = {};
          for (const p of placeholders) {
            const list = uploads[p.id] ?? [];
            const item = list[i];
            if (!item || !item.token) {
              throw new Error(
                `Placeholder #${placeholders.indexOf(p) + 1} : la vidéo ${i + 1} n'est pas uploadée.`,
              );
            }
            fills[p.id] = item.token;
          }
          assignments.push({ template_id: template.id, fills });
        }
      }

      const job = await Render.batch(jobName, assignments, {
        enabled: spoofEnabled,
        model,
        country,
        language,
        date_window_days: dateWindow,
      });
      onClose();
      router.push(`/jobs/${job.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={template !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            <span className="flex items-center gap-2">
              <Rocket className="h-4 w-4" />
              Lance un render — {template?.name}
            </span>
          </DialogTitle>
          <DialogDescription>
            {placeholders.length === 0
              ? "Ce template n'a pas de placeholder. Tu vas générer un seul reel."
              : `Drop des vidéos (.mp4/.mov) pour chaque placeholder. Le nombre par placeholder doit être identique — il définit le nombre de reels rendus.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <label className="flex flex-col gap-1.5 text-sm">
            <span>Nom du job</span>
            <Input
              value={jobName}
              onChange={(e) => setJobName(e.target.value)}
            />
          </label>

          {placeholders.map((p, idx) => (
            <PlaceholderSection
              key={p.id}
              index={idx}
              duration={p.duration_sec}
              pendings={uploads[p.id] ?? []}
              onFiles={(files) => onFiles(p.id, files)}
              onRemove={(id) => removePending(p.id, id)}
            />
          ))}

          <SpoofingPanel
            enabled={spoofEnabled}
            setEnabled={setSpoofEnabled}
            model={model}
            setModel={setModel}
            showModelPicker={showModelPicker}
            setShowModelPicker={setShowModelPicker}
            country={country}
            setCountry={onCountryChange}
            language={language}
            setLanguage={setLanguage}
            dateWindow={dateWindow}
            setDateWindow={setDateWindow}
          />

          <div className="rounded-md border border-border bg-card p-3 text-sm">
            <strong>Récap :</strong>{" "}
            {placeholders.length === 0
              ? "1 reel"
              : `${renderCount} reel${renderCount > 1 ? "s" : ""}`}
            {spoofEnabled && ` · spoofing ${model} / ${country}`}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {placeholders.length > 0 && !allCountsEqual && (
            <p className="text-xs text-yellow-400">
              ⚠ Drop le même nombre de vidéos pour chaque placeholder.
            </p>
          )}
          {overLimit && (
            <p className="text-xs text-destructive">
              Maximum 50 reels par batch — réduis le nombre de vidéos.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Annuler
          </Button>
          <Button
            onClick={onLaunch}
            disabled={
              submitting ||
              !allPlaceholdersHaveSomething ||
              !allCountsEqual ||
              !allUploaded ||
              overLimit
            }
          >
            <Rocket className="h-4 w-4" />
            {submitting
              ? "Envoi…"
              : placeholders.length === 0
                ? "Lancer 1 reel"
                : `Lancer ${renderCount} reel${renderCount > 1 ? "s" : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- placeholder section --------------------------------------------

function PlaceholderSection({
  index,
  duration,
  pendings,
  onFiles,
  onRemove,
}: {
  index: number;
  duration: number;
  pendings: Pending[];
  onFiles: (files: File[]) => void;
  onRemove: (id: string) => void;
}) {
  const [drag, setDrag] = useState(false);
  const inputId = `placeholder-${index}`;
  const validCount = pendings.filter((p) => p.token).length;

  return (
    <div className="space-y-2 rounded-md border border-yellow-500/40 bg-yellow-700/10 p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-yellow-200">
          📷 Placeholder #{index + 1}
          <span className="ml-2 text-xs text-muted-foreground">
            durée fixe {duration.toFixed(1)}s
          </span>
        </span>
        <span className="text-xs text-muted-foreground">
          {validCount}/{pendings.length} prêt{pendings.length > 1 ? "s" : ""}
        </span>
      </div>

      <label
        htmlFor={inputId}
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
          "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-border p-4 text-center text-xs transition",
          drag && "border-ring bg-accent/30",
        )}
      >
        <Upload className="h-5 w-5 text-muted-foreground" />
        <span>
          Drop des vidéos ou{" "}
          <span className="text-primary underline">parcours</span> (MP4 / MOV)
        </span>
        <input
          id={inputId}
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

      {pendings.length > 0 && (
        <div className="space-y-1">
          {pendings.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-2 rounded bg-card/80 p-1.5 text-xs"
            >
              <span className="flex-1 truncate" title={p.name}>
                {p.name}
              </span>
              {p.error ? (
                <span className="text-destructive">{p.error}</span>
              ) : p.token ? (
                <span className="text-emerald-400">✓ prêt</span>
              ) : (
                <Progress value={p.progress} className="w-24" />
              )}
              <button
                type="button"
                onClick={() => onRemove(p.id)}
                className="text-muted-foreground hover:text-destructive"
                title="Retirer"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- spoofing panel -------------------------------------------------

function SpoofingPanel({
  enabled,
  setEnabled,
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
}: {
  enabled: boolean;
  setEnabled: (b: boolean) => void;
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
}) {
  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setEnabled(!enabled)}
        className={cn(
          "flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm transition",
          enabled
            ? "border-primary bg-accent"
            : "border-border hover:bg-accent/50",
        )}
      >
        <span>Spoofer les métadonnées (iPhone)</span>
        <OnOffBadge enabled={enabled} />
      </button>

      {enabled && (
        <div className="space-y-3 rounded-md border border-border bg-card p-3">
          {/* Modèle iPhone — défaut iPhone 17, click "Changer" pour swap */}
          <div className="space-y-1.5">
            <div className="text-xs text-muted-foreground">
              Profil camera
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

/** Small green-on / red-off pill, used in the spoofing toggle row.
 *  Replaces the old plain "ON" / "OFF" muted text — the colour gives an
 *  at-a-glance signal that spoofing is engaged before launching a job. */
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
