"use client";

import { useState } from "react";
import { Image as ImageIcon, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEditorStore } from "@/store/editor";
import type { Asset } from "@/lib/api";
import { cn } from "@/lib/utils";
import { AudioAssetPickerDialog } from "./audio-asset-picker-dialog";
import { useAudioDuration } from "./use-audio-duration";

export function AudioSourceInspector() {
  const audioSource = useEditorStore((s) => s.audioSource);
  const patch = useEditorStore((s) => s.patchAudioSource);

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Pist</div>
        <div className="text-sm font-medium">Source audio</div>
      </div>

      <button
        type="button"
        onClick={() => patch({ enabled: !audioSource.enabled })}
        className={cn(
          "flex w-full items-center justify-between rounded-md border px-3 py-2 text-xs transition",
          audioSource.enabled
            ? "border-primary bg-accent"
            : "border-border hover:bg-accent/50",
        )}
      >
        <span>Audio activé</span>
        <span className="text-muted-foreground">{audioSource.enabled ? "ON" : "OFF"}</span>
      </button>

      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">
          Volume: {Math.round(audioSource.volume * 100)}%
        </span>
        <input
          type="range"
          min={0}
          max={2}
          step={0.01}
          value={audioSource.volume}
          onChange={(e) => patch({ volume: Number(e.target.value) })}
          className="w-full accent-primary"
        />
      </label>

      <p className="text-[11px] text-muted-foreground">
        Live preview clamp à 100%. Le rendu final supporte 0-200%.
      </p>
    </div>
  );
}

export function AudioOverlayInspector() {
  const overlay = useEditorStore((s) => s.audioOverlay);
  const patch = useEditorStore((s) => s.patchAudioOverlay);
  const fileDuration = useAudioDuration(overlay.asset_id);
  const [pickerOpen, setPickerOpen] = useState(false);

  function onAssetPicked(asset: Asset) {
    patch({ asset_id: asset.id, start_offset: 0, trim_in: 0 });
    setPickerOpen(false);
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Pist</div>
        <div className="text-sm font-medium">Audio overlay</div>
      </div>

      <Button
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => setPickerOpen(true)}
      >
        <ImageIcon className="h-4 w-4" />
        {overlay.asset_id ? "Changer audio" : "Choisir audio"}
      </Button>

      {overlay.asset_id && (
        <>
          <div className="rounded-md border border-border bg-card p-2 text-xs text-muted-foreground">
            <div>Asset #{overlay.asset_id}</div>
            <div>
              Durée fichier:{" "}
              {fileDuration != null ? `${fileDuration.toFixed(2)}s` : "…"}
            </div>
          </div>

          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">
              Volume: {Math.round(overlay.volume * 100)}%
            </span>
            <input
              type="range"
              min={0}
              max={2}
              step={0.01}
              value={overlay.volume}
              onChange={(e) => patch({ volume: Number(e.target.value) })}
              className="w-full accent-primary"
            />
          </label>

          <NumberField
            label="Start offset (s)"
            value={overlay.start_offset}
            step={0.1}
            onChange={(v) => patch({ start_offset: Math.max(0, v) })}
          />
          <NumberField
            label="Trim in (s)"
            value={overlay.trim_in}
            step={0.1}
            onChange={(v) => {
              const max = fileDuration != null ? fileDuration - 0.1 : Infinity;
              patch({ trim_in: Math.max(0, Math.min(max, v)) });
            }}
          />

          <Button
            variant="destructive"
            size="sm"
            className="w-full"
            onClick={() =>
              patch({ asset_id: null, start_offset: 0, trim_in: 0 })
            }
          >
            <Trash2 className="h-4 w-4" />
            Retirer overlay
          </Button>
        </>
      )}

      <AudioAssetPickerDialog
        open={pickerOpen}
        onPick={onAssetPicked}
        onOpenChange={setPickerOpen}
      />
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
