// RestoreConfirmModal.
//
// Full-screen destructive-action confirmation for Google-Drive
// restore and Manual JSON import. Replaces the previous
// `Alert.alert` which showed a two-tap OS prompt that users kept
// firing accidentally.
//
// Contract:
//   • Renders a modal with a red warning icon, replacement copy,
//     and a required "I understand" checkbox.
//   • The primary destructive button is DISABLED until the checkbox
//     is ticked.
//   • Optional `onBackupFirst` — when provided, surfaces a second
//     "Back up first, then restore" action (used by the GDrive card).
//   • Optional `bulletList` — array of lines rendered under the
//     warning body so each caller can enumerate what gets replaced
//     (notes, bills, layout, …).
//
// Uses the app's <Checkbox> so the tick state matches the rest of
// the design system.

import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Checkbox } from "@/src/components/Checkbox";
import { colors, radii, spacing, typography } from "@/src/theme";

export interface RestoreConfirmModalProps {
  visible: boolean;
  /** Displayed in the modal header. Keep short. */
  title: string;
  /** Body copy shown above the "I understand" checkbox. */
  body: string;
  /** Optional bullet points enumerated under the body. */
  bulletList?: string[];
  /** Label for the destructive button (e.g. "Restore" / "Import"). */
  confirmLabel: string;
  /** Called when the user cancels. */
  onCancel: () => void;
  /** Called when the destructive path is confirmed. */
  onConfirm: () => void;
  /** Optional: show a second "Back up first" button (GDrive). */
  onBackupFirst?: () => void;
  /** Optional: while true the confirm button spins/disables. */
  busy?: boolean;
  /** One line of restore progress, shown while busy. */
  progress?: string | null;
  /** testID prefix so playwright/testing agent can target this modal. */
  testIDPrefix?: string;
  /**
   * When true, this restore/import has NOTHING to lose
   * locally (the device has no notes/bills/addresses/etc. yet). The
   * modal drops the "will be replaced" bullet list, the red
   * "cannot be undone" banner, and the mandatory checkbox — it's a
   * simple one-tap confirmation instead of a destructive-action gate.
   * Callers should compute this via `isEnvelopeEmpty(await
   * buildEnvelope())` before opening the modal.
   */
  nonDestructive?: boolean;
}

