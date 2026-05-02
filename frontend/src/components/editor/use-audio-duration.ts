"use client";

import { useEffect, useState } from "react";

const cache = new Map<number, number>();

/**
 * Resolve an audio asset's duration by loading just its metadata.
 * Memoised module-wide so repeated mounts don't re-fetch.
 */
export function useAudioDuration(assetId: number | null | undefined): number | null {
  const [duration, setDuration] = useState<number | null>(
    assetId != null ? (cache.get(assetId) ?? null) : null,
  );

  useEffect(() => {
    if (assetId == null) {
      setDuration(null);
      return;
    }
    const cached = cache.get(assetId);
    if (cached != null) {
      setDuration(cached);
      return;
    }
    const audio = new Audio();
    audio.preload = "metadata";
    audio.src = `/api/files/asset/${assetId}`;
    function onMeta() {
      if (Number.isFinite(audio.duration)) {
        cache.set(assetId!, audio.duration);
        setDuration(audio.duration);
      }
    }
    audio.addEventListener("loadedmetadata", onMeta);
    return () => audio.removeEventListener("loadedmetadata", onMeta);
  }, [assetId]);

  return duration;
}
