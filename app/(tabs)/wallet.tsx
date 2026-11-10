import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useToast } from "@/src/components/Toast";
import { useSession } from "@/src/state/session";
import { accentGlow, colors, radii, spacing, tileShadow, typography } from "@/src/theme";
import { shortenAddress } from "@/src/wallet/stellar";
import {
  fetchHorizonBalance,
  type HorizonBalance,
} from "@/src/wallet/horizon";
import { NetworkFeeBadge } from "@/src/send/components/NetworkFeeBadge";
import { useTrackTab } from "@/src/navigation/useTabReturn";
import { BiometricGate } from "@/src/security/BiometricGate";
import {
  loadSmartAddresses,
  type SmartAddress,
} from "@/src/send/smart-address-book";
import { WalletSwitcherChip } from "@/src/wallet/WalletSwitcherChip";
import { UnifiedVaultsList } from "@/src/vault/UnifiedVaultsList";
import { TierMonitorDashboard } from "@/src/vault/TierMonitorDashboard";
import { requestVaultListRefresh } from "@/src/vault/vault-session-cache";
import {
  getCurrentTier,
  getTierConfig,
  hydrateTier,
  type TierId,
} from "@/src/tiers/tier-config";
import { checkKmAccess } from "@/src/security/key-manager-access";
import { subscribeKeyManagerUpdating } from "@/src/security/key-manager-store";

