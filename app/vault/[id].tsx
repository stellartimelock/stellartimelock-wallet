import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ViewStyle,
  TextStyle,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { api, Transaction, Vault } from "@/src/api/client";
import { describeError } from "@/src/api/describe-error";
import { getVaultMeta, putVaultMeta, invalidateRpcCaches } from "@/src/api/soroban-client";
import { Button } from "@/src/components/Button";
import { Card } from "@/src/components/Card";
import { useToast } from "@/src/components/Toast";
import { useSession } from "@/src/state/session";
import { colors, radii, spacing, typography } from "@/src/theme";
import { VaultEditSheet, type VaultEditData } from "@/src/vault/VaultEditSheet";
import {
  countdownTo,
  formatTimestamp,
  formatUnlockDate,
} from "@/src/vault/countdown";
import { checkMonthlyDepositCap } from "@/src/vault/free-tier-caps";
import {
  getBetaVault,
  tokenSymbolForAddress,
  withdrawBetaVault,
  type BetaVaultRecord,
} from "@/src/wallet/multi-asset-beta";
import {
  ADVANCED_VAULT_KIND_META,
  VESTING_INTERVAL_SECONDS,
  backupWithdraw,
  cancelWithdrawal,
  computeVestedClaimable,
  getAdvancedVault,
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

const DAY_SEC = 86400;
const EXTEND_OPTIONS = [7, 30, 90, 365];

type SheetMode = "deposit" | "extend" | null;

function StandardVaultDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { wallet, formatXlm, formatFiat, rates } = useSession();

  const [vault, setVault] = useState<Vault | null>(null);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));
  const [sheet, setSheet] = useState<SheetMode>(null);
  const [editSheetOpen, setEditSheetOpen] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [busy, setBusy] = useState(false);

  // Optional withdrawal destination saved at create-time → "Send to [label]" CTA when unlocked.
  const [vaultMeta, setVaultMeta] = useState<{
    withdrawal_destination?: string;
    withdrawal_destination_label?: string;
    withdrawal_memo?: string;
    bill_id?: string;
    withdrawal_kind?: "send" | "swap";
    withdrawal_swap_ticker?: string;
  } | null>(null);

  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      // ownerHint resolves TTL-pruned vaults via backend meta when RPC retention expired.
      const [v, list] = await Promise.all([
        api.getVault(id, wallet?.publicKey),
        api.vaultTransactions(id),
      ]);
      setVault(v);
      setTxs(list);
      if (wallet?.publicKey) {
        try {
          const meta = await getVaultMeta(wallet.publicKey, id);
          if (meta) {
            setVaultMeta({
              withdrawal_destination: meta.withdrawal_destination,
              withdrawal_destination_label: meta.withdrawal_destination_label,
              withdrawal_memo: meta.withdrawal_memo,
              bill_id: meta.bill_id,
              withdrawal_kind: meta.withdrawal_kind,
              withdrawal_swap_ticker: meta.withdrawal_swap_ticker,
            });
          }
        } catch {
          // Non-fatal — the CTA simply won't render.
        }
      }
    } catch (e) {
      console.warn("[VaultDetail] load failed:", e);
      toast.show("Couldn't load this vault. Please try again.", "error");
    }
  }, [id, toast, wallet?.publicKey]);

  // Vault-index cross-contamination guard.
  //
  // The Soroban RPC layer maintains a SHARED event cache keyed by
  // (network, contract) — not by vault_id — for performance. When the
  // user back-buttons out of vault X and into vault Y in the same
  // session, stale ledger sequence data from X's last simulate can
  // briefly bleed into Y's countdown / balance render before the next
  // RPC refresh completes. The symptom users see is a "frozen 1970"
  // unlock date or a balance that flashes the wrong number for ~1s.
  //
  // Flush the cache the instant the `id` param flips, BEFORE `load()` runs.
  useEffect(() => {
    if (!id) return;
    invalidateRpcCaches();
  }, [id]);

  useEffect(() => {
    load();
    tickRef.current = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [load]);

  const cd = useMemo(() => {
    if (!vault) return null;
    return countdownTo(vault.unlock_timestamp, now);
  }, [vault, now]);

  if (!vault || !cd) {
    return (
<View style={styles.loading as ViewStyle} testID="vault-detail-loading">
        <ActivityIndicator color={colors.teal} />
      </View>
    );
  }

  const target = vault.target_amount ?? 0;
  const progress = target > 0 ? Math.min(1, vault.balance / target) : 0;
  const isLocked = vault.status === "locked";
  const isUnlocked = vault.status === "unlocked";
  const isWithdrawn = vault.status === "withdrawn";

  const onDeposit = async (amount: number) => {
    if (!wallet) return;
    try {
      setBusy(true);
      const depositCapMsg = await checkMonthlyDepositCap(
        wallet.publicKey,
        amount,
        rates.USD,
      );
      if (depositCapMsg) {
        toast.show(depositCapMsg, "error");
        setBusy(false);
        return;
      }
      toast.show("Submitting deposit on-chain…", "info");
      const updated = await api.deposit(vault.vault_id, wallet.publicKey, amount);
      setVault(updated);
      const list = await api.vaultTransactions(vault.vault_id);
      setTxs(list);
      setSheet(null);
      toast.show(`Deposited ${formatXlm(amount)}. Unlock date unchanged.`, "success");
    } catch (e) {
      const f = describeError(e);
      toast.show(f.message, "error", f.retryable ? { action: { label: "Retry", onPress: () => onDeposit(amount) } } : undefined);
    } finally {
      setBusy(false);
    }
  };

  const onExtend = async (days: number) => {
    if (!wallet) return;
    try {
      setBusy(true);
      toast.show("Submitting extend on-chain…", "info");
      const updated = await api.extend(
        vault.vault_id,
        wallet.publicKey,
        days * DAY_SEC
      );
      setVault(updated);
      const list = await api.vaultTransactions(vault.vault_id);
      setTxs(list);
      setSheet(null);
      toast.show(`Lock extended by ${days} days.`, "success");
    } catch (e) {
      const f = describeError(e);
      toast.show(f.message, "error", f.retryable ? { action: { label: "Retry", onPress: () => onExtend(days) } } : undefined);
    } finally {
      setBusy(false);
    }
  };

  const onWithdraw = async () => {
    if (!wallet) return;
    try {
      setBusy(true);
      toast.show("Submitting withdrawal on-chain…", "info");
      const amount = vault.balance;
      const updated = await api.withdraw(vault.vault_id, wallet.publicKey);
      setVault(updated);
      const list = await api.vaultTransactions(vault.vault_id);
      setTxs(list);
      toast.show(`Withdrawn ${formatXlm(amount)} to your wallet.`, "success");
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      // Auto-heal ghost vaults: mark meta withdrawn when on-chain entry is gone.
      const isGhost = /not\s+live|no\s+such\s+entry|insufficient\s+balance|zero\s+balance|already\s+withdrawn|entry\s+not\s+found/i.test(
        raw,
      );
      if (isGhost) {
        try {
          const { dismissVaultMeta } = await import(
            "@/src/api/soroban-client"
          );
          await dismissVaultMeta(wallet.publicKey, vault.vault_id);
        } catch {
          // best-effort — the reload below still helps
        }
        toast.show(
          "This vault had no on-chain balance — marked as withdrawn.",
          "info",
        );
        await load();
        return;
      }
      const f = describeError(e);
      toast.show(f.message, "error", f.retryable ? { action: { label: "Retry", onPress: () => onWithdraw() } } : undefined);
    } finally {
      setBusy(false);
    }
  };

  // Manual dismiss for ghost vaults (zero balance or already archived).
  const canDismiss =
    (vault.balance === 0 && vault.status !== "locked") ||
    vault.status === "archived";
  const onSaveEdit = async (data: VaultEditData) => {
    if (!wallet || !vault) return;
    try {
      setEditBusy(true);
      await putVaultMeta(wallet.publicKey, vault.vault_id, {
        name: data.name,
        backup_address: data.backupAddress,
      });
      // Also update local state so the UI reflects changes immediately.
      setVault((prev) => prev ? { ...prev, name: data.name, backup_address: data.backupAddress } : prev);
      setEditSheetOpen(false);
      toast.show("Vault updated.", "success");
    } catch (e) {
      console.warn("[VaultDetail] save edit failed:", e);
      toast.show("Couldn't save vault changes. Please try again.", "error");
    } finally {
      setEditBusy(false);
    }
  };

  const onDismiss = () => {
    if (!wallet) return;
    Alert.alert(
      "Dismiss this vault?",
      "Marks the vault as withdrawn in your history. Only do this if it has no on-chain balance and you want it removed from the dashboard.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Dismiss",
          style: "destructive",
          onPress: async () => {
            try {
              const { dismissVaultMeta } = await import(
                "@/src/api/soroban-client"
              );
              const ok = await dismissVaultMeta(
                wallet.publicKey,
                vault.vault_id,
              );
              if (ok) {
                toast.show("Vault dismissed.", "success");
                router.back();
              } else {
                toast.show(
                  "Could not reach the backend. Try again in a moment.",
                  "error",
                );
              }
            } catch (err) {
              console.warn("[VaultDetail] dismiss failed:", err);
              toast.show("Couldn't dismiss this vault. Please try again.", "error");
            }
          },
        },
      ],
    );
  };

  return (
   <SafeAreaView edges={["top"]} style={styles.root as ViewStyle} testID="vault-detail-screen">
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.back}
          testID="vault-detail-back"
        >
          <Feather name="arrow-left" size={22} color={colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {vault.name}
          </Text>
          <Text style={styles.headerSub}>{formatUnlockDate(vault.unlock_timestamp)}</Text>
        </View>
        <TouchableOpacity
          onPress={() => setEditSheetOpen(true)}
          style={styles.editBtn}
          testID="vault-detail-edit"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather name="edit-3" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
      >
        <Card status={vault.status} padded style={styles.hero}>
          <View style={styles.rowBetween}>
            <View
              style={[
                styles.typeBadge,
                { borderColor: colors.teal + "60", backgroundColor: colors.teal + "18" },
              ]}
            >
              <Feather name="lock" size={11} color={colors.teal} />
              <Text style={[styles.typeBadgeText, { color: colors.teal }]}>
                Standard Vault
              </Text>
            </View>
            <View style={styles.statusPill(vault.status)}>
              <Feather
                name={isLocked ? "lock" : isUnlocked ? "unlock" : "check"}
                size={11}
                color={isLocked ? colors.teal : isUnlocked ? colors.gold : colors.textTertiary}
              />
              <Text
                style={[
                  styles.statusText,
                  { color: isLocked ? colors.teal : isUnlocked ? colors.gold : colors.textTertiary },
                ]}
              >
                {vault.status}
              </Text>
            </View>
          </View>

          <Text style={[styles.eyebrow, { marginTop: spacing.md }]}>
            {isLocked ? "TIME UNTIL UNLOCK" : isUnlocked ? "READY TO WITHDRAW" : "WITHDRAWN"}
          </Text>

          {!isWithdrawn ? (
            cd.expired ? (
              <Text style={styles.unlockedHero}>Unlocked</Text>
            ) : (
              <View style={styles.countdownRow}>
                <TimeUnit value={cd.years} label="yr" />
                <TimeUnit value={cd.months} label="mo" />
                <TimeUnit value={cd.days} label="d" />
                <TimeUnit value={cd.hours} label="h" />
              </View>
            )
          ) : (
            <Text style={styles.unlockedHero}>Closed</Text>
          )}

          <View style={styles.balanceBlock}>
            <Text style={styles.balLabel}>VAULT BALANCE</Text>
            <Text testID="vault-detail-balance" style={styles.balValue}>
              {formatXlm(vault.balance)}
            </Text>
            <Text style={styles.balFiat}>{formatFiat(vault.balance)}</Text>
          </View>

          {target > 0 ? (
            <>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
              </View>
              <Text style={styles.progressText}>
                {Math.round(progress * 100)}% of {formatXlm(target)} target
              </Text>
            </>
          ) : null}
        </Card>

        {vault.description ? (
          <Card padded style={{ marginTop: spacing.md }}>
            <Text style={styles.eyebrow}>NOTE</Text>
            <Text style={styles.note}>{vault.description}</Text>
          </Card>
        ) : null}

        <Text style={styles.section}>ACTIONS</Text>
        {/* Add Funds and Extend Lock are intentionally separate.
            Adding funds NEVER moves the unlock date; extending the lock NEVER
            moves funds. Both are enforced by the Soroban contract + backend. */}
        <View style={styles.actionsRow}>
          <ActionButton
            testID="vault-action-deposit"
            label="Add funds"
            icon="plus"
            onPress={() => setSheet("deposit")}
            disabled={isWithdrawn}
          />
          <ActionButton
            testID="vault-action-extend"
            label="Extend lock"
            icon="fast-forward"
            onPress={() => setSheet("extend")}
            disabled={isWithdrawn}
          />
          <ActionButton
            testID="vault-action-withdraw"
            label="Withdraw"
            icon="arrow-up-right"
            onPress={onWithdraw}
            disabled={!isUnlocked || busy}
            primary
          />
        </View>

        {isUnlocked && vaultMeta?.withdrawal_destination ? (
          <TouchableOpacity
            testID="vault-action-send-to-saved"
            onPress={() => {
              router.push({
                pathname: "/send",
                params: {
                  to: vaultMeta.withdrawal_destination!,
                  amount: String(vault.balance),
                  ...(vaultMeta.withdrawal_memo
                    ? { memo: vaultMeta.withdrawal_memo }
                    : {}),
                  ...(vaultMeta.withdrawal_destination_label
                    ? { contact: vaultMeta.withdrawal_destination_label }
                    : {}),
                },
              });
            }}
            activeOpacity={0.85}
            style={styles.sendToBtn}
          >
            <Feather name="send" size={16} color={colors.textInverse} />
            <Text style={styles.sendToBtnText} numberOfLines={1}>
              Send to {vaultMeta.withdrawal_destination_label?.trim() ||
                shortenAddress(vaultMeta.withdrawal_destination)}
            </Text>
            <Feather
              name="chevron-right"
              size={16}
              color={colors.textInverse}
            />
          </TouchableOpacity>
        ) : null}

        {isUnlocked &&
        vaultMeta?.withdrawal_kind === "swap" &&
        vaultMeta.withdrawal_swap_ticker ? (
          <TouchableOpacity
            testID="vault-action-swap-to-saved"
            onPress={() => {
              router.push({
                pathname: "/swap",
                params: {
                  amount: String(vault.balance),
                  toCurrency: vaultMeta.withdrawal_swap_ticker!,
                },
              });
            }}
            activeOpacity={0.85}
            style={styles.sendToBtn}
          >
            <Feather name="repeat" size={16} color={colors.textInverse} />
            <Text style={styles.sendToBtnText} numberOfLines={1}>
              Swap {vault.balance} XLM →{" "}
              {vaultMeta.withdrawal_swap_ticker.toUpperCase()}
            </Text>
            <Feather
              name="chevron-right"
              size={16}
              color={colors.textInverse}
            />
          </TouchableOpacity>
        ) : null}

        {canDismiss ? (
          <TouchableOpacity
            testID="vault-action-dismiss"
            onPress={onDismiss}
            style={styles.dismissBtn}
            activeOpacity={0.7}
          >
            <Feather name="archive" size={14} color={colors.textSecondary} />
            <Text style={styles.dismissBtnText}>Dismiss this vault</Text>
          </TouchableOpacity>
        ) : null}

        <Text style={styles.section}>VAULT ACTIVITY</Text>
        <Card padded style={{ paddingVertical: 0 }}>
          {txs.length === 0 ? (
            <Text style={[styles.note, { textAlign: "center", paddingVertical: spacing.md }]}>
              No transactions yet.
            </Text>
          ) : (
            txs.map((t, i) => (
              <View
                key={t.tx_id}
                style={[styles.txRow, i < txs.length - 1 && styles.txRowDivider]}
                testID={`vault-tx-${t.tx_id}`}
              >
                <Feather
                  name={
                    t.kind === "create"
                      ? "plus-square"
                      : t.kind === "deposit"
                      ? "arrow-down-left"
                      : t.kind === "extend"
                      ? "fast-forward"
                      : "arrow-up-right"
                  }
                  size={14}
                  color={colors.teal}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.txKind}>
                    {t.kind === "create"
                      ? "Created"
                      : t.kind === "deposit"
                      ? "Deposit"
                      : t.kind === "extend"
                      ? "Extended"
                      : "Withdrawal"}
                  </Text>
                  <Text style={styles.txTime}>{formatTimestamp(t.timestamp)}</Text>
                </View>
                {t.amount > 0 ? (
                  <Text style={styles.txAmount}>
                    {t.kind === "withdraw" ? "-" : "+"}
                    {formatXlm(t.amount)}
                  </Text>
                ) : (
                  <Text style={styles.txNote}>{t.note}</Text>
                )}
              </View>
            ))
          )}
        </Card>

        <Card padded style={{ marginTop: spacing.md }}>
          <Text style={styles.eyebrow}>CONTRACT RULES</Text>
          <Rule text="Only the owner address can deposit or withdraw." />
          <Rule text="Deposits never reset the unlock timestamp." />
          <Rule text="Extensions only — locks can never be shortened." />
          <Rule text="Withdrawal is blocked on-chain until the unlock timestamp." />
        </Card>
      </ScrollView>

      <VaultEditSheet
        visible={editSheetOpen}
        initialName={vault.name}
        initialBackupAddress={vault.backup_address ?? null}
        onClose={() => setEditSheetOpen(false)}
        onSave={onSaveEdit}
        busy={editBusy}
      />

      <DepositSheet
        visible={sheet === "deposit"}
        onClose={() => setSheet(null)}
        onConfirm={onDeposit}
        busy={busy}
      />
      <ExtendSheet
        visible={sheet === "extend"}
        onClose={() => setSheet(null)}
        onConfirm={onExtend}
        busy={busy}
      />
    </SafeAreaView>
  );
}

