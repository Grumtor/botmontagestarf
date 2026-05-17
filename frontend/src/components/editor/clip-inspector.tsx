"use client";

import { useState } from "react";
import {
  Eye,
  EyeOff,
  Loader2,
  Music2,
  Scissors,
  Trash2,
  Volume2,
  VolumeX,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEditorStore } from "@/store/editor";
import { Templates, type Clip, type ExtraClip } from "@/lib/api";
import { cn } from "@/lib/utils";

type Props = {
  clip: Clip | ExtraClip;
  /** When set, this clip lives on an extra track — use extra-track
   *  store actions instead of the main-track ones. */
  extraTrackId?: string;
};

export function ClipInspector({ clip, extraTrackId }: Props) {
  const template = useEditorStore((s) => s.template);
  const clips = useEditorStore((s) => s.clips);
  const currentTime = useEditorStore((s) => s.currentTime);
  const patchMainClip = useEditorStore((s) => s.patchClip);
  const deleteMainClip = useEditorStore((s) => s.deleteClip);
  const splitMainClip = useEditorStore((s) => s.splitMainClip);
  const splitExtraClipStore = useEditorStore((s) => s.splitExtraClip);
  const patchExtraClipStore = useEditorStore((s) => s.patchExtraClip);
  const deleteExtraClip = useEditorStore((s) => s.deleteExtraClip);
  const patchAudioOverlay = useEditorStore((s) => s.patchAudioOverlay);

  const isExtra = !!extraTrackId;
  // Polymorphic patch / delete depending on whether this clip is on the
  // main track or on an extra track.
  const patchClip = isExtra
    ? (id: string, patch: Partial<Clip> | Partial<ExtraClip>) =>
        patchExtraClipStore(extraTrackId!, id, patch as Partial<ExtraClip>)
    : (id: string, patch: Partial<Clip>) =>
        patchMainClip(id, patch);
  const deleteClip = isExtra
    ? (id: string) => deleteExtraClip(extraTrackId!, id)
    : (id: string) => deleteMainClip(id);

  const [extractingAudio, setExtractingAudio] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);

  async function onUseAsOverlay() {
    if (!template || clip.type !== "fixed") return;
    setExtractingAudio(true);
    setExtractError(null);
    try {
      // ESLint thinks `useClipAudioAsOverlay` is a React Hook because of
      // the `use` prefix — it's actually just an API method on the
      // `Templates` namespace. False positive, safe to silence.
      // eslint-disable-next-line react-hooks/rules-of-hooks
      const updated = await Templates.useClipAudioAsOverlay(
        template.id,
        clip.id,
      );
      // Mirror server state into the editor store (no full reload, so the
      // user's other unsaved edits in this session aren't clobbered).
      patchAudioOverlay({
        file_id: updated.audio_overlay.file_id,
        volume: updated.audio_overlay.volume,
        start_offset: updated.audio_overlay.start_offset,
        trim_in: updated.audio_overlay.trim_in,
      });
      // For extra-track clips, also set video_enabled=false so the
      // underlying tracks stay visible (full "audio-only" mode).
      if (extraTrackId) {
        patchClip(clip.id, {
          audio_enabled: false,
          video_enabled: false,
        } as Partial<ExtraClip>);
      } else {
        patchClip(clip.id, { audio_enabled: false });
      }
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setExtractingAudio(false);
    }
  }

  const isFixed = clip.type === "fixed";
  const isPlaceholder = clip.type === "placeholder";
  const isImage = clip.type === "image";

  // Phase 27 — compute the clip's absolute time range on the timeline
  // and whether the playhead is inside it (for the "Cut at playhead"
  // button enable/disable).
  const clipDur =
    clip.type === "fixed"
      ? clip.trim_out != null
        ? Math.max(0, clip.trim_out - clip.trim_in)
        : Math.max(0, ((clip as Clip & { source_duration_sec?: number }).source_duration_sec ?? 0) - clip.trim_in)
      : (clip as { duration_sec: number }).duration_sec;

  let clipAbsStart = 0;
  if (isExtra) {
    clipAbsStart = (clip as ExtraClip).start_time;
  } else {
    // Sum durations of main-track clips before this one.
    for (const c of clips) {
      if (c.id === clip.id) break;
      if (c.type === "fixed") {
        clipAbsStart +=
          c.trim_out != null
            ? Math.max(0, c.trim_out - c.trim_in)
            : Math.max(0, (c.source_duration_sec ?? 0) - c.trim_in);
      } else {
        clipAbsStart += c.duration_sec;
      }
    }
  }
  const clipAbsEnd = clipAbsStart + clipDur;
  const playheadInClip =
    currentTime > clipAbsStart + 0.05 && currentTime < clipAbsEnd - 0.05;
  const localPlayheadOffset = currentTime - clipAbsStart;

  function onCutAtPlayhead() {
    if (!playheadInClip) return;
    if (isExtra && extraTrackId) {
      splitExtraClipStore(extraTrackId, clip.id, currentTime);
    } else {
      splitMainClip(clip.id, currentTime);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          Type {isExtra && "· extra track"}
        </div>
        <div className="text-sm font-medium">
          {isFixed ? "Vidéo fixe" : isImage ? "Image fixe" : "Placeholder"}
        </div>
      </div>

      {/* Extra-track clips have an absolute start_time on the timeline. */}
      {isExtra && (
        <Section title="Position (s)">
          <NumberField
            label="Début (timeline)"
            value={(clip as ExtraClip).start_time}
            step={0.1}
            onChange={(v) =>
              patchClip(clip.id, { start_time: Math.max(0, v) } as Partial<
                ExtraClip
              >)
            }
          />
          <p className="text-[10px] text-muted-foreground">
            Position absolue du clip sur la timeline globale.
          </p>
        </Section>
      )}

      {/* Phase 28 — visibility toggle pour les clips d'extra tracks.
          Quand "Audio only" est ON, le clip ne s'affiche plus
          visuellement (les tracks en-dessous restent visibles) mais
          son audio continue à être mixé. Use case classique : pull
          uniquement la bande son d'une vidéo. */}
      {isExtra && !isImage && (
        <Section title="Visibilité">
          <button
            type="button"
            onClick={() =>
              patchClip(clip.id, {
                video_enabled: !(
                  (clip as ExtraClip).video_enabled ?? true
                ),
              } as Partial<ExtraClip>)
            }
            className={cn(
              "flex w-full items-center justify-between rounded-md border px-3 py-2 text-xs transition",
              ((clip as ExtraClip).video_enabled ?? true)
                ? "border-primary bg-accent"
                : "border-amber-500/50 bg-amber-500/10 text-amber-200",
            )}
            title={
              ((clip as ExtraClip).video_enabled ?? true)
                ? "Désactiver l'image de ce clip (audio only — les tracks en-dessous restent visibles)"
                : "Réactiver l'image de ce clip"
            }
          >
            <span className="flex items-center gap-2">
              {((clip as ExtraClip).video_enabled ?? true) ? (
                <Eye className="h-3 w-3" />
              ) : (
                <EyeOff className="h-3 w-3" />
              )}
              {((clip as ExtraClip).video_enabled ?? true)
                ? "Image affichée"
                : "🎵 Audio only — image masquée"}
            </span>
            <span className="text-muted-foreground">
              {((clip as ExtraClip).video_enabled ?? true) ? "ON" : "OFF"}
            </span>
          </button>
          <p className="text-[10px] leading-snug text-muted-foreground">
            Mode «&nbsp;Audio only&nbsp;» : utile pour récupérer
            uniquement la bande son d&apos;un clip Track {extraTrackId ? "" : ""}
            sans qu&apos;il couvre le visuel des tracks en-dessous.
          </p>
        </Section>
      )}

      {isFixed && (
        <Section title="Trim (s)">
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Début"
              value={clip.trim_in}
              step={0.1}
              onChange={(v) =>
                patchClip(clip.id, { trim_in: Math.max(0, v) })
              }
            />
            <NumberField
              label="Fin"
              value={clip.trim_out ?? clip.source_duration_sec ?? 0}
              step={0.1}
              onChange={(v) => patchClip(clip.id, { trim_out: v })}
            />
          </div>
          {clip.source_duration_sec != null && (
            <p className="text-[10px] text-muted-foreground">
              Durée fichier source: {clip.source_duration_sec.toFixed(2)}s
            </p>
          )}
        </Section>
      )}

      {isImage && (
        <Section title="Durée affichage (s)">
          <NumberField
            label="Durée"
            value={clip.duration_sec}
            step={0.1}
            onChange={(v) =>
              patchClip(clip.id, { duration_sec: Math.max(0.1, v) })
            }
          />
          <p className="text-[10px] text-muted-foreground">
            L&apos;image sera affichée pendant cette durée dans le reel final.
          </p>
        </Section>
      )}

      {isPlaceholder && (
        <Section title="Durée placeholder (s)">
          <NumberField
            label="Durée"
            value={clip.duration_sec}
            step={0.1}
            onChange={(v) =>
              patchClip(clip.id, { duration_sec: Math.max(0.1, v) })
            }
          />
          <p className="text-[10px] text-muted-foreground">
            Au render, la vidéo utilisateur sera tronquée à cette durée. Si
            elle est plus courte, le dernier frame sera figé.
          </p>
        </Section>
      )}

      {/* Effets visuels + freeze frame — applicables à tous les types. */}
      <Section title="Effets">
        <button
          type="button"
          onClick={() => {
            const next = (clip.filter ?? "none") === "bw" ? "none" : "bw";
            patchClip(clip.id, {
              filter: next,
              // Reset range when turning off so old values don't linger.
              ...(next === "none"
                ? { filter_start_sec: null, filter_end_sec: null }
                : {}),
            });
          }}
          className={cn(
            "flex w-full items-center justify-between rounded-md border px-3 py-2 text-xs transition",
            (clip.filter ?? "none") === "bw"
              ? "border-primary bg-accent"
              : "border-border hover:bg-accent/50",
          )}
          title="Convertit ce clip en noir et blanc à l'export et dans l'aperçu."
        >
          <span>Noir &amp; blanc</span>
          <span className="text-muted-foreground">
            {(clip.filter ?? "none") === "bw" ? "ON" : "OFF"}
          </span>
        </button>

        {(clip.filter ?? "none") === "bw" && (
          <div className="space-y-1.5 rounded-md border border-border/70 bg-background/40 p-2">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Plage N&amp;B (optionnel)
            </p>
            <div className="grid grid-cols-2 gap-2">
              <NumberField
                label="Début (sec)"
                value={clip.filter_start_sec ?? 0}
                step={0.1}
                onChange={(v) =>
                  patchClip(clip.id, {
                    filter_start_sec: v <= 0 ? null : v,
                  })
                }
              />
              <NumberField
                label="Fin (sec)"
                value={clip.filter_end_sec ?? clipDur}
                step={0.1}
                onChange={(v) =>
                  patchClip(clip.id, {
                    filter_end_sec: v >= clipDur || v <= 0 ? null : v,
                  })
                }
              />
            </div>
            <p className="text-[10px] leading-snug text-muted-foreground">
              Laisse vide pour appliquer le N&amp;B sur tout le clip. Sinon
              le filtre est actif uniquement entre ces 2 instants (en
              secondes depuis le début du clip).
            </p>
          </div>
        )}

        {(clip.freeze_at_sec == null) ? (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => {
              // Insère le freeze à la position du playhead dans le clip
              // (clamped à [0, naturalDur]). Si playhead hors clip, on
              // tombe au milieu du clip par défaut.
              const local = Math.max(
                0,
                Math.min(clipDur, localPlayheadOffset),
              );
              const at = playheadInClip ? local : clipDur / 2;
              patchClip(clip.id, {
                freeze_at_sec: at,
                freeze_duration_sec: 2,
              });
            }}
            title="Ajoute un segment d'image figée à la position du playhead, durée 2s. Drag son bord droit ou son centre dans la timeline pour ajuster."
          >
            + Geler une image (2s)
          </Button>
        ) : (
          <div className="space-y-1.5 rounded-md border border-cyan-400/30 bg-cyan-950/20 p-2">
            <p className="text-[10px] uppercase tracking-wider text-cyan-200/80">
              ❄ Image figée
            </p>
            <div className="grid grid-cols-2 gap-2">
              <NumberField
                label="Position (sec)"
                value={clip.freeze_at_sec}
                step={0.1}
                onChange={(v) =>
                  patchClip(clip.id, {
                    freeze_at_sec: Math.max(0, Math.min(clipDur, v)),
                  })
                }
              />
              <NumberField
                label="Durée (sec)"
                value={clip.freeze_duration_sec ?? 0}
                step={0.1}
                onChange={(v) =>
                  patchClip(clip.id, {
                    freeze_duration_sec: Math.max(0.1, v),
                  })
                }
              />
            </div>
            <button
              type="button"
              onClick={() =>
                patchClip(clip.id, {
                  freeze_filter:
                    (clip.freeze_filter ?? "none") === "bw" ? "none" : "bw",
                })
              }
              className={cn(
                "flex w-full items-center justify-between rounded-md border px-3 py-1.5 text-xs transition",
                (clip.freeze_filter ?? "none") === "bw"
                  ? "border-primary bg-accent"
                  : "border-border hover:bg-accent/50",
              )}
              title="N&B appliqué uniquement à l'image figée — indépendant du filtre du clip."
            >
              <span>N&amp;B sur le freeze</span>
              <span className="text-muted-foreground">
                {(clip.freeze_filter ?? "none") === "bw" ? "ON" : "OFF"}
              </span>
            </button>
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-[11px] text-muted-foreground"
              onClick={() =>
                patchClip(clip.id, {
                  freeze_at_sec: null,
                  freeze_duration_sec: 0,
                  freeze_filter: "none",
                })
              }
            >
              Retirer le freeze
            </Button>
          </div>
        )}
        <p className="text-[10px] leading-snug text-muted-foreground">
          Le freeze s&apos;insère <strong>dedans</strong> le clip et
          ajoute sa durée. Visible comme une sous-barre turquoise dans
          la timeline — drag pour bouger / redimensionner.
        </p>
      </Section>

      {!isImage && (
        <Section title="Audio">
        <button
          type="button"
          onClick={() =>
            patchClip(clip.id, { audio_enabled: !clip.audio_enabled })
          }
          className={cn(
            "flex w-full items-center justify-between rounded-md border px-3 py-2 text-xs transition",
            clip.audio_enabled
              ? "border-primary bg-accent"
              : "border-border hover:bg-accent/50",
          )}
        >
          <span className="flex items-center gap-2">
            {clip.audio_enabled ? (
              <Volume2 className="h-3 w-3" />
            ) : (
              <VolumeX className="h-3 w-3" />
            )}
            Audio activé
          </span>
          <span className="text-muted-foreground">
            {clip.audio_enabled ? "ON" : "OFF"}
          </span>
        </button>

        {clip.audio_enabled && (
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">
              Volume: {Math.round(clip.audio_volume * 100)}%
            </span>
            <input
              type="range"
              min={0}
              max={2}
              step={0.01}
              value={clip.audio_volume}
              onChange={(e) =>
                patchClip(clip.id, { audio_volume: Number(e.target.value) })
              }
              className="w-full accent-primary"
            />
          </label>
        )}

        {/* Phase 25 (B) + 28c — extraire l'audio de ce clip vidéo et le
            set comme audio overlay global. Sur main track : mute auto
            l'audio du clip. Sur extra track : mute audio + désactive
            l'image (full audio-only) pour que la main track reste
            visible. */}
        {isFixed && (
          <div className="space-y-1">
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={onUseAsOverlay}
              disabled={extractingAudio}
              title="Extraire l'audio de cette vidéo et l'utiliser comme audio overlay du template (le clip sera muté automatiquement)"
            >
              {extractingAudio ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Extraction…
                </>
              ) : (
                <>
                  <Music2 className="h-4 w-4" />
                  {isExtra
                    ? "Utiliser comme bande son du template"
                    : "Utiliser comme audio overlay"}
                </>
              )}
            </Button>
            <p className="text-[10px] leading-snug text-muted-foreground">
              {isExtra
                ? "Extrait l'audio de ce clip et l'utilise pour TOUTE la template (joue de t=0 à la fin). L'image du clip est masquée et son audio coupé pour pas faire doublon — les tracks en-dessous restent visibles."
                : "Pratique si tu veux que la bande son joue dès le début du template (pendant ton placeholder par exemple) et que l'audio du clip ne se dédouble pas."}
            </p>
            {extractError && (
              <p className="text-[10px] text-destructive">{extractError}</p>
            )}
          </div>
        )}
        </Section>
      )}

      {/* Phase 27 — Couper au playhead. Le bouton est toujours visible
          mais désactivé si le playhead n'est pas dans la zone du clip,
          avec un texte d'aide explicite. */}
      <div className="space-y-1">
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={onCutAtPlayhead}
          disabled={!playheadInClip}
          title={
            playheadInClip
              ? `Couper en deux à ${localPlayheadOffset.toFixed(2)}s du début du clip`
              : "Place le playhead dans la zone du clip pour couper"
          }
        >
          <Scissors className="h-4 w-4" />
          {playheadInClip
            ? `Couper ici (${localPlayheadOffset.toFixed(2)}s)`
            : "Couper au playhead"}
        </Button>
        {!playheadInClip && (
          <p className="text-[10px] leading-snug text-muted-foreground">
            Glisse la barre de lecture (rouge) sur le clip pour activer la
            coupe.
          </p>
        )}
      </div>

      <Button
        variant="destructive"
        size="sm"
        className="w-full"
        onClick={() => deleteClip(clip.id)}
      >
        <Trash2 className="h-4 w-4" />
        Supprimer le clip
      </Button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function NumberField({
  label,
  value,
  step,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <Input
        type="number"
        step={step}
        value={Number.isFinite(value) ? Number(value.toFixed(2)) : 0}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
        className="h-8 text-xs"
      />
    </label>
  );
}
