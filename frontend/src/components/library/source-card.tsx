"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr as frLocale } from "date-fns/locale";

import { cn } from "@/lib/utils";
import type { Source } from "@/lib/api";

function fmtDuration(secs: number | null): string {
  if (secs == null) return "—";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

type Props = {
  source: Source;
  onDelete: (id: number) => void;
};

export function SourceCard({ source, onDelete }: Props) {
  const [thumbError, setThumbError] = useState(false);

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-lg border border-border bg-card">
      <div className="relative aspect-[9/16] w-full bg-black">
        {!thumbError && source.thumbnail_path && (
          <img
            src={`/api/files/source_thumb/${source.id}`}
            alt={source.original_filename}
            className="absolute inset-0 h-full w-full object-cover"
            onError={() => setThumbError(true)}
          />
        )}
        <button
          type="button"
          aria-label="Supprimer"
          title="Supprimer"
          onClick={() => onDelete(source.id)}
          className={cn(
            "absolute right-2 top-2 rounded-md border border-border bg-background/80 p-1.5 text-foreground opacity-0 shadow-sm backdrop-blur transition group-hover:opacity-100",
            "hover:border-destructive hover:text-destructive",
          )}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex flex-col gap-1 p-3 text-xs">
        <div className="truncate text-sm font-medium" title={source.original_filename}>
          {source.original_filename}
        </div>
        <div className="text-muted-foreground">
          {fmtDuration(source.duration_sec)}
          {source.width && source.height
            ? ` · ${source.width}×${source.height}`
            : ""}
        </div>
        <div className="text-muted-foreground">
          {formatDistanceToNow(new Date(source.uploaded_at), {
            addSuffix: true,
            locale: frLocale,
          })}
        </div>
      </div>
    </div>
  );
}
