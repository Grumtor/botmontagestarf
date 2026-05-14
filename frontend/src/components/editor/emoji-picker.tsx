"use client";

/**
 * Custom Apple emoji picker.
 *
 * We dropped emoji-mart's <Picker> because its sprite-based renderer was
 * showing a grid of identical "#" glyphs (sprite/data version mismatch
 * + jsdelivr fetch). Now we drive everything ourselves:
 *
 *   - Catalogue & categories from `@emoji-mart/data` (just JSON, no UI).
 *   - Each glyph rendered as an individual PNG from the same CDN we use
 *     for the canvas preview and the backend ffmpeg renderer
 *     (`emoji-datasource-apple` on jsdelivr). Single source of truth.
 *   - Recently-used emojis persisted in localStorage.
 *   - Search across name + keywords.
 *
 * Public API unchanged: `<EmojiPickerButton onPick={(native) => …} />`.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Clock, Search, Smile, X } from "lucide-react";
import data from "@emoji-mart/data";

import { getAppleEmojiUrl } from "@/lib/apple-emoji";
import { cn } from "@/lib/utils";

// ---- emoji-mart data shape ------------------------------------------

type Skin = { unified: string; native: string };
type EmojiEntry = {
  id: string;
  name: string;
  keywords?: string[];
  skins: Skin[];
};
type Category = { id: string; emojis: string[] };
type EmojiMartData = {
  categories: Category[];
  emojis: Record<string, EmojiEntry>;
};

const DATA = data as unknown as EmojiMartData;

// ---- categories with display labels + a representative emoji as icon

const CATEGORY_LABELS: Record<string, { label: string; icon: string }> = {
  people: { label: "Smileys & gens", icon: "😀" },
  nature: { label: "Animaux & nature", icon: "🐶" },
  foods: { label: "Nourriture", icon: "🍎" },
  activity: { label: "Activités", icon: "⚽" },
  places: { label: "Voyages", icon: "🚗" },
  objects: { label: "Objets", icon: "💡" },
  symbols: { label: "Symboles", icon: "❤️" },
  flags: { label: "Drapeaux", icon: "🏳️" },
};

const RECENTS_KEY = "bot-montage:emoji:recents";
const RECENTS_MAX = 32;

// ---- recents persistence --------------------------------------------

function loadRecents(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === "string") : [];
  } catch {
    return [];
  }
}

function saveRecents(list: string[]): void {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, RECENTS_MAX)));
  } catch {
    /* localStorage full / disabled — ignore */
  }
}

// ---- public component -----------------------------------------------

const PICKER_W = 340;
const PICKER_H = 420;

