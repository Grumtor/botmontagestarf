"use client";

import { useRef, useState } from "react";
import { Film, Plus, Square } from "lucide-react";

import { Templates } from "@/lib/api";
import { useEditorStore } from "@/store/editor";
import {
  clipDuration,
  clipStartTimes,
} from "@/lib/editor-types";
import { cn } from "@/lib/utils";

type Props = {
  pxPerSec: number;
  width: number;
  height: number;
};

/**
 * The main video track. Clips sit side by side. Each clip is either a
 * fixed video (uploaded with the template) or a placeholder slot.
 *
 * Drag a clip to reorder. Click to select. The "+ Vidéo" / "+ Placeholder"
 * controls live in the timeline header (not here).
 */
export function ClipTrack({ pxPerSec, width, height }: Props) {
  const clips = useEditorStore((s) => s.clips);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const setSelected = useEditorStore((s) => s.setSelectedClipId);
  const reorder = useEditorStore((s) => s.reorderClips);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const starts = clipStartTimes(clips);

  return (
    <div
      className="relative border-b border-border bg-background/40"
      style={{ width, height }}
    >
      {clips.length === 0 && (
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
          Ajoute des clips depuis l&apos;en-tête de la timeline →
        </span>
      )}

      {clips.map((clip, i) => {
        const dur = clipDuration(clip);
        const left = starts[i] * pxPerSec;
        const w = Math.max(dur * pxPerSec, 8);
        const isPlaceholder = clip.type === "placeholder";
        const isSelected = clip.id === selectedClipId;
        return (
          <div
            key={clip.id}
            draggable
            onDragStart={(e) => {
              setDragIdx(i);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIdx !== null && dragIdx !== i) reorder(dragIdx, i);
              setDragIdx(null);
            }}
            onDragEnd={() => setDragIdx(null)}
            onClick={(e) => {
              e.stopPropagation();
              setSelected(clip.id);
            }}
            className={cn(
              "absolute top-1 flex h-[calc(100%-8px)] cursor-pointer items-center overflow-hidden rounded-sm border-2 text-[10px] text-white transition",
              isPlaceholder
                ? "border-dashed border-yellow-500/70 bg-yellow-700/30"
                : "border-solid border-transparent bg-sky-700/80 hover:bg-sky-600/80",
              isSelected && "border-foreground",
            )}
            style={{ left, width: w }}
            title={
              isPlaceholder
                ? `Placeholder · ${dur.toFixed(1)}s`
                : `Clip · ${dur.toFixed(1)}s`
            }
          >
            <div className="ml-2 flex items-center gap-1">
              {isPlaceholder ? (
                <Square className="h-3 w-3" />
              ) : (
                <Film className="h-3 w-3" />
              )}
              <span className="truncate">
                {isPlaceholder ? "Placeholder" : "Vidéo"} #{i + 1}
                {" · "}
                {dur.toFixed(1)}s
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Header with the two "+ Vidéo" / "+ Placeholder" buttons, shown above
 * the clip track. */
export function ClipTrackHeader() {
  const template = useEditorStore((s) => s.template);
  const addFixed = useEditorStore((s) => s.addFixedClip);
  const addPlaceholder = useEditorStore((s) => s.addPlaceholderClip);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    if (!template) return;
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const res = await Templates.uploadClip(template.id, file);
      addFixed(res.file_id, res.duration_sec, res.width, res.height);
    } catch (err) {
      console.error("clip upload failed", err);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-1.5">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        Vidéo
      </span>
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className="flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[11px] transition hover:bg-accent disabled:opacity-50"
      >
        <Plus className="h-3 w-3" />
        {uploading ? "Upload…" : "Vidéo"}
      </button>
      <button
        type="button"
        onClick={() => addPlaceholder(3)}
        className="flex items-center gap-1 rounded-md border border-dashed border-yellow-500/60 px-2 py-0.5 text-[11px] text-yellow-300 transition hover:bg-yellow-700/20"
      >
        <Plus className="h-3 w-3" />
        Placeholder
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="video/mp4,video/quicktime,.mp4,.mov"
        className="hidden"
        onChange={onPickFile}
      />
    </div>
  );
}
