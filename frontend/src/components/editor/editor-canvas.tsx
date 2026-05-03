"use client";

import { useEffect, useMemo, useRef } from "react";

import { useEditorStore } from "@/store/editor";
import {
  LAYER_COLORS,
  LAYER_LABELS,
  clamp,
  clipDuration,
  clipStartTimes,
  timelineToClip,
} from "@/lib/editor-types";
import { cn } from "@/lib/utils";
import {
  parseAssetData,
  parseTextData,
  type Layer,
} from "@/lib/api";
import { FontLoader } from "./font-loader";
import { TextLayerContent } from "./text-layer";
import { AssetLayerContent } from "./asset-layer";

type Handle = "tl" | "tm" | "tr" | "ml" | "mr" | "bl" | "bm" | "br";

const HANDLES: { id: Handle; cursor: string; pos: string }[] = [
  { id: "tl", cursor: "nwse-resize", pos: "left-0 top-0 -translate-x-1/2 -translate-y-1/2" },
  { id: "tm", cursor: "ns-resize", pos: "left-1/2 top-0 -translate-x-1/2 -translate-y-1/2" },
  { id: "tr", cursor: "nesw-resize", pos: "right-0 top-0 translate-x-1/2 -translate-y-1/2" },
  { id: "ml", cursor: "ew-resize", pos: "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2" },
  { id: "mr", cursor: "ew-resize", pos: "right-0 top-1/2 translate-x-1/2 -translate-y-1/2" },
  { id: "bl", cursor: "nesw-resize", pos: "left-0 bottom-0 -translate-x-1/2 translate-y-1/2" },
  { id: "bm", cursor: "ns-resize", pos: "left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2" },
  { id: "br", cursor: "nwse-resize", pos: "right-0 bottom-0 translate-x-1/2 translate-y-1/2" },
];

export function EditorCanvas() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const template = useEditorStore((s) => s.template);
  const clips = useEditorStore((s) => s.clips);
  const layers = useEditorStore((s) => s.layers);
  const currentTime = useEditorStore((s) => s.currentTime);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const setSelected = useEditorStore((s) => s.setSelectedLayerId);

  const visibleLayers = useMemo(
    () =>
      layers.filter(
        (l) => currentTime >= l.start_time && currentTime <= l.end_time,
      ),
    [layers, currentTime],
  );

  const active = useMemo(
    () => timelineToClip(currentTime, clips),
    [currentTime, clips],
  );
  const activeClip = active ? clips[active.clipIndex] : null;
  const activeIsFixed = activeClip?.type === "fixed";

  const activeFileUrl =
    template && activeIsFixed && activeClip?.file_id
      ? `/api/files/template_clip/${template.id}/${activeClip.file_id}`
      : null;

  // When src changes, reload video. When playing, ensure local seek + play.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !activeFileUrl || !activeClip || activeClip.type !== "fixed") return;
    const sourceTime = activeClip.trim_in + (active?.localTime ?? 0);
    if (Math.abs(v.currentTime - sourceTime) > 0.2) {
      try {
        v.currentTime = sourceTime;
      } catch {
        /* not loaded yet */
      }
    }
  }, [active?.localTime, activeClip, activeFileUrl]);

  // Sync play/pause with isPlaying
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (isPlaying && activeIsFixed) {
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  }, [isPlaying, activeIsFixed]);

  // Apply per-clip audio config
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !activeClip || activeClip.type !== "fixed") return;
    v.muted = !activeClip.audio_enabled;
    v.volume = activeClip.audio_enabled
      ? Math.min(1, activeClip.audio_volume)
      : 0;
  }, [activeClip]);

  return (
    <div
      className="flex flex-1 items-center justify-center overflow-auto bg-black/40 p-4"
      onClick={() => setSelected(null)}
    >
      <FontLoader />
      <div
        ref={canvasRef}
        className="relative aspect-[9/16] max-h-full bg-black shadow-xl"
        style={{
          width: "min(360px, 100%)",
          height: "min(640px, 100%)",
          containerType: "size",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Active clip rendering */}
        {activeIsFixed && activeFileUrl && (
          <video
            ref={videoRef}
            key={activeFileUrl}
            src={activeFileUrl}
            className="absolute inset-0 h-full w-full object-cover"
            playsInline
            preload="auto"
          />
        )}

        {activeClip?.type === "placeholder" && (
          <div className="absolute inset-0 flex items-center justify-center bg-yellow-700/20 text-center text-xs text-yellow-200">
            <div>
              <div className="text-lg font-semibold">📷 Placeholder</div>
              <div className="opacity-80">
                {activeClip.duration_sec.toFixed(1)}s
              </div>
              <div className="mt-1 text-[10px] opacity-60">
                Vidéo utilisateur insérée ici au render
              </div>
            </div>
          </div>
        )}

        {!activeClip && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
            Aucun clip — ajoute-en depuis la timeline.
          </div>
        )}

        {/* Layers (text/image/gif/emoji) */}
        {template &&
          visibleLayers.map((layer) => (
            <CanvasLayer
              key={layer.id}
              layer={layer}
              templateId={template.id}
              canvasRef={canvasRef}
            />
          ))}

        <div className="pointer-events-none absolute right-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
          360×640
        </div>
      </div>
    </div>
  );
}

