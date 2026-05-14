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
import { parseSnapData, type Layer } from "@/lib/api";
import { useEditorStore } from "@/store/editor";
import { EmojiPickerButton } from "./emoji-picker";

type Props = { layer: Layer };

/**
 * Inspector for "snap" filter layers.
 *
 * Snap is a fixed-look full-width semi-transparent caption bar with white
 * centred text. The user only configures:
 *   - Type de filtre (currently only "Snap")
 *   - In/Out timing (s)
 *   - Taille du texte (px)
 *   - Pool de textes (multi-line, --- separator, random pick per render)
 *   - Zone de hauteur aléatoire (Y_min, Y_max in %)
 *
 * Bar background, text colour, font, padding etc. are hardcoded to the
 * Snap default look (dark 45% rgba, white #FFFFFF, system-bold sans).
 */
export function SnapInspector({ layer }: Props) {
  const patchLayer = useEditorStore((s) => s.patchLayer);
  const patchData = useEditorStore((s) => s.patchLayerData);
  const deleteLayer = useEditorStore((s) => s.deleteLayer);

  const data = parseSnapData(layer.data);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function insertEmojiAtCursor(emoji: string) {
    const ta = textareaRef.current;
    const variations = data.text_pool.length > 0
      ? data.text_pool
      : data.text
        ? [data.text]
        : [""];
    const joined = variations.join("\n---\n");
    if (!ta) {
      const next = joined + emoji;
      commitTextarea(next);
      return;
    }
    const start = ta.selectionStart ?? joined.length;
    const end = ta.selectionEnd ?? joined.length;
    const next = joined.slice(0, start) + emoji + joined.slice(end);
    commitTextarea(next);
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + emoji.length;
      ta.setSelectionRange(pos, pos);
    });
  }

  function commitTextarea(rawValue: string) {
    const parts = rawValue.split(/\n---\n/);
    const cleaned = parts.map((p) => p);
    while (cleaned.length > 0 && cleaned[cleaned.length - 1].trim() === "") {
      cleaned.pop();
    }
    if (cleaned.length === 0) {
      patchData(layer.id, { text: "", text_pool: [] });
      return;
    }
    if (cleaned.length === 1) {
      patchData(layer.id, { text: cleaned[0], text_pool: [] });
      return;
    }
    patchData(layer.id, { text: cleaned[0], text_pool: cleaned });
  }

  const variations = data.text_pool.length > 0 ? data.text_pool : data.text ? [data.text] : [""];
  const variationCount = variations.filter((v) => v.trim().length > 0).length;
  const joined = variations.join("\n---\n");

  return (
    <div className="space-y-4 pt-2">
      {/* Type de filtre */}
      <Field label="Type de filtre">
        <Select value="snap" onValueChange={() => {}}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="snap">📸 Snap</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      {/* Description */}
      <div className="rounded-md border border-yellow-500/40 bg-yellow-700/10 p-3 text-xs">
        <div className="font-semibold text-yellow-200">Barre Snap</div>
        <p className="mt-0.5 text-yellow-200/70">
          Barre semi-transparente style Snapchat sur la vidéo, texte blanc
          centré.
        </p>
      </div>

      {/* In / Out */}
      <FieldRow>
        <NumberField
          label="Entrée (s)"
          value={layer.start_time}
          step={0.1}
          onChange={(v) => patchLayer(layer.id, { start_time: Math.max(0, v) })}
        />
        <NumberField
          label="Sortie (s)"
          value={layer.end_time}
          step={0.1}
          onChange={(v) =>
            patchLayer(layer.id, { end_time: Math.max(layer.start_time, v) })
          }
        />
      </FieldRow>

      {/* Taille du texte */}
      <SliderField
        label="Taille du texte"
        suffix=" px"
        min={12}
        max={120}
        step={1}
        value={Math.round(data.font_size_px)}
        onChange={(v) => patchData(layer.id, { font_size_px: v })}
      />

      {/* Y range — vertical placement randomization */}
      <div className="space-y-1.5">
        <div className="text-xs text-muted-foreground">
          Zone de hauteur aléatoire (%)
        </div>
        <FieldRow>
          <NumberField
            label="Y min"
            value={data.y_pct_min}
            step={1}
            onChange={(v) =>
              patchData(layer.id, {
                y_pct_min: clamp01pct(Math.min(v, data.y_pct_max)),
              })
            }
          />
          <NumberField
            label="Y max"
            value={data.y_pct_max}
            step={1}
            onChange={(v) =>
              patchData(layer.id, {
                y_pct_max: clamp01pct(Math.max(v, data.y_pct_min)),
              })
            }
          />
        </FieldRow>
        {data.y_pct_min === data.y_pct_max ? (
          <p className="text-[10px] text-muted-foreground">
            Position fixe à {data.y_pct_min.toFixed(0)}%.
          </p>
        ) : (
          <p className="text-[10px] text-muted-foreground">
            La barre tombera à un Y aléatoire entre {data.y_pct_min.toFixed(0)}%
            et {data.y_pct_max.toFixed(0)}%.
          </p>
        )}
      </div>

      {/* Text pool */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            Textes ({variationCount}) — un texte aléatoire par vidéo
          </span>
          <EmojiPickerButton onPick={insertEmojiAtCursor} />
        </div>
        <textarea
          ref={textareaRef}
          value={joined}
          onChange={(e) => commitTextarea(e.target.value)}
          rows={Math.min(8, Math.max(2, joined.split("\n").length + 1))}
          spellCheck={false}
          className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-xs leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder={"Premier texte snap\n---\nDeuxième texte snap"}
        />
        <p className="text-[10px] text-muted-foreground">
          Sépare avec <code className="rounded bg-background px-1">---</code>{" "}
          sur sa ligne pour ajouter une variation.
        </p>
      </div>

      {/* Delete */}
      <div className="border-t border-border pt-3">
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

function clamp01pct(v: number): number {
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
    <Field label={`${label}: ${value.toFixed(0)}${suffix ?? ""}`}>
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
