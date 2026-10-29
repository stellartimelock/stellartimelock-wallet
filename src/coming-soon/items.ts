// Wallet-owned Coming soon placeholders. Neither feature is built.
// No payouts logic, shopping data, backend, or network calls live here.

import type { ComponentProps } from "react";
import type { Feather } from "@expo/vector-icons";

type FeatherName = ComponentProps<typeof Feather>["name"];

export type ComingSoonId = "payouts" | "shopping-trends";

export interface ComingSoonItem {
  id: ComingSoonId;
  href: "/coming-soon/payouts" | "/coming-soon/shopping-trends";
  icon: FeatherName;
  label: string;
  sublabel: string;
  screenBody: string;
  testID: string;
  screenTestID: string;
}

export const COMING_SOON_ITEMS: ComingSoonItem[] = [
  {
    id: "payouts",
    href: "/coming-soon/payouts",
    icon: "send",
    label: "Payouts",
    sublabel: "Not available yet.",
    screenBody:
      "Payouts are coming soon. They are not available yet. Nothing on this screen moves money or pays anyone.",
    testID: "coming-soon-payouts",
    screenTestID: "coming-soon-payouts-screen",
  },
  {
    id: "shopping-trends",
    href: "/coming-soon/shopping-trends",
    icon: "shopping-bag",
    label: "Anonymized shopping trends",
    sublabel: "Not available yet.",
    screenBody:
      "Anonymized shopping trends are coming soon. They are not available yet. This wallet does not collect shopping or receipt data.",
    testID: "coming-soon-shopping-trends",
    screenTestID: "coming-soon-shopping-trends-screen",
  },
];

export function getComingSoonItem(id: ComingSoonId): ComingSoonItem {
  const item = COMING_SOON_ITEMS.find((entry) => entry.id === id);
  if (!item) {
    throw new Error(`Unknown Coming soon item: ${id}`);
  }
  return item;
}
