"use client";

import { useEffect, useState } from "react";
import { Check, Pencil, Plus, Tag as TagIcon, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { Tags as TagsApi, type Tag } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Phase 37 — Tag library page.
 *
 * Shows all the user's tags as a list, with usage count + actions to
 * rename / delete. Rename + delete propagate to every template that
 * carries the tag (backend handles the cascade).
 *
 * The "FR" / "US" tags are pre-seeded for every user (bootstrap +
 * admin create_user). The user can rename or delete them freely.
 */
export default function TagsPage() {
  const t = useT();
  const { toast } = useToast();

  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTag, setNewTag] = useState("");
  const [creating, setCreating] = useState(false);

  async function reload() {
    try {
      const list = await TagsApi.list();
      setTags(list);
    } catch (err) {
      toast({
        title: t("common.error"),
        description: err instanceof Error ? err.message : t("common.network_error"),
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate() {
    const name = newTag.trim();
    if (!name) return;
    setCreating(true);
    try {
      await TagsApi.create(name);
      setNewTag("");
      await reload();
      toast({ title: t("tags.created", { name }) });
    } catch (err) {
      toast({
        title: t("tags.create_failed"),
        description: err instanceof Error ? err.message : "",
      });
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <TagIcon className="h-6 w-6" />
          {t("tags.title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("tags.subtitle")}</p>
      </div>

      {/* Create a new tag */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-medium">{t("tags.create.title")}</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleCreate();
          }}
          className="flex gap-2"
        >
          <Input
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            placeholder={t("tags.create.placeholder")}
            maxLength={60}
            className="flex-1"
            disabled={creating}
          />
          <Button type="submit" disabled={!newTag.trim() || creating}>
            <Plus className="h-4 w-4" />
            {t("tags.create.button")}
          </Button>
        </form>
      </div>

      {/* List */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {t("tags.list.title", { n: tags.length })}
        </h2>
        {loading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : tags.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("tags.empty")}</p>
        ) : (
          <ul className="space-y-2">
            {tags.map((tag) => (
              <TagRow key={tag.id} tag={tag} onChanged={() => void reload()} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function TagRow({ tag, onChanged }: { tag: Tag; onChanged: () => void }) {
  const t = useT();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tag.name);
  const [busy, setBusy] = useState(false);

  async function commit() {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === tag.name) {
      setEditing(false);
      setDraft(tag.name);
      return;
    }
    setBusy(true);
    try {
      await TagsApi.rename(tag.id, trimmed);
      toast({
        title: t("tags.renamed", { from: tag.name, to: trimmed }),
      });
      setEditing(false);
      onChanged();
    } catch (err) {
      toast({
        title: t("tags.rename_failed"),
        description: err instanceof Error ? err.message : "",
      });
      setDraft(tag.name);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    const msg =
      tag.usage_count > 0
        ? t("tags.delete_confirm_with_usage", {
            name: tag.name,
            n: tag.usage_count,
          })
        : t("tags.delete_confirm", { name: tag.name });
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      const res = await TagsApi.delete(tag.id);
      toast({
        title: t("tags.deleted", { name: tag.name }),
        description:
          res.templates_touched > 0
            ? t("tags.deleted_from_n_templates", { n: res.templates_touched })
            : undefined,
      });
      onChanged();
    } catch (err) {
      toast({
        title: t("tags.delete_failed"),
        description: err instanceof Error ? err.message : "",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <li
      className={cn(
        "flex items-center gap-3 rounded-md border border-border bg-card p-3",
        busy && "opacity-50",
      )}
    >
      <TagIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        {editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void commit();
            }}
            className="flex gap-2"
          >
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={60}
              autoFocus
              className="h-7 text-sm"
              disabled={busy}
            />
            <Button
              type="submit"
              size="sm"
              variant="ghost"
              disabled={busy}
              title={t("common.save")}
            >
              <Check className="h-4 w-4 text-emerald-400" />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditing(false);
                setDraft(tag.name);
              }}
              disabled={busy}
              title={t("common.cancel")}
            >
              <X className="h-4 w-4" />
            </Button>
          </form>
        ) : (
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{tag.name}</span>
            <span className="text-xs text-muted-foreground">
              {tag.usage_count === 0
                ? t("tags.unused")
                : t("tags.usage_count", { n: tag.usage_count })}
            </span>
          </div>
        )}
      </div>
      {!editing && (
        <>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setEditing(true)}
            disabled={busy}
            title={t("tags.rename")}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void handleDelete()}
            disabled={busy}
            className="text-destructive hover:text-destructive"
            title={t("tags.delete")}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </>
      )}
    </li>
  );
}
