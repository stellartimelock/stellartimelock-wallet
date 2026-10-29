import { Feather } from "@expo/vector-icons";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Animated, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, radii, spacing } from "@/src/theme";
import { shadow } from "@/src/theme/shadow";

type ToastKind = "success" | "error" | "info";

export interface ToastAction {
  label: string;
  onPress: () => void;
}

interface ToastItem {
  id: number;
  message: string;
  /** Optional italic subtitle rendered on a second line below the main message. */
  subtitle?: string;
  kind: ToastKind;
  action?: ToastAction;
  durationMs: number;
}

interface ToastCtx {
  show: (
    message: string,
    kind?: ToastKind,
    options?: { action?: ToastAction; durationMs?: number; subtitle?: string },
  ) => void;
}

const Ctx = createContext<ToastCtx | null>(null);

const DEFAULT_MS = 2400;
const ACTION_MS = 7000; // Longer than default so user can tap the action chip.

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [item, setItem] = useState<ToastItem | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();
  const idRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    Animated.timing(opacity, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => setItem(null));
  }, [opacity]);

  const show = useCallback<ToastCtx["show"]>(
    (message, kind = "info", options) => {
      idRef.current += 1;
      const durationMs =
        options?.durationMs ??
        (options?.action ? ACTION_MS : DEFAULT_MS);
      setItem({
        id: idRef.current,
        message,
        subtitle: options?.subtitle,
        kind,
        action: options?.action,
        durationMs,
      });
    },
    [],
  );

  useEffect(() => {
    if (!item) return;
    Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(dismiss, item.durationMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [item, opacity, dismiss]);

  const tone = item ? toneStyles[item.kind] : toneStyles.info;
  const value = useMemo(() => ({ show }), [show]);

  const handleAction = () => {
    if (!item?.action) return;
    const fn = item.action.onPress;
    dismiss();
    // Defer so dismiss animation starts before caller re-shows a toast.
    setTimeout(fn, 50);
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      {item ? (
        <Animated.View
          testID="app-toast"
          style={[
            styles.toast,
            {
              top: insets.top + 12,
              opacity,
              borderColor: tone.border,
              pointerEvents: item.action ? "box-none" : "none",
            },
          ]}
        >
          <Feather name={tone.icon} size={18} color={tone.iconColor} />
          <View style={styles.textCol}>
            <Text style={styles.text} numberOfLines={3}>
              {item.message}
            </Text>
            {item.subtitle ? (
              <Text style={styles.subtitle} numberOfLines={2}>
                {item.subtitle}
              </Text>
            ) : null}
          </View>
          {item.action ? (
            <TouchableOpacity
              testID="app-toast-action"
              onPress={handleAction}
              activeOpacity={0.8}
              style={[styles.actionBtn, { borderColor: tone.border }]}
              hitSlop={8}
            >
              <Text style={[styles.actionText, { color: tone.iconColor }]}>
                {item.action.label}
              </Text>
            </TouchableOpacity>
          ) : null}
        </Animated.View>
      ) : null}
    </Ctx.Provider>
  );
}

export function useToast(): ToastCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useToast must be used within ToastProvider");
  return v;
}

const toneStyles = {
  success: { icon: "check-circle" as const, iconColor: colors.statusActive, border: colors.cyan },
  error: { icon: "alert-triangle" as const, iconColor: colors.danger, border: colors.danger },
  info: { icon: "info" as const, iconColor: colors.cyan, border: colors.cyan },
};

const styles = StyleSheet.create({
  toast: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    backgroundColor: colors.surfaceFrost,
    borderRadius: radii.md,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    zIndex: 9999,
    ...shadow({ opacity: 0.4, radius: 12, offsetY: 6, elevation: 12 }),
  },
  text: { color: colors.text, fontSize: 13, fontWeight: "500" },
  textCol: { flex: 1, gap: 2 },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 12,
    fontStyle: "italic",
    fontWeight: "500",
  },
  actionBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.sm,
    borderWidth: 1,
  },
  actionText: { fontSize: 12, fontWeight: "700", letterSpacing: 0.4 },
});
