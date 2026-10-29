// @CONTEXT: 3-step fixed-rate swap wizard using SimpleSwap v3 REST API.
// Any supported currency → any other the provider lists (XLM→any, any→XLM,
// any→any). User signs and broadcasts the pay-in manually — keys never leave device.

import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { Stack, router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import QRCode from "react-native-qrcode-svg";
import { SafeAreaView } from "react-native-safe-area-context";

import { useToast } from "@/src/components/Toast";
import { AddressBookPicker } from "@/src/send/components/AddressBookPicker";
import { useSession } from "@/src/state/session";
import {
  fetchSwapCreate,
  fetchSwapCurrencies,
  fetchSwapEstimate,
  fetchSwapRange,
  fetchSwapSourceRoutes,
  isSwapApiKeyConfigured,
  resolvedPairSide,
  type CreateResp,
  type CurrencyEntry,
  type QuoteResp,
  type SwapSourceRoutes,
} from "@/src/swap/simpleswap-client";
import {
  describeSwapFee,
  formatFeePercent,
} from "@/src/swap/fee-tier-config";
import {
  amountWithinRange,
  selectSwapRoute,
  type RouteSelection,
} from "@/src/swap/routes";
import { rememberDeposit } from "@/src/swap/deposit-registry";
import {
  broadcastPayment,
  type BroadcastOutcome,
} from "@/src/send/broadcast";
import { checkExchangeMemo } from "@/src/send/exchange-memo-gate";
import { xlmToBroadcastNumber } from "@/src/money/math";
import { colors, radii, spacing, tileShadow, typography } from "@/src/theme";
import {
  getAddressHint,
  getAddressRule,
  isValidAddress,
} from "@/src/utils/crypto-address";
import { fetchHorizonBalance } from "@/src/wallet/horizon";
import {
  formatUsd,
  tokenToUsd,
  usePrices,
  type Token as PriceToken,
} from "@/src/utils/prices";

// Featured currencies — the pill row users see first. Ordered per PM.
// Notes:
//  • Bare tickers only — simpleswap-client resolves each to SimpleSwap's
//    (ticker, network) composite (e.g. "usdt" → "usdt:eth") via its
//    preferred-network map, so this file never needs to know network codes.
const QUICK: { ticker: string; label: string; hint?: string }[] = [
  { ticker: "xlm", label: "XLM", hint: "Stellar Lumens" },
  { ticker: "sol", label: "SOL", hint: "Solana" },
  { ticker: "btc", label: "BTC", hint: "Bitcoin" },
  { ticker: "eth", label: "ETH", hint: "Ethereum" },
  { ticker: "ltc", label: "LTC", hint: "Litecoin" },
  { ticker: "xrp", label: "XRP", hint: "Ripple" },
  { ticker: "ada", label: "ADA", hint: "Cardano" },
  { ticker: "usdt", label: "USDT", hint: "Tether (ERC-20)" },
  { ticker: "usdc", label: "USDC", hint: "USD Coin (ERC-20)" },
];

function currencyLabel(ticker: string): string {
  return QUICK.find((q) => q.ticker === ticker)?.label ?? ticker.toUpperCase();
}

type WizardStep = 1 | 2 | 3;

/** Map thrown/network failures to a user-facing swap message (never raw HTTP). */
function friendlySwapError(e: unknown, fallback: string): string {
  if (e instanceof Error) {
    const msg = e.message || "";
    if (/application not found/i.test(msg)) {
      return "Swap service temporarily unavailable. Please try again later.";
    }
    if (
      /temporarily unavailable|network request failed|failed to fetch|networkerror/i.test(
        msg,
      )
    ) {
      return "Swap service temporarily unavailable. Please try again later.";
    }
    if (/not configured|api key/i.test(msg)) {
      return msg.includes("API key")
        ? "Swap API key not configured."
        : "Swap not configured.";
    }
    // Prefer client-provided friendly messages; strip raw "path → status:" shapes.
    if (!/→\s*\d{3}/.test(msg) && !/^\d{3}\b/.test(msg)) {
      return msg || fallback;
    }
  }
  return fallback;
}


function CurrencySideCard({
  side,
  ticker,
  entry,
  onPickQuick,
  onOpen,
}: {
  side: "from" | "to";
  ticker: string;
  entry: CurrencyEntry | undefined;
  onPickQuick: (ticker: string) => void;
  onOpen: () => void;
}) {
  const prefix = side === "from" ? "swap-from" : "swap-to";
  return (
    <>
      <Text style={styles.label}>{side === "from" ? "YOU SEND" : "YOU RECEIVE"}</Text>
      <View style={styles.card} testID={`${prefix}-card`}>
        <View style={styles.pillRow}>
          {QUICK.map((f) => {
            const active = f.ticker === ticker;
            return (
              <TouchableOpacity
                key={`${side}-${f.ticker}`}
                onPress={() => onPickQuick(f.ticker)}
                style={[styles.pill, active && styles.pillActive]}
                testID={
                  side === "to"
                    ? `swap-featured-${f.ticker}`
                    : `${prefix}-featured-${f.ticker}`
                }
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${side === "from" ? "Send" : "Receive"} ${f.label}`}
              >
                <Text style={[styles.pillText, active && styles.pillTextActive]}>
                  {f.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <TouchableOpacity
          onPress={onOpen}
          style={styles.pickerRow}
          testID={side === "to" ? "swap-open-picker" : `${prefix}-open-picker`}
          accessibilityLabel={
            side === "from"
              ? "Choose the currency you send"
              : "Choose the currency you receive"
          }
        >
          <Feather name="search" size={16} color={colors.cyan} />
          <Text style={styles.pickerText}>
            {entry
              ? `${currencyLabel(ticker)} · ${entry.name}${
                  entry.protocol ? ` · ${entry.protocol}` : ""
                }`
              : `${currencyLabel(ticker)} — tap to search all currencies`}
          </Text>
          <Feather name="chevron-right" size={18} color={colors.textTertiary} />
        </TouchableOpacity>
      </View>
    </>
  );
}

export default function SwapScreen() {
  const toast = useToast();
  const { wallet, currency: sessionFiat, rates } = useSession();

  const [step, setStep] = useState<WizardStep>(1);

  // External-source refund address. XLM sends refund to the in-app wallet.
  const [refundAddress, setRefundAddress] = useState<string>("");
  const [refundExtraId, setRefundExtraId] = useState<string>("");

  const [amount, setAmount] = useState<string>("");
  const [fromCurrency, setFromCurrency] = useState<string>("xlm");
  const [toCurrency, setToCurrency] = useState<string>("sol");
  const [payoutAddress, setPayoutAddress] = useState<string>("");
  const [payoutExtraId, setPayoutExtraId] = useState<string>("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSide, setPickerSide] = useState<"from" | "to">("to");
  const [pickerSearch, setPickerSearch] = useState("");
  const [sourceRoutes, setSourceRoutes] = useState<SwapSourceRoutes | null>(null);
  const [routesLoading, setRoutesLoading] = useState(false);
  const [routesError, setRoutesError] = useState<string | null>(null);
  const [pairMin, setPairMin] = useState<string | null>(null);
  const [pairMax, setPairMax] = useState<string | null>(null);
  const [rangeLoading, setRangeLoading] = useState(false);

  // Vault unlock handoff: ?amount and ?toCurrency pre-fill once (ref-guarded).
  const searchParams = useLocalSearchParams<{
    amount?: string;
    toCurrency?: string;
  }>();
  const _swapPrefillAppliedRef = React.useRef(false);
  useEffect(() => {
    if (_swapPrefillAppliedRef.current) return;
    const preAmt =
      typeof searchParams.amount === "string" ? searchParams.amount : "";
    const preTicker =
      typeof searchParams.toCurrency === "string"
        ? searchParams.toCurrency.toLowerCase().trim()
        : "";
    if (!preAmt && !preTicker) return;
    if (preAmt && /^[0-9]+(\.[0-9]+)?$/.test(preAmt)) setAmount(preAmt);
    if (preTicker && /^[a-z0-9-]{2,24}$/.test(preTicker)) {
      setToCurrency(preTicker);
    }
    setFromCurrency("xlm");
    _swapPrefillAppliedRef.current = true;
  }, [searchParams.amount, searchParams.toCurrency]);

  // Address book is Solana-only; other chains lack a network taxonomy in contacts.
  const [contactsPickerOpen, setContactsPickerOpen] = useState(false);
  const [contactsPickerTarget, setContactsPickerTarget] = useState<
    "payout" | "refund"
  >("payout");

  // MAX_RESERVE_XLM covers Stellar fee + SimpleSwap minimum-swap safety margin.
  const MAX_RESERVE_XLM = 1;
  const [spendable, setSpendable] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState<boolean>(false);
  useEffect(() => {
    if (!wallet) return;
    let cancelled = false;
    (async () => {
      setBalanceLoading(true);
      try {
        const b = await fetchHorizonBalance(wallet.publicKey);
        if (!cancelled) setSpendable(b.spendable ?? 0);
      } catch {
        if (!cancelled) setSpendable(null);
      } finally {
        if (!cancelled) setBalanceLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wallet]);

  const maxSendable = spendable == null ? null : Math.max(0, spendable - MAX_RESERVE_XLM);
  const canFillMax = maxSendable != null && maxSendable > 0;
  const onFillMax = useCallback(() => {
    if (!canFillMax || maxSendable == null) return;
    // Preserve 7 decimals (Stellar precision) but trim trailing zeros.
    const s = maxSendable
      .toFixed(7)
      .replace(/\.?0+$/, "");
    setAmount(s);
  }, [canFillMax, maxSendable]);

  const [allCurrencies, setAllCurrencies] = useState<CurrencyEntry[]>([]);
  const [currenciesLoading, setCurrenciesLoading] = useState(true);
  const [currenciesError, setCurrenciesError] = useState<string | null>(null);
  const swapKeyConfigured = isSwapApiKeyConfigured();

  useEffect(() => {
    (async () => {
      setCurrenciesLoading(true);
      setCurrenciesError(null);
      if (!swapKeyConfigured) {
        setCurrenciesError("Swap API key not configured.");
        setCurrenciesLoading(false);
        return;
      }
      try {
        const currencies = await fetchSwapCurrencies();
        setAllCurrencies(currencies);
      } catch (e) {
        setCurrenciesError(
          friendlySwapError(
            e,
            "Swap service temporarily unavailable. Please try again later.",
          ),
        );
        /* featured currencies still work as a fallback list */
      } finally {
        setCurrenciesLoading(false);
      }
    })();
  }, [swapKeyConfigured]);

  // Destinations the provider lists for the currency the user is sending.
  useEffect(() => {
    if (!swapKeyConfigured) {
      setSourceRoutes(null);
      setRoutesError(null);
      setRoutesLoading(false);
      return undefined;
    }
    let cancelled = false;
    setRoutesLoading(true);
    setRoutesError(null);
    (async () => {
      try {
        const routes = await fetchSwapSourceRoutes(fromCurrency);
        if (!cancelled) setSourceRoutes(routes);
      } catch (e) {
        if (!cancelled) {
          setSourceRoutes(null);
          setRoutesError(
            friendlySwapError(
              e,
              "Couldn't check which currencies this pair can reach. You can still request a quote.",
            ),
          );
        }
      } finally {
        if (!cancelled) setRoutesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fromCurrency, swapKeyConfigured]);

  // A refund or payout address belongs to one chain. Drop it when that side changes.
  const previousFromRef = React.useRef(fromCurrency);
  const previousToRef = React.useRef(toCurrency);
  useEffect(() => {
    if (previousFromRef.current !== fromCurrency) {
      previousFromRef.current = fromCurrency;
      setRefundAddress("");
      setRefundExtraId("");
    }
  }, [fromCurrency]);
  useEffect(() => {
    if (previousToRef.current !== toCurrency) {
      previousToRef.current = toCurrency;
      setPayoutAddress("");
      setPayoutExtraId("");
    }
  }, [toCurrency]);

  const [quote, setQuote] = useState<QuoteResp | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteFetchedAt, setQuoteFetchedAt] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreateResp | null>(null);
  // Deposit-screen mandatory confirmation. User must self-attest they've
  // verified the destination address + memo on their target wallet
  // before we let them copy the pay-in details. Protects against typos
  // in the destination address that would send funds to the wrong place.
  const [verifiedDestination, setVerifiedDestination] = useState(false);
  // QR modal — user can display the pay-in address as a QR code for
  // scanning from an external wallet. Only revealed AFTER the safety
  // check has been ticked; otherwise the deposit address is still
  // masked in the parent card and rendering a scannable QR would
  // defeat the gate.
  const [qrOpen, setQrOpen] = useState(false);
  // Swap auto-send (XLM source): confirm sheet -> the wallet signs and
  // submits the payment to SimpleSwap's deposit address WITH the memo
  // SimpleSwap returned. The user never copies a memo by hand.
  const [autoSendConfirm, setAutoSendConfirm] = useState(false);
  const [autoSending, setAutoSending] = useState(false);
  const [autoSendOutcome, setAutoSendOutcome] = useState<BroadcastOutcome | null>(null);

  // Live "now" clock — ticks every second while on Step 3 so the quote
  // countdown re-renders without a manual refresh loop. Guarded to only
  // tick while on step 3 to avoid unnecessary re-renders elsewhere.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (step !== 3) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [step]);

  const amountValue = parseFloat(amount);
  const amountValid = Number.isFinite(amountValue) && amountValue > 0;

  const { prices: livePrices } = usePrices();
  const usdCaption = useCallback(
    (ticker: string, tokenAmount: number): string | null => {
      const upper = ticker.toUpperCase();
      if (upper !== "XLM" && upper !== "SOL") return null;
      if (!Number.isFinite(tokenAmount) || tokenAmount <= 0) return null;
      const usd = tokenToUsd(livePrices, upper as PriceToken, tokenAmount);
      if (usd == null) return null;
      return `≈ ${formatUsd(usd)} USD`;
    },
    [livePrices],
  );

  const fromIsXlm = fromCurrency === "xlm";
  const toIsXlm = toCurrency === "xlm";
  const effectivePayoutAddress: string = toIsXlm
    ? wallet?.publicKey ?? ""
    : payoutAddress;
  const effectivePayoutExtraId: string = toIsXlm ? "" : payoutExtraId;

  const pickerCurrencies = useMemo(() => {
    const map = new Map<string, CurrencyEntry>();
    for (const quick of QUICK) {
      map.set(quick.ticker, {
        ticker: quick.ticker,
        name: quick.hint || quick.label,
        enabled: true,
        protocol: "",
        image: "",
        extraIdName: "",
      });
    }
    for (const entry of allCurrencies) map.set(entry.ticker, entry);
    return [...map.values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
  }, [allCurrencies]);

  const selectedEntry = useMemo(
    () => pickerCurrencies.find((c) => c.ticker === toCurrency),
    [pickerCurrencies, toCurrency],
  );
  const selectedFromEntry = useMemo(
    () => pickerCurrencies.find((c) => c.ticker === fromCurrency),
    [pickerCurrencies, fromCurrency],
  );
  const targetLabel = currencyLabel(toCurrency);
  const sendLabel = currencyLabel(fromCurrency);
  const requiresMemo = !toIsXlm && !!selectedEntry?.extraIdName;
  const requiresRefundMemo = !fromIsXlm && !!selectedFromEntry?.extraIdName;

  const routeSelection = useMemo((): RouteSelection | null => {
    const fromTicker = fromCurrency.trim().toLowerCase();
    const toTicker = toCurrency.trim().toLowerCase();
    if (!fromTicker || !toTicker || fromTicker === toTicker) {
      return selectSwapRoute({
        fromTicker,
        toTicker,
        fromNetwork: fromTicker,
        toNetwork: toTicker,
        destinations: [],
        displayFrom: fromCurrency,
        displayTo: toCurrency,
      });
    }
    if (!sourceRoutes || sourceRoutes.requestedTicker !== fromTicker) return null;
    const toSide = resolvedPairSide(toCurrency);
    return selectSwapRoute({
      fromTicker: sourceRoutes.fromTicker,
      toTicker: toSide.ticker,
      fromNetwork: sourceRoutes.fromNetwork,
      toNetwork: toSide.network,
      destinations: sourceRoutes.destinations,
      displayFrom: fromCurrency,
      displayTo: toCurrency,
    });
  }, [fromCurrency, toCurrency, sourceRoutes]);

  const feeTier = describeSwapFee(fromCurrency, toCurrency);
  const feeTierLabel =
    feeTier.tier === "heavy"
      ? `Fee: Heavy (Bitcoin tax) ${formatFeePercent(feeTier.feePercent)}`
      : `Fee: ${feeTier.label} ${formatFeePercent(feeTier.feePercent)}`;

  const routeKey = routeSelection?.ok
    ? `${routeSelection.route.fromTicker}:${routeSelection.route.fromNetwork}->${routeSelection.route.toTicker}:${routeSelection.route.toNetwork}`
    : "";

  useEffect(() => {
    if (!routeKey) {
      setPairMin(null);
      setPairMax(null);
      setRangeLoading(false);
      return undefined;
    }
    let cancelled = false;
    setPairMin(null);
    setPairMax(null);
    setRangeLoading(true);
    (async () => {
      try {
        const range = await fetchSwapRange(fromCurrency, toCurrency);
        if (cancelled) return;
        setPairMin(range.min);
        setPairMax(range.max);
      } catch {
        if (!cancelled) {
          setPairMin(null);
          setPairMax(null);
        }
      } finally {
        if (!cancelled) setRangeLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [routeKey, fromCurrency, toCurrency]);

  const rangeStatus = amountValid
    ? amountWithinRange(amountValue, pairMin, pairMax)
    : { belowMinimum: false, aboveMaximum: false };

  const addressLooksValid = payoutAddress.trim().length > 0
    ? isValidAddress(toCurrency, payoutAddress)
    : false;
  const rule = getAddressRule(toCurrency);
  const showAddressWarning =
    !toIsXlm &&
    payoutAddress.trim().length >= 3 &&
    rule != null &&
    !addressLooksValid;

  const refundLooksValid =
    !fromIsXlm && refundAddress.trim().length > 0
      ? isValidAddress(fromCurrency, refundAddress)
      : false;
  const refundWarning =
    !fromIsXlm &&
    refundAddress.trim().length >= 3 &&
    !refundLooksValid;

  // XLM sends are funded by this wallet. Other currencies are deposited
  // from an external wallet, so there is no in-app balance to check.
  const hasSufficientBalance = (() => {
    if (!fromIsXlm) return true;
    if (!amountValid) return false;
    if (spendable == null) return false;
    // 0.001 XLM buffer for network fee (10× the p90 max fee).
    return amountValue + 0.001 <= spendable;
  })();

  const pairBlocksContinue =
    routeSelection?.ok === false || (routesLoading && routeSelection == null);
  const canContinueStep1 = (() => {
    if (!swapKeyConfigured) return false;
    if (!amountValid) return false;
    if (pairBlocksContinue) return false;
    if (routeKey && rangeLoading) return false;
    if (rangeStatus.belowMinimum || rangeStatus.aboveMaximum) return false;
    const payoutOk = toIsXlm
      ? !!wallet?.publicKey
      : payoutAddress.trim().length > 3 && !showAddressWarning;
    const refundOk = fromIsXlm
      ? !!wallet?.publicKey
      : refundAddress.trim().length > 3 && !refundWarning;
    return payoutOk && refundOk && hasSufficientBalance;
  })();

  // @CONTEXT: Cached-rate estimator for Step 2. Uses session XLM→USD rate + static ratios for whitelist. Real SimpleSwap quote fetched on Step 3.
  const ESTIMATE_SUPPORTED = useMemo(
    () => new Set(["xlm", "sol", "ltc", "xrp", "ada", "usdt", "usdc"]),
    [],
  );
  const cachedEstimate = useMemo(() => {
    if (!amountValid) return null;
    const toKey = toCurrency.toLowerCase();
    const fromKey = fromCurrency.toLowerCase();
    if (!ESTIMATE_SUPPORTED.has(toKey)) return null;
    const XLM_USD = rates?.USD;
    if (!XLM_USD || XLM_USD <= 0) return null;
    // @CONTEXT: Estimate uses the live session XLM rate and the live
    // Coinbase SOL price (from usePrices). Unknown tickers fall back
    // to the XLM rate as an approximation.
    const APPROX_USD: Record<string, number> = {
      xlm: XLM_USD,
      sol: livePrices?.sol_usd ?? 0,
    };

    const fromUsd = APPROX_USD[fromKey] ?? XLM_USD;
    const toUsd = APPROX_USD[toKey] ?? XLM_USD;
    if (toUsd <= 0) return null;
    const totalUsd = amountValue * fromUsd;
    const targetAmount = totalUsd / toUsd;
    return {
      amount: targetAmount,
      rate: fromUsd / toUsd, // 1 fromKey ≈ N toKey
    };
  }, [amountValid, amountValue, fromCurrency, toCurrency, rates, livePrices, ESTIMATE_SUPPORTED]);

  const xlmFiatHint = (() => {
    if (!amountValid) return null;
    const fiatPref: "USD" | "EUR" = sessionFiat === "EUR" ? "EUR" : "USD";
    const rate = fiatPref === "USD" ? rates.USD : rates.EUR;
    if (!Number.isFinite(rate) || rate <= 0) return null;
    const sym = fiatPref === "USD" ? "$" : "€";
    return `${sym}${(amountValue * rate).toFixed(2)}`;
  })();

  const goToReview = useCallback(() => {
    if (!canContinueStep1) return;
    setStep(2);
  }, [canContinueStep1]);

  const goToQuote = useCallback(async () => {
    setStep(3);
    setQuote(null);
    setCreated(null);
    setQuoteLoading(true);
    try {
      const q = await fetchSwapEstimate({
        from_currency: fromCurrency,
        to_currency: toCurrency,
        amount_from: amountValue,
      });
      // Sanitize any raw provider noise that slipped through.
      if (q.detail && /application not found/i.test(q.detail)) {
        setQuote({
          ok: false,
          stage: "provider",
          detail: "Swap service temporarily unavailable. Please try again later.",
        });
        setQuoteFetchedAt(null);
      } else {
        setQuote(q);
        setQuoteFetchedAt(q.ok ? Date.now() : null);
      }
    } catch (e) {
      setQuote({
        ok: false,
        stage: "network",
        detail: friendlySwapError(
          e,
          "Swap service temporarily unavailable. Please try again later.",
        ),
      });
      setQuoteFetchedAt(null);
    } finally {
      setQuoteLoading(false);
    }
  }, [amountValue, fromCurrency, toCurrency]);

  // Silent quote refresh — fetches a new quote in-place without hopping
  // steps. Used both by the countdown auto-refresh and the manual
  // "Refresh quote" button. Also refreshes `rate_id` — the fixed-rate
  // lock token — since the previous one may have expired.
  const refreshQuoteSilently = useCallback(async () => {
    setQuoteLoading(true);
    try {
      const q = await fetchSwapEstimate({
        from_currency: fromCurrency,
        to_currency: toCurrency,
        amount_from: amountValue,
      });
      if (q.detail && /application not found/i.test(q.detail)) {
        setQuote({
          ok: false,
          stage: "provider",
          detail: "Swap service temporarily unavailable. Please try again later.",
        });
        setQuoteFetchedAt(null);
      } else {
        setQuote(q);
        setQuoteFetchedAt(q.ok ? Date.now() : null);
      }
    } catch (e) {
      setQuote({
        ok: false,
        stage: "network",
        detail: friendlySwapError(
          e,
          "Swap service temporarily unavailable. Please try again later.",
        ),
      });
      setQuoteFetchedAt(null);
    } finally {
      setQuoteLoading(false);
    }
  }, [amountValue, fromCurrency, toCurrency]);

  const onConfirmCreate = useCallback(async () => {
    if (!quote?.ok) return;
    if (!quote.rate_id) {
      toast.show("Quote expired — refreshing before you continue.", "error");
      refreshQuoteSilently();
      return;
    }
    // Guard payout address client-side — empty/malformed values yield opaque SimpleSwap 400s.
    const payoutAddr = effectivePayoutAddress.trim();
    if (!payoutAddr) {
      toast.show(
        toIsXlm
          ? "Wallet not ready yet — wait a moment and try again."
          : "Enter a destination address before continuing.",
        "error",
      );
      return;
    }
    if (!toIsXlm && getAddressRule(toCurrency) && !isValidAddress(toCurrency, payoutAddr)) {
      toast.show("Destination address doesn't look valid for this network.", "error");
      return;
    }
    // SimpleSwap requires a refund address. XLM refunds return to this
    // wallet. Any other source refunds to the address the user is sending from.
    const refundAddr = fromIsXlm
      ? wallet?.publicKey?.trim() ?? ""
      : refundAddress.trim();
    if (!refundAddr) {
      toast.show(
        fromIsXlm
          ? "Connect your XLM wallet before creating a swap — needed as the refund address."
          : `Enter the ${sendLabel} address you're sending from — needed if the swap is refunded.`,
        "error",
      );
      return;
    }
    if (!fromIsXlm && getAddressRule(fromCurrency) && !isValidAddress(fromCurrency, refundAddr)) {
      toast.show(`Refund address doesn't look valid for ${sendLabel}.`, "error");
      return;
    }
    setCreating(true);
    try {
      const c = await fetchSwapCreate({
        from_currency: fromCurrency,
        to_currency: toCurrency,
        amount_from: amountValue,
        payout_address: payoutAddr,
        payout_extra_id: effectivePayoutExtraId.trim() || undefined,
        refund_address: refundAddr,
        refund_extra_id: fromIsXlm ? undefined : refundExtraId.trim() || undefined,
        rate_id: quote.rate_id,
      });
      if (c.detail && /application not found/i.test(c.detail)) {
        const msg = "Swap service temporarily unavailable. Please try again later.";
        setCreated({ ok: false, stage: "provider", detail: msg });
        toast.show(msg, "error");
      } else {
        setCreated(c);
        setAutoSendOutcome(null);
        if (!c.ok) {
          toast.show(c.detail || "Swap creation failed.", "error");
        } else {
          toast.show("Deposit address generated.", "success");
          // Remember the deposit address + memo so ANY later send to it
          // (Send screen, address book, assistant) is hard-blocked
          // without the memo. See src/send/exchange-memo-gate.ts.
          if (fromIsXlm && c.payin_address) {
            void rememberDeposit({
              address: c.payin_address,
              memo: c.payin_extra_id ?? null,
              provider: "simpleswap",
              exchangeId: c.transaction_id,
              createdAt: Math.floor(Date.now() / 1000),
            });
          }
        }
      }
    } catch (e) {
      const msg = friendlySwapError(
        e,
        "Swap service temporarily unavailable. Please try again later.",
      );
      setCreated({ ok: false, stage: "network", detail: msg });
      toast.show(msg, "error");
    } finally {
      setCreating(false);
    }
  }, [
    quote,
    fromIsXlm,
    toIsXlm,
    fromCurrency,
    toCurrency,
    amountValue,
    effectivePayoutAddress,
    effectivePayoutExtraId,
    sendLabel,
    wallet,
    refundAddress,
    refundExtraId,
    toast,
    refreshQuoteSilently,
  ]);

  const resetWizard = useCallback(() => {
    setStep(1);
    setQuote(null);
    setQuoteFetchedAt(null);
    setCreated(null);
    setPayoutAddress("");
    setPayoutExtraId("");
    setRefundAddress("");
    setRefundExtraId("");
    setAmount("");
    setVerifiedDestination(false);
    setAutoSendConfirm(false);
    setAutoSendOutcome(null);
  }, []);

  // Quote expiry logic:
  //   • QUOTE_TTL_MS = 60_000  → the quote is considered fresh for 60s.
  //   • After it goes stale we AUTO-REFRESH silently so the user always
  //     sees an actionable price. This aligns with SimpleSwap's actual
  //     rate refresh cadence (they update the spot rate every few
  //     seconds server-side; 60s is a conservative UI cadence).
  //   • The countdown is shown next to the quote card so the user knows
  //     the rate is live and roughly when it'll refresh next.
  const QUOTE_TTL_MS = 60_000;
  const quoteAgeMs = quoteFetchedAt ? Math.max(0, now - quoteFetchedAt) : 0;
  const quoteRemainingMs = quoteFetchedAt
    ? Math.max(0, QUOTE_TTL_MS - quoteAgeMs)
    : 0;
  const quoteStale = quoteFetchedAt !== null && quoteRemainingMs === 0;
  const quoteRemainingSec = Math.ceil(quoteRemainingMs / 1000);

  // Auto-refresh once the current quote ticks past its TTL. Guard with
  // (step===3, quote is ok, not currently loading, not already created)
  // so we don't fire refreshes on the deposit screen or in error state.
  useEffect(() => {
    if (step !== 3) return;
    if (!quote?.ok) return;
    if (created) return;
    if (quoteLoading) return;
    if (!quoteStale) return;
    refreshQuoteSilently();
  }, [step, quote, created, quoteLoading, quoteStale, refreshQuoteSilently]);

  // Pre-flight memo gate for the swap auto-send. SimpleSwap's XLM deposit
  // address is shared; the memo is what credits THIS swap.
  const autoSendGate = useMemo(() => {
    if (!created?.ok || !fromIsXlm) return null;
    return checkExchangeMemo({
      destination: created.payin_address || "",
      memo: created.payin_extra_id || "",
      kindId: "exchange",
      requiredMemo: created.payin_extra_id ?? null,
    });
  }, [created, fromIsXlm]);

  const onAutoSendConfirmed = useCallback(async () => {
    setAutoSendConfirm(false);
    if (!created?.ok || !fromIsXlm) return;
    if (!wallet?.secretSeed) {
      toast.show("Add a wallet seed to send XLM.", "info");
      router.push("/wallet-setup");
      return;
    }
    if (autoSendGate && !autoSendGate.ok) {
      toast.show(autoSendGate.message, "error");
      return;
    }
    let amountXlm: number;
    try {
      amountXlm = xlmToBroadcastNumber(String(created.amount_expected_from || ""));
    } catch {
      toast.show("SimpleSwap returned an invalid amount. Nothing was sent.", "error");
      return;
    }
    setAutoSending(true);
    try {
      const result = await broadcastPayment({
        keypair: wallet,
        destination: (created.payin_address || "").trim(),
        amountXlm,
        memo: (created.payin_extra_id || "").trim(),
        kindId: "exchange",
        requiredMemo: created.payin_extra_id ?? null,
      });
      setAutoSendOutcome(result);
      if (result.ok) {
        toast.show("Sent to SimpleSwap with the memo.", "success");
      } else {
        toast.show(result.message, "error");
      }
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Transaction could not be signed or submitted.";
      setAutoSendOutcome({ ok: false, code: "network_error", message });
      toast.show(message, "error");
    } finally {
      setAutoSending(false);
    }
  }, [created, fromIsXlm, wallet, autoSendGate, toast]);

  const copyToClipboard = useCallback(
    async (val: string, label: string) => {
      await Clipboard.setStringAsync(val);
      toast.show(`${label} copied.`, "success");
    },
    [toast],
  );

  const onPasteRefund = useCallback(async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (text && text.trim()) setRefundAddress(text.trim());
    } catch {
      toast.show("Could not read clipboard.", "error");
    }
  }, [toast]);

  const onPastePayout = useCallback(async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (text && text.trim()) setPayoutAddress(text.trim());
    } catch {
      toast.show("Could not read clipboard.", "error");
    }
  }, [toast]);

  const filteredCurrencies = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    const base = q
      ? pickerCurrencies.filter(
          (c) =>
            c.ticker.toLowerCase().includes(q) ||
            (c.name || "").toLowerCase().includes(q) ||
            (c.protocol || "").toLowerCase().includes(q),
        )
      : pickerCurrencies;
    if (pickerSide !== "to" || !sourceRoutes) return base;
    const fromTicker = fromCurrency.trim().toLowerCase();
    if (sourceRoutes.requestedTicker !== fromTicker) return base;
    const available = (ticker: string) => {
      const side = resolvedPairSide(ticker);
      return sourceRoutes.destinations.includes(`${side.ticker}:${side.network}`);
    };
    return [...base].sort((a, b) => {
      const aOk = available(a.ticker) ? 0 : 1;
      const bOk = available(b.ticker) ? 0 : 1;
      if (aOk !== bOk) return aOk - bOk;
      return a.ticker.localeCompare(b.ticker);
    });
  }, [pickerCurrencies, pickerSearch, pickerSide, sourceRoutes, fromCurrency]);

  const openPicker = useCallback((side: "from" | "to") => {
    setPickerSide(side);
    setPickerSearch("");
    setPickerOpen(true);
  }, []);

  const chooseCurrency = useCallback(
    (ticker: string) => {
      if (pickerSide === "from") setFromCurrency(ticker);
      else setToCurrency(ticker);
      setPickerOpen(false);
      setPickerSearch("");
    },
    [pickerSide],
  );

  const flipPair = useCallback(() => {
    setFromCurrency(toCurrency);
    setToCurrency(fromCurrency);
    setPayoutAddress("");
    setPayoutExtraId("");
    setRefundAddress("");
    setRefundExtraId("");
  }, [fromCurrency, toCurrency]);

  const destinationOffered = useCallback(
    (ticker: string): boolean | null => {
      if (!sourceRoutes || sourceRoutes.requestedTicker !== fromCurrency.trim().toLowerCase()) {
        return null;
      }
      const side = resolvedPairSide(ticker);
      return sourceRoutes.destinations.includes(`${side.ticker}:${side.network}`);
    },
    [sourceRoutes, fromCurrency],
  );

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.root} testID="swap-screen">
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.headerRow}>
        <TouchableOpacity
          onPress={() => {
            if (step === 1) router.back();
            else if (step === 2) setStep(1);
            else if (step === 3 && !created) setStep(2);
            else resetWizard();
          }}
          style={styles.backBtn}
          hitSlop={10}
          testID="swap-back"
        >
          <Feather name="chevron-left" size={20} color={colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={styles.title}>Instant Swap</Text>
          <Text style={styles.liveLabel}>LIVE · SIMPLESWAP</Text>
        </View>
        <View style={styles.stepPill}>
          <Text style={styles.stepPillText}>{step}/3</Text>
        </View>
      </View>

      <View style={styles.progressRow}>
        {[1, 2, 3].map((s) => (
          <View
            key={s}
            style={[
              styles.progressSeg,
              s <= step ? styles.progressSegOn : styles.progressSegOff,
            ]}
          />
        ))}
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {step === 1 && (
            <>
              {!swapKeyConfigured ? (
                <View style={styles.errorCard} testID="swap-config-error">
                  <Feather
                    name="alert-octagon"
                    size={22}
                    color={colors.danger ?? "#ff6b6b"}
                  />
                  <Text style={styles.errorTitle}>Swap not configured.</Text>
                  <Text style={styles.errorDetail}>
                    Swap API key not configured.
                  </Text>
                </View>
              ) : null}
              {swapKeyConfigured && currenciesError ? (
                <View style={styles.errorCard} testID="swap-currencies-error">
                  <Feather
                    name="alert-octagon"
                    size={22}
                    color={colors.danger ?? "#ff6b6b"}
                  />
                  <Text style={styles.errorTitle}>
                    Swap service temporarily unavailable.
                  </Text>
                  <Text style={styles.errorDetail}>{currenciesError}</Text>
                </View>
              ) : null}
              <Text style={styles.sectionEyebrow}>STEP 1 · SETUP</Text>
              <Text style={styles.sectionTitle}>Swap any supported currency</Text>
              <Text style={styles.sectionSub}>
                Choose what you send and what you receive. SOL to XLM still
                pays into this wallet. Quotes, minimums, and the affiliate
                fee use the same SimpleSwap connection as before.
              </Text>

              <View style={styles.modeToggleRow} testID="swap-mode-toggle">
                <TouchableOpacity
                  onPress={() => {
                    setFromCurrency("xlm");
                    if (toCurrency === "xlm") setToCurrency("sol");
                  }}
                  style={[
                    styles.modeToggleBtn,
                    fromIsXlm && !toIsXlm && styles.modeToggleBtnOn,
                  ]}
                  testID="swap-mode-sell"
                  accessibilityLabel="Swap from XLM into another currency"
                  accessibilityState={{ selected: fromIsXlm && !toIsXlm }}
                >
                  <Text
                    style={[
                      styles.modeToggleText,
                      fromIsXlm && !toIsXlm && styles.modeToggleTextOn,
                    ]}
                  >
                    From XLM
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    setFromCurrency("sol");
                    setToCurrency("xlm");
                  }}
                  style={[
                    styles.modeToggleBtn,
                    fromCurrency === "sol" && toIsXlm && styles.modeToggleBtnOn,
                  ]}
                  testID="swap-mode-buy"
                  accessibilityLabel="Swap SOL to XLM, paid into this wallet"
                  accessibilityState={{ selected: fromCurrency === "sol" && toIsXlm }}
                >
                  <Text
                    style={[
                      styles.modeToggleText,
                      fromCurrency === "sol" && toIsXlm && styles.modeToggleTextOn,
                    ]}
                  >
                    SOL → XLM
                  </Text>
                </TouchableOpacity>
              </View>

              <CurrencySideCard
                side="from"
                ticker={fromCurrency}
                entry={selectedFromEntry}
                onPickQuick={setFromCurrency}
                onOpen={() => openPicker("from")}
              />

              <TouchableOpacity
                onPress={flipPair}
                style={styles.flipBtn}
                testID="swap-flip-pair"
                accessibilityLabel="Switch the from and to currencies"
              >
                <Feather name="repeat" size={18} color={colors.cyan} />
                <Text style={styles.flipBtnText}>Switch from and to</Text>
              </TouchableOpacity>

              <CurrencySideCard
                side="to"
                ticker={toCurrency}
                entry={selectedEntry}
                onPickQuick={setToCurrency}
                onOpen={() => openPicker("to")}
              />

              {routesLoading ? (
                <Text style={styles.helperText} testID="swap-routes-loading">
                  Checking which currencies you can receive…
                </Text>
              ) : null}
              {routeSelection && !routeSelection.ok ? (
                <View style={styles.errorCard} testID="swap-unsupported-pair">
                  <Feather
                    name="alert-octagon"
                    size={22}
                    color={colors.danger ?? "#ff6b6b"}
                  />
                  <Text style={styles.errorTitle}>This pair is not available</Text>
                  <Text style={styles.errorDetail}>{routeSelection.message}</Text>
                </View>
              ) : null}
              {routesError && routeSelection?.ok !== false ? (
                <Text style={styles.helperText} testID="swap-routes-error">
                  {routesError}
                </Text>
              ) : null}
              <Text style={styles.helperText} testID="swap-fee-tier">
                {feeTierLabel}
              </Text>

              <View style={styles.amountLabelRow}>
                <Text style={styles.label}>AMOUNT ({sendLabel})</Text>
                {fromIsXlm ? (
                  <Text style={styles.amountLabelMeta} testID="swap-available-balance">
                    {balanceLoading
                      ? "Loading balance…"
                      : spendable == null
                      ? "Balance unavailable"
                      : `Available: ${spendable.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 7,
                        })} XLM`}
                  </Text>
                ) : (
                  <Text style={styles.amountLabelMeta} testID="swap-buy-external-hint">
                    From your external wallet
                  </Text>
                )}
              </View>
              <View style={styles.card}>
                <View style={styles.amountInputRow}>
                  <TextInput
                    value={amount}
                    onChangeText={setAmount}
                    placeholder="0.00"
                    placeholderTextColor={colors.textTertiary}
                    keyboardType={Platform.OS === "ios" ? "decimal-pad" : "numeric"}
                    style={[styles.amountInput, styles.amountInputFlex]}
                    testID="swap-amount-input"
                  />
                  {fromIsXlm ? (
                    <TouchableOpacity
                      onPress={onFillMax}
                      disabled={!canFillMax}
                      style={[
                        styles.maxBtn,
                        !canFillMax && styles.maxBtnDisabled,
                      ]}
                      testID="swap-max-button"
                      accessibilityLabel="Fill with maximum spendable XLM"
                    >
                      <Text
                        style={[
                          styles.maxBtnText,
                          !canFillMax && styles.maxBtnTextDisabled,
                        ]}
                      >
                        Max
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
                {fromIsXlm && xlmFiatHint ? (
                  <Text style={styles.fiatHint}>≈ {xlmFiatHint}</Text>
                ) : null}
                {fromIsXlm && canFillMax ? (
                  <Text style={styles.maxHint}>
                    Max leaves {MAX_RESERVE_XLM} XLM in your wallet to cover
                    the Stellar network fee.
                  </Text>
                ) : null}
                {rangeLoading ? (
                  <Text style={styles.helperText} testID="swap-minimum">
                    Checking the minimum for this pair…
                  </Text>
                ) : pairMin ? (
                  <Text style={styles.helperText} testID="swap-minimum">
                    {pairMax
                      ? `This pair accepts ${pairMin} – ${pairMax} ${sendLabel}.`
                      : `Minimum for this pair: ${pairMin} ${sendLabel}.`}
                  </Text>
                ) : null}
              </View>

              {!toIsXlm ? (
                <>
                  <Text style={styles.label}>
                    YOUR {targetLabel} DESTINATION ADDRESS
                  </Text>
                  <View style={styles.card}>
                    <View style={styles.inputRow}>
                      <TextInput
                        value={payoutAddress}
                        onChangeText={setPayoutAddress}
                        placeholder={getAddressHint(toCurrency)}
                        placeholderTextColor={colors.textTertiary}
                        autoCapitalize="none"
                        autoCorrect={false}
                        spellCheck={false}
                        style={[styles.addrInput, { flex: 1 }]}
                        testID="swap-payout-input"
                      />
                      <TouchableOpacity
                        onPress={onPastePayout}
                        style={styles.inlineBtn}
                        testID="swap-payout-paste"
                      >
                        <Feather name="clipboard" size={16} color={colors.textSecondary} />
                        <Text style={styles.inlineBtnText}>Paste</Text>
                      </TouchableOpacity>
                    </View>
                    {toCurrency === "sol" ? (
                      <TouchableOpacity
                        onPress={() => {
                          setContactsPickerTarget("payout");
                          setContactsPickerOpen(true);
                        }}
                        style={styles.contactsBtn}
                        testID="swap-payout-contacts"
                        accessibilityLabel="Pick a Solana address from your address book"
                      >
                        <Feather name="book-open" size={16} color={colors.cyan} />
                        <Text style={styles.contactsBtnText}>
                          Pick from Solana contacts
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                    <Text style={styles.helperText}>
                      {getAddressHint(toCurrency)}
                    </Text>
                    {showAddressWarning ? (
                      <View style={styles.warnRow}>
                        <Feather
                          name="alert-triangle"
                          size={14}
                          color={colors.gold}
                        />
                        <Text style={styles.warnText}>
                          This doesn&apos;t look like a valid {targetLabel}{" "}
                          address. Double-check the format before continuing.
                        </Text>
                      </View>
                    ) : null}
                  </View>

                  {requiresMemo ? (
                    <>
                      <Text style={styles.label}>
                        {(selectedEntry?.extraIdName || "MEMO").toUpperCase()} (
                        optional but often required)
                      </Text>
                      <View style={styles.card}>
                        <TextInput
                          value={payoutExtraId}
                          onChangeText={setPayoutExtraId}
                          placeholder={`Enter ${selectedEntry?.extraIdName || "memo"} if your exchange requires one`}
                          placeholderTextColor={colors.textTertiary}
                          autoCapitalize="none"
                          autoCorrect={false}
                          style={styles.addrInput}
                          testID="swap-payout-extra-input"
                        />
                        <Text style={styles.helperText}>
                          Ask your exchange or wallet if a{" "}
                          {selectedEntry?.extraIdName || "memo"} is needed.
                          Missing memos can cause lost funds.
                        </Text>
                      </View>
                    </>
                  ) : null}
                </>
              ) : (
                <>
                  <Text style={styles.label}>YOU RECEIVE (XLM)</Text>
                  <View style={styles.card}>
                    <View style={styles.buyReceiveRow}>
                      <View style={styles.buyReceiveIcon}>
                        <Feather name="lock" size={14} color={colors.teal} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.buyReceiveTitle}>
                          Stellar Lumens (XLM)
                        </Text>
                        <Text style={styles.buyReceiveSub} numberOfLines={1}>
                          Payout →{" "}
                          {wallet?.publicKey
                            ? `${wallet.publicKey.slice(0, 8)}…${wallet.publicKey.slice(-6)}`
                            : "No active wallet"}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.helperText}>
                      Your active in-app XLM wallet is the payout address.
                      Switch wallets before starting the swap if you want the
                      XLM delivered elsewhere.
                    </Text>
                  </View>
                </>
              )}

              {!fromIsXlm ? (
                <>
                  <Text style={styles.label}>
                    YOUR {sendLabel} ADDRESS (REFUND)
                  </Text>
                  <View style={styles.card}>
                    <View style={styles.inputRow}>
                      <TextInput
                        value={refundAddress}
                        onChangeText={setRefundAddress}
                        placeholder={getAddressHint(fromCurrency)}
                        placeholderTextColor={colors.textTertiary}
                        autoCapitalize="none"
                        autoCorrect={false}
                        spellCheck={false}
                        style={[styles.addrInput, { flex: 1 }]}
                        testID="swap-buy-refund-input"
                      />
                      <TouchableOpacity
                        onPress={onPasteRefund}
                        style={styles.inlineBtn}
                        testID="swap-buy-refund-paste"
                      >
                        <Feather name="clipboard" size={16} color={colors.textSecondary} />
                        <Text style={styles.inlineBtnText}>Paste</Text>
                      </TouchableOpacity>
                    </View>
                    {fromCurrency === "sol" ? (
                      <TouchableOpacity
                        onPress={() => {
                          setContactsPickerTarget("refund");
                          setContactsPickerOpen(true);
                        }}
                        style={styles.contactsBtn}
                        testID="swap-buy-refund-contacts"
                        accessibilityLabel="Pick a Solana refund address from your address book"
                      >
                        <Feather name="book-open" size={16} color={colors.cyan} />
                        <Text style={styles.contactsBtnText}>
                          Pick from Solana contacts
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                    <Text style={styles.helperText}>
                      SimpleSwap needs a refund address in case the swap fails.
                      Paste the {sendLabel} address you are sending from. Funds
                      return there if anything goes wrong.
                    </Text>
                    {refundWarning ? (
                      <View style={styles.warnRow}>
                        <Feather
                          name="alert-triangle"
                          size={14}
                          color={colors.gold}
                        />
                        <Text style={styles.warnText}>
                          This doesn&apos;t look like a valid {sendLabel}{" "}
                          address. Double-check before continuing.
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  {requiresRefundMemo ? (
                    <>
                      <Text style={styles.label}>
                        REFUND {(selectedFromEntry?.extraIdName || "MEMO").toUpperCase()}
                      </Text>
                      <View style={styles.card}>
                        <TextInput
                          value={refundExtraId}
                          onChangeText={setRefundExtraId}
                          placeholder={`Refund ${selectedFromEntry?.extraIdName || "memo"}, if your wallet uses one`}
                          placeholderTextColor={colors.textTertiary}
                          autoCapitalize="none"
                          autoCorrect={false}
                          style={styles.addrInput}
                          testID="swap-refund-extra-input"
                        />
                      </View>
                    </>
                  ) : null}
                </>
              ) : null}

              {fromIsXlm &&
              amountValid &&
              spendable != null &&
              !hasSufficientBalance ? (
                <View style={styles.warnRow} testID="swap-insufficient-balance">
                  <Feather name="alert-triangle" size={14} color={colors.gold} />
                  <Text style={styles.warnText}>
                    Insufficient XLM balance. You have{" "}
                    {spendable.toFixed(4).replace(/\.?0+$/, "")} XLM available.
                    Fund your wallet or lower the amount before continuing.
                  </Text>
                </View>
              ) : null}
              {rangeStatus.belowMinimum && pairMin ? (
                <View style={styles.warnRow} testID="swap-below-minimum">
                  <Feather name="alert-triangle" size={14} color={colors.gold} />
                  <Text style={styles.warnText}>
                    Amount is below the minimum. Enter at least {pairMin}{" "}
                    {sendLabel}.
                  </Text>
                </View>
              ) : null}
              {rangeStatus.aboveMaximum && pairMax ? (
                <View style={styles.warnRow} testID="swap-above-maximum">
                  <Feather name="alert-triangle" size={14} color={colors.gold} />
                  <Text style={styles.warnText}>
                    Amount is above the maximum. Enter at most {pairMax}{" "}
                    {sendLabel}.
                  </Text>
                </View>
              ) : null}

              <TouchableOpacity
                onPress={goToReview}
                disabled={!canContinueStep1}
                style={[
                  styles.primaryBtn,
                  !canContinueStep1 && { opacity: 0.5 },
                ]}
                testID="swap-continue-step1"
              >
                <Text style={styles.primaryBtnText}>Continue</Text>
                <Feather name="chevron-right" size={16} color={colors.textInverse} />
              </TouchableOpacity>
            </>
          )}

          {step === 2 && (
            <>
              <Text style={styles.sectionEyebrow}>STEP 2 · REVIEW</Text>
              <Text style={styles.sectionTitle}>Confirm your swap details</Text>
              <Text style={styles.sectionSub}>
                {fromIsXlm
                  ? `Review carefully. In the next step you confirm once and the wallet sends ${sendLabel} to SimpleSwap with the required memo.`
                  : `Review carefully. In the next step you'll get a deposit address. Send ${sendLabel} to it from your external wallet.`}
              </Text>

              <View style={styles.infoNote} testID="swap-step2-estimate-note">
                <Feather name="info" size={13} color={colors.cyan} />
                <Text style={styles.infoNoteText}>
                  Amounts shown here are estimates from cached market
                  rates. The locked SimpleSwap quote is fetched on the
                  next step and may differ slightly.
                </Text>
              </View>

              <View style={styles.summaryCard}>
                <SummaryRow
                  label="You send"
                  value={`${amountValue} ${sendLabel}`}
                  caption={usdCaption(sendLabel, amountValue)}
                />
                <SummaryRow label="Fee tier" value={feeTierLabel} />
                <SummaryRow
                  label="You receive"
                  value={
                    cachedEstimate
                      ? `≈ ${cachedEstimate.amount.toFixed(4).replace(/\.?0+$/, "")} ${targetLabel} (ESTIMATE)`
                      : "Real quote in the next step"
                  }
                  caption={
                    cachedEstimate
                      ? usdCaption(targetLabel, cachedEstimate.amount)
                      : null
                  }
                />
                {cachedEstimate ? (
                  <SummaryRow
                    label="Estimated rate"
                    value={`1 ${sendLabel} ≈ ${cachedEstimate.rate.toFixed(6)} ${targetLabel}`}
                  />
                ) : null}
                {pairMin ? (
                  <SummaryRow
                    label="Minimum"
                    value={
                      pairMax
                        ? `${pairMin} – ${pairMax} ${sendLabel}`
                        : `${pairMin} ${sendLabel}`
                    }
                  />
                ) : null}
                <SummaryRow
                  label="Destination network"
                  value={
                    toIsXlm
                      ? "Stellar · XLM (your in-app wallet)"
                      : selectedEntry?.protocol
                        ? `${selectedEntry.name} · ${selectedEntry.protocol}`
                        : targetLabel
                  }
                />
                <SummaryRow
                  label="Payout address"
                  value={effectivePayoutAddress}
                  monospace
                />
                {!toIsXlm && payoutExtraId ? (
                  <SummaryRow
                    label={selectedEntry?.extraIdName || "Memo"}
                    value={payoutExtraId}
                    monospace
                  />
                ) : null}
                {!fromIsXlm ? (
                  <SummaryRow
                    label={`Refund address (${sendLabel})`}
                    value={refundAddress}
                    monospace
                  />
                ) : null}
              </View>

              <View style={styles.infoNote}>
                <Feather name="info" size={13} color={colors.cyan} />
                <Text style={styles.infoNoteText}>
                  Rates from SimpleSwap are estimates and may fluctuate slightly
                  by the time your {sendLabel} deposit is confirmed. You&apos;ll see the
                  exact rate on the next screen.
                </Text>
              </View>

              <View style={styles.buttonRow}>
                <TouchableOpacity
                  onPress={() => setStep(1)}
                  style={styles.secondaryBtn}
                  testID="swap-back-step2"
                >
                  <Feather name="chevron-left" size={16} color={colors.text} />
                  <Text style={styles.secondaryBtnText}>Back</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={goToQuote}
                  style={[styles.primaryBtn, { flex: 1 }]}
                  testID="swap-get-quote"
                >
                  <Text style={styles.primaryBtnText}>Get final quote</Text>
                  <Feather name="zap" size={14} color={colors.textInverse} />
                </TouchableOpacity>
              </View>
            </>
          )}

          {step === 3 && (
            <>
              <Text style={styles.sectionEyebrow}>STEP 3 · CONFIRM</Text>

              {created?.ok ? (
                <>
                  <Text style={styles.sectionTitle}>
                    {fromIsXlm
                      ? `Send ${sendLabel} to complete the swap`
                      : `Send ${sendLabel} from your external wallet`}
                  </Text>
                  <Text style={styles.sectionSub}>
                    {fromIsXlm
                      ? `Send the exact amount below to the deposit address from your XLM wallet. Once confirmed, SimpleSwap will forward the ${targetLabel} to your destination.`
                      : toIsXlm
                        ? `Send the exact amount of ${sendLabel} below to the deposit address. Once confirmed, SimpleSwap will forward XLM to your in-app wallet.`
                        : `Send the exact amount of ${sendLabel} below to the deposit address. Once confirmed, SimpleSwap will forward ${targetLabel} to your destination.`}
                  </Text>

                  {/* Destination verification gate. User MUST self-attest
                      that they've verified the destination address + memo
                      on their target wallet before we let them copy the
                      pay-in details. Guards against typos in the payout
                      address that would send funds to the wrong place. */}
                  <View style={styles.verifyCard} testID="swap-verify-card">
                    <Text style={styles.verifyEyebrow}>SAFETY CHECK</Text>
                    <Text style={styles.verifyTitle}>
                      Verify your {targetLabel} destination
                    </Text>
                    <View style={styles.verifyRow}>
                      <Text style={styles.verifyRowLabel}>Address</Text>
                      <Text
                        style={styles.verifyRowValue}
                        selectable
                        testID="swap-verify-address"
                      >
                        {effectivePayoutAddress}
                      </Text>
                    </View>
                    {effectivePayoutExtraId ? (
                      <View style={styles.verifyRow}>
                        <Text style={styles.verifyRowLabel}>
                          {selectedEntry?.extraIdName || "Memo"}
                        </Text>
                        <Text
                          style={styles.verifyRowValue}
                          selectable
                          testID="swap-verify-memo"
                        >
                          {effectivePayoutExtraId}
                        </Text>
                      </View>
                    ) : null}
                    <TouchableOpacity
                      onPress={() => setVerifiedDestination((v) => !v)}
                      style={styles.checkboxRow}
                      activeOpacity={0.7}
                      testID="swap-verify-checkbox"
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: verifiedDestination }}
                    >
                      <View
                        style={[
                          styles.checkbox,
                          verifiedDestination && styles.checkboxOn,
                        ]}
                      >
                        {verifiedDestination ? (
                          <Feather
                            name="check"
                            size={18}
                            color={colors.textInverse}
                          />
                        ) : null}
                      </View>
                      <Text style={styles.checkboxLabel}>
                        I have verified the destination address
                        {effectivePayoutExtraId ? " and memo" : ""} on my target wallet.
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {/* 1.6.16: the send choice sits right under the safety
                      check (above the deposit card) so it's visible without
                      scrolling. Same three options, same order and names. */}
                  <View style={styles.actionSection} testID="swap-send-choice">
                    {/* Three-way action grid — every path a user could take
                        to actually deliver the XLM to SimpleSwap's pay-in
                        address. All three are surfaced flat (no menus):
                          1) SEND FROM WALLET (default for XLM): confirm
                             sheet, then the wallet signs + submits with
                             SimpleSwap's memo (always kind=exchange).
                          2) SHOW QR CODE: opens a modal QR of the
                             pay-in address for scanning from another
                             device or hardware wallet.
                          3) COPY MANUALLY: the copy buttons already
                             built into the deposit card below.
                       All three require the verification checkbox to be
                       ticked, so a user can't accidentally proceed
                       without acknowledging the destination address.
                    */}
                    {fromIsXlm && autoSendGate && !autoSendGate.ok ? (
                      <View style={styles.infoNote} testID="swap-auto-send-blocked">
                        <Feather name="alert-triangle" size={13} color={colors.danger} />
                        <Text style={styles.infoNoteText}>
                          {autoSendGate.message} Don&apos;t send XLM to this
                          address from any wallet.
                        </Text>
                      </View>
                    ) : null}
                    {autoSendOutcome ? (
                      <View style={styles.infoNote} testID="swap-auto-send-outcome">
                        <Feather
                          name={autoSendOutcome.ok ? "check-circle" : "alert-triangle"}
                          size={13}
                          color={autoSendOutcome.ok ? colors.teal : colors.danger}
                        />
                        <Text style={styles.infoNoteText} selectable>
                          {autoSendOutcome.ok
                            ? `Sent ${created.amount_expected_from} XLM with memo ${created.payin_extra_id}. Tx ${autoSendOutcome.hash}`
                            : autoSendOutcome.message}
                        </Text>
                      </View>
                    ) : null}
                    <Text style={styles.actionSectionLabel} testID="swap-send-choice-label">
                      HOW WOULD YOU LIKE TO SEND?
                    </Text>
                    <View style={styles.actionGrid}>
                      {fromIsXlm ? (
                        <TouchableOpacity
                          onPress={() => {
                            if (!verifiedDestination) {
                              toast.show(
                                "Tick the safety check first.",
                                "error",
                              );
                              return;
                            }
                            if (autoSendGate && !autoSendGate.ok) {
                              toast.show(autoSendGate.message, "error");
                              return;
                            }
                            if (autoSendOutcome?.ok) {
                              toast.show("Already sent for this swap.", "info");
                              return;
                            }
                            setAutoSendConfirm(true);
                          }}
                          disabled={
                            !verifiedDestination ||
                            autoSending ||
                            autoSendOutcome?.ok === true ||
                            (autoSendGate != null && !autoSendGate.ok)
                          }
                          style={[
                            styles.actionCard,
                            styles.actionCardDefault,
                            (!verifiedDestination ||
                              (autoSendGate != null && !autoSendGate.ok)) &&
                              styles.actionCardDisabled,
                          ]}
                          testID="swap-action-send-vault"
                          accessibilityRole="button"
                          accessibilityState={{ selected: true }}
                        >
                          <View style={styles.actionDefaultBadge} testID="swap-action-default-badge">
                            <Feather name="check" size={12} color={colors.textInverse} />
                            <Text style={styles.actionDefaultBadgeText}>Default</Text>
                          </View>
                          <View
                            style={[
                              styles.actionIconWrap,
                              { backgroundColor: colors.tealMuted },
                            ]}
                          >
                            <Feather name="send" size={18} color={colors.teal} />
                          </View>
                          <Text style={styles.actionTitle}>Send from Wallet</Text>
                          {autoSending ? (
                            <ActivityIndicator size="small" color={colors.teal} />
                          ) : null}
                          <Text style={styles.actionDesc}>
                            {autoSendOutcome?.ok
                              ? "Sent with the SimpleSwap memo."
                              : "Confirm once — the wallet signs and sends with the memo."}
                          </Text>
                        </TouchableOpacity>
                      ) : null}

                      <TouchableOpacity
                        onPress={() => {
                          if (!verifiedDestination) {
                            toast.show(
                              "Tick the safety check first.",
                              "error",
                            );
                            return;
                          }
                          setQrOpen(true);
                        }}
                        disabled={!verifiedDestination}
                        style={[
                          styles.actionCard,
                          !verifiedDestination && styles.actionCardDisabled,
                        ]}
                        testID="swap-action-show-qr"
                      >
                        <View
                          style={[
                            styles.actionIconWrap,
                            { backgroundColor: colors.cyanMuted },
                          ]}
                        >
                          <Feather name="grid" size={18} color={colors.cyan} />
                        </View>
                        <Text style={styles.actionTitle}>Show QR code</Text>
                        <Text style={styles.actionDesc}>
                          Scan the deposit address from another device.
                        </Text>
                      </TouchableOpacity>

                      <View
                        style={[
                          styles.actionCard,
                          !verifiedDestination && styles.actionCardDisabled,
                        ]}
                      >
                        <View
                          style={[
                            styles.actionIconWrap,
                            { backgroundColor: colors.cyanMuted },
                          ]}
                        >
                          <Feather name="copy" size={18} color={colors.cyan} />
                        </View>
                        <Text style={styles.actionTitle}>Copy manually</Text>
                        <Text style={styles.actionDesc}>
                          Use the copy buttons on the deposit card below.
                        </Text>
                      </View>
                    </View>
                  </View>

                  <View
                    style={[
                      styles.depositCard,
                      !verifiedDestination && styles.depositCardLocked,
                    ]}
                  >
                    <Text style={styles.depositEyebrow}>SEND EXACTLY</Text>
                    <Text style={styles.depositAmount} testID="swap-deposit-amount">
                      {created.amount_expected_from} {sendLabel}
                    </Text>

                    <View style={styles.depositSection}>
                      <Text style={styles.depositLabel}>TO ADDRESS</Text>
                      <View style={styles.copyRow}>
                        <Text
                          style={[
                            styles.depositMono,
                            !verifiedDestination && styles.depositMonoLocked,
                          ]}
                          selectable={verifiedDestination}
                          testID="swap-deposit-address"
                        >
                          {verifiedDestination
                            ? created.payin_address
                            : maskAddress(created.payin_address || "")}
                        </Text>
                        <TouchableOpacity
                          onPress={() =>
                            copyToClipboard(
                              created.payin_address || "",
                              "Deposit address",
                            )
                          }
                          disabled={!verifiedDestination}
                          style={[
                            styles.copyBtn,
                            !verifiedDestination && { opacity: 0.4 },
                          ]}
                          testID="swap-copy-deposit-address"
                        >
                          <Feather name="copy" size={13} color={colors.cyan} />
                        </TouchableOpacity>
                      </View>
                    </View>

                    {created.payin_extra_id ? (
                      <View style={styles.depositSection}>
                        <View style={styles.depositMemoLabelRow}>
                          <Feather name="lock" size={11} color={colors.gold} />
                          <Text style={styles.depositLabel}>
                            SIMPLESWAP DEPOSIT MEMO — REQUIRED FOR SWAP
                          </Text>
                        </View>
                        <View style={styles.copyRow}>
                          <Text
                            style={[
                              styles.depositMono,
                              !verifiedDestination && styles.depositMonoLocked,
                            ]}
                            selectable={verifiedDestination}
                            testID="swap-deposit-memo"
                          >
                            {verifiedDestination
                              ? created.payin_extra_id
                              : "•••••••••••••••"}
                          </Text>
                          <TouchableOpacity
                            onPress={() =>
                              copyToClipboard(
                                created.payin_extra_id || "",
                                "Memo",
                              )
                            }
                            disabled={!verifiedDestination}
                            style={[
                              styles.copyBtn,
                              !verifiedDestination && { opacity: 0.4 },
                            ]}
                            testID="swap-copy-deposit-memo"
                          >
                            <Feather name="copy" size={13} color={colors.cyan} />
                          </TouchableOpacity>
                        </View>
                        <Text style={styles.helperText}>
                          This memo is set by SimpleSwap and cannot be edited.
                          Missing this memo will cause your funds to be lost.
                        </Text>
                      </View>
                    ) : null}

                    <View style={styles.depositSection}>
                      <Text style={styles.depositLabel}>EXPECTED TO RECEIVE</Text>
                      <Text style={styles.depositMono}>
                        ≈ {created.amount_expected_to} {targetLabel}
                      </Text>
                    </View>

                    <View style={styles.depositMetaRow}>
                      <Text style={styles.depositMetaText}>
                        Tx ID:{" "}
                        <Text style={styles.mono}>
                          {(created.transaction_id || "").slice(0, 10)}…
                        </Text>
                      </Text>
                      <TouchableOpacity
                        onPress={() =>
                          copyToClipboard(
                            created.transaction_id || "",
                            "Transaction ID",
                          )
                        }
                        style={styles.copyBtn}
                        testID="swap-copy-tx-id"
                      >
                        <Feather name="copy" size={11} color={colors.cyan} />
                      </TouchableOpacity>
                    </View>
                    <Text style={styles.depositMetaText}>
                      Status: {(created.status || "new").toUpperCase()}
                    </Text>
                    {!verifiedDestination ? (
                      <View style={styles.lockedNote} testID="swap-locked-note">
                        <Feather name="lock" size={12} color={colors.gold} />
                        <Text style={styles.lockedNoteText}>
                          Tick the safety check above to reveal the deposit
                          address and memo.
                        </Text>
                      </View>
                    ) : null}
                  </View>

                  <View style={styles.infoNote}>
                    <Feather name="shield" size={13} color={colors.cyan} />
                    <Text style={styles.infoNoteText}>
                      {fromIsXlm
                        ? "Non-custodial — the wallet signs this payment on your device and adds SimpleSwap's memo for you. Your private key stays on this device."
                        : toIsXlm
                          ? `Send ${sendLabel} from your external wallet. Your XLM will arrive here after SimpleSwap confirms the deposit.`
                          : `Send ${sendLabel} from your external wallet. ${targetLabel} is delivered to the destination address after SimpleSwap confirms the deposit.`}
                    </Text>
                  </View>

                  <TouchableOpacity
                    onPress={resetWizard}
                    style={[
                      styles.secondaryBtn,
                      { marginTop: spacing.md, alignSelf: "stretch" },
                    ]}
                    testID="swap-start-new"
                  >
                    <Feather name="refresh-cw" size={14} color={colors.text} />
                    <Text style={styles.secondaryBtnText}>Start new swap</Text>
                  </TouchableOpacity>
                </>
              ) : quoteLoading ? (
                <View style={styles.centered}>
                  <ActivityIndicator size="large" color={colors.cyan} />
                  <Text style={styles.loadingText}>
                    Fetching a live quote from SimpleSwap…
                  </Text>
                </View>
              ) : quote?.ok ? (
                <>
                  <Text style={styles.sectionTitle}>Confirm the exchange</Text>
                  <Text style={styles.sectionSub}>
                    This is the live rate from SimpleSwap. Confirm to generate
                    your one-time deposit address.
                  </Text>

                  {/* Quote freshness — visible countdown or refreshing state */}
                  <View
                    style={[
                      styles.freshnessRow,
                      quoteLoading && styles.freshnessRowLoading,
                    ]}
                    testID="swap-quote-freshness"
                  >
                    {quoteLoading ? (
                      <>
                        <ActivityIndicator size="small" color={colors.cyan} />
                        <Text style={styles.freshnessText}>
                          Refreshing quote…
                        </Text>
                      </>
                    ) : (
                      <>
                        <Feather name="clock" size={12} color={colors.cyan} />
                        <Text style={styles.freshnessText}>
                          Rate refreshes in {quoteRemainingSec}s
                        </Text>
                        <TouchableOpacity
                          onPress={refreshQuoteSilently}
                          style={styles.freshnessRefreshBtn}
                          testID="swap-quote-refresh"
                          hitSlop={6}
                        >
                          <Feather
                            name="refresh-cw"
                            size={11}
                            color={colors.cyan}
                          />
                        </TouchableOpacity>
                      </>
                    )}
                  </View>

                  <View style={styles.summaryCard}>
                    <SummaryRow
                      label="You send"
                      value={`${quote.amount_from} ${sendLabel}`}
                      caption={usdCaption(sendLabel, Number(quote.amount_from))}
                    />
                    <SummaryRow label="Fee tier" value={feeTierLabel} />
                    <SummaryRow
                      label="You receive (est.)"
                      value={`≈ ${quote.amount_to} ${targetLabel}`}
                      caption={usdCaption(targetLabel, Number(quote.amount_to))}
                      emphasize
                    />
                    {quote.network_fee ? (
                      <SummaryRow
                        label="Network fee"
                        value={`${quote.network_fee} ${targetLabel}`}
                      />
                    ) : null}
                    {quote.rate ? (
                      <SummaryRow
                        label="Rate"
                        value={`1 ${sendLabel} ≈ ${quote.rate.toFixed(6)} ${targetLabel}`}
                      />
                    ) : null}
                    {quote.min_amount || pairMin ? (
                      <SummaryRow
                        label="Minimum"
                        value={`${quote.min_amount || pairMin} ${sendLabel}`}
                      />
                    ) : null}
                    {quote.max_amount || pairMax ? (
                      <SummaryRow
                        label="Maximum"
                        value={`${quote.max_amount || pairMax} ${sendLabel}`}
                      />
                    ) : null}
                    <SummaryRow
                      label="Destination"
                      value={effectivePayoutAddress}
                      monospace
                    />
                    {effectivePayoutExtraId ? (
                      <SummaryRow
                        label={selectedEntry?.extraIdName || "Memo"}
                        value={effectivePayoutExtraId}
                        monospace
                      />
                    ) : null}
                  </View>

                  <View style={styles.buttonRow}>
                    <TouchableOpacity
                      onPress={() => setStep(2)}
                      style={styles.secondaryBtn}
                      testID="swap-back-step3"
                    >
                      <Feather name="chevron-left" size={16} color={colors.text} />
                      <Text style={styles.secondaryBtnText}>Back</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={onConfirmCreate}
                      disabled={creating || quoteLoading}
                      style={[
                        styles.primaryBtn,
                        { flex: 1, backgroundColor: colors.gold },
                        (creating || quoteLoading) && { opacity: 0.5 },
                      ]}
                      testID="swap-confirm-create"
                    >
                      {creating ? (
                        <ActivityIndicator size="small" color={colors.textInverse} />
                      ) : (
                        <>
                          <Text style={styles.primaryBtnText}>
                            Confirm & get deposit address
                          </Text>
                          <Feather
                            name="arrow-right"
                            size={14}
                            color={colors.textInverse}
                          />
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <View style={styles.errorCard} testID="swap-error-card">
                  <Feather name="alert-octagon" size={22} color={colors.danger ?? "#ff6b6b"} />
                  <Text style={styles.errorTitle}>
                    {created?.ok === false
                      ? "Couldn't create the swap"
                      : "Couldn't get a quote"}
                  </Text>
                  <Text style={styles.errorDetail}>
                    {quote?.stage === "invalid_pair" && created?.ok !== false
                      ? `${sendLabel} → ${targetLabel} is not available. The swap provider does not offer this pair.`
                      : created?.detail || quote?.detail || "Unknown error."}
                  </Text>
                  {(quote?.min_amount || pairMin) && quote?.stage === "below_minimum" ? (
                    <Text style={styles.errorHint} testID="swap-quote-minimum">
                      Try at least {quote?.min_amount || pairMin} {sendLabel}.
                    </Text>
                  ) : null}
                  {quote?.max_amount ? (
                    <Text style={styles.errorHint}>
                      Maximum for this pair: {quote.max_amount} {sendLabel}.
                    </Text>
                  ) : null}
                  <View style={styles.buttonRow}>
                    <TouchableOpacity
                      onPress={() => setStep(1)}
                      style={styles.secondaryBtn}
                      testID="swap-error-back"
                    >
                      <Text style={styles.secondaryBtnText}>Adjust swap</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={goToQuote}
                      style={[styles.primaryBtn, { flex: 1 }]}
                      testID="swap-error-retry"
                    >
                      <Feather name="refresh-cw" size={14} color={colors.textInverse} />
                      <Text style={styles.primaryBtnText}>Retry</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Swap auto-send confirm sheet. Shows exactly what will be signed:
          amount, SimpleSwap deposit address and the memo SimpleSwap
          returned. Confirm signs + submits in-app. */}
      <Modal
        visible={autoSendConfirm}
        animationType="fade"
        transparent
        onRequestClose={() => setAutoSendConfirm(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.qrSheet} testID="swap-auto-send-confirm">
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Confirm swap payment</Text>
              <TouchableOpacity
                onPress={() => setAutoSendConfirm(false)}
                hitSlop={10}
                testID="swap-auto-send-cancel-x"
              >
                <Feather name="x" size={20} color={colors.text} />
              </TouchableOpacity>
            </View>
            <View style={styles.qrDetailsCard}>
              <Text style={styles.qrDetailsLabel}>SEND</Text>
              <Text style={styles.qrDetailsValue}>
                {created?.amount_expected_from} XLM
              </Text>
              <Text style={styles.qrDetailsLabel}>TO (SIMPLESWAP DEPOSIT)</Text>
              <Text style={styles.qrDetailsValue} selectable>
                {created?.payin_address}
              </Text>
              <Text style={styles.qrDetailsLabel}>MEMO (ADDED AUTOMATICALLY)</Text>
              <Text style={styles.qrDetailsValue} selectable testID="swap-auto-send-memo">
                {created?.payin_extra_id}
              </Text>
              <Text style={styles.qrDetailsLabel}>YOU RECEIVE</Text>
              <Text style={styles.qrDetailsValue}>
                ≈ {created?.amount_expected_to} {targetLabel}
              </Text>
            </View>
            <Text style={styles.qrCaption}>
              This is a live Stellar payment and can&apos;t be reversed.
            </Text>
            <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.md }}>
              <TouchableOpacity
                onPress={() => setAutoSendConfirm(false)}
                style={[styles.secondaryBtn, { flex: 1 }]}
                testID="swap-auto-send-cancel"
              >
                <Text style={styles.secondaryBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onAutoSendConfirmed}
                style={[styles.secondaryBtn, { flex: 1, backgroundColor: colors.teal }]}
                testID="swap-auto-send-yes"
              >
                <Text style={[styles.secondaryBtnText, { color: colors.textInverse }]}>
                  Confirm &amp; send
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* QR code modal — reveals the pay-in address as a scannable QR
          plus a memo card (SimpleSwap memos are numeric and CANNOT be
          embedded in a Stellar QR payment URI, so we render the memo
          separately with a clear warning). Only opens after the
          verification checkbox is ticked. */}
      <Modal
        visible={qrOpen}
        animationType="fade"
        transparent
        onRequestClose={() => setQrOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.qrSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Deposit QR code</Text>
              <TouchableOpacity
                onPress={() => setQrOpen(false)}
                hitSlop={10}
                testID="swap-close-qr"
              >
                <Feather name="x" size={20} color={colors.text} />
              </TouchableOpacity>
            </View>
            {created?.payin_address ? (
              <View style={styles.qrHolder} testID="swap-qr-holder">
                <QRCode
                  value={
                    fromIsXlm
                      ? `web+stellar:pay?destination=${created.payin_address}&amount=${created.amount_expected_from || ""}${created.payin_extra_id ? `&memo=${created.payin_extra_id}&memo_type=MEMO_TEXT` : ""}`
                      : fromCurrency === "sol"
                        ? `solana:${created.payin_address}${created.amount_expected_from ? `?amount=${created.amount_expected_from}` : ""}`
                        : created.payin_address
                  }
                  size={220}
                  backgroundColor="#FFFFFF"
                  color="#000000"
                />
              </View>
            ) : null}
            <Text style={styles.qrCaption}>
              {fromIsXlm
                ? "Scan with a Stellar wallet on another device. Confirm the address matches before sending."
                : fromCurrency === "sol"
                  ? "Scan with a Solana wallet (Phantom, Solflare, etc.). Confirm the address matches before sending."
                  : `Scan or copy this ${sendLabel} deposit address. Confirm it matches before sending.`}
            </Text>
            <View style={styles.qrDetailsCard}>
              <Text style={styles.qrDetailsLabel}>ADDRESS</Text>
              <Text style={styles.qrDetailsValue} selectable>
                {created?.payin_address}
              </Text>
              <Text style={styles.qrDetailsLabel}>AMOUNT</Text>
              <Text style={styles.qrDetailsValue}>
                {created?.amount_expected_from} {sendLabel}
              </Text>
              {created?.payin_extra_id ? (
                <>
                  <Text style={styles.qrDetailsLabel}>MEMO (REQUIRED)</Text>
                  <Text style={styles.qrDetailsValue} selectable>
                    {created.payin_extra_id}
                  </Text>
                  <Text style={styles.qrMemoWarn}>
                    Some wallets ignore memos in QR codes. Confirm the memo
                    is populated in your wallet before signing.
                  </Text>
                </>
              ) : null}
            </View>
          </View>
        </View>
      </Modal>

      {/* Currency picker modal */}
      <Modal
        visible={pickerOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setPickerOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {pickerSide === "from"
                  ? "Choose the currency you send"
                  : "Choose the currency you receive"}
              </Text>
              <TouchableOpacity
                onPress={() => setPickerOpen(false)}
                hitSlop={10}
                testID="swap-close-picker"
              >
                <Feather name="x" size={20} color={colors.text} />
              </TouchableOpacity>
            </View>
            <View style={styles.modalSearchRow}>
              <Feather name="search" size={14} color={colors.textTertiary} />
              <TextInput
                value={pickerSearch}
                onChangeText={setPickerSearch}
                placeholder="Search ticker or name…"
                placeholderTextColor={colors.textTertiary}
                style={styles.modalSearchInput}
                autoCapitalize="none"
                autoCorrect={false}
                testID="swap-picker-search"
              />
            </View>
            {currenciesLoading ? (
              <View style={styles.centered}>
                <ActivityIndicator size="small" color={colors.cyan} />
                <Text style={styles.loadingText}>Loading currencies…</Text>
              </View>
            ) : (
              <FlatList
                data={filteredCurrencies}
                keyExtractor={(c) => c.ticker}
                initialNumToRender={30}
                maxToRenderPerBatch={30}
                renderItem={({ item }) => {
                  const offered =
                    pickerSide === "to" ? destinationOffered(item.ticker) : null;
                  const selected =
                    item.ticker === (pickerSide === "from" ? fromCurrency : toCurrency);
                  return (
                  <TouchableOpacity
                    style={styles.currencyRow}
                    onPress={() => chooseCurrency(item.ticker)}
                    testID={`swap-currency-${item.ticker}`}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.currencyRowTicker}>
                        {item.ticker.toUpperCase()}
                      </Text>
                      <Text style={styles.currencyRowName}>
                        {item.name}
                        {item.protocol ? ` · ${item.protocol}` : ""}
                        {offered === false ? " · Not available for this pair" : ""}
                      </Text>
                    </View>
                    {selected ? (
                      <Feather name="check" size={16} color={colors.cyan} />
                    ) : null}
                  </TouchableOpacity>
                  );
                }}
                ListEmptyComponent={
                  <View style={styles.centered}>
                    <Text style={styles.loadingText}>
                      No currencies match &quot;{pickerSearch}&quot;.
                    </Text>
                  </View>
                }
              />
            )}
          </View>
        </View>
      </Modal>

      <AddressBookPicker
        visible={contactsPickerOpen}
        network="solana"
        onClose={() => setContactsPickerOpen(false)}
        onPick={(entry) => {
          if (contactsPickerTarget === "payout") {
            setPayoutAddress(entry.publicKey);
          } else {
            setRefundAddress(entry.publicKey);
          }
          setContactsPickerOpen(false);
          toast.show(`Loaded ${entry.label}`, "success");
        }}
      />
    </SafeAreaView>
  );
}

function maskAddress(addr: string): string {
  if (!addr) return "";
  if (addr.length <= 12) return "•".repeat(addr.length);
  return `${addr.slice(0, 4)}${"•".repeat(Math.max(8, addr.length - 8))}${addr.slice(-4)}`;
}

function SummaryRow({
  label,
  value,
  monospace,
  emphasize,
  caption,
}: {
  label: string;
  value: string;
  monospace?: boolean;
  emphasize?: boolean;
  caption?: string | null;
}) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <View style={styles.summaryValueCol}>
        <Text
          style={[
            styles.summaryValue,
            monospace && styles.mono,
            emphasize && styles.summaryValueEmph,
          ]}
          selectable
        >
          {value}
        </Text>
        {caption ? (
          <Text style={styles.summaryCaption} selectable>
            {caption}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
  },
  title: { color: colors.text, fontSize: 20, ...typography.heading },
  liveLabel: {
    color: colors.cyan,
    fontSize: 12,
    marginTop: 2,
    letterSpacing: 1,
    fontWeight: "800",
  },
  stepPill: {
    minWidth: 40,
    height: 24,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
    backgroundColor: colors.cyanMuted,
  },
  stepPillText: { color: colors.cyan, fontSize: 14, fontWeight: "800" },
  progressRow: {
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  progressSeg: { flex: 1, height: 3, borderRadius: 2 },
  progressSegOn: { backgroundColor: colors.cyan },
  progressSegOff: { backgroundColor: colors.borderSubtle },
  scroll: { padding: spacing.md, paddingBottom: 260 },

  sectionEyebrow: {
    color: colors.textTertiary,
    fontSize: 13,
    letterSpacing: 1.4,
    fontWeight: "800",
    marginBottom: 4,
    paddingBottom: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 4,
  },
  sectionSub: {
    color: colors.textSecondary,
    fontSize: 16,
    lineHeight: 22,
    marginBottom: spacing.md,
  },
  label: {
    color: colors.textTertiary,
    fontSize: 13,
    letterSpacing: 1.1,
    fontWeight: "700",
    marginTop: spacing.md,
    marginBottom: 6,
  },
  card: {
    backgroundColor: colors.surfaceFrost,
    borderRadius: radii.md,
    padding: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    ...tileShadow(),
  },
  amountInput: {
    color: colors.text,
    fontSize: 28,
    fontWeight: "700",
    ...typography.mono,
  },
  amountInputFlex: { flex: 1 },
  amountInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  amountLabelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginTop: spacing.md,
    marginBottom: 4,
  },
  amountLabelMeta: {
    color: colors.textTertiary,
    fontSize: 14,
    ...typography.mono,
  },
  maxBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.cyanMuted,
    borderWidth: 1,
    borderColor: colors.borderGlow,
  },
  maxBtnDisabled: {
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.borderSubtle,
  },
  maxBtnText: {
    color: colors.cyan,
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  maxBtnTextDisabled: { color: colors.textTertiary },
  maxHint: {
    color: colors.textTertiary,
    fontSize: 15,
    marginTop: 6,
    lineHeight: 20,
  },
  modeToggleRow: {
    flexDirection: "row",
    backgroundColor: colors.surfaceElevated,
    borderRadius: radii.pill,
    padding: 4,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  modeToggleBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: radii.pill,
  },
  modeToggleBtnOn: {
    backgroundColor: colors.cyan,
  },
  modeToggleText: {
    color: colors.textSecondary,
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  modeToggleTextOn: { color: colors.textInverse },
  flipBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: spacing.md,
    minHeight: 48,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.borderGlow,
  },
  flipBtnText: {
    color: colors.cyan,
    fontSize: 16,
    fontWeight: "700",
  },
  // Buy-mode receive card. Shows XLM as the destination + a lock icon
  // to signal the payout address is pinned to the in-app wallet.
  buyReceiveRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: 6,
  },
  buyReceiveIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.tealMuted,
    borderWidth: 1,
    borderColor: colors.teal,
  },
  buyReceiveTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "700",
  },
  buyReceiveSub: {
    color: colors.textTertiary,
    fontSize: 15,
    ...typography.mono,
    marginTop: 2,
  },
  depositMemoLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 4,
  },
  fiatHint: { color: colors.textSecondary, fontSize: 16, marginTop: 4 },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    minWidth: 60,
    alignItems: "center",
  },
  pillActive: { backgroundColor: colors.cyanMuted, borderColor: colors.borderGlow },
  pillText: { color: colors.textSecondary, fontSize: 16, fontWeight: "700" },
  pillTextActive: { color: colors.cyan, fontWeight: "800" },
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: spacing.sm,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
  },
  pickerText: { flex: 1, color: colors.text, fontSize: 16, lineHeight: 22 },
  selectedRow: { marginTop: spacing.sm },
  selectedName: { color: colors.textSecondary, fontSize: 15, fontWeight: "600" },
  addrInput: {
    color: colors.text,
    fontSize: 16,
    ...typography.mono,
    minHeight: 40,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  inlineBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  inlineBtnText: { color: colors.textSecondary, fontSize: 16, fontWeight: "600" },
  helperText: {
    color: colors.textSecondary,
    fontSize: 16,
    lineHeight: 22,
    marginTop: 6,
  },
  contactsBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: radii.sm,
    backgroundColor: colors.cyanMuted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderGlow,
  },
  contactsBtnText: {
    color: colors.cyan,
    fontSize: 16,
    fontWeight: "700",
  },
  warnRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
  },
  warnText: { flex: 1, color: colors.gold, fontSize: 16, lineHeight: 22 },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 48,
    borderRadius: radii.md,
    backgroundColor: colors.cyan,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  primaryBtnText: { color: colors.textInverse, fontSize: 16, fontWeight: "700" },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    marginTop: spacing.lg,
  },
  secondaryBtnText: { color: colors.text, fontSize: 16, fontWeight: "600" },
  buttonRow: { flexDirection: "row", gap: 8 },

  // Summary
  summaryCard: {
    backgroundColor: colors.surfaceFrost,
    borderRadius: radii.md,
    padding: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    gap: spacing.sm,
    marginTop: spacing.sm,
    ...tileShadow(),
  },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  summaryLabel: { color: colors.textSecondary, fontSize: 16, flexShrink: 0 },
  summaryValueCol: {
    flexShrink: 1,
    alignItems: "flex-end",
    maxWidth: "70%",
  },
  summaryValue: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "600",
    textAlign: "right",
  },
  summaryValueEmph: {
    color: colors.cyan,
    fontSize: 18,
    fontWeight: "800",
  },
  summaryCaption: {
    color: colors.textTertiary,
    fontSize: 14,
    fontWeight: "600",
    textAlign: "right",
    marginTop: 2,
  },
  mono: { ...typography.mono },

  // Quote freshness pill (Step 3 confirmation)
  freshnessRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.cyanMuted,
    marginTop: spacing.sm,
  },
  freshnessRowLoading: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
  },
  freshnessText: {
    color: colors.cyan,
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  freshnessRefreshBtn: {
    marginLeft: 4,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },

  // Deposit destination verification gate
  verifyCard: {
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceFrost,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderGlow,
    gap: 6,
    ...tileShadow(),
  },
  verifyEyebrow: {
    color: colors.cyan,
    fontSize: 10,
    letterSpacing: 1.4,
    fontWeight: "800",
  },
  verifyTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 4,
  },
  verifyRow: { marginTop: 4 },
  verifyRowLabel: {
    color: colors.textTertiary,
    fontSize: 10,
    letterSpacing: 1,
    fontWeight: "700",
  },
  verifyRowValue: {
    color: colors.text,
    fontSize: 16,
    ...typography.mono,
    marginTop: 2,
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: spacing.sm,
    padding: 10,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceElevated,
  },
  checkbox: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.textSecondary,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
  checkboxOn: {
    backgroundColor: colors.cyan,
    borderColor: colors.cyan,
  },
  checkboxLabel: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    lineHeight: 22,
  },

  // Deposit card locked overlay style
  depositCardLocked: { opacity: 0.85 },
  depositMonoLocked: { color: colors.textTertiary, letterSpacing: 1.5 },
  lockedNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
  },
  lockedNoteText: { flex: 1, color: colors.gold, fontSize: 16, lineHeight: 22 },

  // Info notes
  infoNote: {
    flexDirection: "row",
    gap: 8,
    padding: spacing.md,
    marginTop: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.cyanMuted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderGlow,
  },
  infoNoteText: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    lineHeight: 22,
  },

  // Deposit card
  depositCard: {
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceFrost,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.gold,
    gap: spacing.sm,
    ...tileShadow(),
  },
  depositEyebrow: {
    color: colors.gold,
    fontSize: 10,
    letterSpacing: 1.4,
    fontWeight: "800",
  },
  depositAmount: {
    color: colors.text,
    fontSize: 26,
    fontWeight: "800",
    ...typography.mono,
  },
  depositSection: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
  },
  depositLabel: {
    color: colors.textTertiary,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  depositMono: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 18,
    ...typography.mono,
    flex: 1,
  },
  copyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 8,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radii.sm,
  },
  copyBtn: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: radii.sm,
    backgroundColor: colors.cyanMuted,
  },
  depositMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.sm,
  },
  depositMetaText: {
    color: colors.textTertiary,
    fontSize: 11,
    ...typography.mono,
  },

  // Loading + error
  centered: { alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.sm },
  loadingText: { color: colors.textSecondary, fontSize: 16 },
  errorCard: {
    marginTop: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceFrost,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.danger,
    alignItems: "center",
    gap: 6,
    ...tileShadow(),
  },
  errorTitle: { color: colors.text, fontSize: 18, fontWeight: "700" },
  errorDetail: {
    color: colors.textSecondary,
    fontSize: 16,
    textAlign: "center",
    lineHeight: 22,
    // Stretch to card width so unbroken provider JSON wraps instead of overflowing.
    alignSelf: "stretch",
  },
  errorHint: {
    color: colors.gold,
    fontSize: 16,
    marginTop: 4,
    fontWeight: "700",
  },

  // Currency modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: spacing.md,
    height: "80%",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  modalTitle: { color: colors.text, fontSize: 18, fontWeight: "700" },
  modalSearchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 10,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    marginBottom: spacing.sm,
  },
  modalSearchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    paddingVertical: 4,
  },
  currencyRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  currencyRowTicker: { color: colors.text, fontSize: 17, fontWeight: "700" },
  currencyRowName: { color: colors.textSecondary, fontSize: 15, marginTop: 2 },

  // 3-way action grid (deposit screen)
  actionSection: {
    marginTop: spacing.md,
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 2,
    borderColor: colors.cyan,
    backgroundColor: colors.surfaceFrost,
  },
  actionSectionLabel: {
    color: colors.text,
    fontSize: 16,
    letterSpacing: 1,
    fontWeight: "800",
    marginBottom: 10,
  },
  actionCardDefault: {
    borderWidth: 2,
    borderColor: colors.teal,
    backgroundColor: colors.tealMuted,
  },
  actionDefaultBadge: {
    position: "absolute",
    top: 6,
    right: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.teal,
  },
  actionDefaultBadgeText: {
    color: colors.textInverse,
    fontSize: 11,
    fontWeight: "800",
  },
  actionGrid: {
    flexDirection: "column",
    gap: 8,
  },
  actionCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceFrost,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    ...tileShadow(),
  },
  actionCardDisabled: { opacity: 0.5 },
  actionIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  actionTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
  },
  actionDesc: {
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 14,
    marginTop: 2,
    flexShrink: 1,
  },

  // QR code modal styles
  qrSheet: {
    marginHorizontal: spacing.md,
    marginVertical: "auto",
    backgroundColor: colors.background,
    borderRadius: 16,
    padding: spacing.lg,
    alignItems: "stretch",
  },
  qrHolder: {
    alignSelf: "center",
    padding: 16,
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  qrCaption: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    textAlign: "center",
    marginBottom: spacing.md,
  },
  qrDetailsCard: {
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceFrost,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    gap: 4,
    ...tileShadow(),
  },
  qrDetailsLabel: {
    color: colors.textTertiary,
    fontSize: 10,
    letterSpacing: 1.2,
    fontWeight: "700",
    marginTop: 6,
  },
  qrDetailsValue: {
    color: colors.text,
    fontSize: 12,
    ...typography.mono,
  },
  qrMemoWarn: {
    color: colors.gold,
    fontSize: 11,
    lineHeight: 14,
    marginTop: 6,
  },
});
