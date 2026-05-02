"use client";

import type { AssetLayerData } from "@/lib/api";

/**
 * Renders an image / gif / emoji layer's content INSIDE the layer wrapper.
 * The wrapper handles position + drag + resize handles. Rotation and opacity
 * are applied to the image itself so the bounding box stays axis-aligned
 * (resize handles remain at the bbox corners, which is the standard editor UX).
 */
export function AssetLayerContent({ data }: { data: AssetLayerData }) {
  if (!data.asset_id) {
    return (
      <div className="flex h-full w-full items-center justify-center text-[10px] text-white/70">
        no asset
      </div>
    );
  }
  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{
        opacity: data.opacity,
        transform: `rotate(${data.rotation_deg}deg)`,
        transformOrigin: "center",
      }}
    >
      <img
        src={`/api/files/asset/${data.asset_id}`}
        alt=""
        draggable={false}
        className="absolute inset-0 h-full w-full select-none object-contain"
      />
    </div>
  );
}
