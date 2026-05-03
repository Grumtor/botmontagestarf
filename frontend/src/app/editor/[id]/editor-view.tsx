"use client";

import { useEffect, useState } from "react";
import { Fonts, Templates } from "@/lib/api";
import { useEditorStore } from "@/store/editor";
import { totalDuration } from "@/lib/editor-types";
import { EditorTopbar } from "@/components/editor/editor-topbar";
import { EditorSidebar } from "@/components/editor/editor-sidebar";
import { EditorCanvas } from "@/components/editor/editor-canvas";
import { PlaybackControls } from "@/components/editor/playback-controls";
import { EditorInspector } from "@/components/editor/editor-inspector";
import { EditorTimeline } from "@/components/editor/editor-timeline";

export function EditorView({ id }: { id: number }) {
  const loadTemplate = useEditorStore((s) => s.loadTemplate);
  const loadFonts = useEditorStore((s) => s.loadFonts);
  const template = useEditorStore((s) => s.template);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);
  const setIsPlaying = useEditorStore((s) => s.setIsPlaying);
  const clips = useEditorStore((s) => s.clips);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([Templates.get(id), Fonts.list()])
      .then(([t, fonts]) => {
        if (cancelled) return;
        loadTemplate(t);
        loadFonts(fonts);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Erreur");
      });
    return () => {
      cancelled = true;
    };
  }, [id, loadTemplate, loadFonts]);

  // RAF playback loop
  useEffect(() => {
    if (!isPlaying) return;
    const duration = totalDuration(clips);
    if (duration <= 0) return;
    let last = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const next = useEditorStore.getState().currentTime + dt;
      if (next >= duration) {
        setCurrentTime(duration);
        setIsPlaying(false);
        return;
      }
      setCurrentTime(next);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, clips, setCurrentTime, setIsPlaying]);

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-destructive">
        {error}
      </div>
    );
  }
  if (!template) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
        Chargement…
      </div>
    );
  }

  return (
    <div className="flex h-screen min-h-0 flex-col bg-background text-foreground">
      <EditorTopbar />
      <div className="flex min-h-0 flex-1">
        <EditorSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <PlaybackControls />
          <EditorCanvas />
        </div>
        <EditorInspector />
      </div>
      <EditorTimeline />
    </div>
  );
}
