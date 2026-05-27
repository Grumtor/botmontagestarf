"use client";

/**
 * Phase 37 — TagPickerMulti
 *
 * Multi-select tag picker backed by the user's Tag library (`/api/tags`).
 *
 * UI :
 *   - Trigger = inline chips of currently-selected tags + a "+" button
 *     that opens a popover.
 *   - Popover :
 *       - Loading state while the library is fetched the first time.
 *       - Checkbox list of every tag in the library (toggle = check/uncheck).
 *       - "+ Nouveau tag" input at the bottom — calls `Tags.create(name)`,
 *         appends the result to both the library cache and the current
 *         selection.
 *       - Empty state when the library is empty.
 *
 * Two visual modes via the `compact` prop : `false` (default — used in
 * dialogs / forms) draws a bordered chip-list area like an Input ;
 * `true` (used in the editor topbar) renders the chips inline at h-8
 * with a discreet "+" button.
 *
 * Library caching :
 *   The fetched tag list is memoized at module scope so navigating in
 *   and out of the picker (or having several pickers mounted) doesn't
 *   re-fetch every time. Each successful `Tags.create()` invalidates +
 *   refreshes the cache so other mounts see the new tag.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, X, Check, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tags as TagsApi, type Tag } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// ----- module-level cache -------------------------------------------
//
// Single fetch per page-load shared across every mounted picker. The
// cache is invalidated when a tag is created locally (we refetch so
// usage_count stays accurate across the app).
let _cache: Tag[] | null = null;
let _inflight: Promise<Tag[]> | null = null;
const _subscribers = new Set<() => void>();

async function loadLibrary(force = false): Promise<Tag[]> {
  if (_cache && !force) return _cache;
  if (_inflight && !force) return _inflight;
  _inflight = TagsApi.list().then((tags) => {
    _cache = tags;
    _inflight = null;
    for (const fn of _subscribers) fn();
    return tags;
  }).catch((err) => {
    _inflight = null;
    throw err;
  });
  return _inflight;
}

function invalidateLibrary() {
  _cache = null;
  _inflight = null;
}

// ----- component -----------------------------------------------------

type Props = {
  selectedTags: string[];
  onChange: (newTags: string[]) => void;
  compact?: boolean;
};

export function TagPickerMulti({ selectedTags, onChange, compact = false }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [library, setLibrary] = useState<Tag[] | null>(_cache);
  const [loading, setLoading] = useState(_cache === null);
  const [error, setError] = useState<string | null>(null);
  const [newTagInput, setNewTagInput] = useState("");
  const [creating, setCreating] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Subscribe to global cache updates so a tag created from another
  // picker mount appears here without re-fetch.
  useEffect(() => {
    const sub = () => setLibrary(_cache);
    _subscribers.add(sub);
    return () => {
      _subscribers.delete(sub);
    };
  }, []);

  // Lazy fetch when the picker opens for the first time.
  useEffect(() => {
    if (!open || _cache !== null) return;
    setLoading(true);
    setError(null);
    loadLibrary()
      .then((tags) => {
        setLibrary(tags);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  }, [open]);

  // Click outside → close popover.
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      const target = e.target as Node;
      if (
        containerRef.current?.contains(target) ||
        triggerRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const toggleTag = useCallback(
    (name: string) => {
      const lower = name.toLowerCase();
      const exists = selectedTags.some((t) => t.toLowerCase() === lower);
      if (exists) {
        onChange(selectedTags.filter((t) => t.toLowerCase() !== lower));
      } else {
        onChange([...selectedTags, name]);
      }
    },
    [selectedTags, onChange],
  );

  const removeTag = useCallback(
    (name: string) => {
      const lower = name.toLowerCase();
      onChange(selectedTags.filter((t) => t.toLowerCase() !== lower));
    },
    [selectedTags, onChange],
  );

  async function handleCreate() {
    const name = newTagInput.trim();
    if (!name || creating) return;
    setCreating(true);
    setError(null);
    try {
      // If the tag already exists in the library (case-insensitive),
      // just select it without re-POSTing — backend would 409 anyway.
      const existing = (library ?? []).find(
        (t) => t.name.toLowerCase() === name.toLowerCase(),
      );
      let created: Tag;
      if (existing) {
        created = existing;
      } else {
        created = await TagsApi.create(name);
        // Force-refresh the cache so usage_count stays accurate and
        // other pickers see the new tag.
        invalidateLibrary();
        const refreshed = await loadLibrary(true);
        setLibrary(refreshed);
      }
      // Add to selection if not already there.
      const alreadySelected = selectedTags.some(
        (t) => t.toLowerCase() === created.name.toLowerCase(),
      );
      if (!alreadySelected) {
        onChange([...selectedTags, created.name]);
      }
      setNewTagInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  // ----- chips -----
  const chips = selectedTags.map((tag) => (
    <span
      key={tag}
      className={cn(
        "flex shrink-0 items-center gap-1 rounded-full bg-zinc-700 px-2 py-0.5 text-xs text-zinc-200",
      )}
    >
      {tag}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          removeTag(tag);
        }}
        aria-label={`Remove ${tag}`}
        className="text-zinc-400 transition hover:text-zinc-100"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  ));

  // ----- trigger (compact vs normal) -----
  const trigger = compact ? (
    <div
      className="flex h-8 min-w-[14rem] max-w-[28rem] items-center gap-1 overflow-x-auto rounded-md border border-input bg-transparent px-2 text-sm"
      aria-label={t("tagpicker.placeholder")}
      title={t("tagpicker.placeholder")}
    >
      {chips.length === 0 && (
        <span className="truncate text-xs text-muted-foreground">
          {t("tagpicker.placeholder")}
        </span>
      )}
      {chips}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition hover:bg-accent hover:text-foreground"
        title={t("tagpicker.add_new")}
        aria-label={t("tagpicker.add_new")}
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  ) : (
    <div className="flex min-h-[2.5rem] flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent p-1.5 text-sm">
      {chips.length === 0 && (
        <span className="px-1 text-xs text-muted-foreground">
          {t("tagpicker.placeholder")}
        </span>
      )}
      {chips}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="ml-auto flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-xs text-muted-foreground transition hover:border-ring hover:text-foreground"
        title={t("tagpicker.add_new")}
      >
        <Plus className="h-3 w-3" />
        {t("tagpicker.add_new")}
      </button>
    </div>
  );

  // ----- popover -----
  return (
    <div className="relative">
      {trigger}
      {open && (
        <div
          ref={containerRef}
          className="absolute right-0 z-50 mt-1 w-72 overflow-hidden rounded-lg border border-border bg-popover shadow-2xl"
        >
          <div className="max-h-64 overflow-y-auto p-2">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t("common.loading")}
              </div>
            ) : (library?.length ?? 0) === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                {t("tagpicker.empty")}
              </p>
            ) : (
              <ul className="space-y-0.5">
                {library!.map((tag) => {
                  const checked = selectedTags.some(
                    (t) => t.toLowerCase() === tag.name.toLowerCase(),
                  );
                  return (
                    <li key={tag.id}>
                      <button
                        type="button"
                        onClick={() => toggleTag(tag.name)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition hover:bg-accent",
                          checked && "bg-accent/50",
                        )}
                      >
                        <span
                          className={cn(
                            "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                            checked
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border",
                          )}
                        >
                          {checked && <Check className="h-3 w-3" />}
                        </span>
                        <span className="flex-1 truncate text-left">
                          {tag.name}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Create-new row at the bottom */}
          <div className="border-t border-border bg-background/40 p-2">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleCreate();
              }}
              className="flex gap-1.5"
            >
              <Input
                value={newTagInput}
                onChange={(e) => setNewTagInput(e.target.value)}
                placeholder={t("tagpicker.add_new")}
                maxLength={60}
                className="h-7 flex-1 text-xs"
                disabled={creating}
              />
              <Button
                type="submit"
                size="sm"
                className="h-7 px-2"
                disabled={!newTagInput.trim() || creating}
              >
                {creating ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Plus className="h-3 w-3" />
                )}
              </Button>
            </form>
            {error && (
              <p className="mt-1 text-[10px] text-destructive">{error}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
