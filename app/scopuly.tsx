import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import { Image, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useToast } from "@/src/components/Toast";
import {
  SCOPULY_FEATURES,
  SCOPULY_PLAY_MARKET,
  SCOPULY_PLAY_URL,
  SCOPULY_X_URL,
} from "@/src/scopuly/features";
import { useSession } from "@/src/state/session";
import { colors, radii, spacing, typography } from "@/src/theme";

const SCOPULY = require("@/assets/brand/scopuly.png");
const X_LOGO = require("@/assets/brand/x-logo.png");
const PLAY = require("@/assets/brand/google-play-badge.png");

export default function ScopulyScreen() {
  const { wallet } = useSession();
  const toast = useToast();

  const openPlay = async () => {
    try {
      await Linking.openURL(SCOPULY_PLAY_MARKET);
    } catch {
      await Linking.openURL(SCOPULY_PLAY_URL);
    }
  };

  const openWithAddress = async () => {
    if (!wallet?.publicKey) {
      toast.show("Open a wallet first. Your secret key stays here.", "info");
      return;
    }
    await Clipboard.setStringAsync(wallet.publicKey);
    toast.show("Public address copied. Your secret key stays here.", "info");
  };

  return (
    <SafeAreaView edges={["top"]} style={styles.root} testID="scopuly-screen">
      <View style={styles.headerBar}>
        <TouchableOpacity
          style={styles.headerBtn}
          onPress={() => router.back()}
          accessibilityLabel="Back"
          testID="scopuly-back"
        >
          <Feather name="chevron-left" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Scopuly</Text>
        <View style={styles.headerBtn} />
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.hero}>
          <Image
            source={SCOPULY}
            style={styles.logo}
            resizeMode="contain"
            accessibilityLabel="Scopuly"
          />
          <Text style={styles.lede}>
            Scopuly keeps its own keys and approves its own requests. This
            wallet does not send your secret key.
          </Text>
        </View>

        <Text style={styles.section}>What Scopuly does that this wallet does not</Text>
        {SCOPULY_FEATURES.map((item) => (
          <View key={item.title} style={styles.row}>
            <Text style={styles.rowTitle}>{item.title}</Text>
            <Text style={styles.rowDetail}>{item.detail}</Text>
          </View>
        ))}

        <TouchableOpacity
          style={styles.linkRow}
          onPress={() => void openWithAddress()}
          testID="scopuly-open-with-address"
          accessibilityRole="button"
          accessibilityLabel="Open Scopuly with my address"
        >
          <Text style={styles.linkText}>Open Scopuly with my address</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.linkRow}
          onPress={() => void Linking.openURL(SCOPULY_X_URL)}
          testID="scopuly-open-x"
          accessibilityRole="link"
          accessibilityLabel="Scopuly on X"
        >
          <Image source={X_LOGO} style={styles.x} resizeMode="contain" />
          <Text style={styles.linkText}>Scopuly on X</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.playHit}
          onPress={() => void openPlay()}
          testID="scopuly-open-play"
          accessibilityRole="link"
          accessibilityLabel="Scopuly on Google Play"
        >
          <Image source={PLAY} style={styles.badge} resizeMode="contain" />
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  headerBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  headerBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center", color: colors.text, fontSize: 16, ...typography.heading },
  body: { padding: spacing.md, paddingBottom: 28, gap: 8 },
  hero: { alignItems: "center", paddingVertical: 8 },
  logo: { width: 48, height: 48, borderRadius: 12, overflow: "hidden" },
  lede: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: "center",
    marginTop: 8,
    lineHeight: 20,
  },
  section: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
    marginTop: 8,
  },
  row: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  rowTitle: { color: colors.text, fontSize: 14, fontWeight: "700" },
  rowDetail: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 6,
  },
  x: { width: 18, height: 16 },
  linkText: { color: colors.text, fontSize: 14, fontWeight: "700" },
  playHit: {
    width: 140,
    height: 54,
    marginTop: 8,
    alignSelf: "flex-start",
  },
  badge: { width: 140, height: 54 },
});
