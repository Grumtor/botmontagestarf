"use client";

import { useRef } from "react";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fontFamily } from "@/lib/editor-types";
import { parseTextData, type FontId, type Layer } from "@/lib/api";
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
      <TextPoolSection
        text={data.text}
        textPool={data.text_pool}
        onPatchData={onPatchData}
        textareaRef={textareaRef}
        onEmojiInsert={insertEmojiAtCursor}
      />

      <PlacementSection
        layer={layer}
        data={data}
        onPatchLayer={(p) => patchLayer(layer.id, p)}
        onPatchData={onPatchData}
      />

      <StyleSection data={data} fonts={fonts} onPatchData={onPatchData} />

      {data.placement_mode !== "random" && (
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
      )}
    </div>
  );
}

// ===== TEXTES — POOL DE VARIATIONS ===================================

function TextPoolSection({
  text,
  textPool,
  onPatchData,
  textareaRef,
  onEmojiInsert,
}: {
  text: string;
  textPool: string[];
  onPatchData: (patch: Record<string, unknown>) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onEmojiInsert: (emoji: string) => void;
}) {
  // Pool semantics: each entry in `text_pool` is one variation, possibly
  // multi-line. The textarea uses a literal "\n---\n" separator so we
  // get clean visual boundaries. Empty entries are stripped.
  //
  // - When text_pool is empty: behaves as a single static `text`.
  // - When text_pool has 1 entry: same as static (still 1 variation).
  // - When text_pool has N>1: each rendered reel picks one variation.
  const variations = textPool.length > 0 ? textPool : text ? [text] : [""];
  const variationCount = variations.filter((v) => v.trim().length > 0).length;
  const joined = variations.join("\n---\n");

  function commit(rawValue: string) {
    // Split on the separator, trim trailing empty entries, but keep blanks
    // in the middle so the user can briefly have an empty line while typing.
    const parts = rawValue.split(/\n---\n/);
    const cleaned = parts.map((p) => p);
    // Drop trailing fully-empty entries
    while (cleaned.length > 0 && cleaned[cleaned.length - 1].trim() === "") {
      cleaned.pop();
    }
    if (cleaned.length === 0) {
      onPatchData({ text: "", text_pool: [] });
      return;
    }
    if (cleaned.length === 1) {
      onPatchData({ text: cleaned[0], text_pool: [] });
      return;
    }
    onPatchData({ text: cleaned[0], text_pool: cleaned });
  }

  return (
    <details
      open
      className="group rounded-md border border-border bg-card/30"
    >
      <summary className="flex cursor-pointer items-center justify-between px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground transition hover:text-foreground">
        <span>Textes — pool de variations</span>
        <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] normal-case text-foreground">
          {variationCount} variation{variationCount > 1 ? "s" : ""}
        </span>
      </summary>
      <div className="space-y-2 px-3 pb-3 pt-1">
        <p className="text-[11px] leading-snug text-muted-foreground">
          Chaque vidéo pioche <strong>aléatoirement</strong> une variation de
          ce pool. Sépare avec <code className="rounded bg-background px-1">---</code>
          {" "}sur sa ligne. Une seule variation = même texte partout.
        </p>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">
            Tape ton texte (et insère des emojis avec 😀)
          </span>
          <EmojiPickerButton onPick={onEmojiInsert} />
        </div>
        <textarea
          ref={textareaRef}
          value={joined}
          onChange={(e) => commit(e.target.value)}
          rows={Math.min(10, Math.max(3, joined.split("\n").length + 1))}
          spellCheck={false}
          className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-xs leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder={"Première variation\n---\nDeuxième variation\n---\nTroisième…"}
        />
      </div>
    </details>
  );
}

// ===== ZONE DE PLACEMENT =============================================

type Zone = { x_pct: number; y_pct: number; width_pct: number; height_pct: number };

/** Read both legacy `placement_zone` and new `placement_zones[]` and
 *  expose them as a single deduplicated array. */
function readZones(data: ReturnType<typeof parseTextData>): Zone[] {
  const zones = Array.isArray(data.placement_zones)
    ? data.placement_zones.slice()
    : [];
  if (data.placement_zone && zones.length === 0) {
    zones.push(data.placement_zone);
  }
  return zones;
}

