"use client";

import { useEffect, useRef, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Assets, type Asset } from "@/lib/api";

type VisualAssetType = "image" | "gif" | "emoji";

const TYPE_LABEL: Record<VisualAssetType, string> = {
  image: "image",
  gif: "GIF",
  emoji: "emoji",
};

type Props = {
  open: boolean;
  type: VisualAssetType | null;
  onPick: (asset: Asset, naturalWidth: number, naturalHeight: number) => void;
  onOpenChange: (v: boolean) => void;
};

export function AssetPickerDialog({ open, type, onPick, onOpenChange }: Props) {
  const [items, setItems] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !type) return;
    setLoading(true);
    Assets.list(type)
      .then(setItems)
      .finally(() => setLoading(false));
  }, [open, type]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Choisir un{type === "emoji" ? "" : "e"} {type ? TYPE_LABEL[type] : ""}</DialogTitle>
          <DialogDescription>
            Clique sur un asset pour l&apos;ajouter comme calque.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="text-sm text-muted-foreground">Chargement…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucun asset. Va sur /assets pour en uploader.
          </p>
        ) : (
          <div className="grid max-h-[480px] grid-cols-4 gap-3 overflow-y-auto pr-1">
            {items.map((a) => (
              <PickerCard key={a.id} asset={a} onPick={onPick} />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PickerCard({
  asset,
  onPick,
}: {
  asset: Asset;
  onPick: (asset: Asset, w: number, h: number) => void;
}) {
  const imgRef = useRef<HTMLImageElement>(null);

  function handleClick() {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth > 0) {
      onPick(asset, img.naturalWidth, img.naturalHeight);
      return;
    }
    if (img) {
      img.addEventListener(
        "load",
        () => onPick(asset, img.naturalWidth, img.naturalHeight),
        { once: true },
      );
      img.addEventListener("error", () => onPick(asset, 0, 0), { once: true });
    } else {
      onPick(asset, 0, 0);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="group flex flex-col overflow-hidden rounded-lg border border-border bg-card text-left transition hover:border-ring"
    >
      <div className="relative aspect-square w-full bg-black">
        <img
          ref={imgRef}
          src={`/api/files/asset/${asset.id}`}
          alt={asset.name ?? ""}
          className="absolute inset-0 h-full w-full object-contain"
          draggable={false}
        />
      </div>
      <div className="p-2">
        <div className="truncate text-xs" title={asset.name ?? ""}>
          {asset.name ?? `#${asset.id}`}
        </div>
      </div>
    </button>
  );
}
