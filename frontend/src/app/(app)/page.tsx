"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Download, Plus } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr as frLocale } from "date-fns/locale";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dashboard,
  Jobs,
  type DashboardStats,
  type JobStatus,
  type JobSummary,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const STATUS_BADGE: Record<JobStatus, string> = {
  queued: "bg-zinc-700 text-zinc-200",
  running: "bg-blue-700 text-blue-100",
  done: "bg-emerald-700 text-emerald-100",
  failed: "bg-red-700 text-red-100",
};

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([Dashboard.stats(), Jobs.list()])
      .then(([s, j]) => {
        if (cancelled) return;
        setStats(s);
        setJobs(j.slice(0, 8));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Vue d&apos;ensemble de tes rendus.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild>
            <Link href="/templates">
              <Plus className="h-4 w-4" />
              New template
            </Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-6 p-6 text-sm">
          <Stat label="Templates" value={stats?.template_count ?? 0} />
          <span className="text-muted-foreground">·</span>
          <Stat label="Rendus totaux" value={stats?.render_count ?? 0} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rendus récents</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Chargement…</p>
          ) : jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aucun rendu. Lance ton premier batch !
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
              {jobs.map((j) => (
                <JobCard key={j.id} job={j} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <span className="text-muted-foreground">{label}: </span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

function JobCard({ job }: { job: JobSummary }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-card transition hover:border-ring">
      <Link href={`/jobs/${job.id}`} className="block">
        <div className="relative aspect-[9/16] w-full bg-black">
          {job.status === "done" && job.output_count > 0 ? (
            <video
              src={`/api/files/render_item/${job.id}/0`}
              preload="metadata"
              muted
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
              {job.status === "running" ? `${job.progress}%` : "—"}
            </div>
          )}
          <span
            className={cn(
              "absolute right-1 top-1 rounded px-1.5 py-0.5 text-[9px] font-medium uppercase",
              STATUS_BADGE[job.status],
            )}
          >
            {job.status}
          </span>
        </div>
      </Link>
      <div className="flex flex-col gap-1 p-2 text-xs">
        <Link href={`/jobs/${job.id}`} className="truncate font-medium hover:underline">
          {job.name}
        </Link>
        <div className="text-muted-foreground">
          {formatDistanceToNow(new Date(job.created_at), {
            addSuffix: true,
            locale: frLocale,
          })}
        </div>
        {job.has_zip && job.status === "done" && (
          <Button asChild size="sm" variant="outline" className="mt-1">
            <a href={`/api/files/render/${job.id}`} download>
              <Download className="h-3 w-3" />
              ZIP
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}