function CanvasLayer({
  layer,
  templateId,
  canvasRef,
}: {
  layer: Layer;
  templateId: number;
  canvasRef: React.RefObject<HTMLDivElement | null>;
}) {
  const selectedLayerId = useEditorStore((s) => s.selectedLayerId);
  const setSelected = useEditorStore((s) => s.setSelectedLayerId);
  const patchLayer = useEditorStore((s) => s.patchLayer);
  const selected = layer.id === selectedLayerId;

  const isText = layer.type === "text";
  const textData = isText ? parseTextData(layer.data) : null;
  const assetData = !isText ? parseAssetData(layer.data) : null;
  const ratioLocked = assetData?.ratio_locked === true;

  function startDrag(e: React.MouseEvent) {
    if (!canvasRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    setSelected(layer.id);
    const rect = canvasRef.current.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const startXPct = layer.x_pct;
    const startYPct = layer.y_pct;
    function onMove(ev: MouseEvent) {
      const dxPct = ((ev.clientX - startX) / rect.width) * 100;
      const dyPct = ((ev.clientY - startY) / rect.height) * 100;
      patchLayer(layer.id, {
        x_pct: clamp(startXPct + dxPct, 0, 100 - layer.width_pct),
        y_pct: clamp(startYPct + dyPct, 0, 100 - layer.height_pct),
      });
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function startResize(e: React.MouseEvent, handle: Handle) {
    if (!canvasRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    setSelected(layer.id);
    const rect = canvasRef.current.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const init = {
      x: layer.x_pct,
      y: layer.y_pct,
      w: layer.width_pct,
      h: layer.height_pct,
    };
    const initWpx = (init.w / 100) * rect.width;
    const initHpx = (init.h / 100) * rect.height;
    const ratioPx = initHpx > 0 ? initWpx / initHpx : 1;
    const isCorner = handle.length === 2;
    const left = handle.includes("l");
    const right = handle.includes("r");
    const top = handle.includes("t");
    const bottom = handle.includes("b");

    function onMove(ev: MouseEvent) {
      const dxPx = ev.clientX - startX;
      const dyPx = ev.clientY - startY;
      let newWpx = initWpx;
      let newHpx = initHpx;
      let dxLeftPx = 0;
      let dyTopPx = 0;
      if (right) newWpx = initWpx + dxPx;
      if (left) {
        newWpx = initWpx - dxPx;
        dxLeftPx = dxPx;
      }
      if (bottom) newHpx = initHpx + dyPx;
      if (top) {
        newHpx = initHpx - dyPx;
        dyTopPx = dyPx;
      }
      if (ratioLocked && isCorner) {
        const wAbs = Math.abs(newWpx - initWpx);
        const hAbs = Math.abs(newHpx - initHpx);
        if (wAbs >= hAbs) {
          newHpx = newWpx / ratioPx;
          if (top) dyTopPx = initHpx - newHpx;
        } else {
          newWpx = newHpx * ratioPx;
          if (left) dxLeftPx = initWpx - newWpx;
        }
      }
      const minPx = 8;
      if (newWpx < minPx) {
        const adj = minPx - newWpx;
        newWpx = minPx;
        if (left) dxLeftPx -= adj;
      }
      if (newHpx < minPx) {
        const adj = minPx - newHpx;
        newHpx = minPx;
        if (top) dyTopPx -= adj;
      }
      const newW = (newWpx / rect.width) * 100;
      const newH = (newHpx / rect.height) * 100;
      let newX = init.x;
      let newY = init.y;
      if (left) newX = init.x + (dxLeftPx / rect.width) * 100;
      if (top) newY = init.y + (dyTopPx / rect.height) * 100;
      patchLayer(layer.id, {
        x_pct: newX,
        y_pct: newY,
        width_pct: newW,
        height_pct: newH,
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
      onMouseDown={startDrag}
      className={cn(
        "absolute cursor-move",
        selected && "outline outline-2 outline-dashed outline-white/80",
      )}
      style={{
        left: `${layer.x_pct}%`,
        top: `${layer.y_pct}%`,
        width: `${layer.width_pct}%`,
        height: `${layer.height_pct}%`,
        backgroundColor: "transparent",
        zIndex: layer.z_index + 1,
      }}
    >
      {isText && textData && (
        <TextLayerContent data={textData} text={textData.text} />
      )}
      {!isText && assetData && (
        <AssetLayerContent data={assetData} templateId={templateId} />
      )}

      {selected &&
        HANDLES.map((h) => (
          <span
            key={h.id}
            onMouseDown={(e) => startResize(e, h.id)}
            className={cn(
              "absolute z-10 h-2.5 w-2.5 rounded-sm border border-foreground bg-background",
              h.pos,
            )}
            style={{ cursor: h.cursor }}
          />
        ))}
    </div>
  );
}
