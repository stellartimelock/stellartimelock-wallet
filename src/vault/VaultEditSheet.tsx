import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { Button } from "@/src/components/Button";
import { useToast } from "@/src/components/Toast";
import { colors, radii, spacing, typography } from "@/src/theme";

export interface VaultEditData {
  name: string;
  backupAddress: string | null;
}

export function VaultEditSheet({
  visible,
  initialName,
  initialBackupAddress,
  onClose,
  onSave,
  busy,
}: {
  visible: boolean;
  initialName: string;
  initialBackupAddress: string | null;
  onClose: () => void;
  onSave: (data: VaultEditData) => Promise<void>;
  busy: boolean;
}) {
  const [name, setName] = useState(initialName);
  const [backupAddress, setBackupAddress] = useState(initialBackupAddress ?? "");

  React.useEffect(() => {
    if (visible) {
      setName(initialName);
      setBackupAddress(initialBackupAddress ?? "");
    }
  }, [visible, initialName, initialBackupAddress]);

  const handleSave = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    await onSave({
      name: trimmedName,
      backupAddress: backupAddress.trim() || null,
    });
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />
          <Text style={styles.title}>Edit Vault</Text>

          <Text style={styles.label}>VAULT NAME</Text>
          <TextInput
            testID="vault-edit-name"
            value={name}
            onChangeText={setName}
            placeholder="Vault name"
            placeholderTextColor={colors.textTertiary}
            style={styles.input}
            maxLength={64}
            autoFocus
          />

          {/* Backup address is metadata-only; on-chain DMS params cannot change here. */}
          <Text style={styles.label}>BACKUP ADDRESS (optional)</Text>
          <TextInput
            testID="vault-edit-backup"
            value={backupAddress}
            onChangeText={setBackupAddress}
            placeholder="Stellar address (G…, 56 chars)"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="characters"
            autoCorrect={false}
            style={[styles.input, styles.mono]}
            maxLength={56}
          />
          <Text style={styles.hint}>
            Only the vault owner can withdraw. A backup address can be granted
            access in certain vault configurations.
          </Text>

          <View style={styles.actions}>
            <TouchableOpacity
              onPress={onClose}
              style={styles.cancelBtn}
              testID="vault-edit-cancel"
              activeOpacity={0.85}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Button
                testID="vault-edit-save"
                label={busy ? "Saving…" : "Save Changes"}
                icon="check"
                onPress={handleSave}
                loading={busy}
                disabled={!name.trim() || busy}
                variant="primary"
              />
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    minHeight: 320,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: "center",
    marginBottom: spacing.md,
  },
  title: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "700",
    marginBottom: spacing.md,
  },
  label: {
    color: colors.textTertiary,
    fontSize: 10,
    ...typography.label,
    marginTop: spacing.md,
    marginBottom: 6,
  },
  input: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    color: colors.text,
    fontSize: 15,
  },
  mono: { ...typography.mono, fontSize: 13 },
  hint: {
    color: colors.textTertiary,
    fontSize: 11,
    marginTop: 6,
    marginLeft: 4,
    lineHeight: 15,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: spacing.lg,
  },
  cancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  cancelText: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: "600",
  },
});