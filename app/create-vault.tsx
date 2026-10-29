import { Feather } from "@expo/vector-icons";
import Slider from "@react-native-community/slider";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ScrollView as RNScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api/client";
import { describeError } from "@/src/api/describe-error";
import { Button } from "@/src/components/Button";
import { Calendar } from "@/src/components/Calendar";
import { Card } from "@/src/components/Card";
import { useToast } from "@/src/components/Toast";
import {
  GuidedTourCard,
  type GuidedTourStepId,
} from "@/src/components/GuidedTourCard";
import {
  completeGuidedTour,
  getGuidedTourStep,
  isGuidedTourActive,
  setGuidedTourStep,
} from "@/src/onboarding/guided-tour";
import { AddressBookPicker } from "@/src/send/components/AddressBookPicker";
import { shortenAddress } from "@/src/wallet/stellar";
import { useSession } from "@/src/state/session";
import {
  checkVaultCap,
  checkTimeGateCap,
  checkDmsCap,
  checkUnlockIntervalsAmountCap,
  checkMonthlyDepositCap,
} from "@/src/vault/free-tier-caps";
import {
  canCreateVaultType,
  getAccessibleVaultTypes,
  getCurrentTier,
  getTierConfig,
  hydrateTier,
  vaultTypeUpgradeMessage,
  type TierId,
  type TierVaultType,
} from "@/src/tiers/tier-config";
import { colors, radii, spacing, tileShadow, typography } from "@/src/theme";
import { formatUsDate, formatUsDateTime } from "@/src/utils/us-date";
import { lockMinimumNotice, isNativeXlmSac } from "@/src/vault/lock-minimum";
import { TEMPLATES, templateByKey } from "@/src/vault/templates";
/* --- MULTI-ASSET BETA (removable) --- */
import {
  MultiAssetBetaToggle,
  TokenPicker,
  isValidContractAddress,
  isMultiAssetBetaEnabled,
  createBetaVault,
  tokenSymbolForAddress,
  isNativeXlmAddress,
} from "@/src/wallet/multi-asset-beta";
/* --- /MULTI-ASSET BETA (removable) --- */
/* --- ADVANCED VAULTS BETA (removable) --- */
import {
  createCoolingOffVault,
  createVestingVault,
  createMultiAssetVestingVault,
  createDeadManSwitchVault,
  createMultiSigVault,
  createHtlcVault,
  getAdvancedNetworkName,
  humanizeAdvancedError,
  isValidBackupAddress,
  saveVestingMeta,
  stringifyRpcError,
  xlmToStroops,
  type AdvancedVaultKind,
  type VestingInterval,
} from "@/src/wallet/advanced-vaults";
import { StrKey } from "@stellar/stellar-sdk";
import { AdvancedVaultForm } from "@/src/vault/AdvancedVaultForm";
import { VaultNotifyConfirmModal } from "@/src/components/VaultNotifyConfirmModal";
import { upsertMultiSigEntry } from "@/src/vault/multi-sig-store";
import type { VaultNotifyKind } from "@/src/vault/vault-notify";
/* --- /ADVANCED VAULTS BETA (removable) --- */
const isAdvancedNetworkMainnet = getAdvancedNetworkName() === "mainnet";

type UnlockMode = "duration" | "date";

// MIN_DAYS = 0 — the slider allows dialing down to zero days
// when the user is combining hours + minute increments. Retained
// as a symbolic constant in case a future preset wants to bump
// this floor above 0.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const MIN_DAYS = 0;
const MAX_DAYS = 1000;
const DAY_SEC = 86400;
// Soroban simulation round-trip needs at least ~60s lock duration.
const MIN_TOTAL_SEC = 60 * 60;
// Slider bounds — hours 0-23, days 0-1000. Users needing longer
// than a slider will just tap the +/- buttons a few times.
const HOUR_SLIDER_MAX = 23;
const DAY_SLIDER_MAX = 60;
// Available 15-minute increments. `null` means "no minute add-on".
const MINUTE_INCREMENTS: readonly (0 | 15 | 30 | 45)[] = [0, 15, 30, 45];

const SWAP_TICKERS: readonly { ticker: string; label: string }[] = [
  { ticker: "sol", label: "SOL" },
  { ticker: "ltc", label: "LTC" },
  { ticker: "xrp", label: "XRP" },
  { ticker: "ada", label: "ADA" },
  { ticker: "usdt20", label: "USDT" },
  { ticker: "usdc", label: "USDC" },
];