export default function WalletScreen() {
  const { tile, t } = useLocalSearchParams<{ tile?: string | string[]; t?: string | string[] }>();
  const tileName = Array.isArray(tile) ? tile[0] : tile;
  const tileAt = Array.isArray(t) ? t[0] : t;
  const balanceTile = tileName === "balance";
  const {
    wallet,
    formatXlm,
    formatFiat,
    browseMode,
    priceSource,
    setPricePollingActive,
    wallets,
  } = useSession();
  useTrackTab("/(tabs)/wallet");
  const toast = useToast();
  const [balance, setBalance] = useState<HorizonBalance | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [contacts, setContacts] = useState<SmartAddress[]>([]);
  const [balanceError, setBalanceError] = useState<boolean>(false);
  const [balanceLoading, setBalanceLoading] = useState<boolean>(true);
  const [tierId, setTierId] = useState<TierId>(getCurrentTier());
  // Re-hydrate on every focus so the Settings → Test Tier Selection toggle
  // takes effect immediately when returning to the wallet tab. Also gate
  // Stellar DEX price polling to this focused surface only.
  useFocusEffect(
    useCallback(() => {
      setPricePollingActive(true);
      void hydrateTier().then(setTierId);
      return () => setPricePollingActive(false);
    }, [setPricePollingActive]),
  );
  const tierCfg = getTierConfig(tierId);

  const requireSeed = useCallback(
    (action: string) => {
      toast.show(`Add a wallet seed to ${action}.`, "info");
      router.push("/wallet-setup");
    },
    [toast],
  );

  const loadBalance = useCallback(async () => {
    if (!wallet) {
      setBalance(null);
      setBalanceLoading(false);
      return;
    }
    setBalanceLoading(true);
    try {
      const b = await fetchHorizonBalance(wallet.publicKey);
      setBalance(b);
      setBalanceError(false);
    } catch {
      // Horizon best-effort — keep prior snapshot but flag error so
      // the UI can render the "pull down to retry" red strip.
      setBalanceError(true);
    } finally {
      setBalanceLoading(false);
    }
  }, [wallet]);

  const loadContacts = useCallback(async () => {
    const rows = await loadSmartAddresses(setContacts);
    setContacts(rows);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadContacts();
    }, [loadContacts]),
  );

  useEffect(() => {
    loadBalance();
    loadContacts();
  }, [loadBalance, loadContacts]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      // Force vault session cache refresh (UnifiedVaultsList subscribers).
      requestVaultListRefresh();
      await Promise.all([loadBalance(), loadContacts()]);
    } finally {
      setRefreshing(false);
    }
  }, [loadBalance, loadContacts]);

  const onCopyAddress = useCallback(async () => {
    if (!wallet) return;
    await Clipboard.setStringAsync(wallet.publicKey);
    toast.show("Wallet address copied to clipboard.", "success");
  }, [wallet, toast]);

  // Book has wallets but this process has no signing material yet —
  // fingerprint unlock restores the derived key. Do not dump the user
  // into "No wallet connected" (that used to force a seed re-entry).
  if (!wallet && !browseMode && wallets.length > 0) {
    return (
      <BiometricGate surface="wallet" offerSeedWhenStranded>
        <SafeAreaView edges={["top"]} style={styles.root} testID="wallet-unlocking">
          <View style={styles.switcherStrip} testID="wallet-switcher-header">
            <WalletSwitcherChip />
          </View>
        </SafeAreaView>
      </BiometricGate>
    );
  }

  // No seed and not browsing — nudge toward setup (legacy empty state).
  if (!wallet && !browseMode) {
    return (
      <SafeAreaView edges={["top"]} style={styles.root}>
        <View style={styles.switcherStrip} testID="wallet-switcher-header">
          <WalletSwitcherChip />
        </View>
        <ScrollView contentContainerStyle={styles.emptyRoot}>
          <Feather name="alert-circle" size={36} color={colors.textTertiary} />
          <Text style={styles.emptyTitle}>No wallet connected</Text>
          <Text style={styles.emptyBody}>
            Import or create a wallet to manage your vaults and Stellar tokens.
          </Text>
          <TouchableOpacity
            onPress={() => router.push("/import")}
            style={styles.importCta}
            testID="wallet-import-cta"
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Import wallet"
          >
            <Feather name="download" size={16} color={colors.textInverse} />
            <Text style={styles.importCtaText}>Import wallet</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push("/wallet-setup")}
            style={styles.createCta}
            testID="wallet-create-cta"
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Create a new wallet"
          >
            <Text style={styles.createCtaText}>Create a new wallet</Text>
          </TouchableOpacity>
          <UpdatingNote />
        </ScrollView>
      </SafeAreaView>
    );
  }

  const seedless = !wallet && browseMode;
  const spendable = balance?.spendable ?? 0;

  return (
    <BiometricGate
      surface="wallet"
      requireUnlock={balanceTile}
      promptKey={balanceTile ? tileAt ?? "balance" : undefined}
    >
      <SafeAreaView edges={["top"]} style={styles.root} testID="wallet-screen">
      <View style={styles.switcherStrip} testID="wallet-switcher-header">
        <WalletSwitcherChip />
      </View>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.cyan}
          />
        }
      >
        {seedless ? (
          <TouchableOpacity
            style={styles.browseBanner}
            onPress={() => router.push("/wallet-setup")}
            testID="wallet-browse-banner"
            activeOpacity={0.85}
          >
            <Feather name="eye" size={14} color={colors.teal} />
            <Text style={styles.browseBannerText}>
              Browse mode — tap to add a seed when you&apos;re ready to send or
              create vaults
            </Text>
          </TouchableOpacity>
        ) : null}

        <View style={styles.headerRow}>
          {wallet ? (
            <TouchableOpacity
              style={styles.addressChip}
              onPress={onCopyAddress}
              testID="wallet-copy-address"
              activeOpacity={0.7}
            >
              <Text style={styles.eyebrow}>CONNECTED WALLET</Text>
              <View style={styles.addressLine}>
                <Text style={styles.address} numberOfLines={1}>
                  {shortenAddress(wallet.publicKey, 10, 8)}
                </Text>
                <View style={styles.copyIconWrap}>
                  <Feather name="copy" size={12} color={colors.cyan} />
                </View>
              </View>
            </TouchableOpacity>
          ) : (
            <View style={styles.addressChip} testID="wallet-browse-address">
              <Text style={styles.eyebrow}>BROWSE MODE</Text>
              <View style={styles.addressLine}>
                <Text style={styles.address} numberOfLines={1}>
                  No wallet connected
                </Text>
              </View>
            </View>
          )}
          <View style={styles.headerIcons}>
            <TouchableOpacity
              onPress={() => router.push("/contacts")}
              style={styles.headerIconBtn}
              testID="crypto-open-contacts"
              accessibilityLabel="Address book"
            >
              <Feather name="users" size={18} color={colors.text} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() =>
                router.push({
                  pathname: "/history",
                  params: { source: "vaults" },
                })
              }
              style={styles.headerIconBtn}
              testID="wallet-open-history"
              accessibilityLabel="Vault history"
            >
              <Feather name="clock" size={18} color={colors.text} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.push("/settings")}
              style={styles.headerIconBtn}
              testID="wallet-open-settings"
              accessibilityLabel="Settings"
            >
              <Feather name="settings" size={18} color={colors.text} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.balanceCard} testID="wallet-balance-card">
          <Text style={styles.balanceEyebrow} numberOfLines={1}>
            Native XLM Balance
          </Text>
          <Text
            style={[
              styles.balanceFiat,
              priceSource === "cache" ? { opacity: 0.7 } : null,
            ]}
            testID="wallet-balance-fiat"
            numberOfLines={1}
          >
            {seedless
              ? formatFiat(0)
              : balance
                ? formatFiat(spendable)
                : balanceLoading
                  ? " "
                  : formatFiat(0)}
            {priceSource === "cache" &&
            !seedless &&
            (balance || !balanceLoading)
              ? " ·"
              : ""}
          </Text>
          <Text
            style={styles.balanceValue}
            testID="wallet-balance-xlm"
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
          >
            {seedless
              ? formatXlm(0)
              : balance
                ? formatXlm(spendable)
                : balanceLoading
                  ? "—"
                  : formatXlm(0)}
          </Text>
          <View style={styles.balanceUnitRow}>
            <View style={styles.balanceActions}>
              <ActionButton
                icon="arrow-up-right"
                label="Send"
                onPress={() => router.push("/send")}
                testID="wallet-send-button"
                compact
              />
              <ActionButton
                icon="refresh-cw"
                label="Swap"
                onPress={() =>
                  seedless ? requireSeed("use Swap") : router.push("/swap")
                }
                testID="wallet-swap-button"
                variant="outline-gold"
                compact
              />
              <ActionButton
                icon="arrow-down-left"
                label="Receive"
                onPress={() => router.push("/receive")}
                testID="wallet-receive-button"
                compact
              />
            </View>
          </View>
          {balanceError ? (
            <View style={styles.offlineStrip} testID="wallet-balance-offline">
              <Feather name="wifi-off" size={14} color={colors.danger} />
              <Text style={styles.offlineText}>
                Couldn&apos;t reach Horizon — pull down to retry.
              </Text>
            </View>
          ) : null}
          <View style={{ marginTop: spacing.sm }}>
            <NetworkFeeBadge mode="compact" testID="wallet-network-fee-badge" />
          </View>
        </View>

        <UpdatingNote />
        <KeyButton />
        <ScopulyRow />

        <View style={styles.abHeader}>
          <Text style={styles.section}>SMART ADDRESS BOOK</Text>
          <TouchableOpacity
            onPress={() => router.push("/contacts")}
            testID="wallet-manage-contacts"
          >
            <Text style={styles.abManage}>Manage ›</Text>
          </TouchableOpacity>
        </View>
        {contacts.length === 0 ? (
          <View style={styles.abEmpty} testID="wallet-address-book-empty">
            <Feather name="users" size={18} color={colors.textTertiary} />
            <Text style={styles.abEmptyText}>
              No saved addresses yet. Contacts, your wallets, and saved
              keys show up here.
            </Text>
          </View>
        ) : (
          <FlatList
            data={contacts}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={(e) => e.id}
            contentContainerStyle={styles.abList}
            testID="wallet-address-book-carousel"
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.abCard, { backgroundColor: colors.background }]}
                onPress={() =>
                  router.push({
                    pathname: "/send",
                    params: {
                      to: item.publicKey,
                      memo: item.defaultMemo ?? "",
                      kind: item.kind,
                      // Lock address + memo on Send (same as Address Book pick).
                      contact: item.label,
                    },
                  })
                }
                testID={`wallet-address-book-item-${item.id}`}
                activeOpacity={0.7}
              >
                <View style={styles.abInitial}>
                  {item.icon && item.icon in Feather.glyphMap ? (
                    <Feather
                      name={item.icon as keyof typeof Feather.glyphMap}
                      size={13}
                      color={colors.cyan}
                    />
                  ) : (
                    <Text style={styles.abInitialText}>
                      {item.label.charAt(0).toUpperCase()}
                    </Text>
                  )}
                </View>
                <Text style={styles.abLabel} numberOfLines={1}>
                  {item.label}
                </Text>
                <Text style={styles.abAddr} numberOfLines={1}>
                  {item.publicKey.slice(0, 6)}…{item.publicKey.slice(-4)}
                </Text>
                {item.defaultMemo ? (
                  <Text style={styles.abMemo} numberOfLines={1}>
                    memo: {item.defaultMemo}
                  </Text>
                ) : item.source === "wallet" ? (
                  <Text style={styles.abMemo} numberOfLines={1}>
                    Wallet
                  </Text>
                ) : item.source === "key" ? (
                  <Text style={styles.abMemo} numberOfLines={1}>
                    Saved key
                  </Text>
                ) : item.source === "vault" ? (
                  <Text style={styles.abMemo} numberOfLines={1}>
                    Vault
                  </Text>
                ) : (
                  <Text style={styles.abMemoPlaceholder} numberOfLines={1}>
                    {" "}
                  </Text>
                )}
              </TouchableOpacity>
            )}
          />
        )}

        <View style={styles.vaultsCard} testID="wallet-vaults-card">
          <View style={styles.vaultHeaderBtnRow}>
            <TouchableOpacity
              onPress={() => router.push("/create-vault")}
              style={[
                styles.vaultHeaderBtn,
                styles.vaultHeaderBtnNew,
                accentGlow("rgba(232, 184, 74, 0.45)"),
              ]}
              testID="crypto-vaults-new-button"
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={
                tierId === "free"
                  ? "Create a new Time-Lock vault"
                  : `Create a new vault (${tierCfg.label})`
              }
            >
              <Feather name="plus" size={14} color={colors.gold} />
              <Text style={styles.vaultHeaderBtnTextNew}>New Vault</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.push("/vault/about")}
              style={[styles.vaultHeaderBtn, styles.vaultHeaderBtnAbout]}
              testID="crypto-vaults-about-button"
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="What is a vault? Read the primitive explainer."
            >
              <Text style={styles.vaultHeaderBtnTextAbout} numberOfLines={1}>
                What is a Vault?
              </Text>
            </TouchableOpacity>
          </View>
          <UnifiedVaultsList embedded />
        </View>

        {/* Only the user's own tier dashboard renders — always expanded, no
            collapsible chevron. Free tier sees none. */}
        {tierId !== "free" ? (
          <TierDashboardCard tier={tierId} testID="wallet-dashboard" />
        ) : null}

      </ScrollView>
    </SafeAreaView>
    </BiometricGate>
  );
}

