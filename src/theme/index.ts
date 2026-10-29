// Theme tokens — Aurora Glass.
// Background #0A0E17 with Aurora blue + soft gold accents only.

import { ViewStyle } from "react-native";

import { accentGlow, shadow, tileShadow } from "./shadow";

export { accentGlow, shadow, tileShadow };

const ACCENT = "#5E9FFF";
const ACCENT_MUTED = "rgba(94, 159, 255, 0.14)";
const ACCENT_GLOW = "rgba(94, 159, 255, 0.40)";

export const colors = {
  // ── Surfaces ───────────────────────────────────────────────────────
  background: "#0A0E17",
  surface: "#111827",
  surfaceElevated: "#141B28",
  surfaceHighlight: "#1A2230",
  /** Frosted glass panel — dark glassmorphism over #0A0E17. */
  surfaceFrost: "rgba(15, 21, 32, 0.72)",
  /** Faint ambient wash (color-only radial hint). */
  backgroundAmbient: "rgba(94, 159, 255, 0.04)",

  // Primary / secondary text
  text: "#F5F7FA",
  textSecondary: "#8A93A6",
  textTertiary: "#5A6378",
  // Light text on muted accent buttons / outlined CTAs
  textInverse: "#F5F7FA",

  // Accent — Aurora blue (legacy teal/cyan/violet aliases map here)
  accent: ACCENT,
  teal: ACCENT,
  tealMuted: ACCENT_MUTED,
  cyan: ACCENT,
  cyanMuted: ACCENT_MUTED,
  cyanGlow: ACCENT_GLOW,
  violet: ACCENT,
  violetMuted: ACCENT_MUTED,
  violetGlow: "rgba(94, 159, 255, 0.35)",

  // Deep space blue — borders / secondary structure
  spaceBlue: "#1A2438",
  spaceBlueMuted: "rgba(94, 159, 255, 0.08)",

  // Soft gold / amber — Swap / pending / important status
  gold: "#E8B84A",
  goldMuted: "rgba(232, 184, 74, 0.15)",
  goldGlow: "rgba(232, 184, 74, 0.35)",

  // Neon red — errors
  danger: "#E04545",
  dangerMuted: "rgba(224, 69, 69, 0.20)",
  dangerOutline: "rgba(224, 69, 69, 0.55)",
  success: ACCENT,
  warning: "#E8B84A",

  border: "#1A2438",
  /** Extremely subtle edge for glass panels. */
  borderSubtle: "rgba(245, 247, 250, 0.08)",
  borderGlow: "rgba(94, 159, 255, 0.28)",
  borderActive: ACCENT,
  borderViolet: "rgba(94, 159, 255, 0.40)",
  borderGold: "rgba(232, 184, 74, 0.40)",

  trackOff: "#243044",
  thumbOn: "#F5F7FA",

  // Status — active = Aurora, pending = gold, closed = secondary gray
  statusActive: ACCENT,
  statusPending: "#E8B84A",
  statusReady: ACCENT,
  statusClosed: "#8A93A6",

  // ── Nested structure (no naming collisions) ────────────────────────
  bg: {
    primary: "#0A0E17",
    elevated: "#111827",
    frost: "rgba(15, 21, 32, 0.72)",
    ambient: "rgba(94, 159, 255, 0.04)",
  },
  palette: {
    text: {
      primary: "#F5F7FA",
      secondary: "#8A93A6",
      tertiary: "#5A6378",
    },
    status: {
      success: ACCENT,
      error: "#E04545",
      active: ACCENT,
      pending: "#E8B84A",
    },
  },
};

/** Shared floating-tile chrome — glass edge + soft neon underglow. */
export const tile: ViewStyle = {
  backgroundColor: colors.surfaceFrost,
  borderWidth: 1,
  borderColor: colors.borderSubtle,
  ...tileShadow(),
};

/** Interactive tile — Aurora blue edge accent. */
export const tileInteractive: ViewStyle = {
  ...tile,
  borderColor: colors.borderGlow,
  ...accentGlow(colors.cyanGlow),
};

// Near-hard edges — tool-like foundation with slight float readability.
// `pill` stays 0 so existing call sites do not render soft capsules.
export const radii = {
  sm: 2,
  md: 4,
  lg: 6,
  xl: 8,
  pill: 0,
  card: 6,
  button: 24,
  input: 4,
  chip: 24,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  hairline: 1,
};

export const typography = {
  // Native fallbacks — no custom font files required.
  display: { fontWeight: "700" as const, letterSpacing: -0.5 },
  heading: { fontWeight: "600" as const, letterSpacing: -0.2 },
  body: { fontWeight: "400" as const },
  label: {
    fontWeight: "600" as const,
    letterSpacing: 1.2,
    textTransform: "uppercase" as const,
  },
  mono: {
    fontVariant: ["tabular-nums" as const],
  },
  sizes: { xs: 10, sm: 12, md: 14, lg: 16, xl: 18, xxl: 24 },
  weights: {
    regular: "400" as const,
    medium: "500" as const,
    semibold: "600" as const,
    bold: "700" as const,
    extrabold: "800" as const,
  },
};

/** Thin orbital divider line. */
export const divider: ViewStyle = {
  height: 1,
  backgroundColor: colors.borderSubtle,
};