// Vault-detail route dispatcher: type query param selects standard / multi-asset / advanced renderer.
export default function VaultDetail() {
  const { type } = useLocalSearchParams<{ id: string; type?: string }>();
  if (type === "multi-asset") {
    return <MultiAssetVaultDetail />;
  }
  if (type === "advanced") {
    return <AdvancedVaultDetail />;
  }
  return <StandardVaultDetail />;
}

// Multi-asset BETA vault detail (Mainnet contract, on-chain-only).
function MultiAssetVaultDetail() {
  const { id } = useLocalSearchParams<{ id: string; type?: string }>();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { wallet } = useSession();

  const [vault, setVault] = useState<BetaVaultRecord | null>(null);
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id || !wallet?.publicKey) return;
    try {
      const v = await getBetaVault(wallet.publicKey, BigInt(id));
      if (v) {
        setVault(v);
      } else {
        toast.show(
          "This multi-asset vault could not be found on-chain.",
          "error",
        );
      }
    } catch (e) {
      console.warn("[VaultDetail] multi-asset load failed:", e);
      toast.show("Couldn't load this vault. Please try again.", "error");
    }
  }, [id, wallet?.publicKey, toast]);

  useEffect(() => {
    load();
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, [load]);

  if (!vault) {
    return (
      <View style={styles.loading as ViewStyle} testID="vault-detail-loading">
        <ActivityIndicator color={colors.gold} />
      </View>
    );
  }

  const symbol = tokenSymbolForAddress(vault.tokenContractId) ?? "TOKEN";
  const amountFloat = Number(vault.balance) / 10_000_000;
  const isWithdrawn = vault.withdrawn;
  const isUnlocked = !isWithdrawn && vault.unlockTimestamp <= now;
  const isLocked = !isWithdrawn && !isUnlocked;
  const status: Vault["status"] = isWithdrawn
    ? "withdrawn"
    : isLocked
      ? "locked"
      : "unlocked";
  const cd = countdownTo(vault.unlockTimestamp, now);

  const onWithdraw = async () => {
    if (!wallet?.secretSeed) {
      toast.show(
        "Import your seed phrase to sign withdrawal transactions.",
        "error",
      );
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
        await load();
      } else {
        toast.show(res.error || "Withdrawal failed.", "error");
      }
    } catch (e) {
      console.warn("[VaultDetail] multi-asset withdraw failed:", e);
      toast.show("Withdrawal failed. Please try again.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView edges={["top"]} style={styles.root} testID="vault-detail-screen">
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.back}
          testID="vault-detail-back"
        >
          <Feather name="arrow-left" size={22} color={colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {vault.name || `Multi-Asset Vault #${vault.vaultId.toString()}`}
          </Text>
          <Text style={styles.headerSub}>{formatUnlockDate(vault.unlockTimestamp)}</Text>
        </View>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
      >
        <Card status={status} padded style={styles.hero}>
          <View style={styles.rowBetween}>
            <View
              style={[
                styles.typeBadge,
                { borderColor: colors.gold + "60", backgroundColor: colors.gold + "18" },
              ]}
            >
              <Feather name="layers" size={11} color={colors.gold} />
              <Text style={[styles.typeBadgeText, { color: colors.gold }]}>
                Multi-Asset · {symbol}
              </Text>
            </View>
            <View style={styles.statusPill(status)}>
              <Feather
                name={isLocked ? "lock" : isUnlocked ? "unlock" : "check"}
                size={11}
                color={isLocked ? colors.teal : isUnlocked ? colors.gold : colors.textTertiary}
              />
              <Text
                style={[
                  styles.statusText,
                  { color: isLocked ? colors.teal : isUnlocked ? colors.gold : colors.textTertiary },
                ]}
              >
                {status}
              </Text>
            </View>
          </View>

          <Text style={[styles.eyebrow, { marginTop: spacing.md }]}>
            {isLocked ? "TIME UNTIL UNLOCK" : isUnlocked ? "READY TO WITHDRAW" : "WITHDRAWN"}
          </Text>

          {!isWithdrawn ? (
            cd.expired ? (
              <Text style={styles.unlockedHero}>Unlocked</Text>
            ) : (
              <View style={styles.countdownRow}>
                <TimeUnit value={cd.years} label="yr" />
                <TimeUnit value={cd.months} label="mo" />
                <TimeUnit value={cd.days} label="d" />
                <TimeUnit value={cd.hours} label="h" />
              </View>
            )
          ) : (
            <Text style={styles.unlockedHero}>Closed</Text>
          )}

          <View style={styles.balanceBlock}>
            <Text style={styles.balLabel}>VAULT BALANCE</Text>
            <Text testID="vault-detail-balance" style={styles.balValue}>
              {amountFloat.toLocaleString(undefined, { maximumFractionDigits: 4 })} {symbol}
            </Text>
            <Text style={styles.balFiat}>Mainnet multi-asset vault</Text>
          </View>
        </Card>

        <Text style={styles.section}>ACTIONS</Text>
        <View style={styles.actionsRow}>
          <ActionButton
            testID="vault-action-withdraw"
            label="Withdraw"
            icon="arrow-up-right"
            onPress={onWithdraw}
            disabled={!isUnlocked || busy}
            primary
          />
        </View>

        <Text style={styles.section}>VAULT DETAILS</Text>
        <Card padded style={{ paddingVertical: 0 }}>
          <DetailRow label="Vault ID" value={vault.vaultId.toString()} mono />
          <DetailRow label="Token" value={symbol} />
          <DetailRow label="Unlock date" value={formatUnlockDate(vault.unlockTimestamp)} />
        </Card>

        <Card padded style={{ marginTop: spacing.md }}>
          <Text style={styles.eyebrow}>CONTRACT RULES</Text>
          <Rule text="Only the owner address can withdraw." />
          <Rule text="Deposits never reset the unlock timestamp." />
          <Rule text="Withdrawal is blocked on-chain until the unlock timestamp." />
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const ADVANCED_ACCENT = colors.cyan; // cyan primary accent; Multi-Asset keeps gold
const TIMELOCK_META = { label: "Time-Lock", icon: "lock" as const, accent: colors.cyan };

// Advanced vault detail (Time Gate, Unlock Intervals, Dead Man's Switch, Time-Lock).
function AdvancedVaultDetail() {
  const { id } = useLocalSearchParams<{ id: string; type?: string }>();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { wallet } = useSession();

  const [vault, setVault] = useState<AdvancedVaultRecord | null>(null);
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));
  const [busy, setBusy] = useState(false);
  const [vestingInterval, setVestingInterval] = useState<VestingInterval | null>(null);

  const load = useCallback(async () => {
    if (!id || !wallet?.publicKey) return;
    try {
      const v = await getAdvancedVault(wallet.publicKey, BigInt(id));
      if (v) {
        setVault(v);
      } else {
        toast.show(
          "This advanced vault could not be found on-chain.",
          "error",
        );
      }
    } catch (e) {
      console.warn("[VaultDetail] advanced load failed:", e);
      toast.show("Couldn't load this vault. Please try again.", "error");
    }
  }, [id, wallet?.publicKey, toast]);

  useEffect(() => {
    load();
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, [load]);

useEffect(() => {
    if (!vault || vault.kind !== "Vesting") return;
    loadVestingMeta(vault.vaultId).then((m) => {
      if (m) setVestingInterval(m.interval);
    });
  }, [vault]);

  if (!vault) {
    return (
      <View style={styles.loading as ViewStyle} testID="vault-detail-loading">
        <ActivityIndicator color={ADVANCED_ACCENT} />
      </View>
    );
  }

  const isWithdrawn = vault.withdrawn || vault.claimedByBackup;
  const isBeneficiary =
    vault.isBeneficiary ||
    (!!wallet?.publicKey &&
      vault.owner !== wallet.publicKey &&
      vault.backupAddress === wallet.publicKey);
  const kindMeta =
    vault.kind === "TimeLock"
      ? TIMELOCK_META
      : ADVANCED_VAULT_KIND_META[vault.kind] ?? TIMELOCK_META;
  const amountFloat = stroopsToFloat(vault.balance);

  const intervalSec = vestingInterval
    ? VESTING_INTERVAL_SECONDS[vestingInterval]
    : undefined;
  const claimable = computeVestedClaimable(vault, now, intervalSec);
  const claimableFloat = stroopsToFloat(claimable);
  const totalFloat = stroopsToFloat(vault.totalLockedAmount);
  const notStartedYet = now < vault.vestingStartTimestamp;
  const vestDuration = Math.max(
    1,
    vault.vestingEndTimestamp - vault.vestingStartTimestamp,
  );
  const vestElapsed = Math.min(
    vestDuration,
    Math.max(0, now - vault.vestingStartTimestamp),
  );
  const vestPercent =
    vault.totalLockedAmount > 0n
      ? Math.min(100, Math.round((vestElapsed / vestDuration) * 100))
      : 0;
  const vestedSoFarFloat = stroopsToFloat(vault.withdrawnSoFar) + claimableFloat;

  // Status + countdown target vary by kind.
  let targetTs: number | null = null;
  let statusLine = "";
  let statusIcon: keyof typeof Feather.glyphMap = "clock";
  let statusColor = colors.textSecondary;

  if (isWithdrawn) {
    statusLine = vault.claimedByBackup ? "Claimed by backup address" : "Withdrawn";
    statusIcon = "check";
    statusColor = colors.textTertiary;
  } else if (vault.kind === "CoolingOff") {
    if (vault.withdrawalInitiatedTimestamp === 0) {
      statusLine = "No withdrawal in progress";
      statusIcon = "shield";
    } else {
      targetTs =
        vault.withdrawalInitiatedTimestamp + vault.coolingOffDurationSeconds;
      if (now >= targetTs) {
        statusLine = "Time Gate complete — ready to withdraw";
        statusIcon = "unlock";
        statusColor = colors.success;
      } else {
        statusLine = `Time Gate — ready in ${formatShortDuration(targetTs - now)}`;
        statusIcon = "clock";
        statusColor = colors.warning;
      }
    }
  } else if (vault.kind === "Vesting") {
    targetTs = vault.vestingEndTimestamp;
    if (notStartedYet) {
      statusLine = `Unlock Intervals start in ${formatShortDuration(vault.vestingStartTimestamp - now)}`;
      statusIcon = "clock";
    } else {
      statusLine = `${vestedSoFarFloat.toLocaleString(undefined, { maximumFractionDigits: 4 })} of ${totalFloat.toLocaleString(undefined, { maximumFractionDigits: 4 })} XLM unlocked (${vestPercent}%)${vestingInterval ? ` · ${vestingInterval}` : ""}`;
      statusIcon = "clock";
      statusColor = now >= vault.vestingEndTimestamp ? colors.success : colors.textSecondary;
    }
  } else if (vault.kind === "DeadManSwitch") {
    const deadline = vault.lastPingTimestamp + vault.inactivityPeriodSeconds;
    targetTs = deadline;
    if (now >= deadline) {
      statusLine = isBeneficiary
        ? "Overdue — you can claim this vault"
        : "Overdue — backup address can now claim this vault";
      statusIcon = "alert-triangle";
      statusColor = isBeneficiary ? colors.gold : colors.danger;
    } else {
      statusLine = isBeneficiary
        ? `Owner check-in due in ${formatShortDuration(deadline - now)}`
        : `Next check-in due in ${formatShortDuration(deadline - now)}`;
      statusIcon = "heart";
    }
  } else {
    // TimeLock
    targetTs = vault.unlockTimestamp;
  }

  const cd = targetTs != null ? countdownTo(targetTs, now) : null;
  const status: Vault["status"] = isWithdrawn
    ? "withdrawn"
    : cd && !cd.expired
      ? "locked"
      : "unlocked";

  const requireSeed = (): boolean => {
    if (!wallet?.secretSeed) {
      toast.show("Import your seed phrase to sign this transaction.", "error");
      return false;
    }
    return true;
  };

  const runAdvancedAction = async (
    fn: () => Promise<{ ok: boolean; error?: string }>,
    successMsg: string,
  ) => {
    if (busy || !requireSeed()) return;
    setBusy(true);
    try {
      const res = await fn();
      if (res.ok) {
        toast.show(successMsg, "success");
        await load();
      } else {
        toast.show(res.error || "Action failed.", "error");
      }
    } catch (e) {
      toast.show(humanizeAdvancedError(stringifyRpcError(e)), "error");
    } finally {
      setBusy(false);
    }
  };

  const vestingWithdrawLabel = notStartedYet
    ? "Not started yet"
    : claimable > 0n && claimableFloat < 0.01
      ? "Withdraw <0.01 XLM"
      : `Withdraw ${claimableFloat.toLocaleString(undefined, { maximumFractionDigits: 2 })} XLM`;

  const headerSub =
    vault.kind === "CoolingOff" && vault.withdrawalInitiatedTimestamp === 0
      ? "No withdrawal in progress"
      : targetTs != null
        ? formatUnlockDate(targetTs)
        : formatUnlockDate(vault.unlockTimestamp);

  return (
    <SafeAreaView edges={["top"]} style={styles.root} testID="vault-detail-screen">
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.back}
          testID="vault-detail-back"
        >
          <Feather name="arrow-left" size={22} color={colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {vault.name || `${kindMeta.label} #${vault.vaultId.toString()}`}
          </Text>
          {vault.name ? (
            <Text
              style={[styles.headerKindSub, { color: kindMeta.accent }]}
              numberOfLines={1}
            >
              {kindMeta.label}
            </Text>
          ) : null}
          <Text style={styles.headerSub}>{headerSub}</Text>
        </View>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
      >
        <Card status={status} padded style={styles.hero}>
          <View style={styles.rowBetween}>
            <View
              style={[
                styles.typeBadge,
                { borderColor: kindMeta.accent + "60", backgroundColor: kindMeta.accent + "18" },
              ]}
            >
              <Feather name={kindMeta.icon} size={11} color={kindMeta.accent} />
              <Text style={[styles.typeBadgeText, { color: kindMeta.accent }]}>
                {kindMeta.label}
              </Text>
            </View>
            <View style={styles.statusPill(status)}>
              <Feather
                name={isWithdrawn ? "check" : status === "locked" ? "lock" : "unlock"}
                size={11}
                color={
                  isWithdrawn
                    ? colors.textTertiary
                    : status === "locked"
                      ? colors.teal
                      : colors.gold
                }
              />
              <Text
                style={[
                  styles.statusText,
                  {
                    color: isWithdrawn
                      ? colors.textTertiary
                      : status === "locked"
                        ? colors.teal
                        : colors.gold,
                  },
                ]}
              >
                {status}
              </Text>
            </View>
          </View>

          {isWithdrawn ? (
            <Text style={[styles.eyebrow, { marginTop: spacing.md }]}>WITHDRAWN</Text>
          ) : cd ? (
            <Text style={[styles.eyebrow, { marginTop: spacing.md }]}>
              {cd.expired ? "READY TO WITHDRAW" : "TIME UNTIL UNLOCK"}
            </Text>
          ) : null}

          {!isWithdrawn && cd ? (
            cd.expired ? (
              <Text style={styles.unlockedHero}>Unlocked</Text>
            ) : (
              <View style={styles.countdownRow}>
                <TimeUnit value={cd.years} label="yr" />
                <TimeUnit value={cd.months} label="mo" />
                <TimeUnit value={cd.days} label="d" />
                <TimeUnit value={cd.hours} label="h" />
              </View>
            )
          ) : isWithdrawn ? (
            <Text style={styles.unlockedHero}>Closed</Text>
          ) : null}

          {vault.kind === "Vesting" ? (
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${vestPercent}%`, backgroundColor: ADVANCED_ACCENT },
                ]}
              />
            </View>
          ) : null}

          {statusLine ? (
            <View style={styles.advancedStatusRow}>
              <Feather name={statusIcon} size={13} color={statusColor} />
              <Text style={[styles.advancedStatusText, { color: statusColor }]}>
                {statusLine}
              </Text>
            </View>
          ) : null}

          <View style={styles.balanceBlock}>
            <Text style={styles.balLabel}>VAULT BALANCE</Text>
            <Text testID="vault-detail-balance" style={styles.balValue}>
              {amountFloat.toLocaleString(undefined, { maximumFractionDigits: 4 })} XLM
            </Text>
            <Text style={styles.balFiat}>
              {kindMeta.label} · Advanced vault
            </Text>
          </View>
        </Card>

        <Text style={styles.section}>ACTIONS</Text>
        {/* The available set depends on the advanced kind. */}
        {!isWithdrawn ? (
          <View style={styles.actionsRow}>
            {vault.kind === "CoolingOff" ? (
              vault.withdrawalInitiatedTimestamp === 0 ? (
                <ActionButton
                  testID="vault-action-start-withdrawal"
                  label="Start withdrawal"
                  icon="play"
                  onPress={() =>
                    wallet &&
                    runAdvancedAction(
                      () =>
                        initiateWithdrawal({
                          ownerPublicKey: wallet.publicKey,
                          ownerSecretSeed: wallet.secretSeed!,
                          vaultId: vault.vaultId,
                        }),
                      "Withdrawal started. Cancel any time before it completes.",
                    )
                  }
                  disabled={busy}
                />
              ) : now < vault.withdrawalInitiatedTimestamp + vault.coolingOffDurationSeconds ? (
                <ActionButton
                  testID="vault-action-cancel-withdrawal"
                  label="Cancel withdrawal"
                  icon="x-circle"
                  onPress={() =>
                    wallet &&
                    runAdvancedAction(
                      () =>
                        cancelWithdrawal({
                          ownerPublicKey: wallet.publicKey,
                          ownerSecretSeed: wallet.secretSeed!,
                          vaultId: vault.vaultId,
                        }),
                      "Withdrawal cancelled. Funds stay locked.",
                    )
                  }
                  disabled={busy}
                />
              ) : (
                <ActionButton
                  testID="vault-action-withdraw"
                  label="Withdraw"
                  icon="unlock"
                  onPress={() =>
                    wallet &&
                    runAdvancedAction(
                      () =>
                        withdrawAdvancedVault({
                          ownerPublicKey: wallet.publicKey,
                          ownerSecretSeed: wallet.secretSeed!,
                          vaultId: vault.vaultId,
                        }),
                      "Withdrawn successfully.",
                    )
                  }
                  disabled={busy}
                  primary
                />
              )
            ) : vault.kind === "Vesting" ? (
              <ActionButton
                testID="vault-action-vesting-withdraw"
                label={vestingWithdrawLabel}
                icon="download"
                onPress={() =>
                  claimable > 0n &&
                  wallet &&
                  runAdvancedAction(
                    () =>
                      withdrawVested({
                        ownerPublicKey: wallet.publicKey,
                        ownerSecretSeed: wallet.secretSeed!,
                        vaultId: vault.vaultId,
                        amount: claimable,
                      }),
                    `Withdrew ${claimableFloat.toLocaleString(undefined, { maximumFractionDigits: 4 })} XLM.`,
                  )
                }
                disabled={claimable <= 0n || busy}
                primary={claimable > 0n}
              />
            ) : vault.kind === "DeadManSwitch" ? (
              isBeneficiary ? (
                <ActionButton
                  testID="vault-action-backup-claim"
                  label={status === "unlocked" ? "Claim this vault" : "Can't claim yet"}
                  icon="user-check"
                  onPress={() =>
                    wallet &&
                    runAdvancedAction(
                      () =>
                        backupWithdraw({
                          backupPublicKey: wallet.publicKey,
                          backupSecretSeed: wallet.secretSeed!,
                          vaultId: vault.vaultId,
                        }),
                      "Vault claimed successfully.",
                    )
                  }
                  disabled={status !== "unlocked" || busy}
                  primary={status === "unlocked"}
                />
              ) : (
                <>
                  <ActionButton
                    testID="vault-action-ping"
                    label="Ping (I'm here)"
                    icon="heart"
                    onPress={() =>
                      wallet &&
                      runAdvancedAction(
                        () =>
                          ping({
                            ownerPublicKey: wallet.publicKey,
                            ownerSecretSeed: wallet.secretSeed!,
                            vaultId: vault.vaultId,
                          }),
                        "Checked in. Countdown reset.",
                      )
                    }
                    disabled={busy}
                  />
                  <ActionButton
                    testID="vault-action-withdraw"
                    label="Withdraw"
                    icon="unlock"
                    onPress={() =>
                      wallet &&
                      runAdvancedAction(
                        () =>
                          withdrawAdvancedVault({
                            ownerPublicKey: wallet.publicKey,
                            ownerSecretSeed: wallet.secretSeed!,
                            vaultId: vault.vaultId,
                          }),
                        "Withdrawn successfully.",
                      )
                    }
                    disabled={busy}
                    primary
                  />
                </>
              )
            ) : (
              <ActionButton
                testID="vault-action-withdraw"
                label="Withdraw"
                icon="unlock"
                onPress={() =>
                  wallet &&
                  runAdvancedAction(
                    () =>
                      withdrawAdvancedVault({
                        ownerPublicKey: wallet.publicKey,
                        ownerSecretSeed: wallet.secretSeed!,
                        vaultId: vault.vaultId,
                      }),
                    "Withdrawn successfully.",
                  )
                }
                disabled={status !== "unlocked" || busy}
                primary
              />
            )}
          </View>
        ) : null}

        <Text style={styles.section}>VAULT DETAILS</Text>
        <Card padded style={{ paddingVertical: 0 }}>
          <DetailRow label="Vault ID" value={vault.vaultId.toString()} mono />
          <DetailRow label="Kind" value={kindMeta.label} />
          <DetailRow label="Owner" value={shortenAddress(vault.owner)} />
          {vault.backupAddress ? (
            <DetailRow label="Backup" value={shortenAddress(vault.backupAddress)} />
          ) : null}
          {vault.kind === "DeadManSwitch" ? (
            <DetailRow
              label="Inactivity period"
              value={formatShortDuration(vault.inactivityPeriodSeconds)}
            />
          ) : null}
          {vault.kind === "CoolingOff" && vault.withdrawalInitiatedTimestamp > 0 ? (
            <DetailRow
              label="Withdrawal started"
              value={formatTimestamp(vault.withdrawalInitiatedTimestamp)}
            />
          ) : null}
          {vault.kind === "Vesting" ? (
            <>
              <DetailRow
                label="Unlock Intervals start"
                value={formatTimestamp(vault.vestingStartTimestamp)}
              />
              <DetailRow
                label="Unlock Intervals end"
                value={formatTimestamp(vault.vestingEndTimestamp)}
              />
            </>
          ) : null}
        </Card>

        <Card padded style={{ marginTop: spacing.md }}>
          <Text style={styles.eyebrow}>CONTRACT RULES</Text>
          {vault.kind === "CoolingOff" ? (
            <>
              <Rule text="Withdrawal must go through a Time Gate window." />
              <Rule text="The Time Gate countdown can be cancelled any time." />
              <Rule text="Final withdrawal is blocked until the countdown finishes." />
            </>
          ) : vault.kind === "Vesting" ? (
            <>
              <Rule text="Funds unlock gradually between the start and end dates." />
              <Rule text="Only unlocked amounts can be withdrawn." />
              <Rule text="Unlock Intervals can never be accelerated or shortened." />
            </>
          ) : vault.kind === "DeadManSwitch" ? (
            <>
              <Rule text={`Owner must check in every ${formatShortDuration(vault.inactivityPeriodSeconds)}.`} />
              <Rule text="If the owner stops checking in, the backup address can claim." />
              <Rule text="The owner can withdraw the full balance at any time." />
            </>
          ) : (
            <>
              <Rule text="Only the owner address can withdraw." />
              <Rule text="Withdrawal is blocked on-chain until the unlock timestamp." />
            </>
          )}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, mono && styles.detailValueMono]} numberOfLines={1}>
        {value}
      </Text>
    </View>
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

function TimeUnit({ value, label }: { value: number; label: string }) {
  return (
    <View style={styles.timeUnit}>
      <Text style={styles.timeValue}>{String(value).padStart(2, "0")}</Text>
      <Text style={styles.timeLabel}>{label}</Text>
    </View>
  );
}

function ActionButton({
  label,
  icon,
  onPress,
  disabled,
  primary,
  testID,
}: {
  label: string;
  icon: keyof typeof Feather.glyphMap;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
  testID: string;
}) {
  return (
    <TouchableOpacity
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.85}
      style={[
        styles.actionBtn,
        primary && styles.actionBtnPrimary,
        disabled && { opacity: 0.4 },
      ]}
    >
      <Feather name={icon} size={18} color={primary ? colors.textInverse : colors.text} />
      <Text style={[styles.actionLabel, primary && { color: colors.textInverse }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function Rule({ text }: { text: string }) {
  return (
    <View style={styles.ruleRow}>
      <Feather name="check-circle" size={13} color={colors.teal} />
      <Text style={styles.ruleText}>{text}</Text>
    </View>
  );
}

// Fallback address renderer for the "Send to …" CTA when the user
// saved a raw Stellar address without a friendly label. Format:
// `GABC…WXYZ` — first 4 + last 4 chars from the Base32 body.
function shortenAddress(addr: string): string {
  if (!addr || addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function DepositSheet({
  visible,
  onClose,
  onConfirm,
  busy,
}: {
  visible: boolean;
  onClose: () => void;
  onConfirm: (amount: number) => void;
  busy: boolean;
}) {
  const [amount, setAmount] = useState("");
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (visible) setAmount("");
  }, [visible]);
  const num = parseFloat(amount);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <KeyboardAwareScrollView
        ScrollViewComponent={ScrollView as any}
        style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}
        keyboardShouldPersistTaps="handled"
        bottomOffset={20}
      >
        <View style={styles.sheetHandle} />
        <Text style={styles.sheetTitle}>Add funds</Text>
        <Text style={styles.sheetSub}>
          Adds XLM to this vault. The unlock date stays exactly the same.
        </Text>
        <TextInput
          testID="deposit-sheet-amount"
          value={amount}
          onChangeText={setAmount}
          placeholder="Amount in XLM"
          placeholderTextColor={colors.textTertiary}
          keyboardType="decimal-pad"
          style={styles.sheetInput}
        />
        <Button
          testID="deposit-sheet-confirm"
          label="Deposit XLM"
          icon="arrow-down-left"
          loading={busy}
          disabled={!Number.isFinite(num) || num <= 0}
          onPress={() => onConfirm(num)}
        />
      </KeyboardAwareScrollView>
    </Modal>
  );
}

function ExtendSheet({
  visible,
  onClose,
  onConfirm,
  busy,
}: {
  visible: boolean;
  onClose: () => void;
  onConfirm: (days: number) => void;
  busy: boolean;
}) {
  const [custom, setCustom] = useState("");
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (visible) setCustom("");
  }, [visible]);
  const customNum = parseInt(custom, 10);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <KeyboardAwareScrollView
        ScrollViewComponent={ScrollView as any}
        style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}
        keyboardShouldPersistTaps="handled"
        bottomOffset={20}
      >
        <View style={styles.sheetHandle} />
        <Text style={styles.sheetTitle}>Extend lock</Text>
        <Text style={styles.sheetSub}>
          The contract forbids shortening. You can only push the unlock date further out.
        </Text>
        <View style={styles.extendRow}>
          {EXTEND_OPTIONS.map((d) => (
            <TouchableOpacity
              key={d}
              testID={`extend-preset-${d}`}
              onPress={() => onConfirm(d)}
              activeOpacity={0.85}
              style={styles.extendChip}
            >
              <Text style={styles.extendChipText}>+{d}d</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.sheetLabel}>OR CUSTOM DAYS</Text>
        <TextInput
          testID="extend-sheet-custom"
          value={custom}
          onChangeText={setCustom}
          placeholder="Days to add"
          placeholderTextColor={colors.textTertiary}
          keyboardType="number-pad"
          style={styles.sheetInput}
        />
        <Button
          testID="extend-sheet-confirm"
          label="Extend lock"
          icon="fast-forward"
          loading={busy}
          disabled={!Number.isFinite(customNum) || customNum <= 0}
          onPress={() => onConfirm(customNum)}
        />
      </KeyboardAwareScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background } as ViewStyle,
  loading: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.background } as ViewStyle,
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomColor: colors.borderSubtle,
    borderBottomWidth: 1,
  } as ViewStyle,
  back: { width: 32, height: 32, alignItems: "center", justifyContent: "center" } as ViewStyle,
  editBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" } as ViewStyle,
  headerTitle: { color: colors.text, fontSize: 15, ...typography.heading } as TextStyle,
  headerSub: { color: colors.textSecondary, fontSize: 11, marginTop: 2 } as TextStyle,
  headerKindSub: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginTop: 2,
  } as TextStyle,

  body: { padding: spacing.md },
  hero: { paddingTop: spacing.lg, paddingBottom: spacing.lg },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  eyebrow: { color: colors.textTertiary, fontSize: 10, ...typography.label },

statusPill: (status: Vault["status"]) => ({
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.pill,
    backgroundColor:
      status === "locked"
        ? colors.cyanMuted
        : status === "unlocked"
        ? colors.cyanMuted
        : colors.surfaceHighlight,
  } as ViewStyle),
  statusText: { fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 },

  countdownRow: { flexDirection: "row", gap: 10, marginTop: spacing.md, justifyContent: "space-between" },
  timeUnit: {
    flex: 1,
    backgroundColor: colors.surfaceFrost,
    borderRadius: radii.md,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  timeValue: { color: colors.text, fontSize: 26, fontWeight: "700", ...typography.mono },
  timeLabel: { color: colors.textTertiary, fontSize: 10, marginTop: 4, ...typography.label },
  unlockedHero: { color: colors.gold, fontSize: 30, ...typography.display, marginTop: spacing.md },

  balanceBlock: { marginTop: spacing.lg },
  balLabel: { color: colors.textTertiary, fontSize: 10, ...typography.label, marginBottom: 4 },
  balValue: { color: colors.text, fontSize: 28, ...typography.display, ...typography.mono },
  balFiat: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },

  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.surfaceElevated,
    marginTop: spacing.md,
    overflow: "hidden",
  },
  progressFill: { height: 4, backgroundColor: colors.teal },
  progressText: { color: colors.textSecondary, fontSize: 11, marginTop: 6 },

  note: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 4 },

  actionsRow: { flexDirection: "row", gap: 8, marginTop: spacing.md },
  sendToBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 16,
    paddingHorizontal: spacing.md,
    marginTop: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.teal,
    // Subtle elevation so this looks like the primary next-action.
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  sendToBtnText: {
    color: colors.textInverse,
    fontSize: 14,
    fontWeight: "700",
    flexShrink: 1,
  },
  dismissBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    marginTop: spacing.sm,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceFrost,
  },
  dismissBtnText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: "700",
  },
  actionBtn: {
    flex: 1,
    backgroundColor: colors.surfaceFrost,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingVertical: 14,
    alignItems: "center",
    gap: 6,
  },
  actionBtnPrimary: { backgroundColor: colors.gold, borderColor: colors.gold },
  actionLabel: { color: colors.text, fontSize: 12, fontWeight: "600" },

  section: { color: colors.textTertiary, fontSize: 11, ...typography.label, marginTop: spacing.lg, marginBottom: spacing.sm },

  txRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 },
  txRowDivider: { borderBottomColor: colors.borderSubtle, borderBottomWidth: 1 },
  txKind: { color: colors.text, fontSize: 13, fontWeight: "600" },
  txTime: { color: colors.textTertiary, fontSize: 11, marginTop: 2 },
  txAmount: { color: colors.teal, fontSize: 13, fontWeight: "700", ...typography.mono },
  txNote: { color: colors.textSecondary, fontSize: 11, ...typography.mono },

  ruleRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginVertical: 5 },
  ruleText: { color: colors.textSecondary, fontSize: 12, flex: 1, lineHeight: 18 },

  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surfaceFrost,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: spacing.md + 4,
    maxHeight: "80%",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: spacing.md,
  },
  sheetTitle: { color: colors.text, fontSize: 18, ...typography.heading },
  sheetSub: { color: colors.textSecondary, fontSize: 13, marginTop: 4, marginBottom: spacing.md, lineHeight: 18 },
  sheetInput: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    color: colors.text,
    fontSize: 15,
    marginBottom: spacing.md,
  },
  sheetLabel: { color: colors.textTertiary, fontSize: 10, ...typography.label, marginBottom: 6 },

  extendRow: { flexDirection: "row", gap: 8, marginBottom: spacing.md },
  extendChip: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  extendChipText: { color: colors.teal, fontSize: 14, fontWeight: "700" },

  typeBadge: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  typeBadgeText: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  advancedStatusRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    marginTop: spacing.md,
  },
  advancedStatusText: {
    fontSize: 11,
    flex: 1,
    lineHeight: 16,
  },
  detailRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    gap: 12,
    paddingVertical: 12,
    borderBottomColor: colors.borderSubtle,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  detailLabel: { color: colors.textTertiary, fontSize: 11 },
  detailValue: { color: colors.text, fontSize: 12, fontWeight: "600", flexShrink: 1 },
  detailValueMono: { ...typography.mono },
} as any);
