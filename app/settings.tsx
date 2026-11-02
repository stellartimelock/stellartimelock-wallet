import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { APP_VERSION, BUILD_NUMBER } from "@/constants/app-version";
import { Button } from "@/src/components/Button";
import { Card } from "@/src/components/Card";
import { SettingsMatrixRain } from "@/src/components/SettingsMatrixRain";
import {
  SettingsGroup,
  SettingsRow,
  SettingsSwitchRow,
} from "@/src/components/settings-rows";
import { SampleDataSections } from "@/src/demo/SampleDataSections";
import { useDemoMode } from "@/src/demo/use-demo-mode";
import { checkForUpdate } from "@/src/updates/check";
import { SettingsUpdateSlot } from "@/src/updates/UpdateAvailableCard";
import { Checkbox } from "@/src/components/Checkbox";
import { useToast } from "@/src/components/Toast";
import { useTabReturn } from "@/src/navigation/useTabReturn";
import { BiometricGate } from "@/src/security/BiometricGate";
import { copySecretToClipboard } from "@/src/security/clipboard-secret";
import { Currency, useSession } from "@/src/state/session";
import { colors, radii, spacing, tileShadow, typography } from "@/src/theme";
import {
  revealSecretPhrase,
  revealSecretSeed,
  shortenAddress,
} from "@/src/wallet/stellar";
import {
  listEntries,
  removeEntry,
  type AddressBookEntry,
} from "@/src/wallet/address-book";
import { SecuritySection } from "@/src/security/SecuritySection";
import { CloudSyncIcon } from "@/src/components/CloudSyncIcon";
import { WalletManagerCard } from "@/src/wallet/WalletManagerCard";
import { TapPaySettings } from "@/src/tap-pay/TapPaySettings";
import { ManualBackupCard } from "@/src/utils/manual-backup/ManualBackupCard";
import {
  getCurrentTier,
  hydrateTier,
  setTestTier,
  TIER_CONFIGS,
  TIER_ORDER,
  isDevEliteWallet,
  type TierId,
} from "@/src/tiers/tier-config";

const CURRENCIES: { key: Currency; label: string; desc: string }[] = [
  { key: "USD", label: "USD", desc: "United States Dollar" },
  { key: "EUR", label: "EUR", desc: "Euro" },
  { key: "XLM", label: "XLM", desc: "Native Stellar Lumens only" },
];