function PlacementSection({
  layer,
  data,
  onPatchLayer,
  onPatchData,
}: {
  layer: Layer;
  data: ReturnType<typeof parseTextData>;
  onPatchLayer: (patch: Record<string, unknown>) => void;
  onPatchData: (patch: Record<string, unknown>) => void;
}) {
  const enabled = data.placement_mode === "random";
  const zones = readZones(data);

  function makeZoneFromLayer(): Zone {
    // Start the zone slightly bigger than the layer bbox so it's
    // immediately visible & draggable on the canvas.
    const lw = Math.max(10, layer.width_pct);
    const lh = Math.max(10, layer.height_pct);
    const zw = Math.min(100, lw * 1.6);
    const zh = Math.min(100, lh * 2.0);
    const zx = clamp01(layer.x_pct - (zw - lw) / 2);
    const zy = clamp01(layer.y_pct - (zh - lh) / 2);
    return { x_pct: zx, y_pct: zy, width_pct: zw, height_pct: zh };
  }

  function enable() {
    const next = zones.length > 0 ? zones : [makeZoneFromLayer()];
    onPatchData({
      placement_mode: "random",
      placement_zones: next,
      placement_zone: null, // deprecated, force-clear to avoid drift
    });
    // Snap the text bbox to fit inside the first zone if it's currently
    // outside — the user expects the text to be inside *some* zone after
    // toggling random mode.
    const first = next[0];
    const cx = layer.x_pct + layer.width_pct / 2;
    const cy = layer.y_pct + layer.height_pct / 2;
    const isInside =
      cx >= first.x_pct &&
      cx <= first.x_pct + first.width_pct &&
      cy >= first.y_pct &&
      cy <= first.y_pct + first.height_pct;
    if (!isInside) {
      const newW = Math.min(layer.width_pct, first.width_pct);
      const newH = Math.min(layer.height_pct, first.height_pct);
      const newX = first.x_pct + (first.width_pct - newW) / 2;
      const newY = first.y_pct + (first.height_pct - newH) / 2;
      onPatchLayer({
        x_pct: newX,
        y_pct: newY,
        width_pct: newW,
        height_pct: newH,
      });
    }
  }

  function disable() {
    onPatchData({ placement_mode: "fixed" });
    // Keep placement_zones so re-enabling restores the user's last set.
  }

  function addZone() {
    // Offset the new zone slightly so it doesn't overlap perfectly.
    const base = zones.length > 0 ? zones[zones.length - 1] : makeZoneFromLayer();
    const offset = 5;
    const fresh: Zone = {
      x_pct: clamp01(base.x_pct + offset),
      y_pct: clamp01(base.y_pct + offset),
      width_pct: base.width_pct,
      height_pct: base.height_pct,
    };
    onPatchData({
      placement_zones: [...zones, fresh],
      placement_zone: null,
    });
  }

  function removeZone(index: number) {
    const next = zones.filter((_, i) => i !== index);
    if (next.length === 0) {
      // No zones left → fall back to fixed.
      onPatchData({
        placement_mode: "fixed",
        placement_zones: [],
        placement_zone: null,
      });
      return;
    }
    onPatchData({ placement_zones: next, placement_zone: null });
  }

  return (
    <details
      open
      className="group rounded-md border border-border bg-card/30"
    >
      <summary className="flex cursor-pointer items-center justify-between px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground transition hover:text-foreground">
        <span>Zone de placement</span>
        {enabled && (
          <span className="rounded bg-yellow-700/40 px-1.5 py-0.5 text-[10px] normal-case text-yellow-200">
            {zones.length} zone{zones.length > 1 ? "s" : ""}
          </span>
        )}
      </summary>
      <div className="space-y-2 px-3 pb-3 pt-1">
        <button
          type="button"
          onClick={enabled ? disable : enable}
          className={cn(
            "flex w-full items-center justify-between rounded-md border px-3 py-2 text-xs transition",
            enabled
              ? "border-yellow-500/60 bg-yellow-700/10"
              : "border-border hover:bg-accent/50",
          )}
        >
          <div className="flex flex-col items-start text-left">
            <span className="font-medium">Zones aléatoires</span>
            <span className="text-[10px] text-muted-foreground">
              Le texte tombe aléatoirement dans une des zones à chaque vidéo
            </span>
          </div>
          <span
            className={cn(
              "h-4 w-7 rounded-full border transition",
              enabled
                ? "border-yellow-500 bg-yellow-500"
                : "border-border bg-muted",
            )}
          >
            <span
              className={cn(
                "block h-3 w-3 translate-y-[1px] rounded-full bg-white transition",
                enabled ? "translate-x-[14px]" : "translate-x-[2px]",
              )}
            />
          </span>
        </button>

        {enabled && (
          <div className="space-y-2 rounded-md border border-yellow-500/30 bg-yellow-700/5 p-2">
            <p className="text-[10px] text-yellow-200/80">
              Édite chaque zone directement sur le canvas (drag/resize). Au
              rendu, une zone est tirée au hasard puis une position dedans.
            </p>
            <div className="space-y-1">
              {zones.map((z, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded border border-yellow-500/20 bg-background/40 px-2 py-1 text-[11px]"
                >
                  <span className="text-yellow-200">
                    Zone #{i + 1}{" "}
                    <span className="text-muted-foreground">
                      ({z.width_pct.toFixed(0)}×{z.height_pct.toFixed(0)}%)
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => removeZone(i)}
                    className="rounded p-1 text-muted-foreground transition hover:bg-destructive/20 hover:text-destructive"
                    aria-label="Supprimer cette zone"
                    title="Supprimer cette zone"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addZone}
              className="w-full rounded border border-dashed border-yellow-500/40 px-2 py-1.5 text-[11px] text-yellow-200 transition hover:bg-yellow-700/10"
            >
              + ajouter une zone
            </button>
          </div>
        )}
      </div>
    </details>
  );
}

// ===== STYLE (Instagram-like) =========================================
// Six controls only: Police / Couleur texte / Opacité / Contour (toggle +
// width + color) / Alignement / Gras+Italique. Anything else (size,
// letter-spacing, line-height, max-width, highlight variant) is kept in
// the schema with sensible defaults but hidden from the UI.

function StyleSection({
  data,
  fonts,
  onPatchData,
}: {
  data: ReturnType<typeof parseTextData>;
  fonts: { id: FontId; name: string; group: string; group_label: string; installed: boolean }[];
  onPatchData: (patch: Record<string, unknown>) => void;
}) {
  const outlineEnabled = data.style === "stroke";

  return (
    <details
      open
      className="group rounded-md border border-border bg-card/30"
    >
      <summary className="cursor-pointer px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground transition hover:text-foreground">
        Style
      </summary>
      <div className="space-y-3 px-3 pb-3 pt-1">
        {/* Police */}
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
            <SelectContent className="max-h-[420px]">
              {fonts.length === 0 ? (
                <SelectItem value={String(data.font_id)}>Chargement…</SelectItem>
              ) : (
                groupFonts(fonts).map(({ group, label, items }, gi) => (
                  <SelectGroup key={group}>
                    {gi > 0 && <SelectSeparator />}
                    <SelectLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {label}
                    </SelectLabel>
                    {items.map((f) => (
                      <SelectItem
                        key={String(f.id)}
                        value={String(f.id)}
                        disabled={f.installed === false}
                        style={{
                          fontFamily: f.installed
                            ? `'${fontFamily(f.id)}', system-ui, sans-serif`
                            : "system-ui, sans-serif",
                        }}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span>{f.name}</span>
                          {f.installed === false && (
                            <span className="text-[9px] text-muted-foreground">
                              non installée
                            </span>
                          )}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))
              )}
            </SelectContent>
          </Select>
        </Field>

        {/* Taille du texte (px) — converted to/from font_size_pct
            (% of 1920px canvas height). Slider 12-200 px ≈ 0.6-10.4%. */}
        <SliderField
          label="Taille du texte"
          suffix=" px"
          min={12}
          max={200}
          step={1}
          value={Math.round((data.font_size_pct / 100) * 1920)}
          onChange={(px) =>
            onPatchData({ font_size_pct: (px / 1920) * 100 })
          }
        />

        {/* Couleur texte */}
        <Field label="Couleur texte">
          <ColorInput value={data.color} onChange={(v) => onPatchData({ color: v })} />
        </Field>

        {/* Opacité */}
        <SliderField
          label="Opacité"
          suffix="%"
          min={0}
          max={100}
          step={1}
          value={Math.round(data.opacity * 100)}
          onChange={(v) => onPatchData({ opacity: clamp01ratio(v / 100) })}
        />

        {/* Contour (outline) toggle + width + color */}
        <div className="space-y-2 rounded-md border border-border bg-background/40 p-2.5">
          <button
            type="button"
            onClick={() =>
              onPatchData({ style: outlineEnabled ? "plain" : "stroke" })
            }
            className="flex w-full items-center justify-between text-xs"
          >
            <span className="font-medium">Contour (outline)</span>
            <span
              className={cn(
                "h-4 w-7 rounded-full border transition",
                outlineEnabled
                  ? "border-primary bg-primary"
                  : "border-border bg-muted",
              )}
            >
              <span
                className={cn(
                  "block h-3 w-3 translate-y-[1px] rounded-full bg-white transition",
                  outlineEnabled ? "translate-x-[14px]" : "translate-x-[2px]",
                )}
              />
            </span>
          </button>
          {outlineEnabled && (
            <div className="grid grid-cols-[auto,1fr] items-center gap-2">
              <ColorSwatch
                value={data.stroke_color}
                onChange={(v) => onPatchData({ stroke_color: v })}
              />
              <Input
                type="number"
                min={1}
                max={20}
                step={0.5}
                value={data.stroke_width}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n)) onPatchData({ stroke_width: n });
                }}
                className="h-8 text-xs"
              />
            </div>
          )}
        </div>

        {/* Alignement */}
        <Field label="Alignement">
          <div className="flex gap-1">
            {(["left", "center", "right"] as const).map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => onPatchData({ align: a })}
                className={cn(
                  "flex-1 rounded-md border px-2 py-1.5 text-xs transition",
                  data.align === a
                    ? "border-primary bg-accent"
                    : "border-border hover:bg-accent/50",
                )}
                title={a}
              >
                {a === "left" ? "⬅" : a === "right" ? "➡" : "↔"}
              </button>
            ))}
          </div>
        </Field>

        {/* Gras / Italique */}
        <div className="flex items-center gap-4 pt-1 text-xs">
          <button
            type="button"
            onClick={() => onPatchData({ bold: !data.bold })}
            className="flex items-center gap-1.5"
          >
            <span
              className={cn(
                "h-3 w-3 rounded-full border-2 transition",
                data.bold ? "border-primary bg-primary" : "border-border",
              )}
            />
            <span className="font-bold">Gras</span>
          </button>
          <button
            type="button"
            onClick={() => onPatchData({ italic: !data.italic })}
            className="flex items-center gap-1.5"
          >
            <span
              className={cn(
                "h-3 w-3 rounded-full border-2 transition",
                data.italic ? "border-primary bg-primary" : "border-border",
              )}
            />
            <span className="italic">Italique</span>
          </button>
        </div>

        {/* Saut de ligne serré (style Insta) — toggles line-height between
            0.95 (tight, descendants/ascenders se touchent presque,
            comme dans les caption Insta multi-lignes) et 1.2 (default). */}
        <div className="flex items-center gap-2 pt-1 text-xs">
          <button
            type="button"
            onClick={() =>
              onPatchData({
                line_height: data.line_height < 1.1 ? 1.2 : 0.95,
              })
            }
            className="flex items-center gap-1.5"
          >
            <span
              className={cn(
                "h-3 w-3 rounded-full border-2 transition",
                data.line_height < 1.1
                  ? "border-primary bg-primary"
                  : "border-border",
              )}
            />
            <span>Saut de ligne serré (style Insta)</span>
          </button>
        </div>
      </div>
    </details>
  );
}

