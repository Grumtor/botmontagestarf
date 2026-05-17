"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";

import { SampleVideo } from "@/lib/api";
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

// ---- zone constraint helpers (used by CanvasLayer drag/resize) ------

type LayerBoxZone = { x_pct: number; y_pct: number; width_pct: number; height_pct: number };

/** Pick the zone whose centre is closest to (cx, cy). */
function pickZone(cx: number, cy: number, zones: LayerBoxZone[]): LayerBoxZone {
  let best = zones[0];
  let bestD = Infinity;
  for (const z of zones) {
    const zcx = z.x_pct + z.width_pct / 2;
    const zcy = z.y_pct + z.height_pct / 2;
    const d = (zcx - cx) ** 2 + (zcy - cy) ** 2;
    if (d < bestD) {
      bestD = d;
      best = z;
    }
  }
  return best;
}

/**
 * Snap (proposedX, proposedY) for a w×h bbox to fit inside the zone whose
 * centre is closest. Returns the constrained top-left.
 */
function constrainToZones(
  proposedX: number,
  proposedY: number,
  w: number,
  h: number,
  zones: LayerBoxZone[],
): { x: number; y: number } {
  if (zones.length === 0) {
    return { x: proposedX, y: proposedY };
  }
  const cx = proposedX + w / 2;
  const cy = proposedY + h / 2;
  const z = pickZone(cx, cy, zones);
  const minX = z.x_pct;
  const minY = z.y_pct;
  // If the bbox is bigger than the zone, just pin top-left to zone origin.
  const maxX = Math.max(minX, z.x_pct + z.width_pct - w);
  const maxY = Math.max(minY, z.y_pct + z.height_pct - h);
  return {
    x: Math.min(Math.max(proposedX, minX), maxX),
    y: Math.min(Math.max(proposedY, minY), maxY),
  };
}

