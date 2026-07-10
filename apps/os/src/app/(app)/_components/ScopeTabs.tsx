"use client";

import Link from "next/link";
import { Tabs, type TabsProps } from "@companyos/ui";

export function ScopeTabs(props: Omit<TabsProps, "linkComponent">) {
  return <Tabs {...props} linkComponent={Link} />;
}
