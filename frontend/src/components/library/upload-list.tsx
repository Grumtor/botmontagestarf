"use client";

import { Progress } from "@/components/ui/progress";

export type UploadItem = {
  id: string;
  name: string;
  progress: number;
  error?: string;
};

export function UploadList({ items }: { items: UploadItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-2 rounded-md border border-border bg-card p-3">
      {items.map((u) => (
        <div key={u.id} className="space-y-1">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate" title={u.name}>
              {u.name}
            </span>
            <span className={u.error ? "text-destructive" : "text-muted-foreground"}>
              {u.error ? u.error : `${u.progress}%`}
            </span>
          </div>
          <Progress value={u.error ? 100 : u.progress} />
        </div>
      ))}
    </div>
  );
}
