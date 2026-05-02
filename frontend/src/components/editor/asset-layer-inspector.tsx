"use client";

import { useState } from "react";
import { Image as ImageIcon, Lock, Trash2, Unlock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEditorStore } from "@/store/editor";
import { LAYER_LABELS } from "@/lib/editor-types";
import { parseAssetData, type Asset, type Layer } from "@/lib/api";
import { cn } from "@/lib/utils";
import { AssetPickerDialog } from "./asset-picker-dialog";

type Props = { layer: Layer };

export function AssetLayerInspector({ layer }: Props) {
  const patchLayer = useEditorStore((s) => s.patchLayer);
  const patchLayerData = useEditorStore((s) => s.patchLayerData);
  const deleteLayer = useEditorStore((s) => s.deleteLayer);
  const data = parseAssetData(layer.data);
  const [pickerOpen, setPickerOpen] = useState(false);

  const visualType = layer.type as "image" | "gif" | "emoji";

  function onAssetPicked(asset: Asset, w: number, h: number) {
    // Update asset_id and (optionally) the layer's height to match the new
    // asset's natural ratio if ratio is locked.
    patchLayerData(layer.id, { asset_id: asset.id });
    if (data.ratio_locked && w > 0 && h > 0) {
      const canvasAspect = 9 / 16;
      const newHeight = layer.width_pct * canvasAspect * (h / w);
      patchLayer(layer.id, { height_pct: newHeight });
    }
    setPickerOpen(false);
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Type</div>
        <div className="text-sm font-medium">{LAYER_LABELS[layer.type]}</div>
      </div>

      <Button
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => setPickerOpen(true)}
      >
        <ImageIcon className="h-4 w-4" />
        Changer asset
      </Button>

      <Section title="Apparence">
        <SliderField
          label="Rotation"
          suffix="°"
          min={0}
          max={360}
          step={1}
          value={data.rotation_deg}
          onChange={(v) => patchLayerData(layer.id, { rotation_deg: v })}
        />
        <SliderField
          label="Opacité"
          suffix="%"
          min={0}
          max={100}
          step={1}
          value={Math.round(data.opacity * 100)}
          onChange={(v) => patchLayerData(layer.id, { opacity: v / 100 })}
        />
      </Section>

      <button
        type="button"
        onClick={() =>
          patchLayerData(layer.id, { ratio_locked: !data.ratio_locked })
        }
        className={cn(
          "flex w-full items-center justify-between rounded-md border px-3 py-2 text-xs transition",
          data.ratio_locked
            ? "border-primary bg-accent"
            : "border-border hover:bg-accent/50",
        )}
      >
        <span className="flex items-center gap-2">
          {data.ratio_locked ? (
            <Lock className="h-3 w-3" />
          ) : (
            <Unlock className="h-3 w-3" />
          )}
          Ratio verrouillé
        </span>
        <span className="text-muted-foreground">
          {data.ratio_locked ? "ON" : "OFF"}
        </span>
      </button>

      <Section title="Position (%)">
        <FieldRow>
          <NumberField
            label="X"
            value={layer.x_pct}
            step={0.5}
            onChange={(v) => patchLayer(layer.id, { x_pct: clamp01(v) })}
          />
          <NumberField
            label="Y"
            value={layer.y_pct}
            step={0.5}
            onChange={(v) => patchLayer(layer.id, { y_pct: clamp01(v) })}
          />
        </FieldRow>
        <NumberField
          label="Width (%)"
          value={layer.width_pct}
          step={0.5}
          onChange={(v) => patchLayer(layer.id, { width_pct: clamp01(v) })}
        />
      </Section>

      <Section title="Temps">
        <FieldRow>
          <NumberField
            label="Start (s)"
            value={layer.start_time}
            step={0.1}
            onChange={(v) => patchLayer(layer.id, { start_time: Math.max(0, v) })}
          />
          <NumberField
            label="End (s)"
            value={layer.end_time}
            step={0.1}
            onChange={(v) =>
              patchLayer(layer.id, { end_time: Math.max(layer.start_time, v) })
            }
          />
        </FieldRow>
      </Section>

      <Button
        variant="destructive"
        size="sm"
        className="w-full"
        onClick={() => deleteLayer(layer.id)}
      >
        <Trash2 className="h-4 w-4" />
        Supprimer le calque
      </Button>

      <AssetPickerDialog
        open={pickerOpen}
        type={visualType}
        onPick={onAssetPicked}
        onOpenChange={setPickerOpen}
      />
    </div>
  );
}

function clamp01(v: number): number {
  return Math.min(Math.max(v, 0), 100);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function FieldRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-2">{children}</div>;
}

function NumberField({
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

function SliderField({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-muted-foreground">
        {label}: {value.toFixed(0)}{suffix ?? ""}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary"
      />
    </label>
  );
}
