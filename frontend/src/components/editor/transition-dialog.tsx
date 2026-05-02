"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEditorStore } from "@/store/editor";
import { TRANSITION_TYPES } from "@/lib/editor-types";
import type { TransitionType } from "@/lib/api";

type Props = {
  segmentIndex: number | null;
  onOpenChange: (v: boolean) => void;
};

export function TransitionDialog({ segmentIndex, onOpenChange }: Props) {
  const segments = useEditorStore((s) => s.sourceSegments);
  const setTransition = useEditorStore((s) => s.setSegmentTransition);

  const open = segmentIndex !== null;
  const transition =
    segmentIndex !== null ? segments[segmentIndex]?.transition_to_next : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Transition</DialogTitle>
          <DialogDescription>
            Configure la transition entre les deux segments adjacents.
          </DialogDescription>
        </DialogHeader>

        {transition && segmentIndex !== null && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Type</label>
              <Select
                value={transition.type}
                onValueChange={(v) =>
                  setTransition(segmentIndex, {
                    ...transition,
                    type: v as TransitionType,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRANSITION_TYPES.map((t) => (
                    <SelectItem key={t.type} value={t.type}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Durée: {transition.duration.toFixed(2)}s
              </label>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={transition.duration}
                onChange={(e) =>
                  setTransition(segmentIndex, {
                    ...transition,
                    duration: Number(e.target.value),
                  })
                }
                className="w-full accent-primary"
                disabled={transition.type === "cut"}
              />
              {transition.type === "cut" && (
                <p className="text-xs text-muted-foreground">
                  La durée n&apos;est pas utilisée pour un cut.
                </p>
              )}
            </div>

            <p className="rounded-md border border-border bg-background/50 p-2 text-[11px] leading-relaxed text-muted-foreground">
              Preview CSS approximative — le rendu réel (slide, zoom, glitch) est
              généré par ffmpeg au moment du batch.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
