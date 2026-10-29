import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { useToast } from "@/src/components/Toast";
import { useSession } from "@/src/state/session";
import { shortenAddress } from "@/src/wallet/stellar";
import { colors, radii, spacing, tileShadow, typography } from "@/src/theme";
import {
  ADVANCED_VAULT_KIND_META,
  VESTING_INTERVAL_SECONDS,
  cancelWithdrawal,
  computeVestedClaimable,
  deriveHtlcStatusFromAdvancedVault,
  getAdvancedNetworkName,
  humanizeAdvancedError,
  initiateWithdrawal,
  loadVestingMeta,
  ping,
  stringifyRpcError,
  stroopsToFloat,
  withdrawAdvancedVault,
  withdrawVested,
  type AdvancedVaultRecord,
  type VestingInterval,
} from "@/src/wallet/advanced-vaults";

const ACCENT = colors.cyan;

// Can fail to mount on a brand-new wallet's first render (self-heals after refresh).
class AdvancedVaultsBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: unknown) {
    if (__DEV__) console.warn("[advanced-vaults] section render error", error);
  }
  render() {
    if (this.state.hasError) {
      return (
        <TouchableOpacity
          style={s.errorFallback}
          onPress={() => this.setState({ hasError: false })}
          testID="dashboard-advanced-vaults-section"
          activeOpacity={0.85}
        >
          <Feather name="refresh-cw" size={13} color={ACCENT} />
          <Text style={s.errorFallbackText}>
            Advanced Vaults hit a snag loading — tap to retry.
          </Text>
        </TouchableOpacity>
      );
    }
    return this.props.children;
  }
}

export function AdvancedVaultsSection(props: {
  vaults: AdvancedVaultRecord[];
  loading: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  onChanged?: () => void;
}) {
  return (
    <AdvancedVaultsBoundary>
      <AdvancedVaultsSectionInner {...props} />
    </AdvancedVaultsBoundary>
  );
}

