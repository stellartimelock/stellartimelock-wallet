/**
 * HTLC vault detail — recipient can claim with the secret preimage;
 * sender can refund after the deadline.
 */

import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Crypto from "expo-crypto";
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
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/src/components/Button";
import { Card } from "@/src/components/Card";
import { useToast } from "@/src/components/Toast";
import { useSession } from "@/src/state/session";
import { colors, radii, spacing, typography } from "@/src/theme";
import { formatUnlockDate } from "@/src/vault/countdown";
import { shortenAddress } from "@/src/wallet/stellar";
import {
  ADVANCED_VAULT_KIND_META,
  claimHtlc,
  deriveHtlcLifecycleStatus,
  getHtlcState,
  humanizeAdvancedError,
  loadHtlcMeta,
  refundHtlc,
  stringifyRpcError,
  stroopsToFloat,
  type HtlcLifecycleStatus,
  type HtlcState,
} from "@/src/wallet/advanced-vaults";

const META = ADVANCED_VAULT_KIND_META.HTLC;

function statusCopy(life: HtlcLifecycleStatus): {
  line: string;
  color: string;
  icon: keyof typeof Feather.glyphMap;
} {
  if (life === "claimed") {
    return { line: "Claimed by recipient", color: colors.textTertiary, icon: "check" };
  }
  if (life === "refunded") {
    return { line: "Refunded to sender", color: colors.textTertiary, icon: "check" };
  }
  if (life === "expired") {
    return {
      line: "Expired — sender can refund",
      color: colors.warning,
      icon: "alert-triangle",
    };
  }
  if (life === "claimable") {
    return {
      line: "Claimable with the secret preimage",
      color: colors.success,
      icon: "unlock",
    };
  }
  return { line: "Locked until claim or deadline", color: colors.textSecondary, icon: "lock" };
}