export function RestoreConfirmModal({
  visible,
  title,
  body,
  bulletList,
  confirmLabel,
  onCancel,
  onConfirm,
  onBackupFirst,
  busy,
  progress,
  testIDPrefix = "restore-confirm",
  nonDestructive = false,
}: RestoreConfirmModalProps) {
  const insets = useSafeAreaInsets();
  const [understood, setUnderstood] = useState(false);

  // Reset the check every time the modal (re)opens so users can't
  // half-open + confirm the next destructive prompt in one tap.
  React.useEffect(() => {
    if (!visible) setUnderstood(false);
  }, [visible]);

  const canConfirm = nonDestructive ? !busy : understood && !busy;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <Pressable
        style={styles.backdrop}
        onPress={busy ? undefined : onCancel}
        testID={`${testIDPrefix}-backdrop`}
      />
        <View style={styles.sheet}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: spacing.md + 4 }}
          showsVerticalScrollIndicator
        >
          <View style={styles.headerBlock}>
            <View
              style={[
                styles.warnIcon,
              ]}
            >
              <Feather
                name={nonDestructive ? "cloud" : "alert-triangle"}
                size={26}
                color={nonDestructive ? colors.teal : colors.danger}
              />
            </View>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.body}>{body}</Text>
          </View>

          {!nonDestructive && bulletList && bulletList.length > 0 ? (
            <View style={styles.bulletBlock}>
              <Text style={styles.bulletHeading}>WILL BE REPLACED</Text>
              {bulletList.map((line, i) => (
                <View key={i} style={styles.bulletRow}>
                  <View style={styles.bulletDot} />
                  <Text style={styles.bulletText}>{line}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {!nonDestructive ? (
            <View style={styles.finalWarnBox}>
              <Feather name="x-octagon" size={14} color={colors.danger} />
              <Text style={styles.finalWarnText}>
                This cannot be undone.
              </Text>
            </View>
          ) : null}

          {!nonDestructive ? (
            <Pressable
              onPress={() => setUnderstood((v) => !v)}
              style={styles.confirmRow}
              testID={`${testIDPrefix}-understood-row`}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: understood }}
            >
              <Checkbox
                checked={understood}
                onChange={setUnderstood}
                testID={`${testIDPrefix}-understood-checkbox`}
              />
              <Text style={styles.confirmText}>
                I understand and want to replace ALL current data with the backup.
              </Text>
            </Pressable>
          ) : null}
        </ScrollView>

        {progress ? (
          <Text style={styles.progress} testID={`${testIDPrefix}-progress`}>
            {progress}
          </Text>
        ) : null}

        <View style={styles.actionsRow}>
          <TouchableOpacity
            onPress={busy ? undefined : onCancel}
            style={[styles.actionBtn, styles.cancelBtn]}
            testID={`${testIDPrefix}-cancel`}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
          >
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
          {onBackupFirst ? (
            <TouchableOpacity
              onPress={onBackupFirst}
              disabled={!!busy}
              style={[
                styles.actionBtn,
                styles.backupFirstBtn,
                !!busy && styles.actionBtnDisabled,
              ]}
              testID={`${testIDPrefix}-backup-first`}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Back up first, then restore"
            >
              <Feather name="upload-cloud" size={13} color={colors.teal} />
              <Text style={styles.backupFirstText}>Backup first</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            onPress={onConfirm}
            disabled={!canConfirm}
            style={[
              styles.actionBtn,
              nonDestructive ? styles.confirmBtnSafe : styles.confirmBtn,
              !canConfirm && styles.actionBtnDisabled,
            ]}
            testID={`${testIDPrefix}-confirm`}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canConfirm }}
            accessibilityLabel={confirmLabel}
          >
            <Feather
              name="download-cloud"
              size={13}
              color={colors.textInverse}
            />
            <Text style={styles.confirmBtnText}>{confirmLabel}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.72)",
  },
sheet: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.background,
    justifyContent: 'center',
    paddingBottom: 40,
  },
  headerBlock: {
    alignItems: "center",
    marginTop: spacing.md,
    marginBottom: spacing.md,
  },
  warnIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.dangerMuted,
    borderWidth: 1,
    borderColor: colors.danger,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  title: {
    color: colors.text,
    fontSize: 20,
    textAlign: "center",
    marginBottom: 6,
    ...typography.heading,
  },
  body: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
    paddingHorizontal: spacing.sm,
  },
  bulletBlock: {
    marginTop: spacing.sm,
    padding: spacing.sm + 2,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
  },
  bulletHeading: {
    color: colors.textTertiary,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  bulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingVertical: 3,
  },
  bulletDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.danger,
    marginTop: 7,
  },
  bulletText: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
    flex: 1,
  },
  finalWarnBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: spacing.md,
    padding: 10,
    backgroundColor: colors.dangerMuted,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.dangerOutline,
  },
  finalWarnText: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: "800",
    flex: 1,
  },
  confirmRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: spacing.md,
    padding: spacing.sm + 2,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  confirmText: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    flex: 1,
  },
  progress: {
    color: colors.textSecondary,
    fontSize: 13,
    paddingHorizontal: spacing.md + 4,
    paddingBottom: spacing.sm,
  },
  actionsRow: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.md + 4,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
    backgroundColor: colors.background,
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 48,
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm,
  },
  actionBtnDisabled: { opacity: 0.4 },
  cancelBtn: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelBtnText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
  },
  backupFirstBtn: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.teal,
  },
  backupFirstText: {
    color: colors.teal,
    fontSize: 12,
    fontWeight: "800",
  },
  confirmBtn: {
    backgroundColor: colors.danger,
  },
  confirmBtnSafe: {
    backgroundColor: colors.teal,
  },
  confirmBtnText: {
    color: colors.textInverse,
    fontSize: 13,
    fontWeight: "800",
  },
});
