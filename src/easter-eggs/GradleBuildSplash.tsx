import React, { useEffect, useRef, useState } from "react";
import { Animated, Platform, ScrollView, StyleSheet, Text, View } from "react-native";

import { useGradleEasterEgg } from "@/src/easter-eggs/gradle-easter-egg";

const MONO = Platform.select({
  ios: "Courier",
  android: "monospace",
  default: "monospace",
});

interface TerminalLine {
  text: string;
  delay: number;
}

const LINES: TerminalLine[] = [
  { text: "> export ANDROID_HOME=/opt/android-sdk", delay: 90 },
  { text: "> export JAVA_HOME=/usr/lib/jvm/java-17-openjdk", delay: 70 },
  { text: "> export ANDROID_SDK_ROOT=/opt/android-sdk", delay: 60 },
  { text: '> export GRADLE_OPTS="-Xmx4096m -XX:+HeapDumpOnOutOfMemoryError"', delay: 80 },
  { text: "> export ANDROID_NDK_HOME=/opt/android-sdk/ndk/26.1.10909125", delay: 70 },
  { text: "> export ORG_GRADLE_PROJECT_hermesEnabled=true", delay: 60 },
  { text: "> export ORG_GRADLE_PROJECT_newArchEnabled=true", delay: 60 },
  { text: "", delay: 100 },

  { text: "> Configure project :react-native-reanimated", delay: 110 },
  { text: "> Configure project :react-native-gesture-handler", delay: 90 },
  { text: "> Configure project :react-native-screens", delay: 90 },
  { text: "> Configure project :react-native-safe-area-context", delay: 80 },
  { text: "> Configure project :react-native-mmkv", delay: 80 },
  { text: "> Configure project :react-native-svg", delay: 70 },
  { text: "> Configure project :expo-secure-store", delay: 70 },
  { text: "> Configure project :expo", delay: 60 },
  { text: "> Configure project :expo-modules-core", delay: 60 },
  { text: "> Configure project :app", delay: 100 },
  { text: "", delay: 100 },

  { text: "> Task :app:preBuild UP-TO-DATE", delay: 80 },
  { text: "> Task :app:preReleaseBuild UP-TO-DATE", delay: 70 },
  { text: "> Task :react-native-reanimated:compileReleaseKotlin   [12%]", delay: 110 },
  { text: "> Task :react-native-gesture-handler:compileReleaseKotlin  [18%]", delay: 100 },
  { text: "> Task :app:processReleaseMainManifest     [24%]", delay: 95 },
  { text: "> Task :app:processReleaseManifest           [28%]", delay: 85 },
  { text: "> Task :app:processReleaseManifestForPackage   [32%]", delay: 85 },
  { text: "> Task :react-native-screens:compileReleaseKotlin  [38%]", delay: 100 },
  { text: "> Task :react-native-safe-area-context:compileReleaseKotlin  [44%]", delay: 100 },
  { text: "> Task :app:compileReleaseKotlin         [52%]", delay: 115 },
  { text: "> Task :app:compileReleaseJavaWithJavac      [60%]", delay: 125 },
  { text: "> Task :app:mergeReleaseResources          [68%]", delay: 110 },
  { text: "> Task :app:dexBuilderRelease              [75%]", delay: 105 },
  { text: "> Task :app:mergeReleaseNativeLibs         [83%]", delay: 105 },
  { text: "> Task :app:stripReleaseDebugSymbols       [91%]", delay: 105 },
  { text: "> Task :app:packageRelease                 [97%]", delay: 110 },
  { text: "> Task :app:assembleRelease               [100%]", delay: 120 },
  { text: "", delay: 100 },

  { text: "BUILD SUCCESSFUL in 4.5s", delay: 150 },
  { text: "281 actionable tasks: 281 executed", delay: 100 },
];

const HOLD_AFTER_SUCCESS_MS = 200;
const FADE_OUT_DURATION_MS = 300;

interface Props {
  visible: boolean;
  onComplete: () => void;
}

