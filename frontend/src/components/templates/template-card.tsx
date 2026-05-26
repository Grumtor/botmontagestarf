"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Copy,
  Loader2,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  Rocket,
  Trash2,
  Volume2,
  VolumeX,
  Wand2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr as frLocale } from "date-fns/locale";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Render, type Template } from "@/lib/api";
import { useT } from "@/lib/i18n";

type Props = {
  template: Template;
  onDuplicate: (id: number) => void;
  onDelete: (id: number) => void;
  onRunRender: (template: Template) => void;
  /** id of the currently-playing card across the whole grid (one at a time). */
  currentlyPlayingId: number | null;
  setCurrentlyPlayingId: (id: number | null) => void;
  /** Default volume (0-1) used when this card has no per-card override. */
  globalVolume: number;
};

export function TemplateCard({
  template,
  onDuplicate,
  onDelete,
  onRunRender,
  currentlyPlayingId,
  setCurrentlyPlayingId,
  globalVolume,
}: Props) {
  const router = useRouter();
  const t = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  // Bandwidth saver : pause auto la vidéo quand la carte sort de l'écran.
  // Sans ça, une vidéo loopée continue à consommer le réseau même quand
  // l'utilisateur a scrollé loin / mis l'onglet en arrière-plan.
  const cardRef = useRef<HTMLDivElement>(null);

  const [thumbError, setThumbError] = useState(false);
  // True once the custom cover image has 404'd → fall back to template_thumb.
  const [coverError, setCoverError] = useState(false);
  const [previewBroken, setPreviewBroken] = useState(false);
  // Per-card volume override; null = use globalVolume.
  const [cardVolume, setCardVolume] = useState<number | null>(null);
  // Cache-busting key. Bumped after every preview regeneration so the
  // browser refetches a fresh MP4 (otherwise it'll show whatever it had
  // cached even after the backend rewrote the file). We seed it with the
  // template's `updated_at` timestamp so editing the template + viewing
  // the card post-edit also picks up any prior regen automatically.
  const [previewVersion, setPreviewVersion] = useState(
    () => new Date(template.updated_at).getTime(),
  );
  // Generating preview: shows spinner + disables actions.
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const playing = currentlyPlayingId === template.id;
  const effectiveVolume = cardVolume ?? globalVolume;

  const langLabel = template.language === "FR" ? "🇫🇷 FR" : "🇺🇸 US";
  const updated = formatDistanceToNow(new Date(template.updated_at), {
    addSuffix: true,
    locale: frLocale,
  });

  // Sync video play/pause with `playing` state from parent.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (playing) {
      v.volume = effectiveVolume;
      v.play().catch(() => {
        /* autoplay blocked — needs user gesture, which we have */
      });
    } else {
      v.pause();
      v.currentTime = 0;
    }
  }, [playing, effectiveVolume]);

  // Volume changes while playing.
  useEffect(() => {
    const v = videoRef.current;
    if (v) v.volume = effectiveVolume;
  }, [effectiveVolume]);

  // Auto-pause when the card scrolls out of view. Saves bandwidth and
  // CPU when the user has a long template list and the playing card
  // ends up off-screen / in another tab.
  useEffect(() => {
    const el = cardRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting && playing) {
            setCurrentlyPlayingId(null);
          }
        }
      },
      // 25% du card doit être visible — sinon on pause.
      { threshold: 0.25 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [playing, setCurrentlyPlayingId]);

  function openEditor() {
    router.push(`/editor/${template.id}`);
  }

  function togglePlay(e: React.MouseEvent) {
    e.stopPropagation();
    if (previewBroken) return; // can't play a missing preview
    if (playing) {
      setCurrentlyPlayingId(null);
    } else {
      setCurrentlyPlayingId(template.id);
    }
  }

  async function generatePreview(e: React.MouseEvent) {
    e.stopPropagation();
    if (generating) return;
    setGenerating(true);
    setGenerateError(null);
    try {
      // Empty fills → backend uses sample video / black fallback (Phase 17).
      // Result is the MP4 blob; we ignore it because the backend ALSO
      // caches it at template_preview_path which our <video src=...>
      // fetches via /api/files/template_preview/{id}.
      await Render.preview(template.id, []);
      setPreviewBroken(false);
      // Bump cache-bust to force the <video> to refetch the fresh file.
      setPreviewVersion(Date.now());
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setGenerating(false);
    }
  }

  function stop(e: React.MouseEvent) {
    e.stopPropagation();
  }

  // Cache-busting param so the browser actually refetches after generation
  // and after any backend invalidation (e.g. sample-video upload deleted
  // the cached preview file but the browser may still serve the old one).
  const previewSrc = `/api/files/template_preview/${template.id}?t=${previewVersion}`;

  return (
    <div
      ref={cardRef}
      className="group relative flex flex-col overflow-hidden rounded-lg border border-border bg-card transition hover:border-ring"
    >
      {/* Video / thumbnail area — click toggles play/pause */}
      <div
        role="button"
        tabIndex={0}
        onClick={togglePlay}
        onKeyDown={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            togglePlay(e as unknown as React.MouseEvent);
          }
        }}
        className="relative aspect-[9/16] w-full cursor-pointer bg-black"
      >
        {/* Cover image — priority: custom-uploaded cover > auto-extracted
            thumbnail. Both cache-busted via updated_at so editing the
            template re-fetches a fresh image. */}
        {!playing && template.cover_ext && !coverError && (
          <img
            src={`/api/files/template_cover/${template.id}?t=${previewVersion}`}
            alt={template.name}
            className="absolute inset-0 h-full w-full object-cover"
            onError={() => setCoverError(true)}
          />
        )}
        {!playing && (!template.cover_ext || coverError) && !thumbError && (
          <img
            src={`/api/files/template_thumb/${template.id}`}
            alt={template.name}
            className="absolute inset-0 h-full w-full object-cover"
            onError={() => setThumbError(true)}
          />
        )}

        {/* Always-mounted <video> so play/pause is instant; we stop+seek
            via the ref, no remount needed. */}
        <video
          ref={videoRef}
          src={previewSrc}
          loop
          playsInline
          preload="metadata"
          className={cn(
            "absolute inset-0 h-full w-full object-cover transition-opacity",
            playing ? "opacity-100" : "opacity-0 pointer-events-none",
          )}
          onError={() => setPreviewBroken(true)}
          onLoadedData={() => setPreviewBroken(false)}
        />

        {/* CENTER play/pause indicator. ALWAYS visible when paused so the
            card doesn't look like a dead black square. When playing, faded
            to opacity-40 (just enough to remind it's pausable) and full on
            hover. */}
        <div
          className={cn(
            "pointer-events-none absolute inset-0 z-[1] flex items-center justify-center transition",
            playing
              ? "bg-black/0 opacity-40 group-hover:bg-black/30 group-hover:opacity-100"
              : "bg-black/30 opacity-100",
          )}
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/90 text-primary-foreground shadow-lg">
            {playing ? (
              <Pause className="h-5 w-5" />
            ) : (
              <Play className="ml-0.5 h-5 w-5" />
            )}
          </span>
        </div>

        {/* "Generate preview" CTA when there's nothing to play */}
        {previewBroken && !generating && (
          <button
            type="button"
            onClick={generatePreview}
            className="absolute inset-x-2 bottom-2 z-[2] rounded-md border border-border bg-background/85 px-2 py-1.5 text-[11px] font-medium text-foreground backdrop-blur transition hover:bg-background"
          >
            <Wand2 className="mr-1 inline h-3 w-3" />
            {t("templates.card.generate_preview")}
          </button>
        )}

        {/* Generating spinner */}
        {generating && (
          <div className="pointer-events-none absolute inset-0 z-[3] flex flex-col items-center justify-center gap-2 bg-black/60 text-[11px] text-white">
            <Loader2 className="h-5 w-5 animate-spin" />
            {t("templates.card.generating")}
          </div>
        )}

        {generateError && (
          <div className="absolute inset-x-2 top-2 z-[3] rounded-md border border-destructive/40 bg-destructive/20 p-1.5 text-[10px] text-destructive">
            {generateError}
          </div>
        )}

        {/* Per-card volume slider — bottom-left, subtle by default,
            full opacity on hover. */}
        {!previewBroken && (
          <div
            onClick={stop}
            className="pointer-events-auto absolute bottom-2 left-2 z-[2] flex items-center gap-1.5 rounded-md border border-border bg-background/85 px-1.5 py-1 opacity-70 backdrop-blur transition group-hover:opacity-100"
          >
            <button
              type="button"
              onClick={(e) => {
                stop(e);
                setCardVolume(effectiveVolume > 0 ? 0 : 0.5);
              }}
              aria-label={effectiveVolume > 0 ? "Mute" : "Unmute"}
              className="text-muted-foreground transition hover:text-foreground"
            >
              {effectiveVolume > 0 ? (
                <Volume2 className="h-3 w-3" />
              ) : (
                <VolumeX className="h-3 w-3" />
              )}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={effectiveVolume}
              onChange={(e) => setCardVolume(Number(e.target.value))}
              className="h-1 w-16 accent-primary"
              title={
                cardVolume === null
                  ? t("templates.card.volume.hint_global")
                  : t("templates.card.volume.hint_override")
              }
            />
          </div>
        )}

        {/* Phase 36 — chip catégorie en haut à gauche si défini.
            Hidden quand un overlay (generate / error / spinner) le
            recouvrirait pour pas faire de superposition moche. */}
        {template.category && (
          <span
            className="pointer-events-none absolute left-2 top-2 z-[2] rounded bg-zinc-700/90 px-2 py-0.5 text-[10px] font-medium text-zinc-200 backdrop-blur"
            title={template.category}
          >
            {template.category}
          </span>
        )}

        {/* Edit / Regen / Duplicate / Delete — always visible (subtle by
            default, full opacity on hover) so the user never wonders why
            the card looks dead. */}
        <div
          className="absolute right-2 top-2 z-[2] flex gap-1 opacity-70 transition group-hover:opacity-100"
          onClick={stop}
        >
          <IconBtn
            label={t("templates.card.regenerate")}
            onClick={generatePreview}
            disabled={generating}
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", generating && "animate-spin")}
            />
          </IconBtn>
          <IconBtn
            label={t("templates.card.edit")}
            onClick={(e) => {
              stop(e);
              openEditor();
            }}
          >
            <Pencil className="h-3.5 w-3.5" />
          </IconBtn>
          <IconBtn
            label={t("templates.card.duplicate")}
            onClick={(e) => {
              stop(e);
              onDuplicate(template.id);
            }}
          >
            <Copy className="h-3.5 w-3.5" />
          </IconBtn>
          <IconBtn
            label={t("templates.card.delete")}
            destructive
            onClick={(e) => {
              stop(e);
              onDelete(template.id);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </IconBtn>
        </div>
      </div>

      <div className="flex flex-col gap-2 p-3">
        <div className="truncate text-sm font-medium">{template.name}</div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <Badge variant="secondary" className="text-[10px]">
            {langLabel}
          </Badge>
          <span>{updated}</span>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRunRender(template);
          }}
          className="flex items-center justify-center gap-1.5 rounded-md bg-primary px-2 py-1.5 text-xs font-medium text-primary-foreground transition hover:opacity-90"
        >
          <Rocket className="h-3 w-3" />
          {t("templates.card.run_render")}
        </button>
      </div>
    </div>
  );
}

function IconBtn({
  children,
  label,
  destructive,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  destructive?: boolean;
  disabled?: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-md border border-border bg-background/80 p-1.5 text-foreground shadow-sm backdrop-blur transition hover:bg-background disabled:cursor-not-allowed disabled:opacity-50",
        destructive && "hover:border-destructive hover:text-destructive",
      )}
    >
      {children}
    </button>
  );
}
