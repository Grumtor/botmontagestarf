"use client";

import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Sources, type Source } from "@/lib/api";
import { useEditorStore } from "@/store/editor";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
};

export function PreviewSourcePicker({ open, onOpenChange }: Props) {
  const previewSourceId = useEditorStore((s) => s.previewSourceId);
  const setPreviewSourceId = useEditorStore((s) => s.setPreviewSourceId);
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    Sources.list()
      .then(setSources)
      .finally(() => setLoading(false));
  }, [open]);

  function pick(id: number | null) {
    setPreviewSourceId(id);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Source de preview</DialogTitle>
          <DialogDescription>
            Sélectionne la vidéo à afficher dans le canvas pendant le montage.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="text-sm text-muted-foreground">Chargement…</p>
        ) : sources.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucune source. Va sur /sources pour en uploader.
          </p>
        ) : (
          <div className="grid max-h-[420px] grid-cols-3 gap-3 overflow-y-auto">
            {sources.map((s) => {
              const active = s.id === previewSourceId;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => pick(s.id)}
                  className={cn(
                    "group flex flex-col overflow-hidden rounded-lg border border-border bg-card text-left transition hover:border-ring",
                    active && "border-primary ring-2 ring-primary",
                  )}
                >
                  <div className="relative aspect-[9/16] w-full bg-black">
                    {s.thumbnail_path && (
                      <img
                        src={`/api/files/source_thumb/${s.id}`}
                        alt={s.original_filename}
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                    )}
                  </div>
                  <div className="p-2">
                    <div
                      className="truncate text-xs font-medium"
                      title={s.original_filename}
                    >
                      {s.original_filename}
                    </div>
                    {s.width && s.height && (
                      <div className="text-[10px] text-muted-foreground">
                        {s.width}×{s.height}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {previewSourceId !== null && (
          <div className="flex justify-end pt-2">
            <Button variant="ghost" size="sm" onClick={() => pick(null)}>
              Retirer la source
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
