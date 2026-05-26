"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Eye, Image as ImageIcon, Redo2, Save, Undo2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Render } from "@/lib/api";
import { useEditorStore } from "@/store/editor";
import { useT } from "@/lib/i18n";
import { CoverPickerDialog } from "./cover-picker-dialog";
import { RenderPreviewDialog } from "./render-preview-dialog";

const MAX_TAGS = 20;

export function EditorTopbar() {
  const router = useRouter();
  const t = useT();
  const template = useEditorStore((s) => s.template);
  const clips = useEditorStore((s) => s.clips);
  const patchTemplate = useEditorStore((s) => s.patchTemplate);
  const setLanguage = useEditorStore((s) => s.setLanguage);
  const saveNow = useEditorStore((s) => s.saveNow);
  const saving = useEditorStore((s) => s.saving);
  const saveError = useEditorStore((s) => s.saveError);
  const past = useEditorStore((s) => s.past);
  const future = useEditorStore((s) => s.future);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const canUndo = past.length > 0;
  const canRedo = future.length > 0;

  const [renderOpen, setRenderOpen] = useState(false);
  const [renderLoading, setRenderLoading] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [renderUrl, setRenderUrl] = useState<string | null>(null);

  // Custom cover dialog: lets the user pick a frame from the preview MP4
  // at a chosen timestamp. The frame is ffmpeg-extracted server-side and
  // stored as the template's cover image.
  const [coverOpen, setCoverOpen] = useState(false);

  // Phase 36b — local input for the next tag the user is typing. Tags
  // themselves live on `template.tags` (persisted via patchTemplate).
  const [tagInput, setTagInput] = useState("");

  const currentTags = template?.tags ?? [];

  function commitTag() {
    const raw = tagInput.trim();
    if (!raw) {
      setTagInput("");
      return;
    }
    if (currentTags.length >= MAX_TAGS) return;
    // Case-insensitive dedupe — keep the existing capitalisation.
    const lower = raw.toLowerCase();
    const exists = currentTags.some(
      (existing) => existing.trim().toLowerCase() === lower,
    );
    if (exists) {
      setTagInput("");
      return;
    }
    patchTemplate({ tags: [...currentTags, raw] });
    setTagInput("");
  }

  function removeTag(idx: number) {
    const next = currentTags.filter((_, i) => i !== idx);
    patchTemplate({ tags: next });
  }

  useEffect(() => {
    return () => {
      if (renderUrl) URL.revokeObjectURL(renderUrl);
    };
  }, [renderUrl]);

  async function onRenderPreview() {
    if (!template) return;
    if (clips.length === 0) {
      setRenderError("Le template est vide. Ajoute au moins un clip.");
      setRenderOpen(true);
      return;
    }
    await saveNow();
    if (renderUrl) URL.revokeObjectURL(renderUrl);
    setRenderUrl(null);
    setRenderError(null);
    setRenderLoading(true);
    setRenderOpen(true);
    try {
      const blob = await Render.preview(template.id, []);
      setRenderUrl(URL.createObjectURL(blob));
    } catch (err) {
      setRenderError(err instanceof Error ? err.message : "Échec du rendu");
    } finally {
      setRenderLoading(false);
    }
  }

  if (!template) return null;

  return (
    <header className="flex h-[50px] shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-3">
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push("/templates")}
          aria-label="Retour"
          title="Retour aux templates"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={undo}
          disabled={!canUndo}
          aria-label="Annuler"
          title="Annuler (Ctrl+Z)"
        >
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={redo}
          disabled={!canRedo}
          aria-label="Rétablir"
          title="Rétablir (Ctrl+Shift+Z)"
        >
          <Redo2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex flex-1 items-center justify-center gap-3">
        <Input
          value={template.name}
          onChange={(e) => patchTemplate({ name: e.target.value })}
          className="h-8 max-w-xs text-sm"
          aria-label="Nom du template"
        />
        {/* Phase 36b — Sous-tags libres multiples (Captions, Transition…).
            L'user push un tag via Entrée / Tab / virgule. Dédupe
            case-insensitive, cap à 20 (re-validé backend). */}
        <div
          className="flex h-8 min-w-[18rem] max-w-[28rem] items-center gap-1 overflow-x-auto rounded-md border border-input bg-transparent px-2 text-sm"
          aria-label={t("editor.template.tags")}
          title={t("editor.template.tags")}
        >
          {currentTags.map((tag, idx) => (
            <span
              key={`${tag}-${idx}`}
              className="flex shrink-0 items-center gap-1 rounded-full bg-zinc-700 px-2 py-0.5 text-xs text-zinc-200"
            >
              {tag}
              <button
                type="button"
                onClick={() => removeTag(idx)}
                aria-label={`Remove ${tag}`}
                className="text-zinc-400 transition hover:text-zinc-100"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <input
            type="text"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "Tab" || e.key === ",") {
                e.preventDefault();
                commitTag();
              } else if (
                e.key === "Backspace" &&
                tagInput === "" &&
                currentTags.length > 0
              ) {
                // Convenience : empty input + backspace pops the last
                // tag, like every chip-input people are used to.
                e.preventDefault();
                removeTag(currentTags.length - 1);
              }
            }}
            onBlur={commitTag}
            placeholder={
              currentTags.length === 0
                ? t("editor.template.tags.placeholder")
                : ""
            }
            disabled={currentTags.length >= MAX_TAGS}
            className="min-w-[8rem] flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>
        {currentTags.length >= MAX_TAGS && (
          <span className="text-[10px] text-amber-400">
            {t("editor.template.tags.max")}
          </span>
        )}
        <button
          type="button"
          onClick={() => setLanguage(template.language === "FR" ? "US" : "FR")}
          className="rounded-md border border-border px-2 py-1 text-xs transition hover:bg-accent"
          title="Toggle langue"
        >
          {template.language === "FR" ? "🇫🇷 FR" : "🇺🇸 US"}
        </button>

        {/* Cover de la card /templates : pioche une frame de l'aperçu
            au timestamp choisi par l'user. */}
        <button
          type="button"
          onClick={() => setCoverOpen(true)}
          className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs transition hover:bg-accent"
          title={
            template.cover_ext
              ? `Changer la cover (actuelle : ${(template.cover_time_sec ?? 0).toFixed(2)}s)`
              : "Choisir une frame de l'aperçu comme cover de la card"
          }
        >
          <ImageIcon className="h-3 w-3" />
          {template.cover_ext ? "Cover ✓" : "Cover"}
        </button>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">
          {saveError ? (
            <span className="text-destructive">Erreur save</span>
          ) : saving ? (
            "Sauvegarde…"
          ) : (
            "Sauvegardé"
          )}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={onRenderPreview}
          disabled={renderLoading}
        >
          <Eye className="h-4 w-4" />
          {renderLoading ? "Rendu…" : "Aperçu rendu"}
        </Button>
        <Button size="sm" onClick={() => void saveNow()}>
          <Save className="h-4 w-4" />
          Save
        </Button>
      </div>

      <RenderPreviewDialog
        open={renderOpen}
        onOpenChange={(v) => {
          setRenderOpen(v);
          if (!v) setRenderError(null);
        }}
        blobUrl={renderUrl}
        loading={renderLoading}
        error={renderError}
      />

      <CoverPickerDialog
        open={coverOpen}
        onOpenChange={setCoverOpen}
        template={template}
        onChange={(next) => {
          patchTemplate({
            cover_ext: next.cover_ext,
            cover_time_sec: next.cover_time_sec,
          });
        }}
      />
    </header>
  );
}
