"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Camera,
  Globe,
  LayoutDashboard,
  Layers,
  ListTodo,
  LogOut,
  Rocket,
  ShieldCheck,
  Sparkles,
  Tag,
} from "lucide-react";
import { Auth, type AppLang } from "@/lib/api";
import { notifyUserRefresh, useCurrentUser } from "@/hooks/use-current-user";
import { useT } from "@/lib/i18n";
import { cn, formatCredits } from "@/lib/utils";

type Item = {
  href: string;
  labelKey: string;
  icon: React.ComponentType<{ className?: string }>;
};

const items: Item[] = [
  { href: "/", labelKey: "nav.dashboard", icon: LayoutDashboard },
  { href: "/render/new", labelKey: "nav.render", icon: Rocket },
  { href: "/spoof/new", labelKey: "nav.spoof", icon: Sparkles },
  { href: "/templates", labelKey: "nav.templates", icon: Layers },
  { href: "/tags", labelKey: "nav.tags", icon: Tag },
  { href: "/photos", labelKey: "nav.photos", icon: Camera },
  { href: "/jobs", labelKey: "nav.jobs", icon: ListTodo },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function Sidebar() {
  const pathname = usePathname();
  const me = useCurrentUser();
  const t = useT();
  const isAdmin = me?.role === "admin";
  return (
    <aside
      className="fixed left-0 top-0 flex h-screen w-[200px] flex-col border-r border-border bg-sidebar text-sidebar-foreground"
      aria-label="Navigation"
    >
      <div className="flex h-[50px] items-center border-b border-border px-4">
        <span className="text-sm font-semibold tracking-tight">bot-montage</span>
      </div>
      <nav className="flex flex-1 flex-col gap-1 p-3">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition",
                active
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )}
              aria-current={active ? "page" : undefined}
            >
              <Icon className="h-4 w-4" />
              {t(item.labelKey)}
            </Link>
          );
        })}
        {isAdmin && (
          <Link
            href="/admin/users"
            className={cn(
              "mt-4 flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm transition",
              isActive(pathname, "/admin/users")
                ? "bg-amber-500/15 text-amber-100"
                : "text-amber-300 hover:bg-amber-500/10 hover:text-amber-100",
            )}
            aria-current={isActive(pathname, "/admin/users") ? "page" : undefined}
          >
            <ShieldCheck className="h-4 w-4" />
            {t("nav.admin")}
          </Link>
        )}
      </nav>
      {me && (
        <div className="border-t border-border px-3 py-2 text-[10px] text-muted-foreground">
          <div className="font-medium text-foreground/80">{me.username}</div>
          <div className="mt-0.5 flex items-center justify-between">
            <span>
              {me.role === "admin"
                ? `Admin · ${t("admin.users.unlimited")}`
                : `${formatCredits(me.render_credits)} ${t("nav.credits")}`}
            </span>
            {me.role !== "admin" && me.max_templates != null && (
              <span>
                {me.max_templates}× {t("nav.templates_count")}
              </span>
            )}
          </div>
        </div>
      )}
      {/* Phase 35 — switcher de langue. Le state local optimiste évite
          un flash entre clic et re-fetch de /me. */}
      <LanguageSwitcher current={(me?.language as AppLang | undefined) ?? "fr"} />
      {/* Phase 30 — logout button au bas de la sidebar */}
      <div className="border-t border-border p-3">
        <button
          type="button"
          onClick={() => void Auth.logout()}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition hover:bg-accent/50 hover:text-foreground"
        >
          <LogOut className="h-4 w-4" />
          {t("nav.logout")}
        </button>
      </div>
    </aside>
  );
}

/** Tiny FR / EN toggle pill. Sends PATCH /api/auth/me/language on click
 *  and triggers a global user refresh so every `useT()` consumer
 *  re-renders with the new language immediately. */
function LanguageSwitcher({ current }: { current: AppLang }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [optimistic, setOptimistic] = useState<AppLang | null>(null);
  const active = optimistic ?? current;

  async function switchTo(lang: AppLang) {
    if (lang === active || busy) return;
    setBusy(true);
    setOptimistic(lang);
    try {
      await Auth.setLanguage(lang);
      // Re-fetch /api/auth/me so every useT() in the tree sees the new
      // language and re-renders.
      notifyUserRefresh();
    } catch {
      // Roll back the optimistic state if the server rejected.
      setOptimistic(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-border px-3 py-2">
      <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Globe className="h-3 w-3" />
        {t("nav.language")}
      </div>
      <div className="flex gap-1">
        {(["fr", "en"] as const).map((lang) => (
          <button
            key={lang}
            type="button"
            onClick={() => void switchTo(lang)}
            disabled={busy}
            className={cn(
              "flex-1 rounded-md px-2 py-1 text-xs font-medium uppercase transition",
              active === lang
                ? "bg-primary text-primary-foreground"
                : "bg-card text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              busy && "opacity-50",
            )}
          >
            {lang}
          </button>
        ))}
      </div>
    </div>
  );
}
