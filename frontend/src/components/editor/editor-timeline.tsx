"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { useEditorStore } from "@/store/editor";
import {
  LAYER_COLORS,
  LAYER_LABELS,
  clamp,
  formatTime,
  totalDuration,
} from "@/lib/editor-types";
import { cn } from "@/lib/utils";
import type { Layer } from "@/lib/api";
import { ClipTrack } from "./clip-track";
import { OverlayAudioLane } from "./audio-tracks";
import { TimelineActionBar } from "./timeline-action-bar";

const RULER_HEIGHT = 28;
const CLIP_TRACK_HEIGHT = 70;
const AUDIO_TRACK_HEIGHT = 50;
const LAYER_TRACK_HEIGHT = 40;
const TRACK_GAP = 6;
const LABEL_WIDTH = 130;
const MIN_PX_PER_SEC = 20;
const MAX_PX_PER_SEC = 400;
const MIN_LAYER_DURATION = 0.1;

export function EditorTimeline() {
  const layers = useEditorStore((s) => s.layers);
  const clips = useEditorStore((s) => s.clips);
  const currentTime = useEditorStore((s) => s.currentTime);
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);
  const selectedLayerId = useEditorStore((s) => s.selectedLayerId);
  const setSelected = useEditorStore((s) => s.setSelectedLayerId);
  const patchLayer = useEditorStore((s) => s.patchLayer);

  const duration = Math.max(1, totalDuration(clips));
  const [pxPerSec, setPxPerSec] = useState(60);
  const [audioOpen, setAudioOpen] = useState(true);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      setPxPerSec((p) => clamp(p * factor, MIN_PX_PER_SEC, MAX_PX_PER_SEC));
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const tracksWidth = Math.max(duration * pxPerSec, 200);
  const layerTracks = [...layers].reverse();
  const audioH = audioOpen ? AUDIO_TRACK_HEIGHT : 0;
  const totalTracksHeight =
    CLIP_TRACK_HEIGHT +
    TRACK_GAP +
    audioH +
    (audioOpen ? TRACK_GAP : 0) +
    layerTracks.length * (LAYER_TRACK_HEIGHT + TRACK_GAP);

  const scrubFromX = useCallback(
    (clientX: number, container: HTMLDivElement) => {
      const rect = container.getBoundingClientRect();
      const x = clientX - rect.left + container.scrollLeft;
      const t = clamp(x / pxPerSec, 0, duration);
      setCurrentTime(t);
    },
    [pxPerSec, duration, setCurrentTime],
  );

  function onRulerDown(e: React.MouseEvent) {
    if (!scrollerRef.current) return;
    const container = scrollerRef.current;
    scrubFromX(e.clientX, container);
    function onMove(ev: MouseEvent) {
      scrubFromX(ev.clientX, container);
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return (
    <div className="flex shrink-0 flex-col border-t border-border bg-card" style={{ height: "55vh" }}>
      <TimelineActionBar />
      <div className="flex flex-1 min-h-0">
        {/* Track labels (sticky left) */}
        <div
          className="flex shrink-0 flex-col border-r border-border bg-background text-xs"
          style={{ width: LABEL_WIDTH }}
        >
          <div
            className="flex items-center justify-between border-b border-border px-2 text-[10px] uppercase tracking-wider text-muted-foreground"
            style={{ height: RULER_HEIGHT }}
          >
            <span>Pistes</span>
            <span className="font-mono">{Math.round(pxPerSec)} px/s</span>
          </div>
          <TrackLabel label="Vidéo" height={CLIP_TRACK_HEIGHT + TRACK_GAP} />
          <button
            type="button"
            onClick={() => setAudioOpen((v) => !v)}
            className="flex items-center gap-1 truncate border-b border-border px-2 text-left transition hover:bg-accent/30"
            style={{ height: (audioOpen ? AUDIO_TRACK_HEIGHT : 24) + TRACK_GAP }}
            title={audioOpen ? "Replier la piste audio" : "Déplier la piste audio"}
          >
            {audioOpen ? (
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
            )}
            <span className="truncate text-muted-foreground">Audio</span>
          </button>
          {layerTracks.map((l) => (
            <TrackLabel
              key={l.id}
              label={`${LAYER_LABELS[l.type]} #${l.z_index + 1}`}
              color={LAYER_COLORS[l.type]}
              height={LAYER_TRACK_HEIGHT + TRACK_GAP}
            />
          ))}
        </div>

        {/* Scrollable timeline body */}
        <div
          ref={scrollerRef}
          className="relative flex-1 overflow-x-auto overflow-y-auto"
        >
          <div
            className="relative"
            style={{
              width: tracksWidth + 16,
              minHeight: RULER_HEIGHT + totalTracksHeight,
            }}
          >
            {/* Ruler */}
            <div
              onMouseDown={onRulerDown}
              className="sticky top-0 z-10 cursor-pointer select-none border-b border-border bg-background"
              style={{ height: RULER_HEIGHT, width: tracksWidth }}
            >
              <Ruler duration={duration} pxPerSec={pxPerSec} />
            </div>

            <div style={{ paddingTop: TRACK_GAP }}>
              <div style={{ marginBottom: TRACK_GAP }}>
                <ClipTrack
                  pxPerSec={pxPerSec}
                  width={tracksWidth}
                  height={CLIP_TRACK_HEIGHT}
                />
              </div>
              {audioOpen && (
                <div style={{ marginBottom: TRACK_GAP }}>
                  <OverlayAudioLane
                    pxPerSec={pxPerSec}
                    width={tracksWidth}
                    height={AUDIO_TRACK_HEIGHT}
                  />
                </div>
              )}
              {!audioOpen && (
                <div
                  className="border-b border-border bg-background/20"
                  style={{ width: tracksWidth, height: 24, marginBottom: TRACK_GAP }}
                />
              )}
              {layerTracks.map((layer) => (
                <LayerLane
                  key={layer.id}
                  layer={layer}
                  duration={duration}
                  pxPerSec={pxPerSec}
                  width={tracksWidth}
                  selected={layer.id === selectedLayerId}
                  onSelect={() => setSelected(layer.id)}
                  onPatch={(p) => patchLayer(layer.id, p)}
                />
              ))}
            </div>

            <div
              className="pointer-events-none absolute top-0 z-20 w-px bg-primary"
              style={{
                left: currentTime * pxPerSec,
                height: RULER_HEIGHT + totalTracksHeight,
              }}
            >
              <div className="absolute -left-[5px] -top-[2px] h-0 w-0 border-x-[5px] border-t-[6px] border-x-transparent border-t-primary" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TrackLabel({
  label,
  color,
  height,
}: {
  label: string;
  color?: string;
  height: number;
}) {
  return (
    <div
      className="flex items-center gap-2 truncate border-b border-border px-2 text-muted-foreground"
      style={{ height }}
      title={label}
    >
      {color && (
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-sm"
          style={{ backgroundColor: color }}
        />
      )}
      <span className="truncate">{label}</span>
    </div>
  );
}

function Ruler({ duration, pxPerSec }: { duration: number; pxPerSec: number }) {
  const ticks: { t: number; major: boolean }[] = [];
  for (let t = 0; t <= duration + 0.001; t += 0.5) {
    ticks.push({
      t: Math.round(t * 10) / 10,
      major: Math.abs(t - Math.round(t)) < 0.01,
    });
  }
  return (
    <div className="relative h-full w-full">
      {ticks.map((tick, i) => (
        <div
          key={i}
          className="absolute bottom-0 flex flex-col items-center"
          style={{ left: tick.t * pxPerSec }}
        >
          <div
            className={cn(
              "w-px",
              tick.major ? "h-3 bg-foreground/60" : "h-1.5 bg-foreground/30",
            )}
          />
          {tick.major && (
            <span className="absolute -top-[2px] translate-x-1 text-[9px] text-muted-foreground">
              {formatTime(tick.t)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function LayerLane({
  layer,
  duration,
  pxPerSec,
  width,
  selected,
  onSelect,
  onPatch,
}: {
  layer: Layer;
  duration: number;
  pxPerSec: number;
  width: number;
  selected: boolean;
  onSelect: () => void;
  onPatch: (patch: Partial<Layer>) => void;
}) {
  function startInteraction(
    e: React.MouseEvent,
    mode: "move" | "resize-left" | "resize-right",
  ) {
    e.preventDefault();
    e.stopPropagation();
    onSelect();
    const startX = e.clientX;
    const startStart = layer.start_time;
    const startEnd = layer.end_time;

    function onMove(ev: MouseEvent) {
      const dt = (ev.clientX - startX) / pxPerSec;
      if (mode === "move") {
        const len = startEnd - startStart;
        const newStart = clamp(startStart + dt, 0, Math.max(0, duration - len));
        onPatch({ start_time: newStart, end_time: newStart + len });
      } else if (mode === "resize-left") {
        const newStart = clamp(
          startStart + dt,
          0,
          startEnd - MIN_LAYER_DURATION,
        );
        onPatch({ start_time: newStart });
      } else if (mode === "resize-right") {
        const newEnd = clamp(
          startEnd + dt,
          startStart + MIN_LAYER_DURATION,
          duration,
        );
        onPatch({ end_time: newEnd });
      }
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const left = layer.start_time * pxPerSec;
  const blockWidth = Math.max(
    (layer.end_time - layer.start_time) * pxPerSec,
    4,
  );

  return (
    <div
      className="relative border-b border-border bg-background/20"
      style={{ height: LAYER_TRACK_HEIGHT, width, marginBottom: TRACK_GAP }}
    >
      <div
        onMouseDown={(e) => startInteraction(e, "move")}
        className={cn(
          "absolute top-1 flex h-[calc(100%-8px)] cursor-grab items-center overflow-hidden rounded-md border text-[11px] text-white active:cursor-grabbing",
          selected ? "border-foreground" : "border-transparent",
        )}
        style={{
          left,
          width: blockWidth,
          backgroundColor: LAYER_COLORS[layer.type],
        }}
      >
        <div
          onMouseDown={(e) => startInteraction(e, "resize-left")}
          className="absolute left-0 top-0 h-full w-2 cursor-ew-resize bg-black/30 hover:bg-black/50"
        />
        <span className="pointer-events-none mx-3 truncate">
          {LAYER_LABELS[layer.type]}
        </span>
        <div
          onMouseDown={(e) => startInteraction(e, "resize-right")}
          className="absolute right-0 top-0 h-full w-2 cursor-ew-resize bg-black/30 hover:bg-black/50"
        />
      </div>
    </div>
  );
}
