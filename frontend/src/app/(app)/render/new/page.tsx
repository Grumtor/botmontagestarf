"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";

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
import { Dropzone } from "@/components/library/dropzone";
import { UploadList, type UploadItem } from "@/components/library/upload-list";
import {
  Render,
  Sources,
  SourceSchema,
  Templates,
  type BatchAssignment,
  type Source,
  type Template,
  type TemplateLanguage,
} from "@/lib/api";
import { uploadFile } from "@/lib/upload";
import { cn } from "@/lib/utils";
import { useWizardStore } from "@/store/render-wizard";

const ACCEPT = "video/mp4,video/quicktime,.mp4,.mov";

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

export default function NewRenderPage() {
  const step = useWizardStore((s) => s.step);
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">New render</h1>
          <p className="text-sm text-muted-foreground">Étape {step} / 4</p>
        </div>
        <Stepper current={step} />
      </div>
      {step === 1 && <Step1 />}
      {step === 2 && <Step2 />}
      {step === 3 && <Step3 />}
      {step === 4 && <Step4 />}
    </div>
  );
}

function Stepper({ current }: { current: number }) {
  const items = ["Sources", "Upload", "Templates", "Lancement"];
  return (
    <div className="flex items-center gap-2 text-xs">
      {items.map((label, i) => {
        const idx = i + 1;
        const done = idx < current;
        const active = idx === current;
        return (
          <div key={label} className="flex items-center gap-2">
            <div
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full border text-[10px]",
                done && "bg-primary text-primary-foreground border-primary",
                active && "border-primary text-foreground",
                !done && !active && "border-border text-muted-foreground",
              )}
            >
              {done ? <Check className="h-3 w-3" /> : idx}
            </div>
            <span className={cn(active ? "text-foreground" : "text-muted-foreground")}>
              {label}
            </span>
            {idx < items.length && <span className="text-muted-foreground">›</span>}
          </div>
        );
      })}
    </div>
  );
}

// ============================ Step 1 =================================

