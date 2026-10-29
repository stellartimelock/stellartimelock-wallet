// Bills the user types in themselves. No bank connection.
// Card rows keep nickname, brand, and last 4. Approve to Fill opens the
// biller page for Stellar Vault; XLM pay uses the same Approve-then-send
// path as every other transfer.

import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { Stack, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useToast } from "@/src/components/Toast";
import { openFinanceBills } from "@/src/money/finance-bridge";
import {
  CARD_BRANDS,
  buildCardFillRequest,
  emptyMoneySave,
  formatUsd,
  markBillPaid,
  parseBillsCsv,
  planBillXlmPayment,
  sanitizeBill,
  sanitizePaymentMethod,
  scheduleBill,
  sendIfApproved,
  todayIso,
  xlmToBroadcastNumber,
  type Bill,
  type CardBrand,
  type MoneySaveFile,
  type PayTiming,
  type PaymentMethod,
  type PlanContext,
} from "@/src/money";
import { syncBillReminders } from "@/src/money/reminders";
import { importMoneySave, loadMoneySave, writeMoneySave } from "@/src/money/store";
import { broadcastPayment } from "@/src/send/broadcast";
import { authenticate } from "@/src/security/biometric";
import { BiometricGate } from "@/src/security/BiometricGate";
import { useSession } from "@/src/state/session";
import { colors, radii, spacing, typography } from "@/src/theme";
import { openExternalUrl } from "@/src/utils/open-url";
import { decimalFromNumber } from "@/src/money/math";
import { loadActiveKeypair } from "@/src/wallet/wallet-book";