function AdvancedVaultsSectionInner({
  vaults,
  loading,
  expanded,
  onToggleExpanded,
  onChanged,
}: {
  vaults: AdvancedVaultRecord[];
  loading: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  /** Fires after any successful on-chain action so the parent can re-fetch. */
  onChanged?: () => void;
}) {
  const router = useRouter();
  const activeVaults = vaults.filter((v) => !v.withdrawn);
  return (
    <View style={s.wrap} testID="dashboard-advanced-vaults-section">
      <TouchableOpacity
        style={s.headerRow}
        onPress={onToggleExpanded}
        activeOpacity={0.85}
        testID="dashboard-advanced-vaults-header"
        accessibilityRole="button"
        accessibilityState={{ expanded }}
      >
        <View style={s.headerIcon}>
          <Feather name="shield" size={13} color={ACCENT} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={s.titleRow}>
            <Text style={s.headerTitle}>ADVANCED VAULTS</Text>
            <View style={s.betaPill}>
              <Text style={s.betaPillText}>
                {getAdvancedNetworkName() === "mainnet" ? "Beta · Live" : "Beta · Testnet"}
              </Text>
            </View>
          </View>
          <Text style={s.headerSubtitle}>
            {loading
              ? "Checking on-chain…"
              : activeVaults.length === 0
                ? "No advanced vaults yet"
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
        <View style={s.body}>
          {loading ? (
            <Text style={s.emptyText}>Loading advanced vaults…</Text>
          ) : vaults.length === 0 ? (
            <Text style={s.emptyText}>
              {getAdvancedNetworkName() === "mainnet"
                ? "Cooling-Off, Vesting Schedule, Dead Man\u2019s Switch, Multi-Sig, and HTLC vaults you create will appear here. Multi-party vaults are discovered via Stellar memos — no server required."
                : "Cooling-Off, Vesting Schedule, Dead Man\u2019s Switch, Multi-Sig, and HTLC vaults you create will appear here. These run on Stellar Testnet while the feature is in beta \u2014 no real funds are at risk."}
            </Text>
          ) : (
            activeVaults.map((v) => (
              <AdvancedVaultRow
                key={`${v.kind}-${v.vaultId.toString()}`}
                vault={v}
                onChanged={onChanged}
              />
            ))
          )}
          <TouchableOpacity
            onPress={() => router.push("/create-vault?tab=advanced")}
            style={s.newBtn}
            activeOpacity={0.85}
            testID="dashboard-advanced-vaults-new"
          >
            <Feather name="plus" size={13} color={ACCENT} />
            <Text style={s.newBtnText}>New advanced vault</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

function shortenAdvancedAddress(addr: string, prefix = 4, suffix = 4): string {
  if (addr.length <= prefix + suffix + 3) return addr;
  return `${addr.slice(0, prefix)}…${addr.slice(-suffix)}`;
}

function AdvancedVaultRow({
  vault,
  onChanged,
}: {
  vault: AdvancedVaultRecord;
  onChanged?: () => void;
}) {
  const toast = useToast();
  const { wallet } = useSession();
  const [busy, setBusy] = useState(false);
  const nowSec = Math.floor(Date.now() / 1000);
  const amountFloat = stroopsToFloat(vault.balance);
  const meta =
    vault.kind === "TimeLock"
      ? { label: "Time-Lock", icon: "lock" as const, accent: colors.cyan }
      : ADVANCED_VAULT_KIND_META[vault.kind];

  const requireSeed = (): boolean => {
    if (!wallet?.secretSeed) {
      toast.show("Import your seed phrase to sign this transaction.", "error");
      return false;
    }
    return true;
  };

  const runAction = async (fn: () => Promise<{ ok: boolean; error?: string }>, successMsg: string) => {
    if (busy || !requireSeed()) return;
    setBusy(true);
    try {
      const res = await fn();
      if (res.ok) {
        toast.show(successMsg, "success");
        onChanged?.();
      } else {
        toast.show(res.error || "Action failed.", "error");
      }
    } catch (e) {
      const raw = stringifyRpcError(e);
      toast.show(humanizeAdvancedError(raw), "error");
    } finally {
      setBusy(false);
    }
  };

  const ownerShort = vault.isBeneficiary
    ? shortenAdvancedAddress(vault.owner)
    : "";

  return (
    <View style={s.row} testID={`dashboard-advanced-vault-${vault.kind}-${vault.vaultId}`}>
      <View style={s.rowTopRow}>
        <View style={[s.kindIcon, { backgroundColor: meta.accent + "20", borderColor: meta.accent + "60" }]}>
          <Feather name={meta.icon} size={12} color={meta.accent} />
        </View>
        <Text style={s.rowName} numberOfLines={1}>
          {vault.name || `Vault #${vault.vaultId.toString()}`}
        </Text>
        {vault.isBeneficiary ? (
          <View style={s.beneficiaryPill} testID={`advanced-vault-beneficiary-pill-${vault.vaultId}`}>
            <Feather name="user-check" size={10} color={colors.gold} />
            <Text style={s.beneficiaryPillText}>BENEFICIARY OF</Text>
          </View>
        ) : (
          <Text style={[s.kindLabel, { color: meta.accent }]}>{meta.label}</Text>
        )}
      </View>

      <View style={s.rowBottomRow}>
        <Text style={s.rowAmount}>
          {amountFloat.toLocaleString(undefined, { maximumFractionDigits: 4 })} XLM
        </Text>
      </View>

      {vault.isBeneficiary ? (
        <>
          <Text style={s.beneficiaryOwnerHint} numberOfLines={1}>
            Owner {ownerShort}
          </Text>
          {/* Show a simplified beneficiary body — the beneficiary can only
              claim (backup_withdraw) once the inactivity period has elapsed.
              We still show status so they know if the vault is claimable. */}
          {vault.kind === "DeadManSwitch" ? (
            <BeneficiaryDeadManSwitchBody vault={vault} nowSec={nowSec} />
          ) : null}
        </>
      ) : vault.kind === "CoolingOff" ? (
        <CoolingOffBody vault={vault} nowSec={nowSec} busy={busy} runAction={runAction} />
      ) : vault.kind === "Vesting" ? (
        <VestingBody vault={vault} nowSec={nowSec} busy={busy} onChanged={onChanged} toast={toast} wallet={wallet} setBusy={setBusy} />
      ) : vault.kind === "DeadManSwitch" ? (
        <DeadManSwitchBody vault={vault} nowSec={nowSec} busy={busy} runAction={runAction} />
      ) : vault.kind === "HTLC" ? (
        <HtlcBody vault={vault} nowSec={nowSec} />
      ) : null}
    </View>
  );
}

function HtlcBody({
  vault,
  nowSec,
}: {
  vault: AdvancedVaultRecord;
  nowSec: number;
}) {
  const router = useRouter();
  const life = deriveHtlcStatusFromAdvancedVault(vault, nowSec);
  const statusLine =
    life === "claimed"
      ? "Claimed"
      : life === "refunded"
        ? "Refunded"
        : life === "expired"
          ? "Expired — refundable"
          : life === "claimable"
            ? "Claimable with secret"
            : "HTLC locked";
  return (
    <View style={s.htlcBody}>
      <Text style={s.statusHint}>{statusLine}</Text>
      <View style={s.actionRow}>
        <ActionBtn
          label="Open HTLC"
          icon="link"
          busy={false}
          onPress={() => router.push(`/htlc/${vault.vaultId.toString()}` as never)}
        />
      </View>
    </View>
  );
}

/**
 * Simplified body for beneficiary-view DMS vaults. Shows the inactivity
 * deadline status without exposing owner-only actions like "Ping".
 */
function BeneficiaryDeadManSwitchBody({
  vault,
  nowSec,
}: {
  vault: AdvancedVaultRecord;
  nowSec: number;
}) {
  const { wallet } = useSession();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const deadline = vault.lastPingTimestamp + vault.inactivityPeriodSeconds;
  const secondsLeft = deadline - nowSec;
  const overdue = secondsLeft <= 0;

  const handleBackupClaim = async () => {
    if (busy || !wallet?.secretSeed) {
      if (!wallet?.secretSeed) toast.show("Import your seed phrase to sign this transaction.", "error");
      return;
    }
    setBusy(true);
    try {
      const { backupWithdraw, stringifyRpcError, humanizeAdvancedError } = await import(
        "@/src/wallet/advanced-vaults"
      );
      const res = await backupWithdraw({
        backupPublicKey: wallet.publicKey,
        backupSecretSeed: wallet.secretSeed,
        vaultId: vault.vaultId,
      });
      if (res.ok) {
        toast.show("Vault claimed successfully.", "success");
      } else {
        toast.show(res.error || "Claim failed.", "error");
      }
    } catch (e) {
      const raw = stringifyRpcError(e);
      toast.show(humanizeAdvancedError(raw), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <View style={s.statusLine}>
        <Feather
          name={overdue ? "alert-triangle" : "heart"}
          size={11}
          color={overdue ? colors.gold : colors.textTertiary}
        />
        <Text style={[s.statusLineText, overdue && { color: colors.gold }]}>
          {overdue
            ? "Overdue — you can claim this vault"
            : `Owner check-in due in ${formatShortDuration(secondsLeft)}`}
        </Text>
      </View>
      <View style={s.actionRow}>
        <ActionBtn
          label={overdue ? "Claim this vault" : "Can't claim yet"}
          icon="user-check"
          busy={busy}
          disabled={!overdue}
          onPress={handleBackupClaim}
          variant={overdue ? "primary" : "secondary"}
        />
      </View>
    </>
  );
}

function CoolingOffBody({
  vault,
  nowSec,
  busy,
  runAction,
}: {
  vault: AdvancedVaultRecord;
  nowSec: number;
  busy: boolean;
  runAction: (fn: () => Promise<{ ok: boolean; error?: string }>, successMsg: string) => void;
}) {
  const { wallet } = useSession();
  const notInitiated = vault.withdrawalInitiatedTimestamp === 0;
  const readyAt = vault.withdrawalInitiatedTimestamp + vault.coolingOffDurationSeconds;
  const isReady = !notInitiated && nowSec >= readyAt;
  const isCooling = !notInitiated && !isReady;

  return (
    <>
      <View style={s.statusLine}>
        <Feather
          name={isReady ? "unlock" : isCooling ? "clock" : "shield"}
          size={11}
          color={isReady ? colors.success : isCooling ? colors.warning : colors.textTertiary}
        />
        <Text style={s.statusLineText}>
          {isReady
            ? "Cooling-Off complete — ready to withdraw"
            : isCooling
              ? `Cooling-Off — ready in ${formatShortDuration(readyAt - nowSec)}`
              : "No withdrawal in progress"}
        </Text>
      </View>
      <View style={s.actionRow}>
        {notInitiated ? (
          <ActionBtn
            label="Start withdrawal"
            icon="play"
            busy={busy}
            onPress={() =>
              wallet &&
              runAction(
                () => initiateWithdrawal({ ownerPublicKey: wallet.publicKey, ownerSecretSeed: wallet.secretSeed!, vaultId: vault.vaultId }),
                "Withdrawal started. Cancel any time before it completes.",
              )
            }
          />
        ) : isCooling ? (
          <ActionBtn
            label="Cancel withdrawal"
            icon="x-circle"
            variant="danger"
            busy={busy}
            onPress={() =>
              wallet &&
              runAction(
                () => cancelWithdrawal({ ownerPublicKey: wallet.publicKey, ownerSecretSeed: wallet.secretSeed!, vaultId: vault.vaultId }),
                "Withdrawal cancelled. Funds stay locked.",
              )
            }
          />
        ) : (
          <ActionBtn
            label="Withdraw"
            icon="unlock"
            busy={busy}
            onPress={() =>
              wallet &&
              runAction(
                () => withdrawAdvancedVault({ ownerPublicKey: wallet.publicKey, ownerSecretSeed: wallet.secretSeed!, vaultId: vault.vaultId }),
                "Withdrawn successfully.",
              )
            }
          />
        )}
      </View>
    </>
  );
}

function VestingBody({
  vault,
  nowSec,
  busy,
  onChanged,
  toast,
  wallet,
  setBusy,
}: {
  vault: AdvancedVaultRecord;
  nowSec: number;
  busy: boolean;
  onChanged?: () => void;
  toast: ReturnType<typeof useToast>;
  wallet: ReturnType<typeof useSession>["wallet"];
  setBusy: (b: boolean) => void;
}) {
  const [interval, setInterval] = useState<VestingInterval | null>(null);
  useEffect(() => {
    loadVestingMeta(vault.vaultId).then((m) => { if (m) setInterval(m.interval); });
  }, [vault.vaultId]);

  const intervalSec = interval ? VESTING_INTERVAL_SECONDS[interval] : undefined;
  const total = vault.totalLockedAmount;
  const duration = Math.max(1, vault.vestingEndTimestamp - vault.vestingStartTimestamp);
  const elapsed = Math.min(duration, Math.max(0, nowSec - vault.vestingStartTimestamp));
  const percent = total > 0n ? Math.min(100, Math.round((elapsed / duration) * 100)) : 0;
  const claimable = computeVestedClaimable(vault, nowSec, intervalSec);
  const claimableFloat = stroopsToFloat(claimable);
  const totalFloat = stroopsToFloat(total);
  const vestedSoFarFloat = stroopsToFloat(vault.withdrawnSoFar) + claimableFloat;

  const notStartedYet = nowSec < vault.vestingStartTimestamp;
  const startsIn = vault.vestingStartTimestamp - nowSec;

  const handleWithdraw = async () => {
    if (busy || !wallet?.secretSeed) {
      if (!wallet?.secretSeed) toast.show("Import your seed phrase to sign this transaction.", "error");
      return;
    }
    setBusy(true);
    try {
      // Use discrete-interval amount, not on-chain linear — discrete is always ≤ linear.
      const amount = claimable;
      if (amount <= 0n) {
        toast.show("Nothing has unlocked yet.", "info");
        return;
      }
      const res = await withdrawVested({
        ownerPublicKey: wallet.publicKey,
        ownerSecretSeed: wallet.secretSeed,
        vaultId: vault.vaultId,
        amount,
      });
      if (res.ok) {
        toast.show(`Withdrew ${stroopsToFloat(amount).toLocaleString(undefined, { maximumFractionDigits: 4 })} XLM.`, "success");
        onChanged?.();
      } else {
        toast.show(res.error || "Withdrawal failed.", "error");
      }
    } catch (e) {
      const raw = stringifyRpcError(e);
      toast.show(humanizeAdvancedError(raw), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <View style={s.progressTrack}>
        <View style={[s.progressFill, { width: `${percent}%` }]} />
      </View>
      {notStartedYet ? (
        <Text style={s.statusLineText}>
          Vesting starts in {formatShortDuration(startsIn)}
          {interval ? ` · ${interval} unlocks` : ""}
        </Text>
      ) : (
        <Text style={s.statusLineText}>
          {vestedSoFarFloat.toLocaleString(undefined, { maximumFractionDigits: 4 })} of{" "}
          {totalFloat.toLocaleString(undefined, { maximumFractionDigits: 4 })} XLM unlocked ({percent}%)
          {interval ? ` · ${interval}` : ""}
        </Text>
      )}
      <View style={s.actionRow}>
        <ActionBtn
          label={
            notStartedYet
              ? "Not started yet"
              : claimable > 0n && claimableFloat < 0.01
                ? "Withdraw <0.01 XLM"
                : `Withdraw ${claimableFloat.toLocaleString(undefined, { maximumFractionDigits: 2 })} XLM`
          }
          icon="download"
          busy={busy}
          disabled={claimable <= 0n}
          onPress={handleWithdraw}
        />
      </View>
    </>
  );
}

function DeadManSwitchBody({
  vault,
  nowSec,
  busy,
  runAction,
}: {
  vault: AdvancedVaultRecord;
  nowSec: number;
  busy: boolean;
  runAction: (fn: () => Promise<{ ok: boolean; error?: string }>, successMsg: string) => void;
}) {
  const { wallet } = useSession();
  const deadline = vault.lastPingTimestamp + vault.inactivityPeriodSeconds;
  const secondsLeft = deadline - nowSec;
  const overdue = secondsLeft <= 0;

  return (
    <>
      <View style={s.statusLine}>
        <Feather
          name={overdue ? "alert-triangle" : "heart"}
          size={11}
          color={overdue ? colors.danger : colors.textTertiary}
        />
        <Text style={[s.statusLineText, overdue && { color: colors.danger }]}>
          {overdue
            ? "Overdue — backup address can now claim this vault"
            : `Next check-in due in ${formatShortDuration(secondsLeft)}`}
        </Text>
      </View>
      {vault.backupAddress ? (
        <Text style={s.backupText} numberOfLines={1}>
          Backup: {shortenAddress(vault.backupAddress, 6, 6)}
        </Text>
      ) : null}
      <View style={s.actionRow}>
        <ActionBtn
          label="Ping (I'm here)"
          icon="heart"
          busy={busy}
          onPress={() =>
            wallet &&
            runAction(
              () => ping({ ownerPublicKey: wallet.publicKey, ownerSecretSeed: wallet.secretSeed!, vaultId: vault.vaultId }),
              "Checked in. Countdown reset.",
            )
          }
        />
        <ActionBtn
          label="Withdraw"
          icon="unlock"
          variant="secondary"
          busy={busy}
          onPress={() =>
            wallet &&
            runAction(
              () => withdrawAdvancedVault({ ownerPublicKey: wallet.publicKey, ownerSecretSeed: wallet.secretSeed!, vaultId: vault.vaultId }),
              "Withdrawn successfully.",
            )
          }
        />
      </View>
    </>
  );
}

function ActionBtn({
  label,
  icon,
  busy,
  disabled,
  variant = "primary",
  onPress,
}: {
  label: string;
  icon: keyof typeof Feather.glyphMap;
  busy: boolean;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger";
  onPress: () => void;
}) {
  const isDisabled = busy || disabled;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.85}
      style={[
        s.actionBtn,
        variant === "danger" && s.actionBtnDanger,
        variant === "secondary" && s.actionBtnSecondary,
        isDisabled && { opacity: 0.5 },
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={colors.textInverse} />
      ) : (
        <>
          <Feather
            name={icon}
            size={12}
            color={variant === "secondary" ? colors.text : colors.textInverse}
          />
          <Text style={[s.actionBtnText, variant === "secondary" && { color: colors.text }]}>
            {label}
          </Text>
        </>
      )}
    </TouchableOpacity>
  );
}

function formatShortDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "now";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  }
  const days = Math.floor(seconds / 86400);
  const hrs = Math.floor((seconds % 86400) / 3600);
  return hrs === 0 ? `${days}d` : `${days}d ${hrs}h`;
}

const s = StyleSheet.create({
  beneficiaryPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.gold + "22",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.gold,
  },
  beneficiaryPillText: {
    color: colors.gold,
    fontSize: 9,
    fontWeight: "800",
  },
  beneficiaryOwnerHint: {
    color: colors.textTertiary,
    fontSize: 10,
    marginTop: 4,
    ...typography.mono,
  },
  errorFallback: {
    marginTop: spacing.xl,
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: ACCENT + "40",
    backgroundColor: colors.surfaceFrost,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    ...tileShadow(),
  },
  errorFallbackText: { color: colors.textSecondary, fontSize: 12, flex: 1 },
  wrap: {
    marginTop: spacing.xl,
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: ACCENT + "40",
    backgroundColor: colors.surfaceFrost,
    borderTopWidth: 2,
    borderTopColor: ACCENT,
    ...tileShadow(),
  },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  headerIcon: {
    width: 26,
    height: 26,
    borderRadius: radii.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: ACCENT + "18",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: ACCENT + "60",
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  headerTitle: { color: ACCENT, fontSize: 11, ...typography.label },
  betaPill: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radii.pill,
    backgroundColor: ACCENT + "22",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: ACCENT,
  },
  betaPillText: { color: ACCENT, fontSize: 8, fontWeight: "800", letterSpacing: 0.3 },
  headerSubtitle: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },
  body: { marginTop: spacing.sm, gap: 8 },
  emptyText: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, paddingVertical: 6 },
  row: {
    padding: spacing.sm + 2,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceFrost,
    ...tileShadow(),
  },
  rowTopRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  kindIcon: {
    width: 22,
    height: 22,
    borderRadius: radii.sm,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowName: { flex: 1, color: colors.text, fontSize: 13, fontWeight: "700" },
  kindLabel: { fontSize: 10, fontWeight: "700" },
  rowBottomRow: { flexDirection: "row", alignItems: "center", marginTop: 4 },
  rowAmount: { color: colors.text, fontSize: 13, ...typography.mono },
  statusLine: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  statusLineText: { color: colors.textSecondary, fontSize: 11, flex: 1 },
  backupText: { color: colors.textTertiary, fontSize: 10, marginTop: 4, ...typography.mono },
  progressTrack: {
    height: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.border,
    overflow: "hidden",
    marginTop: 8,
  },
  progressFill: { height: 6, backgroundColor: ACCENT, borderRadius: radii.pill },
  actionRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  htlcBody: { marginTop: 8, gap: 4 },
  statusHint: { color: colors.textSecondary, fontSize: 11, marginBottom: 4 },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 9,
    borderRadius: radii.sm,
    backgroundColor: ACCENT,
    minHeight: 36,
  },
  actionBtnDanger: { backgroundColor: colors.danger },
  actionBtnSecondary: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  actionBtnText: { color: colors.textInverse, fontSize: 11, fontWeight: "800" },
  newBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: ACCENT + "60",
    backgroundColor: ACCENT + "10",
    marginTop: 4,
  },
  newBtnText: { color: ACCENT, fontSize: 12, fontWeight: "700" },
});
