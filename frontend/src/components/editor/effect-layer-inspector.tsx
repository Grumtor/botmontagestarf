"use client";

import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEditorStore } from "@/store/editor";
import { EFFECT_TYPES, effectForceRange } from "@/lib/editor-types";
import { parseEffectData, type EffectType, type Layer } from "@/lib/api";

export function EffectLayerInspector({ layer }: { layer: Layer }) {
  const patchLayer = useEditorStore((s) => s.patchLayer);
  const patchLayerData = useEditorStore((s) => s.patchLayerData);
  const deleteLayer = useEditorStore((s) => s.deleteLayer);
  const data = parseEffectData(layer.data);
  const range = effectForceRange(data.type);

  function onTypeChange(newType: EffectType) {
    const newRange = effectForceRange(newType);
    const clamped = Math.max(newRange.min, Math.min(newRange.max, data.force));
    patchLayerData(layer.id, { type: newType, force: clamped });
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Type</div>
        <div className="text-sm font-medium">Effet</div>
      </div>

      <label className="flex flex-col gap-1.5 text-xs">
        <span className="text-muted-foreground">Effet</span>
        <Select value={data.type} onValueChange={(v) => onTypeChange(v as EffectType)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EFFECT_TYPES.map((e) => (
              <SelectItem key={e.type} value={e.type}>
                {e.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>

      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">
          Force: {data.force.toFixed(0)}
        </span>
        <input
          type="range"
          min={range.min}
          max={range.max}
          step={1}
          value={data.force}
          onChange={(e) => patchLayerData(layer.id, { force: Number(e.target.value) })}
          className="w-full accent-primary"
        />
      </label>

      <div className="space-y-2">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          Range temps
        </div>
        <div className="grid grid-cols-2 gap-2">
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
        </div>
      </div>

      <Button
        variant="destructive"
        size="sm"
        className="w-full"
        onClick={() => deleteLayer(layer.id)}
      >
        <Trash2 className="h-4 w-4" />
        Supprimer le calque
      </Button>
    </div>
  );
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
