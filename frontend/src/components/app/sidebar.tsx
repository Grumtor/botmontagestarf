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
} from "lucide-react";
import { Auth } from "@/lib/api";
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
      </nav>
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
