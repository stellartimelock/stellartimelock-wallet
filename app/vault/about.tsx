// Vault education page.
//
// Reached from the "What is a vault?" affordance on the Crypto tab's
// Active Vaults section. Explains the primitive in plain language so
// new users understand:
//
//   1. What a time-lock actually enforces (Soroban contract, not a
//      soft UI reminder).
//   2. Why "cannot be opened early" is a feature not a bug.
//   3. The trade-off vs a regular savings account or a hardware
//      wallet.
//   4. The practical mechanics — max 1000 days, XLM only for MVP,
//      unlock timestamp is absolute.
//
// Deliberately NOT a call-to-action funnel. The primary CTA on this
// page is the back button; a small tertiary "Create a vault" chip at
// the bottom lets curious readers continue if they're convinced.

import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors, radii, spacing, typography } from "@/src/theme";

export default function VaultAbout() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]} testID="vault-about-screen">
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          testID="vault-about-back"
          accessibilityRole="button"
          accessibilityLabel="Back to previous screen"
        >
          <Feather name="chevron-left" size={22} color={colors.text} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>What is a vault?</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroCard}>
          <View style={styles.heroIcon}>
            <Feather name="lock" size={26} color={colors.teal} />
          </View>
          <Text style={styles.heroTitle}>
            A time-locked savings box for XLM or any Stellar token
          </Text>
          <Text style={styles.heroSub}>
            A vault is a small Soroban smart contract that holds XLM or any
            Stellar token until a date you pick. The contract will refuse
            to release the funds even a second early — not even you can
            override it.
          </Text>
        </View>

        <Section
          eyebrow="HOW IT WORKS"
          title="Enforced on-chain, not by the app"
          body="When you create a vault the app deploys a fresh Soroban
                contract seeded with your target unlock timestamp and
                initial deposit. The unlock rule is baked into the
                contract bytecode — the app cannot bypass it, and
                neither can we. Uninstalling the app does not touch
                the vault."
          icon="cpu"
        />

        <Section
          eyebrow="WHY LOCK IT"
          title="Removes the option to spend it"
          body={
            "Let\u2019s be honest: when the house run goes better than usual, the hardest part isn\u2019t winning \u2014 it\u2019s walking away clean. When a massive trade lands or the wallet sits heavy, the temptation to recycle those wins into the next gamble gets loud. Terry Benedict\u2019s crew couldn\u2019t crack this vault, and neither can you. Once you commit your assets to the on-chain timeline, the button is gone. No middleman, no backdoor, no exceptions.\n\n" +
            "Think of the vault as the ultimate heist-proof lock: once you drop those XLM in, the \u201CSend\u201D button effectively vanishes from the floor plan, protected by the ironclad logic of a Soroban smart contract that even the smoothest talker can\u2019t bribe or bypass. No amount of late-night conviction or \u201Cjust this one time\u201D can force a rewrite on the timeline.\n\n" +
            "When the vault finally clicks open on schedule, your funds are waiting exactly where they should be \u2014 no vig, no juice, no penalties. Just your assets returned with the cold, calculated comfort of knowing the safe was completely impenetrable, even if you tried to crack it yourself."
          }
          icon="shield"
        />

        <Section
          eyebrow="THE RULES"
          title="What you're committing to"
          body={
            "\u2022 Custom lock duration: 1\u20131000 days.\n" +
            "\u2022 Assets: XLM plus 10+ curated Stellar tokens\n" +
            "  (USDC, EURC, AQUA, yXLM, BTC, ETH, SHX, ARST\u2026)\n" +
            "  via the Multi-Asset BETA vault. Paste-your-own-\n" +
            "  contract address is also supported.\n" +
            "\u2022 Early withdrawal: not possible \u2014 no admin key,\n" +
            "  no override, no support-desk unlock.\n" +
            "\u2022 Fees: standard Stellar network fee (a fraction of a\n" +
            "  cent) when you create, deposit, extend, or withdraw."
          }
          icon="file-text"
        />

        <Section
          eyebrow="VS OTHER OPTIONS"
          title="Not the same as staking or yield platforms"
          body={
            "Many platforms lure users with artificially high APY percentages, but your funds are locked in tokens with no real-world utility \u2014 assets that have shown consistent depreciation over time. When the lock period ends, the promised rewards often don\u2019t cover what you lost in asset value.\n\n" +
            "A vault is different. It locks XLM or any Stellar token \u2014 assets with active institutional adoption, real-world payment rails, and a growing ecosystem of tokenized instruments. You get back exactly what you put in. No token risk. No broken promises."
          }
          icon="trending-down"
        />

        <Section
          eyebrow="VS A SAVINGS ACCOUNT"
          title="Not the same as a traditional bank"
          body={
            "A vault isn\u2019t managed by a financial institution. There\u2019s no minimum balance, no monthly fees, no paperwork. Just a smart contract on Stellar Mainnet that enforces one rule: the funds cannot move until the unlock date passes.\n\n" +
            "There is no admin. No backdoor. No emergency override. What you lock stays locked until the timestamp passes. Enforced by a Soroban smart contract on Stellar Mainnet."
          }
          icon="scale"
        />

        <View style={styles.pledgeCard}>
          <Feather name="alert-triangle" size={14} color={colors.gold} />
          <Text style={styles.pledgeText}>
            This is a one-way commitment. Only lock funds you are
            certain you won&apos;t need until the unlock date. There is
            no undo.
          </Text>
        </View>

        <TouchableOpacity
          onPress={() => router.replace("/create-vault")}
          style={styles.cta}
          activeOpacity={0.85}
          testID="vault-about-create-cta"
          accessibilityRole="button"
          accessibilityLabel="Create a new vault"
        >
          <Feather name="plus" size={14} color={colors.textInverse} />
          <Text style={styles.ctaText}>Create a vault</Text>
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

  pledgeCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: "rgba(255, 197, 66, 0.10)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.gold,
  },
  pledgeText: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 17,
    flex: 1,
    fontWeight: "600",
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
