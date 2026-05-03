"use client";

import { useRef } from "react";
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
import { fontFamily } from "@/lib/editor-types";
import { parseTextData, type FontId, type Layer, type TextStyle } from "@/lib/api";
import { useEditorStore } from "@/store/editor";
import { cn } from "@/lib/utils";
import { EmojiPickerButton } from "./emoji-picker";

type Props = { layer: Layer };

export function TextInspector({ layer }: Props) {
  const patchLayer = useEditorStore((s) => s.patchLayer);
  const patchData = useEditorStore((s) => s.patchLayerData);
  const deleteLayer = useEditorStore((s) => s.deleteLayer);

  return (
    <div className="space-y-4">
      <StyleTab layer={layer} onPatchData={(p) => patchData(layer.id, p)} />

      <div className="space-y-2 border-t border-border pt-4">
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
    </div>
  );
}

function StyleTab({
  layer,
  onPatchData,
}: {
  layer: Layer;
  onPatchData: (patch: Record<string, unknown>) => void;
}) {
  const data = parseTextData(layer.data);
  const fonts = useEditorStore((s) => s.fonts);
  const patchLayer = useEditorStore((s) => s.patchLayer);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function insertEmojiAtCursor(emoji: string) {
    const ta = textareaRef.current;
    if (!ta) {
      onPatchData({ text: data.text + emoji });
      return;
    }
    const start = ta.selectionStart ?? data.text.length;
    const end = ta.selectionEnd ?? data.text.length;
    const next = data.text.slice(0, start) + emoji + data.text.slice(end);
    onPatchData({ text: next });
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + emoji.length;
      ta.setSelectionRange(pos, pos);
    });
  }

  return (
    <div className="space-y-4 pt-2">
      <Field
        label={
          <span className="flex items-center justify-between">
            <span>Texte</span>
            <EmojiPickerButton onPick={insertEmojiAtCursor} />
          </span>
        }
      >
        <textarea
          ref={textareaRef}
          value={data.text}
          onChange={(e) => onPatchData({ text: e.target.value })}
          rows={3}
          className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </Field>

      <Field label="Police">
        <Select
          value={String(data.font_id)}
          onValueChange={(v) => onPatchData({ font_id: parseFontIdValue(v) })}
        >
          <SelectTrigger
            style={{ fontFamily: `'${fontFamily(data.font_id)}', system-ui, sans-serif` }}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {fonts.length === 0 && (
              <SelectItem value={String(data.font_id)}>Chargement…</SelectItem>
            )}
            {fonts.map((f) => (
              <SelectItem
                key={String(f.id)}
                value={String(f.id)}
                style={{ fontFamily: `'${fontFamily(f.id)}', system-ui, sans-serif` }}
              >
                {f.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <SliderField
        label="Taille"
        suffix="%"
        min={1}
        max={15}
        step={0.1}
        value={data.font_size_pct}
        onChange={(v) => onPatchData({ font_size_pct: v })}
      />

      <FieldRow>
        <Field label="Couleur">
          <ColorInput
            value={data.color}
            onChange={(v) => onPatchData({ color: v })}
          />
        </Field>
        <Field label="Style">
          <div className="flex gap-1">
            <ToggleBtn
              active={data.bold}
              onClick={() => onPatchData({ bold: !data.bold })}
              label="B"
              bold
            />
            <ToggleBtn
              active={data.italic}
              onClick={() => onPatchData({ italic: !data.italic })}
              label="I"
              italic
            />
          </div>
        </Field>
      </FieldRow>

      <SliderField
        label="Letter-spacing"
        suffix="em"
        min={-0.1}
        max={0.5}
        step={0.01}
        value={data.letter_spacing}
        onChange={(v) => onPatchData({ letter_spacing: v })}
      />

      <SliderField
        label="Line-height"
        min={0.8}
        max={2}
        step={0.05}
        value={data.line_height}
        onChange={(v) => onPatchData({ line_height: v })}
      />

      <SliderField
        label="Max width"
        suffix="%"
        min={10}
        max={100}
        step={1}
        value={data.max_width_pct}
        onChange={(v) => onPatchData({ max_width_pct: v })}
      />

      <Field label="Variante">
        <div className="flex gap-1">
          {(["plain", "highlight", "stroke"] as TextStyle[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onPatchData({ style: s })}
              className={cn(
                "flex-1 rounded-md border px-2 py-1 text-xs capitalize transition",
                data.style === s
                  ? "border-primary bg-accent"
                  : "border-border hover:bg-accent/50",
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </Field>

      {data.style === "highlight" && (
        <FieldRow>
          <Field label="Highlight">
            <ColorInput
              value={data.highlight_color}
              onChange={(v) => onPatchData({ highlight_color: v })}
            />
          </Field>
          <SliderField
            label="Padding"
            suffix="px"
            min={0}
            max={30}
            step={1}
            value={data.highlight_padding}
            onChange={(v) => onPatchData({ highlight_padding: v })}
          />
        </FieldRow>
      )}

      {data.style === "stroke" && (
        <FieldRow>
          <Field label="Stroke">
            <ColorInput
              value={data.stroke_color}
              onChange={(v) => onPatchData({ stroke_color: v })}
            />
          </Field>
          <SliderField
            label="Width"
            suffix="px"
            min={1}
            max={20}
            step={0.5}
            value={data.stroke_width}
            onChange={(v) => onPatchData({ stroke_width: v })}
          />
        </FieldRow>
      )}

      <Field label="Alignement">
        <div className="flex gap-1">
          {(["left", "center", "right"] as const).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => onPatchData({ align: a })}
              className={cn(
                "flex-1 rounded-md border px-2 py-1 text-xs capitalize transition",
                data.align === a
                  ? "border-primary bg-accent"
                  : "border-border hover:bg-accent/50",
              )}
            >
              {a}
            </button>
          ))}
        </div>
      </Field>

      <FieldRow>
        <NumberField
          label="X (%)"
          value={layer.x_pct}
          step={0.5}
          onChange={(v) => patchLayer(layer.id, { x_pct: clamp01(v) })}
        />
        <NumberField
          label="Y (%)"
          value={layer.y_pct}
          step={0.5}
          onChange={(v) => patchLayer(layer.id, { y_pct: clamp01(v) })}
        />
      </FieldRow>
    </div>
  );
}

function parseFontIdValue(v: string): FontId {
  return /^\d+$/.test(v) ? Number(v) : v;
}

function clamp01(v: number): number {
  return Math.min(Math.max(v, 0), 100);
}

function FieldRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-2">{children}</div>;
}

function Field({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
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
    <Field label={label}>
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
    </Field>
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
    <Field label={`${label}: ${value.toFixed(2)}${suffix ?? ""}`}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary"
      />
    </Field>
  );
}

function ColorInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex h-8 items-center gap-2">
      <input
        type="color"
        value={normalizeHex(value)}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        className="h-8 w-10 cursor-pointer rounded border border-input bg-transparent"
        aria-label="Couleur"
      />
      <Input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 flex-1 font-mono text-xs"
        spellCheck={false}
      />
    </div>
  );
}

function normalizeHex(v: string): string {
  return /^#[0-9A-Fa-f]{6}$/.test(v) ? v : "#FFFFFF";
}

function ToggleBtn({
  active,
  onClick,
  label,
  bold,
  italic,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  bold?: boolean;
  italic?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-8 w-8 rounded-md border text-xs transition",
        active ? "border-primary bg-accent" : "border-border hover:bg-accent/50",
        bold && "font-bold",
        italic && "italic",
      )}
    >
      {label}
    </button>
  );
}
