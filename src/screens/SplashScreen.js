import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  ImageBackground,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, spacing } from "@/src/theme";

const BG_IMAGE = require("@/assets/splash.png");

// Glow ring position: percent from bottom of the SafeArea container.
// Authoritative layout (Stellar OS handoff): bottom 9.35% + 125x125 ring.
// Aligns to the FP / clear tap zone on the Jul 29 full-bleed splash art
// (assets/splash.png = copy of assets/images/splash-icon.png, 936x1680).
// Do NOT use the stale RING_BOTTOM_OFFSET = 88 dp from older docs.
const RING_BOTTOM_PCT = "9.35%";
const RING_SIZE = 125;

export default function SplashScreen({ onComplete }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [phrasesComplete, setPhrasesComplete] = useState(false);
  const [pressed, setPressed] = useState(false);

  const phrases = [
    "Securing vaults...",
    "Encrypting keys...",
    "Initializing time-locks...",
    "Syncing blockchain nodes...",
  ];

  const textFade = useRef(new Animated.Value(0)).current;
  const arrowProgress = useRef(new Animated.Value(0)).current;
  const exitOpacity = useRef(new Animated.Value(1)).current;
  const exitScale = useRef(new Animated.Value(1)).current;
  const thumbGlow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let index = 0;
    const timeouts = [];
    let pulseStarted = false;

    const interval = setInterval(() => {
      if (index < phrases.length) {
        Animated.timing(textFade, {
          toValue: 1,
          duration: 100,
          useNativeDriver: true,
        }).start();

        Animated.timing(arrowProgress, {
          toValue: (index + 1) / phrases.length,
          duration: 1000,
          easing: Easing.out(Easing.ease),
          useNativeDriver: false,
        }).start();

        const fadeOutId = setTimeout(() => {
          Animated.timing(textFade, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }).start();
        }, 1000);
        timeouts.push(fadeOutId);

        setCurrentIndex(index);
        index++;

        // Glow starts fading in during the 4th text
        if (index === phrases.length) {
          Animated.timing(thumbGlow, {
            toValue: 1,
            duration: 500,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }).start();
        }
      } else {
        clearInterval(interval);
        setPhrasesComplete(true);

        if (!pulseStarted) {
          pulseStarted = true;
          const pulseId = setTimeout(() => {
            Animated.loop(
              Animated.sequence([
                Animated.timing(thumbGlow, {
                  toValue: 0.6,
                  duration: 1000,
                  easing: Easing.inOut(Easing.ease),
                  useNativeDriver: true,
                }),
                Animated.timing(thumbGlow, {
                  toValue: 1,
                  duration: 1000,
                  easing: Easing.inOut(Easing.ease),
                  useNativeDriver: true,
                }),
              ])
            ).start();
          }, 500);
          timeouts.push(pulseId);
        }
      }
    }, 1500);

    return () => {
      clearInterval(interval);
      timeouts.forEach(clearTimeout);
      textFade.stopAnimation();
      arrowProgress.stopAnimation();
      thumbGlow.stopAnimation();
      exitOpacity.stopAnimation();
      exitScale.stopAnimation();
    };
  }, []);

  // Decorative tap only — no hardware biometric APIs in this screen.
  const handleTap = () => {
    if (pressed || !phrasesComplete) return;
    setPressed(true);

    Animated.parallel([
      Animated.timing(exitOpacity, {
        toValue: 0,
        duration: 500,
        useNativeDriver: true,
      }),
      Animated.timing(exitScale, {
        toValue: 1.05,
        duration: 500,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished && onComplete) onComplete();
    });
  };

  return (
    <Animated.View
      style={[
        styles.root,
        { opacity: exitOpacity, transform: [{ scale: exitScale }] },
      ]}
    >
      <ImageBackground source={BG_IMAGE} style={styles.background} resizeMode="cover">
        <SafeAreaView style={styles.container}>
          {/* Cycling status phrases */}
          <Animated.Text style={[styles.overlayText, { opacity: textFade }]}>
            {phrases[currentIndex] || ""}
          </Animated.Text>

          {/* Hollow chevron progress — horizontal, 8 chevrons */}
          <View style={styles.arrowContainer}>
            {Array.from({ length: 8 }).map((_, i) => {
              const start = i / 8;
              const end = (i + 1) / 8;
              return (
                <Animated.View
                  key={i}
                  style={[
                    styles.hollowChevronWrapper,
                    {
                      opacity: arrowProgress.interpolate({
                        inputRange: [start, end],
                        outputRange: [0.15, 1],
                        extrapolate: "clamp",
                      }),
                    },
                  ]}
                >
                  <View style={styles.hollowChevron} />
                </Animated.View>
              );
            })}
          </View>

          {/* Tappable glow ring — only after phrase sequence completes */}
          {phrasesComplete && (
            <TouchableOpacity
              onPress={handleTap}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Continue"
              style={styles.glowHitTarget}
            >
              <Animated.View
                style={[
                  styles.thumbGlowRing,
                  {
                    opacity: thumbGlow,
                    transform: [
                      {
                        scale: thumbGlow.interpolate({
                          inputRange: [0.6, 1],
                          outputRange: [1, 1.04],
                        }),
                      },
                    ],
                  },
                ]}
              />
            </TouchableOpacity>
          )}

          <Text style={styles.footer}>
            Your Stellar secret seed never leaves this device.
          </Text>
        </SafeAreaView>
      </ImageBackground>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  background: {
    flex: 1,
    width: "100%",
  },
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  overlayText: {
    position: "absolute",
    bottom: "42%",
    color: "#A3D4FF",
    fontSize: 18,
    fontWeight: "400",
    letterSpacing: 1.5,
    textAlign: "center",
    textShadowColor: "rgba(0, 183, 255, 0.4)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  arrowContainer: {
    position: "absolute",
    bottom: "29%",
    width: "60%",
    flexDirection: "row",
    justifyContent: "space-evenly",
    alignItems: "center",
  },
  hollowChevronWrapper: {
    width: 16,
    height: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  hollowChevron: {
    width: 12,
    height: 12,
    borderTopWidth: 2,
    borderRightWidth: 2,
    borderColor: "#00D4FF",
    transform: [{ rotate: "45deg" }],
    backgroundColor: "transparent",
    shadowColor: "#00D4FF",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 6,
  },
  glowHitTarget: {
    position: "absolute",
    bottom: RING_BOTTOM_PCT,
    alignSelf: "center",
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    justifyContent: "center",
    alignItems: "center",
  },
  thumbGlowRing: {
    position: "absolute",
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    borderWidth: 2,
    borderColor: "#00D4FF",
    shadowColor: "#00D4FF",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 15,
    elevation: 8,
    backgroundColor: "transparent",
  },
  footer: {
    position: "absolute",
    bottom: spacing.lg,
    color: "#6A85A8",
    fontSize: 12,
    textAlign: "center",
    fontFamily: "monospace",
    letterSpacing: 1,
    paddingHorizontal: spacing.xl,
  },
});
