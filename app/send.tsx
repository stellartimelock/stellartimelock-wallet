// Send (Transmission) screen — destination address + asset + amount
// form + LIVE Horizon broadcast.
//
// DESIGN CONTRACT:
//
//   1. The user picks the DESTINATION TYPE (Private / Exchange /
//      Casino / Donation). That single choice determines whether a
//      memo is required. There is NO automated address resolver,
//      NO Stellar.Expert lookup, and NO curated allow/deny list.
//      The user owns the outcome of their choice.
//
//   2. `broadcastPayment()` re-checks the memo gate for exchange /
//      casino destinations as defense-in-depth so a UI regression
//      cannot bypass it.
//
//   3. A persistent yellow banner shows above the memo field when
//      Exchange or Casino is selected: "⚠️ This address requires a
//      memo. Please enter the memo provided by the platform to
//      ensure your funds are not lost."
//
//   4. The donation chip auto-fills the project's Development Fund
//      address as a convenience — the chip does NOT gate submission.

import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import {
  broadcastPayment,
  type BroadcastFailure,
  type BroadcastResult,
} from "@/src/send/broadcast";
import {
  DestinationKindChips,
  type DestinationKindId,
} from "@/src/send/components/DestinationKindChips";
import { NetworkFeeBadge } from "@/src/send/components/NetworkFeeBadge";
import { AddressBookPicker } from "@/src/send/components/AddressBookPicker";
import { getActiveDeployment } from "@/src/wallet/contract-config";
import {
  checkExchangeMemo,
  findDeposits,
  type KnownDeposit,
} from "@/src/send/exchange-memo-gate";
import { DESTINATION_KINDS } from "@/src/send/components/DestinationKindChips";
import { loadKnownDeposits } from "@/src/swap/deposit-registry";
import { useSession } from "@/src/state/session";
import { useToast } from "@/src/components/Toast";
import { colors, radii, spacing, tileShadow, typography } from "@/src/theme";

// Hard-coded for the donation chip auto-fill only — does not gate submission.
const PROJECT_DONATION_ADDRESS =
  "GCB5OFIMXRDSC7PM4GOHQUIAHEKIG6T7JLTO3LGVVVNEXAA5JXANKPIC";

// 56 chars, starts with G, Base32 alphabet (no 0/1/8/I/L). Full SDK
// validation runs inside the broadcast helper.
const STELLAR_G_REGEX = /^G[A-Z2-7]{55}$/;

const ASSETS = [
  { id: "XLM", label: "XLM", subtitle: "Native Stellar Lumens" },
] as const;


