"use client";

import { useId, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  accept: string; // input accept attribute, e.g. "video/mp4,video/quicktime,.mp4,.mov"
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  hint?: string;
};

export function Dropzone({ accept, multiple = true, onFiles, hint }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [drag, setDrag] = useState(false);

  function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    onFiles(Array.from(list));
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <label
      htmlFor={inputId}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        handleFiles(e.dataTransfer.files);
      }}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-card p-6 text-center transition",
        drag && "border-ring bg-accent/20",
      )}
    >
      <Upload className="h-6 w-6 text-muted-foreground" />
      <div className="text-sm font-medium">
        Dépose tes fichiers ici, ou <span className="text-primary underline">parcours</span>
      </div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
    </label>
  );
}