export function EditorCanvas() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const sampleVideoRef = useRef<HTMLVideoElement>(null);

  const template = useEditorStore((s) => s.template);
  const clips = useEditorStore((s) => s.clips);
  const extraTracks = useEditorStore((s) => s.extraTracks);
  const layers = useEditorStore((s) => s.layers);
  const currentTime = useEditorStore((s) => s.currentTime);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const setSelected = useEditorStore((s) => s.setSelectedLayerId);

  // Optional sample placeholder video — same global file the backend uses
  // as fallback when rendering the preview. We probe its existence once
  // on mount; if absent we fall back to the yellow tile.
  const [sampleAvailable, setSampleAvailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    SampleVideo.info()
      .then((i) => {
        if (!cancelled) setSampleAvailable(i.exists);
      })
      .catch(() => {
        /* keep default false */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // User preference: pause the sample placeholder video. Persisted in
  // localStorage so that re-entering the editor honours the last choice
  // (the loop is mostly noise once you know what your placeholder looks
  // like; pausing saves CPU + battery).
  const [samplePaused, setSamplePaused] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("editor.samplePaused") === "1";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      "editor.samplePaused",
      samplePaused ? "1" : "0",
    );
  }, [samplePaused]);

  const visibleLayers = useMemo(
    () =>
      layers.filter(
        (l) => currentTime >= l.start_time && currentTime <= l.end_time,
      ),
    [layers, currentTime],
  );

  // Phase 26b — extra-track clips that should be visible at currentTime.
  // We render them stacked above the main canvas (last index on top).
  // Phase 28 — clips with video_enabled=false are skipped here (audio
  // only, no visual overlay).
  const visibleExtras = useMemo(() => {
    const out: {
      trackIdx: number;
      clip: import("@/lib/api").ExtraClip;
      localTime: number;
    }[] = [];
    extraTracks.forEach((track, idx) => {
      for (const c of track.clips) {
        if (c.video_enabled === false) continue;
        const freezeTail = Math.max(0, c.freeze_tail_sec ?? 0);
        const dur =
          c.type === "fixed"
            ? c.trim_out != null
              ? Math.max(0.1, c.trim_out - c.trim_in) + freezeTail
              : c.source_duration_sec != null
                ? Math.max(0.1, c.source_duration_sec - c.trim_in) + freezeTail
                : 3 + freezeTail
            : Math.max(0.1, c.duration_sec) + freezeTail;
        if (
          currentTime >= c.start_time &&
          currentTime <= c.start_time + dur
        ) {
          out.push({
            trackIdx: idx,
            clip: c,
            localTime: currentTime - c.start_time,
          });
        }
      }
    });
    return out;
  }, [extraTracks, currentTime]);

  const active = useMemo(
    () => timelineToClip(currentTime, clips),
    [currentTime, clips],
  );
  const activeClip = active ? clips[active.clipIndex] : null;
  const activeIsFixed = activeClip?.type === "fixed";
  const activeIsImage = activeClip?.type === "image";
  // B&W filter style — respects the optional sub-range. localTime is
  // the time within the active clip (after trim_in offset), matching
  // what the ffmpeg pipeline uses as `t`.
  const activeFilterStyle = (() => {
    if (!activeClip || (activeClip.filter ?? "none") !== "bw") return undefined;
    const fs = activeClip.filter_start_sec;
    const fe = activeClip.filter_end_sec;
    const hasRange = fs != null && fe != null && fe > fs && fs >= 0;
    if (!hasRange) return { filter: "grayscale(1)" };
    const local = active?.localTime ?? 0;
    return local >= fs && local <= fe ? { filter: "grayscale(1)" } : undefined;
  })();

  const activeFileUrl =
    template && activeClip && (activeClip.type === "fixed" || activeClip.type === "image")
      ? `/api/files/template_clip/${template.id}/${activeClip.file_id}`
      : null;

  // When src changes, reload video. When playing, ensure local seek + play.
  // Cap source seek to (source_duration - trim_in) so freeze_tail_sec
  // appears as a held last frame in the preview.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !activeFileUrl || !activeClip || activeClip.type !== "fixed") return;
    const naturalDur =
      activeClip.trim_out != null
        ? Math.max(0, activeClip.trim_out - activeClip.trim_in)
        : Math.max(0, (activeClip.source_duration_sec ?? 0) - activeClip.trim_in);
    const local = Math.min(active?.localTime ?? 0, naturalDur);
    const sourceTime = activeClip.trim_in + local;
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

  // Sync the sample placeholder video with the user's pause preference.
  // Runs whenever the sample becomes visible (placeholder clip active) or
  // when the user toggles pause.
  useEffect(() => {
    const v = sampleVideoRef.current;
    if (!v) return;
    if (samplePaused) {
      v.pause();
    } else {
      v.play().catch(() => {
        /* autoplay can be blocked, harmless */
      });
    }
  }, [samplePaused, sampleAvailable, activeClip?.type]);

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
            style={activeFilterStyle}
            playsInline
            preload="auto"
          />
        )}

        {activeIsImage && activeFileUrl && (
          <img
            key={activeFileUrl}
            src={activeFileUrl}
            alt=""
            draggable={false}
            className="absolute inset-0 h-full w-full select-none object-cover"
            style={activeFilterStyle}
          />
        )}

        {activeClip?.type === "placeholder" && (
          sampleAvailable ? (
            <>
              <video
                ref={sampleVideoRef}
                src={SampleVideo.url()}
                className="absolute inset-0 h-full w-full object-cover"
                style={activeFilterStyle}
                playsInline
                muted
                loop
              />
              {/* Subtle badge so the user remembers it's not a real fixed clip */}
              <div className="pointer-events-none absolute left-1.5 top-1.5 rounded bg-yellow-500/80 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-black">
                📷 Placeholder · {activeClip.duration_sec.toFixed(1)}s
              </div>
              {/* Pause / play du sample loop — par défaut joue, click pour
                  freeze l'image. Choix persisté en localStorage. */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSamplePaused((p) => !p);
                }}
                className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white shadow backdrop-blur transition hover:bg-black/80"
                title={
                  samplePaused
                    ? "Reprendre l'aperçu placeholder"
                    : "Mettre en pause l'aperçu placeholder"
                }
                aria-label={
                  samplePaused ? "Reprendre l'aperçu" : "Pause aperçu"
                }
              >
                {samplePaused ? (
                  <Play className="ml-0.5 h-3.5 w-3.5" />
                ) : (
                  <Pause className="h-3.5 w-3.5" />
                )}
              </button>
            </>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-yellow-700/20 text-center text-xs text-yellow-200">
              <div>
                <div className="text-lg font-semibold">📷 Placeholder</div>
                <div className="opacity-80">
                  {activeClip.duration_sec.toFixed(1)}s
                </div>
                <div className="mt-1 text-[10px] opacity-60">
                  Vidéo utilisateur insérée ici au render
                </div>
                <div className="mt-2 text-[10px] opacity-50">
                  Astuce : upload une vidéo exemple sur la page Templates
                </div>
              </div>
            </div>
          )
        )}

        {/* Phase 26b — extra-track clips composited on top of main.
            Sorted by trackIdx ascending so higher tracks paint last
            (= on top), matching the pipeline's overlay chain order. */}
        {visibleExtras
          .slice()
          .sort((a, b) => a.trackIdx - b.trackIdx)
          .map(({ clip, localTime }) => (
            <ExtraClipCanvas
              key={`${clip.id}-${clip.start_time}`}
              templateId={template?.id ?? 0}
              clip={clip}
              localTime={localTime}
            />
          ))}

        {/* Phase 28d — n'affiche le message "Aucun clip" QUE si rien
            n'est visible : ni clip main, ni extra clip. Sinon Track 2
            a du contenu mais le message s'affichait quand même. */}
        {!activeClip && visibleExtras.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
            Aucun clip — ajoute-en depuis la timeline.
          </div>
        )}

        {/* Placement zone overlays — drawn UNDER layers so the text stays
            interactive on top. Only shown for text layers in random mode.
            A layer may have multiple zones (Phase 11) — at render time the
            backend picks one uniformly + a random position inside it. */}
        {template &&
          visibleLayers.flatMap((layer) => {
            if (layer.type !== "text") return [];
            const td = parseTextData(layer.data);
            if (td.placement_mode !== "random") return [];
            const zones = readLayerZones(td);
            if (zones.length === 0) return [];
            return zones.map((_zone, i) => (
              <PlacementZoneOverlay
                key={`zone-${layer.id}-${i}`}
                layer={layer}
                zoneIndex={i}
                canvasRef={canvasRef}
              />
            ));
          })}

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

  // When the layer is a text in random-placement mode, dragging is
  // constrained to the union of zones — the text picks whichever zone is
  // closest to the proposed centre and stays inside it. So you can't drag
  // the text outside the zones, and crossing between zones snaps when the
  // text centre crosses the midpoint.
  const placementZones =
    isText && textData?.placement_mode === "random"
      ? readLayerZones(textData)
      : [];
  const isZoneConstrained = placementZones.length > 0;

  function constrainPos(proposedX: number, proposedY: number, w: number, h: number) {
    if (!isZoneConstrained) {
      return {
        x: clamp(proposedX, 0, 100 - w),
        y: clamp(proposedY, 0, 100 - h),
      };
    }
    return constrainToZones(proposedX, proposedY, w, h, placementZones);
  }

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
      const c = constrainPos(
        startXPct + dxPct,
        startYPct + dyPct,
        layer.width_pct,
        layer.height_pct,
      );
      patchLayer(layer.id, { x_pct: c.x, y_pct: c.y });
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
      let newW = (newWpx / rect.width) * 100;
      let newH = (newHpx / rect.height) * 100;
      let newX = init.x;
      let newY = init.y;
      if (left) newX = init.x + (dxLeftPx / rect.width) * 100;
      if (top) newY = init.y + (dyTopPx / rect.height) * 100;
      // For text layers in random mode, the bbox must remain inside one of
      // the zones. Cap dimensions to the chosen zone, then clamp position.
      if (isZoneConstrained) {
        const z = pickZone(newX + newW / 2, newY + newH / 2, placementZones);
        newW = Math.min(newW, z.width_pct);
        newH = Math.min(newH, z.height_pct);
        const c = constrainToZones(newX, newY, newW, newH, [z]);
        newX = c.x;
        newY = c.y;
      }
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

