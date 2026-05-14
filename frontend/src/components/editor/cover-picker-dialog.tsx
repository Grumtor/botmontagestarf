"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Templates, type Template } from "@/lib/api";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  template: Template;
  /** Called after a successful set/clear so the parent can update local state. */
  onChange: (next: { cover_ext: string | null; cover_time_sec: number | null }) => void;
};

export function CoverPickerDialog({
  open,
  onOpenChange,
  template,
  onChange,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [time, setTime] = useState<number>(template.cover_time_sec ?? 0);
  const [previewMissing, setPreviewMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Each time the dialog opens, re-seed `time` from the stored
  // cover_time_sec (so reopening lands on the previous pick).
  useEffect(() => {
    if (open) {
      setTime(template.cover_time_sec ?? 0);
      setError(null);
      setPreviewMissing(false);
      setDuration(null);
    }
  }, [open, template.cover_time_sec]);

  // Seek the <video> whenever the user drags the slider.
  useEffect(() => {
    const v = videoRef.current;
    if (v && duration !== null) {
      v.currentTime = Math.min(time, duration);
    }
  }, [time, duration]);

  async function onConfirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await Templates.setCoverFromTime(template.id, time);
      onChange({
        cover_ext: res.cover_ext,
        cover_time_sec: res.cover_time_sec,
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  async function onClear() {
    setBusy(true);
    setError(null);
    try {
      await Templates.deleteCover(template.id);
      onChange({ cover_ext: null, cover_time_sec: null });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  // Cache-busted preview URL so a freshly-regenerated preview is picked up.
  const previewSrc = `/api/files/template_preview/${
    template.id
  }?t=${new Date(template.updated_at).getTime()}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Cover de la card</DialogTitle>
          <DialogDescription>
            Choisis le moment de l&apos;aperçu à utiliser comme image de la
            card sur <code>/templates</code>.
          </DialogDescription>
        </DialogHeader>

        {previewMissing ? (
          <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm text-yellow-200">
            Aucun aperçu disponible. Clique sur «&nbsp;Aperçu rendu&nbsp;» en
            haut à droite pour en générer un, puis reviens ici.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="overflow-hidden rounded-md bg-black">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video
                ref={videoRef}
                src={previewSrc}
                className="aspect-[9/16] w-full max-h-[50vh] object-contain"
                preload="auto"
                muted
                playsInline
                onLoadedMetadata={(e) => {
                  const d = e.currentTarget.duration;
                  if (Number.isFinite(d) && d > 0) {
                    setDuration(d);
                    // Clamp time within duration on load.
                    setTime((t) => Math.min(t, d));
                  }
                }}
                onError={() => setPreviewMissing(true)}
              />
            </div>

            <div className="flex flex-col gap-1">
              <input
                type="range"
                min={0}
                max={duration ?? 0}
                step={0.05}
                value={time}
                disabled={duration === null}
                onChange={(e) => setTime(Number(e.target.value))}
                className="w-full accent-primary"
              />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{time.toFixed(2)} s</span>
                <span>
                  {duration !== null
                    ? `Durée totale : ${duration.toFixed(2)} s`
                    : "Chargement…"}
                </span>
              </div>
            </div>
          </div>
        )}

        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        <DialogFooter className="flex-row items-center justify-between gap-2">
          {template.cover_ext ? (
            <Button
              variant="ghost"
              onClick={onClear}
              disabled={busy}
              className="text-destructive hover:text-destructive"
            >
              Supprimer la cover
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              Annuler
            </Button>
            <Button
              onClick={onConfirm}
              disabled={busy || previewMissing || duration === null}
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Enregistrement…
                </>
              ) : (
                "Définir comme cover"
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
