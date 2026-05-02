"use client";

import { useRef, useState } from "react";
import { Pause, Play, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Asset } from "@/lib/api";

type Props = {
  asset: Asset;
  onDelete: (id: number) => void;
};

function DeleteButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Supprimer"
      title="Supprimer"
      onClick={onClick}
      className="absolute right-2 top-2 rounded-md border border-border bg-background/80 p-1.5 text-foreground opacity-0 shadow-sm backdrop-blur transition group-hover:opacity-100 hover:border-destructive hover:text-destructive"
    >
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  );
}

function CardShell({
  asset,
  onDelete,
  children,
  caption,
  ratio = "aspect-square",
}: Props & {
  children: React.ReactNode;
  caption?: React.ReactNode;
  ratio?: string;
}) {
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-lg border border-border bg-card">
      <div className={cn("relative w-full bg-black", ratio)}>
        {children}
        <DeleteButton onClick={() => onDelete(asset.id)} />
      </div>
      <div className="p-2">
        <div className="truncate text-xs" title={asset.name ?? ""}>
          {caption ?? asset.name ?? `#${asset.id}`}
        </div>
      </div>
    </div>
  );
}

// ---- Image / Emoji ----------------------------------------------------

export function ImageAssetCard({ asset, onDelete }: Props) {
  return (
    <CardShell asset={asset} onDelete={onDelete}>
      <img
        src={`/api/files/asset/${asset.id}`}
        alt={asset.name ?? ""}
        className="absolute inset-0 h-full w-full object-contain"
      />
    </CardShell>
  );
}

// ---- GIF (animated) ---------------------------------------------------

export function GifAssetCard({ asset, onDelete }: Props) {
  return (
    <CardShell asset={asset} onDelete={onDelete}>
      <img
        src={`/api/files/asset/${asset.id}`}
        alt={asset.name ?? ""}
        className="absolute inset-0 h-full w-full object-cover"
      />
    </CardShell>
  );
}

// ---- Font (preview rendered IN the loaded font) -----------------------

export function FontAssetCard({ asset, onDelete }: Props) {
  const family = `bm-font-${asset.id}`;
  const url = `/api/files/asset/${asset.id}`;
  const display = (asset.name ?? `Font ${asset.id}`).replace(/\.(ttf|otf)$/i, "");

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-lg border border-border bg-card">
      <style>{`
        @font-face {
          font-family: '${family}';
          src: url('${url}');
          font-display: swap;
        }
      `}</style>
      <div className="relative flex aspect-square w-full items-center justify-center bg-background p-4">
        <div
          className="break-all text-center text-2xl leading-tight"
          style={{ fontFamily: `'${family}', system-ui, sans-serif` }}
        >
          {display}
        </div>
        <DeleteButton onClick={() => onDelete(asset.id)} />
      </div>
      <div className="p-2">
        <div className="truncate text-xs text-muted-foreground" title={asset.name ?? ""}>
          {asset.name ?? `#${asset.id}`}
        </div>
      </div>
    </div>
  );
}

// ---- Audio (inline play/pause) ----------------------------------------

export function AudioAssetCard({ asset, onDelete }: Props) {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  function toggle() {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) void a.play();
    else a.pause();
  }

  return (
    <div className="group relative flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground hover:opacity-90"
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium" title={asset.name ?? ""}>
            {asset.name ?? `#${asset.id}`}
          </div>
          <div className="text-xs text-muted-foreground">Audio</div>
        </div>
        <button
          type="button"
          aria-label="Supprimer"
          title="Supprimer"
          onClick={() => onDelete(asset.id)}
          className="rounded-md p-1.5 text-muted-foreground opacity-0 transition hover:text-destructive group-hover:opacity-100"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
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
