"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Assets, type Asset } from "@/lib/api";

type Props = {
  open: boolean;
  onPick: (asset: Asset) => void;
  onOpenChange: (v: boolean) => void;
};

export function AudioAssetPickerDialog({ open, onPick, onOpenChange }: Props) {
  const [items, setItems] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    Assets.list("audio")
      .then(setItems)
      .finally(() => setLoading(false));
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Choisir un audio overlay</DialogTitle>
          <DialogDescription>
            Le clip sera mixé par-dessus la source.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="text-sm text-muted-foreground">Chargement…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucun audio. Va sur /assets pour en uploader.
          </p>
        ) : (
          <div className="max-h-[400px] space-y-1 overflow-y-auto">
            {items.map((a) => (
              <Row key={a.id} asset={a} onPick={onPick} />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Row({ asset, onPick }: { asset: Asset; onPick: (a: Asset) => void }) {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  function toggle() {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) void a.play();
    else a.pause();
  }

  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-card p-2">
      <button
        type="button"
        onClick={toggle}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground hover:opacity-90"
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="ml-0.5 h-3.5 w-3.5" />}
      </button>
      <div className="min-w-0 flex-1 truncate text-xs" title={asset.name ?? ""}>
        {asset.name ?? `#${asset.id}`}
      </div>
      <Button size="sm" onClick={() => onPick(asset)}>
        Choisir
      </Button>
      <audio
        ref={audioRef}
        src={`/api/files/asset/${asset.id}`}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
    </div>
  );
}
