// Local bill reminders. Same on-device notification path as vault unlocks.
// Scheduling math lives in bills.ts; this file only registers the alarms.

import { Platform } from "react-native";

import { storage } from "@/src/utils/storage";

import { billReminderPlans, type Bill } from "./bills";
import { todayIso } from "./dates";

const INDEX_KEY = "xlm_vault_bill_reminders_v1";

type NotificationsModule = typeof import("expo-notifications");

async function notifications(): Promise<NotificationsModule | null> {
  if (Platform.OS === "web") return null;
  try {
    return await import("expo-notifications");
  } catch {
    return null;
  }
}

interface StoredReminder {
  billId: string;
  notificationId: string;
}

async function readIndex(): Promise<StoredReminder[]> {
  const raw = await storage.getItem<string>(INDEX_KEY, "");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as StoredReminder[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Replace scheduled bill reminders with the current save. Best-effort. */
export async function syncBillReminders(bills: Bill[], now = Date.now()): Promise<void> {
  const Notifications = await notifications();
  const previous = await readIndex();
  if (Notifications) {
    for (const row of previous) {
      try {
        await Notifications.cancelScheduledNotificationAsync(row.notificationId);
      } catch {
        /* already fired */
      }
    }
  }
  const plans = billReminderPlans(bills, todayIso(now), now);
  const next: StoredReminder[] = [];
  if (Notifications) {
    for (const plan of plans) {
      try {
        const notificationId = await Notifications.scheduleNotificationAsync({
          content: {
            title: plan.title,
            body: plan.body,
            data: { billId: plan.billId },
            sound: true,
          },
          trigger: {
            type: "date",
            date: new Date(plan.fireAtMs),
          } as unknown as import("expo-notifications").NotificationTriggerInput,
        });
        next.push({ billId: plan.billId, notificationId });
      } catch {
        /* permission or runtime */
      }
    }
  }
  await storage.setItem(INDEX_KEY, JSON.stringify(next));
}