function Step1() {
  const setStep = useWizardStore((s) => s.setStep);
  const selected = useWizardStore((s) => s.selectedSourceIds);
  const toggle = useWizardStore((s) => s.toggleSource);
  const pending = useWizardStore((s) => s.pendingFiles);
  const setPending = useWizardStore((s) => s.setPendingFiles);

  const [items, setItems] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Sources.list()
      .then(setItems)
      .finally(() => setLoading(false));
  }, []);

  function onFiles(files: File[]) {
    const allowed = files.filter((f) =>
      [".mp4", ".mov"].some((e) => f.name.toLowerCase().endsWith(e)),
    );
    setPending([...pending, ...allowed]);
  }

  const totalSelection = selected.length + pending.length;

  return (
    <div className="space-y-6">
      <Dropzone accept={ACCEPT} onFiles={onFiles} hint="MP4, MOV — 500 MB max" />

      {pending.length > 0 && (
        <div className="rounded-md border border-border bg-card p-3 text-xs">
          <div className="font-medium">À uploader ({pending.length})</div>
          <ul className="mt-1 space-y-0.5">
            {pending.map((f, i) => (
              <li key={i} className="truncate text-muted-foreground">
                {f.name}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h2 className="mb-2 text-sm font-medium">Sources existantes</h2>
        {loading ? (
          <p className="text-sm text-muted-foreground">Chargement…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune source.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {items.map((s) => {
              const isSelected = selected.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggle(s.id)}
                  className={cn(
                    "group relative flex flex-col overflow-hidden rounded-lg border-2 bg-card text-left transition",
                    isSelected ? "border-primary" : "border-border hover:border-ring",
                  )}
                >
                  <div className="relative aspect-[9/16] w-full bg-black">
                    {s.thumbnail_path && (
                      <img
                        src={`/api/files/source_thumb/${s.id}`}
                        alt=""
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                    )}
                    {isSelected && (
                      <div className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <Check className="h-3 w-3" />
                      </div>
                    )}
                  </div>
                  <div className="truncate p-2 text-xs">{s.original_filename}</div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-border pt-4">
        <p className="text-sm text-muted-foreground">
          {totalSelection} vidéo{totalSelection > 1 ? "s" : ""} sélectionnée{totalSelection > 1 ? "s" : ""}
        </p>
        <Button
          disabled={totalSelection === 0}
          onClick={() => setStep(pending.length > 0 ? 2 : 3)}
        >
          Suivant →
        </Button>
      </div>
    </div>
  );
}

// ============================ Step 2 =================================

function Step2() {
  const setStep = useWizardStore((s) => s.setStep);
  const pending = useWizardStore((s) => s.pendingFiles);
  const setPending = useWizardStore((s) => s.setPendingFiles);
  const appendUploaded = useWizardStore((s) => s.appendUploadedSourceId);

  const [uploads, setUploads] = useState<UploadItem[]>(() =>
    pending.map((f) => ({ id: crypto.randomUUID(), name: f.name, progress: 0 })),
  );
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    let cancelled = false;
    (async () => {
      for (let i = 0; i < pending.length; i++) {
        const file = pending[i];
        const itemId = uploads[i]?.id ?? crypto.randomUUID();
        try {
          const created = await uploadFile(
            "/api/sources/upload",
            file,
            SourceSchema,
            (pct) => {
              if (cancelled) return;
              setUploads((prev) =>
                prev.map((u) => (u.id === itemId ? { ...u, progress: pct } : u)),
              );
            },
          );
          if (cancelled) return;
          appendUploaded(created.id);
          setUploads((prev) => prev.filter((u) => u.id !== itemId));
        } catch (err) {
          if (cancelled) return;
          setUploads((prev) =>
            prev.map((u) =>
              u.id === itemId
                ? {
                    ...u,
                    error: err instanceof Error ? err.message : "Erreur",
                  }
                : u,
            ),
          );
        }
      }
      if (!cancelled) {
        setPending([]);
        setStep(3);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Upload des nouvelles sources… L&apos;étape suivante démarre automatiquement.
      </p>
      <UploadList items={uploads} />
    </div>
  );
}

// ============================ Step 3 =================================

function Step3() {
  const setStep = useWizardStore((s) => s.setStep);
  const selected = useWizardStore((s) => s.selectedSourceIds);
  const lang = useWizardStore((s) => s.languageFilter);
  const setLang = useWizardStore((s) => s.setLanguageFilter);
  const mode = useWizardStore((s) => s.mode);
  const setMode = useWizardStore((s) => s.setMode);
  const k = useWizardStore((s) => s.randomMixK);
  const setK = useWizardStore((s) => s.setRandomMixK);
  const matrix = useWizardStore((s) => s.perVideoMatrix);
  const togglePerVideo = useWizardStore((s) => s.togglePerVideo);

  const [templates, setTemplates] = useState<Template[]>([]);
  const [sources, setSources] = useState<Source[]>([]);

  useEffect(() => {
    Templates.list().then(setTemplates);
    Sources.list().then(setSources);
  }, []);

  const filteredTemplates = useMemo(() => {
    if (lang === "ALL") return templates;
    return templates.filter((t) => t.language === lang);
  }, [templates, lang]);

  const selectedSources = useMemo(
    () => sources.filter((s) => selected.includes(s.id)),
    [sources, selected],
  );

  // recap
  let totalRenders = 0;
  if (mode === "select_all") {
    totalRenders = selectedSources.length * filteredTemplates.length;
  } else if (mode === "random_mix") {
    totalRenders = selectedSources.length * Math.max(1, k);
  } else {
    totalRenders = selectedSources.reduce(
      (acc, s) =>
        acc +
        (matrix[s.id] ?? []).filter((tid) =>
          filteredTemplates.some((t) => t.id === tid),
        ).length,
      0,
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-muted-foreground">Langue :</span>
        {(["ALL", "FR", "US"] as const).map((l) => (
          <button
            key={l}
            onClick={() => setLang(l)}
            className={cn(
              "rounded-md border px-3 py-1 text-xs transition",
              lang === l ? "border-primary bg-accent" : "border-border hover:bg-accent/50",
            )}
          >
            {l === "ALL" ? "Toutes" : l === "FR" ? "🇫🇷 FR" : "🇺🇸 US"}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        <span className="text-xs text-muted-foreground">Mode d&apos;assignement :</span>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <ModeCard
            active={mode === "select_all"}
            onClick={() => setMode("select_all")}
            title="Select All"
            desc="Tous les templates filtrés × toutes les vidéos"
          />
          <ModeCard
            active={mode === "random_mix"}
            onClick={() => setMode("random_mix")}
            title="Random Mix"
            desc="K templates aléatoires par vidéo"
          />
          <ModeCard
            active={mode === "per_video"}
            onClick={() => setMode("per_video")}
            title="Per Video"
            desc="Matrice manuelle"
          />
        </div>
      </div>

      {mode === "random_mix" && (
        <label className="flex items-center gap-3 text-sm">
          <span>Templates aléatoires par vidéo :</span>
          <Input
            type="number"
            min={1}
            max={Math.max(1, filteredTemplates.length)}
            value={k}
            onChange={(e) => setK(Math.max(1, Number(e.target.value) || 1))}
            className="h-8 w-20"
          />
        </label>
      )}

      {mode === "per_video" && (
        <PerVideoMatrix
          sources={selectedSources}
          templates={filteredTemplates}
          matrix={matrix}
          onToggle={togglePerVideo}
        />
      )}

      <div className="rounded-md border border-border bg-card p-3 text-sm">
        <strong>Récap :</strong>{" "}
        {mode === "select_all" &&
          `${selectedSources.length} × ${filteredTemplates.length} = ${totalRenders} rendus`}
        {mode === "random_mix" &&
          `${selectedSources.length} × ${k} = ${totalRenders} rendus`}
        {mode === "per_video" && `${totalRenders} rendus`}
      </div>

      <div className="flex justify-between border-t border-border pt-4">
        <Button variant="ghost" onClick={() => setStep(1)}>
          ← Retour
        </Button>
        <Button disabled={totalRenders === 0 || totalRenders > 50} onClick={() => setStep(4)}>
          Suivant →
        </Button>
      </div>
      {totalRenders > 50 && (
        <p className="text-right text-xs text-destructive">
          Maximum 50 rendus par batch — ajuste tes filtres.
        </p>
      )}
    </div>
  );
}

function ModeCard({
  active,
  onClick,
  title,
  desc,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md border-2 bg-card p-3 text-left transition",
        active ? "border-primary" : "border-border hover:border-ring",
      )}
    >
      <div className="text-sm font-medium">{title}</div>
      <div className="text-xs text-muted-foreground">{desc}</div>
    </button>
  );
}

function PerVideoMatrix({
  sources,
  templates,
  matrix,
  onToggle,
}: {
  sources: Source[];
  templates: Template[];
  matrix: Record<number, number[]>;
  onToggle: (sourceId: number, templateId: number) => void;
}) {
  if (sources.length === 0 || templates.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Aucune intersection (vérifie tes sources sélectionnées et les templates filtrés).
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-xs">
        <thead className="bg-card">
          <tr>
            <th className="border-b border-border p-2 text-left">Vidéo</th>
            {templates.map((t) => (
              <th
                key={t.id}
                className="border-b border-border p-2 text-center font-normal"
                title={t.name}
              >
                <div className="max-w-[100px] truncate">{t.name}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sources.map((s) => (
            <tr key={s.id} className="border-b border-border">
              <td className="p-2 truncate" title={s.original_filename}>
                {s.original_filename}
              </td>
              {templates.map((t) => {
                const checked = (matrix[s.id] ?? []).includes(t.id);
                return (
                  <td key={t.id} className="p-2 text-center">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggle(s.id, t.id)}
                      className="h-4 w-4 accent-primary"
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================ Step 4 =================================

function Step4() {
  const router = useRouter();
  const setStep = useWizardStore((s) => s.setStep);
  const selected = useWizardStore((s) => s.selectedSourceIds);
  const lang = useWizardStore((s) => s.languageFilter);
  const mode = useWizardStore((s) => s.mode);
  const k = useWizardStore((s) => s.randomMixK);
  const matrix = useWizardStore((s) => s.perVideoMatrix);
  const jobName = useWizardStore((s) => s.jobName);
  const setJobName = useWizardStore((s) => s.setJobName);
  const metaEnabled = useWizardStore((s) => s.metadataEnabled);
  const setMetaEnabled = useWizardStore((s) => s.setMetadataEnabled);
  const metaModel = useWizardStore((s) => s.metadataModel);
  const setMetaModel = useWizardStore((s) => s.setMetadataModel);
  const metaCountry = useWizardStore((s) => s.metadataCountry);
  const setMetaCountry = useWizardStore((s) => s.setMetadataCountry);
  const metaLang = useWizardStore((s) => s.metadataLanguage);
  const setMetaLang = useWizardStore((s) => s.setMetadataLanguage);
  const metaWindow = useWizardStore((s) => s.metadataDateWindow);
  const setMetaWindow = useWizardStore((s) => s.setMetadataDateWindow);
  const reset = useWizardStore((s) => s.reset);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onCountryChange = useCallback(
    (c: string) => {
      setMetaCountry(c);
      const fallback = COUNTRY_LANG[c];
      if (fallback) setMetaLang(fallback);
    },
    [setMetaCountry, setMetaLang],
  );

  async function onLaunch() {
    setSubmitting(true);
    setError(null);
    try {
      const templates = await Templates.list();
      const filtered =
        lang === "ALL"
          ? templates
          : templates.filter((t) => t.language === (lang as TemplateLanguage));

      const assignments: BatchAssignment[] = [];
      if (mode === "select_all") {
        for (const sid of selected) {
          for (const t of filtered) {
            assignments.push({ source_id: sid, template_id: t.id });
          }
        }
      } else if (mode === "random_mix") {
        const pool = filtered.map((t) => t.id);
        for (const sid of selected) {
          const picks = pickRandom(pool, k);
          for (const tid of picks) {
            assignments.push({ source_id: sid, template_id: tid });
          }
        }
      } else {
        for (const sid of selected) {
          const tids = (matrix[sid] ?? []).filter((tid) =>
            filtered.some((t) => t.id === tid),
          );
          for (const tid of tids) {
            assignments.push({ source_id: sid, template_id: tid });
          }
        }
      }

      if (assignments.length === 0) {
        setError("Aucun rendu à lancer.");
        setSubmitting(false);
        return;
      }

      const job = await Render.batch(jobName, assignments, {
        enabled: metaEnabled,
        model: metaModel,
        country: metaCountry,
        language: metaLang,
        date_window_days: metaWindow,
      });
      reset();
      router.push(`/jobs/${job.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <label className="flex flex-col gap-2 text-sm">
        <span>Nom du job</span>
        <Input value={jobName} onChange={(e) => setJobName(e.target.value)} />
      </label>

      <button
        type="button"
        onClick={() => setMetaEnabled(!metaEnabled)}
        className={cn(
          "flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm transition",
          metaEnabled ? "border-primary bg-accent" : "border-border hover:bg-accent/50",
        )}
      >
        <span>Spoofer les métadonnées</span>
        <span className="text-muted-foreground">{metaEnabled ? "ON" : "OFF"}</span>
      </button>

      {metaEnabled && (
        <div className="space-y-4 rounded-md border border-border bg-card p-4">
          <div className="text-xs text-muted-foreground">
            <strong>Méthode :</strong> QuickTime branding + binary patch + randomized metadata
          </div>

          <SelectField
            label="Profil camera"
            value={metaModel}
            options={MODELS.map((m) => ({ value: m, label: m }))}
            onChange={setMetaModel}
          />
          <SelectField
            label="Pays"
            value={metaCountry}
            options={COUNTRIES}
            onChange={onCountryChange}
          />
          <SelectField
            label="Langue"
            value={metaLang}
            options={LANGUAGES.map((l) => ({ value: l, label: l }))}
            onChange={setMetaLang}
          />

          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">
              Date dans les {metaWindow} derniers jours
            </span>
            <input
              type="range"
              min={1}
              max={30}
              step={1}
              value={metaWindow}
              onChange={(e) => setMetaWindow(Number(e.target.value))}
              className="w-full accent-primary"
            />
          </label>
        </div>
      )}

      <div className="rounded-md border border-border bg-card p-3 text-sm">
        <strong>Récap :</strong> {selected.length} source(s) ·{" "}
        {mode === "select_all"
          ? "Select All"
          : mode === "random_mix"
            ? `Random Mix K=${k}`
            : "Per Video"}{" "}
        · spoofing {metaEnabled ? `ON (${metaModel}, ${metaCountry})` : "OFF"}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-between border-t border-border pt-4">
        <Button variant="ghost" onClick={() => setStep(3)} disabled={submitting}>
          ← Retour
        </Button>
        <Button onClick={onLaunch} disabled={submitting}>
          {submitting ? "Envoi…" : "Lancer le batch"}
        </Button>
      </div>
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

function pickRandom<T>(arr: T[], k: number): T[] {
  if (arr.length === 0) return [];
  const picks: T[] = [];
  for (let i = 0; i < k; i++) {
    picks.push(arr[Math.floor(Math.random() * arr.length)]);
  }
  return picks;
}
