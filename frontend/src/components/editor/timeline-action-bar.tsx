"use client";

import { useRef, useState } from "react";
import {
  Film,
  ImageIcon,
  Music,
  Smile,
  Sparkles,
  Square,
  Type,
} from "lucide-react";

import { Templates, type LayerType } from "@/lib/api";
import { useEditorStore } from "@/store/editor";

/** Big-button row above the timeline tracks: + Vidéo, + Placeholder, + Texte,
 * + Image, + GIF, + Emoji, + Audio overlay. Each button either uploads a file
 * or just creates the layer/clip directly. */
export function TimelineActionBar() {
  const template = useEditorStore((s) => s.template);
  const addFixed = useEditorStore((s) => s.addFixedClip);
  const addPlaceholder = useEditorStore((s) => s.addPlaceholderClip);
  const addLayer = useEditorStore((s) => s.addLayer);
  const patchLayerData = useEditorStore((s) => s.patchLayerData);
  const patchAudioOverlay = useEditorStore((s) => s.patchAudioOverlay);
  const setAudioSelected = useEditorStore((s) => s.setAudioSelected);

  const videoInputRef = useRef<HTMLInputElement>(null);
  const overlayInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const [pendingType, setPendingType] = useState<LayerType | null>(null);
  const [uploading, setUploading] = useState(false);

  async function onVideoFile(e: React.ChangeEvent<HTMLInputElement>) {
    if (!template) return;
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const res = await Templates.uploadClip(template.id, file);
      addFixed(res.file_id, res.duration_sec, res.width, res.height);
    } finally {
      setUploading(false);
    }
  }

  function pickOverlayLayer(type: LayerType) {
    setPendingType(type);
    overlayInputRef.current?.click();
  }

  async function onOverlayFile(e: React.ChangeEvent<HTMLInputElement>) {
    if (!template || !pendingType) return;
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) {
      setPendingType(null);
      return;
    }
    setUploading(true);
    try {
      const layer = addLayer(pendingType);
      const res = await Templates.uploadOverlay(template.id, file);
      patchLayerData(layer.id, { file_id: res.file_id });
    } finally {
      setUploading(false);
      setPendingType(null);
    }
  }

  async function onAudioFile(e: React.ChangeEvent<HTMLInputElement>) {
    if (!template) return;
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const res = await Templates.uploadOverlay(template.id, file);
      patchAudioOverlay({
        file_id: res.file_id,
        start_offset: 0,
        trim_in: 0,
      });
      setAudioSelected(true);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-2">
      <ActionButton
        icon={Film}
        label="Vidéo"
        onClick={() => videoInputRef.current?.click()}
        disabled={uploading || !template}
      />
      <ActionButton
        icon={Square}
        label="Placeholder"
        onClick={() => addPlaceholder(3)}
        disabled={!template}
        variant="placeholder"
      />
      <Divider />
      <ActionButton
        icon={Type}
        label="Texte"
        onClick={() => addLayer("text")}
        disabled={!template}
      />
      <ActionButton
        icon={ImageIcon}
        label="Image"
        onClick={() => pickOverlayLayer("image")}
        disabled={uploading || !template}
      />
      <ActionButton
        icon={Sparkles}
        label="GIF"
        onClick={() => pickOverlayLayer("gif")}
        disabled={uploading || !template}
      />
      <ActionButton
        icon={Smile}
        label="Emoji"
        onClick={() => pickOverlayLayer("emoji")}
        disabled={uploading || !template}
      />
      <Divider />
      <ActionButton
        icon={Music}
        label="Audio"
        onClick={() => audioInputRef.current?.click()}
        disabled={uploading || !template}
      />

      {uploading && (
        <span className="ml-auto text-[10px] text-muted-foreground">
          Upload en cours…
        </span>
      )}

      <input
        ref={videoInputRef}
        type="file"
        accept="video/mp4,video/quicktime,.mp4,.mov"
        className="hidden"
        onChange={onVideoFile}
      />
      <input
        ref={overlayInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif"
        className="hidden"
        onChange={onOverlayFile}
      />
      <input
        ref={audioInputRef}
        type="file"
        accept="audio/mpeg,audio/wav,audio/mp4,audio/x-m4a,.mp3,.wav,.m4a"
        className="hidden"
        onChange={onAudioFile}
      />
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  variant = "default",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "default" | "placeholder";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        variant === "placeholder"
          ? "flex items-center gap-1.5 rounded-md border border-dashed border-yellow-500/70 px-2.5 py-1.5 text-xs text-yellow-300 transition hover:bg-yellow-700/20 disabled:opacity-50"
          : "flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs transition hover:bg-accent disabled:opacity-50"
      }
    >
      <Icon className="h-3.5 w-3.5" />
      <span>{label}</span>
    </button>
  );
}

function Divider() {
  return <span className="mx-1 h-5 w-px bg-border" />;
}
