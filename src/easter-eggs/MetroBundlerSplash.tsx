import React, { useEffect, useRef, useState } from "react";
import { Animated, Platform, StyleSheet, Text, View } from "react-native";

const MONO = Platform.select({
  ios: "Courier",
  android: "monospace",
  default: "monospace",
});

type Segment = { text: string; color?: string; bold?: boolean };
interface BundlerLine {
  segments: Segment[];
  delayBeforeMs: number;
}

const PLATFORM_COLOR = "#B57EDC";  // muted magenta — mimics Metro's "Android" tag
const BUNDLE_COLOR = "#E5E5E5";    // near-white for path + progress bar
const META_COLOR = "#9CA3AF";      // dim gray for percentages / counts
const SUCCESS_COLOR = "#00E676";   // vivid green for BUILD SUCCESSFUL
const SUCCESS_META = "#69F0AE";    // softer green for "in 5s"

const INITIAL_DELAY_MS = 300;
const HOLD_AFTER_SUCCESS_MS = 600;
const FADE_OUT_DURATION_MS = 300;

const LINES: BundlerLine[] = [
  {
    delayBeforeMs: 0,
    segments: [
      { text: "Android ", color: PLATFORM_COLOR },
      { text: "./index.js ", color: BUNDLE_COLOR },
      { text: "▓▓░░░░░░░░░░░░░░ ", color: BUNDLE_COLOR },
      { text: "17.7% ", color: META_COLOR },
      { text: "( 51/247)", color: META_COLOR },
    ],
  },
  {
    delayBeforeMs: 900,
    segments: [
      { text: "Android ", color: PLATFORM_COLOR },
      { text: "./index.js ", color: BUNDLE_COLOR },
      { text: "▓▓▓▓░░░░░░░░░░░ ", color: BUNDLE_COLOR },
      { text: "33.3% ", color: META_COLOR },
      { text: "(499/865)", color: META_COLOR },
    ],
  },
  {
    delayBeforeMs: 900,
    segments: [
      { text: "Android ", color: PLATFORM_COLOR },
      { text: "./index.js ", color: BUNDLE_COLOR },
      { text: "▓▓▓▓▓▓▓▓▓░░░░░░░ ", color: BUNDLE_COLOR },
      { text: "56.3% ", color: META_COLOR },
      { text: "( 961/1290)", color: META_COLOR },
    ],
  },
  {
    delayBeforeMs: 900,
    segments: [
      { text: "Android ", color: PLATFORM_COLOR },
      { text: "./index.js ", color: BUNDLE_COLOR },
      { text: "▓▓▓▓▓▓▓▓▓▓▓▓▓░░░ ", color: BUNDLE_COLOR },
      { text: "86.9% ", color: META_COLOR },
      { text: "(1801/1944)", color: META_COLOR },
    ],
  },
  {
    delayBeforeMs: 900,
    segments: [
      { text: "Android ", color: PLATFORM_COLOR },
      { text: "./index.js ", color: BUNDLE_COLOR },
      { text: "▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░ ", color: BUNDLE_COLOR },
      { text: "99.9% ", color: META_COLOR },
      { text: "(2391/2391)", color: META_COLOR },
    ],
  },

  {
    delayBeforeMs: 800,
    segments: [
      { text: "Android ", color: PLATFORM_COLOR },
      { text: "Bundled ", color: BUNDLE_COLOR },
      { text: "95151ms ", color: META_COLOR },
      { text: "index.js ", color: BUNDLE_COLOR },
      { text: "(2391 modules)", color: META_COLOR },
    ],
  },
  {
    delayBeforeMs: 700,
    segments: [
      { text: "Android ", color: PLATFORM_COLOR },
      { text: "./index.js ", color: BUNDLE_COLOR },
      { text: "▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░ ", color: BUNDLE_COLOR },
      { text: "99.9% ", color: META_COLOR },
      { text: "(2391/2391)", color: META_COLOR },
    ],
  },
  {
    delayBeforeMs: 700,
    segments: [
      { text: "BUILD SUCCESSFUL", color: SUCCESS_COLOR, bold: true },
      { text: " in 5s", color: SUCCESS_META },
    ],
  },
];

interface Props {
  visible: boolean;
  onComplete: () => void;
}

export function MetroBundlerSplash({ visible, onComplete }: Props) {
  const [linesShown, setLinesShown] = useState(0);
  const [finished, setFinished] = useState(false);
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const cursorAnim = useRef(new Animated.Value(1)).current;
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (!visible) return;

    setLinesShown(0);
    setFinished(false);
    fadeAnim.setValue(1);
    timers.current.forEach(clearTimeout);
    timers.current = [];

    let cumulative = INITIAL_DELAY_MS;
    LINES.forEach((line, index) => {
      cumulative += line.delayBeforeMs;
      const t = setTimeout(() => {
        setLinesShown(index + 1);
        if (index === LINES.length - 1) {
          // Last line just rendered — hold on BUILD SUCCESSFUL,
          // then fade the overlay out and hand off to the docs.
          const fadeT = setTimeout(() => {
            Animated.timing(fadeAnim, {
              toValue: 0,
              duration: FADE_OUT_DURATION_MS,
              useNativeDriver: true,
            }).start(() => {
              setFinished(true);
              onComplete();
            });
          }, HOLD_AFTER_SUCCESS_MS);
          timers.current.push(fadeT);
        }
      }, cumulative);
      timers.current.push(t);
    });

    return () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
  }, [visible, onComplete, fadeAnim]);

  // Blinking-cursor loop while lines are still streaming in.
  useEffect(() => {
    if (!visible || finished) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(cursorAnim, {
          toValue: 0,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(cursorAnim, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [visible, finished, cursorAnim]);

  if (!visible || finished) return null;

  const visibleLines = LINES.slice(0, linesShown);
  const isComplete = linesShown >= LINES.length;

  return (
    <Animated.View
      style={[styles.root, { opacity: fadeAnim }]}
      pointerEvents="none"
      testID="metro-bundler-splash"
    >
      <View style={styles.terminal}>
        {visibleLines.map((line, i) => (
          <Text
            key={i}
            style={styles.line}
            numberOfLines={1}
            ellipsizeMode="clip"
          >
            {line.segments.map((seg, j) => (
              <Text
                key={j}
                style={[
                  { color: seg.color ?? BUNDLE_COLOR },
                  seg.bold && styles.bold,
                ]}
              >
                {seg.text}
              </Text>
            ))}
          </Text>
        ))}

        {!isComplete && (
          <Animated.Text style={[styles.cursor, { opacity: cursorAnim }]}>
            ▌
          </Animated.Text>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#0C0C0C",
    zIndex: 10000,
    elevation: 10000,
  },
  terminal: {
    flex: 1,
    paddingHorizontal: 14,
    paddingTop: 64,
    paddingBottom: 28,
    justifyContent: "flex-start",
  },
  line: {
    fontFamily: MONO,
    fontSize: 11,
    lineHeight: 18,
    color: BUNDLE_COLOR,
  },
  bold: {
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  cursor: {
    fontFamily: MONO,
    fontSize: 11,
    lineHeight: 18,
    color: BUNDLE_COLOR,
    marginTop: 2,
  },
});
