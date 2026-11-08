// Wallet setup screen
// Step 2 of onboarding: wallet key custody (create/import).
// This app has no account / no sign-in — the wallet's Stellar
// secret seed is the sole identity, kept on-device in SecureStore.
// Reached from Welcome via the "Get Started" CTA (either directly
// for returning users, or after the onboarding chooser).

import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useRef } from "react";
import {
  Animated,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/src/components/Button";
import { useSession } from "@/src/state/session";
import { colors, radii, spacing, typography } from "@/src/theme";

const LOGO = require("../assets/images/splash-icon.png");

export default function WalletSetup() {
  const router = useRouter();
  const { enterBrowseMode } = useSession();

  const nameOpacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(nameOpacity, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();
  }, [nameOpacity]);

  const onBrowseWithoutSeed = async () => {
    await enterBrowseMode();
    router.replace("/(tabs)/wallet");
  };

  return (
    <View style={styles.root} testID="wallet-setup-screen">
      <View style={styles.hero}>
        <SafeAreaView edges={["top"]} style={styles.heroContent}>
          <TouchableOpacity
            testID="wallet-setup-back"
            onPress={() => router.back()}
            style={styles.backBtn}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Feather name="chevron-left" size={18} color={colors.text} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>

          <View style={styles.heroCopy}>
            <Image
              source={LOGO}
              style={styles.heroLogo}
              resizeMode="contain"
              accessibilityIgnoresInvertColors
            />
            <Animated.Text
              style={[styles.title, { opacity: nameOpacity }]}
              testID="wallet-setup-title"
            >
              Set up your wallet
            </Animated.Text>
            <Text style={styles.tagline}>Your keys · Your device · Never our servers</Text>
          </View>
        </SafeAreaView>
      </View>

      <KeyboardAwareScrollView
        ScrollViewComponent={ScrollView}
        contentContainerStyle={styles.scrollBody}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        bottomOffset={100}
      >
        <Text style={styles.sectionEyebrow}>PICK ONE</Text>

        <View style={styles.cardsBlock}>
          <ChoiceCard
            testID="wallet-setup-create"
            icon="key"
            title="Create a new wallet"
            body="Generate a fresh Stellar keypair on this device. We'll walk you through revealing and safely backing up your 12-word seed."
            recommended
            onPress={() => router.push("/connect")}
          />

          <ChoiceCard
            testID="wallet-setup-import"
            icon="rotate-ccw"
            title="Restore with seed"
            body="Restore a wallet you already own using a 12- or 24-word secret recovery phrase or a raw Stellar secret key."
            onPress={() => router.push("/import")}
          />

          <ChoiceCard
            testID="wallet-setup-browse"
            icon="eye"
            title="Browse without seed"
            body="Explore the app in read-only mode. You can look around without creating or importing a wallet."
            onPress={() => {
              void onBrowseWithoutSeed();
            }}
          />
        </View>

        <View style={styles.pledgeCard} testID="wallet-setup-pledge">
          <Feather name="shield" size={14} color={colors.teal} />
          <Text style={styles.pledgeText}>
            No custody. No admin. No backdoor. Just you and the blockchain.
          </Text>
        </View>
      </KeyboardAwareScrollView>

      <SafeAreaView edges={["bottom"]} style={styles.actions}>
        <Button
          testID="wallet-setup-primary-cta"
          label="Create a new Stellar wallet"
          icon="key"
          onPress={() => router.push("/connect")}
        />
      </SafeAreaView>
    </View>
  );
}

function ChoiceCard({
  icon,
  title,
  body,
  testID,
  onPress,
  recommended,
}: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  body: string;
  testID: string;
  onPress: () => void;
  recommended?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.choiceCard, recommended && styles.choiceCardRecommended]}
      testID={testID}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
    >
      <View style={styles.choiceIconWrap}>
        <Feather name={icon} size={18} color={colors.teal} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.choiceTitleRow}>
          <Text style={styles.choiceTitle}>{title}</Text>
          {recommended ? (
            <View style={styles.recBadge}>
              <Text style={styles.recBadgeText}>RECOMMENDED</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.choiceBody}>{body}</Text>
      </View>
      <Feather name="chevron-right" size={16} color={colors.textTertiary} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  hero: {
    minHeight: 220,
    justifyContent: "flex-start",
    backgroundColor: colors.background,
  },
  heroContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    paddingVertical: 4,
    paddingRight: 8,
  },
  backText: { color: colors.text, fontSize: 14, fontWeight: "600" },
  heroCopy: { alignItems: "center", gap: 4 },
  heroLogo: {
    width: 52,
    height: 52,
    marginBottom: spacing.xs,
    borderRadius: 20,
  },
  title: {
    color: colors.text,
    fontSize: 24,
    lineHeight: 30,
    ...typography.display,
    textAlign: "center",
  },
  tagline: {
    color: colors.teal,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    textAlign: "center",
  },
  scrollShell: { flex: 1 },
  scrollBody: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  sectionEyebrow: {
    color: colors.textTertiary,
    fontSize: 10,
    ...typography.label,
  },
  cardsBlock: { gap: 10 },

  choiceCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
  },
  choiceCardRecommended: {
    borderColor: colors.teal,
    borderWidth: 1,
  },
  choiceIconWrap: {
    width: 40,
    height: 40,
    borderRadius: radii.sm,
    backgroundColor: colors.tealMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  choiceTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 3,
    flexWrap: "wrap",
  },
  choiceTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
  },
  recBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: colors.tealMuted,
  },
  recBadgeText: {
    color: colors.teal,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  choiceBody: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },

  pledgeCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: spacing.sm,
    borderRadius: radii.sm,
    backgroundColor: colors.tealMuted,
  },
  pledgeText: {
    color: colors.teal,
    fontSize: 11,
    fontWeight: "700",
    flex: 1,
    lineHeight: 15,
  },

  actions: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
    backgroundColor: colors.background,
  },
});