export default function SendScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { wallet, rates } = useSession();
  const toast = useToast();
  const params = useLocalSearchParams<{
    to?: string;
    memo?: string;
    amount?: string;
    kind?: string;
    // When `contact` is present the destination came from a locked source
    // (saved contact picker OR vault-unlock "Send to X" CTA).
    contact?: string;
    /** Quick Settings "Send XLM" opens the existing favorites picker. */
    favorites?: string | string[];
  }>();
  const favoritesParam = Array.isArray(params.favorites)
    ? params.favorites[0]
    : params.favorites;
  const openFavorites = favoritesParam === "1";

  /** Browse-without-seed: explore the form freely; gate only at broadcast. */
  const requireSeedToSend = useCallback(() => {
    toast.show("Add a wallet seed to send XLM.", "info");
    router.push("/wallet-setup");
  }, [toast, router]);

  const [destination, setDestination] = useState<string>(params.to ?? "");
  const [amount, setAmount] = useState<string>(params.amount ?? "");
  const [kindId, setKindId] = useState<DestinationKindId>(
    // Route-param pre-fill for the Swap deposit → Send hand-off. Only
    // accepts the four known kinds; anything else falls back to the
    // safe default of "private". This keeps the manual memo gate
    // (exchange/casino/private/donation) intact when the swap flow
    // pre-selects "exchange" so the memo becomes mandatory.
    (params.kind === "exchange" ||
      params.kind === "casino" ||
      params.kind === "private" ||
      params.kind === "donation"
      ? (params.kind as DestinationKindId)
      : "private") as DestinationKindId,
  );
  const [assetId] = useState<string>("XLM");
  const [memo, setMemo] = useState<string>(params.memo ?? "");
  // Raw input + toggle derive the canonical XLM value for validation/submission.
  const [inputCurrency, setInputCurrency] = useState<"XLM" | "USD">("XLM");
  const xlmUsd = rates?.USD ?? 0;
  const [walletBalance, setWalletBalance] = useState<number>(0);
  useEffect(() => {
    if (!wallet) return;
    (async () => {
      try {
        const { fetchHorizonBalance } = await import("@/src/wallet/horizon");
        const b = await fetchHorizonBalance(wallet.publicKey);
        setWalletBalance(b.spendable ?? 0);
      } catch {
        /* leave 0 — MAX button just fills 0 */
      }
    })();
  }, [wallet]);

  // Opens a bottom sheet to pick a saved contact; auto-populates destination + memo + kind.
  const [addressBookOpen, setAddressBookOpen] = useState<boolean>(openFavorites);
  useEffect(() => {
    if (openFavorites) setAddressBookOpen(true);
  }, [openFavorites]);
  // Lock address + memo when loaded from a saved contact — stray keystrokes on
  // memo-locked exchange addresses are a common "lost funds" support ticket.
  const [lockedFromContact, setLockedFromContact] = useState<boolean>(
    !!params.contact,
  );
  const [lockedContactName, setLockedContactName] = useState<string | null>(
    params.contact ?? null,
  );

  // Confirmation modal — second tap is "yes I'm sure"; broadcast runs
  // after the second tap. We deliberately have TWO states (`confirming`
  // and `submitting`) so the modal can show a spinner while the live
  // submit is in flight.
  const [confirming, setConfirming] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Broadcast outcome — null until the user submits. Drives the final
  // "done" view (success hash + ledger, or error banner).
  const [outcome, setOutcome] = useState<BroadcastResult | BroadcastFailure | null>(null);

  const isValidAddress = useMemo(
    () => STELLAR_G_REGEX.test(destination.trim()),
    [destination],
  );

  // Probe Horizon so we can warn (not block) when the destination is
  // a valid G-address that has never been funded — CreateAccount will
  // activate it on send.
  const [destUnfunded, setDestUnfunded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const addr = destination.trim();
    if (!STELLAR_G_REGEX.test(addr)) {
      setDestUnfunded(false);
      return;
    }
    (async () => {
      try {
        const horizonBase = getActiveDeployment().horizonUrl.replace(/\/+$/, "");
        const resp = await fetch(`${horizonBase}/accounts/${addr}`);
        if (cancelled) return;
        setDestUnfunded(resp.status === 404);
      } catch {
        if (!cancelled) setDestUnfunded(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [destination]);

  // Amount validation — parsed to a positive XLM number with sane cap.
  const amountValue = useMemo(() => {
    const n = parseFloat(amount.replace(/[, ]/g, ""));
    if (!Number.isFinite(n) || n <= 0) return null;
    const xlm =
      inputCurrency === "USD"
        ? xlmUsd > 0
          ? n / xlmUsd
          : NaN
        : n;
    if (!Number.isFinite(xlm) || xlm <= 0 || xlm > 1_000_000_000) return null;
    return xlm;
  }, [amount, inputCurrency, xlmUsd]);

  const conversionHint = useMemo(() => {
    const n = parseFloat(amount.replace(/[, ]/g, ""));
    if (!Number.isFinite(n) || n <= 0) return null;
    if (xlmUsd <= 0) return null;
    if (inputCurrency === "USD") {
      const xlm = n / xlmUsd;
      return `≈ ${xlm.toFixed(4).replace(/\.?0+$/, "")} XLM`;
    }
    const usd = n * xlmUsd;
    return `≈ $${usd.toFixed(2)} USD`;
  }, [amount, inputCurrency, xlmUsd]);

  // Manual memo gate — user's `kindId` is the sole authority (exchange/casino require memo).
  const memoRequired = useMemo(
    () => kindId === "exchange" || kindId === "casino",
    [kindId],
  );
  const memoMissing = useMemo(
    () => memoRequired && memo.trim().length === 0,
    [memoRequired, memo],
  );

  // Swap deposit addresses this wallet created (with their memos). A send
  // to one of them without its memo is hard-blocked whatever chip is set.
  const [knownDeposits, setKnownDeposits] = useState<KnownDeposit[]>([]);
  useEffect(() => {
    let alive = true;
    void loadKnownDeposits().then((list) => {
      if (alive) setKnownDeposits(list);
    });
    return () => {
      alive = false;
    };
  }, []);
  const exchangeMemoBlock = useMemo(() => {
    const gate = checkExchangeMemo({
      destination: destination.trim(),
      memo,
      kindId: "private",
      knownDeposits,
    });
    return gate.ok ? null : gate.message;
  }, [destination, memo, knownDeposits]);

  // Swap / exchange sends: the type is locked to Exchange. Triggered by the
  // swap hand-off (kind=exchange) or by a destination that is a swap deposit
  // address this wallet created.
  const isKnownDeposit = useMemo(
    () => findDeposits(knownDeposits, destination.trim()).length > 0,
    [knownDeposits, destination],
  );
  const exchangeLocked = params.kind === "exchange" || isKnownDeposit;
  useEffect(() => {
    if (exchangeLocked && kindId !== "exchange") setKindId("exchange");
  }, [exchangeLocked, kindId]);

  // Final submit gate — combines every input.
  const submitDisabled = useMemo(() => {
    if (submitting || outcome?.ok === true) return true;
    if (!isValidAddress) return true;
    if (amountValue === null) return true;
    if (memoMissing) return true;        // ← memo gate
    if (exchangeMemoBlock) return true;  // ← swap deposit address w/o memo
    return false;
  }, [submitting, outcome, isValidAddress, amountValue, memoMissing, exchangeMemoBlock]);


  const onPaste = useCallback(async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (text && text.trim()) setDestination(text.trim());
    } catch {
      /* clipboard unavailable */
    }
  }, []);

  // Clipboard content truncated to Stellar's 28-char MEMO_TEXT limit.
  const onPasteMemo = useCallback(async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (text && text.trim()) setMemo(text.trim().slice(0, 28));
    } catch {
      /* clipboard unavailable */
    }
  }, []);

  const onClearMemo = useCallback(() => setMemo(""), []);

  const onSubmit = useCallback(() => {
    if (submitDisabled) return;
    // Browse-without-seed: let them fill the form, gate only here.
    if (!wallet?.secretSeed) {
      requireSeedToSend();
      return;
    }
    setConfirming(true);
  }, [submitDisabled, wallet, requireSeedToSend]);

  const onConfirm = useCallback(async () => {
    // Final guard at submit-time — should be unreachable but cheap.
    if (!wallet?.secretSeed || amountValue === null || !isValidAddress) {
      setConfirming(false);
      if (!wallet?.secretSeed) requireSeedToSend();
      return;
    }
    setConfirming(false);
    setSubmitting(true);
    try {
      const result = await broadcastPayment({
        keypair: wallet,
        destination: destination.trim(),
        amountXlm: amountValue,
        memo: memo.trim(),
        kindId,
      });
      setOutcome(result);
      if (result.ok && kindId === "donation") {
        router.push({
          pathname: "/homeless-trillionaire",
          params: { amount: amountValue.toString() },
        });
      }
    } catch (e) {
      // Broadcast failure — surface as a form-level outcome and keep
      // the user on the form so they can adjust and retry.
      setOutcome({
        ok: false,
        code: "unknown",
        message:
          e instanceof Error
            ? e.message
            : "Transaction could not be signed or submitted.",
      });
    } finally {
      setSubmitting(false);
    }
  }, [
    wallet,
    amountValue,
    isValidAddress,
    destination,
    memo,
    kindId,
    requireSeedToSend,
    router,
  ]);

  const onClearDestination = useCallback(() => {
    // Clear releases the saved-contact lock so the user can pick another contact.
    setDestination("");
    setMemo("");
    setKindId("private");
    setLockedFromContact(false);
    setLockedContactName(null);
  }, []);

  const onSendAnother = useCallback(() => {
    setOutcome(null);
    setDestination("");
    setAmount("");
    setMemo("");
    setKindId("private");
    setLockedFromContact(false);
    setLockedContactName(null);
  }, []);


  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.headerBar} testID="send-header">
        <TouchableOpacity
          style={styles.headerBtn}
          onPress={() => router.back()}
          accessibilityLabel="Close send screen"
          testID="send-close"
        >
          <Feather name="chevron-left" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Send</Text>
        <View style={styles.headerBtn} />
      </View>

      <KeyboardAvoidingView
        style={styles.flex1}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + 140 },
          ]}
          keyboardShouldPersistTaps="handled"
          testID="send-scroll"
        >
          {/* 1.6.16: destination type is the first thing on the screen,
              in a high-contrast card, so the choice is never buried. */}
          <View style={styles.kindSection} testID="send-kind-section">
            <Text style={styles.kindSectionLabel}>DESTINATION TYPE</Text>
            <DestinationKindChips
              value={kindId}
              disabled={lockedFromContact || exchangeLocked}
              onChange={(next) => {
                // Locked from a saved contact — kind is part of the
                // contact payload; Clear is required before changing it.
                if (lockedFromContact) return;
                // Swap / known exchange deposit: always Exchange so the
                // memo requirement can never be switched off.
                if (exchangeLocked) return;
                // Clear auto-filled donation address when switching away from Donation chip.
                const wasDonation = kindId === "donation";
                const stillHoldsDonationAddr =
                  destination.trim() === PROJECT_DONATION_ADDRESS;
                if (wasDonation && next !== "donation" && stillHoldsDonationAddr) {
                  setDestination("");
                }
                setKindId(next);
                // Donation auto-fill (ASSERTION D part 3): selecting the
                // "Donation" chip pre-populates the destination with the
                // project's official development-fund Stellar address.
                // The user can still overwrite it manually. We only
                // auto-fill when the destination is empty so we don't
                // clobber an in-progress paste.
                if (next === "donation" && destination.trim().length === 0) {
                  setDestination(PROJECT_DONATION_ADDRESS);
                }
              }}
            />
            {exchangeLocked ? (
              <View style={styles.contactLockChip} testID="send-kind-exchange-lock">
                <Feather name="lock" size={12} color={colors.teal} />
                <Text style={styles.contactLockChipText} numberOfLines={2}>
                  Locked to Exchange / Custodial: this is a swap deposit, so its memo is required.
                </Text>
              </View>
            ) : null}
            <Text style={styles.kindHint}>
              This is for your records only — changing it cannot override
              an address that is blocked by Stellar.Expert.
            </Text>
          </View>

          <View style={[styles.labelRow, styles.labelSpace]}>
            <Text style={styles.label}>RECIPIENT ADDRESS</Text>
            <TouchableOpacity
              onPress={() => {
                if (lockedFromContact) return;
                setAddressBookOpen(true);
              }}
              style={[styles.bookBtn, lockedFromContact && { opacity: 0.45 }]}
              testID="send-open-address-book"
              activeOpacity={0.7}
              disabled={lockedFromContact}
              accessibilityState={{ disabled: lockedFromContact }}
            >
              <Feather name="book-open" size={12} color={colors.cyan} />
              <Text style={styles.bookBtnText}>Address Book</Text>
            </TouchableOpacity>
          </View>
          <View
            style={[
              styles.inputCard,
              lockedFromContact && styles.inputCardLocked,
            ]}
          >
            <TextInput
              value={destination}
              onChangeText={setDestination}
              placeholder="G..."
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="characters"
              autoCorrect={false}
              spellCheck={false}
              editable={!lockedFromContact}
              selectTextOnFocus={!lockedFromContact}
              style={[
                styles.inputText,
                lockedFromContact && styles.inputTextLocked,
              ]}
              testID="send-destination-input"
            />
            <View style={styles.inputActions}>
              {lockedFromContact ? (
                <TouchableOpacity
                  onPress={onClearDestination}
                  style={styles.inlineBtn}
                  testID="send-destination-clear"
                >
                  <Feather name="x" size={14} color={colors.textSecondary} />
                  <Text style={styles.inlineBtnText}>Clear</Text>
                </TouchableOpacity>
              ) : (
                <>
                  {/* Hide clear on Donation chip — clearing auto-fill while chip stays active is confusing. */}
                  {destination.length > 0 && kindId !== "donation" && (
                    <TouchableOpacity
                      onPress={onClearDestination}
                      style={styles.inlineBtn}
                      testID="send-destination-clear"
                    >
                      <Feather name="x" size={16} color={colors.textSecondary} />
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    onPress={onPaste}
                    style={styles.inlineBtn}
                    testID="send-destination-paste"
                  >
                    <Feather name="clipboard" size={16} color={colors.textSecondary} />
                    <Text style={styles.inlineBtnText}>Paste</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
          {lockedFromContact ? (
            <View style={styles.contactLockChip} testID="send-contact-lock-chip">
              <Feather name="lock" size={12} color={colors.teal} />
              <Text style={styles.contactLockChipText} numberOfLines={1}>
                Loaded from address book
                {lockedContactName ? ` · ${lockedContactName}` : ""}
              </Text>
            </View>
          ) : null}
          {destination.length > 0 && !isValidAddress && (
            <Text style={styles.errorHint} testID="send-address-invalid">
              Stellar addresses are 56 characters starting with &quot;G&quot;.
            </Text>
          )}
          {isValidAddress && destUnfunded ? (
            <View style={styles.unfundedWarnBanner} testID="send-unfunded-warn">
              <Text style={styles.unfundedWarnText}>
                This account doesn&apos;t exist yet. The transaction will create
                it (1 XLM minimum).
              </Text>
            </View>
          ) : null}


          <Text style={[styles.label, styles.labelSpace]}>ASSET</Text>
          {ASSETS.map((a) => (
            <View
              key={a.id}
              style={[styles.assetRow, a.id === assetId && styles.assetRowActive]}
              testID={`send-asset-${a.id}`}
            >
              <View style={styles.assetIconCircle}>
                <Text style={styles.assetIconText}>{a.id}</Text>
              </View>
              <View style={styles.flex1}>
                <Text style={styles.assetLabel}>{a.label}</Text>
                <Text style={styles.assetSubtitle}>{a.subtitle}</Text>
              </View>
              <Feather name="check" size={16} color={colors.cyan} />
            </View>
          ))}

          <View style={styles.labelRow}>
            <Text style={styles.label}>AMOUNT</Text>
            <View style={styles.currencyToggle} testID="send-currency-toggle">
              <TouchableOpacity
                onPress={() => {
                  if (inputCurrency === "XLM") return;
                  const n = parseFloat(amount.replace(/[, ]/g, ""));
                  if (Number.isFinite(n) && n > 0 && xlmUsd > 0) {
                    setAmount(
                      (n / xlmUsd).toFixed(7).replace(/\.?0+$/, ""),
                    );
                  }
                  setInputCurrency("XLM");
                }}
                style={[
                  styles.currencyChip,
                  inputCurrency === "XLM" && styles.currencyChipActive,
                ]}
                testID="send-currency-xlm"
              >
                <Text
                  style={[
                    styles.currencyChipText,
                    inputCurrency === "XLM" && styles.currencyChipTextActive,
                  ]}
                >
                  XLM
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  if (inputCurrency === "USD") return;
                  if (xlmUsd <= 0) return; // rates not loaded yet
                  const n = parseFloat(amount.replace(/[, ]/g, ""));
                  if (Number.isFinite(n) && n > 0) {
                    setAmount((n * xlmUsd).toFixed(2));
                  }
                  setInputCurrency("USD");
                }}
                disabled={xlmUsd <= 0}
                style={[
                  styles.currencyChip,
                  inputCurrency === "USD" && styles.currencyChipActive,
                  xlmUsd <= 0 && { opacity: 0.4 },
                ]}
                testID="send-currency-usd"
              >
                <Text
                  style={[
                    styles.currencyChipText,
                    inputCurrency === "USD" && styles.currencyChipTextActive,
                  ]}
                >
                  USD
                </Text>
              </TouchableOpacity>
            </View>
          </View>
          <View style={styles.inputCard}>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              placeholder={inputCurrency === "USD" ? "$0.00" : "0.00"}
              placeholderTextColor={colors.textTertiary}
              keyboardType="decimal-pad"
              style={styles.inputText}
              testID="send-amount-input"
            />
            <TouchableOpacity
              onPress={() => {
                // MAX = spendable balance minus the minimum-balance
                // reserve (1 XLM base + trustlines) minus a generous
                // fee buffer (0.001 XLM = 10× the p90 max fee we bid).
                // The user can shave this down manually if they've
                // opened extra trustlines and know their reserve.
                const spendable = walletBalance;
                const feeBuffer = 0.001;
                const reserve = 1.0; // Stellar base account reserve
                const maxXlm = Math.max(0, spendable - reserve - feeBuffer);
                if (inputCurrency === "USD" && xlmUsd > 0) {
                  const maxUsd = maxXlm * xlmUsd;
                  setAmount(maxUsd.toFixed(2));
                } else {
                  setAmount(maxXlm.toFixed(7).replace(/\.?0+$/, ""));
                }
              }}
              style={styles.maxBtn}
              testID="send-max-btn"
              accessibilityLabel="Fill maximum sendable amount"
            >
              <Text style={styles.maxBtnText}>MAX</Text>
            </TouchableOpacity>
            <Text style={styles.inputSuffix}>{inputCurrency}</Text>
          </View>
          {conversionHint ? (
            <Text
              style={styles.conversionHint}
              testID="send-conversion-hint"
            >
              {conversionHint}
            </Text>
          ) : null}
          <Text style={styles.availableHint} testID="send-available-hint">
            Available: {walletBalance.toFixed(7).replace(/\.?0+$/, "")} XLM
            {xlmUsd > 0
              ? ` · ≈ $${(walletBalance * xlmUsd).toFixed(2)}`
              : ""}
          </Text>
          {amount.length > 0 && amountValue === null && (
            <Text style={styles.errorHint} testID="send-amount-invalid">
              Enter a positive amount.
            </Text>
          )}

          {exchangeMemoBlock ? (
            <View style={styles.memoWarnBanner} testID="send-exchange-memo-block">
              <Text style={styles.memoWarnText}>{"\u26A0\uFE0F "}{exchangeMemoBlock}</Text>
            </View>
          ) : null}
          {memoRequired && memoMissing ? (
            <View style={styles.memoWarnBanner} testID="send-memo-warn-banner">
              <Text style={styles.memoWarnText}>
                {lockedFromContact
                  ? "\u26A0\uFE0F This contact has no memo. Tap Clear, then edit the contact in Address Book to add the deposit memo before sending."
                  : "\u26A0\uFE0F This address requires a memo. Please enter the memo provided by the platform to ensure your funds are not lost."}
              </Text>
            </View>
          ) : null}

          <View style={styles.labelRow}>
            <Text style={styles.label}>
              MEMO {memoRequired ? "(REQUIRED)" : "(OPTIONAL)"}
            </Text>
            <NetworkFeeBadge mode="compact" testID="send-network-fee-badge" />
          </View>
          <View
            style={[
              styles.inputCard,
              memoRequired && memoMissing && !lockedFromContact && styles.inputCardError,
              lockedFromContact && styles.inputCardLocked,
            ]}
          >
            <TextInput
              value={memo}
              onChangeText={setMemo}
              placeholder={
                memoRequired
                  ? "Memo is REQUIRED — paste your deposit memo from the platform"
                  : "Add a memo if required by the recipient"
              }
              placeholderTextColor={colors.textTertiary}
              maxLength={28}
              editable={!lockedFromContact}
              style={[
                styles.inputText,
                lockedFromContact && styles.inputTextLocked,
              ]}
              testID="send-memo-input"
            />
            {!lockedFromContact && (
              <View style={styles.inputActions}>
                {memo.length > 0 && (
                  <TouchableOpacity
                    onPress={onClearMemo}
                    style={styles.inlineBtn}
                    testID="send-memo-clear"
                  >
                    <Feather name="x" size={16} color={colors.textSecondary} />
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  onPress={onPasteMemo}
                  style={styles.inlineBtn}
                  testID="send-memo-paste"
                >
                  <Feather name="clipboard" size={16} color={colors.textSecondary} />
                  <Text style={styles.inlineBtnText}>Paste</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
          {lockedFromContact ? (
            memo.trim().length > 0 ? (
              <Text
                style={styles.memoPrefillHint}
                testID="send-memo-prefill-hint"
              >
                ✓ Memo pre-filled from saved contact. Tap Clear to edit.
              </Text>
            ) : null
          ) : memoRequired && memoMissing ? (
            <Text style={styles.errorHint} testID="send-memo-required-error">
              Memo is required for exchange &amp; casino deposits.
            </Text>
          ) : !memoRequired ? (
            <Text style={styles.kindHint}>
              Private wallets do not require a memo. You have selected the
              destination type — you own the outcome.
            </Text>
          ) : null}

          {outcome?.ok === true && (
            <View style={styles.successBanner} testID="send-success">
              <Feather name="check-circle" size={16} color={colors.cyan} />
              <View style={styles.flex1}>
                <Text style={styles.successTitle}>Sent on the Stellar network</Text>
                <Text
                  style={styles.successHash}
                  selectable
                  testID="send-success-hash"
                >
                  {outcome.hash}
                </Text>
                {outcome.ledger > 0 && (
                  <Text style={styles.successMeta}>
                    Ledger {outcome.ledger.toLocaleString()}
                  </Text>
                )}
                {/* Uses active-deployment explorer base so testnet vs mainnet resolves correctly. */}
                <TouchableOpacity
                  style={styles.linkBtn}
                  onPress={() =>
                    Linking.openURL(
                      `${getActiveDeployment().explorerTxBase}${outcome.hash}`,
                    )
                  }
                  testID="send-success-explorer"
                >
                  <Feather
                    name="external-link"
                    size={14}
                    color={colors.cyan}
                  />
                  <Text style={styles.linkBtnText}>
                    View on Stellar Expert
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.linkBtn}
                  onPress={onSendAnother}
                  testID="send-another"
                >
                  <Feather name="plus" size={14} color={colors.cyan} />
                  <Text style={styles.linkBtnText}>Send another</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          {outcome && outcome.ok === false && (
            <View style={styles.errorBanner} testID="send-failure">
              <Feather name="alert-circle" size={16} color={colors.danger} />
              <View style={styles.flex1}>
                <Text style={styles.errorTitle}>Send failed</Text>
                <Text style={styles.errorMessage}>{outcome.message}</Text>
                <TouchableOpacity
                  style={styles.linkBtn}
                  onPress={() => setOutcome(null)}
                  testID="send-retry"
                >
                  <Feather name="rotate-ccw" size={14} color={colors.cyan} />
                  <Text style={styles.linkBtnText}>Try again</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </ScrollView>

        <TouchableOpacity
          onPress={() => router.push("/tap-pay")}
          style={styles.sendExtra}
          testID="wallet-tap-pay-button"
          accessibilityRole="button"
          accessibilityLabel="Request or pay. A tap alone never sends."
        >
          <Feather name="smartphone" size={16} color={colors.cyan} />
          <View style={styles.sendExtraCopy}>
            <Text style={styles.sendExtraTitle}>Request or pay</Text>
            <Text style={styles.sendExtraSub}>A tap alone never sends</Text>
          </View>
          <Feather name="chevron-right" size={16} color={colors.textTertiary} />
        </TouchableOpacity>

        <View
          style={[styles.stickyBar, { paddingBottom: insets.bottom + spacing.md }]}
        >
          {/* Pinned above the button: the destination type that will be used. */}
          <View style={styles.kindPinned} testID="send-kind-pinned">
            <Feather
              name={exchangeLocked ? "lock" : "check-circle"}
              size={16}
              color={colors.cyan}
            />
            <Text style={styles.kindPinnedText} numberOfLines={1}>
              Sending to:{" "}
              <Text style={styles.kindPinnedValue}>
                {DESTINATION_KINDS.find((k) => k.id === kindId)?.label ?? kindId}
              </Text>
              {memoRequired ? " · memo required" : ""}
            </Text>
          </View>
          <TouchableOpacity
            style={[
              styles.submitBtn,
              submitDisabled && styles.submitBtnDisabled,
            ]}
            onPress={onSubmit}
            disabled={submitDisabled}
            activeOpacity={0.85}
            testID="send-submit"
            accessibilityRole="button"
            accessibilityState={{ disabled: submitDisabled }}
          >
            {submitting ? (
              <ActivityIndicator color={colors.textInverse} />
            ) : (
              <>
                <Feather
                  name="send"
                  size={16}
                  color={colors.textInverse}
                />
                <Text style={styles.submitBtnText}>
                  {memoMissing ? "Memo required" : "Review & send"}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {confirming && (
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard} testID="send-confirm-modal">
            <Text style={styles.modalTitle}>Confirm send</Text>
            <Text style={styles.modalLine}>
              <Text style={styles.modalLineLabel}>To: </Text>
              {destination.slice(0, 10)}…{destination.slice(-6)}
            </Text>
            <Text style={styles.modalLine}>
              <Text style={styles.modalLineLabel}>Amount: </Text>
              {amountValue !== null
                ? `${amountValue.toFixed(7).replace(/\.?0+$/, "")} XLM`
                : `${amount} XLM`}
              {inputCurrency === "USD" && amountValue !== null
                ? ` (from $${parseFloat(amount || "0").toFixed(2)})`
                : ""}
            </Text>
            {memo.trim().length > 0 && (
              <Text style={styles.modalLine}>
                <Text style={styles.modalLineLabel}>Memo: </Text>
                {memo}
              </Text>
            )}
            <Text style={styles.modalNote}>
              This is a LIVE Stellar mainnet transaction. Once submitted
              it cannot be reversed.
            </Text>
            {destUnfunded ? (
              <Text style={styles.modalUnfundedNote} testID="send-confirm-unfunded">
                This account doesn&apos;t exist yet. The transaction will create
                it (1 XLM minimum).
              </Text>
            ) : null}
            <View style={styles.modalActions}>
              <TouchableOpacity
                onPress={() => setConfirming(false)}
                style={[styles.modalBtn, styles.modalBtnGhost]}
                testID="send-confirm-cancel"
              >
                <Text style={styles.modalBtnGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onConfirm}
                style={[styles.modalBtn, styles.modalBtnPrimary]}
                testID="send-confirm-yes"
              >
                <Text style={styles.modalBtnPrimaryText}>Confirm &amp; send</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      <AddressBookPicker
        visible={addressBookOpen}
        onClose={() => setAddressBookOpen(false)}
        onPick={(entry) => {
          // Lock address + memo — accidental edits on exchange addresses lose funds.
          setDestination(entry.publicKey);
          setMemo(entry.defaultMemo ?? "");
          setKindId(entry.kind);
          setLockedFromContact(true);
          setLockedContactName(entry.label ?? null);
          setAddressBookOpen(false);
        }}
      />
    </SafeAreaView>
  );
}



const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex1: { flex: 1 },
  headerBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  headerBtn: {
    width: 44, height: 44, alignItems: "center", justifyContent: "center",
    borderRadius: radii.md,
  },
  headerTitle: { color: colors.text, fontSize: 16, ...typography.heading },
  scrollContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  maxBtn: {
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.tealMuted,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.teal,
  },
  maxBtnText: { color: colors.teal, fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  availableHint: {
    color: colors.textSecondary, fontSize: 12,
    marginTop: 4, marginLeft: 4, ...typography.mono,
  },
  currencyToggle: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 2,
  },
  currencyChip: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: radii.pill,
  },
  currencyChipActive: {
    backgroundColor: colors.cyan,
  },
  currencyChipText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  currencyChipTextActive: {
    color: colors.textInverse,
  },
  conversionHint: {
    color: colors.cyan,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 4,
    marginLeft: 4,
    ...typography.mono,
  },
  label: {
    color: colors.textTertiary, fontSize: 11, ...typography.label,
    marginBottom: spacing.xs,
  },
  labelRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  bookBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.cyanMuted,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.borderGlow,
  },
  bookBtnText: { color: colors.cyan, fontSize: 11, fontWeight: "700" },
  inputCardError: {
    borderColor: colors.danger,
    backgroundColor: colors.dangerMuted,
  },
  inputCardLocked: {
    borderColor: colors.teal,
    backgroundColor: colors.tealMuted,
  },
  inputTextLocked: {
    color: colors.textSecondary,
  },
  contactLockChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: colors.tealMuted,
  },
  contactLockChipText: {
    color: colors.teal,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.2,
    flexShrink: 1,
  },
  memoPrefillHint: {
    color: colors.teal,
    fontSize: 12,
    marginTop: spacing.xs,
    fontWeight: "600",
  },
  labelSpace: { marginTop: spacing.lg },
  inputCard: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: colors.surfaceFrost,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    ...tileShadow(),
  },
  inputText: {
    flex: 1, color: colors.text, fontSize: 14, ...typography.mono,
    paddingVertical: 8,
  },
  inputSuffix: { color: colors.textSecondary, fontSize: 13, ...typography.label },
  inputActions: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 },
  inlineBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceElevated,
    flexShrink: 0,
  },
  inlineBtnText: { color: colors.textSecondary, fontSize: 12, fontWeight: "600" },
  errorHint: { color: colors.danger, fontSize: 12, marginTop: spacing.xs },
  memoWarnBanner: {
    backgroundColor: colors.goldMuted,
    borderColor: colors.gold,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    padding: spacing.sm + 2,
    marginTop: spacing.md,
  },
  memoWarnText: {
    color: colors.gold,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
  },
  unfundedWarnBanner: {
    backgroundColor: colors.goldMuted,
    borderColor: colors.gold,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    padding: spacing.sm + 2,
    marginTop: spacing.sm,
  },
  unfundedWarnText: {
    color: colors.gold,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
  },
  kindSection: {
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 2,
    borderColor: colors.cyan,
    backgroundColor: colors.surfaceFrost,
    gap: 8,
  },
  kindSectionLabel: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 1,
  },
  kindPinned: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: spacing.sm,
  },
  kindPinnedText: { color: colors.textSecondary, fontSize: 15, flexShrink: 1 },
  kindPinnedValue: { color: colors.text, fontWeight: "800" },
  kindHint: {
    color: colors.textTertiary, fontSize: 11,
    marginTop: spacing.xs, lineHeight: 16,
  },
  assetRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  assetRowActive: { borderColor: colors.teal, backgroundColor: colors.tealMuted },
  assetIconCircle: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: "center", justifyContent: "center",
    backgroundColor: colors.surfaceElevated,
  },
  assetIconText: { color: colors.teal, fontSize: 11, fontWeight: "700" },
  assetLabel: { color: colors.text, fontSize: 14, fontWeight: "600" },
  assetSubtitle: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  sendExtra: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.xs,
    paddingVertical: 8,
    paddingHorizontal: spacing.sm,
  },
  sendExtraCopy: { flex: 1 },
  sendExtraTitle: { color: colors.text, fontSize: 14, fontWeight: "700" },
  sendExtraSub: { color: colors.textSecondary, fontSize: 12, marginTop: 1 },
  stickyBar: {
    backgroundColor: colors.background,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
    paddingHorizontal: spacing.lg, paddingTop: spacing.md,
  },
  submitBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, minHeight: 48,
    paddingHorizontal: spacing.lg, borderRadius: radii.md,
    backgroundColor: colors.teal,
  },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnProhibited: { backgroundColor: colors.danger, opacity: 1 },
  submitBtnText: { color: colors.textInverse, fontSize: 15, fontWeight: "600" },
  modalBackdrop: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  modalCard: {
    width: "100%", backgroundColor: colors.surfaceFrost,
    borderRadius: radii.lg, padding: spacing.lg, gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    ...tileShadow(),
  },
  modalTitle: { color: colors.text, fontSize: 16, fontWeight: "700", marginBottom: 4 },
  modalLine: { color: colors.text, fontSize: 13, lineHeight: 18 },
  modalLineLabel: { color: colors.textSecondary },
  modalNote: {
    color: colors.gold, fontSize: 12, lineHeight: 17, marginTop: spacing.sm,
  },
  modalUnfundedNote: {
    color: colors.gold, fontSize: 12, lineHeight: 17, fontWeight: "700",
  },
  modalActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  modalBtn: {
    flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center",
    borderRadius: radii.md,
  },
  modalBtnGhost: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  modalBtnGhostText: { color: colors.text, fontSize: 14, fontWeight: "600" },
  modalBtnPrimary: { backgroundColor: colors.teal },
  modalBtnPrimaryText: { color: colors.textInverse, fontSize: 14, fontWeight: "600" },
  successBanner: {
    flexDirection: "row", alignItems: "flex-start", gap: 10,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.tealMuted,
    borderLeftWidth: 3, borderLeftColor: colors.teal,
  },
  successTitle: { color: colors.text, fontSize: 13, fontWeight: "700" },
  successHash: {
    color: colors.textSecondary, fontSize: 11, ...typography.mono,
    marginTop: 4, lineHeight: 16,
  },
  successMeta: { color: colors.textTertiary, fontSize: 11, marginTop: 2 },
  errorBanner: {
    flexDirection: "row", alignItems: "flex-start", gap: 10,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.dangerMuted,
    borderLeftWidth: 3, borderLeftColor: colors.danger,
  },
  errorTitle: { color: colors.text, fontSize: 13, fontWeight: "700" },
  errorMessage: {
    color: colors.textSecondary, fontSize: 12, marginTop: 2, lineHeight: 17,
  },
  linkBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    marginTop: spacing.sm,
  },
  linkBtnText: { color: colors.cyan, fontSize: 12, fontWeight: "600" },
});
