"use client";

import { useEditorStore } from "@/store/editor";
import type { Clip, ExtraClip } from "@/lib/api";
import { TextInspector } from "./text-inspector";
import { AssetLayerInspector } from "./asset-layer-inspector";
import { AudioOverlayInspector } from "./audio-inspectors";
import { ClipInspector } from "./clip-inspector";

const VISUAL_LAYER_TYPES = new Set(["image", "gif", "emoji"]);

export function EditorInspector() {
  const layer = useEditorStore((s) =>
    s.selectedLayerId
      ? (s.layers.find((l) => l.id === s.selectedLayerId) ?? null)
      : null,
  );
  // Phase 26b — selected clip can be on the main track OR on an extra
  // track. We resolve both via separate selectors that return STABLE
  // references (the actual clip object from the store), so React's
  // useSyncExternalStore doesn't see a new identity every render and
  // loop forever.
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const selectedExtraTrackId = useEditorStore((s) => s.selectedExtraTrackId);
  const mainClip = useEditorStore((s) =>
    selectedClipId && !selectedExtraTrackId
      ? (s.clips.find((c) => c.id === selectedClipId) ?? null)
      : null,
  );
  const extraClip = useEditorStore((s) => {
    if (!selectedClipId || !selectedExtraTrackId) return null;
    const track = s.extraTracks.find((t) => t.id === selectedExtraTrackId);
    if (!track) return null;
    return track.clips.find((c) => c.id === selectedClipId) ?? null;
  });
  const clip: Clip | ExtraClip | null = mainClip ?? extraClip;
  const extraTrackId = extraClip ? (selectedExtraTrackId ?? undefined) : undefined;
  const audioSelected = useEditorStore((s) => s.audioSelected);

  return (
    <aside className="flex w-[320px] shrink-0 flex-col border-l border-border bg-card">
      <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Inspecteur
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {clip ? (
          <ClipInspector clip={clip} extraTrackId={extraTrackId} />
        ) : audioSelected ? (
          <AudioOverlayInspector />
        ) : layer === null ? (
          <p className="text-sm text-muted-foreground">
            Sélectionne un clip, un calque ou la piste audio.
          </p>
        ) : layer.type === "text" ? (
          <TextInspector layer={layer} />
        ) : VISUAL_LAYER_TYPES.has(layer.type) ? (
          <AssetLayerInspector layer={layer} />
        ) : (
          <p className="text-sm text-muted-foreground">Type inconnu.</p>
        )}
      </div>
    </aside>
  );
}
