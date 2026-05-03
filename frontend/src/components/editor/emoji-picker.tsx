"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { Smile } from "lucide-react";

// emoji-mart's React picker is a heavy client-only component.
// Dynamic import avoids SSR work and bloating the initial bundle.
const Picker = dynamic(
  async () => {
    const [{ default: Picker }, dataMod] = await Promise.all([
      import("@emoji-mart/react"),
      import("@emoji-mart/data"),
    ]);
    const data = dataMod.default ?? dataMod;
    return function PickerWrap(props: PickerProps) {
      return <Picker data={data} {...props} />;
    };
  },
  { ssr: false },
);

type PickerProps = {
  set?: "apple" | "google" | "facebook" | "twitter" | "native";
  theme?: "light" | "dark" | "auto";
  locale?: string;
  navPosition?: "top" | "bottom" | "none";
  previewPosition?: "top" | "bottom" | "none";
  skinTonePosition?: "preview" | "search" | "none";
  emojiButtonSize?: number;
  emojiSize?: number;
  perLine?: number;
  maxFrequentRows?: number;
  onEmojiSelect?: (e: { native: string; id: string; unified: string }) => void;
};

export function EmojiPickerButton({
  onPick,
}: {
  onPick: (emoji: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background transition hover:bg-accent"
        title="Insérer un emoji Apple"
      >
        <Smile className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 shadow-xl">
          <Picker
            set="apple"
            theme="dark"
            locale="fr"
            previewPosition="none"
            skinTonePosition="search"
            navPosition="top"
            emojiButtonSize={32}
            emojiSize={22}
            perLine={9}
            onEmojiSelect={(e) => {
              onPick(e.native);
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
