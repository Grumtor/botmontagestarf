"use client";

import { useEffect, useMemo, useRef } from "react";

import { useEditorStore } from "@/store/editor";
import {
  LAYER_COLORS,
  LAYER_LABELS,
  clamp,
  outputToSource,
  segmentOutputStarts,
  segmentDuration,
} from "@/lib/editor-types";
import { cn } from "@/lib/utils";
import {
  parseAssetData,
  parseTextData,
  type Layer,
  type SourceSegment,
} from "@/lib/api";
import { FontLoader } from "./font-loader";
import { TextLayerContent } from "./text-layer";
import { AssetLayerContent } from "./asset-layer";

const VISUAL_ASSET_TYPES = new Set(["image", "gif", "emoji"]);

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

  const layers = useEditorStore((s) => s.layers);
  const currentTime = useEditorStore((s) => s.currentTime);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const previewSourceId = useEditorStore((s) => s.previewSourceId);
  const segments = useEditorStore((s) => s.sourceSegments);
  const audioSource = useEditorStore((s) => s.audioSource);
  const audioOverlay = useEditorStore((s) => s.audioOverlay);
  const setSelected = useEditorStore((s) => s.setSelectedLayerId);

  const overlayAudioRef = useRef<HTMLAudioElement>(null);

  const visibleLayers = useMemo(
    () =>
      layers.filter(
        (l) => currentTime >= l.start_time && currentTime <= l.end_time,
      ),
    [layers, currentTime],
  );

  // ---- video element ------------------------------------------------
  // During playback we let the video play naturally so its audio runs;
  // we only seek to the right source time at the start of playback or on
  // scrub. (Light desync vs. timeline RAF is tolerated per spec.)

  // Volume / mute mirror audio_source. HTML <video>.volume is clamped to 1
  // by the browser; values >1 in our model are honoured by ffmpeg only.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !audioSource.enabled;
    v.volume = audioSource.enabled ? Math.min(1, audioSource.volume) : 0;
  }, [audioSource]);

  // Play/pause + seek to current source time on transitions.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (isPlaying) {
      const map = outputToSource(currentTime, segments);
      const target = map?.sourceTime ?? currentTime;
      try {
        v.currentTime = target;
      } catch {
        /* not loaded */
      }
      v.play().catch(() => {});
    } else {
      v.pause();
    }
    // Only react to play/pause + previewSourceId changes, not currentTime
    // (otherwise we'd seek every frame and stutter).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, previewSourceId]);

  // Scrub: when paused and currentTime changes externally, seek the video.
  useEffect(() => {
    if (isPlaying) return;
    const v = videoRef.current;
    if (!v) return;
    const map = outputToSource(currentTime, segments);
    const target = map?.sourceTime ?? currentTime;
    if (Math.abs(v.currentTime - target) > 0.05) {
      try {
        v.currentTime = target;
      } catch {
        /* not loaded */
      }
    }
  }, [currentTime, isPlaying, segments]);

  // ---- overlay audio element ----------------------------------------
  useEffect(() => {
    const a = overlayAudioRef.current;
    if (!a) return;
    a.muted = false;
    a.volume = Math.min(1, Math.max(0, audioOverlay.volume));
  }, [audioOverlay.volume]);

  useEffect(() => {
    const a = overlayAudioRef.current;
    if (!a || audioOverlay.asset_id == null) return;

    const overlayActive = currentTime >= audioOverlay.start_offset;
    if (!isPlaying || !overlayActive) {
      if (!a.paused) a.pause();
      return;
    }
    const fileTime =
      audioOverlay.trim_in + Math.max(0, currentTime - audioOverlay.start_offset);
    if (Math.abs(a.currentTime - fileTime) > 0.5) {
      try {
        a.currentTime = fileTime;
      } catch {
        /* not loaded */
      }
    }
    if (a.paused) a.play().catch(() => {});
  }, [
    isPlaying,
    currentTime,
    audioOverlay.asset_id,
    audioOverlay.start_offset,
    audioOverlay.trim_in,
  ]);

  // CSS fade approximation around segment boundaries (for non-cut transitions).
  // Real ffmpeg-rendered effects ship in a later prompt.
  const transitionOpacity = useMemo(
    () => boundaryOpacity(currentTime, segments),
    [currentTime, segments],
  );

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
        {previewSourceId !== null && (
          <div
            className="absolute inset-0"
            style={{ opacity: transitionOpacity }}
          >
            <video
              ref={videoRef}
              key={previewSourceId}
              src={`/api/files/source/${previewSourceId}`}
              className="absolute inset-0 h-full w-full object-cover"
              playsInline
              preload="auto"
            />
          </div>
        )}

        {visibleLayers.map((layer) => (
          <CanvasLayer key={layer.id} layer={layer} canvasRef={canvasRef} />
        ))}

        <div className="pointer-events-none absolute right-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
          360×640
        </div>

        <ActiveEffectsBadge layers={visibleLayers} />

        {audioOverlay.asset_id != null && (
          <audio
            ref={overlayAudioRef}
            key={audioOverlay.asset_id}
            src={`/api/files/asset/${audioOverlay.asset_id}`}
            preload="auto"
          />
        )}
      </div>
    </div>
  );
}

