"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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
import {
  LanguageFilter,
  type LanguageFilterValue,
} from "@/components/templates/language-filter";
import { NewTemplateDialog } from "@/components/templates/new-template-dialog";
import { TemplateCard } from "@/components/templates/template-card";
import { Templates, type Template, type TemplateCreateInput } from "@/lib/api";
import { useRouter } from "next/navigation";

export default function TemplatesPage() {
  const router = useRouter();
  const [items, setItems] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [language, setLanguage] = useState<LanguageFilterValue>("ALL");
  const [search, setSearch] = useState("");
  const [pendingDelete, setPendingDelete] = useState<Template | null>(null);
  const [deleting, setDeleting] = useState(false);

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

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items.filter((t) => {
      if (language !== "ALL" && t.language !== language) return false;
      if (term && !t.name.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [items, language, search]);

  async function onCreate(data: TemplateCreateInput) {
    const created = await Templates.create(data);
    router.push(`/editor/${created.id}`);
  }

  async function onDuplicate(id: number) {
    try {
      const dup = await Templates.duplicate(id);
      setItems((prev) => [dup, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur duplicate");
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
          <h1 className="text-2xl font-semibold tracking-tight">Templates</h1>
          <p className="text-sm text-muted-foreground">Tes templates de montage.</p>
        </div>
        <NewTemplateDialog onCreate={onCreate} />
      </div>

      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <LanguageFilter value={language} onChange={setLanguage} />
        <Input
          type="search"
          placeholder="Rechercher par nom…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="sm:max-w-xs"
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {items.length === 0
            ? "Aucun template — clique sur « + New template »."
            : "Aucun template ne correspond aux filtres."}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {visible.map((t) => (
            <TemplateCard
              key={t.id}
              template={t}
              onDuplicate={onDuplicate}
              onDelete={(id) => setPendingDelete(items.find((x) => x.id === id) ?? null)}
            />
          ))}
        </div>
      )}

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(v) => !v && setPendingDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Supprimer le template ?</DialogTitle>
            <DialogDescription>
              {pendingDelete
                ? `« ${pendingDelete.name} » sera supprimé. Cette action est irréversible.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>
              Annuler
            </Button>
            <Button variant="destructive" onClick={onConfirmDelete} disabled={deleting}>
              {deleting ? "Suppression…" : "Supprimer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
