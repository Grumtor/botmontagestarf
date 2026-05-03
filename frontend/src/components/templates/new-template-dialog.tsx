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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TemplateCreateInput, TemplateLanguage } from "@/lib/api";

type Props = {
  onCreate: (data: TemplateCreateInput) => Promise<void>;
};

export function NewTemplateDialog({ onCreate }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [language, setLanguage] = useState<TemplateLanguage>("US");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setLanguage("US");
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
      await onCreate({ name: name.trim(), language });
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
          New template
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouveau template</DialogTitle>
          <DialogDescription>
            Tu construiras le contenu (clips + overlays) ensuite dans l&apos;éditeur.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Nom</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Mon template"
              autoFocus
              required
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Langue</label>
            <Select
              value={language}
              onValueChange={(v) => setLanguage(v as TemplateLanguage)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="US">🇺🇸 US</SelectItem>
                <SelectItem value="FR">🇫🇷 FR</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Création…" : "Créer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
