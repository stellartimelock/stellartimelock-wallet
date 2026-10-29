// Guided first-run tour preference.
// Persisted in AsyncStorage so cold starts remember Guided vs Skip.
// Choice is offered once after theatrical splash for users with no wallet.
// Value-prop screen (what/why) shows once before Guided vs Skip.

import { storage } from "@/src/utils/storage";

export const GUIDED_TOUR_CHOICE_KEY = "stl_guided_tour_choice_v1";
export const GUIDED_TOUR_ACTIVE_KEY = "stl_guided_tour_active_v1";
export const GUIDED_TOUR_STEP_KEY = "stl_guided_tour_step_v1";
export const VALUE_PROP_SEEN_KEY = "stl_value_prop_seen_v1";

export type GuidedTourChoice = "guided" | "skipped";

export async function getTourChoice(): Promise<GuidedTourChoice | null> {
  const v = await storage.getItem<string | null>(GUIDED_TOUR_CHOICE_KEY, null);
  if (v === "guided" || v === "skipped") return v;
  return null;
}

export async function setTourChoice(choice: GuidedTourChoice): Promise<void> {
  await storage.setItem(GUIDED_TOUR_CHOICE_KEY, choice);
  if (choice === "guided") {
    await storage.setItem(GUIDED_TOUR_ACTIVE_KEY, true);
    await storage.setItem(GUIDED_TOUR_STEP_KEY, 0);
  } else {
    await storage.setItem(GUIDED_TOUR_ACTIVE_KEY, false);
    await storage.removeItem(GUIDED_TOUR_STEP_KEY);
  }
}

/** True when the user has never answered Guided vs Skip. */
export async function isTourChoicePending(): Promise<boolean> {
  return (await getTourChoice()) === null;
}

export async function hasSeenValueProp(): Promise<boolean> {
  const v = await storage.getItem<boolean | string | null>(VALUE_PROP_SEEN_KEY, null);
  return v === true || v === "true" || v === "1";
}

export async function markValuePropSeen(): Promise<void> {
  await storage.setItem(VALUE_PROP_SEEN_KEY, true);
}

/**
 * First-run gate: show value-prop once before Guided vs Skip.
 * Skip when tour choice already set OR value-prop already seen.
 */
export async function isValuePropPending(): Promise<boolean> {
  if (!(await isTourChoicePending())) return false;
  return !(await hasSeenValueProp());
}

export async function isGuidedTourActive(): Promise<boolean> {
  const choice = await getTourChoice();
  if (choice !== "guided") return false;
  const active = await storage.getItem<boolean>(GUIDED_TOUR_ACTIVE_KEY, false);
  return active === true;
}

export async function getGuidedTourStep(): Promise<number> {
  const step = await storage.getItem<number>(GUIDED_TOUR_STEP_KEY, 0);
  return typeof step === "number" && step >= 0 ? step : 0;
}

export async function setGuidedTourStep(step: number): Promise<void> {
  await storage.setItem(GUIDED_TOUR_STEP_KEY, step);
}

/** Call when the user finishes or dismisses the vault tour. */
export async function completeGuidedTour(): Promise<void> {
  await storage.setItem(GUIDED_TOUR_ACTIVE_KEY, false);
  await storage.removeItem(GUIDED_TOUR_STEP_KEY);
}

/** Soft re-enable (e.g. from settings later) without changing choice. */
export async function restartGuidedTour(): Promise<void> {
  await storage.setItem(GUIDED_TOUR_CHOICE_KEY, "guided");
  await storage.setItem(GUIDED_TOUR_ACTIVE_KEY, true);
  await storage.setItem(GUIDED_TOUR_STEP_KEY, 0);
}
