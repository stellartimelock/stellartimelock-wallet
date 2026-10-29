// Trust-line explainer page.
//
// Reached from the trust-line banner on the Multi-Asset Vault toggle
// AND from the actionable withdraw error on the vault detail screen.
//
// Three plain-language sections targeted at users who have never
// touched crypto:
//   1. What a trust line IS.
//   2. Why Stellar requires them.
//   3. How to add one (walkthrough for common wallets).
//
// Deliberately NOT a call-to-action funnel — the primary CTA on this
// page is the back button; a small "Continue" chip at the bottom lets
// curious readers hop back to whatever they were doing.

import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import {
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors, radii, spacing, typography } from "@/src/theme";

export default function TrustlineExplainer() {
  const router = useRouter();

  // When the page is deep-linked directly (e.g. from a QR code, or
  // returning users hitting a bookmarked URL), the navigation stack
  // has no previous entry — `router.back()` would be a no-op. Fall
  // back to the vault dashboard in that case so the user always has
  // an escape hatch.
  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/");
    }
  };

  return (
    <SafeAreaView
      style={styles.root}
      edges={["top", "bottom"]}
      testID="trustline-explainer-screen"
    >
      <View style={styles.header}>
        <TouchableOpacity
          onPress={goBack}
          style={styles.backBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          testID="trustline-explainer-back"
          accessibilityRole="button"
          accessibilityLabel="Back to previous screen"
        >
          <Feather name="chevron-left" size={22} color={colors.text} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>What is a trust line?</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroCard}>
          <View style={styles.heroIcon}>
            <Feather name="link" size={26} color={colors.teal} />
          </View>
          <Text style={styles.heroTitle}>Establishing a trust line</Text>
          <Text style={styles.heroSub}>
            Before your Stellar wallet can receive any token other than XLM,
            you must approve a connection for that specific token. This
            connection is called a trust line. Once established, it stays
            active unless you intentionally remove it.
          </Text>
        </View>

        <Section
          eyebrow="WHAT IT IS"
          title="A record that authorizes your account to hold a token"
          body={
            "A trust line is a record in your Stellar account that " +
            "authorizes it to hold a specific token from a specific issuer. " +
            'For example: "I accept USDC issued by Circle."\n\n' +
            "Creating one locks a small reserve of XLM (about 0.5 XLM) in " +
            "your account, which is returned to you if you remove the trust " +
            "line."
          }
          icon="file-text"
        />

        <Section
          eyebrow="WHY STELLAR REQUIRES IT"
          title="You decide which tokens your wallet accepts"
          body={
            "Anyone can issue a token on Stellar. Without trust lines, " +
            "spammers could dump worthless or malicious tokens into every " +
            "wallet on the network. Trust lines reverse this: you decide " +
            "which tokens your wallet will accept.\n\n" +
            "It also lets issuers like Circle verify who is eligible to " +
            "hold their token, which matters for regulated stablecoins."
          }
          icon="shield"
        />

        <Section
          eyebrow="HOW TO ADD ONE"
          title="Do it in your wallet, then return here"
          body={
            "The trust line is stored in your wallet, not in this app. Use " +
            "the Stellar wallet that holds your funds:\n\n" +
            "\u2022 Freighter (browser): Open Freighter \u2192 \u201CManage " +
            "assets\u201D \u2192 \u201CAdd asset\u201D \u2192 search the " +
            "token code (e.g. USDC) \u2192 confirm. This will establish a " +
            "trust line.\n" +
            "\u2022 Lobstr (mobile): Open Lobstr \u2192 tap + on the home " +
            "screen \u2192 \u201CAdd asset\u201D \u2192 search the token " +
            "code \u2192 confirm. This will establish a trust line.\n" +
            "\u2022 StellarX (web): Open StellarX \u2192 Portfolio \u2192 " +
            "\u201CManage trustlines\u201D \u2192 add the asset by code " +
            "and issuer. This will establish a trust line.\n\n" +
            "Once you see the token in your wallet\u2019s asset list, " +
            "return here. The vault can release it back to your wallet " +
            "on unlock."
          }
          icon="check-circle"
        />

        <View style={styles.linksCard}>
          <Text style={styles.linksHeading}>Wallet download links</Text>
          <LinkRow
            label="Freighter (browser extension)"
            url="https://www.freighter.app/"
          />
          <LinkRow
            label="Lobstr (iOS & Android)"
            url="https://lobstr.co/"
          />
          <LinkRow
            label="Official Stellar documentation on trustlines"
            url="https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/accounts#trustlines"
          />
        </View>

        <TouchableOpacity
          onPress={goBack}
          style={styles.cta}
          activeOpacity={0.85}
          testID="trustline-explainer-done"
          accessibilityRole="button"
          accessibilityLabel="Return to previous screen"
        >
          <Feather name="arrow-left" size={14} color={colors.textInverse} />
          <Text style={styles.ctaText}>Got it</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({
  eyebrow,
  title,
  body,
  icon,
}: {
  eyebrow: string;
  title: string;
  body: string;
  icon: keyof typeof Feather.glyphMap;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <View style={styles.sectionIcon}>
          <Feather name={icon} size={14} color={colors.teal} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.sectionEyebrow}>{eyebrow}</Text>
          <Text style={styles.sectionTitle}>{title}</Text>
        </View>
      </View>
      <Text style={styles.sectionBody}>{body}</Text>
    </View>
  );
}

function LinkRow({ label, url }: { label: string; url: string }) {
  return (
    <TouchableOpacity
      onPress={() => Linking.openURL(url)}
      style={styles.linkRow}
      activeOpacity={0.7}
    >
      <Feather name="external-link" size={13} color={colors.teal} />
      <Text style={styles.linkText} numberOfLines={2}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingTop: 4,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    minWidth: 80,
  },
  backText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "600",
  },
  headerTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  headerSpacer: { minWidth: 80 },
  body: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },

  heroCard: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.teal,
    padding: spacing.lg,
    alignItems: "center",
    gap: spacing.sm,
  },
  heroIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.tealMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  heroTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: 0.2,
    textAlign: "center",
  },
  heroSub: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },

  section: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    padding: spacing.md,
    gap: spacing.sm,
  },
  sectionHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  sectionIcon: {
    width: 30,
    height: 30,
    borderRadius: radii.sm,
    backgroundColor: colors.tealMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionEyebrow: {
    color: colors.teal,
    fontSize: 10,
    letterSpacing: 1.2,
    fontWeight: "700",
    ...typography.label,
    marginBottom: 2,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 18,
  },
  sectionBody: {
    color: colors.textSecondary,
    fontSize: 12.5,
    lineHeight: 18,
  },

  linksCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    padding: spacing.md,
    gap: spacing.sm,
  },
  linksHeading: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
    marginBottom: 4,
    ...typography.label,
  },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 6,
  },
  linkText: {
    color: colors.teal,
    fontSize: 13,
    fontWeight: "600",
    flex: 1,
    textDecorationLine: "underline",
  },

  cta: {
    marginTop: spacing.sm,
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.teal,
  },
  ctaText: {
    color: colors.textInverse,
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
});