function UpdatingNote() {
  const [updating, setUpdating] = useState(false);
  useEffect(() => subscribeKeyManagerUpdating(setUpdating), []);
  if (!updating) return null;
  return (
    <Text
      testID="wallet-updating"
      style={styles.updatingNote}
      accessibilityRole="text"
      accessibilityLabel="Updating your wallet"
    >
      Updating your wallet…
    </Text>
  );
}

function ScopulyRow() {
  return (
    <TouchableOpacity
      style={styles.scopulyRow}
      onPress={() => router.push("/scopuly")}
      activeOpacity={0.8}
      testID="wallet-scopuly-row"
      accessibilityRole="button"
      accessibilityLabel="Scopuly. Explore Scopuly."
    >
      <Image
        source={require("@/assets/brand/scopuly.png")}
        style={styles.scopulyMark}
        resizeMode="contain"
        accessibilityLabel="Scopuly"
      />
      <View style={styles.scopulyCopy}>
        <Text style={styles.keyButtonLabel}>Scopuly</Text>
        <Text style={styles.keyButtonSub}>Explore Scopuly</Text>
      </View>
      <Feather name="chevron-right" size={16} color={colors.textTertiary} />
    </TouchableOpacity>
  );
}

function KeyButton() {
  const toast = useToast();
  const handlePress = useCallback(async () => {
    try {
      const access = await checkKmAccess();
      if (access.allowed) {
        router.push("/key-manager");
      } else {
        router.push("/key-manager-gate");
      }
    } catch {
      toast.show("Couldn't open Key Manager. Please try again.", "error");
    }
  }, [toast]);

  return (
    <TouchableOpacity
      style={styles.keyButton}
      onPress={() => void handlePress()}
      activeOpacity={0.8}
      testID="wallet-key-button"
      accessibilityRole="button"
      accessibilityLabel="Key Manager — store and view secret keys for any chain"
    >
      <View style={styles.keyButtonIcon}>
        <Feather name="key" size={14} color={colors.cyan} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.keyButtonLabel}>Key Manager</Text>
        <Text style={styles.keyButtonSub}>Store and look up keys for any chain</Text>
      </View>
      <Feather name="chevron-right" size={16} color={colors.textTertiary} />
    </TouchableOpacity>
  );
}

