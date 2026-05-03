"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Copy, Pencil, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr as frLocale } from "date-fns/locale";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Template } from "@/lib/api";

type Props = {
  template: Template;
  onDuplicate: (id: number) => void;
  onDelete: (id: number) => void;
};

export function TemplateCard({ template, onDuplicate, onDelete }: Props) {
  const router = useRouter();
  const [thumbError, setThumbError] = useState(false);

  const langLabel = template.language === "FR" ? "🇫🇷 FR" : "🇺🇸 US";
  const updated = formatDistanceToNow(new Date(template.updated_at), {
    addSuffix: true,
    locale: frLocale,
  });

  function stop(e: React.MouseEvent) {
    e.stopPropagation();
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => router.push(`/editor/${template.id}`)}
      onKeyDown={(e) => {
        if (e.key === "Enter") router.push(`/editor/${template.id}`);
      }}
      className="group relative flex cursor-pointer flex-col overflow-hidden rounded-lg border border-border bg-card transition hover:border-ring"
    >
      <div className="relative aspect-[9/16] w-full bg-black">
        {!thumbError && (
          <img
            src={`/api/files/template_thumb/${template.id}`}
            alt={template.name}
            className="absolute inset-0 h-full w-full object-cover"
            onError={() => setThumbError(true)}
          />
        )}

        <div
          className="pointer-events-none absolute right-2 top-2 flex gap-1 opacity-0 transition group-hover:pointer-events-auto group-hover:opacity-100"
          onClick={stop}
        >
          <IconBtn
            label="Edit"
            onClick={(e) => {
              stop(e);
              router.push(`/editor/${template.id}`);
            }}
          >
            <Pencil className="h-3.5 w-3.5" />
          </IconBtn>
          <IconBtn
            label="Duplicate"
            onClick={(e) => {
              stop(e);
              onDuplicate(template.id);
            }}
          >
            <Copy className="h-3.5 w-3.5" />
          </IconBtn>
          <IconBtn
            label="Delete"
            destructive
            onClick={(e) => {
              stop(e);
              onDelete(template.id);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </IconBtn>
        </div>
      </div>

      <div className="flex flex-col gap-1 p-3">
        <div className="truncate text-sm font-medium">{template.name}</div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <Badge variant="secondary" className="text-[10px]">
            {langLabel}
          </Badge>
          <span>{updated}</span>
        </div>
      </div>
    </div>
  );
}

function IconBtn({
  children,
  label,
  destructive,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  destructive?: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "rounded-md border border-border bg-background/80 p-1.5 text-foreground shadow-sm backdrop-blur transition hover:bg-background",
        destructive && "hover:border-destructive hover:text-destructive",
      )}
    >
      {children}
    </button>
  );
}
