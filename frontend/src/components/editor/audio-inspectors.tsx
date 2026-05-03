"use client";

import { useRef } from "react";
import { ImageUp, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Templates } from "@/lib/api";
import { useEditorStore } from "@/store/editor";
import { useAudioDuration } from "./use-audio-duration";

export function AudioOverlayInspector() {
  const template = useEditorStore((s) => s.template);
  const overlay = useEditorStore((s) => s.audioOverlay);
  const patch = useEditorStore((s) => s.patchAudioOverlay);
  const inputRef = useRef<HTMLInputElement>(null);

  const fileDuration = useAudioDuration(
    template && overlay.file_id
      ? `/api/files/template_overlay/${template.id}/${overlay.file_id}`
      : null,
  );

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    if (!template) return;
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const res = await Templates.uploadOverlay(template.id, file);
    patch({ file_id: res.file_id, start_offset: 0, trim_in: 0 });
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Piste</div>
        <div className="text-sm font-medium">Audio overlay</div>
      </div>

      <Button
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => inputRef.current?.click()}
      >
        <ImageUp className="h-4 w-4" />
        {overlay.file_id ? "Remplacer audio" : "Importer audio"}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept="audio/mpeg,audio/wav,audio/mp4,audio/x-m4a,.mp3,.wav,.m4a"
        className="hidden"
        onChange={onPickFile}
      />

      {overlay.file_id && (
        <>
          <div className="rounded-md border border-border bg-card p-2 text-xs text-muted-foreground">
            Durée fichier:{" "}
            {fileDuration != null ? `${fileDuration.toFixed(2)}s` : "…"}
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
              patch({ file_id: null, start_offset: 0, trim_in: 0 })
            }
          >
            <Trash2 className="h-4 w-4" />
            Retirer overlay
          </Button>
        </>
      )}
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