function ActiveEffectsBadge({ layers }: { layers: Layer[] }) {
  const active = layers.filter(
    (l) => l.type === "effect" || l.type === "animation",
  );
  if (active.length === 0) return null;
  return (
    <div className="pointer-events-none absolute bottom-1 left-1 flex max-w-[calc(100%-8px)] flex-wrap gap-1">
      {active.map((l) => {
        const data = (l.data ?? {}) as Record<string, unknown>;
        const label =
          l.type === "effect"
            ? String(data.type ?? "effect")
            : String(data.preset ?? "animation");
        const force = Number(data.force ?? 1);
        return (
          <span
            key={l.id}
            className="rounded bg-black/70 px-2 py-0.5 text-[10px] font-medium text-white"
          >
            🎬 {label} ×{force.toFixed(1)}
          </span>
        );
      })}
    </div>
  );
}

function CanvasLayer({
  layer,
  canvasRef,
}: {
  layer: Layer;
  canvasRef: React.RefObject<HTMLDivElement | null>;
}) {
  const selectedLayerId = useEditorStore((s) => s.selectedLayerId);
  const setSelected = useEditorStore((s) => s.setSelectedLayerId);
  const patchLayer = useEditorStore((s) => s.patchLayer);
  const pool = useEditorStore((s) =>
    layer.type === "text" ? (s.pools[layer.id] ?? []) : null,
  );
  const selected = layer.id === selectedLayerId;

  const isText = layer.type === "text";
  const isVisualAsset = VISUAL_ASSET_TYPES.has(layer.type);
  const isFallbackRect = !isText && !isVisualAsset;

  const textData = isText ? parseTextData(layer.data) : null;
  const assetData = isVisualAsset ? parseAssetData(layer.data) : null;

  const previewText =
    isText && textData
      ? (pool ?? []).find((s) => s.trim().length > 0) ?? textData.text
      : null;

  const ratioLocked =
    isVisualAsset && assetData?.ratio_locked === true;

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
        // Pick the dominant axis by absolute pixel delta to drive both dims.
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
        isFallbackRect && "flex items-center justify-center text-[10px] font-medium text-white",
        selected && "outline outline-2 outline-dashed outline-white/80",
      )}
      style={{
        left: `${layer.x_pct}%`,
        top: `${layer.y_pct}%`,
        width: `${layer.width_pct}%`,
        height: `${layer.height_pct}%`,
        backgroundColor:
          isText || isVisualAsset ? "transparent" : LAYER_COLORS[layer.type],
        zIndex: layer.z_index + 1,
      }}
    >
      {isText && textData && (
        <TextLayerContent data={textData} text={previewText ?? ""} />
      )}
      {isVisualAsset && assetData && <AssetLayerContent data={assetData} />}
      {isFallbackRect && (
        <span className="pointer-events-none drop-shadow">
          {LAYER_LABELS[layer.type]}
        </span>
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

/**
 * Returns a 0..1 opacity multiplier for the source video that simulates the
 * configured transition around segment boundaries:
 *   - cut: always 1 (instant)
 *   - other types: linear fade-out / fade-in across `transition.duration`
 *     centred on the boundary (CSS approximation; ffmpeg does the real work).
 */
function boundaryOpacity(currentTime: number, segments: SourceSegment[]): number {
  if (segments.length < 2) return 1;
  const starts = segmentOutputStarts(segments);
  for (let i = 0; i < segments.length - 1; i++) {
    const t = segments[i].transition_to_next;
    if (t.type === "cut") continue;
    const boundary = starts[i] + segmentDuration(segments[i]);
    const half = t.duration / 2;
    const dist = Math.abs(currentTime - boundary);
    if (dist < half) {
      return Math.max(0, dist / half);
    }
  }
  return 1;
}
