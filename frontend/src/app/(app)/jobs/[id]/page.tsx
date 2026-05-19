"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { ArrowLeft, Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Jobs, type JobRead, type JobStatus } from "@/lib/api";
import { cn } from "@/lib/utils";

const STATUS_BADGE: Record<JobStatus, string> = {
  queued: "bg-zinc-700 text-zinc-200",
  running: "bg-blue-700 text-blue-100",
  done: "bg-emerald-700 text-emerald-100",
  failed: "bg-red-700 text-red-100",
};

export default function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const numId = Number(id);
  const [job, setJob] = useState<JobRead | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isFinite(numId)) return;
    let cancelled = false;

    async function tick() {
      try {
        const data = await Jobs.get(numId);
        if (cancelled) return;
        setJob(data);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Erreur");
      }
    }

    void tick();
    const interval = setInterval(() => {
      // Stop polling once the job has reached a terminal state.
      if (job && (job.status === "done" || job.status === "failed")) return;
      void tick();
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numId, job?.status]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!job) return <p className="text-sm text-muted-foreground">Chargement…</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Button asChild variant="ghost" size="icon">
            <Link href="/jobs">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight">
              {job.name}
            </h1>
            <p className="text-sm text-muted-foreground">
              {new Date(job.created_at).toLocaleString()}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "rounded px-2 py-1 text-xs font-medium uppercase",
              STATUS_BADGE[job.status],
            )}
          >
            {job.status}
          </span>
          {job.output_zip_path && job.status === "done" && (
            <Button asChild>
              <a href={`/api/files/render/${job.id}`} download>
                <Download className="h-4 w-4" />
                ZIP global
              </a>
            </Button>
          )}
        </div>
      </div>

      {(job.status === "running" || job.status === "queued") && (
        <div className="rounded-md border border-border bg-card p-4">
          <div className="mb-2 text-xs text-muted-foreground">
            Progression : {job.progress}%
          </div>
          <Progress value={job.progress} />
        </div>
      )}

      {job.status === "failed" && job.error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
          <div className="font-medium">Erreur</div>
          <pre className="mt-1 whitespace-pre-wrap font-mono text-[11px]">
            {job.error}
          </pre>
        </div>
      )}

      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Fichiers de sortie ({job.output_files.length})
        </h2>
        {job.output_files.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun fichier rendu.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {job.output_files.map((path, idx) => {
              const fileName = path.split("/").pop() ?? `render_${idx}`;
              const url = `/api/files/render_item/${job.id}/${idx}`;
              return (
                <div
                  key={idx}
                  className="flex flex-col overflow-hidden rounded-lg border border-border bg-card"
                >
                  <div className="relative aspect-[9/16] w-full bg-black">
                    <video
                      src={url}
                      controls
                      preload="metadata"
                      className="absolute inset-0 h-full w-full object-contain"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2 p-2 text-xs">
                    <span className="truncate" title={fileName}>
                      {fileName}
                    </span>
                    <Button asChild size="sm" variant="ghost">
                      <a href={url} download={fileName}>
                        <Download className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
