// Receive screen — display the active wallet's public key as a QR code
// and as copyable text, paired with the non-custodial / no-memo
// disclosure required by product.
//
// Routing: `expo-router` file-based, mounted at `/receive`. Linked from
// the dashboard's hero "Receive" affordance and from the Wallet
// section of Settings.
//
// Browse-without-seed: the layout is always viewable. Seed is required
// only to reveal a real receiving address / QR (same pattern as
// create-vault and send — explore freely, gate on the action).
//
// Non-custodial constraints honoured here:
//   - We render ONLY the public key (`G...`); the secret seed never
//     leaves the SecureStore.
//   - Memos are intentionally NOT required for personal Stellar
//     addresses (unlike centralised exchange addresses that share a
//     pooled `G...` and disambiguate per-user with a memo). The static
//     disclosure under the copy row spells this out so users sending
//     funds to this wallet from an exchange don't accidentally attach
//     a memo that breaks the deposit.

import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { Stack, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import QRCode from "react-native-qrcode-svg";

import { useToast } from "@/src/components/Toast";
import { useSession } from "@/src/state/session";
import { colors, radii, spacing, typography } from "@/src/theme";
import { shadow } from "@/src/theme/shadow";

// QR module count for a typical Stellar address (56-char Base32) at
// error-correction level "M" → 41×41. Render at 240px on the canvas
// so each module is ~5-6px, well above the minimum scan footprint on
// any modern phone camera even from a low-light angle.
const QR_SIZE = 240;

export default function ReceiveScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { wallet } = useSession();

  // Brief inline feedback after a successful copy. Times out on its own
  // so we don't need a toast library — keeps the build lean.
  const [copied, setCopied] = useState<boolean>(false);

  const publicKey = wallet?.publicKey ?? "";
  const hasAddress = publicKey.length > 0;

  /** Browse-without-seed: explore the layout; seed required for a real address. */
  const requireSeedToReceive = useCallback(() => {
    toast.show("Add a wallet seed to view your receive address.", "info");
    router.push("/wallet-setup");
  }, [toast, router]);

  const onCopy = useCallback(async () => {
    if (!publicKey) {
      requireSeedToReceive();
      return;
    }
    try {
      await Clipboard.setStringAsync(publicKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // expo-clipboard should never throw on RN-web/RN-iOS/RN-Android in
      // practice, but if it does we silently swallow — the user can
      // still tap-to-copy the address by long-press selecting the
      // visible text below.
    }
  }, [publicKey, requireSeedToReceive]);

  const onShare = useCallback(async () => {
    if (!publicKey) {
      requireSeedToReceive();
      return;
    }
    try {
      await Share.share({
        message: publicKey,
        title: "Stellar address",
      });
    } catch {
      // Share sheet cancellation throws on some platforms; safe to ignore.
    }
  }, [publicKey, requireSeedToReceive]);

  // Format the long Base32 key into 4-char groups so the user can
  // visually verify it matches what they expect (a single 56-char
  // line is hard to scan). 4-char groups are also what Stellar wallets
  // like Lobstr use, so this matches user mental models.
  const groupedKey = useMemo(() => {
    if (!publicKey) return "";
    return publicKey.match(/.{1,4}/g)?.join(" ") ?? publicKey;
  }, [publicKey]);

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.headerBar} testID="receive-header">
        <TouchableOpacity
          style={styles.headerBtn}
          onPress={() => router.back()}
          accessibilityLabel="Close receive screen"
          testID="receive-close"
        >
          <Feather name="chevron-left" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Receive XLM</Text>
        <TouchableOpacity
          style={styles.headerBtn}
          onPress={onShare}
          accessibilityLabel="Share address"
          testID="receive-share"
        >
          <Feather name="share-2" size={18} color={colors.text} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + spacing.xl },
        ]}
        testID="receive-scroll"
      >
        {/*
          QR canvas — wrapped in a fixed-aspect white card so the
          dark-theme background doesn't bleed into the QR's quiet
          zone (which is required for reliable scanning). The
          `react-native-qrcode-svg` library renders an SVG that is
          export-stable across React Native and RN-Web; no native
          dependency to manage.
          Browse mode: placeholder card until a seed unlocks a real key.
        */}
        <View style={styles.qrCard} testID="receive-qr">
          {hasAddress ? (
            <QRCode
              value={publicKey}
              size={QR_SIZE}
              backgroundColor="#FFFFFF"
              color="#000000"
              ecl="M"
            />
          ) : (
            <View style={styles.qrPlaceholder} testID="receive-qr-placeholder">
              <Feather name="qrcode" size={64} color={colors.textTertiary} />
              <Text style={styles.qrPlaceholderText}>
                Add a seed to show your QR code
              </Text>
            </View>
          )}
        </View>

        {!hasAddress ? (
          <View style={styles.seedBanner} testID="receive-seed-banner">
            <Feather name="info" size={14} color={colors.teal} />
            <Text style={styles.seedBannerText}>
              Add a wallet seed to view your receive address.
            </Text>
            <TouchableOpacity
              onPress={requireSeedToReceive}
              style={styles.setupCta}
              testID="receive-setup-cta"
              activeOpacity={0.85}
            >
              <Text style={styles.setupCtaText}>Set up wallet</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <Text style={styles.label}>YOUR STELLAR ADDRESS</Text>
        <View style={styles.addressCard}>
          <Text
            style={[styles.addressText, !hasAddress && styles.addressTextMuted]}
            selectable={hasAddress}
            testID="receive-address-text"
          >
            {hasAddress
              ? groupedKey
              : "GXXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX"}
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.copyBtn, copied && styles.copyBtnCopied]}
          onPress={onCopy}
          activeOpacity={0.85}
          testID="receive-copy"
        >
          <Feather
            name={copied ? "check" : "copy"}
            size={16}
            color={colors.textInverse}
          />
          <Text style={styles.copyBtnText}>
            {copied ? "Copied" : hasAddress ? "Copy address" : "Add seed to copy"}
          </Text>
        </TouchableOpacity>

        {/*
          Permanent disclosure — required by product. The text is
          intentionally pinned RIGHT BELOW the copy button so anyone
          who taps to copy sees the disclosure before pasting the
          address into a third-party platform (which is precisely
          when memo confusion most often happens).
        */}
        <View style={styles.disclosure} testID="receive-disclosure">
          <Feather name="info" size={14} color={colors.teal} />
          <Text style={styles.disclosureText}>
            <Text style={styles.disclosureBold}>Notice: </Text>
            This is a fully non-custodial, private wallet. A transaction
            memo is not required to receive funds.
          </Text>
        </View>

        <View style={styles.footer}>
          <Feather name="shield" size={11} color={colors.textTertiary} />
          <Text style={styles.footerText}>
            Only XLM and Stellar-native assets — never send other-chain
            assets (BTC, ETH, etc.) to this address.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  headerBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
  },
  headerTitle: {
    color: colors.text,
    fontSize: 16,
    ...typography.heading,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    alignItems: "center",
  },
  qrCard: {
    width: QR_SIZE + 32,
    height: QR_SIZE + 32,
    backgroundColor: "#FFFFFF",
    borderRadius: radii.lg,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
    // Cross-platform shadow — `shadow()` resolves to:
    //   web    → boxShadow string (modern, non-deprecated)
    //   ios    → shadowColor / shadowOffset / shadowOpacity / shadowRadius
    //   android → elevation
    // ...which avoids the React Native Web "shadow* deprecated, use
    // boxShadow" console noise we'd otherwise emit on every render.
    ...shadow({
      color: "#000",
      offsetY: 8,
      opacity: 0.25,
      radius: 16,
      elevation: 6,
    }),
  },
  qrPlaceholder: {
    width: QR_SIZE,
    height: QR_SIZE,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    backgroundColor: "#F4F6F8",
    borderRadius: radii.md,
  },
  qrPlaceholderText: {
    color: colors.textTertiary,
    fontSize: 12,
    textAlign: "center",
    paddingHorizontal: spacing.md,
  },
  seedBanner: {
    width: "100%",
    alignItems: "center",
    gap: 10,
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.tealMuted,
    borderLeftWidth: 3,
    borderLeftColor: colors.teal,
  },
  seedBannerText: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
  setupCta: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radii.sm,
    backgroundColor: colors.teal,
  },
  setupCtaText: { color: colors.textInverse, fontSize: 13, fontWeight: "700" },
  label: {
    color: colors.textTertiary,
    fontSize: 11,
    ...typography.label,
    alignSelf: "flex-start",
    marginBottom: spacing.xs,
  },
  addressCard: {
    width: "100%",
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  addressText: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 20,
    ...typography.mono,
    // Tabular-nums keeps the 4-char groups visually aligned.
  },
  addressTextMuted: {
    color: colors.textTertiary,
  },
  copyBtn: {
    marginTop: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    borderRadius: radii.md,
    backgroundColor: colors.cyanMuted,
    borderWidth: 1,
    borderColor: colors.cyan,
    width: "100%",
  },
  copyBtnCopied: {
    backgroundColor: colors.tealMuted,
    borderColor: colors.teal,
  },
  copyBtnText: {
    color: colors.cyan,
    fontSize: 15,
    fontWeight: "600",
  },
  disclosure: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    width: "100%",
    marginTop: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.tealMuted,
    borderLeftWidth: 3,
    borderLeftColor: colors.teal,
  },
  disclosureText: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    lineHeight: 19,
  },
  disclosureBold: {
    fontWeight: "700",
    color: colors.teal,
  },
  footer: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    marginTop: spacing.lg,
  },
  footerText: {
    flex: 1,
    color: colors.textTertiary,
    fontSize: 11,
    lineHeight: 16,
  },
});
