"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Tabs, type TabsProps } from "@companyos/ui";

export function ScopeTabs({ items, ...rest }: Omit<TabsProps, "linkComponent">) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // The active tab's server-rendered href goes stale when client code updates the
  // URL via history.replaceState (e.g. wiki page selection, issue #54); point it
  // at the live URL so re-activating the current tab keeps the user where they are.
  const search = searchParams?.toString();
  const liveHref = `${pathname}${search ? `?${search}` : ""}`;
  const liveItems = items.map((item) =>
    item.id === rest.activeId && item.href ? { ...item, href: liveHref } : item,
  );

  return <Tabs {...rest} items={liveItems} linkComponent={Link} />;
}