export function EmojiPickerButton({
  onPick,
}: {
  onPick: (emoji: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Compute popover coords based on the button's bounding rect. We use
  // `position: fixed` (via portal-less rendering) so the picker can escape
  // the narrow inspector panel and render over the canvas if needed.
  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const btn = buttonRef.current;
    if (!btn) return;

    function place() {
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const margin = 8;
      // Default: open below-and-left of the button (right edge of picker
      // aligned with right edge of button).
      let left = rect.right - PICKER_W;
      let top = rect.bottom + 4;
      // Keep on screen: clamp horizontally.
      const maxLeft = window.innerWidth - PICKER_W - margin;
      left = Math.max(margin, Math.min(left, maxLeft));
      // If not enough vertical room below, flip above the button.
      if (top + PICKER_H + margin > window.innerHeight) {
        top = Math.max(margin, rect.top - PICKER_H - 4);
      }
      setPos({ left, top });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      const target = e.target as Node;
      if (
        popRef.current?.contains(target) ||
        buttonRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background transition hover:bg-accent"
        title="Insérer un emoji Apple"
      >
        <Smile className="h-3.5 w-3.5" />
      </button>
      {open && pos && (
        <div
          ref={popRef}
          className="overflow-hidden rounded-lg border border-border bg-popover shadow-2xl"
          style={{
            position: "fixed",
            left: pos.left,
            top: pos.top,
            width: PICKER_W,
            zIndex: 9999,
          }}
        >
          <Picker
            onPick={(native) => {
              onPick(native);
              setOpen(false);
            }}
          />
        </div>
      )}
    </>
  );
}

// ---- the picker panel -----------------------------------------------

function Picker({ onPick }: { onPick: (native: string) => void }) {
  const [search, setSearch] = useState("");
  const [activeCat, setActiveCat] = useState<string>("recent");
  const [recents, setRecents] = useState<string[]>(() => loadRecents());

  // Build the displayed sections: recents (if any) + all categories.
  const sections = useMemo(() => {
    const result: { id: string; label: string; emojis: { native: string; name: string }[] }[] = [];

    if (recents.length > 0) {
      const items: { native: string; name: string }[] = [];
      for (const native of recents) {
        items.push({ native, name: native });
      }
      result.push({ id: "recent", label: "Récents", emojis: items });
    }

    for (const cat of DATA.categories) {
      const meta = CATEGORY_LABELS[cat.id];
      if (!meta) continue;
      const items: { native: string; name: string }[] = [];
      for (const id of cat.emojis) {
        const e = DATA.emojis[id];
        if (!e) continue;
        const skin = e.skins[0];
        if (!skin?.native) continue;
        items.push({ native: skin.native, name: e.name });
      }
      result.push({ id: cat.id, label: meta.label, emojis: items });
    }
    return result;
  }, [recents]);

  // Search filter — applied across all categories regardless of activeCat.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    const hits: { native: string; name: string }[] = [];
    const seen = new Set<string>();
    for (const id in DATA.emojis) {
      const e = DATA.emojis[id];
      const skin = e.skins[0];
      if (!skin?.native || seen.has(skin.native)) continue;
      const match =
        e.name.toLowerCase().includes(q) ||
        e.id.toLowerCase().includes(q) ||
        (e.keywords ?? []).some((k) => k.toLowerCase().includes(q));
      if (match) {
        hits.push({ native: skin.native, name: e.name });
        seen.add(skin.native);
        if (hits.length >= 200) break;
      }
    }
    return hits;
  }, [search]);

  function pick(native: string) {
    setRecents((prev) => {
      const next = [native, ...prev.filter((n) => n !== native)].slice(0, RECENTS_MAX);
      saveRecents(next);
      return next;
    });
    onPick(native);
  }

  return (
    <div className="flex flex-col">
      {/* Category tabs */}
      <div className="flex shrink-0 border-b border-border bg-card">
        {sections.map((sec) => (
          <button
            key={sec.id}
            type="button"
            onClick={() => setActiveCat(sec.id)}
            className={cn(
              "flex h-9 flex-1 items-center justify-center text-base transition",
              activeCat === sec.id
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50",
            )}
            title={sec.label}
          >
            {sec.id === "recent" ? (
              <Clock className="h-4 w-4" />
            ) : (
              <EmojiImg
                native={CATEGORY_LABELS[sec.id]?.icon ?? "•"}
                size={18}
              />
            )}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="shrink-0 border-b border-border bg-card p-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher des emojis"
            className="h-8 w-full rounded-md bg-background pl-7 pr-7 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Effacer"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Emoji grid */}
      <div className="h-72 overflow-y-auto p-2">
        {filtered ? (
          filtered.length === 0 ? (
            <p className="p-4 text-center text-xs text-muted-foreground">
              Aucun emoji ne matche &laquo;{search}&raquo;.
            </p>
          ) : (
            <Grid items={filtered} onPick={pick} />
          )
        ) : (
          sections.map((sec) =>
            sec.id === activeCat || sections.length <= 1 ? (
              <div key={sec.id} className="mb-3">
                <div className="px-1 pb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {sec.label}
                </div>
                <Grid items={sec.emojis} onPick={pick} />
              </div>
            ) : null,
          )
        )}
      </div>
    </div>
  );
}

// ---- emoji grid + tile -----------------------------------------------

function Grid({
  items,
  onPick,
}: {
  items: { native: string; name: string }[];
  onPick: (native: string) => void;
}) {
  return (
    <div className="grid grid-cols-9 gap-0.5">
      {items.map((it, i) => (
        <button
          key={`${it.native}-${i}`}
          type="button"
          onClick={() => onPick(it.native)}
          className="flex h-8 w-8 items-center justify-center rounded transition hover:bg-accent"
          title={it.name}
        >
          <EmojiImg native={it.native} size={22} />
        </button>
      ))}
    </div>
  );
}

function EmojiImg({ native, size }: { native: string; size: number }) {
  const url = getAppleEmojiUrl(native);
  if (!url) {
    // Fallback to native rendering — should be rare.
    return <span style={{ fontSize: `${size}px`, lineHeight: 1 }}>{native}</span>;
  }
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={url}
      alt={native}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      draggable={false}
      style={{ width: size, height: size, objectFit: "contain" }}
    />
  );
}
