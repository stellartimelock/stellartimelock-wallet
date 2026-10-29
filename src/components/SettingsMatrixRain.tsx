// Full-screen Matrix rain. Tap anywhere to dismiss.
// Trigger: seven taps on the Settings version row within 3.5 seconds.
//
// Columns are a fixed set of Text nodes. The fall is a native-driver
// translateY loop, so the overlay does not re-render on each frame and
// does not read or write wallet state.

import { useEffect, useRef } from "react";
import {
  Animated,
  Dimensions,
  Easing,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

const MONO = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "monospace",
}) as string;

const GLYPHS =
  "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789";

const COLUMNS = 16;
const TRAIL = 14;
const LINE = 16;

function roll(count: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(GLYPHS[(Math.random() * GLYPHS.length) | 0] ?? "0");
  }
  return out;
}

function RainColumn({
  left,
  width,
  height,
  glyphs,
  duration,
  delay,
}: {
  left: number;
  width: number;
  height: number;
  glyphs: string[];
  duration: number;
  delay: number;
}) {
  const translateY = useRef(new Animated.Value(-TRAIL * LINE)).current;

  useEffect(() => {
    translateY.setValue(-TRAIL * LINE);
    const fall = Animated.loop(
      Animated.timing(translateY, {
        toValue: height + LINE,
        duration,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    const timer = setTimeout(() => fall.start(), delay);
    return () => {
      clearTimeout(timer);
      fall.stop();
    };
  }, [delay, duration, height, translateY]);

  const head = glyphs[0] ?? "0";
  const tail = glyphs.slice(1).join("\n");

  return (
    <Animated.View
      style={[styles.column, { left, width, transform: [{ translateY }] }]}
    >
      <Text style={styles.head}>{head}</Text>
      <Text style={styles.tail}>{tail}</Text>
    </Animated.View>
  );
}

function RainField({
  onDismiss,
}: {
  onDismiss: () => void;
}) {
  const { width, height } = Dimensions.get("window");
  const columnWidth = width / COLUMNS;
  const columns = useRef(
    Array.from({ length: COLUMNS }, () => ({
      glyphs: roll(TRAIL),
      duration: 2800 + Math.floor(Math.random() * 4200),
      delay: Math.floor(Math.random() * 1400),
    })),
  ).current;

  return (
    <TouchableOpacity
      activeOpacity={1}
      style={styles.overlay}
      onPress={onDismiss}
      accessibilityLabel="Dismiss Matrix rain. Tap anywhere."
      accessibilityRole="button"
      testID="matrix-rain-overlay"
    >
      <View style={[styles.bg, { width, height }]}>
        {columns.map((column, index) => (
          <RainColumn
            key={index}
            left={index * columnWidth}
            width={columnWidth}
            height={height}
            glyphs={column.glyphs}
            duration={column.duration}
            delay={column.delay}
          />
        ))}
        <View pointerEvents="none" style={styles.wakeWrap}>
          <Text style={styles.wake} testID="matrix-wake-up">
            Wake up, Neo...
          </Text>
        </View>
        <View pointerEvents="none" style={styles.hint}>
          <Text style={styles.hintLine}>STELLAR TIMELOCK</Text>
          <Text style={styles.hintSub}>TAP ANYWHERE TO EXIT</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

export function SettingsMatrixRain({
  visible,
  onDismiss,
}: {
  visible: boolean;
  onDismiss: () => void;
}) {
  if (!visible) return null;

  return (
    <Modal
      transparent
      animationType="fade"
      visible
      onRequestClose={onDismiss}
      statusBarTranslucent
    >
      <RainField onDismiss={onDismiss} />
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1 },
  bg: { backgroundColor: "#000000", overflow: "hidden" },
  column: { position: "absolute", top: 0 },
  head: {
    color: "#DFFFEF",
    fontSize: 13,
    lineHeight: LINE,
    fontFamily: MONO,
    fontWeight: "700",
    textAlign: "center",
  },
  tail: {
    color: "#00FF41",
    fontSize: 13,
    lineHeight: LINE,
    fontFamily: MONO,
    textAlign: "center",
    opacity: 0.8,
  },
  wakeWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  wake: {
    color: "#DFFFEF",
    fontSize: 28,
    fontFamily: MONO,
    fontWeight: "700",
    letterSpacing: 0.4,
    textAlign: "center",
  },
  hint: {
    position: "absolute",
    bottom: 60,
    left: 0,
    right: 0,
    alignItems: "center",
    gap: 4,
  },
  hintLine: {
    color: "rgba(0,255,65,0.35)",
    fontSize: 14,
    fontFamily: MONO,
    letterSpacing: 4,
    fontWeight: "700",
  },
  hintSub: {
    color: "rgba(0,180,50,0.25)",
    fontSize: 10,
    fontFamily: MONO,
    letterSpacing: 2,
  },
});
