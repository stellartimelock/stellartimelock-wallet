import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { useToast } from "@/src/components/Toast";
import { useSession } from "@/src/state/session";
import { colors, radii, spacing, typography } from "@/src/theme";
import { formatUsDate } from "@/src/utils/us-date";
import {
  tokenSymbolForAddress,
  withdrawBetaVault,
  getVaultTtlStatus,
  preflightVaultTtlBump,
  submitPreflightedTtlBump,
  stroopsToXlmString,
  recordTtlRenewal,
  TTL_WARNING_WINDOW_HOURS,
  type BetaVaultRecord,
} from "@/src/wallet/multi-asset-beta";

export function MultiAssetBetaSection({
  vaults,
  loading,
  expanded,
  onToggleExpanded,
  onWithdrew,
}: {
  vaults: BetaVaultRecord[];
  loading: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  /** Fires after a successful on-chain withdrawal so the parent can re-fetch. */
  onWithdrew?: () => void;
}) {
  const router = useRouter();
  const nowSec = Math.floor(Date.now() / 1000);
  const activeVaults = vaults.filter((v) => !v.withdrawn);
  return (
    <View
      style={betaStyles.wrap}
      testID="dashboard-multi-asset-beta-section"
    >
      <TouchableOpacity
        style={betaStyles.headerRow}
        onPress={onToggleExpanded}
        activeOpacity={0.85}
        testID="dashboard-multi-asset-beta-header"
        accessibilityRole="button"
        accessibilityState={{ expanded }}
      >
        <View style={betaStyles.headerIcon}>
          <Feather name="layers" size={13} color={colors.gold} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={betaStyles.headerTitle}>MULTI-ASSET VAULTS</Text>
          <Text style={betaStyles.headerSubtitle}>
            {loading
              ? "Checking on-chain…"
              : activeVaults.length === 0
                ? "No multi-asset vaults yet"
                : `${activeVaults.length} on-chain vault${activeVaults.length === 1 ? "" : "s"}`}
          </Text>
        </View>
        <Feather
          name={expanded ? "chevron-up" : "chevron-down"}
          size={18}
          color={colors.textSecondary}
        />
      </TouchableOpacity>

      {expanded ? (
        <View style={betaStyles.body}>
          {loading ? (
            <Text style={betaStyles.emptyText}>Loading multi-asset vaults…</Text>
          ) : vaults.length === 0 ? (
            <Text style={betaStyles.emptyText}>
              Multi-asset vaults you create will appear here. Enable the
              toggle when creating a vault to lock any Stellar token
              other than XLM.
            </Text>
          ) : activeVaults.length === 0 ? (
            <Text style={betaStyles.emptyText}>
              All your multi-asset vaults have been withdrawn. Check the
              History tab&apos;s &ldquo;Multi-Asset Vaults&rdquo; section to view them.
            </Text>
          ) : (
            (() => {
              const locked = vaults.filter(
                (v) => !v.withdrawn && v.unlockTimestamp > nowSec,
              );
              const readyToWithdraw = vaults.filter(
                (v) => !v.withdrawn && v.unlockTimestamp <= nowSec,
              );
              return (
                <>
                  {locked.map((v) => (
                    <BetaVaultRow
                      key={v.vaultId.toString()}
                      vault={v}
                      nowSec={nowSec}
                      onWithdrew={onWithdrew}
                    />
                  ))}
                  {readyToWithdraw.length > 0 ? (
                    <View testID="dashboard-beta-ready-section">
                      {locked.length > 0 ? (
                        <Text style={betaStyles.subLabel}>
                          READY TO WITHDRAW ({readyToWithdraw.length})
                        </Text>
                      ) : null}
                      {readyToWithdraw.map((v) => (
                        <BetaVaultRow
                          key={v.vaultId.toString()}
                          vault={v}
                          nowSec={nowSec}
                          onWithdrew={onWithdrew}
                        />
                      ))}
                    </View>
                  ) : null}
                </>
              );
            })()
          )}
          <TouchableOpacity
            onPress={() => router.push("/create-vault")}
            style={betaStyles.newBtn}
            activeOpacity={0.85}
            testID="dashboard-multi-asset-beta-new"
          >
            <Feather name="plus" size={13} color={colors.gold} />
            <Text style={betaStyles.newBtnText}>New multi-asset vault</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

function BetaVaultRow({
  vault,
  nowSec,
  onWithdrew,
}: {
  vault: BetaVaultRecord;
  nowSec: number;
  onWithdrew?: () => void;
}) {
  const toast = useToast();
  const { wallet } = useSession();
  const [busy, setBusy] = useState(false);
  const [ttlStatus, setTtlStatus] = useState<{
    minRemainingHours: number | null;
    renewedUntilMs: number | null;
  } | null>(null);
  const [ttlRefreshBusy, setTtlRefreshBusy] = useState(false);

  useEffect(() => {
    if (vault.withdrawn || !wallet?.publicKey) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await getVaultTtlStatus(wallet.publicKey, vault.vaultId);
        if (!cancelled) setTtlStatus(res);
      } catch {
        /* non-fatal */
      }
    })();
    return () => {
      cancelled = true;
    };
    // vaultId is bigint — depend on string form, not object reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet?.publicKey, vault.vaultId.toString(), vault.withdrawn]);

  const handleTtlRefresh = useCallback(async () => {
    if (!wallet?.publicKey) return;
    if (!wallet.secretSeed) {
      toast.show("Import your seed phrase to sign this transaction.", "error");
      return;
    }
    setTtlRefreshBusy(true);
    try {
      const preflight = await preflightVaultTtlBump(wallet.publicKey, vault.vaultId);
      if (!preflight.ok || !preflight.assembledTxXdr) {
        toast.show(preflight.error || "Couldn't estimate the renewal fee.", "error");
        return;
      }
      const feeXlm = stroopsToXlmString(preflight.estimatedFeeStroops ?? "100000");
      const vaultName = vault.name || `Vault #${vault.vaultId.toString()}`;
      Alert.alert(
        "Renew on-chain data?",
        `This extends ${vaultName}'s on-chain data so it can't expire early. Stellar network fee: ~${feeXlm} XLM.`,
        [
          { text: "Cancel", style: "cancel", onPress: () => setTtlRefreshBusy(false) },
          {
            text: "Renew",
            onPress: async () => {
              try {
                const res = await submitPreflightedTtlBump(
                  wallet.secretSeed!,
                  preflight.assembledTxXdr!,
                );
                if (res.ok) {
                  toast.show(`Renewed ${vaultName}'s on-chain data.`, "success");
                  void recordTtlRenewal(wallet.publicKey, {
                    vaultId: vault.vaultId.toString(),
                    vaultName,
                    feeStroops: res.feeStroops ?? preflight.estimatedFeeStroops ?? "100000",
                    txHash: res.txHash,
                    timestampMs: Date.now(),
                  });
                  try {
                    const fresh = await getVaultTtlStatus(wallet.publicKey, vault.vaultId);
                    setTtlStatus(fresh);
                  } catch {
                    /* status refresh is best-effort */
                  }
                } else {
                  toast.show(res.error || "Renewal failed.", "error");
                }
              } catch (e) {
                toast.show(e instanceof Error ? e.message : String(e), "error");
              } finally {
                setTtlRefreshBusy(false);
              }
            },
          },
        ],
      );
    } catch (e) {
      toast.show(e instanceof Error ? e.message : String(e), "error");
      setTtlRefreshBusy(false);
    }
  }, [wallet, vault, toast]);

  // Assumes 7 decimals (SEP-41 SAC); custom token precision may display wrong.
  const symbol = tokenSymbolForAddress(vault.tokenContractId) ?? "TOKEN";
  const amountFloat = Number(vault.balance) / 10_000_000;
  const secondsRemaining = vault.unlockTimestamp - nowSec;
  const status = vault.withdrawn
    ? "withdrawn"
    : secondsRemaining <= 0
      ? "unlocked"
      : "locked";
  const remainingLabel = vault.withdrawn
    ? "Withdrawn"
    : secondsRemaining <= 0
      ? "Ready to withdraw"
      : formatShortDuration(secondsRemaining);
  const showTtlRefreshBtn =
    !vault.withdrawn &&
    ttlStatus?.minRemainingHours != null &&
    ttlStatus.minRemainingHours <= TTL_WARNING_WINDOW_HOURS;
  return (
    <View style={betaStyles.row} testID={`dashboard-beta-vault-${vault.vaultId}`}>
      <View style={betaStyles.rowTopRow}>
        <Text style={betaStyles.rowName} numberOfLines={1}>
          {vault.name || `Vault #${vault.vaultId.toString()}`}
        </Text>
        <View
          style={[
            betaStyles.statusPill,
            status === "unlocked" && { borderColor: colors.statusActive },
            status === "withdrawn" && { borderColor: colors.statusClosed },
          ]}
        >
          <Text
            style={[
              betaStyles.statusPillText,
              status === "unlocked" && { color: colors.statusActive },
              status === "withdrawn" && { color: colors.statusClosed },
            ]}
          >
            {status.toUpperCase()}
          </Text>
        </View>
      </View>
      <View style={betaStyles.rowBottomRow}>
        <Text style={betaStyles.rowAmount}>
          {amountFloat.toLocaleString(undefined, {
            maximumFractionDigits: 4,
          })}{" "}
          {symbol}
        </Text>
        <Text style={betaStyles.rowRemaining} numberOfLines={1}>
          {remainingLabel}
        </Text>
      </View>
      {!vault.withdrawn && ttlStatus?.renewedUntilMs != null ? (
        <View style={betaStyles.ttlRow} testID={`dashboard-beta-vault-ttl-${vault.vaultId}`}>
          <Feather name="shield" size={11} color={colors.textTertiary} />
          <Text style={betaStyles.ttlText} numberOfLines={1}>
            On-chain data renewed until ~{formatMonthYear(ttlStatus.renewedUntilMs)}
          </Text>
        </View>
      ) : null}
      {showTtlRefreshBtn ? (
        <TouchableOpacity
          onPress={handleTtlRefresh}
          disabled={ttlRefreshBusy}
          activeOpacity={0.8}
          style={[betaStyles.ttlRefreshBtn, ttlRefreshBusy && { opacity: 0.6 }]}
          testID={`dashboard-beta-vault-ttl-refresh-${vault.vaultId}`}
          accessibilityRole="button"
          accessibilityLabel={`Renew on-chain data for ${vault.name || "this vault"}`}
        >
          {ttlRefreshBusy ? (
            <ActivityIndicator size="small" color={colors.gold} />
          ) : (
            <>
              <Feather name="refresh-cw" size={12} color={colors.gold} />
              <Text style={betaStyles.ttlRefreshBtnText}>Refresh</Text>
            </>
          )}
        </TouchableOpacity>
      ) : null}
      {status === "unlocked" ? (
        <TouchableOpacity
          onPress={async () => {
            if (busy || !wallet?.secretSeed) {
              if (!wallet?.secretSeed) {
                toast.show(
                  "Import your seed phrase to sign withdrawal transactions.",
                  "error",
                );
              }
              return;
            }
            setBusy(true);
            try {
              const res = await withdrawBetaVault({
                ownerPublicKey: wallet.publicKey,
                ownerSecretSeed: wallet.secretSeed,
                tokenContractId: vault.tokenContractId,
                vaultId: vault.vaultId,
              });
              if (res.ok) {
                toast.show(
                  `Withdrew ${amountFloat.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${symbol}.`,
                  "success",
                );
                onWithdrew?.();
              } else {
                toast.show(res.error || "Withdrawal failed.", "error");
              }
            } catch (e) {
              toast.show(
                e instanceof Error ? e.message : String(e),
                "error",
              );
            } finally {
              setBusy(false);
            }
          }}
          disabled={busy}
          activeOpacity={0.85}
          style={[betaStyles.withdrawBtn, busy && { opacity: 0.6 }]}
          testID={`dashboard-beta-vault-withdraw-${vault.vaultId}`}
          accessibilityRole="button"
          accessibilityLabel={`Withdraw ${amountFloat} ${symbol}`}
        >
          {busy ? (
            <ActivityIndicator size="small" color={colors.textInverse} />
          ) : (
            <>
              <Feather name="unlock" size={13} color={colors.textInverse} />
              <Text style={betaStyles.withdrawBtnText}>Withdraw {symbol}</Text>
            </>
          )}
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function formatShortDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "Ready";
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} min`;
  if (seconds < 86400) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  }
  const days = Math.floor(seconds / 86400);
  return `${days} day${days === 1 ? "" : "s"}`;
}

function formatMonthYear(ms: number): string {
  try {
    return formatUsDate(new Date(ms), {
      month: "long",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

const betaStyles = StyleSheet.create({
  wrap: {
    marginTop: spacing.xl,
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.gold + "40",
    backgroundColor: colors.surface,
    borderTopWidth: 2,
    borderTopColor: colors.gold,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  headerIcon: {
    width: 26,
    height: 26,
    borderRadius: radii.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.gold + "18",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.gold + "60",
  },
  headerTitle: {
    color: colors.gold,
    fontSize: 11,
    ...typography.label,
  },
  headerSubtitle: {
    color: colors.textSecondary,
    fontSize: 11,
    marginTop: 2,
  },
  body: {
    marginTop: spacing.sm,
    gap: 8,
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    paddingVertical: 6,
  },
  subLabel: {
    color: colors.textTertiary,
    fontSize: 10,
    ...typography.label,
    marginTop: spacing.sm,
    marginBottom: 4,
  },
  row: {
    padding: spacing.sm + 2,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceElevated,
  },
  rowTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  rowName: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
  },
  statusPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.gold,
  },
  statusPillText: {
    color: colors.gold,
    fontSize: 9,
    ...typography.label,
  },
  rowBottomRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
  },
  rowAmount: {
    color: colors.text,
    fontSize: 13,
    ...typography.mono,
  },
  rowRemaining: {
    color: colors.textSecondary,
    fontSize: 11,
  },
  ttlRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 6,
  },
  ttlText: {
    color: colors.textTertiary,
    fontSize: 10,
    flex: 1,
  },
  ttlRefreshBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 7,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.gold,
    backgroundColor: colors.gold + "18",
    marginTop: 6,
  },
  ttlRefreshBtnText: {
    color: colors.gold,
    fontSize: 11,
    fontWeight: "700",
  },
  withdrawBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: radii.sm,
    backgroundColor: colors.cyanMuted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.cyan,
    marginTop: 6,
    minHeight: 36,
  },
  withdrawBtnText: {
    color: colors.cyan,
    fontSize: 12,
    fontWeight: "800",
  },
  newBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.gold + "60",
    backgroundColor: colors.gold + "10",
    marginTop: 4,
  },
  newBtnText: {
    color: colors.gold,
    fontSize: 12,
    fontWeight: "700",
  },
});
