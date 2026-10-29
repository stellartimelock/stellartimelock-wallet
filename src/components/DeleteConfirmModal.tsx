import React, { useEffect, useState } from "react";
import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";

import { colors, radii, spacing, typography } from "@/src/theme";

export interface DeleteConfirmModalProps {
  visible: boolean;
  /** Modal title, e.g. "Delete this note?" */
  title: string;
  /**
   * Optional secondary line describing what the user is about to
   * lose (e.g. "The note 'Groceries' and its 12 items will be
   * permanently removed from this device.").
   */
  message?: string;
  /**
   * Text on the checkbox. Defaults to the standard phrasing. Override
   * to be more specific when needed
   * (e.g. "I understand my saved passwords cannot be recovered.").
   */
  checkboxLabel?: string;
  /** Text on the destructive button. Defaults to "Delete". */
  destructiveLabel?: string;
  /** Text on the cancel button. Defaults to "Cancel". */
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Test hooks for the modal container and inner controls. */
  testID?: string;
}

export function DeleteConfirmModal({
  visible,
  title,
  message,
  checkboxLabel = "I understand this cannot be undone.",
  destructiveLabel = "Delete",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  testID,
}: DeleteConfirmModalProps) {
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (visible) setChecked(false);
  }, [visible]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      testID={testID}
    >
      <View style={styles.backdrop} accessible={false}>
        <View
          style={styles.card}
          testID={testID ? `${testID}-card` : undefined}
        >
          <View style={styles.iconRow}>
            <View style={styles.iconCircle}>
              <Feather name="trash-2" size={18} color={colors.danger} />
            </View>
          </View>
          <Text style={styles.title}>{title}</Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}

          <TouchableOpacity
            style={styles.checkboxRow}
            onPress={() => setChecked((v) => !v)}
            activeOpacity={0.7}
            testID={testID ? `${testID}-checkbox` : undefined}
            accessibilityRole="checkbox"
            accessibilityState={{ checked }}
          >
            <View
              style={[
                styles.checkboxBox,
                checked && styles.checkboxBoxChecked,
              ]}
            >
              {checked ? (
                <Feather
                  name="check"
                  size={12}
                  color={colors.textInverse}
                />
              ) : null}
            </View>
            <Text style={styles.checkboxLabel}>{checkboxLabel}</Text>
          </TouchableOpacity>

          <View style={styles.buttonRow}>
            <TouchableOpacity
              onPress={onCancel}
              style={[styles.button, styles.cancelBtn]}
              testID={testID ? `${testID}-cancel` : undefined}
              accessibilityRole="button"
            >
              <Text style={styles.cancelText}>{cancelLabel}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                if (!checked) return;
                onConfirm();
              }}
              disabled={!checked}
              style={[
                styles.button,
                checked ? styles.destructiveBtn : styles.destructiveBtnDisabled,
              ]}
              testID={testID ? `${testID}-confirm` : undefined}
              accessibilityRole="button"
              accessibilityState={{ disabled: !checked }}
            >
              <Text
                style={
                  checked
                    ? styles.destructiveText
                    : styles.destructiveTextDisabled
                }
              >
                {destructiveLabel}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.md,
  },
  card: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md + 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
  },
  iconRow: {
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.danger + "18",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.danger + "40",
  },
  title: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 4,
  },
  message: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    textAlign: "center",
    marginBottom: spacing.sm + 4,
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    marginBottom: spacing.md,
    // Larger vertical hit-target keeps this a comfortable 44pt+ tap.
    minHeight: 44,
  },
  checkboxBox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: colors.textSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxBoxChecked: {
    borderColor: colors.danger,
    backgroundColor: colors.danger,
  },
  checkboxLabel: {
    flex: 1,
    color: colors.text,
    fontSize: 12,
    lineHeight: 16,
  },
  buttonRow: {
    flexDirection: "row",
    gap: 8,
  },
  button: {
    flex: 1,
    minHeight: 44,
    borderRadius: radii.sm,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  cancelBtn: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
  },
  cancelText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "600",
  },
  destructiveBtn: {
    backgroundColor: colors.danger,
  },
  destructiveBtnDisabled: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
  },
  destructiveText: {
    color: colors.textInverse,
    fontSize: 13,
    ...typography.label,
  },
  destructiveTextDisabled: {
    color: colors.textTertiary,
    fontSize: 13,
    ...typography.label,
  },
});
