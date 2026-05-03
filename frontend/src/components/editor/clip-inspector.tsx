"use client";

import { Trash2, Volume2, VolumeX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEditorStore } from "@/store/editor";
import type { Clip } from "@/lib/api";
import { cn } from "@/lib/utils";

type Props = { clip: Clip };

export function ClipInspector({ clip }: Props) {
  const patchClip = useEditorStore((s) => s.patchClip);
  const deleteClip = useEditorStore((s) => s.deleteClip);

  const isFixed = clip.type === "fixed";
  const isPlaceholder = clip.type === "placeholder";
  const isImage = clip.type === "image";

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          Type
        </div>
        <div className="text-sm font-medium">
          {isFixed ? "Vidéo fixe" : isImage ? "Image fixe" : "Placeholder"}
        </div>
      </div>

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
        </Section>
      )}

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
