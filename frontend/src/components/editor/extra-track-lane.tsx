"use client";

import { Fragment, useRef, useState } from "react";
import {
  Film,
  Headphones,
  ImageIcon,
  Snowflake,
  Square,
  Trash2,
} from "lucide-react";

import { Templates, type ExtraClip } from "@/lib/api";
import { useEditorStore, type ExtraTrack } from "@/store/editor";
import { cn } from "@/lib/utils";

type Props = {
  track: ExtraTrack;
  trackIndex: number;
  pxPerSec: number;
  width: number;
  height: number;
  /** Absolute time-axis snap points (clip boundaries, playhead, …). */
  snapPoints: number[];
};

const SNAP_PX = 10;
const ALLOWED_DROP_EXTS = [".mp4", ".mov", ".png", ".jpg", ".jpeg"];

function clipDuration(c: ExtraClip): number {
  if (c.type === "fixed") {
    if (c.trim_out != null)
      return Math.max(0.1, c.trim_out - c.trim_in);
    if (c.source_duration_sec != null)
      return Math.max(0.1, c.source_duration_sec - c.trim_in);
    return 3;
  }
  return Math.max(0.1, c.duration_sec);
}

/**
 * One lane for an extra video track. Clips are positioned ABSOLUTELY on
 * the timeline via their `start_time`. Drag a clip body to reposition;
 * snaps to global timeline points (clip boundaries, playhead, etc).
 *
 * Phase 26b — minimal but functional. No edge-trim handles yet (use the
 * inspector for now). Files dropped from desktop become clips on this
 * track at the drop X position.
 */
