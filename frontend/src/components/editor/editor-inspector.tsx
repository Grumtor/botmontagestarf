"use client";

import { useEditorStore } from "@/store/editor";
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
  const clip = useEditorStore((s) =>
    s.selectedClipId
      ? (s.clips.find((c) => c.id === s.selectedClipId) ?? null)
      : null,
  );
  const audioSelected = useEditorStore((s) => s.audioSelected);

  return (
    <aside className="flex w-[320px] shrink-0 flex-col border-l border-border bg-card">
      <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Inspecteur
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {clip ? (
          <ClipInspector clip={clip} />
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
