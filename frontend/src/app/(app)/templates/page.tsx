"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Pause, Volume2, VolumeX } from "lucide-react";

import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { NewTemplateDialog } from "@/components/templates/new-template-dialog";
import { RunRenderDialog } from "@/components/templates/run-render-dialog";
import { SampleVideoDialog } from "@/components/templates/sample-video-dialog";
import { TemplateCard } from "@/components/templates/template-card";
import { Templates, type Template, type TemplateCreateInput } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useT } from "@/lib/i18n";
import { useRouter } from "next/navigation";

export default function TemplatesPage() {
  const router = useRouter();
  const { toast } = useToast();
  const t = useT();
  const [items, setItems] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // Phase 36b — filtres multi-tags (logique AND). Set vide = pas de
  // filtre actif. Toggle = click sur un chip ; "Toutes" = clear.
  const [activeTags, setActiveTags] = useState<Set<string>>(() => new Set());
  const [pendingDelete, setPendingDelete] = useState<Template | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [runRenderTarget, setRunRenderTarget] = useState<Template | null>(null);

  // Shared video-player state across all template cards.
  // Only ONE preview plays at a time — when a card calls
  // `setCurrentlyPlayingId(template.id)`, the others react in their own
  // useEffect and pause their <video>. `globalVolume` is the default
  // volume applied to every card unless the card overrides locally.
  const [currentlyPlayingId, setCurrentlyPlayingId] = useState<number | null>(null);
  const [globalVolume, setGlobalVolume] = useState(0.5);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await Templates.list();
      setItems(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Phase 36b — tags distincts triés alpha. Calculée sur la liste
  // complète (pas la liste filtrée) pour que les chips ne
  // disparaissent pas en changeant de search.
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) {
      for (const tag of item.tags ?? []) {
        const trimmed = tag.trim();
        if (trimmed) set.add(trimmed);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items.filter((t) => {
      if (activeTags.size > 0) {
        // AND : un template passe seulement si TOUS les tags actifs
        // sont présents dans ses propres tags.
        const own = new Set((t.tags ?? []).map((x) => x.trim()));
        for (const required of activeTags) {
          if (!own.has(required)) return false;
        }
      }
      if (term && !t.name.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [items, search, activeTags]);

  function toggleTag(tag: string) {
    setActiveTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }

  async function onCreate(data: TemplateCreateInput) {
    try {
      const created = await Templates.create(data);
      router.push(`/editor/${created.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur création";
      // Backend returns 403 with a clear French message when the user's
      // template limit is reached. Surface it as a toast — same UX as
      // any other action error.
      toast({
        title: t("templates.delete.error.title"),
        description: msg,
      });
      // Re-throw so the dialog stays open and the user can adjust.
      throw err;
    }
  }

  async function onDuplicate(id: number) {
    try {
      const dup = await Templates.duplicate(id);
      setItems((prev) => [dup, ...prev]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur duplicate";
      // 403 if max_templates atteint — même UX que ci-dessus.
      toast({
        title: t("templates.duplicate.error.title"),
        description: msg,
      });
      setError(msg);
    }
  }

  async function onConfirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await Templates.delete(pendingDelete.id);
      setItems((prev) => prev.filter((t) => t.id !== pendingDelete.id));
      setPendingDelete(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur delete");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("templates.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("templates.subtitle_short")}</p>
        </div>
        <div className="flex items-center gap-2">
          <SampleVideoDialog />
          <NewTemplateDialog onCreate={onCreate} />
        </div>
      </div>

      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-end">
        <div className="flex items-center gap-3">
          {/* Pause globale — n'apparaît que quand un aperçu est en lecture.
              Évite de scroller jusqu'à la card pour la stopper, et de
              consommer des données inutilement quand on a oublié. */}
          {currentlyPlayingId !== null && (
            <button
              type="button"
              onClick={() => setCurrentlyPlayingId(null)}
              className="flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/15 px-2 py-1 text-xs font-medium text-primary transition hover:bg-primary/25"
              title={t("templates.pause_preview.title")}
            >
              <Pause className="h-3.5 w-3.5" />
              {t("templates.pause_preview")}
            </button>
          )}
          {/* Global volume slider — default for every card.
              Per-card sliders override on hover. */}
          <div
            className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1"
            title={t("templates.volume.global_title")}
          >
            <button
              type="button"
              onClick={() => setGlobalVolume(globalVolume > 0 ? 0 : 0.5)}
              className="text-muted-foreground transition hover:text-foreground"
              aria-label={globalVolume > 0 ? t("templates.volume.mute") : t("templates.volume.unmute")}
            >
              {globalVolume > 0 ? (
                <Volume2 className="h-3.5 w-3.5" />
              ) : (
                <VolumeX className="h-3.5 w-3.5" />
              )}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={globalVolume}
              onChange={(e) => setGlobalVolume(Number(e.target.value))}
              className="h-1 w-20 accent-primary"
            />
          </div>
          <Input
            type="search"
            placeholder={t("templates.search.placeholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="sm:max-w-xs"
          />
        </div>
      </div>

      {/* Phase 36b — barre de filtres multi-tags (logique AND). Cachée
          si 0 ou 1 tag distinct au total (inutile). "Toutes" = clear
          tous les filtres. */}
      {allTags.length >= 2 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">
            {t("templates.tags.filter_label")}
          </span>
          <button
            type="button"
            onClick={() => setActiveTags(new Set())}
            className={
              "rounded-md border px-2.5 py-1 transition " +
              (activeTags.size === 0
                ? "border-primary bg-accent"
                : "border-border hover:bg-accent/50")
            }
          >
            {t("templates.tags.all")}
          </button>
          {allTags.map((tag) => {
            const on = activeTags.has(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() => toggleTag(tag)}
                className={
                  "rounded-md border px-2.5 py-1 transition " +
                  (on
                    ? "border-primary bg-accent"
                    : "border-border hover:bg-accent/50")
                }
              >
                {tag}
              </button>
            );
          })}
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {items.length === 0
            ? t("templates.empty_short")
            : t("templates.empty_filtered")}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {visible.map((t) => (
            <TemplateCard
              key={t.id}
              template={t}
              onDuplicate={onDuplicate}
              onDelete={(id) => setPendingDelete(items.find((x) => x.id === id) ?? null)}
              onRunRender={(template) => setRunRenderTarget(template)}
              currentlyPlayingId={currentlyPlayingId}
              setCurrentlyPlayingId={setCurrentlyPlayingId}
              globalVolume={globalVolume}
            />
          ))}
        </div>
      )}

      <RunRenderDialog
        template={runRenderTarget}
        onClose={() => setRunRenderTarget(null)}
      />

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(v) => !v && setPendingDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("templates.delete_dialog.title")}</DialogTitle>
            <DialogDescription>
              {pendingDelete
                ? t("templates.delete_dialog.desc", { name: pendingDelete.name })
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={onConfirmDelete} disabled={deleting}>
              {deleting ? t("common.deleting") : t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
