"use client";

import { useRef } from "react";
import { Music, Plus } from "lucide-react";

import { Templates } from "@/lib/api";
import { useEditorStore } from "@/store/editor";
import { totalDuration } from "@/lib/editor-types";
import { cn } from "@/lib/utils";
import { useAudioDuration } from "./use-audio-duration";

export function OverlayAudioLane({
  pxPerSec,
  width,
  height,
}: {
  pxPerSec: number;
  width: number;
  height: number;
}) {
  const template = useEditorStore((s) => s.template);
  const overlay = useEditorStore((s) => s.audioOverlay);
  const patch = useEditorStore((s) => s.patchAudioOverlay);
  const setAudioSelected = useEditorStore((s) => s.setAudioSelected);
  const audioSelected = useEditorStore((s) => s.audioSelected);
  const clips = useEditorStore((s) => s.clips);
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
    setAudioSelected(true);
  }

  if (!overlay.file_id) {
    return (
      <div
        className="relative border-b border-border bg-background/40"
        style={{ width, height }}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            inputRef.current?.click();
          }}
          className="absolute left-2 top-1/2 flex -translate-y-1/2 items-center gap-1.5 rounded-md border border-dashed border-border bg-card px-2 py-0.5 text-[10px] text-muted-foreground transition hover:border-ring hover:text-foreground"
        >
          <Plus className="h-3 w-3" />
          Ajouter audio overlay
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="audio/mpeg,audio/wav,audio/mp4,audio/x-m4a,.mp3,.wav,.m4a"
          className="hidden"
          onChange={onPickFile}
        />
      </div>
    );
  }

  const playableDuration =
    fileDuration != null ? Math.max(0.1, fileDuration - overlay.trim_in) : 5;
  const left = overlay.start_offset * pxPerSec;
  const blockWidth = Math.max(playableDuration * pxPerSec, 8);

  function startMove(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setAudioSelected(true);
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
    setAudioSelected(true);
    const startX = e.clientX;
    const startTrim = overlay.trim_in;
    const startOffset = overlay.start_offset;
    function onMove(ev: MouseEvent) {
      const dx = ev.clientX - startX;
      const dt = dx / pxPerSec;
      const fileMax = fileDuration != null ? fileDuration - 0.1 : Infinity;
      const newTrim = Math.max(0, Math.min(fileMax, startTrim + dt));
      const realDt = newTrim - startTrim;
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
        setAudioSelected(true);
      }}
    >
      <div
        onMouseDown={startMove}
        className={cn(
          "absolute top-1 flex h-[calc(100%-8px)] cursor-grab items-center overflow-hidden rounded-sm border bg-pink-700/80 text-[10px] text-white active:cursor-grabbing",
          audioSelected ? "border-foreground" : "border-transparent",
        )}
        style={{ left, width: blockWidth }}
      >
        <div
          onMouseDown={startTrimLeft}
          className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize bg-black/40"
        />
        <Music className="ml-2 h-3 w-3" />
        <span className="pointer-events-none mx-2 truncate">
          overlay {fileDuration != null && `· ${playableDuration.toFixed(1)}s`}
        </span>
      </div>
    </div>
  );
}
