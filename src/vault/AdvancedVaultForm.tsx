import { Feather } from "@expo/vector-icons";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import * as Crypto from "expo-crypto";
import React, { useEffect, useMemo, useState } from "react";
import {
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { colors, radii, spacing, typography } from "@/src/theme";
import { formatUsDate } from "@/src/utils/us-date";
import {
  ADVANCED_VAULT_KIND_META,
  getAdvancedNetworkName,
  type AdvancedVaultKind,
  type VestingInterval,
} from "@/src/wallet/advanced-vaults";
import {
  TokenPicker,
  isValidContractAddress,
  tokenSymbolForAddress,
} from "@/src/wallet/multi-asset-beta";

type AdvancedKind = Exclude<AdvancedVaultKind, "TimeLock">;

const KIND_ORDER: AdvancedKind[] = [
  "CoolingOff",
  "Vesting",
  "MultiAssetVesting",
  "DeadManSwitch",
  "MultiSig",
  "HTLC",
];

const KIND_DESCRIPTIONS: Record<AdvancedKind, string> = {
  CoolingOff:
    "Withdrawals need a heads-up first. Start a withdrawal, then wait out the Cooling-Off period — cancel any time if it wasn't you.",
  Vesting:
    "Funds unlock in discrete steps — daily, weekly, or monthly. Pick an interval, start date, and end date — then withdraw each chunk once it unlocks.",
  MultiAssetVesting:
    "A vesting schedule for non-XLM tokens. Pick any Stellar token (USDC, EURC, AQUA, and more), then funds unlock in discrete steps — daily, weekly, or monthly.",
  DeadManSwitch:
    "Check in periodically to prove you're active. Miss the deadline and your backup address can claim the funds.",
  MultiSig:
    "Withdrawals need confirmation from a second address (co-signer). Both parties must sign before funds are released.",
  HTLC:
    "Cross-chain atomic swaps using hash time-locked contracts. Lock XLM that only releases when a counterparty provides a secret passphrase before a deadline.",
};

function startOfTomorrow(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 1);
  return d;
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function formatVestingDate(d: Date): string {
  return formatUsDate(d, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function AdvancedVaultForm({
  kind,
  onKindChange,
  name,
  onNameChange,
  amount,
  onAmountChange,
  coolDays,
  onCoolDays,
  coolHours,
  onCoolHours,
  coolMinutes,
  onCoolMinutes,
  vestInterval,
  onVestInterval,
  vestStartMode,
  onVestStartMode,
  vestStartDate,
  onVestStartDate,
  vestEndDate,
  onVestEndDate,
  dmsBackupAddress,
  onDmsBackupAddress,
  dmsBackupLabel,
  onClearBackup,
  onOpenAddressBook,
  dmsPeriodDays,
  onDmsPeriodDays,
  dmsPeriodHours,
  onDmsPeriodHours,
  dmsPeriodMinutes,
  onDmsPeriodMinutes,
  multiSigCoSignerAddress,
  onMultiSigCoSignerAddress,
  multiSigCoSignerLabel,
  onClearCoSigner,
  onOpenMultiSigAddressBook,
  htlcHash,
  onHtlcHash,
  htlcSecret,
  onHtlcSecret,
  htlcRecipient,
  onHtlcRecipient,
  htlcTimelockDays,
  onHtlcTimelockDays,
  htlcTimelockHours,
  onHtlcTimelockHours,
  validationError,
  amountNotice,
  allowedKinds,
  comingSoonKinds,
  onComingSoonPress,
  maVestTokenAddress,
  onMaVestTokenAddress,
}: {
  kind: AdvancedKind;
  onKindChange: (k: AdvancedKind) => void;
  name: string;
  onNameChange: (v: string) => void;
  amount: string;
  onAmountChange: (v: string) => void;
  coolDays: number;
  onCoolDays: (v: number) => void;
  coolHours: number;
  onCoolHours: (v: number) => void;
  coolMinutes: number;
  onCoolMinutes: (v: number) => void;
  vestInterval: VestingInterval;
  onVestInterval: (v: VestingInterval) => void;
  vestStartMode: "now" | "future";
  onVestStartMode: (v: "now" | "future") => void;
  vestStartDate: Date;
  onVestStartDate: (v: Date) => void;
  vestEndDate: Date;
  onVestEndDate: (v: Date) => void;
  dmsBackupAddress: string;
  onDmsBackupAddress: (v: string) => void;
  dmsBackupLabel: string;
  onClearBackup: () => void;
  onOpenAddressBook: () => void;
  dmsPeriodDays: number;
  onDmsPeriodDays: (v: number) => void;
  dmsPeriodHours: number;
  onDmsPeriodHours: (v: number) => void;
  dmsPeriodMinutes: number;
  onDmsPeriodMinutes: (v: number) => void;
  multiSigCoSignerAddress: string;
  onMultiSigCoSignerAddress: (v: string) => void;
  multiSigCoSignerLabel: string;
  onClearCoSigner: () => void;
  onOpenMultiSigAddressBook: () => void;
  htlcHash: string;
  onHtlcHash: (v: string) => void;
  htlcSecret: string;
  onHtlcSecret: (v: string) => void;
  htlcRecipient: string;
  onHtlcRecipient: (v: string) => void;
  htlcTimelockDays: number;
  onHtlcTimelockDays: (v: number) => void;
  htlcTimelockHours: number;
  onHtlcTimelockHours: (v: number) => void;
  validationError: string | null;
  /** Plain-English floor for a new XLM lock. Null when the amount is fine. */
  amountNotice?: string | null;
  /** When set, only these advanced kinds are shown (tier gating). */
  allowedKinds?: readonly AdvancedKind[];
  comingSoonKinds?: readonly AdvancedKind[];
  onComingSoonPress?: (k: AdvancedKind) => void;
  /** Multi-Asset Vesting selected token (SAC address). */
  maVestTokenAddress?: string;
  onMaVestTokenAddress?: (v: string) => void;
}) {
  const isMainnet = getAdvancedNetworkName() === "mainnet";
  const soonSet = new Set(comingSoonKinds ?? []);
  const visibleKinds = (() => {
    const base = allowedKinds?.length
      ? KIND_ORDER.filter((k) => allowedKinds.includes(k) || soonSet.has(k))
      : KIND_ORDER.filter((k) => !ADVANCED_VAULT_KIND_META[k]?.comingSoon || soonSet.has(k));
    // Append coming-soon kinds that aren't already in the creatable list.
    for (const k of soonSet) {
      if (!base.includes(k)) base.push(k);
    }
    return KIND_ORDER.filter((k) => base.includes(k));
  })();
  const kindIsComingSoon =
    soonSet.has(kind) ||
    (kind !== "HTLC" && !!ADVANCED_VAULT_KIND_META[kind]?.comingSoon);
  /** Show the real create form for HTLC (now live on Mainnet). */
  const showCreateFields = !kindIsComingSoon;
  const [picker, setPicker] = useState<"start" | "end" | null>(null);
  const minStart = useMemo(() => startOfTomorrow(), []);
  const minEnd = useMemo(() => {
    const base = vestStartMode === "future" ? vestStartDate : new Date();
    return addDays(base, 1);
  }, [vestStartMode, vestStartDate]);

  // Derive on-chain SHA-256 hash from the secret passphrase (HTLC).
  useEffect(() => {
    let cancelled = false;
    const secret = htlcSecret.trim();
    if (!secret) {
      onHtlcHash("");
      return;
    }
    void (async () => {
      try {
        const hash = await Crypto.digestStringAsync(
          Crypto.CryptoDigestAlgorithm.SHA256,
          secret,
        );
        if (!cancelled) onHtlcHash(hash.toLowerCase());
      } catch {
        if (!cancelled) onHtlcHash("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [htlcSecret, onHtlcHash]);

  const onPickerChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === "android") setPicker(null);
    if (event.type === "dismissed" || !selected) {
      if (Platform.OS === "ios") setPicker(null);
      return;
    }
    if (picker === "start") {
      onVestStartDate(selected);
      if (selected.getTime() >= vestEndDate.getTime()) {
        onVestEndDate(addDays(selected, 30));
      }
    } else if (picker === "end") {
      onVestEndDate(selected);
    }
  };

  if (visibleKinds.length === 0) {
    return (
      <View testID="advanced-vault-form">
        <View style={styles.betaBanner}>
          <Feather name="lock" size={14} color={colors.warning} />
          <Text style={styles.betaBannerText}>
            Advanced vault types are not available on your current tier. Upgrade
            in Settings → Test Tier Selection to try Plus, Pro, or Elite.
          </Text>
        </View>
      </View>
    );
  }

  const maVestSymbol =
    kind === "MultiAssetVesting" && maVestTokenAddress
      ? tokenSymbolForAddress(maVestTokenAddress)
      : undefined;

  return (
    <View testID="advanced-vault-form">
      <View style={styles.betaBanner}>
        <Feather name="alert-circle" size={14} color={colors.warning} />
        <Text style={styles.betaBannerText}>
          {isMainnet
            ? "Beta — Cooling-Off, Vesting Schedule, Multi-Asset Vesting, Dead Man\u2019s Switch, and Multi-Sig are new vault types on Stellar Mainnet. They use real funds, so please double-check every field before submitting."
            : "Beta (Testnet) — Cooling-Off, Vesting Schedule, Multi-Asset Vesting, Dead Man\u2019s Switch, and Multi-Sig vaults currently run on Stellar Testnet while this feature is tested. No real funds are used."}
        </Text>
      </View>

      <Text style={styles.label}>VAULT TYPE</Text>
      <View style={styles.kindRow}>
        {visibleKinds.map((k) => {
          const meta = ADVANCED_VAULT_KIND_META[k];
          const soon = soonSet.has(k) || !!meta.comingSoon;
          const active = k === kind && !soon;
          return (
            <TouchableOpacity
              key={k}
              testID={`advanced-kind-${k}`}
              onPress={() => {
                if (soon) {
                  onKindChange(k);
                  onComingSoonPress?.(k);
                  return;
                }
                onKindChange(k);
              }}
              activeOpacity={0.85}
              style={[
                styles.kindCard,
                (active || (soon && k === kind)) && {
                  borderColor: meta.accent,
                  backgroundColor: meta.accent + "14",
                },
                soon && styles.kindCardSoon,
              ]}
            >
              <View
                style={[
                  styles.kindIconWrap,
                  { backgroundColor: meta.accent + "20" },
                  soon && { opacity: 0.55 },
                ]}
              >
                <Feather name={meta.icon} size={16} color={meta.accent} />
              </View>
              <Text
                style={[
                  styles.kindCardText,
                  active && { color: meta.accent },
                  soon && styles.kindCardTextSoon,
                ]}
                numberOfLines={2}
              >
                {meta.label}
              </Text>
              {soon ? (
                <View style={styles.soonBadge} testID={`advanced-kind-soon-${k}`}>
                  <Text style={styles.soonBadgeText}>Coming Soon</Text>
                </View>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={styles.hint}>{KIND_DESCRIPTIONS[kind]}</Text>

      {showCreateFields ? (
        <>
      <Text style={styles.label}>VAULT NAME</Text>
      <TextInput
        testID="advanced-vault-name"
        value={name}
        onChangeText={onNameChange}
        placeholder="e.g. Recovery Fund"
        placeholderTextColor={colors.textTertiary}
        style={styles.input}
        maxLength={64}
      />

      <Text style={styles.label}>
        {kind === "MultiAssetVesting"
          ? maVestSymbol
            ? `INITIAL DEPOSIT (${maVestSymbol})`
            : "INITIAL DEPOSIT (TOKEN)"
          : `INITIAL DEPOSIT (XLM${isMainnet ? "" : " \u00b7 TESTNET"})`}
      </Text>
      <TextInput
        testID="advanced-vault-amount"
        value={amount}
        onChangeText={onAmountChange}
        placeholder="100"
        placeholderTextColor={colors.textTertiary}
        keyboardType="decimal-pad"
        style={styles.input}
      />
      {amountNotice ? (
        <Text
          style={styles.lockMinimum}
          testID="advanced-vault-lock-minimum"
          accessibilityRole="alert"
        >
          {amountNotice}
        </Text>
      ) : null}

      {kind === "MultiAssetVesting" ? (
        <>
          <TokenPicker
            value={maVestTokenAddress ?? ""}
            onChange={onMaVestTokenAddress ?? (() => {})}
          />
          {maVestTokenAddress &&
          isValidContractAddress(maVestTokenAddress) &&
          tokenSymbolForAddress(maVestTokenAddress) !== "XLM" ? (
            <Text style={styles.hint}>
              Funds are held as {maVestSymbol ?? "this token"} and unlock in
              discrete vesting steps. Keep a small amount of XLM in your wallet
              to pay network fees.
            </Text>
          ) : null}
        </>
      ) : null}

      {kind === "CoolingOff" ? (
        <>
          <Text style={styles.label}>COOLING-OFF PERIOD</Text>
          <View style={styles.tripleRow}>
            <NumberField testID="advanced-cool-days" label="Days" value={coolDays} onChange={onCoolDays} />
            <NumberField testID="advanced-cool-hours" label="Hours" value={coolHours} onChange={onCoolHours} max={23} />
            <NumberField testID="advanced-cool-minutes" label="Minutes" value={coolMinutes} onChange={onCoolMinutes} max={59} />
          </View>
          <Text style={styles.hint}>
            After a withdrawal is started, funds unlock only once this much
            time has passed — giving you a window to cancel if it wasn't you.
          </Text>
        </>
      ) : null}

      {kind === "Vesting" || kind === "MultiAssetVesting" ? (
        <>
          <Text style={styles.label}>UNLOCK INTERVAL</Text>
          <View style={styles.intervalRow}>
            {(["daily", "weekly", "monthly"] as VestingInterval[]).map((iv) => {
              const active = vestInterval === iv;
              return (
                <TouchableOpacity
                  key={iv}
                  testID={`advanced-vest-interval-${iv}`}
                  onPress={() => onVestInterval(iv)}
                  activeOpacity={0.85}
                  style={[styles.intervalChip, active && styles.intervalChipActive]}
                >
                  <Text style={[styles.intervalChipText, active && styles.intervalChipTextActive]}>
                    {iv.charAt(0).toUpperCase() + iv.slice(1)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.hint}>
            Funds unlock once per interval. E.g. 30 units over 30 days with
            &ldquo;Daily&rdquo; = 1 unit unlocks every 24 hours.
          </Text>

          <Text style={styles.label}>VESTING START</Text>
          <View style={styles.intervalRow}>
            <TouchableOpacity
              testID="advanced-vest-start-now"
              onPress={() => onVestStartMode("now")}
              activeOpacity={0.85}
              style={[styles.intervalChip, vestStartMode === "now" && styles.intervalChipActive]}
            >
              <Text style={[styles.intervalChipText, vestStartMode === "now" && styles.intervalChipTextActive]}>
                Start Immediately
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="advanced-vest-start-future"
              onPress={() => onVestStartMode("future")}
              activeOpacity={0.85}
              style={[styles.intervalChip, vestStartMode === "future" && styles.intervalChipActive]}
            >
              <Text style={[styles.intervalChipText, vestStartMode === "future" && styles.intervalChipTextActive]}>
                Start at Future Date
              </Text>
            </TouchableOpacity>
          </View>
          {vestStartMode === "future" ? (
            <>
              <TouchableOpacity
                testID="advanced-vest-start-date"
                onPress={() => setPicker("start")}
                activeOpacity={0.85}
                style={styles.datePickerBtn}
                accessibilityRole="button"
                accessibilityLabel="Choose vesting start date"
              >
                <Feather name="calendar" size={16} color={colors.teal} />
                <Text style={styles.datePickerText}>{formatVestingDate(vestStartDate)}</Text>
                <Feather name="chevron-down" size={16} color={colors.textSecondary} />
              </TouchableOpacity>
              <Text style={styles.hint}>
                Funds stay fully locked until this date, then begin unlocking at
                the chosen interval.
              </Text>
            </>
          ) : (
            <Text style={styles.hint}>
              Vesting begins the moment the transaction is confirmed on-chain.
            </Text>
          )}

          <Text style={styles.label}>VESTING END</Text>
          <TouchableOpacity
            testID="advanced-vest-end-date"
            onPress={() => setPicker("end")}
            activeOpacity={0.85}
            style={styles.datePickerBtn}
            accessibilityRole="button"
            accessibilityLabel="Choose vesting end date"
          >
            <Feather name="calendar" size={16} color={colors.teal} />
            <Text style={styles.datePickerText}>{formatVestingDate(vestEndDate)}</Text>
            <Feather name="chevron-down" size={16} color={colors.textSecondary} />
          </TouchableOpacity>
          <Text style={styles.hint}>
            Last unlock date. Must be after the start date by at least one interval.
          </Text>

          {picker ? (
            <DateTimePicker
              value={picker === "start" ? vestStartDate : vestEndDate}
              mode="date"
              display={
                Platform.OS === "ios"
                  ? "inline"
                  : Platform.OS === "android"
                    ? "calendar"
                    : "default"
              }
              minimumDate={picker === "start" ? minStart : minEnd}
              onChange={onPickerChange}
              testID={`advanced-vest-${picker}-picker`}
            />
          ) : null}
          {Platform.OS === "ios" && picker ? (
            <TouchableOpacity
              onPress={() => setPicker(null)}
              style={styles.datePickerDone}
              testID="advanced-vest-picker-done"
            >
              <Text style={styles.datePickerDoneText}>Done</Text>
            </TouchableOpacity>
          ) : null}
        </>
      ) : null}

      {kind === "DeadManSwitch" ? (
        <>
          <Text style={styles.label}>BACKUP ADDRESS</Text>
          {dmsBackupLabel ? (
            <View style={styles.pickedContactCard} testID="advanced-dms-picked-contact">
              <Feather name="user-check" size={16} color={colors.teal} />
              <View style={{ flex: 1 }}>
                <Text style={styles.pickedContactLabel} numberOfLines={1}>
                  {dmsBackupLabel}
                </Text>
                <Text style={styles.pickedContactAddr} numberOfLines={1}>
                  {dmsBackupAddress}
                </Text>
              </View>
              <TouchableOpacity
                onPress={onClearBackup}
                testID="advanced-dms-clear-contact"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Feather name="x" size={16} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <TouchableOpacity
                onPress={onOpenAddressBook}
                style={styles.addressBookBtn}
                testID="advanced-dms-open-address-book"
                activeOpacity={0.85}
              >
                <Feather name="users" size={16} color={colors.teal} />
                <Text style={styles.addressBookBtnText}>Choose from Address Book</Text>
                <Feather name="chevron-right" size={16} color={colors.teal} />
              </TouchableOpacity>
              <Text style={styles.orDivider}>— or type below —</Text>
              <TextInput
                testID="advanced-dms-backup-address"
                value={dmsBackupAddress}
                onChangeText={onDmsBackupAddress}
                placeholder="Stellar address (G…, 56 chars)"
                placeholderTextColor={colors.textTertiary}
                autoCapitalize="characters"
                autoCorrect={false}
                style={[styles.input, styles.mono]}
                maxLength={56}
              />
            </>
          )}
          <Text style={styles.hint}>
            This address can claim the vault's funds ONLY if you miss your
            check-in deadline. It can never be changed after creation.
          </Text>

          <Text style={styles.label}>CHECK-IN PERIOD</Text>
          <View style={styles.tripleRow}>
            <NumberField testID="advanced-dms-period-days" label="Days" value={dmsPeriodDays} onChange={onDmsPeriodDays} max={3650} />
            <NumberField testID="advanced-dms-period-hours" label="Hours" value={dmsPeriodHours} onChange={onDmsPeriodHours} max={23} />
            <NumberField testID="advanced-dms-period-minutes" label="Minutes" value={dmsPeriodMinutes} onChange={onDmsPeriodMinutes} max={59} />
          </View>
          <Text style={styles.hint}>
            You must tap &ldquo;Ping&rdquo; at least this often to prove you're
            active. Every ping resets the countdown.
          </Text>
        </>
      ) : null}

      {kind === "MultiSig" ? (
        <>
          <Text style={styles.label}>CO-SIGNER ADDRESS</Text>
          {multiSigCoSignerLabel ? (
            <View style={styles.pickedContactCard} testID="advanced-multisig-picked-contact">
              <Feather name="user-check" size={16} color={colors.teal} />
              <View style={{ flex: 1 }}>
                <Text style={styles.pickedContactLabel} numberOfLines={1}>
                  {multiSigCoSignerLabel}
                </Text>
                <Text style={styles.pickedContactAddr} numberOfLines={1}>
                  {multiSigCoSignerAddress}
                </Text>
              </View>
              <TouchableOpacity
                onPress={onClearCoSigner}
                testID="advanced-multisig-clear-contact"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Feather name="x" size={16} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <TouchableOpacity
                onPress={onOpenMultiSigAddressBook}
                style={styles.addressBookBtn}
                testID="advanced-multisig-open-address-book"
                activeOpacity={0.85}
              >
                <Feather name="users" size={16} color={colors.teal} />
                <Text style={styles.addressBookBtnText}>Choose from Address Book</Text>
                <Feather name="chevron-right" size={16} color={colors.teal} />
              </TouchableOpacity>
              <Text style={styles.orDivider}>— or type below —</Text>
              <TextInput
                testID="advanced-multisig-co-signer-address"
                value={multiSigCoSignerAddress}
                onChangeText={onMultiSigCoSignerAddress}
                placeholder="Stellar address (G…, 56 chars)"
                placeholderTextColor={colors.textTertiary}
                autoCapitalize="characters"
                autoCorrect={false}
                style={[styles.input, styles.mono]}
                maxLength={56}
              />
            </>
          )}
          <Text style={styles.hint}>
            This address must co-sign any withdrawal. Both parties must sign
            before funds are released. The co-signer cannot be changed after creation.
          </Text>
        </>
      ) : null}

      {kind === "HTLC" ? (
        <>
          <Text style={styles.label}>COUNTERPARTY (RECIPIENT)</Text>
          <TextInput
            testID="advanced-htlc-recipient"
            value={htlcRecipient}
            onChangeText={onHtlcRecipient}
            placeholder="Stellar address (G…, 56 chars)"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="characters"
            autoCorrect={false}
            style={[styles.input, styles.mono]}
            maxLength={56}
          />
          <Text style={styles.hint}>
            This address can claim the locked XLM by providing the secret
            preimage before the timelock expires.
          </Text>

          <Text style={styles.label}>SECRET PASSPHRASE</Text>
          <TextInput
            testID="advanced-htlc-secret"
            value={htlcSecret}
            onChangeText={onHtlcSecret}
            placeholder="Create a secret only you and the recipient know"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
          <Text style={styles.hint}>
            Share this secret with the recipient. They'll need it to claim the
            funds.
          </Text>

          <Text style={styles.label}>HASH (STORED ON-CHAIN)</Text>
          <View
            testID="advanced-htlc-hash"
            style={[styles.input, styles.hashReadOnly]}
          >
            <Text
              style={[styles.mono, styles.hashReadOnlyText]}
              selectable
            >
              {htlcHash || "Generated from your secret…"}
            </Text>
          </View>
          <Text style={styles.hint}>
            The hash is what gets stored on-chain; the secret stays between
            sender and recipient.
          </Text>

          <Text style={styles.label}>TIMELOCK</Text>
          <View style={styles.tripleRow}>
            <NumberField
              testID="advanced-htlc-timelock-days"
              label="Days"
              value={htlcTimelockDays}
              onChange={onHtlcTimelockDays}
              max={3650}
            />
            <NumberField
              testID="advanced-htlc-timelock-hours"
              label="Hours"
              value={htlcTimelockHours}
              onChange={onHtlcTimelockHours}
              max={23}
            />
          </View>
          <Text style={styles.hint}>
            After this deadline the sender can refund. Before it, only a valid
            preimage claim succeeds.
          </Text>
        </>
      ) : null}

      <View style={styles.creationCostBox} testID="advanced-vault-est-cost">
        <Feather name="zap" size={14} color={colors.gold} />
        <View style={{ flex: 1 }}>
          <Text style={styles.creationCostLabel}>Estimated creation cost</Text>
          <Text style={styles.creationCostValue}>~0.01 XLM</Text>
          <Text style={styles.creationCostHint}>
            Soroban contract fee paid to Stellar validators. Exact amount is set at submission.
          </Text>
        </View>
      </View>

      {validationError ? <Text style={styles.warn}>{validationError}</Text> : null}
        </>
      ) : null}
    </View>
  );
}

function NumberField({
  label,
  value,
  onChange,
  max = 999,
  testID,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  max?: number;
  testID: string;
}) {
  const [text, setText] = useState(String(value));

  useEffect(() => {
    setText(String(value));
  }, [value]);

  return (
    <View style={styles.numberField}>
      <Text style={styles.numberFieldLabel}>{label}</Text>
      <View style={styles.numberStepRow}>
        <TouchableOpacity
          onPress={() => onChange(Math.max(0, value - 1))}
          style={styles.stepBtn}
          hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
        >
          <Feather name="minus" size={14} color={colors.text} />
        </TouchableOpacity>
        <TextInput
          testID={testID}
          value={text}
          onChangeText={(t) => {
            const digits = t.replace(/[^0-9]/g, "");
            setText(digits);
            if (digits !== "") {
              onChange(Math.min(max, Math.max(0, parseInt(digits, 10))));
            }
          }}
          onBlur={() => {
            if (text === "") {
              setText("0");
              onChange(0);
            }
          }}
          keyboardType="number-pad"
          style={styles.numberInput}
        />
        <TouchableOpacity
          onPress={() => onChange(Math.min(max, value + 1))}
          style={styles.stepBtn}
          hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
        >
          <Feather name="plus" size={14} color={colors.text} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  betaBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.warning + "60",
    backgroundColor: colors.warning + "14",
    marginBottom: spacing.sm,
  },
  betaBannerText: { flex: 1, color: colors.text, fontSize: 12, lineHeight: 17 },
  label: {
    color: colors.textTertiary,
    fontSize: 10,
    ...typography.label,
    marginTop: spacing.md,
    marginBottom: 6,
  },
  hint: { color: colors.textTertiary, fontSize: 11, marginTop: 6, marginLeft: 4, lineHeight: 15 },
  input: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    color: colors.text,
    fontSize: 15,
  },
  mono: { ...typography.mono, fontSize: 13 },
  hashReadOnly: {
    backgroundColor: colors.surface,
    opacity: 0.95,
    minHeight: 48,
    justifyContent: "center",
  },
  hashReadOnlyText: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
  },
  kindRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  kindCard: {
    width: "47%",
    flexGrow: 1,
    alignItems: "center",
    gap: 6,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: 6,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  kindIconWrap: {
    width: 30,
    height: 30,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  kindCardText: { color: colors.text, fontSize: 11, fontWeight: "700", textAlign: "center" },
  kindCardSoon: { opacity: 0.72 },
  kindCardTextSoon: { color: colors.textSecondary },
  soonBadge: {
    marginTop: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.gold + "66",
    backgroundColor: colors.gold + "18",
  },
  soonBadgeText: {
    color: colors.gold,
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  intervalRow: { flexDirection: "row", gap: 8, marginBottom: 4 },
  intervalChip: {
    flex: 1,
    alignItems: "center" as const,
    paddingVertical: 10,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  intervalChipActive: { backgroundColor: colors.cyanMuted, borderColor: colors.cyan },
  intervalChipText: { color: colors.text, fontSize: 12, fontWeight: "600" as const },
  intervalChipTextActive: { color: colors.cyan, fontWeight: "800" as const },
  datePickerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  datePickerText: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    fontWeight: "600",
  },
  datePickerDone: {
    alignSelf: "flex-end",
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginTop: 4,
  },
  datePickerDoneText: {
    color: colors.cyan,
    fontSize: 14,
    fontWeight: "700",
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
  tripleRow: { flexDirection: "row", gap: 10 },
  numberField: { flex: 1, minWidth: 0 },
  numberFieldLabel: { color: colors.textSecondary, fontSize: 11, marginBottom: 4 },
  numberStepRow: { flexDirection: "row", alignItems: "center", gap: 6 },
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
  numberInput: {
    flex: 1,
    minWidth: 0,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 8,
    textAlign: "center",
    color: colors.text,
    fontSize: 14,
    ...typography.mono,
  },
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
  addressBookBtnText: { flex: 1, color: colors.teal, fontSize: 14, fontWeight: "700" },
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
  pickedContactLabel: { color: colors.text, fontSize: 14, fontWeight: "700" },
  pickedContactAddr: { color: colors.textSecondary, fontSize: 12, marginTop: 2, ...typography.mono },
  warn: { color: colors.danger, fontSize: 12, marginTop: spacing.md, marginLeft: 4 },
  lockMinimum: {
    color: colors.danger,
    fontSize: 20,
    lineHeight: 26,
    marginTop: 8,
    marginBottom: 4,
  },
});