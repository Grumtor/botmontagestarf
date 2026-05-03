"use client";

import { useEffect, useRef, useState } from "react";
import { GripVertical, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useEditorStore } from "@/store/editor";
import { LAYER_COLORS, LAYER_LABELS, LAYER_TYPES } from "@/lib/editor-types";
import { Templates, type LayerType } from "@/lib/api";
import { cn } from "@/lib/utils";

const VISUAL_TYPES = new Set<LayerType>(["image", "gif", "emoji"]);

export function EditorSidebar() {
  const template = useEditorStore((s) => s.template);
  const layers = useEditorStore((s) => s.layers);
  const selectedLayerId = useEditorStore((s) => s.selectedLayerId);
  const setSelected = useEditorStore((s) => s.setSelectedLayerId);
  const reorder = useEditorStore((s) => s.reorderLayers);
  const addLayer = useEditorStore((s) => s.addLayer);
  const patchLayerData = useEditorStore((s) => s.patchLayerData);

  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [pendingType, setPendingType] = useState<LayerType | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Topmost (highest z_index) appears at the top.
  const visualOrder = [...layers].reverse();

  function handleAdd(type: LayerType) {
    if (VISUAL_TYPES.has(type)) {
      // Create the layer first (so we have an id), then prompt for the file.
      const layer = addLayer(type);
      setPendingType(type);
      // Stash the layer id on the input via dataset so we know which to patch.
      if (fileRef.current) fileRef.current.dataset.layerId = layer.id;
      fileRef.current?.click();
    } else {
      addLayer(type);
    }
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    if (!template) return;
    const file = e.target.files?.[0];
    const layerId = e.target.dataset.layerId;
    e.target.value = "";
    if (!file || !layerId) return;
    try {
      const res = await Templates.uploadOverlay(template.id, file);
      patchLayerData(layerId, { file_id: res.file_id });
    } catch (err) {
      console.error("upload failed", err);
    } finally {
      setPendingType(null);
    }
  }

  return (
    <aside className="flex w-[240px] shrink-0 flex-col border-r border-border bg-card">
      <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Calques
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {visualOrder.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            Aucun calque. Clique sur « + Ajouter calque » en bas.
          </p>
        ) : (
          <ul className="space-y-1">
            {visualOrder.map((layer, visualIdx) => {
              const realIdx = layers.length - 1 - visualIdx;
              const active = layer.id === selectedLayerId;
              return (
                <li
                  key={layer.id}
                  draggable
                  onDragStart={(e) => {
                    setDragIdx(realIdx);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setHoverIdx(realIdx);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragIdx !== null && dragIdx !== realIdx) {
                      reorder(dragIdx, realIdx);
                    }
                    setDragIdx(null);
                    setHoverIdx(null);
                  }}
                  onDragEnd={() => {
                    setDragIdx(null);
                    setHoverIdx(null);
                  }}
                  onClick={() => setSelected(layer.id)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-xs transition",
                    active
                      ? "border-primary bg-accent"
                      : "hover:bg-accent/50",
                    hoverIdx === realIdx && dragIdx !== null && "ring-1 ring-ring",
                  )}
                >
                  <GripVertical className="h-3 w-3 text-muted-foreground" />
                  <span
                    className="h-3 w-3 shrink-0 rounded-sm"
                    style={{ backgroundColor: LAYER_COLORS[layer.type] }}
                  />
                  <span className="truncate">
                    {LAYER_LABELS[layer.type]} #{layer.z_index + 1}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <AddLayerMenu onPick={handleAdd} />
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/gif"
        className="hidden"
        onChange={onPickFile}
      />
    </aside>
  );
}

function AddLayerMenu({ onPick }: { onPick: (type: LayerType) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative border-t border-border p-2" ref={ref}>
      <Button
        size="sm"
        className="w-full justify-start"
        onClick={() => setOpen((v) => !v)}
      >
        <Plus className="h-4 w-4" />
        Ajouter calque
      </Button>
      {open && (
        <div className="absolute bottom-full left-2 right-2 z-20 mb-2 overflow-hidden rounded-md border border-border bg-popover shadow-lg">
          {LAYER_TYPES.map((opt) => (
            <button
              key={opt.type}
              type="button"
              onClick={() => {
                onPick(opt.type);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition hover:bg-accent"
            >
              <span
                className="h-3 w-3 rounded-sm"
                style={{ backgroundColor: LAYER_COLORS[opt.type] }}
              />
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
