"use client";

import { Pause, Play, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useEditorStore } from "@/store/editor";
import { clamp, formatTime, totalDuration } from "@/lib/editor-types";

export function PlaybackControls() {
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const setIsPlaying = useEditorStore((s) => s.setIsPlaying);
  const currentTime = useEditorStore((s) => s.currentTime);
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);
  const clips = useEditorStore((s) => s.clips);
  const duration = Math.max(0, totalDuration(clips));

  function togglePlay() {
    if (duration === 0) return;
    if (currentTime >= duration) setCurrentTime(0);
    setIsPlaying(!isPlaying);
  }

  function stop() {
    setIsPlaying(false);
    setCurrentTime(0);
  }

  return (
    <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-card px-4">
      <Button size="icon" variant="ghost" onClick={togglePlay} aria-label="Play / Pause">
        {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </Button>
      <Button size="icon" variant="ghost" onClick={stop} aria-label="Stop">
        <Square className="h-4 w-4" />
      </Button>

      <input
        type="range"
        min={0}
        max={Math.max(duration, 0.01)}
        step={0.01}
        value={currentTime}
        onChange={(e) => {
          const v = clamp(Number(e.target.value), 0, duration);
          setCurrentTime(v);
        }}
        className="flex-1 accent-primary"
        disabled={duration === 0}
      />

      <div className="font-mono text-xs tabular-nums text-muted-foreground">
        {formatTime(currentTime)} / {formatTime(duration)}
      </div>
    </div>
  );
}