export function ExtraTrackLane({
  track,
  trackIndex,
  pxPerSec,
  width,
  height,
  snapPoints,
}: Props) {
  const template = useEditorStore((s) => s.template);
  const templateId = template?.id;
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const selectedExtraTrackId = useEditorStore((s) => s.selectedExtraTrackId);
  const setSelectedExtraClip = useEditorStore((s) => s.setSelectedExtraClip);
  const patchExtraClip = useEditorStore((s) => s.patchExtraClip);
  const deleteExtraTrack = useEditorStore((s) => s.deleteExtraTrack);
  const renameExtraTrack = useEditorStore((s) => s.renameExtraTrack);
  const addExtraFixedClip = useEditorStore((s) => s.addExtraFixedClip);
  const addExtraImageClip = useEditorStore((s) => s.addExtraImageClip);
  const addExtraPlaceholderClip = useEditorStore(
    (s) => s.addExtraPlaceholderClip,
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dropHover, setDropHover] = useState(false);

  const snapThreshold = SNAP_PX / Math.max(1, pxPerSec);

  function snapTime(t: number): number {
    let best = t;
    let bestD = snapThreshold;
    for (const p of snapPoints) {
      const d = Math.abs(t - p);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return Math.max(0, best);
  }

  function startMove(e: React.MouseEvent, clip: ExtraClip) {
    e.stopPropagation();
    setSelectedExtraClip(track.id, clip.id);
    const startX = e.clientX;
    const initStart = clip.start_time;
    const dur = clipDuration(clip);

    function onMove(ev: MouseEvent) {
      const dt = (ev.clientX - startX) / pxPerSec;
      let newStart = Math.max(0, initStart + dt);
      // Snap leading edge
      const snappedLeft = snapTime(newStart);
      const snappedRight = snapTime(newStart + dur);
      if (snappedLeft !== newStart) newStart = snappedLeft;
      else if (snappedRight !== newStart + dur)
        newStart = Math.max(0, snappedRight - dur);
      patchExtraClip(track.id, clip.id, { start_time: newStart });
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  /** Drag the LEFT edge of an extra clip — moves start_time forward
   *  while keeping the right edge fixed (so duration shrinks/grows
   *  symmetrically). For fixed videos, also adjusts trim_in so the
   *  clip's content stays in sync. */
  function startTrimLeft(e: React.MouseEvent, clip: ExtraClip) {
    e.preventDefault();
    e.stopPropagation();
    setSelectedExtraClip(track.id, clip.id);
    const startX = e.clientX;
    const initStart = clip.start_time;
    const initEnd = initStart + clipDuration(clip);
    const initTrimIn = clip.type === "fixed" ? clip.trim_in : 0;

    function onMove(ev: MouseEvent) {
      const dt = (ev.clientX - startX) / pxPerSec;
      let newStart = Math.max(0, Math.min(initEnd - 0.1, initStart + dt));
      newStart = snapTime(newStart);
      newStart = Math.max(0, Math.min(initEnd - 0.1, newStart));
      const consumed = newStart - initStart;

      if (clip.type === "fixed") {
        const newTrimIn = Math.max(0, initTrimIn + consumed);
        patchExtraClip(track.id, clip.id, {
          start_time: newStart,
          trim_in: newTrimIn,
        });
      } else if (clip.type === "image" || clip.type === "placeholder") {
        // No source-time concept — just shrink duration accordingly.
        patchExtraClip(track.id, clip.id, {
          start_time: newStart,
          duration_sec: Math.max(0.1, initEnd - newStart),
        });
      }
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  /** Compute the clip's natural duration (excl. freeze). */
  function natDur(c: ExtraClip): number {
    if (c.type === "fixed") {
      if (c.trim_out != null) return Math.max(0, c.trim_out - c.trim_in);
      return Math.max(0, (c.source_duration_sec ?? 0) - c.trim_in);
    }
    return Math.max(0, c.duration_sec);
  }

  /** Drag the freeze sub-segment body to move its position inside the
   *  clip (freeze_at_sec). */
  function startFreezeMove(e: React.MouseEvent, clip: ExtraClip) {
    e.preventDefault();
    e.stopPropagation();
    setSelectedExtraClip(track.id, clip.id);
    const startX = e.clientX;
    const initAt = clip.freeze_at_sec ?? 0;
    const nd = natDur(clip);

    function onMove(ev: MouseEvent) {
      const dt = (ev.clientX - startX) / pxPerSec;
      const next = Math.max(0, Math.min(nd, initAt + dt));
      patchExtraClip(track.id, clip.id, { freeze_at_sec: next });
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  /** Drag the right edge of the freeze sub-segment to resize. */
  function startFreezeResize(e: React.MouseEvent, clip: ExtraClip) {
    e.preventDefault();
    e.stopPropagation();
    setSelectedExtraClip(track.id, clip.id);
    const startX = e.clientX;
    const initDur = Math.max(0.1, clip.freeze_duration_sec ?? 0);

    function onMove(ev: MouseEvent) {
      const dt = (ev.clientX - startX) / pxPerSec;
      const next = Math.max(0.1, initDur + dt);
      patchExtraClip(track.id, clip.id, { freeze_duration_sec: next });
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  /** Drag the RIGHT edge — extends/shrinks the clip's duration. */
  function startTrimRight(e: React.MouseEvent, clip: ExtraClip) {
    e.preventDefault();
    e.stopPropagation();
    setSelectedExtraClip(track.id, clip.id);
    const startX = e.clientX;
    const initEnd = clip.start_time + clipDuration(clip);
    const initTrimIn = clip.type === "fixed" ? clip.trim_in : 0;
    const initTrimOut = clip.type === "fixed" ? clip.trim_out : null;
    const initDuration = clip.type !== "fixed" ? clip.duration_sec : 0;
    const sourceDur =
      clip.type === "fixed" ? (clip.source_duration_sec ?? Infinity) : Infinity;

    function onMove(ev: MouseEvent) {
      const dt = (ev.clientX - startX) / pxPerSec;
      let newEnd = Math.max(clip.start_time + 0.1, initEnd + dt);
      newEnd = snapTime(newEnd);
      newEnd = Math.max(clip.start_time + 0.1, newEnd);

      if (clip.type === "fixed") {
        const newTrimOut = Math.min(
          sourceDur,
          (initTrimOut ?? initTrimIn + (initEnd - clip.start_time)) +
            (newEnd - initEnd),
        );
        patchExtraClip(track.id, clip.id, { trim_out: newTrimOut });
      } else if (clip.type === "image" || clip.type === "placeholder") {
        patchExtraClip(track.id, clip.id, {
          duration_sec: Math.max(0.1, initDuration + (newEnd - initEnd)),
        });
      }
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  async function uploadFileAt(file: File, atSec: number) {
    if (!template) return;
    setUploading(true);
    try {
      const res = await Templates.uploadClip(template.id, file);
      if (res.kind === "image") {
        addExtraImageClip(
          track.id,
          res.file_id,
          res.width,
          res.height,
          atSec,
        );
      } else {
        addExtraFixedClip(
          track.id,
          res.file_id,
          res.duration_sec,
          res.width,
          res.height,
          atSec,
        );
      }
    } finally {
      setUploading(false);
    }
  }

  function clientXToSec(clientX: number, container: HTMLElement): number {
    const rect = container.getBoundingClientRect();
    return Math.max(0, (clientX - rect.left + container.scrollLeft) / pxPerSec);
  }

  return (
    <div
      className={cn(
        "relative border-b border-border bg-background/30",
        dropHover && "ring-2 ring-primary",
      )}
      style={{ width, height }}
      onClick={() => setSelectedExtraClip(null, null)}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDropHover(true);
        }
      }}
      onDragLeave={() => setDropHover(false)}
      onDrop={async (e) => {
        e.preventDefault();
        setDropHover(false);
        const files = Array.from(e.dataTransfer.files).filter((f) =>
          ALLOWED_DROP_EXTS.some((ext) =>
            f.name.toLowerCase().endsWith(ext),
          ),
        );
        if (files.length === 0) return;
        const at = clientXToSec(e.clientX, e.currentTarget);
        for (const f of files) {
          await uploadFileAt(f, at);
        }
      }}
    >
      {/* Track header (absolute, top-left over the lane) */}
      <div className="pointer-events-none absolute left-1 top-0.5 z-10 flex items-center gap-1">
        <input
          type="text"
          value={track.name}
          onChange={(e) => renameExtraTrack(track.id, e.target.value)}
          onClick={(e) => e.stopPropagation()}
          className="pointer-events-auto rounded bg-black/40 px-1.5 py-0.5 text-[10px] text-white outline-none ring-0 focus:ring-1 focus:ring-primary"
          style={{ width: 80 }}
        />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            deleteExtraTrack(track.id);
          }}
          className="pointer-events-auto rounded bg-black/40 p-0.5 text-white/70 transition hover:bg-destructive/80 hover:text-white"
          title="Supprimer cette track"
          aria-label="Supprimer track"
        >
          <Trash2 className="h-3 w-3" />
        </button>
        {/* + clip mini menu */}
        <div className="pointer-events-auto flex gap-0.5">
          <input
            ref={fileInputRef}
            type="file"
            accept="video/mp4,video/quicktime,image/png,image/jpeg,.mp4,.mov,.png,.jpg,.jpeg"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) await uploadFileAt(f, 0);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              fileInputRef.current?.click();
            }}
            disabled={uploading}
            className="rounded bg-black/40 p-0.5 text-white/70 transition hover:bg-black/70 hover:text-white disabled:opacity-50"
            title="Ajouter une vidéo / image sur cette track"
          >
            <Film className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              addExtraPlaceholderClip(track.id, 0);
            }}
            className="rounded bg-black/40 p-0.5 text-white/70 transition hover:bg-black/70 hover:text-white"
            title="Ajouter un placeholder sur cette track"
          >
            <Square className="h-3 w-3" />
          </button>
        </div>
        <span className="rounded bg-black/40 px-1 text-[9px] text-white/70">
          T{trackIndex + 2}
        </span>
      </div>

      {/* Clips */}
      {track.clips.map((c) => {
        const totalDur = clipDuration(c);
        const freezeActive =
          c.freeze_at_sec != null && (c.freeze_duration_sec ?? 0) > 0;
        const freezeAt = freezeActive ? (c.freeze_at_sec ?? 0) : 0;
        const freezeDur = freezeActive
          ? Math.max(0, c.freeze_duration_sec ?? 0)
          : 0;
        const naturalDur = totalDur - freezeDur;
        const isSelected =
          selectedClipId === c.id && selectedExtraTrackId === track.id;
        const isAudioOnly = c.video_enabled === false;
        const left = c.start_time * pxPerSec;
        const w = Math.max(2, totalDur * pxPerSec);
        // Phase 26c — palette identique à la main track pour cohérence.
        // Phase 28 — quand video_enabled=false (audio only), on diagonale
        // le fond pour signaler visuellement.
        const palette = isAudioOnly
          ? "bg-violet-900/40 border border-dashed border-violet-400/70"
          : c.type === "fixed"
            ? "bg-violet-700/85 hover:bg-violet-600/85"
            : c.type === "image"
              ? "bg-emerald-700/85 hover:bg-emerald-600/85"
              : "bg-yellow-700/40 border-2 border-dashed border-yellow-500/70";
        // Phase 27 — filmstrip background for video clips, single
        // thumbnail for images, none for placeholders. Phase 28 — when
        // audio-only, no thumbnail (the clip is visually muted).
        const thumbUrl =
          isAudioOnly
            ? null
            : templateId && c.type === "fixed"
              ? `/api/files/template_clip_strip/${templateId}/${c.file_id}`
              : templateId && c.type === "image"
                ? `/api/files/template_clip_thumb/${templateId}/${c.file_id}`
                : null;
        return (
          <Fragment key={c.id}>
            <div
              onMouseDown={(e) => startMove(e, c)}
              onClick={(e) => {
                e.stopPropagation();
                setSelectedExtraClip(track.id, c.id);
              }}
              className={cn(
                "absolute top-1.5 flex cursor-grab items-center overflow-hidden rounded text-[10px] text-white shadow transition",
                palette,
                isSelected && "ring-2 ring-foreground",
              )}
              style={{
                left,
                width: w,
                height: height - 8,
                backgroundImage: thumbUrl ? `url(${thumbUrl})` : undefined,
                backgroundSize:
                  c.type === "fixed"
                    ? "100% 100%"
                    : c.type === "image"
                      ? "cover"
                      : undefined,
                backgroundRepeat: "no-repeat",
                backgroundPosition: "center",
              }}
              title={`${c.type} · start ${c.start_time.toFixed(2)}s · dur ${naturalDur.toFixed(2)}s`}
            >
              {thumbUrl && (
                <div className="pointer-events-none absolute inset-0 bg-black/20" />
              )}
              <div
                onMouseDown={(e) => startTrimLeft(e, c)}
                className="absolute left-0 top-0 z-10 h-full w-1.5 cursor-ew-resize bg-white/20 hover:bg-white/50"
                title="Glisse pour rogner le début"
              />
              <div
                onMouseDown={(e) => startTrimRight(e, c)}
                className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-ew-resize bg-white/20 hover:bg-white/50"
                title="Glisse pour rogner la fin"
              />
              <div className="flex items-center gap-1 px-2 py-0.5">
                {isAudioOnly ? (
                  <Headphones className="h-3 w-3" />
                ) : c.type === "fixed" ? (
                  <Film className="h-3 w-3" />
                ) : c.type === "image" ? (
                  <ImageIcon className="h-3 w-3" />
                ) : (
                  <Square className="h-3 w-3" />
                )}
                <span className="truncate font-medium">
                  {isAudioOnly
                    ? "Audio only"
                    : c.type === "fixed"
                      ? "Vidéo"
                      : c.type === "image"
                        ? "Image"
                        : "Placeholder"}
                </span>
              </div>
            </div>

            {/* Freeze sub-segment INSIDE the clip at freeze_at_sec.
                Drag body = move position. Drag right edge = resize. */}
            {freezeActive && (
              <div
                onMouseDown={(e) => startFreezeMove(e, c)}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedExtraClip(track.id, c.id);
                }}
                className={cn(
                  "absolute top-1.5 z-[2] cursor-grab overflow-hidden rounded border border-cyan-300/80 bg-cyan-900/60 backdrop-blur-[1px] transition",
                  isSelected && "ring-1 ring-foreground/70",
                )}
                style={{
                  left: left + freezeAt * pxPerSec,
                  width: Math.max(freezeDur * pxPerSec, 6),
                  height: height - 8,
                }}
                title={`❄ Freeze · ${freezeDur.toFixed(1)}s @ ${freezeAt.toFixed(1)}s${(c.freeze_filter ?? "none") === "bw" ? " · N&B" : ""}`}
              >
                <div
                  onMouseDown={(e) => startFreezeResize(e, c)}
                  className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-ew-resize bg-cyan-200/70 hover:bg-cyan-100"
                />
                <div className="absolute left-1 top-1 z-[1] flex items-center gap-1 rounded bg-cyan-950/80 px-1 py-0.5 text-[9px] text-cyan-100">
                  <Snowflake className="h-3 w-3" />
                  {freezeDur * pxPerSec > 50 && (
                    <span className="truncate">
                      {freezeDur.toFixed(1)}s
                      {(c.freeze_filter ?? "none") === "bw" ? " · N&B" : ""}
                    </span>
                  )}
                </div>
              </div>
            )}
          </Fragment>
        );
      })}

      {uploading && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40 text-[10px] text-white">
          Upload…
        </div>
      )}
    </div>
  );
}