const TIER_DASHBOARD_CONFIG: Record<
  Exclude<TierId, "free">,
  {
    label: string;
    icon: keyof typeof Feather.glyphMap;
    accent: string;
    variant: "plus" | "pro" | "institutional";
    title: string;
    badge: string;
    subtitle: string;
  }
> = {
  plus: {
    label: "Plus Dashboard",
    icon: "plus",
    accent: colors.gold,
    variant: "plus",
    title: "Plus Dashboard",
    badge: "PLUS TIER",
    subtitle: "Time-Lock · Cooling-Off · monitoring + create",
  },
  pro: {
    label: "Pro Dashboard",
    icon: "activity",
    accent: colors.cyan,
    variant: "pro",
    title: "Pro Dashboard",
    badge: "PRO TIER",
    subtitle: "Create & track up to ~$50k · Pro vault types",
  },
  elite: {
    label: "Elite Dashboard",
    icon: "layers",
    accent: "#4DB8E8",
    variant: "institutional",
    title: "Elite Dashboard",
    badge: "ELITE",
    subtitle: "Every vault type. No limits.",
  },
};

function TierDashboardCard({
  tier,
  testID,
}: {
  tier: Exclude<TierId, "free">;
  testID: string;
}) {
  const cfg = TIER_DASHBOARD_CONFIG[tier];
  return (
    <View style={styles.tierDashboardCard} testID={testID}>
      <View
        style={[styles.tierDashboardHeader, { borderLeftColor: cfg.accent }]}
        testID={`${testID}-header`}
      >
        <Feather name={cfg.icon} size={15} color={cfg.accent} />
        <Text style={[styles.tierDashboardTitle, { color: cfg.accent }]}>
          {cfg.label}
        </Text>
      </View>
      <View style={styles.tierDashboardBody}>
        <TierMonitorDashboard
          variant={cfg.variant}
          title={cfg.title}
          badge={cfg.badge}
          subtitle={cfg.subtitle}
          embedded
        />
      </View>
    </View>
  );
}

