// Kept so tests can name the old byline and assert it is not rendered.
// 1.6.7 drops it from every screen. The launcher name stays "Stellar TimeLock".

export const Branding = {
  DISPLAY_NAME: "STL wallet",
  DEVELOPER: "StellarTimeLock",
  /** Retired label. Do not render this. */
  BYLINE: "STL wallet by StellarTimeLock",
} as const;
