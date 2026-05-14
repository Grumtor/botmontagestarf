"use client";

import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { VAs, type VA } from "@/lib/api";

export default function VAsPage() {
  const [list, setList] = useState<VA[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<VA | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const items = await VAs.list();
      setList(items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    }
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  async function handleDelete(va: VA) {
    if (!confirm(`Supprimer "${va.name}" ?`)) return;
    try {
      await VAs.delete(va.id);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    }
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Users className="h-6 w-6" />
            Virtual Assistants
          </h1>
          <p className="text-sm text-muted-foreground">
            Gère tes VA et leur nombre de comptes. Réutilisable pour
            structurer les exports photo et vidéo.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" />
          Nouveau VA
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : list.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          Aucun VA pour l&apos;instant. Crée-en un pour structurer tes batches.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((va) => (
            <VACard
              key={va.id}
              va={va}
              onEdit={() => setEditing(va)}
              onDelete={() => handleDelete(va)}
            />
          ))}
        </div>
      )}

      {(creating || editing) && (
        <VADialog
          va={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            refresh();
          }}
          onError={setError}
        />
      )}
    </div>
  );
}

function VACard({
  va,
  onEdit,
  onDelete,
}: {
  va: VA;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 transition hover:border-ring">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{va.name}</div>
          <div className="text-xs text-muted-foreground">
            {va.account_count} compte{va.account_count > 1 ? "s" : ""}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={onEdit}
            className="rounded p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
            title="Éditer"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded p-1.5 text-muted-foreground transition hover:bg-destructive/20 hover:text-destructive"
            title="Supprimer"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function VADialog({
  va,
  onClose,
  onSaved,
  onError,
}: {
  va: VA | null;
  onClose: () => void;
  onSaved: () => void;
  onError: (err: string | null) => void;
}) {
  const [name, setName] = useState(va?.name ?? "");
  const [accountCount, setAccountCount] = useState(va?.account_count ?? 1);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!name.trim()) return;
    setSubmitting(true);
    onError(null);
    try {
      if (va) {
        await VAs.update(va.id, { name: name.trim(), account_count: accountCount });
      } else {
        await VAs.create({ name: name.trim(), account_count: accountCount });
      }
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{va ? "Éditer le VA" : "Nouveau VA"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <label className="flex flex-col gap-1.5 text-sm">
            <span>Nom du VA</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="VA 1"
              autoFocus
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span>Nombre de comptes</span>
            <Input
              type="number"
              min={1}
              max={500}
              value={accountCount}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n >= 1) setAccountCount(n);
              }}
            />
            <span className="text-[11px] text-muted-foreground">
              Les comptes sont nommés automatiquement « Compte 1 », « Compte 2 », …
            </span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Annuler
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || !name.trim() || accountCount < 1}
          >
            {submitting ? "Sauvegarde…" : va ? "Sauvegarder" : "Créer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
