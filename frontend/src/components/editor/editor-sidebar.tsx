"use client";

import { useState } from "react";
import { GripVertical, Trash2 } from "lucide-react";

import { useEditorStore } from "@/store/editor";
import { LAYER_COLORS, LAYER_LABELS } from "@/lib/editor-types";
import { cn } from "@/lib/utils";

export function EditorSidebar() {
  const layers = useEditorStore((s) => s.layers);
  const selectedLayerId = useEditorStore((s) => s.selectedLayerId);
  const setSelected = useEditorStore((s) => s.setSelectedLayerId);
  const reorder = useEditorStore((s) => s.reorderLayers);
  const deleteLayer = useEditorStore((s) => s.deleteLayer);

  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  // Topmost (highest z_index) on top.
  const visualOrder = [...layers].reverse();

  return (
    <aside className="flex w-[240px] shrink-0 flex-col border-r border-border bg-card">
      <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Calques
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {visualOrder.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            Ajoute des calques depuis l&apos;action bar de la timeline.
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
                    "group flex cursor-pointer items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-xs transition",
                    active ? "border-primary bg-accent" : "hover:bg-accent/50",
                    hoverIdx === realIdx && dragIdx !== null && "ring-1 ring-ring",
                  )}
                >
                  <GripVertical className="h-3 w-3 text-muted-foreground" />
                  <span
                    className="h-3 w-3 shrink-0 rounded-sm"
                    style={{ backgroundColor: LAYER_COLORS[layer.type] }}
                  />
                  <span className="truncate flex-1">
                    {LAYER_LABELS[layer.type]} #{layer.z_index + 1}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteLayer(layer.id);
                    }}
                    className="text-muted-foreground opacity-0 transition hover:text-destructive group-hover:opacity-100"
                    title="Supprimer"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
