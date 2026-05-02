"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Film, LayoutDashboard, Layers, Library, ListTodo, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

type Item = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  primary?: boolean;
};

type Section = {
  label?: string;
  items: Item[];
};

const sections: Section[] = [
  {
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/templates", label: "Templates", icon: Layers },
      { href: "/render/new", label: "New render", icon: Plus, primary: true },
      { href: "/jobs", label: "Jobs", icon: ListTodo },
    ],
  },
  {
    label: "Bibliothèque",
    items: [
      { href: "/sources", label: "Sources", icon: Film },
      { href: "/assets", label: "Assets", icon: Library },
    ],
  },
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

      <nav className="flex flex-col gap-1 p-3">
        {sections.map((section, sIdx) => (
          <div key={sIdx} className={cn(sIdx > 0 && "mt-6 border-t border-border pt-4")}>
            {section.label && (
              <div className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {section.label}
              </div>
            )}
            <div className="flex flex-col gap-1">
              {section.items.map((item) => {
                const active = isActive(pathname, item.href);
                const Icon = item.icon;

                if (item.primary) {
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "mt-2 flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-90",
                        active && "ring-2 ring-ring ring-offset-2 ring-offset-sidebar",
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </Link>
                  );
                }

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
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