export function GradleBuildSplash({ visible, onComplete }: Props) {
  const active = useGradleEasterEgg();
  const [linesShown, setLinesShown] = useState(0);
  const [finished, setFinished] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (!visible || !active) return;

    // Reset state
    setLinesShown(0);
    setFinished(false);
    fadeAnim.setValue(1);
    timers.current.forEach(clearTimeout);
    timers.current = [];

    let cumulativeDelay = 250; // brief pause before first line

    LINES.forEach((line, index) => {
      const timer = setTimeout(() => {
        setLinesShown((prev) => {
          const next = index + 1;
          if (next >= LINES.length) {
            // Hold on BUILD SUCCESSFUL, then fade out
            const fadeTimer = setTimeout(() => {
              Animated.timing(fadeAnim, {
                toValue: 0,
                duration: FADE_OUT_DURATION_MS,
                useNativeDriver: true,
              }).start(() => {
                setFinished(true);
                onComplete();
              });
            }, HOLD_AFTER_SUCCESS_MS);
            timers.current.push(fadeTimer);
          }
          return next;
        });
      }, cumulativeDelay);
      timers.current.push(timer);
      cumulativeDelay += line.delay || 100;
    });

    return () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
  }, [visible, active, onComplete, fadeAnim]);

  // Auto-scroll to bottom as new lines appear
  useEffect(() => {
    if (scrollRef.current) {
      const t = setTimeout(() => {
        scrollRef.current?.scrollToEnd?.({ animated: true });
      }, 16);
      return () => clearTimeout(t);
    }
  }, [linesShown]);

  if (!visible || !active || finished) return null;

  const visibleLines = LINES.slice(0, linesShown);
  const isComplete = linesShown >= LINES.length;

  return (
    <Animated.View
      style={[styles.root, { opacity: fadeAnim }]}
      pointerEvents="none"
      testID="gradle-build-splash"
    >
      <ScrollView
        ref={scrollRef}
        style={styles.terminal}
        contentContainerStyle={styles.terminalInner}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {visibleLines.map((line, i) => {
          if (line.text.trim() === "") {
            return <View key={i} style={styles.emptyLine} />;
          }

          const isSuccess = line.text.startsWith("BUILD SUCCESSFUL");
          const isTasksExecuted = /^\d+ actionable/.test(line.text);
          const isEnv = line.text.startsWith("> export");
          const isConfig = line.text.startsWith("> Configure");
          const hasPct = /\[\d+%\]/.test(line.text);

          return (
            <Text
              key={i}
              style={[
                styles.line,
                isSuccess && styles.success,
                isTasksExecuted && styles.actionable,
                isEnv && styles.env,
                isConfig && styles.config,
                hasPct && styles.pctLine,
              ]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {line.text}
            </Text>
          );
        })}

        {/* Blinking block cursor while building */}
        {!isComplete && linesShown > 0 && (
          <Text style={styles.cursor}>▌</Text>
        )}
      </ScrollView>

      {/* Subtle dev-watermark in bottom-right */}
      <Text style={styles.watermark}>Stellar TimeLock · dev mode</Text>
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
    paddingTop: 56,
    paddingBottom: 28,
  },
  terminalInner: {
    flexGrow: 1,
    justifyContent: "flex-end",
  },
  emptyLine: { height: 4 },
  line: {
    fontFamily: MONO,
    fontSize: 11,
    lineHeight: 17,
    color: "#00E676",
    opacity: 0.88,
  },
  env: {
    color: "#88C0D0",
    opacity: 0.85,
  },
  config: {
    color: "#FFEE58",
    opacity: 0.85,
  },
  pctLine: {
    color: "#69F0AE",
    opacity: 0.92,
  },
  success: {
    fontSize: 12.5,
    lineHeight: 18,
    color: "#69F0AE",
    fontWeight: "800",
    letterSpacing: 0.5,
    marginTop: 4,
  },
  actionable: {
    color: "#A7F3D0",
    opacity: 0.75,
  },
  cursor: {
    fontFamily: MONO,
    fontSize: 11,
    color: "#00E676",
    opacity: 0.7,
    marginTop: 2,
  },
  watermark: {
    position: "absolute",
    bottom: 10,
    right: 14,
    fontFamily: MONO,
    fontSize: 9,
    color: "rgba(0,230,118,0.18)",
    letterSpacing: 0.3,
  },
});