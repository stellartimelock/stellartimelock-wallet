import { Feather } from "@expo/vector-icons";
import React from "react";
import { Text, TouchableOpacity, View } from "react-native";

import { Card } from "@/src/components/Card";
import { Vault } from "@/src/api/client";
import { colors, spacing } from "@/src/theme";
import {
  formatDaysRemaining,
  formatUnlockDate,
} from "@/src/vault/countdown";

import { styles, statusPillStyle } from "./styles";

export function VaultRow({
  vault,
  onPress,
  formatXlm,
  formatFiat,
  isBeneficiary = false,
}: {
  vault: Vault;
  onPress: () => void;
  formatXlm: (n: number) => string;
  formatFiat: (n: number) => string;
  /** True when this wallet is the vault backup_address (beneficiary), not owner. */
  isBeneficiary?: boolean;
}) {
  const status = vault.status;
  const target = vault.target_amount ?? 0;
  const progress = target > 0 ? Math.min(1, vault.balance / target) : 0;
  const ownerShort =
    vault.owner_public_key.length > 12
      ? `${vault.owner_public_key.slice(0, 4)}…${vault.owner_public_key.slice(-4)}`
      : vault.owner_public_key;

  if (status === "archived") {
    return (
      <View testID={`vault-card-${vault.vault_id}`}>
        <Card status="archived" padded>
          <View style={styles.rowBetween}>
            <View style={{ flex: 1, paddingRight: spacing.sm }}>
              <Text style={styles.vaultName} numberOfLines={1}>
                {vault.name}
              </Text>
              <Text style={styles.vaultSub} numberOfLines={2}>
                {isBeneficiary
                  ? `Owner ${ownerShort} — historical record, no actions available.`
                  : "Historical record — vault is complete, no actions available."}
              </Text>
            </View>
            <View
              style={styles.archivedPill}
              testID={`vault-status-archived-${vault.vault_id}`}
            >
              <Feather name="archive" size={11} color={colors.textTertiary} />
              <Text style={styles.archivedPillText}>archived</Text>
            </View>
          </View>
        </Card>
      </View>
    );
  }

  return (
    <TouchableOpacity
      testID={`vault-card-${vault.vault_id}`}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <Card status={status} padded>
        <View style={styles.rowBetween}>
          <View style={{ flex: 1, paddingRight: spacing.sm }}>
            <Text style={styles.vaultName} numberOfLines={1}>
              {vault.name}
            </Text>
            <Text style={styles.vaultSub}>
              {status === "withdrawn"
                ? `Withdrawn · ${formatUnlockDate(vault.unlock_timestamp)}`
                : `${formatDaysRemaining(vault.unlock_timestamp)} · ${formatUnlockDate(
                    vault.unlock_timestamp
                  )}`}
            </Text>
            {isBeneficiary ? (
              <Text
                style={styles.beneficiaryOwnerHint}
                numberOfLines={1}
                testID={`vault-beneficiary-owner-${vault.vault_id}`}
              >
                Owner {ownerShort}
              </Text>
            ) : null}
          </View>
          <View style={styles.pillCol}>
            {isBeneficiary ? (
              <View
                style={styles.beneficiaryPill}
                testID={`vault-beneficiary-pill-${vault.vault_id}`}
              >
                <Feather name="user-check" size={10} color={colors.gold} />
                <Text style={styles.beneficiaryPillText}>Beneficiary</Text>
              </View>
            ) : null}
            <View style={statusPillStyle(status)}>
              <Feather
                name={
                  status === "locked"
                    ? "lock"
                    : status === "unlocked"
                    ? "unlock"
                    : "check"
                }
                size={11}
                color={
                  status === "locked"
                    ? colors.teal
                    : status === "unlocked"
                    ? colors.statusActive
                    : colors.statusClosed
                }
              />
              <Text
                style={[
                  styles.statusText,
                  {
                    color:
                      status === "locked"
                        ? colors.teal
                        : status === "unlocked"
                        ? colors.statusActive
                        : colors.statusClosed,
                  },
                ]}
              >
                {status}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.balanceRow}>
          <View>
            <Text style={styles.vaultBalance}>{formatXlm(vault.balance)}</Text>
            <Text style={styles.vaultFiat}>{formatFiat(vault.balance)}</Text>
          </View>
          {target > 0 ? (
            <View style={styles.targetCol}>
              <Text style={styles.statLabel}>Target</Text>
              <Text style={styles.targetValue}>{formatXlm(target)}</Text>
            </View>
          ) : null}
        </View>

        {target > 0 ? (
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
          </View>
        ) : null}
      </Card>
    </TouchableOpacity>
  );
}
