"use client";

import { useState } from "react";

import { useEditorStore } from "@/store/editor";
import { segmentOutputStarts, segmentDuration } from "@/lib/editor-types";
import { cn } from "@/lib/utils";
import { TransitionDialog } from "./transition-dialog";

type Props = {
  pxPerSec: number;
  width: number;
  height: number;
};

export function SourceSegmentsLane({ pxPerSec, width, height }: Props) {
  const segments = useEditorStore((s) => s.sourceSegments);
  const trimSegmentEdge = useEditorStore((s) => s.trimSegmentEdge);
  const [transitionIdx, setTransitionIdx] = useState<number | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const starts = segmentOutputStarts(segments);

  function startTrim(
    e: React.MouseEvent,
    segmentIndex: number,
    edge: "left" | "right",
  ) {
    e.preventDefault();
    e.stopPropagation();
    const seg = segments[segmentIndex];
    const startX = e.clientX;
    const initSourceTime = edge === "left" ? seg.in_time : seg.out_time;

    function onMove(ev: MouseEvent) {
      const dxPx = ev.clientX - startX;
      const dt = dxPx / pxPerSec; // seconds in source coords
      trimSegmentEdge(segmentIndex, edge, initSourceTime + dt);
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
    >
      {segments.map((seg, i) => {
        const dur = segmentDuration(seg);
        const left = starts[i] * pxPerSec;
        const w = Math.max(dur * pxPerSec, 4);
        const isLast = i === segments.length - 1;
        return (
          <div key={i} className="contents">
            <div
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
              className={cn(
                "absolute top-1 flex h-[calc(100%-8px)] cursor-default items-center overflow-hidden rounded-sm border text-[10px] text-white transition-colors",
                hoverIdx === i ? "border-foreground bg-sky-700" : "border-transparent bg-sky-800",
              )}
              style={{ left, width: w }}
              title={`Source [${seg.in_time.toFixed(2)}s, ${seg.out_time.toFixed(2)}s]`}
            >
              <div
                onMouseDown={(e) => startTrim(e, i, "left")}
                className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize bg-black/30"
              />
              <span className="pointer-events-none mx-2 truncate">
                Vidéo source #{i + 1}
              </span>
              <div
                onMouseDown={(e) => startTrim(e, i, "right")}
                className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize bg-black/30"
              />
            </div>

            {!isLast && (
              <DiamondMarker
                outputTime={starts[i] + dur}
                pxPerSec={pxPerSec}
                transitionType={seg.transition_to_next.type}
                onClick={() => setTransitionIdx(i)}
              />
            )}
          </div>
        );
      })}

      <TransitionDialog
        segmentIndex={transitionIdx}
        onOpenChange={(v) => {
          if (!v) setTransitionIdx(null);
        }}
      />
    </div>
  );
}

function DiamondMarker({
  outputTime,
  pxPerSec,
  transitionType,
  onClick,
}: {
  outputTime: number;
  pxPerSec: number;
  transitionType: string;
  onClick: () => void;
}) {
  const left = outputTime * pxPerSec;
  const isCut = transitionType === "cut";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={`Transition: ${transitionType}`}
      className={cn(
        "absolute top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 text-base leading-none transition hover:scale-125",
        isCut ? "text-muted-foreground" : "text-yellow-400",
      )}
      style={{ left }}
    >
      ◇
    </button>
  );
}
