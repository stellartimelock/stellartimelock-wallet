// Offline money assistant.
//
// The parser and the quote run on the phone. A rate lookup and an
// approved submit are the only steps that use the network. Approve is
// the send: a cancelled biometric or PIN prompt returns before broadcast.

import { Feather } from "@expo/vector-icons";
import { Stack, useRouter } from "expo-router";
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
import { broadcastPayment } from "@/src/send/broadcast";
import { authenticate } from "@/src/security/biometric";
import { BiometricGate } from "@/src/security/BiometricGate";
import { useSession } from "@/src/state/session";
import { colors, radii, spacing, typography } from "@/src/theme";
import {
  allocateHelper,
  commitHelperSpend,
  decimalFromNumber,
  emptyHelper,
  interpret,
  quoteUsdInXlm,
  sendIfApproved,
  setHelperEnabled,
  setHelperFrozen,
  sweepHelper,
  todayIso,
  xlmToBroadcastNumber,
  type ContactRef,
  type Interpretation,
  type MoneySaveFile,
  type SendPlan,
} from "@/src/money";
import { loadMoneySave, writeMoneySave } from "@/src/money/store";
import { listEntries } from "@/src/wallet/address-book";
import { fetchFeeStats, recommendedMaxFeeStroops } from "@/src/wallet/network-fee";
import { fetchXlmDexPrice } from "@/src/wallet/horizon";
import { loadActiveKeypair } from "@/src/wallet/wallet-book";

