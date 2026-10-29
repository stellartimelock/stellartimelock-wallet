// Cross-platform shadow / glow helpers for glass tiles.

import { Platform, ViewStyle } from "react-native";

export interface ShadowOpts {
  color?: string;
  opacity?: number;
  radius?: number;
  offsetX?: number;
  offsetY?: number;
  /** Android only — separate elevation value. */
  elevation?: number;
}

export function shadow(opts: ShadowOpts = {}): ViewStyle {
  const {
    color = "rgba(94, 159, 255, 0.28)",
    opacity = 0.3,
    radius = 12,
    offsetX = 0,
    offsetY = 4,
    elevation = 4,
  } = opts;

  if (Platform.OS === "android") {
    return {
      elevation,
      shadowColor: color,
    };
  }

  return {
    shadowColor: color,
    shadowOpacity: opacity,
    shadowRadius: radius,
    shadowOffset: { width: offsetX, height: offsetY },
  };
}

/** Default floating tile elevation — faint Aurora cast over dark glass. */
export function tileShadow(): ViewStyle {
  return shadow({
    color: "rgba(94, 159, 255, 0.28)",
    opacity: 0.22,
    radius: 14,
    offsetY: 5,
    elevation: 3,
  });
}

/** Accent edge glow (Aurora / gold) — soft neon underglow. */
export function accentGlow(
  color: string = "rgba(94, 159, 255, 0.55)",
): ViewStyle {
  return shadow({
    color,
    opacity: 0.38,
    radius: 10,
    offsetY: 2,
    elevation: 2,
  });
}
