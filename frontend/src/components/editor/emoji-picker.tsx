"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { Smile } from "lucide-react";
import data from "@emoji-mart/data";

// emoji-mart enregistre un custom-element <em-emoji> au moment où le module
// principal `emoji-mart` est chargé (transitive de @emoji-mart/react).
// On charge le Picker en dynamic({ssr:false}) parce qu'il touche `window`,
// mais SANS l'envelopper dans une factory — sinon le bundle perd le lien
// avec le custom-element et tous les emojis s'affichent comme des "#".
const Picker = dynamic(() => import("@emoji-mart/react"), { ssr: false });

type EmojiSelectPayload = {
  native: string;
  id: string;
  unified: string;
  shortcodes?: string;
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
            data={data}
            set="apple"
            theme="dark"
            locale="fr"
            previewPosition="none"
            skinTonePosition="search"
            navPosition="top"
            emojiButtonSize={32}
            emojiSize={22}
            perLine={9}
            onEmojiSelect={(e: EmojiSelectPayload) => {
              onPick(e.native);
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
