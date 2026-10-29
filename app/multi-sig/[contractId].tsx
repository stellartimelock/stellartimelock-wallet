/**
 * Multi-Sig vault management — owner can request withdrawals;
 * co-signer can approve / reject; either party can claim after approval.
 */

import { Feather } from "@expo/vector-icons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useToast } from "@/src/components/Toast";
import { VaultNotifyConfirmModal } from "@/src/components/VaultNotifyConfirmModal";
import { useSession } from "@/src/state/session";
import { markMultiSigSeen } from "@/src/vault/multi-sig-store";
import { markDiscoveredVaultSeen } from "@/src/vault/memo-discovery";
import { colors, radii, spacing, typography } from "@/src/theme";
import {
  approveMultiSigWithdrawal,
  cancelMultiSigWithdrawal,
  claimMultiSigWithdrawal,
  getMultiSigVault,
  getMultiSigWithdrawalRequest,
  humanizeAdvancedError,
  requestMultiSigWithdrawal,
  stringifyRpcError,
  stroopsToFloat,
  xlmToStroops,
} from "@/src/wallet/advanced-vaults";
import { shortenAddress } from "@/src/wallet/stellar";

type NotifyPrompt = "manual" | "after-request" | null;

export default function MultiSigManageScreen() {
  const router = useRouter();
  const toast = useToast();
  const { wallet } = useSession();
  const params = useLocalSearchParams<{ contractId?: string }>();
  const contractId = (params.contractId ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [owner, setOwner] = useState("");
  const [coSigner, setCoSigner] = useState("");
  const [balance, setBalance] = useState(0n);
  const [unlockTs, setUnlockTs] = useState(0);
  const [reqAmount, setReqAmount] = useState(0n);
  const [reqDest, setReqDest] = useState("");
  const [reqApproved, setReqApproved] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawDest, setWithdrawDest] = useState("");
  const [notifyPrompt, setNotifyPrompt] = useState<NotifyPrompt>(null);

  const isOwner = !!wallet && wallet.publicKey === owner;
  const isCoSigner = !!wallet && wallet.publicKey === coSigner;
  const hasPending = reqAmount > 0n;
  const isCompleted = balance === 0n && !hasPending;
  const canNotifyCoSigner =
    isOwner && !!coSigner && hasPending && !reqApproved;

  const load = useCallback(async () => {
    if (!wallet || !contractId) return;
    setLoading(true);
    try {
      const [vault, req] = await Promise.all([
        getMultiSigVault(wallet.publicKey, contractId),
        getMultiSigWithdrawalRequest(wallet.publicKey, contractId),
      ]);
      if (vault) {
        setOwner(String(vault.owner ?? ""));
        setCoSigner(
          String(vault.co_signer ?? vault.cosigner ?? vault.coSigner ?? ""),
        );
        setBalance(BigInt(String(vault.balance ?? vault.amount ?? "0")));
        setUnlockTs(Number(vault.unlock_timestamp ?? vault.unlockTimestamp ?? 0));
      }
      if (req && typeof req === "object") {
        setReqAmount(BigInt(String(req.amount ?? "0")));
        setReqDest(String(req.destination ?? req.dest ?? ""));
        setReqApproved(
          Boolean(req.approved ?? req.is_approved ?? req.co_signer_approved ?? false),
        );
      } else {
        setReqAmount(0n);
        setReqDest("");
        setReqApproved(false);
      }
      await markMultiSigSeen(wallet.publicKey, contractId);
      await markDiscoveredVaultSeen(wallet.publicKey, `msig:${contractId}`);
    } finally {
      setLoading(false);
    }
  }, [wallet, contractId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (wallet && !withdrawDest) setWithdrawDest(wallet.publicKey);
  }, [wallet, withdrawDest]);

  const run = async (
    fn: () => Promise<{ ok: boolean; error?: string }>,
    okMsg: string,
  ) => {
    if (!wallet?.secretSeed || busy) return;
    setBusy(true);
    try {
      const res = await fn();
      if (res.ok) {
        toast.show(okMsg, "success");
        await load();
      } else {
        toast.show(res.error ?? "Action failed.", "error");
      }
    } catch (e) {
      toast.show(humanizeAdvancedError(stringifyRpcError(e)), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleRequestWithdrawal = async () => {
    if (!wallet?.secretSeed || busy) return;
    const n = parseFloat(withdrawAmount);
    if (!Number.isFinite(n) || n <= 0) {
      toast.show("Enter a valid amount.", "error");
      return;
    }
    const dest = withdrawDest.trim();
    if (dest.length !== 56) {
      toast.show("Enter a valid destination address.", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await requestMultiSigWithdrawal({
        ownerPublicKey: wallet.publicKey,
        ownerSecretSeed: wallet.secretSeed,
        contractId,
        amount: xlmToStroops(n),
        destination: dest,
      });
      if (res.ok) {
        setWithdrawAmount("");
        await load();
        if (coSigner) {
          setNotifyPrompt("after-request");
        } else {
          toast.show("Withdrawal requested — waiting on co-signer.", "success");
        }
      } else {
        toast.show(res.error ?? "Action failed.", "error");
      }
    } catch (e) {
      toast.show(humanizeAdvancedError(stringifyRpcError(e)), "error");
    } finally {
      setBusy(false);
    }
  };

  if (!contractId) {
    return (
      <SafeAreaView style={styles.root}>
        <Text style={styles.error}>Missing contract id.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top"]} style={styles.root} testID="multi-sig-screen">
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back} testID="multi-sig-back">
          <Feather name="arrow-left" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Multi-Sig</Text>
        <View style={{ width: 32 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.cyan} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.pillRow}>
            {isCompleted ? (
              <View style={[styles.pill, styles.pillCompleted]}>
                <Text style={styles.pillText}>COMPLETED</Text>
              </View>
            ) : hasPending && !reqApproved ? (
              <View style={[styles.pill, styles.pillGold]}>
                <Text style={styles.pillText}>PENDING APPROVAL</Text>
              </View>
            ) : (
              <View style={[styles.pill, styles.pillCyan]}>
                <Text style={styles.pillText}>ACTIVE</Text>
              </View>
            )}
            {isCoSigner ? (
              <View style={[styles.pill, styles.pillGold]}>
                <Text style={styles.pillText}>CO-SIGNER</Text>
              </View>
            ) : null}
            {isOwner ? (
              <View style={[styles.pill, styles.pillCyan]}>
                <Text style={styles.pillText}>OWNER</Text>
              </View>
            ) : null}
          </View>

          <Text style={styles.amount}>
            {stroopsToFloat(balance).toLocaleString(undefined, {
              maximumFractionDigits: 4,
            })}{" "}
            XLM
          </Text>
          <Text style={styles.sub} selectable>
            Contract {shortenAddress(contractId, 10, 8)}
          </Text>
          <Text style={styles.sub}>Owner {shortenAddress(owner)}</Text>
          <Text style={styles.sub}>Co-signer {shortenAddress(coSigner)}</Text>
          {unlockTs > 0 ? (
            <Text style={styles.sub}>
              Unlock {new Date(unlockTs * 1000).toLocaleString()}
            </Text>
          ) : null}

          {hasPending ? (
            <View style={styles.card} testID="multi-sig-pending-card">
              <Text style={styles.cardTitle}>Pending withdrawal</Text>
              <Text style={styles.cardBody}>
                {stroopsToFloat(reqAmount).toLocaleString(undefined, {
                  maximumFractionDigits: 4,
                })}{" "}
                XLM → {shortenAddress(reqDest)}
              </Text>
              <Text style={styles.cardBody}>
                Status: {reqApproved ? "Approved — ready to claim" : "Awaiting co-signer"}
              </Text>
              <View style={styles.actionRow}>
                {isCoSigner && !reqApproved ? (
                  <Action
                    label="Approve"
                    icon="check"
                    busy={busy}
                    onPress={() =>
                      wallet &&
                      run(
                        () =>
                          approveMultiSigWithdrawal({
                            ownerPublicKey: wallet.publicKey,
                            ownerSecretSeed: wallet.secretSeed!,
                            contractId,
                          }),
                        "Withdrawal approved.",
                      )
                    }
                  />
                ) : null}
                {(isOwner || isCoSigner) && !reqApproved ? (
                  <Action
                    label="Reject"
                    icon="x"
                    variant="danger"
                    busy={busy}
                    onPress={() =>
                      wallet &&
                      run(
                        () =>
                          cancelMultiSigWithdrawal({
                            ownerPublicKey: wallet.publicKey,
                            ownerSecretSeed: wallet.secretSeed!,
                            contractId,
                          }),
                        "Withdrawal request cancelled.",
                      )
                    }
                  />
                ) : null}
                {reqApproved ? (
                  <Action
                    label="Claim"
                    icon="download"
                    busy={busy}
                    onPress={() =>
                      wallet &&
                      run(
                        () =>
                          claimMultiSigWithdrawal({
                            ownerPublicKey: wallet.publicKey,
                            ownerSecretSeed: wallet.secretSeed!,
                            contractId,
                          }),
                        "Funds claimed.",
                      )
                    }
                  />
                ) : null}
              </View>
              {canNotifyCoSigner ? (
                <TouchableOpacity
                  style={[styles.notifyOutlineBtn, busy && { opacity: 0.6 }]}
                  onPress={() => setNotifyPrompt("manual")}
                  disabled={busy}
                  activeOpacity={0.85}
                  testID="multi-sig-notify-cosigner"
                >
                  <Feather name="radio" size={13} color={colors.cyan} />
                  <Text style={styles.notifyOutlineBtnText}>Notify Co-signer</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}

          {isOwner && !hasPending && !isCompleted ? (
            <View style={styles.card} testID="multi-sig-request-card">
              <Text style={styles.cardTitle}>Request withdrawal</Text>
              <Text style={styles.label}>AMOUNT (XLM)</Text>
              <TextInput
                style={styles.input}
                value={withdrawAmount}
                onChangeText={setWithdrawAmount}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={colors.textTertiary}
                testID="multi-sig-amount"
              />
              <Text style={styles.label}>DESTINATION</Text>
              <TextInput
                style={[styles.input, styles.mono]}
                value={withdrawDest}
                onChangeText={setWithdrawDest}
                autoCapitalize="characters"
                autoCorrect={false}
                placeholder="G…"
                placeholderTextColor={colors.textTertiary}
                testID="multi-sig-dest"
              />
              <Action
                label="Request approval"
                icon="send"
                busy={busy}
                onPress={() => {
                  void handleRequestWithdrawal();
                }}
              />
            </View>
          ) : null}

          {!isOwner && !isCoSigner ? (
            <Text style={styles.error}>
              This wallet is neither the owner nor the co-signer of this vault.
            </Text>
          ) : null}
        </ScrollView>
      )}

      <VaultNotifyConfirmModal
        visible={!!notifyPrompt}
        keypair={wallet}
        destination={coSigner}
        vaultRef={contractId}
        kind="MultiSig"
        title={
          notifyPrompt === "after-request"
            ? "Withdrawal request created. Notify co-signer?"
            : undefined
        }
        message={
          notifyPrompt === "after-request"
            ? "Send a 0.0001 XLM memo payment so your co-signer can discover this vault and review the pending withdrawal."
            : undefined
        }
        confirmLabel={notifyPrompt === "after-request" ? "Notify" : undefined}
        skipLabel={notifyPrompt === "after-request" ? "Skip" : undefined}
        onDone={(sent) => {
          const reason = notifyPrompt;
          setNotifyPrompt(null);
          if (sent) {
            toast.show("Co-signer notified.", "success");
          } else if (reason === "after-request") {
            toast.show("Withdrawal requested — waiting on co-signer.", "success");
          }
        }}
      />
    </SafeAreaView>
  );
}

function Action({
  label,
  icon,
  onPress,
  busy,
  variant = "primary",
}: {
  label: string;
  icon: keyof typeof Feather.glyphMap;
  onPress: () => void;
  busy: boolean;
  variant?: "primary" | "danger";
}) {
  return (
    <TouchableOpacity
      style={[
        styles.actionBtn,
        variant === "danger" && styles.actionBtnDanger,
        busy && { opacity: 0.6 },
      ]}
      onPress={onPress}
      disabled={busy}
      activeOpacity={0.85}
    >
      <Feather
        name={icon}
        size={13}
        color={variant === "danger" ? colors.danger : colors.textInverse}
      />
      <Text
        style={[
          styles.actionBtnText,
          variant === "danger" && { color: colors.danger },
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  back: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center", color: colors.text, fontSize: 17, fontWeight: "700" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { padding: spacing.md, gap: spacing.md, paddingBottom: 48 },
  pillRow: { flexDirection: "row", gap: 8 },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  pillGold: { borderColor: colors.gold, backgroundColor: "rgba(232,184,74,0.12)" },
  pillCyan: { borderColor: colors.cyan, backgroundColor: colors.cyanMuted },
  pillCompleted: {
    borderColor: colors.statusClosed,
    backgroundColor: "rgba(148, 163, 184, 0.12)",
  },
  pillText: { color: colors.text, fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  amount: { color: colors.text, fontSize: 28, fontWeight: "700" },
  sub: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: "700" },
  cardBody: { color: colors.textSecondary, fontSize: 13 },
  label: {
    color: colors.textTertiary,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
    marginTop: 4,
  },
  input: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 14,
  },
  mono: { ...typography.mono, fontSize: 12 },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.cyan,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radii.md,
  },
  actionBtnDanger: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: colors.danger,
  },
  actionBtnText: { color: colors.textInverse, fontWeight: "700", fontSize: 13 },
  notifyOutlineBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 4,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.cyan,
    backgroundColor: "transparent",
  },
  notifyOutlineBtnText: {
    color: colors.cyan,
    fontWeight: "600",
    fontSize: 13,
  },
  error: { color: colors.danger, fontSize: 13, padding: spacing.md },
});
