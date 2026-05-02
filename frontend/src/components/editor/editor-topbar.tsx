"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Eye, Film, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEditorStore } from "@/store/editor";
import { Render } from "@/lib/api";
import { PreviewSourcePicker } from "./preview-source-picker";
import { RenderPreviewDialog } from "./render-preview-dialog";

export function EditorTopbar() {
  const router = useRouter();
  const template = useEditorStore((s) => s.template);
  const patchTemplate = useEditorStore((s) => s.patchTemplate);
  const setLanguage = useEditorStore((s) => s.setLanguage);
  const saveNow = useEditorStore((s) => s.saveNow);
  const saving = useEditorStore((s) => s.saving);
  const saveError = useEditorStore((s) => s.saveError);
  const previewSourceId = useEditorStore((s) => s.previewSourceId);
  const saveNowAction = saveNow;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [renderOpen, setRenderOpen] = useState(false);
  const [renderLoading, setRenderLoading] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [renderUrl, setRenderUrl] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (renderUrl) URL.revokeObjectURL(renderUrl);
    };
  }, [renderUrl]);

  async function onRenderPreview() {
    if (!template) return;
    if (previewSourceId === null) {
      setRenderError("Choisis une source de preview avant de rendre.");
      setRenderOpen(true);
      return;
    }
    // Flush pending edits so the render uses the freshest template state.
    await saveNowAction();
    if (renderUrl) URL.revokeObjectURL(renderUrl);
    setRenderUrl(null);
    setRenderError(null);
    setRenderLoading(true);
    setRenderOpen(true);
    try {
      const blob = await Render.preview(template.id, previewSourceId);
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
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push("/templates")}
          aria-label="Retour"
          title="Retour aux templates"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex flex-1 items-center justify-center gap-3">
        <Input
          value={template.name}
          onChange={(e) => patchTemplate({ name: e.target.value })}
          className="h-8 max-w-xs text-sm"
          aria-label="Nom du template"
        />
        <button
          type="button"
          onClick={() => setLanguage(template.language === "FR" ? "US" : "FR")}
          className="rounded-md border border-border px-2 py-1 text-xs transition hover:bg-accent"
          title="Toggle langue"
        >
          {template.language === "FR" ? "🇫🇷 FR" : "🇺🇸 US"}
        </button>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span>Durée</span>
          <Input
            type="number"
            min={1}
            max={90}
            step={0.5}
            value={template.duration_sec}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v >= 1) patchTemplate({ duration_sec: v });
            }}
            className="h-8 w-20 text-sm"
          />
          <span>s</span>
        </div>
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
          variant={previewSourceId ? "secondary" : "outline"}
          size="sm"
          onClick={() => setPickerOpen(true)}
        >
          <Film className="h-4 w-4" />
          {previewSourceId ? "Source choisie" : "Source de preview"}
        </Button>
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

      <PreviewSourcePicker open={pickerOpen} onOpenChange={setPickerOpen} />
      <RenderPreviewDialog
        open={renderOpen}
        onOpenChange={(v) => {
          setRenderOpen(v);
          if (!v) {
            setRenderError(null);
          }
        }}
        blobUrl={renderUrl}
        loading={renderLoading}
        error={renderError}
      />
    </header>
  );
}
