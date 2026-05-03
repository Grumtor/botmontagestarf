"use client";

import { useEffect, useRef, useState } from "react";
import { Smile } from "lucide-react";

const EMOJI_CATEGORIES: { label: string; emojis: string[] }[] = [
  {
    label: "Visages",
    emojis: [
      "😀", "😂", "🤣", "😍", "😎", "🥹", "🥺", "😭", "🤔", "🙄",
      "😡", "🥳", "🤩", "💀", "😱", "🤯", "😴", "🥶", "🥵", "😇",
      "🤡", "🤣", "😅", "😏", "😉", "😘", "🤗", "🤝", "🙏", "👋",
    ],
  },
  {
    label: "Symboles",
    emojis: [
      "🔥", "💯", "✨", "⭐", "🌟", "💥", "💫", "❤️", "💔", "💕",
      "✅", "❌", "⚡", "🌈", "☀️", "🌙", "🎉", "🎊", "🎯", "🏆",
      "💰", "📈", "📉", "👑", "🚀", "💎", "🎵", "🎬", "📱", "🎮",
    ],
  },
  {
    label: "Mains",
    emojis: [
      "👍", "👎", "👏", "🙌", "✊", "👊", "🤛", "🤜", "🫶", "🤞",
      "🤟", "🤘", "👌", "🤌", "🫰", "🤙", "👀", "👁️", "💪", "🦾",
    ],
  },
];

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
        title="Insérer un emoji"
      >
        <Smile className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 max-h-80 w-72 overflow-y-auto rounded-md border border-border bg-popover p-2 shadow-xl">
          {EMOJI_CATEGORIES.map((cat) => (
            <div key={cat.label} className="mb-2">
              <div className="px-1 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                {cat.label}
              </div>
              <div className="grid grid-cols-8 gap-0.5">
                {cat.emojis.map((emoji, i) => (
                  <button
                    key={`${cat.label}-${i}`}
                    type="button"
                    onClick={() => {
                      onPick(emoji);
                      setOpen(false);
                    }}
                    className="rounded px-1 py-1 text-lg transition hover:bg-accent"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <p className="border-t border-border pt-1.5 text-[10px] text-muted-foreground">
            L&apos;emoji s&apos;affiche dans le style de ton OS (Apple sur Mac/iOS).
          </p>
        </div>
      )}
    </div>
  );
}
