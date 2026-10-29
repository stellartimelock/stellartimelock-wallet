import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { colors, radii, spacing, typography } from "@/src/theme";
import {
  formatVaultMemo,
  VAULT_NOTIFY_AMOUNT_XLM,
} from "@/src/vault/memo-format";
import {
  sendVaultNotifyPayment,
  type VaultNotifyKind,
} from "@/src/vault/vault-notify";
import type { StellarKeypair } from "@/src/wallet/stellar";
import { shortenAddress } from "@/src/wallet/stellar";

export interface VaultNotifyConfirmModalProps {
  visible: boolean;
  keypair: StellarKeypair | null;
  destination: string;
  destinationLabel?: string;
  vaultRef: string;
  kind: VaultNotifyKind;
  onDone: (sent: boolean) => void;
  /**
   * When true, the notification is part of vault setup — Skip is hidden and
   * the modal cannot be dismissed without sending (or hardware-back is a no-op).
   */
  required?: boolean;
  /** Optional title override (default: "Notify {role}?" / "Notify {role}" when required). */
  title?: string;
  /** Optional body override. */
  message?: string;
  /** Primary CTA label (default: "Send notification"). */
  confirmLabel?: string;
  /** Secondary CTA label (default: "Skip for now"). Ignored when required. */
  skipLabel?: string;
}

export function VaultNotifyConfirmModal({
  visible,
  keypair,
  destination,
  destinationLabel,
  vaultRef,
  kind,
  onDone,
  required = false,
  title,
  message,
  confirmLabel,
  skipLabel,
}: VaultNotifyConfirmModalProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const logicalMemo = formatVaultMemo(vaultRef);
  const roleLabel =
    kind === "DeadManSwitch" ? "beneficiary" : "co-signer";
  const kindLabel =
    kind === "DeadManSwitch" ? "Dead Man's Switch" : "Multi-Sig";

  const handleConfirm = async () => {
    if (!keypair || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await sendVaultNotifyPayment({
        keypair,
        destination,
        vaultRef,
        kind,
      });
      if (!res.ok) {
        setError(res.error ?? "Notification failed.");
        return;
      }
      onDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => {
        // Required notify is part of setup — do not allow dismiss via back.
        if (required || busy) return;
        onDone(false);
      }}
      testID="vault-notify-confirm-modal"
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.iconCircle}>
            <Feather name="radio" size={18} color={colors.cyan} />
          </View>
          <Text style={styles.title}>
            {title ?? (required ? `Notify ${roleLabel}` : `Notify ${roleLabel}?`)}
          </Text>
          <Text style={styles.message}>
            {message ??
              (required
                ? `Your ${roleLabel} must be notified. This sends a ${VAULT_NOTIFY_AMOUNT_XLM} XLM transaction with the vault details.`
                : `Send ${VAULT_NOTIFY_AMOUNT_XLM} XLM to your ${roleLabel} so their wallet can discover this ${kindLabel} vault from the payment memo. No server is involved — the memo is the invitation.`)}
          </Text>

          <View style={styles.metaBlock}>
            <Text style={styles.metaLabel}>TO</Text>
            <Text style={styles.metaValue} numberOfLines={2}>
              {destinationLabel
                ? `${destinationLabel} · ${shortenAddress(destination)}`
                : shortenAddress(destination, 12, 10)}
            </Text>
            <Text style={[styles.metaLabel, { marginTop: spacing.sm }]}>MEMO</Text>
            <Text style={styles.memoMono} numberOfLines={3} selectable>
              {logicalMemo}
            </Text>
            <Text style={[styles.metaLabel, { marginTop: spacing.sm }]}>AMOUNT</Text>
            <Text style={styles.metaValue}>{VAULT_NOTIFY_AMOUNT_XLM} XLM</Text>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TouchableOpacity
            style={[
              styles.primaryBtn,
              busy && styles.btnDisabled,
              required && styles.primaryBtnRequired,
            ]}
            onPress={handleConfirm}
            disabled={busy || !keypair}
            testID="vault-notify-confirm"
            activeOpacity={0.85}
          >
            {busy ? (
              <ActivityIndicator size="small" color={colors.textInverse} />
            ) : (
              <>
                <Feather name="send" size={14} color={colors.textInverse} />
                <Text style={styles.primaryBtnText}>
                  {confirmLabel ?? "Send notification"}
                </Text>
              </>
            )}
          </TouchableOpacity>

          {!required ? (
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => onDone(false)}
              disabled={busy}
              testID="vault-notify-skip"
              activeOpacity={0.85}
            >
              <Text style={styles.secondaryBtnText}>
                {skipLabel ?? "Skip for now"}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    justifyContent: "center",
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.cyanMuted,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  title: {
    ...typography.heading,
    color: colors.text,
    fontSize: 18,
    marginBottom: spacing.sm,
  },
  message: {
    ...typography.body,
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: spacing.md,
  },
  metaBlock: {
    backgroundColor: colors.background,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  metaLabel: {
    color: colors.textTertiary,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.6,
  },
  metaValue: {
    color: colors.text,
    fontSize: 13,
    marginTop: 2,
  },
  memoMono: {
    ...typography.mono,
    color: colors.cyan,
    fontSize: 11,
    marginTop: 2,
  },
  error: {
    color: colors.danger,
    fontSize: 12,
    marginBottom: spacing.sm,
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.cyan,
    borderRadius: radii.md,
    paddingVertical: 12,
    marginBottom: spacing.sm,
  },
  /** When Skip is hidden, drop bottom margin so the card doesn't look sparse. */
  primaryBtnRequired: {
    marginBottom: 0,
  },
  primaryBtnText: {
    color: colors.textInverse,
    fontWeight: "700",
    fontSize: 14,
  },
  secondaryBtn: {
    alignItems: "center",
    paddingVertical: 10,
  },
  secondaryBtnText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: "600",
  },
  btnDisabled: { opacity: 0.6 },
});
