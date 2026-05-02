"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  blobUrl: string | null;
  loading: boolean;
  error: string | null;
};

export function RenderPreviewDialog({
  open,
  onOpenChange,
  blobUrl,
  loading,
  error,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Aperçu rendu</DialogTitle>
          <DialogDescription>
            Rendu basse qualité (720p, CRF 28, sans audio).
          </DialogDescription>
        </DialogHeader>

        <div className="flex aspect-[9/16] w-full items-center justify-center overflow-hidden rounded-md bg-black">
          {loading && (
            <p className="text-sm text-muted-foreground">Rendu en cours…</p>
          )}
          {error && !loading && (
            <p className="px-4 text-center text-sm text-destructive">{error}</p>
          )}
          {!loading && !error && blobUrl && (
            <video
              src={blobUrl}
              controls
              autoPlay
              className="h-full w-full object-contain"
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
