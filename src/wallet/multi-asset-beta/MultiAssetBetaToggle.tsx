// MultiAssetBetaToggle — the opt-in switch for the Mainnet BETA feature.
//
// Rendered near the top of the Create Vault screen. When the environment
// flag `EXPO_PUBLIC_MULTI_ASSET_BETA=1` is unset this component returns
// `null` so the screen looks exactly like it did before the beta existed.

import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import {
  Linking,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { colors, radii, spacing, typography } from "@/src/theme";
import {
  isMultiAssetBetaEnabled,
  MULTI_ASSET_BETA_STATUS,
} from "@/src/wallet/multi-asset-beta/contract-config";

interface Props {
  value: boolean;
  onChange: (next: boolean) => void;
}

export function MultiAssetBetaToggle({ value, onChange }: Props) {
  const router = useRouter();
  // Feature-flag gate: nothing renders without the env flag.
  if (!isMultiAssetBetaEnabled()) return null;

  const deployed = MULTI_ASSET_BETA_STATUS.deployed;

  return (
    <View style={styles.wrap} testID="multi-asset-beta-toggle">
      <View style={styles.headerRow}>
        <View style={styles.iconBubble}>
          <Feather name="layers" size={16} color={colors.gold} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>Multi-Asset Vault</Text>
            <View style={styles.betaBadge}>
              <Text style={styles.betaBadgeText}>Beta</Text>
            </View>
          </View>
          <Text style={styles.sub}>
            Lock any Stellar token (USDC, EURC, and more) instead of only XLM.
          </Text>
        </View>
        <Switch
          value={value}
          onValueChange={(next) => {
            if (!deployed) return;
            onChange(next);
          }}
          disabled={!deployed}
          trackColor={{ true: colors.gold, false: colors.trackOff }}
          thumbColor={colors.thumbOn}
          ios_backgroundColor={colors.trackOff}
          testID="multi-asset-beta-switch"
          accessibilityLabel="Enable multi-asset mainnet beta"
        />
      </View>

      {value && deployed ? (
        <View style={styles.warnBox}>
          <Feather name="info" size={12} color={colors.teal} />
          <Text style={styles.warnText}>
            Multi-asset vaults are newer than the XLM vault. The lock
            rules are the same battle-tested logic, just applied to
            other Stellar tokens. Start with a modest amount while you
            get comfortable with the flow.
          </Text>
        </View>
      ) : null}

      {/* Plain-language trust-line reminder with a
          tappable "Tap to see how trust lines work" affordance that
          opens /vault/trustline-explainer. */}
      {value && deployed ? (
        <View style={styles.trustBox}>
          <Feather name="link" size={12} color={colors.teal} />
          <View style={{ flex: 1 }}>
            <Text style={styles.trustText}>
              <Text style={styles.trustHeading}>
                Your wallet must approve this token first.{" "}
              </Text>
              Stellar tokens other than XLM require a trust line before your
              wallet can receive them. If you already hold this token,
              you&apos;re set. If you remove the trust line later, withdrawal
              will pause until you re-establish it.
            </Text>
            <TouchableOpacity
              onPress={() => router.push("/vault/trustline-explainer")}
              activeOpacity={0.7}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              testID="multi-asset-beta-trustline-learn-more"
            >
              <Text style={styles.trustLearnMore}>
                Tap to see how trust lines work →
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {!deployed ? (
        <View style={styles.pendingBox}>
          <Feather name="clock" size={12} color={colors.textTertiary} />
          <Text style={styles.pendingText}>
            This feature isn&apos;t available on your app version yet. Please
            update or wait for the next release.
          </Text>
        </View>
      ) : (
        <TouchableOpacity
          onPress={() =>
            MULTI_ASSET_BETA_STATUS.explorerUrl &&
            Linking.openURL(MULTI_ASSET_BETA_STATUS.explorerUrl)
          }
          style={styles.explorerLink}
          testID="multi-asset-beta-explorer"
        >
          <Feather name="external-link" size={11} color={colors.teal} />
          <Text style={styles.explorerText}>View contract on Stellar Expert</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: spacing.md,
    padding: spacing.sm + 2,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.gold,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  iconBubble: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(245, 158, 11, 0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  betaBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.goldMuted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.gold,
  },
  betaBadgeText: {
    color: colors.gold,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  title: {
    ...typography.heading,
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
  },
  sub: {
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 2,
  },
  warnBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    marginTop: spacing.sm,
    padding: 8,
    backgroundColor: "rgba(245, 158, 11, 0.08)",
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.35)",
  },
  warnText: { color: colors.gold, fontSize: 11, flex: 1, lineHeight: 15 },
  trustBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    marginTop: spacing.sm,
    padding: 8,
    backgroundColor: colors.tealMuted,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.teal,
  },
  trustText: { color: colors.teal, fontSize: 11, lineHeight: 15 },
  trustHeading: { fontWeight: "800" },
  trustLearnMore: {
    color: colors.teal,
    fontSize: 11,
    fontWeight: "800",
    textDecorationLine: "underline",
    marginTop: 6,
  },
  pendingBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    marginTop: spacing.sm,
    padding: 8,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radii.sm,
  },
  pendingText: {
    color: colors.textSecondary,
    fontSize: 11,
    flex: 1,
    lineHeight: 15,
  },
  explorerLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: spacing.sm,
    alignSelf: "flex-start",
  },
  explorerText: {
    color: colors.teal,
    fontSize: 11,
    fontWeight: "700",
    textDecorationLine: "underline",
  },
});