function ActionButton({
  icon,
  label,
  onPress,
  testID,
  variant = "teal",
  compact = false,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  onPress: () => void;
  testID: string;
  variant?: "teal" | "gold" | "deep" | "outline-gold";
  compact?: boolean;
}) {
  const accent =
    variant === "gold" || variant === "outline-gold"
      ? colors.gold
      : variant === "deep"
        ? "#4DB8E8"
        : colors.cyan;
  const border =
    variant === "gold" || variant === "outline-gold"
      ? colors.gold
      : colors.cyan;
  const fill =
    variant === "outline-gold"
      ? "transparent"
      : variant === "gold"
        ? colors.goldMuted
        : variant === "deep"
          ? "#0A3A5C"
          : colors.background;
  const glow =
    variant === "outline-gold"
      ? undefined
      : variant === "gold"
        ? accentGlow("rgba(232, 184, 74, 0.45)")
        : variant === "deep"
          ? accentGlow("rgba(10, 58, 92, 0.55)")
          : accentGlow("rgba(0, 229, 255, 0.45)");
  const btnStyle = compact ? styles.actionBtnCompact : styles.actionBtn;
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        btnStyle,
        { backgroundColor: fill, borderColor: border },
        glow,
      ]}
      testID={testID}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Feather name={icon} size={compact ? 14 : 20} color={accent} />
      <Text
        style={[
          compact ? styles.actionLabelCompact : styles.actionLabel,
          { color: accent },
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.md, paddingBottom: spacing.xxl },
  browseBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: 10,
    marginBottom: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.tealMuted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.teal,
  },
  browseBannerText: {
    flex: 1,
    color: colors.teal,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 16,
  },
  emptyRoot: { flexGrow: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  emptyText: { color: colors.textSecondary, fontSize: 13 },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: "700", marginTop: 8 },
  emptyBody: { color: colors.textSecondary, fontSize: 13, textAlign: "center", lineHeight: 19 },
  importCta: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingVertical: 12, paddingHorizontal: 24,
    borderRadius: radii.pill,
    backgroundColor: colors.cyanMuted,
    borderWidth: 1,
    borderColor: colors.cyan,
    marginTop: spacing.md,
  },
  importCtaText: { color: colors.textInverse, fontSize: 14, fontWeight: "700" },
  createCta: { paddingVertical: 10, paddingHorizontal: 16, marginTop: 4 },
  createCtaText: { color: colors.cyan, fontSize: 13, fontWeight: "600" },
  emptyComingSoon: {
    alignSelf: "stretch",
    marginTop: spacing.xl,
    paddingHorizontal: spacing.md,
  },
  headerRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    marginBottom: spacing.md,
  },
  addressChip: { flex: 1, minWidth: 0 },
  eyebrow: { color: colors.textTertiary, fontSize: 10, ...typography.label },
  addressLine: {
    flexDirection: "row", alignItems: "center", gap: 6,
    marginTop: 2, minWidth: 0,
  },
  address: { color: colors.text, fontSize: 13, fontWeight: "700", flexShrink: 1, ...typography.mono },
  copyIconWrap: { flexShrink: 0 },
  headerIcons: { flexDirection: "row", gap: 6 },
  headerIconBtn: {
    width: 40, height: 40,
    alignItems: "center", justifyContent: "center",
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceFrost,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderGlow,
    ...tileShadow(),
  },

  balanceCard: {
    alignSelf: "stretch",
    backgroundColor: colors.surfaceFrost,
    borderRadius: radii.lg,
    padding: spacing.lg,
    borderWidth: 2,
    // Wallet / Balance card — Aurora blue border.
    borderColor: "rgba(94, 159, 255, 0.3)",
    marginBottom: spacing.md,
    ...tileShadow(),
  },
  vaultsCard: {
    alignSelf: "stretch",
    backgroundColor: colors.surfaceFrost,
    borderRadius: radii.lg,
    padding: spacing.md,
    borderWidth: 2,
    // Vaults card — soft gold border.
    borderColor: "rgba(232, 184, 74, 0.3)",
    marginTop: spacing.md,
    gap: spacing.sm,
    ...tileShadow(),
  },
  vaultHeaderBtnRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  vaultHeaderBtn: {
    minWidth: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 24,
    borderWidth: 1,
    backgroundColor: colors.background,
  },
  vaultHeaderBtnNew: {
    borderColor: colors.gold,
  },
  vaultHeaderBtnAbout: {
    borderColor: "#FFFFFF",
  },
  vaultHeaderBtnTextNew: {
    color: colors.gold,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  vaultHeaderBtnTextAbout: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  switcherStrip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
  },
  balanceEyebrow: {
    color: colors.textTertiary,
    fontSize: 10,
    textAlign: "center",
    ...typography.label,
  },
  balanceFiat: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
    marginTop: 4,
    textAlign: "center",
  },
  balanceValue: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: "400",
    ...typography.mono,
    marginTop: 4,
    textAlign: "center",
  },
  balanceUnitRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.sm,
  },
  balanceActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    flexShrink: 0,
  },
  moneyLinks: {
    flexDirection: "row",
    justifyContent: "center",
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  moneyLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  moneyLinkText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "600",
  },
  offlineStrip: {
    marginTop: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: radii.sm,
    backgroundColor: colors.dangerMuted,
    borderLeftWidth: 3,
    borderLeftColor: colors.danger,
  },
  offlineText: { color: colors.danger, fontSize: 12, fontWeight: "600", flex: 1 },

  actionBtn: {
    flex: 1, minHeight: 64,
    alignItems: "center", justifyContent: "center", gap: 4,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  actionBtnCompact: {
    minWidth: 56,
    paddingVertical: 6,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    borderRadius: 24,
    borderWidth: 1,
  },
  actionLabel: { fontSize: 12, fontWeight: "700", letterSpacing: 0.4 },
  actionLabelCompact: { fontSize: 10, fontWeight: "700", letterSpacing: 0.3 },

  section: { color: colors.textTertiary, fontSize: 11, ...typography.label },

  keyButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 9,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceFrost,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    marginBottom: spacing.sm,
    ...tileShadow(),
  },
  keyButtonIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.cyanMuted,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  keyButtonLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
  },
  keyButtonSub: {
    color: colors.textTertiary,
    fontSize: 11,
    marginTop: 1,
  },
  updatingNote: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: spacing.sm,
  },
  scopulyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceFrost,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    marginBottom: spacing.sm,
  },
  scopulyMark: {
    width: 28,
    height: 28,
    borderRadius: 8,
  },
  scopulyCopy: { flex: 1 },

  abHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    marginBottom: spacing.sm,
  },
  abManage: { color: colors.cyan, fontSize: 12, fontWeight: "600" },
  abEmpty: {
    flexDirection: "row", alignItems: "center", gap: 10,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.background,
    overflow: "hidden",
    opacity: 1,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.borderSubtle,
  },
  abEmptyText: { color: colors.textSecondary, fontSize: 12, flex: 1, lineHeight: 17 },
  abList: { gap: spacing.sm, paddingRight: spacing.md },
  abCard: {
    width: 128,
    height: 108,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: colors.background,
    overflow: "hidden",
    opacity: 1,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    gap: 3,
    justifyContent: "flex-start",
  },
  abInitial: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
    backgroundColor: colors.cyanMuted,
    marginBottom: 2,
  },
  abInitialText: { color: colors.cyan, fontSize: 13, fontWeight: "800" },
  abLabel: { color: colors.text, fontSize: 13, fontWeight: "600" },
  abAddr: { color: colors.textSecondary, fontSize: 11, ...typography.mono },
  abMemo: { color: colors.gold, fontSize: 10, ...typography.mono, opacity: 0.85 },
  abMemoPlaceholder: { fontSize: 10, opacity: 0 },

  tierDashboardCard: {
    alignSelf: "stretch",
    marginTop: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceFrost,
    overflow: "hidden",
    ...tileShadow(),
  },
  tierDashboardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    borderLeftWidth: 3,
    minHeight: 48,
  },
  tierDashboardTitle: {
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0.3,
    flexShrink: 1,
  },
  tierDashboardBody: {
    padding: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
  },
});
