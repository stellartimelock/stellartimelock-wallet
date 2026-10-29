# Stellar TimeLock PRIVATE_APP — Splash Context

## Color Palette (Futuristic Dark Theme)
- Background: #080C1A
- Surface: #0F1629
- Primary Accent (Cyan Glow): #00D4FF
- Secondary Accent (Cobalt): #1A4B8C
- Text: #E8F0FE, #94A3B8, #4A6A8C

## Splash Screen (SplashScreen.js) — theatrical boot (2026-09-28)

### Art
- ImageBackground source: `assets/splash.png` (require `@/assets/splash.png`).
- Full-bleed Jul 29 portrait art (936×1680), copied from StellarOS `assets/images/splash-icon.png` (SHA256 match). Older Jul 28 glass-panel art backed up under `.splash-backup-20260928/splash.png.old-glass`.

### Glow ring layout (authoritative)
- **`bottom: '9.35%'`**, size **125×125**, `alignSelf: 'center'`.
- Constants: `RING_BOTTOM_PCT = "9.35%"`, `RING_SIZE = 125`.
- **Do NOT use `RING_BOTTOM_OFFSET = 88` (dp)** — stale.

### Sequence / interaction
- 4 cycling phrases; horizontal hollow chevrons (8); glow after `phrasesComplete`.
- **Tap is decorative** — exit anim → `onComplete()`. No hardware biometric APIs.
- Interval + timeouts cleared on unmount.

### Navigation (`app/index.tsx`) — THIS private wallet app
- Cold start **always** shows SplashScreen until glow tap (`showSplash`).
- After tap (`loadBook` + `isBrowseMode`):
  - wallet entries → `/(tabs)/wallet`
  - browse mode → `/(tabs)/wallet`
  - else → `/wallet-setup`
- **No** `/onboarding-use` route in this app.
- No `authenticate()` on splash path.
