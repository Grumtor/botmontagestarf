"use client";

import { cn } from "@/lib/utils";
import type { TemplateLanguage } from "@/lib/api";

export type LanguageFilterValue = TemplateLanguage | "ALL";

const items: { value: LanguageFilterValue; label: string }[] = [
  { value: "ALL", label: "Toutes" },
  { value: "FR", label: "🇫🇷 FR" },
  { value: "US", label: "🇺🇸 US" },
];

type Props = {
  value: LanguageFilterValue;
  onChange: (value: LanguageFilterValue) => void;
};

export function LanguageFilter({ value, onChange }: Props) {
  return (
    <div
      role="group"
      aria-label="Filtre par langue"
      className="inline-flex items-center rounded-md border border-border bg-card p-0.5"
    >
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            type="button"
            onClick={() => onChange(it.value)}
            aria-pressed={active}
            className={cn(
              "rounded-sm px-3 py-1.5 text-sm transition",
              active
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
