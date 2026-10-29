import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { colors, tileShadow } from "@/src/theme";
import type { UpdateManifest } from "@/constants/update-manifest";

import { getUpdateStatus, subscribeUpdateStatus } from "./check";

let bootstrapMounted = false;
const hostListeners = new Set<(mounted: boolean) => void>();

export function isUpdateBootstrapMounted(): boolean {
  return bootstrapMounted;
}

export function setUpdateBootstrapMounted(mounted: boolean): void {
  bootstrapMounted = mounted;
  for (const listener of hostListeners) listener(mounted);
}

export function subscribeUpdateBootstrap(
  listener: (mounted: boolean) => void,
): () => void {
  hostListeners.add(listener);
  return () => {
    hostListeners.delete(listener);
  };
}

/** Inline card for Settings. Hidden when the launch bootstrap is already showing one. */
export function SettingsUpdateSlot() {
  const [bootstrapOn, setBootstrapOn] = useState(isUpdateBootstrapMounted());

  useEffect(
    () => subscribeUpdateBootstrap(setBootstrapOn),
    [],
  );

  if (bootstrapOn) return null;
  return (
    <View style={styles.settingsWrap}>
      <UpdateAvailableSlot />
    </View>
  );
}

export function UpdateAvailableSlot() {
  const [status, setStatus] = useState(getUpdateStatus());

  useEffect(
    () => subscribeUpdateStatus(() => setStatus(getUpdateStatus())),
    [],
  );

  if (status.phase !== "available") return null;

  return <UpdateAvailableCard manifest={status.manifest} />;
}

function UpdateAvailableCard({ manifest }: { manifest: UpdateManifest }) {
  return (
    <View style={styles.card} testID="update-available-card" accessibilityRole="summary">
      <Text style={styles.kicker}>Update available</Text>
      <Text style={styles.title}>Version {manifest.versionName}</Text>
      {manifest.notes ? (
        <Text style={styles.notes} numberOfLines={8}>
          {manifest.notes}
        </Text>
      ) : null}
      <Text style={styles.notes}>
        Install this update from Google Play. This app does not download or install packages itself.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  settingsWrap: {
    marginTop: 8,
  },
  card: {
    backgroundColor: colors.surfaceFrost,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.cyan,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 6,
    ...tileShadow(),
  },
  kicker: {
    color: colors.cyan,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  title: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "700",
  },
  notes: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  error: {
    color: colors.danger ?? "#EF4444",
    fontSize: 13,
    lineHeight: 18,
  },
  button: {
    marginTop: 8,
    backgroundColor: colors.cyan,
    borderRadius: 10,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  buttonBusy: { opacity: 0.7 },
  buttonLabel: {
    color: "#04140f",
    fontSize: 15,
    fontWeight: "700",
  },
});
