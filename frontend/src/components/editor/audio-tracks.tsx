"use client";

import { useState } from "react";
import { Plus, Volume2, VolumeX } from "lucide-react";

import { useEditorStore } from "@/store/editor";
import { totalSegmentDuration } from "@/lib/editor-types";
import { cn } from "@/lib/utils";
import type { Asset } from "@/lib/api";
import { AudioAssetPickerDialog } from "./audio-asset-picker-dialog";
import { useAudioDuration } from "./use-audio-duration";

export function SourceAudioLane({
  pxPerSec,
  width,
  height,
}: {
  pxPerSec: number;
  width: number;
  height: number;
}) {
  const audioSource = useEditorStore((s) => s.audioSource);
  const patch = useEditorStore((s) => s.patchAudioSource);
  const setAudioSelection = useEditorStore((s) => s.setAudioSelection);
  const segments = useEditorStore((s) => s.sourceSegments);
  const selection = useEditorStore((s) => s.audioSelection);

  const totalDur = totalSegmentDuration(segments);
  const blockWidth = Math.max(totalDur * pxPerSec, 4);
  const selected = selection === "source";

  return (
    <div
      className="relative border-b border-border bg-background/40"
      style={{ width, height }}
      onClick={(e) => {
        e.stopPropagation();
        setAudioSelection("source");
      }}
    >
      <div
        className={cn(
          "absolute top-1 flex h-[calc(100%-8px)] cursor-pointer items-center overflow-hidden rounded-sm border text-[10px] text-white",
          audioSource.enabled
            ? "bg-emerald-800/80 hover:bg-emerald-700"
            : "bg-zinc-700/60",
          selected ? "border-foreground" : "border-transparent",
        )}
        style={{ left: 0, width: blockWidth }}
      >
        <span className="pointer-events-none mx-2 truncate">Source audio</span>
        <div
          className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-1.5 rounded bg-black/50 px-1.5 py-0.5"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="range"
            min={0}
            max={2}
            step={0.01}
            value={audioSource.volume}
            onChange={(e) => patch({ volume: Number(e.target.value) })}
            className="h-1 w-20 accent-primary"
            title="Volume"
          />
          <span className="font-mono text-[9px] tabular-nums">
            🔊 {Math.round(audioSource.volume * 100)}%
          </span>
          <button
            type="button"
            onClick={() => patch({ enabled: !audioSource.enabled })}
            className="ml-1 text-white/80 hover:text-white"
            title={audioSource.enabled ? "Désactiver" : "Activer"}
          >
            {audioSource.enabled ? (
              <Volume2 className="h-3 w-3" />
            ) : (
              <VolumeX className="h-3 w-3" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export function OverlayAudioLane({
  pxPerSec,
  width,
  height,
}: {
  pxPerSec: number;
  width: number;
  height: number;
}) {
  const overlay = useEditorStore((s) => s.audioOverlay);
  const patch = useEditorStore((s) => s.patchAudioOverlay);
  const setAudioSelection = useEditorStore((s) => s.setAudioSelection);
  const selection = useEditorStore((s) => s.audioSelection);
  const [pickerOpen, setPickerOpen] = useState(false);
  const fileDuration = useAudioDuration(overlay.asset_id);

  function onAssetPicked(asset: Asset) {
    patch({ asset_id: asset.id, start_offset: 0, trim_in: 0 });
    setPickerOpen(false);
    setAudioSelection("overlay");
  }

  if (overlay.asset_id == null) {
    return (
      <div
        className="relative border-b border-border bg-background/40"
        style={{ width, height }}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setPickerOpen(true);
          }}
          className="absolute left-2 top-1/2 flex -translate-y-1/2 items-center gap-1.5 rounded-md border border-dashed border-border bg-card px-2 py-0.5 text-[10px] text-muted-foreground transition hover:border-ring hover:text-foreground"
        >
          <Plus className="h-3 w-3" />
          Ajouter audio overlay
        </button>
        <AudioAssetPickerDialog
          open={pickerOpen}
          onPick={onAssetPicked}
          onOpenChange={setPickerOpen}
        />
      </div>
    );
  }

  const playableDuration =
    fileDuration != null ? Math.max(0.1, fileDuration - overlay.trim_in) : 5;
  const left = overlay.start_offset * pxPerSec;
  const blockWidth = Math.max(playableDuration * pxPerSec, 8);
  const selected = selection === "overlay";

  function startMove(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setAudioSelection("overlay");
    const startX = e.clientX;
    const startOffset = overlay.start_offset;
    function onMove(ev: MouseEvent) {
      const dx = ev.clientX - startX;
      patch({ start_offset: Math.max(0, startOffset + dx / pxPerSec) });
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function startTrimLeft(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setAudioSelection("overlay");
    const startX = e.clientX;
    const startTrim = overlay.trim_in;
    const startOffset = overlay.start_offset;
    function onMove(ev: MouseEvent) {
      const dx = ev.clientX - startX;
      const dt = dx / pxPerSec;
      const fileMax = fileDuration != null ? fileDuration - 0.1 : Infinity;
      const newTrim = Math.max(0, Math.min(fileMax, startTrim + dt));
      const realDt = newTrim - startTrim;
      // Premiere-style: left edge moves with the trim so visual length shrinks
      // from the left while keeping the block's right edge fixed.
      patch({
        trim_in: newTrim,
        start_offset: Math.max(0, startOffset + realDt),
      });
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return (
    <div
      className="relative border-b border-border bg-background/40"
      style={{ width, height }}
      onClick={(e) => {
        e.stopPropagation();
        setAudioSelection("overlay");
      }}
    >
      <div
        onMouseDown={startMove}
        className={cn(
          "absolute top-1 flex h-[calc(100%-8px)] cursor-grab items-center overflow-hidden rounded-sm border bg-pink-700/80 text-[10px] text-white active:cursor-grabbing",
          selected ? "border-foreground" : "border-transparent",
        )}
        style={{ left, width: blockWidth }}
      >
        <div
          onMouseDown={startTrimLeft}
          className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize bg-black/40"
        />
        <span className="pointer-events-none mx-2 truncate">
          🎵 overlay {fileDuration != null && `· ${playableDuration.toFixed(1)}s`}
        </span>
      </div>
    </div>
  );
}
