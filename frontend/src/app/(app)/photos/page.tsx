"use client";

import { useState } from "react";
import { Camera, Download, Image as ImageIcon, Upload, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Photos, type PhotoSpoofProfile } from "@/lib/api";
import { cn } from "@/lib/utils";

// Same world as the video wizard.
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

const ALLOWED_EXTS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".heic",
  ".heif",
  ".tif",
  ".tiff",
  ".webp",
];
const MAX_FILES = 200;

type Pending = {
  id: string;
  file: File;
  previewUrl: string;
};

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

export default function PhotosPage() {
  const [files, setFiles] = useState<Pending[]>([]);
  const [selectedModels, setSelectedModels] = useState<Set<string>>(
    () => new Set([DEFAULT_MODEL]),
  );
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [country, setCountry] = useState("USA");
  const [language, setLanguage] = useState("en-US");
  const [dateWindow, setDateWindow] = useState(7);
  const [drag, setDrag] = useState(false);
  // Phase 29 — multiplicateur générations + naming Apple iPhone.
  const [generations, setGenerations] = useState(1);
  const [iphoneNaming, setIphoneNaming] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<
    { url: string; filename: string; spoofed: number; skipped: number } | null
  >(null);

  const totalOutputs = files.length * generations;

  function onCountryChange(c: string) {
    setCountry(c);
    const fb = COUNTRY_LANG[c];
    if (fb) setLanguage(fb);
  }

  function toggleModel(m: string) {
    setSelectedModels((prev) => {
      const next = new Set(prev);
      if (next.has(m)) {
        if (next.size > 1) next.delete(m); // never empty the set
      } else {
        next.add(m);
      }
      return next;
    });
  }

  function addFiles(incoming: File[]) {
    const allowed = incoming.filter((f) =>
      ALLOWED_EXTS.some((ext) => f.name.toLowerCase().endsWith(ext)),
    );
    if (allowed.length === 0) return;
    const slotsLeft = MAX_FILES - files.length;
    const take = allowed.slice(0, Math.max(0, slotsLeft));
    const newOnes: Pending[] = take.map((f) => ({
      id: crypto.randomUUID(),
      file: f,
      previewUrl: URL.createObjectURL(f),
    }));
    setFiles((prev) => [...prev, ...newOnes]);
  }

  function removeFile(id: string) {
    setFiles((prev) => {
      const removed = prev.find((p) => p.id === id);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  }

  function clearAll() {
    for (const p of files) URL.revokeObjectURL(p.previewUrl);
    setFiles([]);
    setResult(null);
    setError(null);
    setProgress(0);
  }

  async function onLaunch() {
    if (files.length === 0 || selectedModels.size === 0) return;
    setSubmitting(true);
    setError(null);
    setResult(null);
    setProgress(0);
    try {
      const profile: PhotoSpoofProfile = {
        models: Array.from(selectedModels),
        country,
        language,
        date_window_days: dateWindow,
        generations,
        naming: iphoneNaming ? "iphone" : "default",
      };
      const res = await Photos.spoof(
        files.map((p) => p.file),
        profile,
        (pct) => setProgress(pct),
      );
      const url = URL.createObjectURL(res.zipBlob);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const zipName = `photos_spoofed_${stamp}.zip`;
      setResult({
        url,
        filename: zipName,
        spoofed: res.spoofedCount,
        skipped: res.skippedCount,
      });
      const a = document.createElement("a");
      a.href = url;
      a.download = zipName;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Camera className="h-6 w-6" />
          Photos — spoofing métadonnées
        </h1>
        <p className="text-sm text-muted-foreground">
          Drop des photos, choisis un ou plusieurs modèles iPhone + un pays.
          Le ZIP contient les photos avec EXIF re-écrites (GPS, date, lens,
          ISO aléatoires).
        </p>
      </div>

      {/* Drop zone */}
      <label
        htmlFor="photo-upload"
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          addFiles(Array.from(e.dataTransfer.files ?? []));
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-10 text-center transition",
          drag && "border-ring bg-accent/30",
        )}
      >
        <Upload className="h-8 w-8 text-muted-foreground" />
        <div className="text-sm">
          Drop tes photos ici ou{" "}
          <span className="text-primary underline">parcours</span>
        </div>
        <div className="text-xs text-muted-foreground">
          JPG / PNG / HEIC / TIFF / WebP — jusqu&apos;à {MAX_FILES} fichiers
        </div>
        <input
          id="photo-upload"
          type="file"
          accept="image/*,.heic,.heif"
          multiple
          className="hidden"
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </label>

      {files.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {files.length} photo{files.length > 1 ? "s" : ""} prête
              {files.length > 1 ? "s" : ""}
            </span>
            <button
              type="button"
              onClick={clearAll}
              className="rounded-md border border-border px-2 py-1 transition hover:bg-accent/50"
            >
              Tout vider
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
            {files.map((p) => (
              <div
                key={p.id}
                className="group relative aspect-square overflow-hidden rounded-md border border-border bg-black"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.previewUrl}
                  alt={p.file.name}
                  className="absolute inset-0 h-full w-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <ImageIcon className="h-6 w-6 text-zinc-600 opacity-0 transition group-hover:opacity-30" />
                </div>
                <button
                  type="button"
                  onClick={() => removeFile(p.id)}
                  className="absolute right-1 top-1 rounded-full bg-black/70 p-1 opacity-0 transition group-hover:opacity-100 hover:bg-destructive"
                  aria-label="Retirer"
                >
                  <X className="h-3 w-3" />
                </button>
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-1.5 text-[10px] text-white">
                  <div className="truncate" title={p.file.name}>
                    {p.file.name}
                  </div>
                  <div className="text-zinc-300">{formatBytes(p.file.size)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Spoofing profile */}
      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        <div className="text-sm font-medium">Profil de spoofing</div>

        {/* Modèles iPhone — par défaut iPhone 17. Click "Changer" pour
            révéler le multi-select. */}
        <div className="space-y-1.5">
          <div className="text-xs text-muted-foreground">
            Modèle iPhone — aléatoire par photo
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-md border border-border bg-background px-2.5 py-1 text-[11px]">
              📱 {Array.from(selectedModels).join(", ")}
            </span>
            <button
              type="button"
              onClick={() => setShowModelPicker((v) => !v)}
              className="text-[11px] text-muted-foreground underline transition hover:text-foreground"
            >
              {showModelPicker ? "Replier" : "Changer"}
            </button>
          </div>
          {showModelPicker && (
            <div className="flex flex-wrap gap-1.5 rounded-md border border-border bg-background/40 p-2">
              {MODELS.map((m) => {
                const active = selectedModels.has(m);
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => toggleModel(m)}
                    className={cn(
                      "rounded-md border px-2.5 py-1 text-[11px] transition",
                      active
                        ? "border-primary bg-accent"
                        : "border-border hover:bg-accent/50",
                    )}
                  >
                    {m}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <SelectField
            label="Pays"
            value={country}
            options={COUNTRIES}
            onChange={onCountryChange}
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

        {/* Phase 29 — Multiplicateur générations + naming Apple iPhone */}
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">
              Nombre de générations : <strong>{generations}</strong>
              {generations > 1 && (
                <span className="ml-1 text-[10px] text-primary">
                  (× metadata indépendantes)
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
              x2 = chaque photo dupliquée avec EXIF différents (sous-dossiers
              Generation 1/2/…).
            </span>
          </label>
          <button
            type="button"
            onClick={() => setIphoneNaming((v) => !v)}
            className={cn(
              "flex flex-col items-start justify-center gap-0.5 rounded-md border px-3 py-2 text-xs transition",
              iphoneNaming
                ? "border-primary bg-accent"
                : "border-border bg-background hover:border-ring",
            )}
            title="Renomme tous les fichiers en IMG_xxxx.JPG (style iPhone)"
          >
            <span className="font-medium">
              {iphoneNaming ? "📱 Naming Apple iPhone" : "Naming par défaut"}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {iphoneNaming
                ? "IMG_xxxx.JPG, compteur continu"
                : "Garde les noms originaux"}
            </span>
          </button>
        </div>
      </div>

      {submitting && (
        <div className="space-y-1.5">
          <div className="text-xs text-muted-foreground">
            {progress < 100 ? `Upload ${progress}%…` : "Spoofing en cours…"}
          </div>
          <Progress value={progress} />
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {result && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-700/10 p-3 text-sm">
          <div className="font-medium text-emerald-300">
            ✓ ZIP téléchargé — {result.spoofed} photo
            {result.spoofed > 1 ? "s" : ""} spoofée
            {result.spoofed > 1 ? "s" : ""}
            {result.skipped > 0 && ` (${result.skipped} ignorée${result.skipped > 1 ? "s" : ""})`}
          </div>
          <Button asChild size="sm" variant="outline" className="mt-2">
            <a href={result.url} download={result.filename}>
              <Download className="h-3 w-3" />
              Re-télécharger le ZIP
            </a>
          </Button>
        </div>
      )}

      <div className="flex items-center justify-end">
        <Button
          onClick={onLaunch}
          disabled={
            submitting || files.length === 0 || selectedModels.size === 0
          }
        >
          <Camera className="h-4 w-4" />
          {submitting
            ? "Envoi…"
            : `Spoofer ${totalOutputs} photo${totalOutputs > 1 ? "s" : ""}`}
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
