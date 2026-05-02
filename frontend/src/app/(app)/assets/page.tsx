"use client";

import { useCallback, useEffect, useState } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dropzone } from "@/components/library/dropzone";
import { UploadList, type UploadItem } from "@/components/library/upload-list";
import {
  AudioAssetCard,
  FontAssetCard,
  GifAssetCard,
  ImageAssetCard,
} from "@/components/library/asset-cards";
import { Assets, AssetSchema, type Asset, type AssetType } from "@/lib/api";
import { uploadFile } from "@/lib/upload";

type TabConfig = {
  type: AssetType;
  label: string;
  accept: string;
  exts: string[];
  hint: string;
};

const TABS: TabConfig[] = [
  {
    type: "image",
    label: "Images",
    accept: "image/png,image/jpeg,.png,.jpg,.jpeg",
    exts: [".png", ".jpg", ".jpeg"],
    hint: "PNG, JPG",
  },
  {
    type: "gif",
    label: "GIFs",
    accept: "image/gif,.gif",
    exts: [".gif"],
    hint: "GIF",
  },
  {
    type: "emoji",
    label: "Emojis",
    accept: "image/png,image/jpeg,.png,.jpg,.jpeg",
    exts: [".png", ".jpg", ".jpeg"],
    hint: "PNG, JPG",
  },
  {
    type: "font",
    label: "Polices",
    accept: ".ttf,.otf,font/ttf,font/otf",
    exts: [".ttf", ".otf"],
    hint: "TTF, OTF",
  },
  {
    type: "audio",
    label: "Audio",
    accept: "audio/mpeg,audio/wav,audio/mp4,audio/x-m4a,.mp3,.wav,.m4a",
    exts: [".mp3", ".wav", ".m4a"],
    hint: "MP3, WAV, M4A",
  },
];

function hasAllowedExt(name: string, exts: string[]): boolean {
  const lower = name.toLowerCase();
  return exts.some((ext) => lower.endsWith(ext));
}

function gridCols(type: AssetType): string {
  if (type === "audio") return "grid grid-cols-1 gap-2 md:grid-cols-2";
  if (type === "font") return "grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4";
  return "grid grid-cols-3 gap-3 md:grid-cols-4 lg:grid-cols-6";
}

function renderCard(asset: Asset, onDelete: (id: number) => void) {
  switch (asset.type) {
    case "image":
    case "emoji":
      return <ImageAssetCard key={asset.id} asset={asset} onDelete={onDelete} />;
    case "gif":
      return <GifAssetCard key={asset.id} asset={asset} onDelete={onDelete} />;
    case "font":
      return <FontAssetCard key={asset.id} asset={asset} onDelete={onDelete} />;
    case "audio":
      return <AudioAssetCard key={asset.id} asset={asset} onDelete={onDelete} />;
  }
}

export default function AssetsPage() {
  const [active, setActive] = useState<AssetType>("image");
  const [items, setItems] = useState<Record<AssetType, Asset[]>>({
    image: [],
    gif: [],
    emoji: [],
    font: [],
    audio: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const all = await Assets.list();
      const grouped: Record<AssetType, Asset[]> = {
        image: [],
        gif: [],
        emoji: [],
        font: [],
        audio: [],
      };
      for (const a of all) grouped[a.type].push(a);
      setItems(grouped);
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

  async function handleFiles(type: AssetType, files: File[]) {
    const cfg = TABS.find((t) => t.type === type)!;
    const accepted: { item: UploadItem; file: File }[] = [];
    for (const f of files) {
      if (!hasAllowedExt(f.name, cfg.exts)) continue;
      accepted.push({
        file: f,
        item: { id: crypto.randomUUID(), name: f.name, progress: 0 },
      });
    }
    if (accepted.length === 0) {
      setError(`Aucun fichier valide pour ${cfg.label.toLowerCase()}`);
      return;
    }
    setUploads((prev) => [...prev, ...accepted.map((a) => a.item)]);

    await Promise.all(
      accepted.map(async ({ item, file }) => {
        try {
          const created = await uploadFile(
            `/api/assets/upload?type=${type}`,
            file,
            AssetSchema,
            (pct) => updateUpload(item.id, { progress: pct }),
          );
          setItems((prev) => ({
            ...prev,
            [created.type]: [created, ...prev[created.type]],
          }));
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
    const previous = items;
    setItems((prev) => {
      const next = { ...prev };
      for (const t of Object.keys(next) as AssetType[]) {
        next[t] = next[t].filter((a) => a.id !== id);
      }
      return next;
    });
    try {
      await Assets.delete(id);
    } catch (err) {
      setItems(previous);
      setError(err instanceof Error ? err.message : "Erreur delete");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Assets</h1>
        <p className="text-sm text-muted-foreground">Bibliothèque de ressources réutilisables.</p>
      </div>

      <Tabs value={active} onValueChange={(v) => setActive(v as AssetType)}>
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.type} value={t.type}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {TABS.map((cfg) => (
          <TabsContent key={cfg.type} value={cfg.type} className="space-y-4">
            <Dropzone
              accept={cfg.accept}
              onFiles={(files) => handleFiles(cfg.type, files)}
              hint={cfg.hint}
            />
            <UploadList items={uploads} />
            {error && <p className="text-sm text-destructive">{error}</p>}
            {loading ? (
              <p className="text-sm text-muted-foreground">Chargement…</p>
            ) : items[cfg.type].length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Aucun {cfg.label.toLowerCase()} pour le moment.
              </p>
            ) : (
              <div className={gridCols(cfg.type)}>
                {items[cfg.type].map((a) => renderCard(a, onDelete))}
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