function ColorSwatch({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <input
      type="color"
      value={normalizeHex(value)}
      onChange={(e) => onChange(e.target.value.toUpperCase())}
      className="h-8 w-10 cursor-pointer rounded border border-input bg-transparent"
      aria-label="Couleur du contour"
    />
  );
}

function clamp01ratio(v: number): number {
  return Math.min(Math.max(v, 0), 1);
}

function parseFontIdValue(v: string): FontId {
  return /^\d+$/.test(v) ? Number(v) : v;
}

const FONT_GROUP_ORDER = [
  "instagram_reels",
  "instagram_pwa",
  "system",
  "user",
] as const;

function groupFonts(
  fonts: { id: FontId; name: string; group: string; group_label: string; installed?: boolean }[],
): { group: string; label: string; items: typeof fonts }[] {
  const map = new Map<string, { group: string; label: string; items: typeof fonts }>();
  for (const f of fonts) {
    const g = f.group || "system";
    if (!map.has(g)) {
      map.set(g, { group: g, label: f.group_label || g, items: [] });
    }
    map.get(g)!.items.push(f);
  }
  // Sort groups by FONT_GROUP_ORDER (known first), unknown groups go last alphabetically.
  const order = new Map(FONT_GROUP_ORDER.map((g, i) => [g as string, i]));
  return Array.from(map.values()).sort((a, b) => {
    const ra = order.get(a.group) ?? 999;
    const rb = order.get(b.group) ?? 999;
    if (ra !== rb) return ra - rb;
    return a.label.localeCompare(b.label);
  });
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

