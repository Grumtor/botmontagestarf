"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr as frLocale } from "date-fns/locale";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Jobs, type JobStatus, type JobSummary } from "@/lib/api";
import { cn } from "@/lib/utils";

const STATUS_BADGE: Record<JobStatus, string> = {
  queued: "bg-zinc-700 text-zinc-200",
  running: "bg-blue-700 text-blue-100",
  done: "bg-emerald-700 text-emerald-100",
  failed: "bg-red-700 text-red-100",
};

export default function JobsPage() {
  const [items, setItems] = useState<JobSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const list = await Jobs.list();
        if (!cancelled) {
          setItems(list);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Erreur");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void tick();
    const interval = setInterval(tick, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Jobs</h1>
        <p className="text-sm text-muted-foreground">
          Auto-refresh toutes les 2s.
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Aucun job — lance un batch depuis « New render ».
        </p>
      ) : (
        <div className="space-y-2">
          {items.map((j) => (
            <div
              key={j.id}
              className="flex items-center gap-4 rounded-lg border border-border bg-card p-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Link
                    href={`/jobs/${j.id}`}
                    className="truncate text-sm font-medium hover:underline"
                    title={j.name}
                  >
                    {j.name}
                  </Link>
                  <span
                    className={cn(
                      "rounded px-2 py-0.5 text-[10px] font-medium uppercase",
                      STATUS_BADGE[j.status],
                    )}
                  >
                    {j.status}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                  <span>
                    {formatDistanceToNow(new Date(j.created_at), {
                      addSuffix: true,
                      locale: frLocale,
                    })}
                  </span>
                  <span>
                    {j.output_count} fichier{j.output_count > 1 ? "s" : ""}
                  </span>
                </div>
                {(j.status === "running" || j.status === "queued") && (
                  <Progress value={j.progress} className="mt-2 h-1.5" />
                )}
              </div>

              {j.has_zip && j.status === "done" && (
                <Button asChild variant="outline" size="sm">
                  <a href={`/api/files/render/${j.id}`} download>
                    <Download className="h-4 w-4" />
                    ZIP
                  </a>
                </Button>
              )}
              <Button asChild variant="ghost" size="sm">
                <Link href={`/jobs/${j.id}`}>Détails →</Link>
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
