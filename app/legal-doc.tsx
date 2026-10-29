// Legal & Compliance document viewer.
//
// Renders one of two short, plain-language legal documents (Privacy
// Policy or Terms of Use). Reached from Settings → LEGAL & COMPLIANCE.
// Copy is verbatim from the product brief and MUST NOT be altered
// without a legal review.
//
// Route: `/legal-doc?doc=privacy` | `/legal-doc?doc=terms`
//
// This is intentionally a separate screen from `/legal` — that screen
// hosts the long-form IP Disclosures and doubles as the first-run
// acceptance gate. This screen is a plain, always-readable read-out of
// two focused documents users can reach any time from Settings.

import { Feather } from "@expo/vector-icons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors, radii, spacing, typography } from "@/src/theme";

interface Bullet {
  label: string;
  body: string;
}

interface LegalDoc {
  slug: "privacy" | "terms";
  title: string;
  intro: string;
  bullets: Bullet[];
}

const DOCS: readonly LegalDoc[] = [
  {
    slug: "privacy",
    title: "Privacy Policy",
    intro:
      "At Stellar TimeLock, we believe financial privacy is a fundamental right.",
    bullets: [
      {
        label: "Zero Data Collection",
        body:
          "We do not collect, store, or transmit your secret seeds, private keys, or personal financial data.",
      },
      {
        label: "Local-Only",
        body:
          "All data is encrypted using AES-256 and stored exclusively on your device.",
      },
      {
        label: "No Tracking",
        body:
          "We do not use third-party analytics or tracking tools. Your experience remains private, anonymous, and entirely under your control.",
      },
    ],
  },
  {
    slug: "terms",
    title: "Terms of Use",
    intro: "Stellar TimeLock is a non-custodial software wallet.",
    bullets: [
      {
        label: "Sole Custody",
        body:
          "By using this app, you acknowledge that you are the sole custodian of your private keys and recovery phrases. We cannot access your funds, recover your lost keys, or freeze your transactions.",
      },
      {
        label: "Use at Your Own Risk",
        body:
          "This software is provided \"as is.\" You are responsible for the security of your device and the physical backup of your recovery phrases.",
      },
      {
        label: "Irreversibility",
        body:
          "Transactions on the Stellar network are irreversible. Please verify all destination addresses carefully before confirming any transaction.",
      },
    ],
  },
];

export default function LegalDocScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ doc?: string }>();

  const doc = useMemo<LegalDoc>(() => {
    const slug = params.doc === "terms" ? "terms" : "privacy";
    return DOCS.find((d) => d.slug === slug) ?? DOCS[0];
  }, [params.doc]);

  return (
    <View style={styles.root} testID={`legal-doc-${doc.slug}`}>
      <Stack.Screen options={{ headerShown: false }} />

      <SafeAreaView edges={["top"]} style={styles.headerWrap}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            hitSlop={10}
            style={styles.backBtn}
            accessibilityLabel="Back"
            testID="legal-doc-back"
          >
            <Feather name="chevron-left" size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.title} testID="legal-doc-title" numberOfLines={1}>
            {doc.title}
          </Text>
          <View style={styles.backBtn} />
        </View>
      </SafeAreaView>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollBody}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.card}>
          <Text style={styles.intro}>{doc.intro}</Text>

          {doc.bullets.map((b) => (
            <View key={b.label} style={styles.bulletRow} testID={`legal-doc-bullet-${b.label.replace(/\s+/g, "-").toLowerCase()}`}>
              <View style={styles.bulletDot}>
                <Feather name="check" size={12} color={colors.teal} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.bulletLabel}>{b.label}</Text>
                <Text style={styles.bulletBody}>{b.body}</Text>
              </View>
            </View>
          ))}
        </View>

        <TouchableOpacity
          testID="legal-doc-close"
          onPress={() => router.back()}
          style={styles.closeBtn}
          activeOpacity={0.85}
        >
          <Text style={styles.closeBtnText}>Close</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  headerWrap: { backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  backBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    flex: 1,
    color: colors.text,
    fontSize: 17,
    fontWeight: "700",
    textAlign: "center",
    letterSpacing: 0.2,
  },
  scroll: { flex: 1 },
  scrollBody: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  card: {
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    gap: spacing.md,
  },
  intro: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "600",
    marginBottom: spacing.xs,
  },
  bulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  bulletDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.tealMuted,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  bulletLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 4,
    ...typography.label,
    letterSpacing: 0.3,
  },
  bulletBody: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
  },
  closeBtn: {
    paddingVertical: 14,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    alignItems: "center",
  },
  closeBtnText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
  },
});
