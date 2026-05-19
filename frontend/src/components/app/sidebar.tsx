"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Camera,
  LayoutDashboard,
  Layers,
  ListTodo,
  LogOut,
  Rocket,
  ShieldCheck,
} from "lucide-react";
import { Auth } from "@/lib/api";
import { useCurrentUser } from "@/hooks/use-current-user";
import { cn } from "@/lib/utils";

type Item = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

const items: Item[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/render/new", label: "Nouveau render", icon: Rocket },
  { href: "/templates", label: "Templates", icon: Layers },
  { href: "/photos", label: "Photos", icon: Camera },
  { href: "/jobs", label: "Jobs", icon: ListTodo },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function Sidebar() {
  const pathname = usePathname();
  const me = useCurrentUser();
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
              {item.label}
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
            Admin
          </Link>
        )}
      </nav>
      {me && (
        <div className="border-t border-border px-3 py-2 text-[10px] text-muted-foreground">
          <div className="font-medium text-foreground/80">{me.username}</div>
          <div className="mt-0.5 flex items-center justify-between">
            <span>
              {me.role === "admin"
                ? "Admin · illimité"
                : `${me.render_credits} crédits`}
            </span>
            {me.role !== "admin" && me.max_templates != null && (
              <span>{me.max_templates}× templates</span>
            )}
          </div>
        </div>
      )}
      {/* Phase 30 — logout button au bas de la sidebar */}
      <div className="border-t border-border p-3">
        <button
          type="button"
          onClick={() => void Auth.logout()}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition hover:bg-accent/50 hover:text-foreground"
        >
          <LogOut className="h-4 w-4" />
          Déconnexion
        </button>
      </div>
    </aside>
  );
}
