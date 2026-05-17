"use client";

import { Fragment, useRef, useState } from "react";
import { Film, ImageIcon, Snowflake, Square } from "lucide-react";

import { Templates } from "@/lib/api";
import { useEditorStore } from "@/store/editor";
import {
  clipDuration,
  clipStartTimes,
} from "@/lib/editor-types";
import { cn } from "@/lib/utils";

const ALLOWED_DROP_EXTS = [".mp4", ".mov", ".png", ".jpg", ".jpeg"];

type Props = {
  pxPerSec: number;
  width: number;
  height: number;
  /** Phase 28d — global timeline snap points (clip boundaries main +
   *  extras + playhead + 0/total). Used during edge trim so the user
   *  can resize a placeholder to align with a Track 2 clip start. */
  snapPoints?: number[];
};

/**
 * Main video track. Each clip is a tall strip with the file's first frame
 * as a stretched background (for fixed clips) or a yellow placeholder
 * marker. Drag a clip body to reorder. Drag the edges to trim.
 *
 * Files dropped from the desktop directly onto the track are uploaded as
 * fixed clips and appended to the timeline.
 */
export function ClipTrack({ pxPerSec, width, height, snapPoints }: Props) {
  const template = useEditorStore((s) => s.template);
  const clips = useEditorStore((s) => s.clips);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const setSelected = useEditorStore((s) => s.setSelectedClipId);
  const reorder = useEditorStore((s) => s.reorderClips);
  const patchClip = useEditorStore((s) => s.patchClip);
  const addFixed = useEditorStore((s) => s.addFixedClip);
  const addImageClip = useEditorStore((s) => s.addImageClip);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropHover, setDropHover] = useState(false);
  const [uploading, setUploading] = useState(false);

  const starts = clipStartTimes(clips);

  // Phase 28d — snap helper using the global snapPoints from parent.
  // Threshold ~10px en distance écran, converti en secondes via pxPerSec.
  const snapThresholdSec = 10 / Math.max(1, pxPerSec);
  function snapAbsTime(t: number): number {
    if (!snapPoints || snapPoints.length === 0) return t;
    let best = t;
    let bestD = snapThresholdSec;
    for (const p of snapPoints) {
      const d = Math.abs(t - p);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  /** Compute the clip's natural (no-freeze) duration. */
  function natDur(clip: import("@/lib/api").Clip): number {
    if (clip.type === "fixed") {
      if (clip.trim_out != null)
        return Math.max(0, clip.trim_out - clip.trim_in);
      return Math.max(0, (clip.source_duration_sec ?? 0) - clip.trim_in);
    }
    return Math.max(0, clip.duration_sec);
  }

  /** Drag the freeze sub-segment to move its position inside the clip
   *  (freeze_at_sec). Range: [0, naturalDur]. */
  function startFreezeMove(e: React.MouseEvent, clipIdx: number) {
    e.preventDefault();
    e.stopPropagation();
    const clip = clips[clipIdx];
    setSelected(clip.id);
    const startX = e.clientX;
    const initAt = clip.freeze_at_sec ?? 0;
    const nd = natDur(clip);

    function onMove(ev: MouseEvent) {
      const dt = (ev.clientX - startX) / pxPerSec;
      const next = Math.max(0, Math.min(nd, initAt + dt));
      patchClip(clip.id, { freeze_at_sec: next });
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  /** Drag the right edge of the freeze sub-segment to change its
   *  duration (freeze_duration_sec). */
  function startFreezeResize(e: React.MouseEvent, clipIdx: number) {
    e.preventDefault();
    e.stopPropagation();
    const clip = clips[clipIdx];
    setSelected(clip.id);
    const startX = e.clientX;
    const initDur = Math.max(0.1, clip.freeze_duration_sec ?? 0);

    function onMove(ev: MouseEvent) {
      const dt = (ev.clientX - startX) / pxPerSec;
      const next = Math.max(0.1, initDur + dt);
      patchClip(clip.id, { freeze_duration_sec: next });
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function startTrim(
    e: React.MouseEvent,
    clipIdx: number,
    edge: "left" | "right",
  ) {
    e.preventDefault();
    e.stopPropagation();
    const clip = clips[clipIdx];
    setSelected(clip.id);
    const startX = e.clientX;
    const clipAbsStart = starts[clipIdx];

    function onMove(ev: MouseEvent) {
      const dt = (ev.clientX - startX) / pxPerSec;

      if (clip.type === "placeholder" || clip.type === "image") {
        if (edge === "right") {
          // New clip duration → new absolute end. Snap absolute end.
          const newDurRaw = Math.max(0.1, clip.duration_sec + dt);
          const snappedEnd = snapAbsTime(clipAbsStart + newDurRaw);
          const newDur = Math.max(0.1, snappedEnd - clipAbsStart);
          patchClip(clip.id, { duration_sec: newDur });
        } else {
          // Left edge: shrink/grow duration symmetrically (main track is
          // sequential so we can't actually move the clip's start). Snap
          // the absolute end so the user feels alignment with other
          // tracks' edges when dragging.
          const newDurRaw = Math.max(0.1, clip.duration_sec - dt);
          const snappedEnd = snapAbsTime(clipAbsStart + newDurRaw);
          const newDur = Math.max(0.1, snappedEnd - clipAbsStart);
          patchClip(clip.id, { duration_sec: newDur });
        }
        return;
      }

      // Fixed video clip
      if (edge === "right") {
        const maxOut = clip.source_duration_sec ?? Infinity;
        const initOut = clip.trim_out ?? clip.source_duration_sec ?? 0;
        const proposedTrimOut = Math.max(
          clip.trim_in + 0.1,
          Math.min(maxOut, initOut + dt),
        );
        // Convert trim_out to ABSOLUTE timeline end, snap, convert back.
        const absEndRaw =
          clipAbsStart + (proposedTrimOut - clip.trim_in);
        const snappedAbsEnd = snapAbsTime(absEndRaw);
        const newTrimOut = Math.max(
          clip.trim_in + 0.1,
          Math.min(maxOut, clip.trim_in + (snappedAbsEnd - clipAbsStart)),
        );
        patchClip(clip.id, { trim_out: newTrimOut });
      } else {
        // Left edge of fixed clip = adjust trim_in. Snap the resulting
        // clip duration (= trim_out - trim_in) against the timeline by
        // snapping the absolute END (which is clipAbsStart + duration).
        // Symmetric snap to the right edge means alignment works on
        // both sides.
        const initIn = clip.trim_in;
        const maxIn = (clip.trim_out ?? clip.source_duration_sec ?? 0) - 0.1;
        const proposedTrimIn = Math.max(0, Math.min(maxIn, initIn + dt));
        const proposedDur =
          (clip.trim_out ?? clip.source_duration_sec ?? 0) - proposedTrimIn;
        const snappedAbsEnd = snapAbsTime(clipAbsStart + proposedDur);
        const snappedDur = Math.max(0.1, snappedAbsEnd - clipAbsStart);
        const snappedTrimIn = Math.max(
          0,
          Math.min(
            maxIn,
            (clip.trim_out ?? clip.source_duration_sec ?? 0) - snappedDur,
          ),
        );
        patchClip(clip.id, { trim_in: snappedTrimIn });
      }
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  async function onDropFiles(files: FileList | null) {
    if (!template || !files || files.length === 0) return;
    const valid: File[] = [];
    for (const f of Array.from(files)) {
      const lower = f.name.toLowerCase();
      if (ALLOWED_DROP_EXTS.some((e) => lower.endsWith(e))) valid.push(f);
    }
    if (valid.length === 0) return;
    setUploading(true);
    try {
      for (const f of valid) {
        const res = await Templates.uploadClip(template.id, f);
        if (res.kind === "image") {
          addImageClip(res.file_id, res.width, res.height);
        } else {
          addFixed(res.file_id, res.duration_sec, res.width, res.height);
        }
      }
    } finally {
      setUploading(false);
    }
  }

  return (
    <div
      className={cn(
        "relative border-b border-border bg-background/40 transition",
        dropHover && "bg-primary/10 ring-2 ring-primary",
      )}
      style={{ width, height }}
      onDragOver={(e) => {
        e.preventDefault();
        if (e.dataTransfer.types.includes("Files")) setDropHover(true);
      }}
      onDragLeave={() => setDropHover(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDropHover(false);
        void onDropFiles(e.dataTransfer.files);
      }}
    >
      {clips.length === 0 && !uploading && (
        <div className="absolute inset-0 flex items-center justify-center text-[11px] text-muted-foreground">
          Drop tes vidéos ici, ou clique « + Vidéo / + Placeholder » au-dessus
        </div>
      )}
      {uploading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-xs text-white">
          Upload en cours…
        </div>
      )}

      {clips.map((clip, i) => {
        const totalDur = clipDuration(clip);
        const freezeActive =
          clip.freeze_at_sec != null && (clip.freeze_duration_sec ?? 0) > 0;
        const freezeAt = freezeActive ? (clip.freeze_at_sec ?? 0) : 0;
        const freezeDur = freezeActive
          ? Math.max(0, clip.freeze_duration_sec ?? 0)
          : 0;
        const naturalDur = totalDur - freezeDur;
        const left = starts[i] * pxPerSec;
        const wTotal = Math.max(totalDur * pxPerSec, 8);
        const isPlaceholder = clip.type === "placeholder";
        const isImage = clip.type === "image";
        const isFixed = clip.type === "fixed";
        const isSelected = clip.id === selectedClipId;

        // Phase 27 — for fixed videos, prefer the wide filmstrip (multiple
        // frames tiled horizontally) over the single thumbnail. The
        // browser falls back to the single thumb if the strip endpoint
        // 404s (older clips). Image clips keep using the single thumb
        // (a static image).
        const thumbUrl =
          template && isFixed
            ? `/api/files/template_clip_strip/${template.id}/${clip.file_id}`
            : template && isImage
              ? `/api/files/template_clip_thumb/${template.id}/${clip.file_id}`
              : null;

        return (
          <Fragment key={clip.id}>
            <div
              draggable
              onDragStart={(e) => {
                setDragIdx(i);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", String(i));
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const fromStr = e.dataTransfer.getData("text/plain");
                const from = Number(fromStr);
                if (Number.isFinite(from) && from !== i) reorder(from, i);
                setDragIdx(null);
              }}
              onDragEnd={() => setDragIdx(null)}
              onClick={(e) => {
                e.stopPropagation();
                setSelected(clip.id);
              }}
              className={cn(
                "absolute top-1 cursor-pointer overflow-hidden rounded-md border-2 transition",
                isPlaceholder
                  ? "border-dashed border-yellow-500/70 bg-yellow-700/30"
                  : isImage
                    ? "border-solid border-transparent bg-emerald-700/80 hover:bg-emerald-600/80"
                    : "border-solid border-transparent bg-violet-700/80 hover:bg-violet-600/80",
                isSelected && "border-foreground shadow-lg",
              )}
              style={{
                left,
                width: wTotal,
                height: "calc(100% - 8px)",
                backgroundImage: thumbUrl ? `url(${thumbUrl})` : undefined,
                backgroundSize: isFixed
                  ? "100% 100%"
                  : isImage
                    ? "cover"
                    : "auto 100%",
                backgroundRepeat: "no-repeat",
                backgroundPosition: "center",
              }}
              title={
                freezeActive
                  ? `${isPlaceholder ? "Placeholder" : isImage ? "Image" : "Clip"} · ${naturalDur.toFixed(1)}s + freeze ${freezeDur.toFixed(1)}s`
                  : isPlaceholder
                    ? `Placeholder · ${naturalDur.toFixed(1)}s`
                    : isImage
                      ? `Image · ${naturalDur.toFixed(1)}s`
                      : `Clip · ${naturalDur.toFixed(1)}s`
              }
            >
              <div
                className={cn(
                  "absolute inset-0",
                  isPlaceholder ? "bg-yellow-700/30" : "bg-black/30",
                )}
              />

              <div
                onMouseDown={(e) => startTrim(e, i, "left")}
                className="absolute left-0 top-0 z-10 h-full w-2 cursor-ew-resize bg-foreground/30 hover:bg-foreground/60"
              />
              <div
                onMouseDown={(e) => startTrim(e, i, "right")}
                className="absolute right-0 top-0 z-10 h-full w-2 cursor-ew-resize bg-foreground/30 hover:bg-foreground/60"
              />

              <div className="absolute left-3 top-1.5 z-[1] flex items-center gap-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                {isPlaceholder ? (
                  <Square className="h-3 w-3" />
                ) : isImage ? (
                  <ImageIcon className="h-3 w-3" />
                ) : (
                  <Film className="h-3 w-3" />
                )}
                <span className="truncate">
                  {isPlaceholder
                    ? "Placeholder"
                    : isImage
                      ? `Image ${i + 1}`
                      : `Clip ${i + 1}`}
                  {" · "}
                  {naturalDur.toFixed(1)}s
                </span>
              </div>
            </div>

            {/* Freeze sub-segment — visible only when freeze_at_sec is
                set. Positioned INSIDE the clip body at freeze_at_sec
                (timeline-mapped), with width = freeze_duration_sec.
                Drag the body to move position, drag the right edge to
                resize the duration. The freeze_filter (B&W independent)
                is reflected by a small ❄ + bw icon at the top-left. */}
            {freezeActive && (
              <div
                onMouseDown={(e) => startFreezeMove(e, i)}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelected(clip.id);
                }}
                className={cn(
                  "absolute top-1 z-[2] cursor-grab overflow-hidden rounded border border-cyan-300/80 bg-cyan-900/60 backdrop-blur-[1px] transition",
                  isSelected && "ring-1 ring-foreground/70",
                )}
                style={{
                  left: left + freezeAt * pxPerSec,
                  width: Math.max(freezeDur * pxPerSec, 6),
                  height: "calc(100% - 8px)",
                }}
                title={`❄ Freeze · ${freezeDur.toFixed(1)}s @ ${freezeAt.toFixed(1)}s${(clip.freeze_filter ?? "none") === "bw" ? " · N&B" : ""}`}
              >
                {/* Right-edge handle = resize freeze duration */}
                <div
                  onMouseDown={(e) => startFreezeResize(e, i)}
                  className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-ew-resize bg-cyan-200/70 hover:bg-cyan-100"
                />
                <div className="absolute left-1 top-1 z-[1] flex items-center gap-1 rounded bg-cyan-950/80 px-1 py-0.5 text-[9px] text-cyan-100">
                  <Snowflake className="h-3 w-3" />
                  {freezeDur * pxPerSec > 50 && (
                    <span className="truncate">
                      {freezeDur.toFixed(1)}s
                      {(clip.freeze_filter ?? "none") === "bw" ? " · N&B" : ""}
                    </span>
                  )}
                </div>
              </div>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
