"use client";

import { usePathname } from "next/navigation";
import { Tabs } from "@companyos/ui";

const tabs = [
  { href: "/admin", id: "overview", label: "Overview" },
  { href: "/admin/users", id: "users", label: "Users" },
  { href: "/admin/grants", id: "grants", label: "Access" },
  { href: "/admin/activity", id: "activity", label: "Activity" },
  { href: "/admin/automations", id: "automations", label: "Automations" },
  { href: "/admin/settings", id: "settings", label: "Settings" },
  { href: "/admin/mcp", id: "mcp", label: "MCP" },
  { href: "/admin/health", id: "health", label: "Health" },
];

export function AdminTabs() {
  const pathname = usePathname();
  const active = tabs.find((tab) => tab.href !== "/admin" && pathname.startsWith(tab.href)) ?? tabs[0]!;

  return (
    <Tabs
      ariaLabel="Admin sections"
      activeId={active.id}
      items={tabs.map((tab) => ({ id: tab.id, label: tab.label, href: tab.href }))}
    />
  );
}
