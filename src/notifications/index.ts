// Local vault-unlock notifications — no push tokens, no backend.

import { Platform } from "react-native";

import { storage } from "@/src/utils/storage";

// Lazy-load expo-notifications on native only — avoids web import-time warnings.
type NotificationsModule = typeof import("expo-notifications");
let _notifModule: NotificationsModule | null = null;
async function getNotifModule(): Promise<NotificationsModule | null> {
  if (Platform.OS === "web") return null;
  if (_notifModule) return _notifModule;
  try {
    _notifModule = await import("expo-notifications");
    return _notifModule;
  } catch {
    return null;
  }
}

const ENABLED_KEY = "xlm_vault_notifications_enabled_v1";
const PROMPTED_KEY = "xlm_vault_notifications_prompted_v1";
const SCHED_INDEX_KEY = "xlm_vault_scheduled_notifications_v1";

export type PermissionState =
  | "granted"
  | "undetermined"
  | "denied"
  | "permanently_denied";

// On native we want notifications to play a sound and show a banner
// even when the app is foregrounded — by default they're swallowed.
// The listener is native-only; on web we never reach this path because
// `getNotifModule()` returns null.
let _handlerInstalled = false;
async function ensureHandler() {
  if (_handlerInstalled) return;
  const Notifications = await getNotifModule();
  if (!Notifications) {
    _handlerInstalled = true; // web — no-op
    return;
  }
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowAlert: true,
      } as unknown as import("expo-notifications").NotificationBehavior),
    });
    _handlerInstalled = true;
  } catch {
    /* expo-notifications is web-only stubbed on some platforms */
  }
}

export async function getEnabled(): Promise<boolean> {
  return (await storage.getItem<boolean>(ENABLED_KEY, false)) ?? false;
}

export async function setEnabled(enabled: boolean): Promise<void> {
  await storage.setItem(ENABLED_KEY, enabled);
  if (!enabled) {
    // Cancel every pending schedule on shutdown.
    const Notifications = await getNotifModule();
    if (Notifications) {
      try {
        await Notifications.cancelAllScheduledNotificationsAsync();
      } catch {
        /* expo-notifications unavailable on this runtime */
      }
    }
    await storage.setItem(SCHED_INDEX_KEY, JSON.stringify([]));
  }
}

export async function hasPromptedFirstVault(): Promise<boolean> {
  return (await storage.getItem<boolean>(PROMPTED_KEY, false)) ?? false;
}
export async function markPromptedFirstVault(): Promise<void> {
  await storage.setItem(PROMPTED_KEY, true);
}

export async function getPermissionState(): Promise<PermissionState> {
  await ensureHandler();
  const Notifications = await getNotifModule();
  if (!Notifications) return "undetermined";
  try {
    const res = await Notifications.getPermissionsAsync();
    if (res.granted) return "granted";
    if (res.canAskAgain === false) return "permanently_denied";
    if (res.status === "undetermined") return "undetermined";
    return "denied";
  } catch {
    return "undetermined";
  }
}

export async function requestPermissionsIfNeeded(): Promise<PermissionState> {
  await ensureHandler();
  const Notifications = await getNotifModule();
  if (!Notifications) return "undetermined";
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return "granted";
    if (current.canAskAgain === false) return "permanently_denied";
    const next = await Notifications.requestPermissionsAsync();
    if (next.granted) return "granted";
    if (next.canAskAgain === false) return "permanently_denied";
    return "denied";
  } catch {
    return "undetermined";
  }
}

interface ScheduledRecord {
  vaultId: string;
  notificationId: string;
  unlockTimestamp: number; // seconds
}

async function readIndex(): Promise<ScheduledRecord[]> {
  const raw = await storage.getItem<string>(SCHED_INDEX_KEY, "");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as ScheduledRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeIndex(records: ScheduledRecord[]): Promise<void> {
  await storage.setItem(SCHED_INDEX_KEY, JSON.stringify(records));
}

export async function scheduleUnlockNotification(input: {
  vaultId: string;
  vaultName: string;
  unlockTimestamp: number; // unix seconds
}): Promise<string | null> {
  await ensureHandler();
  if (!(await getEnabled())) return null;
  const perm = await getPermissionState();
  if (perm !== "granted") return null;
  const Notifications = await getNotifModule();
  if (!Notifications) return null;

  const fireAtMs = input.unlockTimestamp * 1000;
  // If the unlock is already in the past, skip — nothing to remind.
  if (fireAtMs <= Date.now() + 5000) return null;

  try {
    // Cancel any previous schedule for this vault to keep one schedule
    // per vault (handles "extend" operations cleanly).
    await cancelVaultNotification(input.vaultId);

    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: "Vault unlocked",
        body: `"${input.vaultName}" is now available to withdraw.`,
        // Reserved data field — lets a future tap handler deep-link to /vault/[id].
        data: { vaultId: input.vaultId },
        sound: true,
      },
      trigger:
        Platform.OS === "web"
          ? null // expo-notifications on web fires immediately — noop
          : ({
              type: "date",
              date: new Date(fireAtMs),
            } as unknown as import("expo-notifications").NotificationTriggerInput),
    });

    const index = await readIndex();
    const next = index.filter((r) => r.vaultId !== input.vaultId);
    next.push({
      vaultId: input.vaultId,
      notificationId: id,
      unlockTimestamp: input.unlockTimestamp,
    });
    await writeIndex(next);
    return id;
  } catch {
    return null;
  }
}

export async function cancelVaultNotification(vaultId: string): Promise<void> {
  await ensureHandler();
  const Notifications = await getNotifModule();
  try {
    const index = await readIndex();
    const target = index.find((r) => r.vaultId === vaultId);
    if (target) {
      if (Notifications) {
        try {
          await Notifications.cancelScheduledNotificationAsync(target.notificationId);
        } catch {
          /* already fired or invalid id */
        }
      }
      await writeIndex(index.filter((r) => r.vaultId !== vaultId));
    }
  } catch {
    /* noop */
  }
}

export async function cancelAllNotifications(): Promise<void> {
  const Notifications = await getNotifModule();
  if (Notifications) {
    try {
      await Notifications.cancelAllScheduledNotificationsAsync();
    } catch {
      /* noop */
    }
  }
  await writeIndex([]);
}