export default function AssistantScreen() {
  const router = useRouter();
  const toast = useToast();
  const { wallet, rates } = useSession();
  const [text, setText] = useState("");
  const [save, setSave] = useState<MoneySaveFile | null>(null);
  const [contacts, setContacts] = useState<ContactRef[]>([]);
  const [rate, setRate] = useState<string | null>(
    rates.USD > 0 ? decimalFromNumber(rates.USD) : null,
  );
  const [feeStroops, setFeeStroops] = useState<number | null>(null);
  const [result, setResult] = useState<Interpretation | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [limitDraft, setLimitDraft] = useState("50");
  const [allocateDraft, setAllocateDraft] = useState("");

  const load = useCallback(async () => {
    const [file, entries] = await Promise.all([loadMoneySave(), listEntries("stellar")]);
    setSave(file);
    setLimitDraft(file.helper.enabled ? file.helper.weeklyLimitUsd : "50");
    setContacts(
      entries.map((e) => ({
        id: e.id,
        label: e.label,
        publicKey: e.publicKey,
        memo: e.defaultMemo ?? "",
        kind:
          e.kind === "exchange" || e.kind === "casino" || e.kind === "donation"
            ? e.kind
            : "private",
      })),
    );
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const persist = useCallback(async (next: MoneySaveFile) => {
    setSave(next);
    await writeMoneySave(next);
  }, []);

  const contextFor = useCallback(
    (file: MoneySaveFile) => ({
      contacts,
      coinbaseCardContactId: file.coinbaseCardContactId,
      rateUsdPerXlm: rate,
      feeStroops,
      helper: file.helper,
      today: todayIso(),
      bills: file.bills,
      paymentMethods: file.paymentMethods,
      nowMs: Date.now(),
    }),
    [contacts, feeStroops, rate],
  );

  const onAsk = useCallback(async () => {
    setAsking(true);
    try {
      const file = save ?? (await loadMoneySave());
      if (!save) setSave(file);
      setResult(interpret(text, contextFor(file)));
    } finally {
      setAsking(false);
    }
  }, [contextFor, save, text]);

  const onLookup = useCallback(async () => {
    setBusy(true);
    try {
      const [price, fee] = await Promise.all([fetchXlmDexPrice(), fetchFeeStats()]);
      const nextRate = decimalFromNumber(price.usd);
      const nextFee = fee ? Number(recommendedMaxFeeStroops(fee)) : null;
      setRate(nextRate);
      setFeeStroops(nextFee);
      if (save && text.trim()) {
        setResult(
          interpret(text, {
            ...contextFor(save),
            rateUsdPerXlm: nextRate,
            feeStroops: nextFee,
          }),
        );
      }
      toast.show("Rate and fee updated. Still waiting for Approve.", "success");
    } catch {
      toast.show("Rate lookup needs a connection. Your plan is unchanged.", "info");
    } finally {
      setBusy(false);
    }
  }, [contextFor, save, text, toast]);

  const onApproveSend = useCallback(
    async (plan: SendPlan) => {
      if (!wallet) {
        toast.show("Add a wallet seed to send XLM.", "info");
        router.push("/wallet-setup");
        return;
      }
      setBusy(true);
      try {
        const ok = await authenticate("Approve this XLM transfer");
        if (!ok) {
          toast.show("Approval cancelled. Nothing was sent.", "info");
          return;
        }
        const keypair = await loadActiveKeypair();
        if (!keypair) {
          toast.show("Add a wallet seed to send XLM.", "info");
          return;
        }
        const outcome = await sendIfApproved(
          plan,
          { ok: true, method: "biometric", at: Date.now() },
          async (input) => {
            const broadcast = await broadcastPayment({
              keypair,
              destination: input.destination,
              amountXlm: xlmToBroadcastNumber(input.amountXlm),
              memo: input.memo,
              kindId: input.kindId,
            });
            return broadcast.ok
              ? { ok: true, hash: broadcast.hash }
              : { ok: false, message: broadcast.message };
          },
        );
        if (outcome.ok && result?.type === "plan") {
          setResult({ type: "plan", plan: outcome.plan });
        }
        toast.show(outcome.message, outcome.ok ? "success" : "info");
      } finally {
        setBusy(false);
      }
    },
    [result?.type, router, toast, wallet],
  );

  const onApproveSetAside = useCallback(
    async (plan: SendPlan) => {
      if (!save) return;
      setBusy(true);
      try {
        const ok = await authenticate("Approve helper spending");
        if (!ok) {
          toast.show("Approval cancelled. Nothing was set aside.", "info");
          return;
        }
        const committed = commitHelperSpend(
          { ...plan, approval: { method: "biometric", at: Date.now() } },
          save.helper,
          todayIso(),
        );
        if (!committed.ok) {
          toast.show(committed.message, "info");
          return;
        }
        const next = { ...save, helper: committed.helper };
        await persist(next);
        setResult({ type: "plan", plan: committed.plan });
        toast.show(committed.message, "success");
      } finally {
        setBusy(false);
      }
    },
    [persist, save, toast],
  );

  const helper = save?.helper ?? emptyHelper(todayIso());
  const depositContact = contacts.find((c) => c.id === save?.coinbaseCardContactId) ?? null;
  const plan = result?.type === "plan" ? result.plan : null;
  const canSend =
    !!plan &&
    plan.blockers.length === 0 &&
    !plan.submitted &&
    (plan.intent === "send" || plan.intent === "card_topup");
  const canSetAside =
    !!plan && plan.intent === "helper_spend" && plan.blockers.length === 0 && !plan.submitted;

  return (
    <BiometricGate surface="wallet">
      <SafeAreaView edges={["top"]} style={styles.root} testID="assistant-screen">
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/wallet"))}
            hitSlop={12}
            testID="assistant-back"
          >
            <Feather name="arrow-left" size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.title}>Assistant</Text>
          <View style={{ width: 22 }} />
        </View>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.lede}>
            Type what you want. Nothing is sent until you tap Approve.
          </Text>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={'Try "send 20 XLM to Mom"'}
            placeholderTextColor={colors.textTertiary}
            style={styles.input}
            testID="assistant-input"
            autoCorrect={false}
          />
          <View style={styles.row}>
            <TouchableOpacity style={styles.primary} onPress={() => void onAsk()} testID="assistant-ask">
              {asking ? <ActivityIndicator color={colors.text} /> : <Text style={styles.primaryText}>Plan</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondary} onPress={() => void onLookup()} testID="assistant-lookup">
              <Text style={styles.secondaryText}>{busy ? "Looking up…" : "Look up rate"}</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.meta} testID="assistant-rate">
            {rate
              ? `Rate ${rate} USD per XLM${feeStroops != null ? ` · fee ${feeStroops} stroops` : ""}`
              : "No rate yet. XLM plans still work offline."}
          </Text>

          {result?.type === "clarify" ? <Text style={styles.card}>{result.message}</Text> : null}
          {result?.type === "bills" ? (
            <View style={styles.card} testID="assistant-bills">
              <Text style={styles.cardTitle}>{result.title}</Text>
              {result.lines.map((line) => (
                <Text key={line} style={styles.line}>
                  {line}
                </Text>
              ))}
              <TouchableOpacity onPress={() => router.push("/bills")}>
                <Text style={styles.link}>Open bills</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          {plan ? (
            <View style={styles.card} testID="assistant-plan">
              <Text style={styles.cardTitle}>
                {plan.submitted ? "Done" : "Review"}
              </Text>
              <Text style={styles.line}>{plan.summary}</Text>
              {plan.amountXlm ? (
                <Text style={styles.exact} testID="assistant-exact-xlm">
                  {plan.amountXlm} XLM
                  {plan.feeXlm ? ` + ${plan.feeXlm} XLM fee` : ""}
                </Text>
              ) : null}
              {plan.blockers.length > 0 ? (
                <Text style={styles.warn}>{blockerCopy(plan.blockers)}</Text>
              ) : null}
              {canSend ? (
                <TouchableOpacity
                  style={styles.primary}
                  disabled={busy}
                  onPress={() => void onApproveSend(plan)}
                  testID="assistant-approve-send"
                >
                  <Text style={styles.primaryText}>Approve and send</Text>
                </TouchableOpacity>
              ) : null}
              {canSetAside ? (
                <TouchableOpacity
                  style={styles.primary}
                  disabled={busy}
                  onPress={() => void onApproveSetAside(plan)}
                  testID="assistant-approve-spend"
                >
                  <Text style={styles.primaryText}>Approve set-aside</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}

          <Text style={styles.section}>Card deposit contact</Text>
          <Text style={styles.meta}>
            {depositContact
              ? `${depositContact.label} · memo ${depositContact.memo || "none"}`
              : "Pick the contact that holds your XLM deposit address and memo."}
          </Text>
          {contacts.map((c) => (
            <TouchableOpacity
              key={c.id}
              style={styles.choice}
              onPress={() => {
                if (!save) return;
                void persist({ ...save, coinbaseCardContactId: c.id });
              }}
              testID={`assistant-deposit-contact-${c.id}`}
            >
              <Text style={styles.line}>
                {save?.coinbaseCardContactId === c.id ? "● " : "○ "}
                {c.label}
              </Text>
            </TouchableOpacity>
          ))}

          <Text style={styles.section}>Helper spending</Text>
          <Text style={styles.meta}>
            Optional weekly cap on this phone. Freeze stops new set-asides.
          </Text>
          <Text style={styles.line} testID="assistant-helper-status">
            {helper.enabled
              ? `${helper.frozen ? "Frozen" : "On"} · spent $${helper.spentUsd} of $${helper.weeklyLimitUsd} · earmarked ${helper.allocatedXlm} XLM`
              : "Off"}
          </Text>
          <TextInput
            value={limitDraft}
            onChangeText={setLimitDraft}
            keyboardType="decimal-pad"
            placeholder="Weekly limit in USD"
            placeholderTextColor={colors.textTertiary}
            style={styles.input}
            testID="assistant-helper-limit"
          />
          <View style={styles.row}>
            <TouchableOpacity
              style={styles.secondary}
              onPress={() => {
                if (!save) return;
                try {
                  const nextHelper = setHelperEnabled(save.helper, !helper.enabled, limitDraft, todayIso());
                  void persist({ ...save, helper: nextHelper });
                } catch (e) {
                  toast.show(e instanceof Error ? e.message : "Set a weekly limit first.", "info");
                }
              }}
              testID="assistant-helper-toggle"
            >
              <Text style={styles.secondaryText}>{helper.enabled ? "Turn off" : "Turn on"}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondary}
              onPress={() => {
                if (!save) return;
                void persist({ ...save, helper: setHelperFrozen(save.helper, !helper.frozen) });
              }}
              testID="assistant-helper-freeze"
            >
              <Text style={styles.secondaryText}>{helper.frozen ? "Unfreeze" : "Freeze"}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.row}>
            <TextInput
              value={allocateDraft}
              onChangeText={setAllocateDraft}
              keyboardType="decimal-pad"
              placeholder="XLM to earmark"
              placeholderTextColor={colors.textTertiary}
              style={[styles.input, { flex: 1 }]}
              testID="assistant-helper-allocate-input"
            />
            <TouchableOpacity
              style={styles.secondary}
              onPress={() => {
                if (!save) return;
                try {
                  const nextHelper = allocateHelper(save.helper, allocateDraft);
                  setAllocateDraft("");
                  void persist({ ...save, helper: nextHelper });
                } catch (e) {
                  toast.show(e instanceof Error ? e.message : "Enter an XLM amount.", "info");
                }
              }}
              testID="assistant-helper-allocate"
            >
              <Text style={styles.secondaryText}>Earmark</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondary}
              onPress={() => {
                if (!save) return;
                const swept = sweepHelper(save.helper);
                void persist({ ...save, helper: swept.helper });
                toast.show(
                  swept.sweptXlm === "0"
                    ? "Nothing was earmarked."
                    : `Swept ${swept.sweptXlm} XLM back to your main balance.`,
                  "success",
                );
              }}
              testID="assistant-helper-sweep"
            >
              <Text style={styles.secondaryText}>Sweep</Text>
            </TouchableOpacity>
          </View>
          {rate && limitDraft ? (
            <Text style={styles.meta}>
              {previewLimit(limitDraft, rate)}
            </Text>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </BiometricGate>
  );
}

function blockerCopy(blockers: SendPlan["blockers"]): string {
  if (blockers.includes("needs_rate")) return "Look up the rate to see the exact XLM. Nothing has been sent.";
  if (blockers.includes("needs_contact")) return "Save a card-deposit contact (address and memo) first.";
  if (blockers.includes("needs_memo")) return "That exchange contact needs the deposit memo before it can be used.";
  if (blockers.includes("unknown_recipient")) return "No saved contact with that name.";
  if (blockers.includes("ambiguous_recipient")) return "More than one contact matches. Use the full name.";
  if (blockers.includes("needs_amount")) return "Include an amount, for example “top up my card with $25”.";
  if (blockers.includes("helper_frozen")) return "Helper spending is frozen.";
  if (blockers.includes("over_weekly_limit")) return "That is over the weekly helper limit.";
  if (blockers.includes("helper_disabled")) return "Turn on helper spending to set money aside.";
  if (blockers.includes("needs_payee")) return "This bill needs a Stellar address before XLM can pay it.";
  return "This plan is not ready.";
}

function previewLimit(limit: string, rate: string): string {
  try {
    const quote = quoteUsdInXlm(limit, rate, null);
    return `A $${limit} cap is about ${quote.amountXlm} XLM at this rate.`;
  } catch {
    return "";
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  title: { color: colors.text, fontSize: 22, fontWeight: "700" },
  body: { padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md },
  lede: { color: colors.textSecondary, fontSize: 20, lineHeight: 28 },
  input: {
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.input,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    fontSize: 20,
  },
  row: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  primary: {
    backgroundColor: colors.cyan,
    borderRadius: radii.button,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    alignItems: "center",
  },
  primaryText: { color: colors.background, fontWeight: "700" },
  secondary: {
    borderWidth: 1,
    borderColor: colors.borderGlow,
    borderRadius: radii.button,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  secondaryText: { color: colors.text, fontWeight: "600" },
  meta: { color: colors.textTertiary, fontSize: 16, lineHeight: 24 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardTitle: { ...typography.label, color: colors.text, fontWeight: "700", fontSize: 12 },
  line: { color: colors.text, fontSize: 20, lineHeight: 28 },
  exact: { color: colors.gold, fontSize: 20, fontWeight: "700", ...typography.mono },
  warn: { color: colors.gold, fontSize: 13, lineHeight: 18 },
  link: { color: colors.cyan, fontWeight: "700" },
  section: {
    color: colors.textSecondary,
    marginTop: spacing.lg,
    ...typography.label,
    fontSize: 13,
  },
  choice: { paddingVertical: 12 },
});