export default function HtlcVaultDetail() {
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { wallet, formatXlm } = useSession();
  const params = useLocalSearchParams<{ vaultId?: string }>();
  const vaultIdStr = (params.vaultId ?? "").trim();
  const vaultId = /^\d+$/.test(vaultIdStr) ? BigInt(vaultIdStr) : null;

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<HtlcState | null>(null);
  const [name, setName] = useState("");
  const [preimage, setPreimage] = useState("");
  const [claimError, setClaimError] = useState<string | null>(null);
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));

  const load = useCallback(async () => {
    if (!wallet?.publicKey || vaultId == null) return;
    setLoading(true);
    try {
      const [s, meta] = await Promise.all([
        getHtlcState(wallet.publicKey, vaultId),
        loadHtlcMeta(vaultId).catch(() => null),
      ]);
      setState(s);
      setName(meta?.name?.trim() || `HTLC #${vaultId.toString()}`);
      if (!s) {
        toast.show("This HTLC vault could not be found on-chain.", "error");
      }
    } catch (e) {
      toast.show(humanizeAdvancedError(stringifyRpcError(e)), "error");
    } finally {
      setLoading(false);
    }
  }, [wallet?.publicKey, vaultId, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const isSender =
    !!wallet?.publicKey &&
    !!state &&
    state.sender.toUpperCase() === wallet.publicKey.toUpperCase();
  const isRecipient =
    !!wallet?.publicKey &&
    !!state &&
    state.recipient.toUpperCase() === wallet.publicKey.toUpperCase();

  const life = state
    ? deriveHtlcLifecycleStatus(state, now, { viewerIsRecipient: isRecipient })
    : "locked";
  const status = statusCopy(life);
  const amountFloat = state ? stroopsToFloat(state.amount) : 0;
  const settled = life === "claimed" || life === "refunded";

  const requireSeed = (): boolean => {
    if (!wallet?.secretSeed) {
      toast.show("Import your seed phrase to sign this transaction.", "error");
      return false;
    }
    return true;
  };

  const run = async (
    fn: () => Promise<{ ok: boolean; error?: string }>,
    okMsg: string,
  ) => {
    if (busy || !requireSeed() || !wallet?.secretSeed) return;
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

  const onClaim = async () => {
    if (!wallet?.secretSeed || vaultId == null || !state) return;
    const secret = preimage.trim();
    if (!secret) {
      setClaimError(null);
      toast.show("Enter the secret passphrase to claim.", "error");
      return;
    }
    setBusy(true);
    setClaimError(null);
    try {
      const derived = (
        await Crypto.digestStringAsync(
          Crypto.CryptoDigestAlgorithm.SHA256,
          secret,
        )
      )
        .toLowerCase()
        .replace(/^0x/, "");
      const onChain = (state.hash ?? "")
        .trim()
        .toLowerCase()
        .replace(/^0x/, "");
      if (!onChain || derived !== onChain) {
        const msg =
          "This secret doesn't match the hash. Check with the sender.";
        setClaimError(msg);
        toast.show(msg, "error");
        return;
      }
      const res = await claimHtlc({
        ownerPublicKey: wallet.publicKey,
        ownerSecretSeed: wallet.secretSeed,
        vaultId,
        preimage: secret,
      });
      if (res.ok) {
        toast.show("HTLC claimed — funds sent to the recipient.", "success");
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

  const onRefund = () => {
    if (!wallet?.secretSeed || vaultId == null) return;
    void run(
      () =>
        refundHtlc({
          ownerPublicKey: wallet.publicKey,
          ownerSecretSeed: wallet.secretSeed!,
          vaultId,
        }),
      "HTLC refunded — funds returned to the sender.",
    );
  };

  if (loading || !state) {
    return (
      <SafeAreaView edges={["top"]} style={styles.root} testID="htlc-detail-loading">
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.back}>
            <Feather name="arrow-left" size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>HTLC</Text>
          <View style={{ width: 32 }} />
        </View>
        <View style={styles.loading}>
          <ActivityIndicator color={META.accent} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top"]} style={styles.root} testID="htlc-detail-screen">
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.back}
          testID="htlc-detail-back"
        >
          <Feather name="arrow-left" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {name}
        </Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.body,
          { paddingBottom: insets.bottom + spacing.xl },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.hero}>
          <View style={[styles.kindBadge, { backgroundColor: META.accent + "22" }]}>
            <Feather name={META.icon} size={14} color={META.accent} />
            <Text style={[styles.kindBadgeText, { color: META.accent }]}>HTLC</Text>
          </View>
          <Text style={styles.amount} testID="htlc-detail-amount">
            {formatXlm(amountFloat)}
          </Text>
          <View style={styles.statusRow}>
            <Feather name={status.icon} size={14} color={status.color} />
            <Text style={[styles.statusText, { color: status.color }]}>{status.line}</Text>
          </View>
        </View>

        <Card padded style={{ marginTop: spacing.md }}>
          <Text style={styles.eyebrow}>DETAILS</Text>
          <DetailRow label="Vault ID" value={state.vaultId.toString()} />
          <DetailRow label="Sender" value={shortenAddress(state.sender)} />
          <DetailRow label="Recipient" value={shortenAddress(state.recipient)} />
          <DetailRow
            label="Hash"
            value={state.hash ? `${state.hash.slice(0, 10)}…${state.hash.slice(-8)}` : "—"}
          />
          <DetailRow label="Deadline" value={formatUnlockDate(state.timelock)} />
          <DetailRow
            label="Your role"
            value={isSender ? "Sender" : isRecipient ? "Recipient" : "Observer"}
          />
        </Card>

        {!settled && isRecipient && life !== "expired" ? (
          <Card padded style={{ marginTop: spacing.md }}>
            <Text style={styles.eyebrow}>CLAIM</Text>
            <Text style={styles.hint}>
              Enter the secret passphrase from the sender. The app hashes it and
              checks it against the on-chain hash before claiming.
            </Text>
            <Text style={styles.inputLabel}>Secret passphrase</Text>
            <TextInput
              testID="htlc-claim-preimage"
              value={preimage}
              onChangeText={(v) => {
                setPreimage(v);
                if (claimError) setClaimError(null);
              }}
              placeholder="Secret passphrase"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
            />
            {claimError ? (
              <Text style={styles.claimError} testID="htlc-claim-hash-mismatch">
                {claimError}
              </Text>
            ) : null}
            <Button
              testID="htlc-claim-button"
              label={busy ? "Signing…" : "Claim HTLC"}
              onPress={() => void onClaim()}
              loading={busy}
              disabled={busy || !preimage.trim()}
              style={{ marginTop: spacing.sm }}
            />
          </Card>
        ) : null}

        {!settled && isSender && life === "expired" ? (
          <Card padded style={{ marginTop: spacing.md }}>
            <Text style={styles.eyebrow}>REFUND</Text>
            <Text style={styles.hint}>
              The claim deadline has passed and this lock is still unsettled. Refund
              returns the locked XLM to the sender.
            </Text>
            <Button
              testID="htlc-refund-button"
              label={busy ? "Signing…" : "Refund HTLC"}
              onPress={onRefund}
              loading={busy}
              disabled={busy}
              style={{ marginTop: spacing.sm }}
            />
          </Card>
        ) : null}

        <Card padded style={{ marginTop: spacing.md }}>
          <Text style={styles.eyebrow}>CONTRACT RULES</Text>
          <Rule text="Only the recipient can claim, and only before the deadline." />
          <Rule text="Claim requires the exact secret passphrase that hashes to the locked digest." />
          <Rule text="Only the sender can refund, and only after the deadline." />
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function Rule({ text }: { text: string }) {
  return (
    <View style={styles.rule}>
      <Feather name="check" size={12} color={colors.cyan} />
      <Text style={styles.ruleText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomColor: colors.borderSubtle,
    borderBottomWidth: 1,
  },
  back: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    color: colors.text,
    fontSize: 17,
    ...typography.heading,
  },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  body: { padding: spacing.md },
  hero: { alignItems: "center", paddingVertical: spacing.md, gap: spacing.sm },
  kindBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.pill,
  },
  kindBadgeText: { fontSize: 12, ...typography.heading },
  amount: {
    color: colors.text,
    fontSize: 32,
    ...typography.heading,
  },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusText: { fontSize: 13, ...typography.body },
  eyebrow: {
    color: colors.textTertiary,
    fontSize: 11,
    letterSpacing: 1,
    marginBottom: spacing.sm,
    ...typography.heading,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
    gap: spacing.sm,
  },
  rowLabel: { color: colors.textSecondary, fontSize: 13, ...typography.body },
  rowValue: {
    color: colors.text,
    fontSize: 13,
    flexShrink: 1,
    textAlign: "right",
    ...typography.mono,
  },
  hint: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: spacing.sm,
    ...typography.body,
  },
  inputLabel: {
    color: colors.textTertiary,
    fontSize: 11,
    letterSpacing: 0.4,
    marginBottom: 6,
    ...typography.heading,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 15,
    ...typography.body,
  },
  claimError: {
    color: colors.danger,
    fontSize: 13,
    lineHeight: 18,
    marginTop: spacing.sm,
    ...typography.body,
  },
  rule: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginBottom: 8,
  },
  ruleText: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    ...typography.body,
  },
});