export default function CreateVault() {
  const router = useRouter();
  const toast = useToast();
  const [tourActive, setTourActive] = useState(false);
  const [tourStep, setTourStep] = useState<GuidedTourStepId>(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const active = await isGuidedTourActive();
      if (cancelled) return;
      if (active) {
        const step = await getGuidedTourStep();
        if (cancelled) return;
        setTourActive(true);
        setTourStep(Math.min(3, Math.max(0, step)) as GuidedTourStepId);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const insets = useSafeAreaInsets();
  const { wallet, formatXlm, rates } = useSession();

  // Bill → Vault deep-link params (optional URL pre-fill from bill editor).
  // `type` / `tier` come from dashboard "+ New Vault" deep-links.
  const params = useLocalSearchParams<{
    name?: string;
    amount?: string;
    unlock_ts?: string;
    destination?: string;
    destination_label?: string;
    destination_memo?: string;
    bill_id?: string;
    tab?: string;
    type?: string;
    tier?: string;
  }>();

  const [tierId, setTierId] = useState<TierId>(getCurrentTier());
  useEffect(() => {
    void hydrateTier().then(setTierId);
  }, []);

  const tierCfg = getTierConfig(tierId);
  const accessibleTypes = getAccessibleVaultTypes(tierId);
  const allowedAdvancedKinds = useMemo(() => {
    const advanced: Exclude<AdvancedVaultKind, "TimeLock">[] = [];
    if (canCreateVaultType("CoolingOff", tierId)) advanced.push("CoolingOff");
    if (canCreateVaultType("Vesting", tierId)) advanced.push("Vesting");
    if (canCreateVaultType("MultiAssetVesting", tierId)) advanced.push("MultiAssetVesting");
    if (canCreateVaultType("DeadManSwitch", tierId)) advanced.push("DeadManSwitch");
    if (canCreateVaultType("MultiSig", tierId)) advanced.push("MultiSig");
    if (canCreateVaultType("HTLC", tierId)) advanced.push("HTLC");
    return advanced;
  }, [tierId]);
  const canUseAdvanced = allowedAdvancedKinds.length > 0;
  const canUseMultiAsset = canCreateVaultType("MultiAsset", tierId);

  /** Browse-without-seed: explore the form freely; gate only at fund/create. */
  const requireSeedToCreate = () => {
    toast.show("Add a wallet seed to create a vault.", "info");
    router.push("/wallet-setup");
  };

  const paramType = (params.type ?? "") as TierVaultType | "";
  const wantsAdvanced =
    params.tab === "advanced" ||
    (paramType !== "" &&
      paramType !== "TimeLock" &&
      paramType !== "MultiAsset");

  /* --- ADVANCED VAULTS BETA (removable) --- */
  // Single creation flow: basic vault by default; Advanced expands to reveal
  // Cooling-Off / Vesting Schedule (and other advanced kinds).
  const [advancedExpanded, setAdvancedExpanded] = useState(
    Boolean(wantsAdvanced && canUseAdvanced),
  );
  const vaultMode: "standard" | "advanced" = advancedExpanded
    ? "advanced"
    : "standard";
  const initialAdvancedKind = ((): Exclude<AdvancedVaultKind, "TimeLock"> => {
    if (
      paramType === "CoolingOff" ||
      paramType === "Vesting" ||
      paramType === "MultiAssetVesting" ||
      paramType === "DeadManSwitch" ||
      paramType === "MultiSig" ||
      paramType === "HTLC"
    ) {
      return paramType;
    }
    return allowedAdvancedKinds[0] ?? "CoolingOff";
  })();
  const [advancedKind, setAdvancedKind] = useState<
    Exclude<AdvancedVaultKind, "TimeLock">
  >(initialAdvancedKind);
  const [advName, setAdvName] = useState("");
  const [advAmount, setAdvAmount] = useState("");
  const [coolDays, setCoolDays] = useState(0);
  const [coolHours, setCoolHours] = useState(1);
  const [coolMinutes, setCoolMinutes] = useState(0);
  const [vestInterval, setVestInterval] = useState<VestingInterval>("daily");
  const [vestStartMode, setVestStartMode] = useState<"now" | "future">("now");
  const [vestStartDate, setVestStartDate] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 7);
    return d;
  });
  const [vestEndDate, setVestEndDate] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 37);
    return d;
  });
  const [maVestTokenAddress, setMaVestTokenAddress] = useState("");
  const [dmsBackupAddress, setDmsBackupAddress] = useState("");
  const [dmsBackupLabel, setDmsBackupLabel] = useState("");
  const [dmsAddressBookOpen, setDmsAddressBookOpen] = useState(false);
  const [dmsPeriodDays, setDmsPeriodDays] = useState(30);
  const [dmsPeriodHours, setDmsPeriodHours] = useState(0);
  const [dmsPeriodMinutes, setDmsPeriodMinutes] = useState(0);
  /* --- MULTI-SIG (removable, not yet on-chain) --- */
  const [multiSigCoSignerAddress, setMultiSigCoSignerAddress] = useState("");
  const [multiSigCoSignerLabel, setMultiSigCoSignerLabel] = useState("");
  const [multiSigAddressBookOpen, setMultiSigAddressBookOpen] = useState(false);
  /* --- /MULTI-SIG --- */
  /* --- HTLC --- */
  const [htlcHash, setHtlcHash] = useState("");
  const [htlcSecret, setHtlcSecret] = useState("");
  const [htlcRecipient, setHtlcRecipient] = useState("");
  const [htlcTimelockDays, setHtlcTimelockDays] = useState(1);
  const [htlcTimelockHours, setHtlcTimelockHours] = useState(0);
  /* --- /HTLC --- */
  const [advSubmitting, setAdvSubmitting] = useState(false);
  const [notifyModal, setNotifyModal] = useState<{
    destination: string;
    destinationLabel?: string;
    vaultRef: string;
    kind: VaultNotifyKind;
  } | null>(null);
  /* --- /ADVANCED VAULTS BETA (removable) --- */

  const [templateKey, setTemplateKey] = useState("custom");
  const [name, setName] = useState(params.name ?? "");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState(params.amount ?? "");
  const [target, setTarget] = useState("");
  // Withdrawal destination form state.
  const [destination, setDestination] = useState(params.destination ?? "");
  const [destinationLabel, setDestinationLabel] = useState(
    params.destination_label ?? "",
  );
  // Populated from saved contacts that carry a defaultMemo (exchange/casino).
  const [destinationMemo, setDestinationMemo] = useState(
    params.destination_memo ?? "",
  );
  const [pickedFromContact, setPickedFromContact] = useState(false);
  const [addressBookOpen, setAddressBookOpen] = useState(false);
  const billId = (params.bill_id ?? "").trim() || undefined;

  // "send" → /send pre-fill; "swap" → /swap wizard with ticker + amount.
  const [afterUnlockMode, setAfterUnlockMode] = useState<"send" | "swap">(
    "send",
  );
  const [swapTicker, setSwapTicker] = useState<string>("sol");

  const [unlockMode, setUnlockMode] = useState<UnlockMode>(
    // Bill-driven pre-fill: if unlock_ts came in as a URL param we jump
    // straight to "date" mode so the calendar shows the bill-derived
    // unlock day pre-selected.
    params.unlock_ts ? "date" : "duration",
  );
  // Default lock: 1 hour (user dials up via days/hours/minute chips).
  const [durationDays, setDurationDays] = useState(0);
  const [durationHours, setDurationHours] = useState(1);
  const [durationMinutes, setDurationMinutes] = useState<0 | 15 | 30 | 45>(0);
  const [date, setDate] = useState<Date>(() => {
    if (params.unlock_ts) {
      const secs = parseInt(params.unlock_ts, 10);
      if (Number.isFinite(secs) && secs > Date.now() / 1000) {
        return new Date(secs * 1000);
      }
    }
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d;
  });
  const [timeHour, setTimeHour] = useState<number>(0);
  const [timeMinute, setTimeMinute] = useState<0 | 15 | 30 | 45>(0);
  const [calendarOpen, setCalendarOpen] = useState(false);

  // Bill-flow banner one-time flag. Purely informational so the user
  // knows why the form is prefilled.
  const cameFromBill = !!billId;
  useEffect(() => {
    if (cameFromBill) {
      toast.show(
        "Bill pre-filled — review and adjust before signing.",
        "info",
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [submitting, setSubmitting] = useState(false);
  /* --- MULTI-ASSET BETA (removable) --- */
  // Beta is Mainnet-only; client.ts refuses to sign on Testnet.
  const [betaEnabled, setBetaEnabled] = useState(paramType === "MultiAsset");
  const [betaTokenAddress, setBetaTokenAddress] = useState("");
  /* --- /MULTI-ASSET BETA (removable) --- */

  // Keep create-flow options aligned with the active test/subscription tier.
  useEffect(() => {
    if (!canUseAdvanced && advancedExpanded) {
      setAdvancedExpanded(false);
    }
    if (
      canUseAdvanced &&
      allowedAdvancedKinds.length > 0 &&
      !allowedAdvancedKinds.includes(advancedKind)
    ) {
      setAdvancedKind(allowedAdvancedKinds[0]);
    }
    if (!canUseMultiAsset && betaEnabled) {
      setBetaEnabled(false);
    }
  }, [
    canUseAdvanced,
    canUseMultiAsset,
    allowedAdvancedKinds,
    advancedKind,
    advancedExpanded,
    betaEnabled,
  ]);

  const numericAmount = parseFloat(amount);
  const numericTarget = parseFloat(target);

  const unlockTimestamp = useMemo<number>(() => {
    if (unlockMode === "duration") {
      const total =
        durationDays * DAY_SEC +
        durationHours * 3600 +
        durationMinutes * 60;
      if (total < MIN_TOTAL_SEC) return 0;
      return Math.floor(Date.now() / 1000) + total;
    }
    const local = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      timeHour,
      timeMinute,
      0,
      0,
    );
    return Math.floor(local.getTime() / 1000);
  }, [
    unlockMode,
    durationDays,
    durationHours,
    durationMinutes,
    date,
    timeHour,
    timeMinute,
  ]);

  const validation = useMemo(() => {
    if (!name.trim()) return "Give your vault a name.";
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) return "Enter an initial deposit.";
    const betaLocksOtherToken =
      betaEnabled &&
      !!betaTokenAddress.trim() &&
      !isNativeXlmSac(betaTokenAddress);
    if (!betaLocksOtherToken) {
      const minimum = lockMinimumNotice(amount, wallet?.publicKey);
      if (minimum) return minimum;
    }
    if (target && (!Number.isFinite(numericTarget) || numericTarget <= 0)) {
      return "Target must be a positive number.";
    }
    const nowSec = Math.floor(Date.now() / 1000);
    if (unlockMode === "duration") {
      const total =
        durationDays * DAY_SEC +
        durationHours * 3600 +
        durationMinutes * 60;
      if (total < MIN_TOTAL_SEC) {
        return "Minimum lock is 1 hour.";
      }
      if (durationDays > MAX_DAYS) {
        return `Maximum lock is ${MAX_DAYS} days.`;
      }
    } else if (unlockTimestamp <= nowSec + MIN_TOTAL_SEC - 60) {
      // Allow a 60 s grace so the moment the user hits Submit the
      // signed transaction still clears the "at least 1 hour" check.
      return "Pick a future date at least 1 hour from now.";
    }
    return null;
  }, [
    name,
    amount,
    numericAmount,
    target,
    numericTarget,
    unlockMode,
    durationDays,
    durationHours,
    durationMinutes,
    unlockTimestamp,
    betaEnabled,
    betaTokenAddress,
    wallet?.publicKey,
  ]);

  // Max-days trigger. Decoupled from form validity — the red
  // illumination should show as soon as the user picks 1000 days,
  // regardless of whether the rest of the form is complete.
  const isMaxDaysMode =
    vaultMode === "standard" &&
    unlockMode === "duration" && durationDays >= MAX_DAYS;

  /* --- TIER CAPS — auto-switch away from capped advanced kinds --- */
  useEffect(() => {
    if (!wallet || vaultMode !== "advanced") return;
    (async () => {
      const [coolCap, dmsCap] = await Promise.all([
        checkTimeGateCap(wallet.publicKey),
        checkDmsCap(wallet.publicKey),
      ]);
      const fallback = allowedAdvancedKinds.find((k) => {
        if (k === "CoolingOff" && coolCap) return false;
        if (k === "DeadManSwitch" && dmsCap) return false;
        return true;
      });
      if (!fallback) return;
      if (coolCap && advancedKind === "CoolingOff") {
        setAdvancedKind(fallback);
      } else if (dmsCap && advancedKind === "DeadManSwitch") {
        setAdvancedKind(fallback);
      }
    })();
  }, [wallet, vaultMode, advancedKind, allowedAdvancedKinds]);
  /* --- /TIER CAPS --- */

  /* --- ADVANCED VAULTS BETA (removable) --- */
  const advNumericAmount = parseFloat(advAmount);

  /* --- Vesting Schedule amount cap check (removable) --- */
  const unlockIntervalsCapError = useMemo<string | null>(() => {
    if (advancedKind !== "Vesting" || !Number.isFinite(advNumericAmount) || advNumericAmount <= 0) return null;
    return checkUnlockIntervalsAmountCap(advNumericAmount, rates.USD);
  }, [advancedKind, advNumericAmount, rates.USD]);

  /* --- /Vesting Schedule amount cap check (removable) --- */
  const advancedValidation = useMemo<string | null>(() => {
    if (vaultMode !== "advanced") return null;
    if (!advName.trim()) return "Give your vault a name.";
    if (!Number.isFinite(advNumericAmount) || advNumericAmount <= 0) {
      return "Enter an initial deposit.";
    }
    const advancedLocksXlm =
      advancedKind !== "MultiAssetVesting" || isNativeXlmSac(maVestTokenAddress);
    if (advancedLocksXlm) {
      const minimum = lockMinimumNotice(advAmount, wallet?.publicKey);
      if (minimum) return minimum;
    }
    if (advancedKind === "CoolingOff") {
      const total = coolDays * DAY_SEC + coolHours * 3600 + coolMinutes * 60;
      if (total <= 0) return "Set a Cooling-Off period greater than zero.";
    } else if (advancedKind === "Vesting" || advancedKind === "MultiAssetVesting") {
      const nowSec = Math.floor(Date.now() / 1000);
      const startTs =
        vestStartMode === "future"
          ? Math.floor(vestStartDate.getTime() / 1000)
          : nowSec;
      const endTs = Math.floor(vestEndDate.getTime() / 1000);
      if (endTs <= startTs) return "Vesting end date must be after the start date.";
      const intervalSec =
        vestInterval === "daily"
          ? DAY_SEC
          : vestInterval === "weekly"
            ? 7 * DAY_SEC
            : 30 * DAY_SEC;
      if (endTs - startTs < intervalSec) {
        return `Vesting Schedule duration must be at least one ${vestInterval} interval.`;
      }
      if (vestStartMode === "future" && startTs <= nowSec) {
        return "Future start must be at least 1 day from now.";
      }
      if (advancedKind === "MultiAssetVesting" && !isValidContractAddress(maVestTokenAddress)) {
        return "Choose a token for your Multi-Asset Vesting vault.";
      }
      if (unlockIntervalsCapError) return unlockIntervalsCapError;
    } else if (advancedKind === "DeadManSwitch") {
      const backup = dmsBackupAddress.trim();
      if (!backup) {
        return "Enter a valid backup Stellar address (different from your own).";
      }
      if (wallet) {
        if (!isValidBackupAddress(backup, wallet.publicKey)) {
          return "Enter a valid backup Stellar address (different from your own).";
        }
      } else if (!StrKey.isValidEd25519PublicKey(backup)) {
        return "Enter a valid backup Stellar address (different from your own).";
      }
      const dmsTotal = dmsPeriodDays * DAY_SEC + dmsPeriodHours * 3600 + dmsPeriodMinutes * 60;
      if (dmsTotal <= 0) return "Set a check-in period greater than zero.";
    } else if (advancedKind === "MultiSig") {
      const coSigner = multiSigCoSignerAddress.trim();
      if (!coSigner) return "Enter a co-signer Stellar address.";
      if (!StrKey.isValidEd25519PublicKey(coSigner)) {
        return "That doesn't look like a valid Stellar address. It must be 56 characters and start with G.";
      }
      if (coSigner === wallet?.publicKey) {
        return "The co-signer must be a different address than your own.";
      }
    } else if (advancedKind === "HTLC") {
      const recipient = htlcRecipient.trim();
      if (!recipient || !StrKey.isValidEd25519PublicKey(recipient)) {
        return "Enter a valid counterparty Stellar address.";
      }
      if (recipient === wallet?.publicKey) {
        return "The counterparty must be a different address than your own.";
      }
      if (!htlcSecret.trim()) {
        return "Enter a secret passphrase.";
      }
      const tl =
        htlcTimelockDays * DAY_SEC + htlcTimelockHours * 3600;
      if (tl <= 0) return "Set a timelock greater than zero.";
    }
    return null;
  }, [
    vaultMode,
    advName,
    advAmount,
    advNumericAmount,
    advancedKind,
    coolDays,
    coolHours,
    coolMinutes,
    vestInterval,
    vestStartMode,
    vestStartDate,
    vestEndDate,
    maVestTokenAddress,
    dmsBackupAddress,
    dmsPeriodDays,
    dmsPeriodHours,
    dmsPeriodMinutes,
    multiSigCoSignerAddress,
    htlcSecret,
    htlcRecipient,
    htlcTimelockDays,
    htlcTimelockHours,
    wallet,
    unlockIntervalsCapError,
  ]);
  const standardLocksOtherToken =
    betaEnabled && !!betaTokenAddress.trim() && !isNativeXlmSac(betaTokenAddress);
  const standardLockNotice = standardLocksOtherToken
    ? null
    : lockMinimumNotice(amount, wallet?.publicKey);
  const advancedLockNotice =
    advancedKind === "MultiAssetVesting" && !isNativeXlmSac(maVestTokenAddress)
      ? null
      : lockMinimumNotice(advAmount, wallet?.publicKey);
  /* --- /ADVANCED VAULTS BETA (removable) --- */

  const applyTemplate = (key: string) => {
    const t = templateByKey(key);
    setTemplateKey(key);
    if (key !== "custom") {
      if (!name) setName(t.defaultName);
      if (!description) setDescription(t.defaultDescription);
      setUnlockMode("duration");
      setDurationDays(t.suggestedDays);
      setDurationHours(0);
      setDurationMinutes(0);
      const d = new Date();
      d.setDate(d.getDate() + t.suggestedDays);
      setDate(d);
    }
  };

  const handleSubmit = async () => {
    if (submitting) return;
    if (!wallet || !wallet.secretSeed) {
      requireSeedToCreate();
      return;
    }
    if (validation) {
      toast.show(validation, "error");
      return;
    }

    /* --- TIER LIMIT checks --- */
    if (betaEnabled && !canCreateVaultType("MultiAsset")) {
      toast.show(vaultTypeUpgradeMessage("MultiAsset"), "error");
      return;
    }
    // Parallel cap checks — independent reads; avoids serial round-trips.
    const [capMsg, depositCapMsg] = await Promise.all([
      checkVaultCap(wallet.publicKey),
      checkMonthlyDepositCap(wallet.publicKey, numericAmount, rates.USD),
    ]);
    if (capMsg) {
      toast.show(capMsg, "error");
      return;
    }
    if (depositCapMsg) {
      toast.show(depositCapMsg, "error");
      return;
    }
    /* --- /TIER LIMIT checks --- */

    try {
      setSubmitting(true);

      /* --- MULTI-ASSET BETA (removable) --- */
      // If the beta toggle is on, route to the multi-asset contract via the
      // beta client. This branch fully bypasses `api.createVault`, the
      // FastAPI mirror, and the backend receipt persistence — beta vaults
      // are on-chain-only by design. On success we bounce the user back to
      // the previous screen with a toast; the beta MVP intentionally does
      // not reuse the standard receipt UI.
      // Multi-asset beta targets Stellar Mainnet exclusively (see client.ts).
      if (betaEnabled && isMultiAssetBetaEnabled()) {
        if (!isValidContractAddress(betaTokenAddress)) {
          toast.show(
            "That doesn't look like a valid Stellar token address. Paste the 56-character address that starts with C.",
            "error",
          );
          setSubmitting(false);
          return;
        }
        toast.show(
          "Locking your token on Stellar Mainnet…",
          "info",
        );
        // Convert token units to stroops (1e7). SEP-41-compatible tokens
        // on Mainnet also use 7 decimals via the Stellar Asset Contract,
        // so this conversion is a safe default for the curated dropdown.
        // Users pasting a custom token with a different decimal precision
        // should note that the amount they enter is applied verbatim as
        // `amount * 10^7`.
        const stroops = BigInt(Math.round(numericAmount * 10_000_000));
        const result = await createBetaVault({
          ownerPublicKey: wallet.publicKey,
          ownerSecretSeed: wallet.secretSeed,
          tokenContractId: betaTokenAddress.trim(),
          name: name.trim(),
          amount: stroops,
          unlockTimestamp,
        });
        setSubmitting(false);
        if (result.ok) {
          toast.show(
            `Time-lock created. Your token is locked until ${
              unlockTimestamp
                ? formatUsDateTime(new Date(unlockTimestamp * 1000), {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "the unlock time you set"
            }. Early withdrawal is not possible.`,
            "success",
          );
          if (tourActive) {
            void completeGuidedTour();
            setTourActive(false);
          }
          // Dashboard shows the new beta vault immediately (no standard receipt UI).
          router.replace("/(tabs)/dashboard");
        } else {
          toast.show(
            result.error ?? "Time-lock creation failed. Check your balance, network, and unlock time, then try again.",
            "error",
          );
        }
        return;
      }
      /* --- /MULTI-ASSET BETA (removable) --- */

      // On-chain submission. Soroban simulation will reject if the user
      // doesn't have enough spendable XLM to cover the deposit plus fees,
      // so we don't need a local pre-flight balance check.
      toast.show("Signing transaction & waiting for ledger…", "info");
      const vault = await api.createVault({
        owner_public_key: wallet.publicKey,
        name: name.trim(),
        description: description.trim(),
        template: templateKey,
        initial_deposit: numericAmount,
        target_amount: target ? numericTarget : null,
        unlock_timestamp: unlockTimestamp,
      });
      const unlockLabel = unlockTimestamp
        ? formatUsDateTime(new Date(unlockTimestamp * 1000), {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "the unlock time you set";
      toast.show(
        `Time-lock created. Your XLM is locked on-chain until ${unlockLabel}. You cannot withdraw before then.`,
        "success",
      );
      if (tourActive) {
        void completeGuidedTour();
        setTourActive(false);
      }

      // Best-effort meta persist — failure does not undo the on-chain create.
      const cleanDest = destination.trim();
      const persistMeta =
        cleanDest ||
        billId ||
        afterUnlockMode === "swap";
      if (persistMeta) {
        try {
          const { putVaultMeta } = await import("@/src/api/soroban-client");
          await putVaultMeta(wallet.publicKey, vault.vault_id, {
            description: description.trim(),
            template: templateKey,
            target_amount: target ? numericTarget : null,
            name: name.trim(),
            withdrawal_destination:
              afterUnlockMode === "send" ? cleanDest || null : null,
            withdrawal_destination_label:
              afterUnlockMode === "send" ? destinationLabel.trim() || null : null,
            withdrawal_memo:
              afterUnlockMode === "send" ? destinationMemo.trim() || null : null,
            bill_id: billId || null,
            withdrawal_kind: afterUnlockMode,
            withdrawal_swap_ticker: afterUnlockMode === "swap" ? swapTicker : null,
          });
        } catch (e) {
          console.warn(
            "[create-vault] destination pre-fill save failed (non-fatal)",
            e,
          );
        }
      }

      router.replace(`/vault/${vault.vault_id}`);
    } catch (e) {
      const f = describeError(e);
      toast.show(
        f.message,
        "error",
        f.retryable ? { action: { label: "Retry", onPress: handleSubmit } } : undefined,
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleAdvancedSubmit = async () => {
    if (advSubmitting) return;
    if (!wallet || !wallet.secretSeed) {
      requireSeedToCreate();
      return;
    }
    if (advancedValidation) {
      toast.show(advancedValidation, "error");
      return;
    }

    /* --- TIER LIMIT checks --- */
    const kindAsTier: TierVaultType =
      advancedKind === "CoolingOff"
        ? "CoolingOff"
        : advancedKind === "Vesting"
          ? "Vesting"
          : advancedKind === "MultiAssetVesting"
            ? "MultiAssetVesting"
            : advancedKind === "DeadManSwitch"
              ? "DeadManSwitch"
              : advancedKind === "HTLC"
                ? "HTLC"
                : "MultiSig";
    if (!canCreateVaultType(kindAsTier)) {
      toast.show(vaultTypeUpgradeMessage(kindAsTier), "error");
      return;
    }
    const vaultCapMsg = await checkVaultCap(wallet.publicKey);
    if (vaultCapMsg) {
      toast.show(vaultCapMsg, "error");
      return;
    }
    const advDepositCapMsg = await checkMonthlyDepositCap(
      wallet.publicKey,
      advNumericAmount,
      rates.USD,
    );
    if (advDepositCapMsg) {
      toast.show(advDepositCapMsg, "error");
      return;
    }
    if (advancedKind === "CoolingOff") {
      const timeGateMsg = await checkTimeGateCap(wallet.publicKey);
      if (timeGateMsg) {
        toast.show(timeGateMsg, "error");
        return;
      }
    }
    if (advancedKind === "DeadManSwitch") {
      const dmsMsg = await checkDmsCap(wallet.publicKey);
      if (dmsMsg) {
        toast.show(dmsMsg, "error");
        return;
      }
    }
    /* --- /TIER LIMIT checks --- */

    try {
      setAdvSubmitting(true);
      toast.show(
        isAdvancedNetworkMainnet
          ? "Signing transaction on Stellar Mainnet…"
          : "Signing transaction on Stellar Testnet…",
        "info",
      );
      const stroops = xlmToStroops(advNumericAmount);
      let result;
      if (advancedKind === "CoolingOff") {
        const seconds = coolDays * DAY_SEC + coolHours * 3600 + coolMinutes * 60;
        result = await createCoolingOffVault({
          ownerPublicKey: wallet.publicKey,
          ownerSecretSeed: wallet.secretSeed,
          name: advName.trim(),
          amount: stroops,
          coolingOffDurationSeconds: seconds,
        });
      } else if (advancedKind === "Vesting" || advancedKind === "MultiAssetVesting") {
        const nowSec = Math.floor(Date.now() / 1000);
        const startTs =
          vestStartMode === "future"
            ? Math.floor(vestStartDate.getTime() / 1000)
            : nowSec;
        const endTs = Math.floor(vestEndDate.getTime() / 1000);
        if (advancedKind === "MultiAssetVesting") {
          if (!isValidContractAddress(maVestTokenAddress)) {
            toast.show("Choose a token for your Multi-Asset Vesting vault.", "error");
            setAdvSubmitting(false);
            return;
          }
          const tokenStroops = BigInt(Math.round(advNumericAmount * 10_000_000));
          result = await createMultiAssetVestingVault({
            ownerPublicKey: wallet.publicKey,
            ownerSecretSeed: wallet.secretSeed,
            name: advName.trim(),
            amount: tokenStroops,
            vestingStartTimestamp: startTs,
            vestingEndTimestamp: endTs,
            tokenContractId: maVestTokenAddress.trim(),
          });
        } else {
          result = await createVestingVault({
            ownerPublicKey: wallet.publicKey,
            ownerSecretSeed: wallet.secretSeed,
            name: advName.trim(),
            amount: stroops,
            vestingStartTimestamp: startTs,
            vestingEndTimestamp: endTs,
          });
        }
        if (result.ok && result.vaultId != null) {
          await saveVestingMeta(result.vaultId, { interval: vestInterval });
        }
      } else if (advancedKind === "DeadManSwitch") {
        result = await createDeadManSwitchVault({
          ownerPublicKey: wallet.publicKey,
          ownerSecretSeed: wallet.secretSeed,
          name: advName.trim(),
          amount: stroops,
          backupAddress: dmsBackupAddress.trim(),
          inactivityPeriodSeconds: dmsPeriodDays * DAY_SEC + dmsPeriodHours * 3600 + dmsPeriodMinutes * 60,
        });
      } else if (advancedKind === "MultiSig") {
        result = await createMultiSigVault({
          ownerPublicKey: wallet.publicKey,
          ownerSecretSeed: wallet.secretSeed,
          coSignerAddress: multiSigCoSignerAddress.trim(),
          amount: stroops,
          unlockTimestamp: 0, // MultiSig uses its own time-lock; 0 = no lock
        });
      } else if (advancedKind === "HTLC") {
        const nowSec = Math.floor(Date.now() / 1000);
        const timelock =
          nowSec +
          htlcTimelockDays * DAY_SEC +
          htlcTimelockHours * 3600;
        const secret = htlcSecret.trim();
        const Crypto = await import("expo-crypto");
        const hashHex = (
          await Crypto.digestStringAsync(
            Crypto.CryptoDigestAlgorithm.SHA256,
            secret,
          )
        ).toLowerCase();
        result = await createHtlcVault({
          ownerPublicKey: wallet.publicKey,
          ownerSecretSeed: wallet.secretSeed,
          name: advName.trim(),
          amount: stroops,
          recipient: htlcRecipient.trim(),
          hash: hashHex,
          secret,
          timelock,
        });
      } else {
        // Fallback for unexpected kinds — should never reach here.
        toast.show(
          "Unknown vault type. Please try again.",
          "error",
        );
        setAdvSubmitting(false);
        return;
      }
      if (result.ok) {
        toast.show(
          isAdvancedNetworkMainnet
            ? "Advanced vault created on Stellar Mainnet. Find it under Advanced Vaults on the Crypto tab."
            : "Advanced vault created on Stellar Testnet. Find it under Advanced Vaults on the Crypto tab.",
          "success",
        );

        // Multi-party vaults: prompt to notify the other party via memo payment.
        if (advancedKind === "DeadManSwitch" && "vaultId" in result && result.vaultId != null) {
          setNotifyModal({
            destination: dmsBackupAddress.trim(),
            destinationLabel: dmsBackupLabel || undefined,
            vaultRef: result.vaultId.toString(),
            kind: "DeadManSwitch",
          });
          return;
        }
        if (advancedKind === "MultiSig" && "contractId" in result && result.contractId) {
          await upsertMultiSigEntry(wallet.publicKey, {
            contractId: result.contractId,
            role: "owner",
            counterparty: multiSigCoSignerAddress.trim(),
            createdAt: Date.now(),
            isNew: false,
          });
          setNotifyModal({
            destination: multiSigCoSignerAddress.trim(),
            destinationLabel: multiSigCoSignerLabel || undefined,
            vaultRef: result.contractId,
            kind: "MultiSig",
          });
          return;
        }

        const { requestVaultListRefresh } = await import(
          "@/src/vault/vault-session-cache"
        );
        requestVaultListRefresh();
        router.replace("/(tabs)/wallet");
      } else {
        toast.show(result.error ?? "Time-lock creation failed. Check your balance, network, and unlock time, then try again.", "error");
      }
    } catch (e) {
      const raw = stringifyRpcError(e);
      toast.show(humanizeAdvancedError(raw), "error");
    } finally {
      setAdvSubmitting(false);
    }
  };
  /* --- /ADVANCED VAULTS BETA (removable) --- */

  return (
    <SafeAreaView edges={["top"]} style={styles.root} testID="create-vault-screen">
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.back}
          testID="create-vault-back"
        >
          <Feather name="x" size={22} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>New vault</Text>
          <View style={styles.tierBadge} testID="create-vault-tier-badge">
            <Text style={styles.tierBadgeText}>
              {tierCfg.label.toUpperCase()}
            </Text>
          </View>
        </View>
        <View style={{ width: 32 }} />
      </View>

      <KeyboardAwareScrollView
        ScrollViewComponent={RNScrollView as any}
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 160 }]}
        keyboardShouldPersistTaps="handled"
        bottomOffset={100}
      >
        <Text style={styles.tierHint} testID="create-vault-tier-hint">
          {accessibleTypes.length === 1
            ? "Standard Time-Lock vaults · upgrade for more types"
            : `${accessibleTypes.map((t) => t === "TimeLock" ? "Time-Lock" : t === "CoolingOff" ? "Cooling-Off" : t === "Vesting" ? "Vesting" : t === "MultiAsset" ? "Multi-Asset" : t === "MultiAssetVesting" ? "Multi-Asset Vesting" : t === "DeadManSwitch" ? "Dead Man's Switch" : t === "HTLC" ? "HTLC" : "Multi-Sig").join(" · ")}`}
        </Text>

        {tourActive ? (
          <GuidedTourCard
            step={tourStep}
            onBack={() => {
              const next = Math.max(0, tourStep - 1) as GuidedTourStepId;
              setTourStep(next);
              void setGuidedTourStep(next);
            }}
            onNext={() => {
              if (tourStep >= 3) {
                void completeGuidedTour();
                setTourActive(false);
                return;
              }
              const next = (tourStep + 1) as GuidedTourStepId;
              setTourStep(next);
              void setGuidedTourStep(next);
            }}
            onSkip={() => {
              void completeGuidedTour();
              setTourActive(false);
            }}
          />
        ) : null}

        {vaultMode === "standard" ? (
          <View style={styles.timeLockIntro} testID="create-vault-timelock-intro">
            <Feather name="info" size={14} color={colors.teal} />
            <Text style={styles.timeLockIntroText}>
              A time-lock vault deposits XLM into a Stellar smart contract. Funds
              stay locked until the unlock time in the Summary — you sign the
              create transaction now; withdrawal is only possible after unlock.
            </Text>
          </View>
        ) : null}

        {/* Advanced expandable — collapsed by default so the basic vault
            flow is the primary path. Expanding reveals Cooling-Off, Vesting
            Schedule, and other advanced kinds. Hidden when tier has none. */}
        {canUseAdvanced ? (
        <TouchableOpacity
          testID="vault-mode-advanced"
          onPress={() => setAdvancedExpanded((v) => !v)}
          activeOpacity={0.85}
          style={[
            styles.advancedToggle,
            advancedExpanded && styles.advancedToggleActive,
          ]}
          accessibilityRole="button"
          accessibilityState={{ expanded: advancedExpanded }}
          accessibilityLabel="Advanced vault settings"
        >
          <View style={styles.advancedToggleLeft}>
            <Feather
              name="sliders"
              size={16}
              color={advancedExpanded ? colors.cyan : colors.text}
            />
            <Text
              style={[
                styles.advancedToggleText,
                advancedExpanded && styles.advancedToggleTextActive,
              ]}
            >
              Advanced
            </Text>
            <View style={styles.betaBadge}>
              <Text style={styles.betaBadgeText}>Beta</Text>
            </View>
          </View>
          <Feather
            name={advancedExpanded ? "chevron-up" : "chevron-down"}
            size={18}
            color={advancedExpanded ? colors.cyan : colors.textSecondary}
          />
        </TouchableOpacity>
        ) : null}

        {vaultMode === "standard" ? (
        <>
        <Text style={styles.label}>TEMPLATE</Text>
        <RNScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.templateRow}
          testID="create-vault-template-row"
        >
          {TEMPLATES.map((t) => {
            const active = t.key === templateKey;
            return (
              <TouchableOpacity
                key={t.key}
                testID={`template-${t.key}`}
                onPress={() => applyTemplate(t.key)}
                activeOpacity={0.8}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Feather
                  name={t.icon as keyof typeof Feather.glyphMap}
                  size={14}
                  color={active ? colors.textInverse : colors.text}
                />
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{t.label}</Text>
              </TouchableOpacity>
            );
          })}
        </RNScrollView>

        {/*
          Mainnet-only beta toggle. Rendered as null when the env flag
          `EXPO_PUBLIC_MULTI_ASSET_BETA=1` is not set, so this JSX block
          has zero visual footprint in production. When enabled AND the
          contract has been deployed (see contract-config.ts), the
          TokenPicker appears below the toggle and the submit handler
          routes to the beta contract via createBetaVault().
        */}
        {canUseMultiAsset ? (
        <MultiAssetBetaToggle
          value={betaEnabled}
          onChange={setBetaEnabled}
        />
        ) : null}
        {canUseMultiAsset && betaEnabled ? (
          <>
            <TokenPicker
              value={betaTokenAddress}
              onChange={setBetaTokenAddress}
            />
            {betaTokenAddress &&
            isValidContractAddress(betaTokenAddress) &&
            !isNativeXlmAddress(betaTokenAddress) ? (
              <View style={styles.feeReminderBox}>
                <Feather name="info" size={12} color={colors.teal} />
                <Text style={styles.feeReminderText}>
                  Keep a small amount of XLM in your wallet (about 1 XLM is
                  plenty) to pay the network fee. XLM is not deducted from
                  your locked amount.
                </Text>
              </View>
            ) : null}
          </>
        ) : null}

        <Text style={styles.label}>VAULT NAME</Text>
        <TextInput
          testID="create-vault-name"
          value={name}
          onChangeText={setName}
          placeholder="e.g. Emergency Fund"
          placeholderTextColor={colors.textTertiary}
          style={styles.input}
          maxLength={64}
        />

        <Text style={styles.label}>DESCRIPTION (OPTIONAL)</Text>
        <TextInput
          testID="create-vault-description"
          value={description}
          onChangeText={setDescription}
          placeholder="Why this vault exists"
          placeholderTextColor={colors.textTertiary}
          style={[styles.input, { minHeight: 70, textAlignVertical: "top" }]}
          multiline
          maxLength={280}
        />

        <Text style={styles.label}>
          {(() => {
            if (!betaEnabled) return "INITIAL DEPOSIT (XLM)";
            const sym = tokenSymbolForAddress(betaTokenAddress);
            if (sym) return `INITIAL DEPOSIT (${sym})`;
            return "INITIAL DEPOSIT (AMOUNT)";
          })()}
        </Text>
        <TextInput
          testID="create-vault-amount"
          value={amount}
          onChangeText={setAmount}
          placeholder="100"
          placeholderTextColor={colors.textTertiary}
          keyboardType="decimal-pad"
          style={styles.input}
        />
        {standardLockNotice ? (
          <Text
            style={styles.lockMinimum}
            testID="create-vault-lock-minimum"
            accessibilityRole="alert"
          >
            {standardLockNotice}
          </Text>
        ) : null}

        <Text style={styles.label}>TARGET AMOUNT (OPTIONAL)</Text>
        <TextInput
          testID="create-vault-target"
          value={target}
          onChangeText={setTarget}
          placeholder="500"
          placeholderTextColor={colors.textTertiary}
          keyboardType="decimal-pad"
          style={styles.input}
        />

        <Text style={styles.label}>
          AFTER UNLOCK (OPTIONAL)
        </Text>
        <Text style={styles.helper}>
          Choose what happens when the vault unlocks. We'll save your
          preference and give you a one-tap shortcut later (you still sign
          manually).
        </Text>

        <View style={styles.segmentRow}>
          <Segment
            testID="after-unlock-mode-send"
            label="Send"
            active={afterUnlockMode === "send"}
            onPress={() => setAfterUnlockMode("send")}
          />
          <Segment
            testID="after-unlock-mode-swap"
            label="Swap"
            active={afterUnlockMode === "swap"}
            onPress={() => setAfterUnlockMode("swap")}
          />
        </View>

        {afterUnlockMode === "send" ? (
          pickedFromContact ? (
            <View
              style={styles.pickedContactCard}
              testID="create-vault-picked-contact"
            >
              <Feather name="user-check" size={16} color={colors.teal} />
              <View style={{ flex: 1 }}>
                <Text style={styles.pickedContactLabel} numberOfLines={1}>
                  {destinationLabel || "Saved contact"}
                </Text>
                <Text style={styles.pickedContactAddr} numberOfLines={1}>
                  {shortenAddress(destination, 8, 8)}
                </Text>
                {destinationMemo ? (
                  <Text style={styles.pickedContactMemo} numberOfLines={1}>
                    Memo: {destinationMemo}
                  </Text>
                ) : null}
              </View>
              <TouchableOpacity
                onPress={() => {
                  setDestination("");
                  setDestinationLabel("");
                  setDestinationMemo("");
                  setPickedFromContact(false);
                }}
                testID="create-vault-clear-contact"
                style={styles.pickedContactClear}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Feather name="x" size={16} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <TouchableOpacity
                onPress={() => setAddressBookOpen(true)}
                style={styles.addressBookBtn}
                testID="create-vault-open-address-book"
                activeOpacity={0.85}
              >
                <Feather name="users" size={16} color={colors.teal} />
                <Text style={styles.addressBookBtnText}>
                  Choose from Address Book
                </Text>
                <Feather name="chevron-right" size={16} color={colors.teal} />
              </TouchableOpacity>
              <Text style={styles.orDivider}>— or type below —</Text>
              <TextInput
                testID="create-vault-destination"
                value={destination}
                onChangeText={setDestination}
                placeholder="Stellar address (G…, 56 chars)"
                placeholderTextColor={colors.textTertiary}
                autoCapitalize="characters"
                autoCorrect={false}
                style={[styles.input, styles.mono]}
                maxLength={56}
              />
              <TextInput
                testID="create-vault-destination-label"
                value={destinationLabel}
                onChangeText={setDestinationLabel}
                placeholder="Label (e.g. Landlord, PayPal, Rent for Nov)"
                placeholderTextColor={colors.textTertiary}
                style={styles.input}
                maxLength={40}
              />
            </>
          )
        ) : (
          <>
            <Text style={styles.helper}>
              After unlock, we'll open the Swap wizard with the target
              currency selected and your unlocked XLM ready to swap. You pick
              the destination address inside the wizard.
            </Text>
            <RNScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.templateRow}
              testID="create-vault-swap-ticker-row"
            >
              {SWAP_TICKERS.map((t) => {
                const active = swapTicker === t.ticker;
                return (
                  <TouchableOpacity
                    key={t.ticker}
                    testID={`create-vault-swap-ticker-${t.ticker}`}
                    onPress={() => setSwapTicker(t.ticker)}
                    activeOpacity={0.85}
                    style={[styles.chip, active && styles.chipActive]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        active && styles.chipTextActive,
                      ]}
                    >
                      {t.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </RNScrollView>
            <Text style={styles.hint}>
              Powered by SimpleSwap. Non-custodial — the swap wizard walks you
              through sending the unlocked XLM from your wallet to the swap
              provider's deposit address.
            </Text>
          </>
        )}
        <Text style={styles.label}>UNLOCK METHOD</Text>
        <Text style={styles.helper} testID="create-vault-unlock-helper">
          This is when your funds become withdrawable. Until then the vault is
          locked on-chain — choose a duration from now, or an exact date and time
          in your device timezone. Minimum lock is 1 hour.
        </Text>
        <View style={styles.segmentRow}>
          <Segment
            testID="unlock-mode-duration"
            label="Duration"
            active={unlockMode === "duration"}
            onPress={() => setUnlockMode("duration")}
          />
          <Segment
            testID="unlock-mode-date"
            label="Unlock by date"
            active={unlockMode === "date"}
            onPress={() => {
              setUnlockMode("date");
              setCalendarOpen(true);
            }}
          />
        </View>

        {unlockMode === "duration" ? (
          <>
            <View style={styles.sliderRow}>
              <Text style={styles.sliderLabel}>Days</Text>
              <View style={styles.sliderValuePill}>
                <Text
                  style={styles.sliderValueText}
                  testID="create-vault-duration-days-value"
                >
                  {durationDays}
                </Text>
              </View>
            </View>
            <View style={styles.sliderTrack}>
              <TouchableOpacity
                onPress={() => setDurationDays(Math.max(0, durationDays - 1))}
                style={styles.stepBtn}
                testID="create-vault-duration-days-minus"
                hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
              >
                <Feather name="minus" size={16} color={colors.text} />
              </TouchableOpacity>
              <Slider
                style={styles.slider}
                minimumValue={0}
                maximumValue={DAY_SLIDER_MAX}
                step={1}
                value={Math.min(durationDays, DAY_SLIDER_MAX)}
                onValueChange={(v) => setDurationDays(Math.round(v))}
                minimumTrackTintColor={colors.teal}
                maximumTrackTintColor={colors.borderSubtle}
                thumbTintColor={colors.teal}
                testID="create-vault-duration-days-slider"
              />
              <TouchableOpacity
                onPress={() =>
                  setDurationDays(Math.min(MAX_DAYS, durationDays + 1))
                }
                style={styles.stepBtn}
                testID="create-vault-duration-days-plus"
                hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
              >
                <Feather name="plus" size={16} color={colors.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.sliderRow}>
              <Text style={styles.sliderLabel}>Hours</Text>
              <View style={styles.sliderValuePill}>
                <Text
                  style={styles.sliderValueText}
                  testID="create-vault-duration-hours-value"
                >
                  {durationHours}
                </Text>
              </View>
            </View>
            <View style={styles.sliderTrack}>
              <TouchableOpacity
                onPress={() => setDurationHours(Math.max(0, durationHours - 1))}
                style={styles.stepBtn}
                testID="create-vault-duration-hours-minus"
                hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
              >
                <Feather name="minus" size={16} color={colors.text} />
              </TouchableOpacity>
              <Slider
                style={styles.slider}
                minimumValue={0}
                maximumValue={HOUR_SLIDER_MAX}
                step={1}
                value={durationHours}
                onValueChange={(v) => setDurationHours(Math.round(v))}
                minimumTrackTintColor={colors.teal}
                maximumTrackTintColor={colors.borderSubtle}
                thumbTintColor={colors.teal}
                testID="create-vault-duration-hours-slider"
              />
              <TouchableOpacity
                onPress={() =>
                  setDurationHours(Math.min(HOUR_SLIDER_MAX, durationHours + 1))
                }
                style={styles.stepBtn}
                testID="create-vault-duration-hours-plus"
                hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
              >
                <Feather name="plus" size={16} color={colors.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.sliderRow}>
              <Text style={styles.sliderLabel}>Extra minutes</Text>
              <View style={styles.sliderValuePill}>
                <Text style={styles.sliderValueText}>
                  {durationMinutes === 0 ? "+00" : `+${durationMinutes}`}
                </Text>
              </View>
            </View>
            <View style={styles.minuteChipRow}>
              {MINUTE_INCREMENTS.map((m) => {
                const active = durationMinutes === m;
                return (
                  <TouchableOpacity
                    key={m}
                    testID={`create-vault-minute-inc-${m}`}
                    onPress={() => setDurationMinutes(m)}
                    activeOpacity={0.85}
                    style={[styles.minuteChip, active && styles.minuteChipActive]}
                  >
                    <Text
                      style={[
                        styles.minuteChipText,
                        active && styles.minuteChipTextActive,
                      ]}
                    >
                      +{String(m).padStart(2, "0")}m
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={styles.hint}>
              Minimum lock is 1 hour. Combine days + hours + a 15-minute
              increment for the exact lock you need.
            </Text>
          </>
        ) : (
          <>
            <TouchableOpacity
              testID="create-vault-open-calendar"
              onPress={() => setCalendarOpen(true)}
              style={[styles.input, styles.dateButton]}
              activeOpacity={0.85}
            >
              <Feather name="calendar" size={16} color={colors.teal} />
              <Text style={styles.dateText} testID="create-vault-selected-date">
                {formatUsDate(date, {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </Text>
              <View style={{ flex: 1 }} />
              <Feather name="chevron-down" size={16} color={colors.textTertiary} />
            </TouchableOpacity>

            <View style={styles.sliderRow}>
              <Text style={styles.sliderLabel}>Time (24-hour)</Text>
              <View style={styles.sliderValuePill}>
                <Text
                  style={styles.sliderValueText}
                  testID="create-vault-time-value"
                >
                  {`${String(timeHour).padStart(2, "0")}:${String(timeMinute).padStart(2, "0")}`}
                </Text>
              </View>
            </View>
            <View style={styles.sliderTrack}>
              <TouchableOpacity
                onPress={() => setTimeHour(Math.max(0, timeHour - 1))}
                style={styles.stepBtn}
                testID="create-vault-time-hour-minus"
                hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
              >
                <Feather name="minus" size={16} color={colors.text} />
              </TouchableOpacity>
              <Slider
                style={styles.slider}
                minimumValue={0}
                maximumValue={23}
                step={1}
                value={timeHour}
                onValueChange={(v) => setTimeHour(Math.round(v))}
                minimumTrackTintColor={colors.teal}
                maximumTrackTintColor={colors.borderSubtle}
                thumbTintColor={colors.teal}
                testID="create-vault-time-hour-slider"
              />
              <TouchableOpacity
                onPress={() => setTimeHour(Math.min(23, timeHour + 1))}
                style={styles.stepBtn}
                testID="create-vault-time-hour-plus"
                hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
              >
                <Feather name="plus" size={16} color={colors.text} />
              </TouchableOpacity>
            </View>
            <View style={styles.minuteChipRow}>
              {MINUTE_INCREMENTS.map((m) => {
                const active = timeMinute === m;
                return (
                  <TouchableOpacity
                    key={m}
                    testID={`create-vault-time-minute-${m}`}
                    onPress={() => setTimeMinute(m)}
                    activeOpacity={0.85}
                    style={[styles.minuteChip, active && styles.minuteChipActive]}
                  >
                    <Text
                      style={[
                        styles.minuteChipText,
                        active && styles.minuteChipTextActive,
                      ]}
                    >
                      :{String(m).padStart(2, "0")}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={styles.hint}>
              Pick any future date. The unlock happens at the exact
              hour + minute you set here, in your device timezone.
            </Text>
          </>
        )}

        <Card padded style={{ marginTop: spacing.lg }}>
          <Text style={styles.eyebrow}>SUMMARY</Text>
          <SummaryLine label="Vault name" value={name || "—"} />
          <SummaryLine
            label="Deposit"
            value={Number.isFinite(numericAmount) ? formatXlm(numericAmount) : "—"}
          />
          <SummaryLine
            label="Unlock"
            value={
              unlockTimestamp
                ? formatUsDateTime(new Date(unlockTimestamp * 1000), {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "—"
            }
          />
          <SummaryLine
            label="Lock duration"
            value={
              unlockTimestamp
                ? formatLockDuration(unlockTimestamp - Math.floor(Date.now() / 1000))
                : "—"
            }
          />
          <SummaryLine
            label="Est. creation cost"
            value="~0.01 XLM"
          />
        </Card>

        <View style={styles.creationCostBox} testID="create-vault-est-cost">
          <Feather name="zap" size={14} color={colors.gold} />
          <View style={{ flex: 1 }}>
            <Text style={styles.creationCostLabel}>Estimated creation cost</Text>
            <Text style={styles.creationCostValue}>~0.01 XLM</Text>
            <Text style={styles.creationCostHint}>
              Soroban contract fee paid to Stellar validators (not to this app).
              Exact amount is set at submission.
            </Text>
          </View>
        </View>

        <Text style={styles.feeFootnote}>
          Network fees are paid in XLM to Stellar validators (not to XLM
          Vault). The amount is locked in by the ledger at submission time —
          you'll see the exact charge on the receipt.
        </Text>

        {validation ? <Text style={styles.warn}>{validation}</Text> : null}
        </>
        ) : (
          /* --- ADVANCED VAULTS BETA (removable) --- */
          <AdvancedVaultForm
            kind={advancedKind}
            onKindChange={setAdvancedKind}
            name={advName}
            onNameChange={setAdvName}
            amount={advAmount}
            onAmountChange={setAdvAmount}
            coolDays={coolDays}
            onCoolDays={setCoolDays}
            coolHours={coolHours}
            onCoolHours={setCoolHours}
            coolMinutes={coolMinutes}
            onCoolMinutes={setCoolMinutes}
            vestInterval={vestInterval}
            onVestInterval={setVestInterval}
            vestStartMode={vestStartMode}
            onVestStartMode={setVestStartMode}
            vestStartDate={vestStartDate}
            onVestStartDate={setVestStartDate}
            vestEndDate={vestEndDate}
            onVestEndDate={setVestEndDate}
            dmsBackupAddress={dmsBackupAddress}
            onDmsBackupAddress={setDmsBackupAddress}
            dmsBackupLabel={dmsBackupLabel}
            onClearBackup={() => {
              setDmsBackupAddress("");
              setDmsBackupLabel("");
            }}
            onOpenAddressBook={() => setDmsAddressBookOpen(true)}
            dmsPeriodDays={dmsPeriodDays}
            onDmsPeriodDays={setDmsPeriodDays}
            dmsPeriodHours={dmsPeriodHours}
            onDmsPeriodHours={setDmsPeriodHours}
            dmsPeriodMinutes={dmsPeriodMinutes}
            onDmsPeriodMinutes={setDmsPeriodMinutes}
            multiSigCoSignerAddress={multiSigCoSignerAddress}
            onMultiSigCoSignerAddress={setMultiSigCoSignerAddress}
            multiSigCoSignerLabel={multiSigCoSignerLabel}
            onClearCoSigner={() => {
              setMultiSigCoSignerAddress("");
              setMultiSigCoSignerLabel("");
            }}
            onOpenMultiSigAddressBook={() => setMultiSigAddressBookOpen(true)}
            htlcHash={htlcHash}
            onHtlcHash={setHtlcHash}
            htlcSecret={htlcSecret}
            onHtlcSecret={setHtlcSecret}
            htlcRecipient={htlcRecipient}
            onHtlcRecipient={setHtlcRecipient}
            htlcTimelockDays={htlcTimelockDays}
            onHtlcTimelockDays={setHtlcTimelockDays}
            htlcTimelockHours={htlcTimelockHours}
            onHtlcTimelockHours={setHtlcTimelockHours}
            validationError={advancedValidation}
            amountNotice={advancedLockNotice}
            allowedKinds={allowedAdvancedKinds}
            maVestTokenAddress={maVestTokenAddress}
            onMaVestTokenAddress={setMaVestTokenAddress}
          />
          /* --- /ADVANCED VAULTS BETA (removable) --- */
        )}
      </KeyboardAwareScrollView>

      <Calendar
        visible={calendarOpen}
        value={date}
        minDate={new Date(Date.now() + DAY_SEC * 1000)}
        maxDate={new Date(Date.now() + MAX_DAYS * DAY_SEC * 1000)}
        onSelect={(d) => {
          setDate(d);
          setCalendarOpen(false);
        }}
        onClose={() => setCalendarOpen(false)}
      />

      <AddressBookPicker
        visible={addressBookOpen}
        onClose={() => setAddressBookOpen(false)}
        onPick={(entry) => {
          setDestination(entry.publicKey);
          setDestinationLabel(entry.label);
          setDestinationMemo(entry.defaultMemo ?? "");
          setPickedFromContact(true);
          setAddressBookOpen(false);
        }}
      />
      <AddressBookPicker
        visible={dmsAddressBookOpen}
        onClose={() => setDmsAddressBookOpen(false)}
        onPick={(entry) => {
          setDmsBackupAddress(entry.publicKey);
          setDmsBackupLabel(entry.label);
          setDmsAddressBookOpen(false);
        }}
      />
      <AddressBookPicker
        visible={multiSigAddressBookOpen}
        onClose={() => setMultiSigAddressBookOpen(false)}
        onPick={(entry) => {
          setMultiSigCoSignerAddress(entry.publicKey);
          setMultiSigCoSignerLabel(entry.label);
          setMultiSigAddressBookOpen(false);
        }}
      />

      <VaultNotifyConfirmModal
        visible={!!notifyModal}
        keypair={wallet}
        destination={notifyModal?.destination ?? ""}
        destinationLabel={notifyModal?.destinationLabel}
        vaultRef={notifyModal?.vaultRef ?? ""}
        kind={notifyModal?.kind ?? "DeadManSwitch"}
        required
        message={
          notifyModal?.kind === "MultiSig"
            ? "Your co-signer must be notified. This sends a 0.0001 XLM transaction with the vault details."
            : "Your beneficiary must be notified. This sends a 0.0001 XLM transaction with the vault details."
        }
        onDone={(sent) => {
          // Notification is mandatory for multi-party vault setup — only leave
          // after a successful ping (required mode hides Skip / blocks dismiss).
          if (!sent) return;
          toast.show("Notification sent — the other party can discover this vault.", "success");
          setNotifyModal(null);
          router.replace("/(tabs)/wallet");
        }}
      />

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        {!isMaxDaysMode ? (
          <Text style={styles.onchainHint} testID="create-vault-onchain-hint">
            {vaultMode === "advanced"
              ? isAdvancedNetworkMainnet
                ? "Once submitted, this creates a real transaction on Stellar Mainnet using real funds (Advanced Beta). The lock cannot be undone."
                : "Once submitted, this creates a real transaction on Stellar Testnet (Advanced Beta)."
              : "Once submitted, this creates a real transaction on Stellar Mainnet. The lock cannot be undone."}
          </Text>
        ) : null}
        <Button
          testID="create-vault-submit"
          label={
            vaultMode === "advanced"
              ? advSubmitting
                ? "Locking your funds…"
                : "Lock funds on-chain"
              : submitting
                ? "Locking your funds…"
                : "Lock funds on-chain"
          }
          icon="lock"
          onPress={vaultMode === "advanced" ? handleAdvancedSubmit : handleSubmit}
          loading={vaultMode === "advanced" ? advSubmitting : submitting}
          disabled={!!(vaultMode === "advanced" ? advancedValidation : validation)}
          variant={isMaxDaysMode ? "danger" : "primary"}
          illuminated={isMaxDaysMode}
        />
        {isMaxDaysMode ? (
          <Text style={styles.onchainWarning} testID="create-vault-onchain-warning">
            Heads up: you're locking these funds for 1000 days (about 2 years, 9 months) — the maximum lock period. Please double-check the unlock date in the summary above is what you intended.
          </Text>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryLine}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function Segment({
  label,
  active,
  onPress,
  testID,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <TouchableOpacity
      testID={testID}
      onPress={onPress}
      activeOpacity={0.85}
      style={[styles.segment, active && styles.segmentActive]}
    >
      <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

/**
 * Render a remaining-time delta in the friendliest unit:
 *   < 60s   → "<1 min"
 *   < 60m   → "5 min"
 *   < 24h   → "1 hr 30 min"
 *   ≥ 24h   → "12 days"
 *
 * `seconds` may be negative briefly if the user toggles mode while the clock
 * ticks past the unlock — return a non-cryptic dash in that case.
 */
function formatLockDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  if (seconds < 60) return "<1 min";
  const totalMin = Math.round(seconds / 60);
  if (totalMin < 60) return `${totalMin} min`;
  if (totalMin < 60 * 24) {
    const hr = Math.floor(totalMin / 60);
    const min = totalMin % 60;
    return min === 0 ? `${hr} hr` : `${hr} hr ${min} min`;
  }
  const days = Math.max(1, Math.ceil(seconds / DAY_SEC));
  return `${days} day${days === 1 ? "" : "s"}`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomColor: colors.borderSubtle,
    borderBottomWidth: 1,
  },
  back: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: colors.text, fontSize: 16, ...typography.heading },

  body: { padding: spacing.md },
  // --- ADVANCED VAULTS BETA (removable) ---
  advancedToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surfaceFrost,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    ...tileShadow(),
  },
  advancedToggleActive: {
    backgroundColor: colors.cyanMuted,
    borderColor: colors.borderGlow,
  },
  advancedToggleLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  advancedToggleText: { color: colors.text, fontSize: 14, fontWeight: "700" },
  advancedToggleTextActive: { color: colors.cyan },
  betaBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radii.pill,
    backgroundColor: colors.cyan,
  },
  betaBadgeText: { color: colors.textInverse, fontSize: 8, fontWeight: "800", letterSpacing: 0.3 },
  headerTitleWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  tierBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.gold + "22",
    borderWidth: 1,
    borderColor: colors.gold + "66",
  },
  tierBadgeText: {
    color: colors.gold,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  tierHint: {
    color: colors.textTertiary,
    fontSize: 11,
    lineHeight: 15,
    marginBottom: spacing.sm,
  },
  // --- /ADVANCED VAULTS BETA (removable) ---
  label: {
    color: colors.textTertiary,
    fontSize: 10,
    ...typography.label,
    marginTop: spacing.md,
    marginBottom: 6,
    paddingBottom: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  input: {
    backgroundColor: colors.surfaceFrost,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    color: colors.text,
    fontSize: 15,
  },
  hint: { color: colors.textTertiary, fontSize: 11, marginTop: 6, marginLeft: 4 },
  timeLockIntro: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: spacing.sm,
    borderRadius: radii.sm,
    backgroundColor: colors.tealMuted,
    marginBottom: spacing.sm,
  },
  timeLockIntroText: {
    flex: 1,
    color: colors.teal,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
  },
  helper: {
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 2,
    marginBottom: 6,
  },
  mono: { ...typography.mono, fontSize: 13 },
  addressBookBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: spacing.md - 2,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.teal,
    borderStyle: "dashed",
    backgroundColor: colors.tealMuted,
    marginTop: spacing.xs,
  },
  addressBookBtnText: {
    flex: 1,
    color: colors.teal,
    fontSize: 14,
    fontWeight: "700",
  },
  orDivider: {
    color: colors.textTertiary,
    fontSize: 11,
    letterSpacing: 0.4,
    textAlign: "center",
    marginVertical: spacing.sm,
  },
  pickedContactCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.teal,
    backgroundColor: colors.tealMuted,
    marginTop: spacing.xs,
  },
  pickedContactLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
  },
  pickedContactAddr: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
    ...typography.mono,
  },
  pickedContactMemo: {
    color: colors.teal,
    fontSize: 12,
    marginTop: 2,
    fontWeight: "600",
  },
  pickedContactClear: {
    padding: 6,
  },

  templateRow: { gap: 8, paddingVertical: 4 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    flexShrink: 0,
  },
  chipActive: { backgroundColor: colors.teal, borderColor: colors.teal },
  chipText: { color: colors.text, fontSize: 12, fontWeight: "600" },
  chipTextActive: { color: colors.textInverse },

  segmentRow: { flexDirection: "row", gap: 8, marginBottom: spacing.sm },
  segment: {
    flex: 1,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 12,
    alignItems: "center",
  },
  segmentActive: { backgroundColor: colors.tealMuted, borderColor: colors.teal },
  segmentText: { color: colors.text, fontSize: 13, fontWeight: "600" },
  segmentTextActive: { color: colors.teal },

  minutePresetRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: spacing.sm,
  },
  sliderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.sm,
    marginBottom: 6,
  },
  sliderLabel: {
    color: colors.textSecondary,
    fontSize: 11,
    ...typography.label,
  },
  sliderValuePill: {
    minWidth: 60,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.tealMuted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.teal,
    alignItems: "center",
  },
  sliderValueText: {
    color: colors.teal,
    fontSize: 15,
    fontWeight: "800",
    ...typography.mono,
  },
  sliderTrack: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: spacing.sm,
  },
  slider: {
    flex: 1,
    height: 32,
  },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: radii.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  minuteChipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: spacing.sm,
  },
  minuteChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  minuteChipActive: { backgroundColor: colors.teal, borderColor: colors.teal },
  minuteChipText: { color: colors.text, fontSize: 12, fontWeight: "600" },
  minuteChipTextActive: { color: colors.textInverse },

  dateButton: { flexDirection: "row", alignItems: "center", gap: 10 },
  dateText: { color: colors.text, fontSize: 15 },

  eyebrow: { color: colors.teal, fontSize: 10, ...typography.label, marginBottom: 8 },
  summaryLine: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
  },
  summaryLabel: { color: colors.textSecondary, fontSize: 12 },
  summaryValue: { color: colors.text, fontSize: 13, ...typography.mono, maxWidth: "60%" },

  warn: {
    color: colors.danger,
    fontSize: 12,
    marginTop: spacing.md,
    marginLeft: 4,
  },
  lockMinimum: {
    color: colors.danger,
    fontSize: 20,
    lineHeight: 26,
    marginTop: 8,
    marginBottom: 4,
  },

  feeFootnote: {
    color: colors.textTertiary,
    fontSize: 11,
    marginTop: spacing.sm,
    marginHorizontal: 4,
    lineHeight: 15,
  },
  creationCostBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderGold,
    backgroundColor: colors.goldMuted,
  },
  creationCostLabel: {
    color: colors.gold,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  creationCostValue: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
    ...typography.mono,
    marginBottom: 4,
  },
  creationCostHint: {
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 15,
  },

  onchainHint: {
    color: colors.teal,
    fontSize: 11,
    textAlign: "center",
    marginBottom: 8,
    ...typography.label,
  },

  onchainWarning: {
    color: colors.danger,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "600",
    textAlign: "center",
    marginTop: 10,
    letterSpacing: 0.2,
  },

  feeReminderBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    marginTop: -spacing.sm,
    marginBottom: spacing.md,
    padding: 10,
    backgroundColor: colors.tealMuted,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.teal,
  },
  feeReminderText: {
    color: colors.teal,
    fontSize: 11,
    lineHeight: 15,
    flex: 1,
  },

  footer: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    borderTopColor: colors.borderSubtle,
    borderTopWidth: 1,
    backgroundColor: colors.background,
  },
});