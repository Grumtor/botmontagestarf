"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Eye, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Render } from "@/lib/api";
import { useEditorStore } from "@/store/editor";
import { RenderPreviewDialog } from "./render-preview-dialog";

export function EditorTopbar() {
  const router = useRouter();
  const template = useEditorStore((s) => s.template);
  const clips = useEditorStore((s) => s.clips);
  const patchTemplate = useEditorStore((s) => s.patchTemplate);
  const setLanguage = useEditorStore((s) => s.setLanguage);
  const saveNow = useEditorStore((s) => s.saveNow);
  const saving = useEditorStore((s) => s.saving);
  const saveError = useEditorStore((s) => s.saveError);

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
    </header>
  );
}
