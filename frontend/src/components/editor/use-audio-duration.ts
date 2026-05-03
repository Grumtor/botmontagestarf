"use client";

import { useEffect, useState } from "react";

const cache = new Map<string, number>();

/**
 * Resolve an audio file's duration by loading just its metadata.
 * Memoised module-wide so repeated mounts don't re-fetch.
 * Pass a full URL.
 */
export function useAudioDuration(url: string | null | undefined): number | null {
  const [duration, setDuration] = useState<number | null>(
    url ? (cache.get(url) ?? null) : null,
  );

  useEffect(() => {
    if (!url) {
      setDuration(null);
      return;
    }
    const cached = cache.get(url);
    if (cached != null) {
      setDuration(cached);
      return;
    }
    const audio = new Audio();
    audio.preload = "metadata";
    audio.src = url;
    function onMeta() {
      if (Number.isFinite(audio.duration)) {
        cache.set(url!, audio.duration);
        setDuration(audio.duration);
      }
    }
    audio.addEventListener("loadedmetadata", onMeta);
    return () => audio.removeEventListener("loadedmetadata", onMeta);
  }, [url]);

  return duration;
}
