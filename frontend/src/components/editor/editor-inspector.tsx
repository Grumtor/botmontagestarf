"use client";

import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEditorStore } from "@/store/editor";
import { LAYER_LABELS } from "@/lib/editor-types";
import type { Layer } from "@/lib/api";
import { TextInspector } from "./text-inspector";
import { AssetLayerInspector } from "./asset-layer-inspector";
import { EffectLayerInspector } from "./effect-layer-inspector";
import { AnimationLayerInspector } from "./animation-layer-inspector";
import { AudioOverlayInspector, AudioSourceInspector } from "./audio-inspectors";

const VISUAL_ASSET_TYPES = new Set(["image", "gif", "emoji"]);

export function EditorInspector() {
  const layer = useEditorStore((s) =>
    s.selectedLayerId
      ? (s.layers.find((l) => l.id === s.selectedLayerId) ?? null)
      : null,
  );
  const audioSelection = useEditorStore((s) => s.audioSelection);
  const patchLayer = useEditorStore((s) => s.patchLayer);
  const deleteLayer = useEditorStore((s) => s.deleteLayer);

  return (
    <aside className="flex w-[320px] shrink-0 flex-col border-l border-border bg-card">
      <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Inspecteur
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {audioSelection === "source" ? (
          <AudioSourceInspector />
        ) : audioSelection === "overlay" ? (
          <AudioOverlayInspector />
        ) : layer === null ? (
          <p className="text-sm text-muted-foreground">
            Sélectionne un calque ou une piste audio.
          </p>
        ) : layer.type === "text" ? (
          <TextInspector layer={layer} />
        ) : VISUAL_ASSET_TYPES.has(layer.type) ? (
          <AssetLayerInspector layer={layer} />
        ) : layer.type === "effect" ? (
          <EffectLayerInspector layer={layer} />
        ) : layer.type === "animation" ? (
          <AnimationLayerInspector layer={layer} />
        ) : (
          <InspectorBody layer={layer} onPatch={patchLayer} onDelete={deleteLayer} />
        )}
      </div>
    </aside>
  );
}

function InspectorBody({
  layer,
  onPatch,
  onDelete,
}: {
  layer: Layer;
  onPatch: (id: string, patch: Partial<Layer>) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Type</div>
        <div className="text-sm font-medium">{LAYER_LABELS[layer.type]}</div>
      </div>

      <Section title="Temps">
        <Field
          label="Start (s)"
          step={0.1}
          value={layer.start_time}
          onChange={(v) => onPatch(layer.id, { start_time: Math.max(0, v) })}
        />
        <Field
          label="End (s)"
          step={0.1}
          value={layer.end_time}
          onChange={(v) => onPatch(layer.id, { end_time: Math.max(layer.start_time, v) })}
        />
      </Section>

      <Section title="Position (%)">
        <Field
          label="X"
          step={0.5}
          value={layer.x_pct}
          onChange={(v) => onPatch(layer.id, { x_pct: clampPct(v) })}
        />
        <Field
          label="Y"
          step={0.5}
          value={layer.y_pct}
          onChange={(v) => onPatch(layer.id, { y_pct: clampPct(v) })}
        />
      </Section>

      <Section title="Taille (%)">
        <Field
          label="Width"
          step={0.5}
          value={layer.width_pct}
          onChange={(v) => onPatch(layer.id, { width_pct: clampPct(v) })}
        />
        <Field
          label="Height"
          step={0.5}
          value={layer.height_pct}
          onChange={(v) => onPatch(layer.id, { height_pct: clampPct(v) })}
        />
      </Section>

      <Button
        variant="destructive"
        size="sm"
        className="w-full"
        onClick={() => onDelete(layer.id)}
      >
        <Trash2 className="h-4 w-4" />
        Supprimer le calque
      </Button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{title}</div>
      <div className="grid grid-cols-2 gap-2">{children}</div>
    </div>
  );
}

function Field({
  label,
  value,
  step,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <Input
        type="number"
        step={step}
        value={Number.isFinite(value) ? Number(value.toFixed(2)) : 0}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
        className="h-8 text-xs"
      />
    </label>
  );
}

function clampPct(v: number): number {
  return Math.min(Math.max(v, 0), 100);
}
