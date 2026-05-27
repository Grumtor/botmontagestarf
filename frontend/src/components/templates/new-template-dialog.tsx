"use client";

import { FormEvent, useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { TagPickerMulti } from "@/components/templates/tag-picker-multi";
import type { TemplateCreateInput } from "@/lib/api";
import { useT } from "@/lib/i18n";

type Props = {
  onCreate: (data: TemplateCreateInput) => Promise<void>;
};

export function NewTemplateDialog({ onCreate }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setTags([]);
    setError(null);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Le nom est requis");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // Phase 37 — Langue plus exposée à l'UI. Backend a un default
      // "US" sur le champ Pydantic, donc on peut ne pas l'envoyer.
      await onCreate({ name: name.trim(), tags });
      setOpen(false);
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4" />
          {t("templates.new")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("templates.new")}</DialogTitle>
          <DialogDescription>
            Tu construiras le contenu (clips + overlays) ensuite dans l&apos;éditeur.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">{t("common.name")}</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Mon template"
              autoFocus
              required
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">{t("templates.new.tags")}</label>
            <TagPickerMulti selectedTags={tags} onChange={setTags} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Création…" : t("common.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
