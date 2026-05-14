"use client";

import { useEffect, useRef, useState } from "react";
import { Film, Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { SampleVideo, type SampleVideoInfo } from "@/lib/api";

/**
 * Manage the global "sample placeholder video" — uploaded once, reused
 * by every template's preview as the visual filler for empty placeholder
 * clips. (Phase 17.) Single dialog: shows current state + upload /
 * replace / delete.
 */
export function SampleVideoDialog() {
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<SampleVideoInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);  // bumped after upload so <video> refetches
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    SampleVideo.info()
      .then((i) => {
        if (!cancelled) setInfo(i);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Erreur");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, version]);

  async function handleUpload(file: File) {
    setUploading(true);
    setProgress(0);
    setError(null);
    try {
      const newInfo = await SampleVideo.upload(file, (pct) => setProgress(pct));
      setInfo(newInfo);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setUploading(false);
      setProgress(0);
    }
  }

  async function handleDelete() {
    if (!confirm("Supprimer la vidéo exemple ?")) return;
    try {
      await SampleVideo.delete();
      setInfo({ exists: false, size_bytes: null, duration_sec: null, width: null, height: null });
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Film className="h-4 w-4" />
        Vidéo exemple
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Vidéo exemple</DialogTitle>
            <DialogDescription>
              Cette vidéo remplit les placeholders dans les aperçus de tes
              templates (rendu, éditeur, grille). 1 seul fichier global.
              Au render réel les placeholders sont remplis par tes vraies
              vidéos — la vidéo exemple sert juste à visualiser le
              template avant.
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <p className="text-sm text-muted-foreground">Chargement…</p>
          ) : info?.exists ? (
            <div className="space-y-3">
              <div className="overflow-hidden rounded-md border border-border bg-black">
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video
                  key={version}
                  src={SampleVideo.url(version || undefined)}
                  className="aspect-[9/16] w-full max-h-[260px] object-contain"
                  controls
                  muted
                />
              </div>
              <div className="rounded-md border border-border bg-card p-2 text-xs">
                <div>
                  <span className="text-muted-foreground">Taille :</span>{" "}
                  {formatBytes(info.size_bytes ?? 0)}
                </div>
                {info.width && info.height && (
                  <div>
                    <span className="text-muted-foreground">Dimensions :</span>{" "}
                    {info.width}×{info.height}
                  </div>
                )}
                {info.duration_sec != null && (
                  <div>
                    <span className="text-muted-foreground">Durée :</span>{" "}
                    {info.duration_sec.toFixed(1)} s
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Aucune vidéo exemple. Les placeholders s&apos;affichent en noir
              dans les aperçus.
            </div>
          )}

          {uploading && (
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">
                Upload {progress}% · invalidation des aperçus mis en cache…
              </div>
              <Progress value={progress} />
            </div>
          )}

          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="video/mp4,video/quicktime,.mp4,.mov,.m4v"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void handleUpload(f);
            }}
          />

          <DialogFooter>
            {info?.exists && (
              <Button
                variant="ghost"
                onClick={handleDelete}
                disabled={uploading}
              >
                <Trash2 className="h-4 w-4" />
                Supprimer
              </Button>
            )}
            <Button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              <Upload className="h-4 w-4" />
              {info?.exists ? "Remplacer" : "Uploader une vidéo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}
