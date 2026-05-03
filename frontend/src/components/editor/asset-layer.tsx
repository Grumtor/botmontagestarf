"use client";

import type { AssetLayerData } from "@/lib/api";

/**
 * Renders an image / gif / emoji layer's content INSIDE the layer wrapper.
 * Files now live under /data/templates/{template_id}/overlays/{file_id}.
 */
export function AssetLayerContent({
  data,
  templateId,
}: {
  data: AssetLayerData;
  templateId: number;
}) {
  if (!data.file_id) {
    return (
      <div className="flex h-full w-full items-center justify-center text-[10px] text-white/70">
        no file
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
        src={`/api/files/template_overlay/${templateId}/${data.file_id}`}
        alt=""
        draggable={false}
        className="absolute inset-0 h-full w-full select-none object-contain"
      />
    </div>
  );
}