function nid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export default function BillsScreen() {
  const router = useRouter();
  const toast = useToast();
  const { wallet, rates } = useSession();
  const [save, setSave] = useState<MoneySaveFile>(emptyMoneySave());
  const [adding, setAdding] = useState(false);
  const [addingMethod, setAddingMethod] = useState(false);
  const [csv, setCsv] = useState("");
  const [draft, setDraft] = useState({
    name: "",
    amount: "",
    dueDate: "",
    autopay: false,
    payTiming: "due_date" as PayTiming,
    payUrl: "",
    payeeAddress: "",
    payeeMemo: "",
    reminderDaysBefore: "3",
    paymentMethodId: "",
  });
  const [methodDraft, setMethodDraft] = useState({
    kind: "card" as PaymentMethod["kind"],
    nickname: "",
    last4: "",
    brand: "visa" as CardBrand,
    vaultRef: "",
  });

  const persist = useCallback(async (next: MoneySaveFile) => {
    setSave(next);
    await writeMoneySave(next);
    await syncBillReminders(next.bills);
  }, []);

  useEffect(() => {
    void loadMoneySave().then((file) => {
      setSave(file);
      void syncBillReminders(file.bills);
    });
  }, []);

  const today = todayIso();
  const rate = rates.USD > 0 ? decimalFromNumber(rates.USD) : null;

  const onAddBill = useCallback(async () => {
    const now = Date.now();
    const parsed = sanitizeBill(
      {
        id: nid("bill"),
        name: draft.name,
        amount: draft.amount,
        dueDate: draft.dueDate,
        autopay: draft.autopay,
        payTiming: draft.payTiming,
        payUrl: draft.payUrl,
        payeeAddress: draft.payeeAddress,
        payeeMemo: draft.payeeMemo,
        reminderDaysBefore: Number(draft.reminderDaysBefore || "3"),
        paymentMethodId: draft.paymentMethodId || null,
        repeat: "none",
        createdAt: now,
        updatedAt: now,
      },
      now,
    );
    if (!parsed.ok) {
      toast.show(parsed.error, "info");
      return;
    }
    await persist({ ...save, bills: [parsed.bill, ...save.bills] });
    setDraft({
      name: "",
      amount: "",
      dueDate: "",
      autopay: false,
      payTiming: "due_date",
      payUrl: "",
      payeeAddress: "",
      payeeMemo: "",
      reminderDaysBefore: "3",
      paymentMethodId: "",
    });
    setAdding(false);
    toast.show("Bill saved on this phone.", "success");
  }, [draft, persist, save, toast]);

  const onAddMethod = useCallback(async () => {
    const now = Date.now();
    const base = {
      id: nid("pay"),
      nickname: methodDraft.nickname,
      createdAt: now,
      updatedAt: now,
    };
    const input =
      methodDraft.kind === "xlm"
        ? { ...base, kind: "xlm" as const }
        : {
            ...base,
            kind: methodDraft.kind,
            last4: methodDraft.last4,
            brand: methodDraft.brand,
            vaultRef: methodDraft.vaultRef,
            contactId: save.coinbaseCardContactId,
          };
    const parsed = sanitizePaymentMethod(input, now);
    if (!parsed.ok) {
      toast.show(parsed.error, "info");
      return;
    }
    await persist({ ...save, paymentMethods: [...save.paymentMethods, parsed.method] });
    setMethodDraft({ kind: "card", nickname: "", last4: "", brand: "visa", vaultRef: "" });
    setAddingMethod(false);
    toast.show("Payment method saved. Card numbers stay in Stellar Vault.", "success");
  }, [methodDraft, persist, save, toast]);

  const ingest = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (trimmed.startsWith("{")) {
        const imported = await importMoneySave(trimmed);
        if (!imported) {
          toast.show("That save has no bills in it.", "info");
          return;
        }
        setSave(imported);
        await syncBillReminders(imported.bills);
        toast.show(`Imported ${imported.bills.length} bills from the save file.`, "success");
        return;
      }
      const csvResult = parseBillsCsv(trimmed);
      if (csvResult.bills.length === 0) {
        toast.show(csvResult.errors[0]?.message ?? "Nothing to import.", "info");
        return;
      }
      const next = { ...save, bills: [...csvResult.bills, ...save.bills] };
      await persist(next);
      const extra = csvResult.errors.length ? ` ${csvResult.errors.length} rows skipped.` : "";
      toast.show(`Imported ${csvResult.bills.length} bills.${extra}`, "success");
    },
    [persist, save, toast],
  );

  const onPickFile = useCallback(async () => {
    const picked = await DocumentPicker.getDocumentAsync({
      type: ["text/csv", "text/comma-separated-values", "application/json", "text/plain", "*/*"],
      copyToCacheDirectory: true,
    });
    if (picked.canceled || !picked.assets?.[0]) return;
    try {
      const text = await FileSystem.readAsStringAsync(picked.assets[0].uri);
      await ingest(text);
    } catch {
      toast.show("Could not read that file.", "info");
    }
  }, [ingest, toast]);

  const payBill = useCallback(
    async (bill: Bill) => {
      const method = save.paymentMethods.find((m) => m.id === bill.paymentMethodId) ?? null;
      if (!method) {
        toast.show("Choose a payment method for this bill first.", "info");
        return;
      }
      if (method.kind === "card" || method.kind === "coinbase_card") {
        const ok = await authenticate("Approve to Fill this card");
        if (!ok) {
          toast.show("Approval cancelled. The pay page was not opened.", "info");
          return;
        }
        const fill = buildCardFillRequest({
          bill,
          method,
          approval: { method: "biometric", at: Date.now() },
        });
        if (!fill.ok) {
          toast.show(fill.message, "info");
          return;
        }
        toast.show(
          `Stellar Vault can fill ${fill.request.nickname} ••${fill.request.last4}.`,
          "success",
        );
        await openExternalUrl(fill.request.payUrl);
        return;
      }

      const planCtx: PlanContext = {
        contacts: [],
        coinbaseCardContactId: save.coinbaseCardContactId,
        rateUsdPerXlm: rate,
        feeStroops: null,
        helper: save.helper,
        today,
        bills: save.bills,
        paymentMethods: save.paymentMethods,
      };
      const plan = planBillXlmPayment(bill, planCtx);
      if (plan.blockers.length > 0 || !plan.amountXlm) {
        toast.show(plan.summary, "info");
        return;
      }
      if (!wallet) {
        toast.show("Add a wallet seed to pay with XLM.", "info");
        router.push("/wallet-setup");
        return;
      }
      const ok = await authenticate(`Approve XLM payment for ${bill.name}`);
      if (!ok) {
        toast.show("Approval cancelled. Nothing was sent.", "info");
        return;
      }
      const keypair = await loadActiveKeypair();
      if (!keypair) {
        toast.show("Add a wallet seed to pay with XLM.", "info");
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
      if (!outcome.ok) {
        toast.show(outcome.message, "info");
        return;
      }
      await persist({
        ...save,
        bills: save.bills.map((b) => (b.id === bill.id ? markBillPaid(b, today) : b)),
      });
      toast.show(outcome.message, "success");
    },
    [persist, rate, router, save, today, toast, wallet],
  );

  const upcoming = save.bills
    .map((bill) => ({ bill, schedule: scheduleBill(bill, today) }))
    .filter((row) => row.schedule.status !== "paid")
    .sort((a, b) => (a.bill.dueDate < b.bill.dueDate ? -1 : 1));

  return (
    <BiometricGate surface="bills">
      <SafeAreaView edges={["top"]} style={styles.root} testID="bills-screen">
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/wallet"))}
            hitSlop={12}
            testID="bills-back"
          >
            <Feather name="arrow-left" size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.title}>Bills</Text>
          <View style={{ width: 22 }} />
        </View>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={styles.card} testID="bills-finance-banner">
            <Text style={styles.cardTitle}>Finance owns bills</Text>
            <Text style={styles.meta}>
              This wallet is not the bills home. Open Finance when it is on the phone.
              The list below is a local copy.
            </Text>
            <TouchableOpacity
              style={styles.primary}
              onPress={() => {
                void (async () => {
                  const result = await openFinanceBills();
                  if (result === "missing") {
                    toast.show("Finance isn't installed yet.", "info");
                  }
                })();
              }}
              testID="bills-open-finance"
            >
              <Text style={styles.primaryText}>Open in Finance</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.lede}>
            Add bills yourself. Finance is the bills home. This list stays on the phone.
          </Text>

          {upcoming.length === 0 ? (
            <Text style={styles.empty} testID="bills-empty">
              No upcoming bills.
            </Text>
          ) : (
            upcoming.map(({ bill, schedule }) => {
              const method = save.paymentMethods.find((m) => m.id === bill.paymentMethodId);
              const xlmQuote =
                method?.kind === "xlm"
                  ? planBillXlmPayment(bill, {
                      contacts: [],
                      coinbaseCardContactId: save.coinbaseCardContactId,
                      rateUsdPerXlm: rate,
                      feeStroops: null,
                      helper: save.helper,
                      today,
                      bills: save.bills,
                      paymentMethods: save.paymentMethods,
                    })
                  : null;
              return (
                <View key={bill.id} style={styles.card} testID={`bill-${bill.id}`}>
                  <Text style={styles.cardTitle}>{bill.name}</Text>
                  <Text style={styles.line}>
                    ${formatUsd(bill.amount)} · due {bill.dueDate} · {schedule.status}
                  </Text>
                  <Text style={styles.meta}>
                    {method ? methodLabel(method) : "No payment method"} ·{" "}
                    {bill.payTiming === "now" ? "Pay now" : `Pay on ${schedule.payOn}`} ·{" "}
                    {bill.autopay ? "Autopay prepares it — you still approve" : "Manual"}
                    {schedule.reminderDue ? ` · reminder from ${schedule.remindOn}` : ""}
                  </Text>
                  {xlmQuote ? (
                    <Text style={styles.line} testID={`bill-${bill.id}-quote`}>
                      {xlmQuote.amountXlm
                        ? `Exact ${xlmQuote.amountXlm} XLM at ${xlmQuote.rateUsdPerXlm} USD/XLM, fee ${xlmQuote.feeXlm} XLM.`
                        : "Exact XLM waits on a live rate. Nothing is sent until you approve."}
                    </Text>
                  ) : null}
                  <View style={styles.row}>
                    {(["due_date", "now"] as const).map((timing) => (
                      <TouchableOpacity
                        key={timing}
                        style={[styles.chip, bill.payTiming === timing && styles.chipOn]}
                        onPress={() =>
                          void persist({
                            ...save,
                            bills: save.bills.map((b) =>
                              b.id === bill.id ? { ...b, payTiming: timing, updatedAt: Date.now() } : b,
                            ),
                          })
                        }
                        testID={`bill-${bill.id}-timing-${timing}`}
                      >
                        <Text style={styles.chipText}>{timing === "now" ? "Pay now" : "On due date"}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <View style={styles.methods}>
                    {save.paymentMethods.map((m) => (
                      <TouchableOpacity
                        key={m.id}
                        onPress={() =>
                          void persist({
                            ...save,
                            bills: save.bills.map((b) =>
                              b.id === bill.id ? { ...b, paymentMethodId: m.id, updatedAt: Date.now() } : b,
                            ),
                          })
                        }
                        testID={`bill-${bill.id}-method-${m.id}`}
                      >
                        <Text style={styles.meta}>
                          {bill.paymentMethodId === m.id ? "●" : "○"} {methodLabel(m)}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {(bill.payTiming === "now" || schedule.status === "due" || schedule.status === "overdue") ? (
                    <TouchableOpacity
                      style={styles.primary}
                      onPress={() => void payBill(bill)}
                      testID={`bill-${bill.id}-pay`}
                    >
                      <Text style={styles.primaryText}>
                        {method && method.kind !== "xlm" ? "Approve to Fill" : "Approve and pay"}
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <Text style={styles.meta}>Scheduled. A reminder fires before the due date.</Text>
                  )}
                  <TouchableOpacity
                    style={styles.secondary}
                    onPress={() =>
                      router.push({
                        pathname: "/create-vault",
                        params: { amount: bill.amount },
                      })
                    }
                    testID={`bill-${bill.id}-vault`}
                  >
                    <Text style={styles.secondaryText}>Lock this amount in a vault</Text>
                  </TouchableOpacity>
                </View>
              );
            })
          )}

          <TouchableOpacity style={styles.secondary} onPress={() => setAdding((v) => !v)} testID="bills-add-toggle">
            <Text style={styles.secondaryText}>{adding ? "Close" : "Add a bill"}</Text>
          </TouchableOpacity>
          {adding ? (
            <View style={styles.card}>
              <Field label="Name" value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })} testID="bills-name" />
              <Field label="Amount (USD)" value={draft.amount} onChangeText={(amount) => setDraft({ ...draft, amount })} testID="bills-amount" keyboardType="decimal-pad" />
              <Field label="Due date (YYYY-MM-DD)" value={draft.dueDate} onChangeText={(dueDate) => setDraft({ ...draft, dueDate })} testID="bills-due" />
              <Field label="Pay link" value={draft.payUrl} onChangeText={(payUrl) => setDraft({ ...draft, payUrl })} testID="bills-url" />
              <Field label="XLM payee address" value={draft.payeeAddress} onChangeText={(payeeAddress) => setDraft({ ...draft, payeeAddress })} testID="bills-payee" />
              <Field label="Memo" value={draft.payeeMemo} onChangeText={(payeeMemo) => setDraft({ ...draft, payeeMemo })} testID="bills-memo" />
              <Field label="Remind days before" value={draft.reminderDaysBefore} onChangeText={(reminderDaysBefore) => setDraft({ ...draft, reminderDaysBefore })} testID="bills-remind" keyboardType="number-pad" />
              <View style={styles.switchRow}>
                <Text style={styles.line}>Autopay</Text>
                <Switch
                  value={draft.autopay}
                  onValueChange={(autopay) => setDraft({ ...draft, autopay })}
                  testID="bills-autopay"
                />
              </View>
              <TouchableOpacity style={styles.primary} onPress={() => void onAddBill()} testID="bills-save">
                <Text style={styles.primaryText}>Save bill</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <Text style={styles.section}>PAYMENT METHODS</Text>
          <Text style={styles.meta}>
            Cards: nickname, last 4, and brand only. The real card stays in Stellar Vault.
          </Text>
          {save.paymentMethods.map((m) => (
            <Text key={m.id} style={styles.line} testID={`method-${m.id}`}>
              {methodLabel(m)}
            </Text>
          ))}
          <TouchableOpacity style={styles.secondary} onPress={() => setAddingMethod((v) => !v)} testID="bills-method-toggle">
            <Text style={styles.secondaryText}>{addingMethod ? "Close" : "Add payment method"}</Text>
          </TouchableOpacity>
          {addingMethod ? (
            <View style={styles.card}>
              <View style={styles.row}>
                {(["card", "xlm", "coinbase_card"] as const).map((kind) => (
                  <TouchableOpacity
                    key={kind}
                    style={[styles.chip, methodDraft.kind === kind && styles.chipOn]}
                    onPress={() => setMethodDraft({ ...methodDraft, kind })}
                    testID={`method-kind-${kind}`}
                  >
                    <Text style={styles.chipText}>{kind === "coinbase_card" ? "Card deposit" : kind === "xlm" ? "XLM" : "Card"}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Field label="Nickname" value={methodDraft.nickname} onChangeText={(nickname) => setMethodDraft({ ...methodDraft, nickname })} testID="method-nickname" />
              {methodDraft.kind !== "xlm" ? (
                <>
                  <Field label="Last 4" value={methodDraft.last4} onChangeText={(last4) => setMethodDraft({ ...methodDraft, last4 })} testID="method-last4" keyboardType="number-pad" />
                  <View style={styles.row}>
                    {CARD_BRANDS.map((brand) => (
                      <TouchableOpacity
                        key={brand}
                        style={[styles.chip, methodDraft.brand === brand && styles.chipOn]}
                        onPress={() => setMethodDraft({ ...methodDraft, brand })}
                      >
                        <Text style={styles.chipText}>{brand}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <Field
                    label="Stellar Vault card id"
                    value={methodDraft.vaultRef}
                    onChangeText={(vaultRef) => setMethodDraft({ ...methodDraft, vaultRef })}
                    testID="method-vault-ref"
                  />
                </>
              ) : null}
              <TouchableOpacity style={styles.primary} onPress={() => void onAddMethod()} testID="method-save">
                <Text style={styles.primaryText}>Save method</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <Text style={styles.section}>IMPORT</Text>
          <Text style={styles.meta}>
            Paste a CSV (name, amount, dueDate) or the money save file. Nothing is fetched from a bank.
          </Text>
          <TextInput
            value={csv}
            onChangeText={setCsv}
            placeholder="name,amount,dueDate"
            placeholderTextColor={colors.textTertiary}
            style={[styles.input, { minHeight: 80 }]}
            multiline
            testID="bills-csv"
          />
          <View style={styles.row}>
            <TouchableOpacity style={styles.secondary} onPress={() => void ingest(csv)} testID="bills-import-csv">
              <Text style={styles.secondaryText}>Import pasted</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondary} onPress={() => void onPickFile()} testID="bills-import-file">
              <Text style={styles.secondaryText}>Import file</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    </BiometricGate>
  );
}

function methodLabel(method: PaymentMethod): string {
  if (method.kind === "xlm") return method.nickname || "XLM";
  const brand = method.brand[0].toUpperCase() + method.brand.slice(1);
  return `${method.nickname} · ${brand} ••${method.last4}`;
}

function Field({
  label,
  value,
  onChangeText,
  testID,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  testID: string;
  keyboardType?: "decimal-pad" | "number-pad" | "default";
}) {
  return (
    <View>
      <Text style={styles.meta}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        style={styles.input}
        placeholderTextColor={colors.textTertiary}
        testID={testID}
        autoCorrect={false}
        keyboardType={keyboardType}
      />
    </View>
  );
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
  title: { color: colors.text, fontSize: 18, fontWeight: "700" },
  body: { padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.sm },
  lede: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
  empty: { color: colors.textTertiary, fontSize: 14 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardTitle: { color: colors.text, fontWeight: "700", fontSize: 16 },
  line: { color: colors.text, fontSize: 14, lineHeight: 20 },
  meta: { color: colors.textTertiary, fontSize: 12, lineHeight: 17 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  methods: { gap: 4 },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.chip,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipOn: { borderColor: colors.cyan, backgroundColor: colors.cyanMuted },
  chipText: { color: colors.text, fontSize: 12, fontWeight: "600" },
  primary: {
    backgroundColor: colors.cyan,
    borderRadius: radii.button,
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
    alignSelf: "flex-start",
  },
  secondaryText: { color: colors.text, fontWeight: "600" },
  section: { color: colors.textSecondary, marginTop: spacing.md, ...typography.label, fontSize: 11 },
  input: {
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.input,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 15,
  },
  switchRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
});
