import { Feather } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, radii, spacing, typography } from "@/src/theme";
import { shadow } from "@/src/theme/shadow";
import {
  methodLabel,
  subscribeReceipts,
  type TxReceipt,
  type TxStatus,
} from "@/src/api/tx-receipts";

const VISIBLE_MS = 6000;
const ANIM_MS = 220;

export function TxReceiptBanner() {
  const insets = useSafeAreaInsets();
  const [receipt, setReceipt] = useState<TxReceipt | null>(null);
  const [rechecking, setRechecking] = useState(false);
  const translateY = useRef(new Animated.Value(120)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsub = subscribeReceipts((r) => setReceipt(r));
    return unsub;
  }, []);

  useEffect(() => {
    if (!receipt) return;
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: 0,
        duration: ANIM_MS,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: ANIM_MS,
        useNativeDriver: true,
      }),
    ]).start();
    if (dismissTimer.current) {
      clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
    }
    if (receipt.status !== "pending") {
      dismissTimer.current = setTimeout(() => dismiss(), VISIBLE_MS);
    }
    return () => {
      if (dismissTimer.current) {
        clearTimeout(dismissTimer.current);
        dismissTimer.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt]);

  const dismiss = () => {
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: 120,
        duration: ANIM_MS,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: ANIM_MS,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setReceipt(null);
      setRechecking(false);
    });
  };

  const openExplorer = () => {
    if (!receipt) return;
    Linking.openURL(receipt.explorerUrl).catch(() => {});
  };

  const onRecheck = async () => {
    if (!receipt || rechecking) return;
    setRechecking(true);
    try {
      const { recheckTransaction } = await import("@/src/api/soroban-client");
      const res = await recheckTransaction(receipt.method, receipt.txHash);
      if (res.status === "pending") {
        setReceipt({ ...receipt, status: "pending", emittedAt: Date.now() });
      }
    } catch {
      /* stay pending — user can tap Recheck again */
    } finally {
      setRechecking(false);
    }
  };

  if (!receipt) return null;

  const tone = TONE[receipt.status];

  return (
    <Animated.View
      testID="tx-receipt-banner"
      style={[
        styles.wrap,
        {
          bottom: insets.bottom + 80,
          opacity,
          transform: [{ translateY }],
          pointerEvents: "box-none",
        },
      ]}
    >
      <Animated.View style={[styles.card, { borderColor: tone.border }]}>
        <Animated.View style={[styles.iconWrap, { backgroundColor: tone.bg }]}>
          {receipt.status === "pending" ? (
            <ActivityIndicator size="small" color={tone.iconColor} />
          ) : (
            <Feather
              name={tone.icon}
              size={18}
              color={tone.iconColor}
              testID="tx-receipt-icon"
            />
          )}
        </Animated.View>
        <Animated.View style={{ flex: 1 }}>
          <Text style={styles.title}>
            {methodLabel(receipt.method, receipt.status)}
          </Text>
          <Text style={styles.sub} numberOfLines={1}>
            {receipt.status === "success" && receipt.ledger != null
              ? `On-chain · ledger ${receipt.ledger.toLocaleString()} · ${shortHash(receipt.txHash)}`
              : receipt.status === "pending"
              ? `Tx ${shortHash(receipt.txHash)} · not yet confirmed`
              : `Tx ${shortHash(receipt.txHash)}`}
          </Text>
        </Animated.View>
        {receipt.status === "pending" ? (
          <TouchableOpacity
            onPress={onRecheck}
            style={[styles.link, { opacity: rechecking ? 0.5 : 1 }]}
            disabled={rechecking}
            testID="tx-receipt-recheck"
            hitSlop={8}
          >
            <Feather name="refresh-cw" size={14} color={tone.iconColor} />
            <Text style={[styles.linkText, { color: tone.iconColor }]}>
              {rechecking ? "…" : "Recheck"}
            </Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={openExplorer}
            style={styles.link}
            testID="tx-receipt-explorer"
            hitSlop={8}
          >
            <Feather name="external-link" size={14} color={colors.cyan} />
            <Text style={styles.linkText}>Explorer</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          onPress={dismiss}
          style={styles.close}
          testID="tx-receipt-close"
          hitSlop={8}
        >
          <Feather name="x" size={16} color={colors.textTertiary} />
        </TouchableOpacity>
      </Animated.View>
    </Animated.View>
  );
}

function shortHash(h: string): string {
  if (h.length <= 14) return h;
  return `${h.slice(0, 6)}…${h.slice(-6)}`;
}

const TONE: Record<
  TxStatus,
  {
    icon: "check-circle" | "alert-circle" | "clock";
    iconColor: string;
    border: string;
    bg: string;
  }
> = {
  success: {
    icon: "check-circle",
    iconColor: colors.statusActive,
    border: colors.cyan,
    bg: colors.cyanMuted,
  },
  pending: {
    icon: "clock",
    iconColor: colors.gold,
    border: colors.gold,
    bg: colors.goldMuted,
  },
  failed: {
    icon: "alert-circle",
    iconColor: colors.danger,
    border: colors.danger,
    bg: colors.dangerMuted,
  },
};

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    zIndex: 9998,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    ...shadow({ opacity: 0.45, radius: 14, offsetY: 8, elevation: 14 }),
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { color: colors.text, fontSize: 13, fontWeight: "700" },
  sub: { color: colors.textSecondary, fontSize: 11, marginTop: 2, ...typography.mono },
  link: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  linkText: { color: colors.cyan, fontSize: 12, fontWeight: "600" },
  close: { padding: 4 },
});