// ===== placement zones ===============================================
//
// Yellow dashed rectangles that define where a text layer can drop at
// render time. A layer can have N zones — at render time the backend
// picks one uniformly + a random position inside it. The user edits each
// zone directly on canvas (drag/resize). Schema-side, zones live in
// `data.placement_zones[]` (with a legacy `data.placement_zone` fallback
// for templates created before multi-zone).

type LayerZone = {
  x_pct: number;
  y_pct: number;
  width_pct: number;
  height_pct: number;
};

export function readLayerZones(
  data: { placement_zones?: LayerZone[]; placement_zone?: LayerZone | null },
): LayerZone[] {
  const zones = Array.isArray(data.placement_zones)
    ? data.placement_zones.slice()
    : [];
  if (data.placement_zone && zones.length === 0) {
    zones.push(data.placement_zone);
  }
  return zones;
}

function PlacementZoneOverlay({
  layer,
  zoneIndex,
  canvasRef,
}: {
  layer: Layer;
  zoneIndex: number;
  canvasRef: React.RefObject<HTMLDivElement | null>;
}) {
  const patchLayerData = useEditorStore((s) => s.patchLayerData);
  const setSelected = useEditorStore((s) => s.setSelectedLayerId);
  const data = parseTextData(layer.data);
  const zones = readLayerZones(data);
  const zone = zones[zoneIndex];
  if (!zone) return null;

  function commitZone(patch: Partial<LayerZone>) {
    const next = zones.map((z, i) => (i === zoneIndex ? { ...z, ...patch } : z));
    patchLayerData(layer.id, {
      placement_zones: next,
      placement_zone: null,
    });
  }

  function startDragZone(e: React.MouseEvent) {
    if (!canvasRef.current || !zone) return;
    e.preventDefault();
    e.stopPropagation();
    setSelected(layer.id);
    const rect = canvasRef.current.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const initX = zone.x_pct;
    const initY = zone.y_pct;
    function onMove(ev: MouseEvent) {
      if (!zone) return;
      const dxPct = ((ev.clientX - startX) / rect.width) * 100;
      const dyPct = ((ev.clientY - startY) / rect.height) * 100;
      commitZone({
        x_pct: clamp(initX + dxPct, 0, 100 - zone.width_pct),
        y_pct: clamp(initY + dyPct, 0, 100 - zone.height_pct),
      });
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function startResizeZone(e: React.MouseEvent, handle: Handle) {
    if (!canvasRef.current || !zone) return;
    e.preventDefault();
    e.stopPropagation();
    setSelected(layer.id);
    const rect = canvasRef.current.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const init = {
      x: zone.x_pct,
      y: zone.y_pct,
      w: zone.width_pct,
      h: zone.height_pct,
    };
    const left = handle.includes("l");
    const right = handle.includes("r");
    const top = handle.includes("t");
    const bottom = handle.includes("b");

    function onMove(ev: MouseEvent) {
      const dxPct = ((ev.clientX - startX) / rect.width) * 100;
      const dyPct = ((ev.clientY - startY) / rect.height) * 100;
      let newX = init.x;
      let newY = init.y;
      let newW = init.w;
      let newH = init.h;
      if (right) newW = init.w + dxPct;
      if (left) {
        newW = init.w - dxPct;
        newX = init.x + dxPct;
      }
      if (bottom) newH = init.h + dyPct;
      if (top) {
        newH = init.h - dyPct;
        newY = init.y + dyPct;
      }
      const minPct = 5;
      newW = Math.max(minPct, newW);
      newH = Math.max(minPct, newH);
      newX = clamp(newX, 0, 100 - newW);
      newY = clamp(newY, 0, 100 - newH);
      newW = Math.min(newW, 100 - newX);
      newH = Math.min(newH, 100 - newY);
      commitZone({ x_pct: newX, y_pct: newY, width_pct: newW, height_pct: newH });
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
      onMouseDown={startDragZone}
      className="absolute cursor-move rounded border-2 border-dashed border-yellow-400/80 bg-yellow-400/5 transition hover:bg-yellow-400/10"
      style={{
        left: `${zone.x_pct}%`,
        top: `${zone.y_pct}%`,
        width: `${zone.width_pct}%`,
        height: `${zone.height_pct}%`,
        zIndex: layer.z_index, // sit just under the layer body
      }}
    >
      <span className="absolute left-1 top-1 rounded bg-yellow-500/80 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-black">
        Zone #{zoneIndex + 1}
      </span>
      {HANDLES.map((h) => (
        <span
          key={h.id}
          onMouseDown={(e) => startResizeZone(e, h.id)}
          className={cn(
            "absolute z-10 h-2 w-2 rounded-sm border border-yellow-500 bg-yellow-300",
            h.pos,
          )}
          style={{ cursor: h.cursor }}
        />
      ))}
    </div>
  );
}

// ===== Phase 26b — extra-track clip preview ===========================
//
// Renders ONE extra-track clip as a full-canvas overlay on top of the
// main video. For fixed videos, seeks to (localTime + trim_in) so the
// frame matches what ffmpeg will render. For images, just shows the
// image. For placeholders on extra tracks, falls back to the global
// sample video (or a yellow tile if none).

import type { ExtraClip } from "@/lib/api";

function ExtraClipCanvas({
  templateId,
  clip,
  localTime,
}: {
  templateId: number;
  clip: ExtraClip;
  localTime: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const filterStyle = (() => {
    if ((clip.filter ?? "none") !== "bw") return undefined;
    const fs = clip.filter_start_sec;
    const fe = clip.filter_end_sec;
    const hasRange = fs != null && fe != null && fe > fs && fs >= 0;
    if (!hasRange) return { filter: "grayscale(1)" };
    return localTime >= fs && localTime <= fe
      ? { filter: "grayscale(1)" }
      : undefined;
  })();

  // Seek the underlying <video> to the right source frame, capped to the
  // natural source end so freeze_tail_sec appears as a held last frame.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || clip.type !== "fixed") return;
    const naturalDur =
      clip.trim_out != null
        ? Math.max(0, clip.trim_out - clip.trim_in)
        : Math.max(0, (clip.source_duration_sec ?? 0) - clip.trim_in);
    const capped = Math.min(Math.max(0, localTime), naturalDur);
    const sourceTime = clip.trim_in + capped;
    if (Math.abs(v.currentTime - sourceTime) > 0.2) {
      try {
        v.currentTime = sourceTime;
      } catch {
        /* not loaded yet */
      }
    }
  }, [clip, localTime]);

  if (clip.type === "fixed") {
    const url = `/api/files/template_clip/${templateId}/${clip.file_id}`;
    return (
      <video
        ref={videoRef}
        key={url}
        src={url}
        className="absolute inset-0 h-full w-full object-cover"
        style={filterStyle}
        playsInline
        muted
        preload="auto"
      />
    );
  }
  if (clip.type === "image") {
    const url = `/api/files/template_clip/${templateId}/${clip.file_id}`;
    return (
      <img
        key={url}
        src={url}
        alt=""
        draggable={false}
        className="absolute inset-0 h-full w-full select-none object-cover"
        style={filterStyle}
      />
    );
  }
  // placeholder on extra track — fallback to sample video if available.
  return (
    <video
      key={`placeholder-${clip.id}`}
      src={SampleVideo.url()}
      className="absolute inset-0 h-full w-full object-cover"
      style={filterStyle}
      playsInline
      muted
      loop
      autoPlay
    />
  );
}
