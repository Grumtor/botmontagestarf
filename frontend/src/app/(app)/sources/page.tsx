"use client";

import { useCallback, useEffect, useState } from "react";

import { Dropzone } from "@/components/library/dropzone";
import { SourceCard } from "@/components/library/source-card";
import { UploadList, type UploadItem } from "@/components/library/upload-list";
import { Sources, SourceSchema, type Source } from "@/lib/api";
import { uploadFile } from "@/lib/upload";

const ACCEPT = "video/mp4,video/quicktime,.mp4,.mov";
const ALLOWED_EXTS = [".mp4", ".mov"];

function hasAllowedExt(name: string): boolean {
  const lower = name.toLowerCase();
  return ALLOWED_EXTS.some((ext) => lower.endsWith(ext));
}

export default function SourcesPage() {
  const [items, setItems] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await Sources.list());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  function updateUpload(id: string, patch: Partial<UploadItem>) {
    setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u)));
  }

  async function handleFiles(files: File[]) {
    const accepted: { item: UploadItem; file: File }[] = [];
    for (const f of files) {
      if (!hasAllowedExt(f.name)) continue;
      accepted.push({
        file: f,
        item: { id: crypto.randomUUID(), name: f.name, progress: 0 },
      });
    }
    if (accepted.length === 0) {
      setError("Aucun fichier valide (formats autorisés : mp4, mov)");
      return;
    }
    setUploads((prev) => [...prev, ...accepted.map((a) => a.item)]);

    await Promise.all(
      accepted.map(async ({ item, file }) => {
        try {
          const created = await uploadFile(
            "/api/sources/upload",
            file,
            SourceSchema,
            (pct) => updateUpload(item.id, { progress: pct }),
          );
          setItems((prev) => [created, ...prev]);
          setUploads((prev) => prev.filter((u) => u.id !== item.id));
        } catch (err) {
          updateUpload(item.id, {
            error: err instanceof Error ? err.message : "Erreur",
          });
        }
      }),
    );
  }

  async function onDelete(id: number) {
    try {
      await Sources.delete(id);
      setItems((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur delete");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sources vidéo</h1>
        <p className="text-sm text-muted-foreground">
          Vidéos d&apos;origine pour tes montages.
        </p>
      </div>

      <Dropzone
        accept={ACCEPT}
        onFiles={handleFiles}
        hint="MP4, MOV — 500 MB max par fichier"
      />

      <UploadList items={uploads} />

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Aucune source — uploade un MP4 ou MOV.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {items.map((s) => (
            <SourceCard key={s.id} source={s} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  );
}