export default function Settings() {
  useTabReturn();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { wallet, disconnect, currency, setCurrency, network, ratesUpdatedAt, rates } = useSession();
  void ratesUpdatedAt;
  const demo = useDemoMode();
  const [checkingForUpdate, setCheckingForUpdate] = useState(false);
  const [updateNote, setUpdateNote] = useState<string | undefined>(undefined);
  const [matrixVisible, setMatrixVisible] = useState(false);
  const [spoonVisible, setSpoonVisible] = useState(false);
  const versionTapsRef = useRef<number[]>([]);

  useEffect(() => {
    void checkForUpdate();
  }, []);

  const handleCheckForUpdates = useCallback(async () => {
    setCheckingForUpdate(true);
    const result = await checkForUpdate({ force: true });
    setCheckingForUpdate(false);
    if (result.phase === "current") {
      setUpdateNote("You're on the latest version.");
    } else if (result.phase === "error") {
      setUpdateNote(result.message);
    } else {
      setUpdateNote(undefined);
    }
  }, []);

  const handleVersionTap = useCallback(() => {
    const now = Date.now();
    versionTapsRef.current = [
      ...versionTapsRef.current.filter((t) => now - t < 3500),
      now,
    ];
    if (versionTapsRef.current.length >= 7) {
      versionTapsRef.current = [];
      setMatrixVisible(true);
      setSpoonVisible(true);
    }
  }, []);

  const showDevTierSwitcher = isDevEliteWallet(wallet?.publicKey);

  const [currentTier, setCurrentTier] = useState<TierId>(
    getCurrentTier(wallet?.publicKey),
  );

  useEffect(() => {
    void hydrateTier(wallet?.publicKey).then(setCurrentTier);
  }, [wallet?.publicKey]);

  const onSelectTestTier = useCallback(
    async (tier: TierId) => {
      await setTestTier(tier);
      setCurrentTier(tier);
      toast.show(`Test tier set to ${TIER_CONFIGS[tier].label}`, "success");
    },
    [toast],
  );

  const params = useLocalSearchParams<{
    scrollTo?: string;
    expand?: string;
  }>();
  const scrollRef = useRef<ScrollView>(null);
  const backupSectionRef = useRef<View>(null);
  const backupSectionYRef = useRef<number | null>(null);
  const [backupMeasured, setBackupMeasured] = useState(false);
  const [walletExpanded, setWalletExpanded] = useState<boolean>(
    params.expand === "wallet",
  );
  const [contactsExpanded, setContactsExpanded] = useState<boolean>(
    params.expand === "contacts",
  );
  const [backupExpanded, setBackupExpanded] = useState<boolean>(
    params.scrollTo === "backup",
  );
  const [keyStorageExpanded, setKeyStorageExpanded] = useState(false);
  const [advancedExpanded, setAdvancedExpanded] = useState(false);
  useEffect(() => {
    if (params.expand === "wallet") setWalletExpanded(true);
    if (params.expand === "contacts") setContactsExpanded(true);
  }, [params.expand]);
  useEffect(() => {
    if (params.scrollTo === "backup") setBackupExpanded(true);
  }, [params.scrollTo]);
  void walletExpanded;
  void setWalletExpanded;
  useEffect(() => {
    if (params.scrollTo !== "backup") return;
    const rawY = backupSectionYRef.current;
    if (rawY == null) return;
    if (!backupMeasured) return;
    const t = setTimeout(() => {
      scrollRef.current?.scrollTo({
        y: Math.max(0, rawY - 12),
        animated: true,
      });
    }, 220);
    return () => clearTimeout(t);
  }, [params.scrollTo, backupMeasured]);

  const [revealOpen, setRevealOpen] = useState(false);
  const [revealKind, setRevealKind] = useState<"seed" | "phrase">("seed");
  const [secret, setSecret] = useState<string | null>(null);
  const [secretLoading, setSecretLoading] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [seedExported, setSeedExported] = useState(false);
  const [currencyPickerOpen, setCurrencyPickerOpen] = useState(false);

  const _copyAddress = async () => {
    if (!wallet) return;
    await Clipboard.setStringAsync(wallet.publicKey);
    toast.show("Address copied", "success");
  };
  void _copyAddress;

  const openReveal = async (kind: "seed" | "phrase" = "seed") => {
    if (demo.enabled) return;
    setRevealKind(kind);
    setRevealOpen(true);
    setSecretLoading(true);
    const s =
      kind === "phrase" ? await revealSecretPhrase() : await revealSecretSeed();
    setSecret(s);
    setSecretLoading(false);
  };

  const closeReveal = () => {
    setRevealOpen(false);
    setSecret(null);
  };

  const copySecret = async () => {
    if (!secret) return;
    await copySecretToClipboard(secret);
    setSeedExported(true);
    toast.show(
      revealKind === "phrase"
        ? "Recovery phrase copied — store it offline"
        : "Secret copied — store it offline",
      "info",
    );
  };

  const handleDisconnect = async () => {
    await disconnect();
    setDisconnectOpen(false);
    router.replace("/");
  };

  const openDisconnect = () => {
    setAcknowledged(false);
    setDisconnectOpen(true);
  };

  return (
    <BiometricGate surface="settings">
    <SafeAreaView edges={["top"]} style={styles.root} testID="settings-screen">
      <View style={styles.headerBar}>
        <TouchableOpacity
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/wallet"))}
          style={styles.headerBack}
          testID="settings-back-button"
          hitSlop={12}
          accessibilityLabel="Back"
        >
          <Feather name="arrow-left" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>Settings</Text>
        <View style={{ width: 32 }} />
      </View>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[
          styles.body,
          spoonVisible ? { paddingBottom: spacing.xxl + 88 } : null,
        ]}
        showsVerticalScrollIndicator={false}
      >
        <SettingsUpdateSlot />
        {demo.enabled ? (
          <View style={styles.demoBanner} testID="settings-demo-banner">
            <Text style={styles.demoBannerTitle}>Demo mode</Text>
            <Text style={styles.demoBannerBody}>
              Sample vaults, activity, and contacts are listed below. Your real wallet data on this device is not rewritten, and Export Secret Seed stays hidden.
            </Text>
          </View>
        ) : null}
        {demo.error ? (
          <View style={styles.demoBanner} testID="settings-demo-error">
            <Text style={styles.demoBannerBody}>{demo.error}</Text>
          </View>
        ) : null}

        <Text style={styles.sub}>Currency, wallet, and the things that matter.</Text>

        <Text style={styles.section}>SECURITY</Text>
        <SecuritySection showHeading={false} />

        <View
          ref={backupSectionRef}
          collapsable={false}
          onLayout={(e) => {
            backupSectionYRef.current = e.nativeEvent.layout.y;
            setBackupMeasured(true);
          }}
          testID="settings-backup-section"
        >
          <Text style={styles.section}>BACKUP & RECOVERY</Text>
          <Card padded status="locked">
          <TouchableOpacity
            onPress={() => setBackupExpanded((v) => !v)}
            activeOpacity={0.75}
            style={styles.walletContactsHeader}
            testID="settings-backup-header"
            accessibilityRole="button"
            accessibilityState={{ expanded: backupExpanded }}
            accessibilityLabel={
              backupExpanded
                ? "Collapse Backup & Recovery"
                : "Expand Backup & Recovery"
            }
          >
            <View style={styles.walletContactsHeaderIcon}>
              <CloudSyncIcon size={34} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.walletContactsNickname} numberOfLines={1}>
                Backup & Recovery
              </Text>
              <Text style={styles.walletContactsSub} numberOfLines={2}>
                {backupExpanded
                  ? "manual export · offline seed"
                  : "Tap to manage backups"}
              </Text>
            </View>
            <View style={styles.walletContactsChevronBtn}>
              <Feather
                name={backupExpanded ? "chevron-up" : "chevron-down"}
                size={20}
                color={colors.textSecondary}
              />
            </View>
          </TouchableOpacity>

          {backupExpanded ? (
            <View
              style={styles.contactsBody}
              testID="settings-backup-expanded"
            >
              <View style={styles.row}>
                <Feather name="shield" size={16} color={colors.teal} />
                <Text style={styles.securityText}>
                  Your secret seed never leaves this device. We only
                  ever see your public address.
                </Text>
              </View>
              <View style={[styles.row, { marginTop: spacing.sm }]}>
                <Feather name="lock" size={16} color={colors.teal} />
                <Text style={styles.securityText}>
                  Vault unlock timestamps are immutable. No admin
                  override exists.
                </Text>
              </View>

              {/* Local backup card (export/import .stvault) */}
              <View style={{ height: spacing.md }} />
              <Text style={styles.subSectionLabel}>LOCAL BACKUP</Text>
              <ManualBackupCard />

              {/* Export secret seed / phrase — hidden while demo mode is on. */}
              {demo.ready && !demo.enabled ? (
                <>
              <View style={{ height: spacing.md }} />
              <Text style={styles.subSectionLabel}>OFFLINE SECRET BACKUP</Text>
              <Card padded>
                <Text style={styles.exportSeedBody}>
                  Write down or copy your secret seed or recovery phrase to
                  a secure offline location (paper wallet,
                  hardware-vault). Anyone with either can spend
                  from your wallet.
                </Text>
                <View style={{ height: spacing.md }} />
                <Button
                  testID="settings-reveal-secret"
                  label="Export secret seed"
                  icon="eye"
                  variant="secondary"
                  onPress={() => openReveal("seed")}
                />
                <View style={{ height: spacing.sm }} />
                <Button
                  testID="settings-reveal-phrase"
                  label="Export secret phrase"
                  icon="list"
                  variant="secondary"
                  onPress={() => openReveal("phrase")}
                />
              </Card>
                </>
              ) : demo.enabled ? (
                <Text style={styles.exportSeedBody} testID="settings-export-seed-hidden">
                  Export Secret Seed is hidden while demo mode is on. Your real seed stays on this device, unread.
                </Text>
              ) : null}
            </View>
          ) : null}
        </Card>
        </View>

        <View style={styles.sectionSpacer} />


        {demo.ready && !demo.enabled ? (
        <KeyStorageSection
          expanded={keyStorageExpanded}
          onToggle={() => setKeyStorageExpanded((v) => !v)}
          publicKey={wallet?.publicKey ?? null}
          onCopied={() => setSeedExported(true)}
        />
        ) : null}

        <TouchableOpacity
          onPress={() => router.push("/key-manager")}
          activeOpacity={0.75}
          style={styles.auditRow}
          testID="settings-key-manager"
          accessibilityRole="button"
          accessibilityLabel="Key Manager"
        >
          <View style={styles.auditIcon}>
            <Feather name="key" size={16} color={colors.cyan} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.auditTitle}>Key Manager</Text>
            <Text style={styles.auditSub}>
              Store keys for any chain — Stellar, SOL, BTC, ETH, and more
            </Text>
          </View>
          <Feather name="chevron-right" size={18} color={colors.textSecondary} />
        </TouchableOpacity>

        <Text style={styles.section}>NETWORK</Text>
        <SettingsGroup>
          <SettingsRow
            icon="terminal"
            label="Diagnostics"
            onPress={() => router.push("/diagnostics")}
            chevron
            last={!advancedExpanded}
            testID="settings-open-diagnostics"
          />
          <TouchableOpacity
            onPress={() => setAdvancedExpanded((v) => !v)}
            activeOpacity={0.75}
            style={[styles.advancedHeader, advancedExpanded ? styles.advancedHeaderExpanded : null]}
            testID="settings-advanced-toggle"
            accessibilityRole="button"
            accessibilityState={{ expanded: advancedExpanded }}
            accessibilityLabel={advancedExpanded ? "Collapse Advanced settings" : "Expand Advanced settings"}
          >
            <View style={styles.advancedHeaderIcon}>
              <Feather name="sliders" size={18} color={colors.textTertiary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.advancedHeaderText}>Advanced</Text>
            </View>
            <Feather
              name={advancedExpanded ? "chevron-up" : "chevron-down"}
              size={16}
              color={colors.textTertiary}
            />
          </TouchableOpacity>
          {advancedExpanded ? (
            <SettingsRow
              icon="radio"
              label="Soroban RPC URL"
              sublabel="Override the default Soroban RPC endpoint"
              onPress={() => router.push("/advanced-settings")}
              chevron
              last
              testID="settings-open-advanced-settings"
            />
          ) : null}
        </SettingsGroup>

        <TapPaySettings />

        <Text style={styles.section}>DATA</Text>
        <SettingsGroup>
          <SettingsSwitchRow
            icon="eye"
            label="Demo mode"
            sublabel={
              demo.enabled
                ? "Sample data is on screen. Turn this off to bring your wallet back."
                : "Show sample vaults and activity. Real data stays where it is."
            }
            value={demo.enabled}
            onValueChange={(next) => {
              void demo.setDemo(next);
            }}
            disabled={!demo.ready}
            last
            testID="settings-demo-mode"
          />
        </SettingsGroup>

        <Text style={styles.section}>WALLET</Text>
        {!demo.ready ? null : demo.enabled ? (
          demo.visible ? <SampleDataSections data={demo.visible} /> : null
        ) : (
        <WalletAndContactsSection
          expanded={walletExpanded || contactsExpanded}
          onToggle={() => {
            const next = !(walletExpanded || contactsExpanded);
            setWalletExpanded(next);
            setContactsExpanded(next);
          }}
        showHeading={false}
        />

        )}
        {demo.ready && !demo.enabled && wallet?.publicKey ? (
          <View style={{ marginTop: spacing.sm }}>
            <SettingsGroup>
              <SettingsRow
                icon="external-link"
                label="View on Stellar Expert"
                onPress={() => {
                  const slug = network === "mainnet" ? "public" : "testnet";
                  void Linking.openURL(
                    `https://stellar.expert/explorer/${slug}/account/${wallet.publicKey}`,
                  );
                }}
                chevron
                last
                testID="settings-stellar-expert"
              />
            </SettingsGroup>
          </View>
        ) : null}

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.section}>DISPLAY CURRENCY</Text>
        </View>

        <TouchableOpacity
          onPress={() => setCurrencyPickerOpen(true)}
          activeOpacity={0.75}
          style={styles.currencyCompact}
          testID="settings-currency-open"
          accessibilityRole="button"
          accessibilityLabel={`Display currency ${currency}. Tap to change.`}
        >
          <View style={styles.currencyCompactIcon}>
            <Feather name="dollar-sign" size={16} color={colors.cyan} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={styles.currencyCompactTitleRow}>
              <Text style={styles.currencyCompactTitle}>Display currency</Text>
              <View style={styles.currencyCompactValueChip}>
                <Text style={styles.currencyCompactValueText}>{currency}</Text>
                <Feather
                  name="chevron-down"
                  size={12}
                  color={colors.textSecondary}
                />
              </View>
            </View>
            <Text
              style={styles.currencyCompactMeta}
              numberOfLines={1}
              testID="settings-rate-inline"
            >
              {currency === "XLM"
                ? "Native lumens · no conversion"
                : rates && rates[currency]
                  ? `1 XLM = ${rates[currency].toFixed(4)} ${currency}`
                  : "Fetching rate…"}
              {ratesUpdatedAt && currency !== "XLM"
                ? `  ·  ${new Date(ratesUpdatedAt).toLocaleTimeString(
                    undefined,
                    { hour: "2-digit", minute: "2-digit" },
                  )}`
                : ""}
            </Text>
          </View>
        </TouchableOpacity>

        <Text style={styles.section}>APPEARANCE</Text>
        <Card padded>
          <View style={styles.appearanceRow}>
            <View style={styles.appearIcon}>
              <Feather name="moon" size={16} color={colors.cyan} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.currencyLabel}>Dark mode</Text>
              <Text style={styles.currencyDesc}>
                Always on. This finance UI is designed exclusively for dark.
              </Text>
            </View>
            <Text style={[styles.statusOn]}>ON</Text>
          </View>
        </Card>

        {showDevTierSwitcher ? (
          <>
            <Text style={styles.section}>TEST TIER SELECTION</Text>
            <Card padded testID="settings-test-tier-section">
              <Text style={styles.testTierWarning}>
                Dev wallet only — overrides subscription gating for local QA.
              </Text>
              <Text style={styles.testTierCurrent}>
                Current: {TIER_CONFIGS[currentTier].label}
                {TIER_CONFIGS[currentTier].vaultLimit != null
                  ? ` · ${TIER_CONFIGS[currentTier].vaultLimit} vaults`
                  : " · unlimited vaults"}
                {TIER_CONFIGS[currentTier].monthlyDepositLimitUsd != null
                  ? ` · $${TIER_CONFIGS[currentTier].monthlyDepositLimitUsd.toLocaleString()}/mo`
                  : " · no deposit limit"}
              </Text>
              <View style={styles.testTierRow}>
                {TIER_ORDER.map((tier) => {
                  const active = currentTier === tier;
                  const cfg = TIER_CONFIGS[tier];
                  return (
                    <TouchableOpacity
                      key={tier}
                      onPress={() => void onSelectTestTier(tier)}
                      style={[styles.testTierChip, active && styles.testTierChipOn]}
                      testID={`settings-test-tier-${tier}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={`Test tier ${cfg.label}`}
                    >
                      <Text
                        style={[
                          styles.testTierChipText,
                          active && styles.testTierChipTextOn,
                        ]}
                      >
                        {cfg.label}
                      </Text>
                      <Text
                        style={[
                          styles.testTierChipPrice,
                          active && styles.testTierChipTextOn,
                        ]}
                      >
                        {cfg.priceLabel}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </Card>
          </>
        ) : null}


        <Text style={styles.section}>ABOUT</Text>
        <SettingsGroup>
          <SettingsRow
            icon="file-text"
            label="Privacy Policy"
            onPress={() => router.push("/legal/privacy")}
            chevron
            testID="settings-legal-privacy"
          />
          <SettingsRow
            icon="clipboard"
            label="Terms of Service"
            onPress={() => router.push("/legal/terms")}
            chevron
            testID="settings-legal-terms"
          />
          <SettingsRow
            icon="info"
            label="Legal & Disclosures"
            onPress={() => router.push("/legal/disclosures")}
            chevron
            testID="settings-legal-disclosures"
          />
          <SettingsRow
            icon="code"
            label="View Source Code"
            sublabel="Wallet crypto, keystore, and on-chain code excerpts"
            onPress={() => router.push("/security-code")}
            chevron
            testID="settings-security-code-audit"
          />
          <SettingsRow
            icon="download"
            label="Check for updates"
            sublabel={
              checkingForUpdate
                ? "Checking…"
                : updateNote ?? "Look for a newer Android build"
            }
            onPress={() => {
              if (!checkingForUpdate) void handleCheckForUpdates();
            }}
            testID="settings-check-updates"
          />
          <SettingsRow
            icon="package"
            label="Build / Version"
            sublabel="StellarTimeLock, LLC · com.stellartimelock"
            value={`v${APP_VERSION} (${BUILD_NUMBER})`}
            onPress={handleVersionTap}
            last
            testID="settings-version"
            accessibilityLabel={`App version ${APP_VERSION}, build ${BUILD_NUMBER}. Tap 7 times to unlock Easter egg.`}
          />
        </SettingsGroup>

        <Text style={styles.section}>SUPPORT</Text>
        <SettingsGroup>
          <SettingsRow
            icon="heart"
            label="Donate"
            sublabel="Send a gift to the developer"
            onPress={() => router.push("/donate")}
            chevron
            last
            testID="settings-donate"
          />
        </SettingsGroup>

        <Text style={styles.footerNote} testID="settings-footer">
          © StellarTimeLock, LLC
          {"\n"}
          stellartimelock.com
        </Text>

        <View style={{ height: spacing.lg }} />
        <View style={{ height: spacing.lg }} />

        <Button
          testID="settings-disconnect-button"
          label="Disconnect wallet"
          icon="log-out"
          variant="danger"
          onPress={openDisconnect}
        />
      </ScrollView>

      {/* Currency picker sheet */}
      <Modal
        visible={currencyPickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setCurrencyPickerOpen(false)}
      >
        <Pressable
          style={styles.backdrop}
          onPress={() => setCurrencyPickerOpen(false)}
        />
        <View
          style={[
            styles.sheet,
            { paddingBottom: insets.bottom + 16 },
          ]}
          testID="settings-currency-sheet"
        >
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeaderRow}>
            <Feather name="dollar-sign" size={18} color={colors.teal} />
            <Text style={styles.sheetTitle}>Display currency</Text>
          </View>
          <Text style={styles.sheetSub}>
            All amounts across the app render in this currency. XLM is
            native lumens (no conversion).
          </Text>
          {CURRENCIES.map((c, idx) => {
            const active = c.key === currency;
            return (
              <TouchableOpacity
                key={c.key}
                testID={`settings-currency-${c.key.toLowerCase()}`}
                onPress={() => {
                  setCurrency(c.key);
                  setCurrencyPickerOpen(false);
                }}
                style={[
                  styles.currencyRow,
                  idx > 0 && styles.currencyRowDivider,
                ]}
                activeOpacity={0.7}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.currencyLabel}>{c.label}</Text>
                  <Text style={styles.currencyDesc}>{c.desc}</Text>
                </View>
                <View style={[styles.radio, active && styles.radioOn]}>
                  {active ? <View style={styles.radioDot} /> : null}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </Modal>

      {/* Reveal-secret sheet */}
      <Modal
        visible={revealOpen}
        transparent
        animationType="fade"
        onRequestClose={closeReveal}
      >
        <Pressable style={styles.backdrop} onPress={closeReveal} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeaderRow}>
            <Feather name="alert-triangle" size={18} color={colors.danger} />
            <Text style={styles.sheetTitle}>
              {revealKind === "phrase"
                ? "Your recovery phrase"
                : "Your secret seed"}
            </Text>
          </View>
          <Text style={styles.sheetSub}>
            Anyone with this {revealKind === "phrase" ? "phrase" : "seed"}{" "}
            controls your vaults. Don&apos;t paste it into any website or share
            it with anyone.
          </Text>
          {secretLoading ? (
            <ActivityIndicator color={colors.cyan} />
          ) : secret ? (
            <>
              <View style={styles.secretBox}>
                <Text
                  testID={
                    revealKind === "phrase"
                      ? "settings-secret-phrase"
                      : "settings-secret-seed"
                  }
                  selectable
                  style={styles.secretText}
                >
                  {secret}
                </Text>
              </View>
              <View style={{ height: spacing.sm }} />
              <Button
                testID="settings-copy-secret"
                label="Copy to clipboard"
                icon="copy"
                variant="secondary"
                onPress={copySecret}
              />
            </>
          ) : (
            <Text style={styles.horizonHint}>
              {revealKind === "phrase"
                ? "No recovery phrase on this wallet. It was created or imported with a raw secret seed only."
                : "Secret seed unavailable."}
            </Text>
          )}
          <View style={{ height: spacing.sm }} />
          <Button
            testID="settings-reveal-close"
            label="Done"
            icon="check"
            onPress={closeReveal}
          />
        </View>
      </Modal>

      {/* Disconnect confirmation */}
      <Modal
        visible={disconnectOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setDisconnectOpen(false)}
      >
        <Pressable
          style={styles.backdrop}
          onPress={() => setDisconnectOpen(false)}
          testID="disconnect-backdrop"
        />
        <View
          style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}
          testID="disconnect-sheet"
        >
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeaderRow}>
            <Feather name="alert-triangle" size={18} color={colors.danger} />
            <Text style={styles.sheetTitle}>Disconnect wallet?</Text>
          </View>
          <Text style={styles.sheetSub}>
            Disconnecting will wipe the secret seed from this device. If you have
            not backed it up, your vaults will be permanently inaccessible — there
            is no recovery and no admin override.
          </Text>

          <View style={styles.disconnectCard}>
            <Feather
              name={seedExported ? "check-circle" : "download"}
              size={16}
              color={seedExported ? colors.cyan : colors.teal}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.disconnectCardTitle}>
                {seedExported ? "Seed exported this session" : "Back up your secret seed first"}
              </Text>
              <Text style={styles.disconnectCardSub}>
                {seedExported
                  ? "You revealed and copied the seed during this session."
                  : "Open the reveal sheet and copy the seed into a safe place before disconnecting."}
              </Text>
            </View>
            {demo.ready && !demo.enabled ? (
            <Button
              testID="disconnect-reveal-shortcut"
              label="Reveal"
              variant="secondary"
              icon="eye"
              onPress={() => {
                setDisconnectOpen(false);
                openReveal();
              }}
              style={styles.disconnectInlineBtn}
            />
            ) : null}
          </View>

          <Checkbox
            testID="disconnect-ack-checkbox"
            checked={acknowledged}
            onChange={setAcknowledged}
            label="I've safely stored my secret seed. I understand that losing it means losing access to my vaults forever."
          />

          <View style={{ height: spacing.md }} />
          <Button
            testID="disconnect-confirm-button"
            label="Disconnect wallet"
            icon="log-out"
            variant="danger"
            disabled={!acknowledged}
            onPress={handleDisconnect}
          />
          <View style={{ height: spacing.sm }} />
          <Button
            testID="disconnect-cancel-button"
            label="Cancel"
            variant="ghost"
            onPress={() => setDisconnectOpen(false)}
          />
        </View>
      </Modal>

      <SettingsMatrixRain
        visible={matrixVisible}
        onDismiss={() => setMatrixVisible(false)}
      />
      {spoonVisible ? (
        <View
          pointerEvents="box-none"
          style={[styles.spoonDock, { bottom: insets.bottom + 16 }]}
        >
          <TouchableOpacity
            style={styles.spoonButton}
            onPress={() => toast.show("There is no spoon.", "info")}
            testID="settings-spoon"
            accessibilityRole="button"
            accessibilityLabel="There is no spoon"
          >
            <Text style={styles.spoonEmoji}>🥄</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </SafeAreaView>
    </BiometricGate>
  );
}

function KeyStorageSection({
  expanded,
  onToggle,
  publicKey,
  onCopied,
}: {
  expanded: boolean;
  onToggle: () => void;
  publicKey: string | null;
  onCopied: () => void;
}) {
  const toast = useToast();
  const [phrase, setPhrase] = useState<string | null>(null);
  const [seed, setSeed] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [p, s] = await Promise.all([
          revealSecretPhrase(),
          revealSecretSeed(),
        ]);
        if (cancelled) return;
        setPhrase(p);
        setSeed(s);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [expanded]);

  const copyValue = useCallback(
    async (key: string, value: string, label: string) => {
      if (key === "phrase" || key === "seed") {
        await copySecretToClipboard(value);
      } else {
        await Clipboard.setStringAsync(value);
      }
      setCopiedKey(key);
      onCopied();
      toast.show(`${label} copied`, "success");
      setTimeout(() => {
        setCopiedKey((cur) => (cur === key ? null : cur));
      }, 1600);
    },
    [onCopied, toast],
  );

  return (
    <>
      <Text style={styles.section}>KEY STORAGE</Text>
      <Card padded status="locked">
        <TouchableOpacity
          onPress={onToggle}
          activeOpacity={0.75}
          style={styles.walletContactsHeader}
          testID="settings-key-storage-header"
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={
            expanded ? "Collapse Key Storage" : "Expand Key Storage"
          }
        >
          <View style={styles.walletContactsHeaderIcon}>
            <Feather name="key" size={16} color={colors.teal} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.walletContactsNickname} numberOfLines={1}>
              Key Storage
            </Text>
            <Text style={styles.walletContactsSub} numberOfLines={2}>
              {expanded
                ? "seed phrase · secret seed · public address"
                : "Tap to view and copy keys"}
            </Text>
          </View>
          <View style={styles.walletContactsChevronBtn}>
            <Feather
              name={expanded ? "chevron-up" : "chevron-down"}
              size={20}
              color={colors.textSecondary}
            />
          </View>
        </TouchableOpacity>

        {expanded ? (
          <View
            style={styles.contactsBody}
            testID="settings-key-storage-expanded"
          >
            {loading ? (
              <ActivityIndicator color={colors.teal} style={{ marginVertical: 12 }} />
            ) : (
              <>
                {phrase ? (
                  <KeyStorageRow
                    testID="settings-key-storage-phrase"
                    label="Seed Phrase"
                    value={phrase}
                    copied={copiedKey === "phrase"}
                    onCopy={() => copyValue("phrase", phrase, "Seed phrase")}
                  />
                ) : (
                  <View style={styles.keyStorageRow} testID="settings-key-storage-phrase-missing">
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.keyStorageLabel}>Seed Phrase</Text>
                      <Text style={styles.keyStorageMuted}>
                        Not available — this wallet was created or imported with a raw secret seed only.
                      </Text>
                    </View>
                  </View>
                )}

                <KeyStorageRow
                  testID="settings-key-storage-seed"
                  label="Secret Seed"
                  value={seed ?? "—"}
                  copied={copiedKey === "seed"}
                  onCopy={
                    seed
                      ? () => copyValue("seed", seed, "Secret seed")
                      : undefined
                  }
                  mono
                />

                <KeyStorageRow
                  testID="settings-key-storage-address"
                  label="Public Address"
                  value={publicKey ?? "—"}
                  copied={copiedKey === "address"}
                  onCopy={
                    publicKey
                      ? () => copyValue("address", publicKey, "Public address")
                      : undefined
                  }
                  mono
                />

                <View style={styles.keyStorageNote} testID="settings-key-storage-backup-note">
                  <Feather name="info" size={13} color={colors.textTertiary} />
                  <Text style={styles.keyStorageNoteText}>
                    These keys are included in the encrypted .stvault backup
                    file — no separate backup needed.
                  </Text>
                </View>
              </>
            )}
          </View>
        ) : null}
      </Card>
    </>
  );
}

function KeyStorageRow({
  testID,
  label,
  value,
  copied,
  onCopy,
  mono,
}: {
  testID: string;
  label: string;
  value: string;
  copied: boolean;
  onCopy?: () => void;
  mono?: boolean;
}) {
  return (
    <View style={styles.keyStorageRow} testID={testID}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.keyStorageLabel}>{label}</Text>
        <Text
          style={[styles.keyStorageValue, mono ? styles.keyStorageMono : null]}
          selectable
        >
          {value}
        </Text>
      </View>
      {onCopy ? (
        <TouchableOpacity
          onPress={onCopy}
          style={styles.keyStorageCopyBtn}
          testID={`${testID}-copy`}
          hitSlop={10}
          accessibilityLabel={`Copy ${label}`}
        >
          <Feather
            name={copied ? "check" : "copy"}
            size={14}
            color={copied ? colors.cyan : colors.cyan}
          />
          <Text
            style={[
              styles.keyStorageCopyText,
              copied ? { color: colors.cyan } : null,
            ]}
          >
            {copied ? "Copied" : "Copy"}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function WalletAndContactsSection({
  expanded,
  onToggle,
  showHeading = true,
}: {
  expanded: boolean;
  onToggle: () => void;
  showHeading?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const { wallet, wallets, activeWalletId } = useSession();
  const [entries, setEntries] = useState<AddressBookEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const activeMeta = wallets.find((w) => w.id === activeWalletId);
const nickname =
    activeMeta?.label ?? "Active wallet";
  const fullAddress = wallet?.publicKey ?? "—";

  const copyAddress = useCallback(async () => {
    if (!wallet?.publicKey) return;
    await Clipboard.setStringAsync(wallet.publicKey);
    toast.show("Address copied", "success");
  }, [wallet, toast]);

  const refresh = useCallback(async () => {
    try {
      const all = await listEntries();
      setEntries(all);
    } catch (e) {
      console.warn("[Contacts] listEntries failed:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleRemove = useCallback(
    (entry: AddressBookEntry) => {
      Alert.alert(
        "Remove contact?",
        `${entry.label} will no longer appear in the Send address book.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: async () => {
              try {
                await removeEntry(entry.id);
                await refresh();
                toast.show("Contact removed", "success");
              } catch (e) {
                console.warn("[Settings] remove failed:", e);
                toast.show("Couldn't remove. Please try again.", "error");
              }
            },
          },
        ],
      );
    },
    [refresh, toast],
  );

  return (
    <>
      {showHeading ? <Text style={styles.section}>WALLET & CONTACTS</Text> : null}
      <Card padded status="locked">
        <View style={styles.walletContactsHeader}>
          <TouchableOpacity
            onPress={onToggle}
            style={styles.walletContactsHeaderMain}
            activeOpacity={0.7}
            testID="settings-wallet-contacts-toggle"
            accessibilityLabel={
              expanded
                ? "Collapse wallet and contacts"
                : "Expand wallet and contacts"
            }
          >
            <View style={styles.walletContactsHeaderIcon}>
              <Feather name="user" size={16} color={colors.teal} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                style={styles.walletContactsNickname}
                numberOfLines={1}
                testID="settings-wallet-nickname"
              >
                {nickname}
              </Text>
              <Text
                style={styles.walletContactsAddress}
                selectable
                numberOfLines={2}
                testID="settings-wallet-address"
              >
                {fullAddress}
              </Text>
              <Text style={styles.walletContactsSub}>
                {loading
                  ? "Loading contacts…"
                  : `${wallets.length} ${wallets.length === 1 ? "wallet" : "wallets"} · ${entries.length} ${entries.length === 1 ? "contact" : "contacts"}`}
              </Text>
            </View>
          </TouchableOpacity>
          <View style={styles.walletContactsHeaderRight}>
            <TouchableOpacity
              onPress={copyAddress}
              style={styles.walletContactsCopyBtn}
              testID="settings-copy-address"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 4 }}
              accessibilityLabel="Copy wallet address"
            >
              <Feather name="copy" size={14} color={colors.cyan} />
              <Text style={styles.walletContactsCopyText}>Copy</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onToggle}
              style={styles.walletContactsChevronBtn}
              testID="settings-wallet-contacts-chevron"
              hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
              accessibilityLabel={expanded ? "Collapse section" : "Expand section"}
            >
              <Feather
                name={expanded ? "chevron-up" : "chevron-down"}
                size={20}
                color={colors.textSecondary}
              />
            </TouchableOpacity>
          </View>
        </View>

        {expanded ? (
          <View
            style={styles.contactsBody}
            testID="settings-wallet-contacts-expanded"
          >
            <Text style={styles.subSectionLabel}>MANAGE WALLETS</Text>
            <WalletManagerCard />
            <View style={styles.walletContactsDivider} />
            <Text style={styles.subSectionLabel}>ADDRESS BOOK</Text>
            {entries.length === 0 ? (
              <View style={styles.contactsEmptyCard}>
                <Feather name="user-plus" size={20} color={colors.textTertiary} />
                <Text style={styles.contactsEmptyText}>
                  No saved contacts yet. Tap Open Address Book below to
                  add your first contact.
                </Text>
              </View>
            ) : (
              entries.map((entry) => (
                <View
                  key={entry.id}
                  style={styles.contactRow}
                  testID={`contact-row-${entry.id}`}
                >
                  <View style={styles.contactRowLeft}>
                    <View style={styles.contactAvatar}>
                      {entry.icon && entry.icon in Feather.glyphMap ? (
                        <Feather
                          name={entry.icon as keyof typeof Feather.glyphMap}
                          size={14}
                          color={colors.teal}
                        />
                      ) : (
                        <Text style={styles.contactAvatarText}>
                          {(entry.label || "?").slice(0, 1).toUpperCase()}
                        </Text>
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={styles.contactRowTitleLine}>
                        <Text style={styles.contactRowName} numberOfLines={1}>
                          {entry.label || "Unnamed"}
                        </Text>
                        <View style={styles.contactKindBadge}>
                          <Text style={styles.contactKindBadgeText}>
                            {entry.kind.toUpperCase()}
                          </Text>
                        </View>
                      </View>
                      <Text
                        style={styles.contactRowAddress}
                        numberOfLines={1}
                        selectable
                      >
                        {shortenAddress(entry.publicKey, 6, 6)}
                      </Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    onPress={() => handleRemove(entry)}
                    style={styles.contactRemoveBtn}
                    testID={`contact-remove-${entry.id}`}
                    accessibilityLabel={`Remove ${entry.label}`}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Feather name="trash-2" size={16} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>
              ))
            )}
            <TouchableOpacity
              onPress={() => router.push("/contacts")}
              style={styles.contactsAddBtn}
              testID="settings-contacts-open"
              activeOpacity={0.85}
            >
              <Feather name="external-link" size={16} color={colors.cyan} />
              <Text style={styles.contactsAddBtnText}>
                Open Address Book
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  body: { padding: spacing.md, paddingBottom: spacing.xxl },
  headerBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomColor: colors.borderSubtle,
    borderBottomWidth: 1,
    gap: spacing.sm,
  },
  headerBack: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 17,
    ...typography.heading,
  },
  spoonDock: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 20,
  },
  spoonButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderGlow,
  },
  spoonEmoji: {
    fontSize: 28,
    lineHeight: 32,
    textAlign: "center",
  },
  title: { color: colors.text, fontSize: 26, ...typography.display },
  sub: { color: colors.textSecondary, fontSize: 13, marginTop: 4, marginBottom: spacing.lg },
  section: {
    color: colors.cyan,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  demoBanner: {
    marginTop: spacing.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: colors.surfaceFrost,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.cyan,
    gap: 4,
  },
  demoBannerTitle: {
    color: colors.cyan,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },
  demoBannerBody: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  footerNote: {
    color: colors.textTertiary,
    fontSize: 11,
    textAlign: "center",
    lineHeight: 17,
    marginTop: 28,
    marginBottom: 8,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  sectionMeta: {
    color: colors.textTertiary,
    fontSize: 11,
    ...typography.mono,
  },
  sectionSpacer: {
    height: spacing.md,
  },
  keyStorageRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
  },
  keyStorageLabel: {
    color: colors.textTertiary,
    fontSize: 10,
    ...typography.label,
    marginBottom: 4,
  },
  keyStorageValue: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  keyStorageMono: {
    ...typography.mono,
    fontSize: 12,
  },
  keyStorageMuted: {
    color: colors.textTertiary,
    fontSize: 12,
    lineHeight: 17,
  },
  keyStorageCopyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: radii.sm,
    backgroundColor: colors.cyanMuted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderGlow,
  },
  keyStorageCopyText: {
    color: colors.cyan,
    fontSize: 11,
    fontWeight: "700",
  },
  keyStorageNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
  },
  keyStorageNoteText: {
    flex: 1,
    color: colors.textTertiary,
    fontSize: 11,
    lineHeight: 16,
  },
  walletContactsHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  walletContactsHeaderMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    minWidth: 0,
  },
  walletContactsHeaderIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.cyanMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  walletContactsNickname: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  walletContactsAddress: {
    color: colors.textSecondary,
    fontSize: 11,
    marginTop: 4,
    ...typography.mono,
    lineHeight: 16,
  },
  walletContactsSub: {
    color: colors.textTertiary,
    fontSize: 11,
    marginTop: 6,
    fontWeight: "600",
  },
  walletContactsHeaderRight: {
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 4,
    marginLeft: 4,
  },
  walletContactsCopyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.sm,
    backgroundColor: colors.tealMuted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.teal,
  },
  walletContactsCopyText: {
    color: colors.teal,
    fontSize: 12,
    fontWeight: "700",
  },
  walletContactsChevronBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.sm,
  },
  exportSeedTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 6,
  },
  exportSeedBody: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  contactsBody: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
    gap: spacing.sm,
  },
  walletContactsDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderSubtle,
    marginVertical: spacing.md,
  },
  subSectionLabel: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  contactsEmptyCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: spacing.md,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceFrost,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    ...tileShadow(),
  },
  contactsEmptyText: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
  },
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: spacing.sm + 2,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceFrost,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    ...tileShadow(),
  },
  contactRowLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  contactAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.teal,
    alignItems: "center",
    justifyContent: "center",
  },
  contactAvatarText: {
    color: colors.teal,
    fontSize: 14,
    fontWeight: "800",
  },
  contactRowTitleLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  contactRowName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "600",
    flexShrink: 1,
  },
  contactKindBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: "rgba(148, 163, 184, 0.15)",
  },
  contactKindBadgeText: {
    color: colors.textSecondary,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  contactRowAddress: {
    color: colors.textSecondary,
    fontSize: 11,
    marginTop: 2,
    ...typography.mono,
  },
  contactRemoveBtn: {
    padding: 8,
    borderRadius: radii.sm,
  },
  contactsAddBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: spacing.sm + 2,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.teal,
    borderStyle: "dashed",
    backgroundColor: colors.tealMuted,
  },
  contactsAddBtnText: {
    color: colors.teal,
    fontSize: 13,
    fontWeight: "700",
  },
  horizonHint: { color: colors.textSecondary, fontSize: 12, marginTop: 4, lineHeight: 18 },

  currencyRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12 },
  currencyRowDivider: { borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  currencyLabel: { color: colors.text, fontSize: 15, fontWeight: "600" },
  currencyDesc: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  currencyCompact: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: spacing.sm + 2,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceFrost,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    ...tileShadow(),
  },
  currencyCompactIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.cyanMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  currencyCompactTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  currencyCompactTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
  },
  currencyCompactValueChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.tealMuted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.teal,
  },
  currencyCompactValueText: {
    color: colors.teal,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.4,
    ...typography.mono,
  },
  currencyCompactMeta: {
    color: colors.textSecondary,
    fontSize: 11,
    marginTop: 4,
    ...typography.mono,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  radioOn: { borderColor: colors.cyan },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.cyan },

  appearanceRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  appearIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.cyanMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  statusOn: { color: colors.cyan, fontSize: 11, ...typography.label },

  row: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  securityText: { color: colors.textSecondary, fontSize: 13, flex: 1, lineHeight: 18 },
  auditRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: spacing.md,
    padding: spacing.sm + 2,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceFrost,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    ...tileShadow(),
  },
  auditRowDisabled: {
    opacity: 0.55,
  },
  auditIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.cyanMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  auditIconDisabled: {
    backgroundColor: colors.surfaceElevated,
  },
  auditTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
  },
  auditTitleDisabled: {
    color: colors.textSecondary,
  },
  auditSub: {
    color: colors.textSecondary,
    fontSize: 11,
    marginTop: 2,
    lineHeight: 15,
  },
  tierLockPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.gold,
    backgroundColor: colors.goldMuted,
  },
  tierLockPillText: {
    color: colors.gold,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  legalRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: spacing.sm,
    padding: spacing.sm + 2,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceFrost,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    ...tileShadow(),
  },
  legalTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
  },
  connectedAppsNote: {
    color: colors.textTertiary,
    fontSize: 11,
    lineHeight: 15,
    marginBottom: spacing.sm,
  },
  advancedHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 13,
    minHeight: 52,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
  },
  advancedHeaderExpanded: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  advancedHeaderIcon: {
    width: 32,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  advancedHeaderText: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: "500",
  },

  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: spacing.md + 4,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: spacing.md,
  },
  sheetHeaderRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  sheetTitle: { color: colors.text, fontSize: 18, ...typography.heading },
  sheetSub: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 4,
    marginBottom: spacing.md,
    lineHeight: 18,
  },
  secretBox: {
    backgroundColor: colors.surfaceElevated,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secretText: { color: colors.gold, fontSize: 13, ...typography.mono },

  disconnectCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: spacing.md - 2,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  disconnectCardTitle: { color: colors.text, fontSize: 13, fontWeight: "600" },
  disconnectCardSub: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  disconnectInlineBtn: { paddingHorizontal: 12, minHeight: 38 },

  diagBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceFrost,
    marginBottom: spacing.md,
    ...tileShadow(),
  },
  diagBtnText: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    fontWeight: "600",
  },
  compareTiersBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceHighlight,
    marginTop: spacing.md,
  },
  subLoadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: spacing.sm,
  },
  subUnavailable: {
    color: colors.gold,
    fontSize: 12,
    lineHeight: 16,
    marginBottom: spacing.sm,
  },
  subCurrent: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    marginBottom: spacing.sm,
  },
  subTierList: {
    gap: spacing.sm,
  },
  subTierRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceFrost,
  },
  subTierName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
  },
  subTierPrice: {
    color: colors.textTertiary,
    fontWeight: "600",
  },
  subTierStatus: {
    color: colors.textTertiary,
    fontSize: 11,
    marginTop: 2,
  },
  subTierStatusActive: {
    color: colors.cyan,
  },
  subTierStatusExpired: {
    color: colors.gold,
  },
  subUpgradeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.cyan,
    backgroundColor: colors.cyanMuted,
  },
  subUpgradeBtnText: {
    color: colors.cyan,
    fontSize: 12,
    fontWeight: "700",
  },
  testTierWarning: {
    color: colors.gold,
    fontSize: 12,
    lineHeight: 16,
    marginBottom: spacing.sm,
  },
  testTierCurrent: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    marginBottom: spacing.sm,
  },
  testTierRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  testTierChip: {
    minWidth: "46%",
    flexGrow: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceFrost,
  },
  testTierChipOn: {
    borderColor: colors.cyan,
    backgroundColor: colors.cyanMuted,
  },
  testTierChipText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
  },
  testTierChipPrice: {
    color: colors.textTertiary,
    fontSize: 11,
    marginTop: 2,
  },
  testTierChipTextOn: {
    color: colors.cyan,
  },
});