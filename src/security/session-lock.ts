// Process-wide signing gate. No React Native imports so node tests can drive it.
// session-keystore publishes the real lock and whether a seed is in RAM.

let locked = false;
let hasSeed = false;

export function publishSessionLock(nextLocked: boolean, nextHasSeed: boolean): void {
  locked = nextLocked;
  hasSeed = nextHasSeed;
}

/** True only when this process holds a seed and the UI lock is clear. */
export function isSessionUnlocked(): boolean {
  return hasSeed && !locked;
}

export function resetSessionLockForTests(): void {
  locked = false;
  hasSeed = false;
}
