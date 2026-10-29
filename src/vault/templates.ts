export interface VaultTemplate {
  key: string;
  label: string;
  icon: string; // Feather icon name
  defaultName: string;
  defaultDescription: string;
  suggestedDays: number;
}

export const TEMPLATES: VaultTemplate[] = [
  {
    key: "insurance",
    label: "Insurance",
    icon: "shield",
    defaultName: "Insurance Payment",
    defaultDescription: "Locked until next premium is due.",
    suggestedDays: 30,
  },
  {
    key: "rent",
    label: "Rent",
    icon: "home",
    defaultName: "Rent Reserve",
    defaultDescription: "Monthly rent set aside.",
    suggestedDays: 30,
  },
  {
    key: "car",
    label: "Car Payment",
    icon: "truck",
    defaultName: "Car Payment",
    defaultDescription: "Locked until the day before payment is due.",
    suggestedDays: 30,
  },
  {
    key: "emergency",
    label: "Emergency Fund",
    icon: "life-buoy",
    defaultName: "Emergency Fund",
    defaultDescription: "Long-term safety net.",
    suggestedDays: 180,
  },
  {
    key: "housing",
    label: "Housing Fund",
    icon: "key",
    defaultName: "Housing Fund",
    defaultDescription: "Saving toward a home.",
    suggestedDays: 365,
  },
  {
    key: "vacation",
    label: "Vacation Fund",
    icon: "sun",
    defaultName: "Vacation Fund",
    defaultDescription: "Locked until trip date.",
    suggestedDays: 120,
  },
  {
    key: "custom",
    label: "Custom",
    icon: "edit-3",
    defaultName: "",
    defaultDescription: "",
    suggestedDays: 30,
  },
];

export function templateByKey(k: string): VaultTemplate {
  return TEMPLATES.find((t) => t.key === k) ?? TEMPLATES[TEMPLATES.length - 1];
}
