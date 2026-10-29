// Full-screen digital rain easter egg — returns null when hidden.

import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Easing,
  StyleSheet,
  Text,
  View,
} from "react-native";

const GLYPHS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ<>*/+-=?!$";

const WAKE_UP_TEXT = "Wake up, Neo…";

const COLUMN_COUNT = 34;
const RAIN_TOTAL_MS = 5000;
const MAX_TRAIL = 26;
const MIN_TRAIL = 6;

interface MatrixRainProps {
  visible: boolean;
  onDone: () => void;
}

// Per-column parameter bag — randomised once per animation cycle.
interface ColumnParams {
  /** Number of glyphs in this trail (density/height signal). */
  length: number;
  /** Fall duration in ms — spread wide so speeds visibly differ. */
  duration: number;
  /** Milliseconds to delay before drop starts. */
  delay: number;
  /** ±px jitter added to the column's x-position within its slot. */
  xJitter: number;
  /** 0 → 1 random brightness bias for this column's leader glyph. */
  headBias: number;
  /**
   * ms between glyph re-rolls for this column. Different per-column
   * cadence means the rain doesn't strobe in unison.
   */
  reshuffleMs: number;
  /**
   * True in a random ~1 in 6 columns — these get an extra-bright
   * accent glyph somewhere in their trail so the eye catches
   * "sparkles" as the rain falls.
   */
  hasAccent: boolean;
  /** Row index of the accent glyph if `hasAccent`. */
  accentRow: number;
  /**
   * Font size for this column — 13-17 px. Small variance so all
   * columns still align vertically but the eye can't spot a grid.
   */
  fontSize: number;
}

function randColumnParams(): ColumnParams {
  const length = Math.floor(MIN_TRAIL + Math.random() * (MAX_TRAIL - MIN_TRAIL));
  const duration = 2600 + Math.floor(Math.random() * 3200); // 2.6-5.8s
  const delay = Math.floor(Math.random() * 1600); // 0-1.6s
  const xJitter = (Math.random() - 0.5) * 8; // ±4px
  const headBias = Math.random(); // 0-1
  const reshuffleMs = 220 + Math.floor(Math.random() * 320); // 220-540ms
  const hasAccent = Math.random() < 0.18;
  const accentRow = Math.floor(Math.random() * length);
  const fontSize = 13 + Math.floor(Math.random() * 5); // 13-17
  return {
    length,
    duration,
    delay,
    xJitter,
    headBias,
    reshuffleMs,
    hasAccent,
    accentRow,
    fontSize,
  };
}

export function MatrixRain({ visible, onDone }: MatrixRainProps) {
  const [{ w, h }, setDims] = useState(() => {
    const d = Dimensions.get("window");
    return { w: d.width, h: d.height };
  });
  useEffect(() => {
    const sub = Dimensions.addEventListener("change", ({ window }) => {
      setDims({ w: window.width, h: window.height });
    });
    return () => sub?.remove();
  }, []);

  // Persistent Animated.Values — one per column. Kept in a ref so
  // React reconciler doesn't recreate them on every state change.
  const drops = useRef<Animated.Value[]>(
    Array.from({ length: COLUMN_COUNT }, () => new Animated.Value(0)),
  ).current;

  // Per-column params — regenerated ONLY on each fresh visibility
  // toggle (see the visible-driven useEffect below), NOT on every
  // shuffle. This keeps a column's identity (its length + speed)
  // stable across the animation while its glyph contents keep
  // re-rolling.
  const paramsRef = useRef<ColumnParams[]>(
    Array.from({ length: COLUMN_COUNT }, randColumnParams),
  );

  // Per-column glyph strings. `seedTick` bumps whenever ANY column
  // re-rolls; we use per-column reshuffle timers so each column ticks
  // at its own cadence, but state is centralised.
  const [glyphMatrix, setGlyphMatrix] = useState<string[][]>(() =>
    paramsRef.current.map((p) => rollGlyphs(p.length)),
  );

  // "Wake up, Neo…" typewriter progress (0 → WAKE_UP_TEXT.length).
  const [typed, setTyped] = useState(0);

  useEffect(() => {
    if (!visible) return;

    // Fresh identity for every activation — no two rain sessions
    // will look identical.
    paramsRef.current = Array.from({ length: COLUMN_COUNT }, randColumnParams);
    setGlyphMatrix(paramsRef.current.map((p) => rollGlyphs(p.length)));
    setTyped(0);

    // Drop animations — each column gets its OWN Animated.timing with its OWN duration + delay.
    drops.forEach((v, i) => {
      const p = paramsRef.current[i];
      v.setValue(0);
      Animated.timing(v, {
        toValue: 1,
        duration: p.duration,
        delay: p.delay,
        easing: Easing.linear,
        useNativeDriver: true,
      }).start();
    });

    // Per-column glyph reshuffle — each column has its own cadence.
    const shuffleTimers: ReturnType<typeof setInterval>[] = [];
    for (let ci = 0; ci < COLUMN_COUNT; ci += 1) {
      const p = paramsRef.current[ci];
      const t = setInterval(() => {
        setGlyphMatrix((prev) => {
          const next = prev.slice();
          next[ci] = rollGlyphs(p.length);
          return next;
        });
      }, p.reshuffleMs);
      shuffleTimers.push(t);
    }

    // Typewriter for "Wake up, Neo…" — ~130ms per char.
    const typeTimer = setInterval(() => {
      setTyped((n) => {
        if (n >= WAKE_UP_TEXT.length) {
          clearInterval(typeTimer);
          return n;
        }
        return n + 1;
      });
    }, 130);

    // Auto-dismiss after the rain animation completes + a beat.
    // We use the fixed RAIN_TOTAL_MS + margin because the slowest
    // column completes at ~5.8s + 1.6s delay = 7.4s in the worst
    // case; capping the visible duration at 5.6s keeps the easter
    // egg from overstaying its welcome — the slower drops are
    // simply cut mid-fall, which reads as "the Matrix flickered
    // off before every drop reached the ground" and reinforces
    // the chaos.
    const dismissTimer = setTimeout(() => {
      onDone();
    }, RAIN_TOTAL_MS + 600);

    return () => {
      shuffleTimers.forEach(clearInterval);
      clearInterval(typeTimer);
      clearTimeout(dismissTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!visible) return null;

  const columnWidth = w / COLUMN_COUNT;
  const dropHeight = h * 1.5; // fall past the bottom by 50%

  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, styles.root]}
      testID="matrix-rain-overlay"
    >
      {glyphMatrix.map((chars, ci) => {
        const p = paramsRef.current[ci];
        // Each column's translateY range is proportional to its trail
        // length — longer trails travel farther so their heads reach
        // the same visual "screen bottom" while their tails linger
        // further up. Combined with per-column duration this gives
        // the classic depth-of-field effect from the films.
        const travel = dropHeight + p.length * 20;
        return (
          <Animated.View
            key={ci}
            style={[
              styles.column,
              {
                left: ci * columnWidth + p.xJitter,
                width: columnWidth,
                transform: [
                  {
                    translateY: drops[ci].interpolate({
                      inputRange: [0, 1],
                      outputRange: [-p.length * 22, travel * 0.55],
                    }),
                  },
                ],
              },
            ]}
          >
            {chars.map((ch, ri) => {
              // Brightness tiers:
              //   ri === 0                     → HEAD    (mostly-white leader)
              //   ri === p.accentRow (accent)  → ACCENT  (extra-bright teal-green)
              //   ri < 3                       → BRIGHT
              //   ri < p.length - 4            → BODY
              //   else                         → FADE   (bottom of trail)
              const isHead = ri === 0;
              const isAccent = p.hasAccent && ri === p.accentRow && !isHead;
              const isBright = !isHead && !isAccent && ri < 3;
              const isFade = !isHead && !isAccent && ri > p.length - 4;
              return (
                <Text
                  key={ri}
                  style={[
                    styles.glyph,
                    { fontSize: p.fontSize, lineHeight: p.fontSize + 3 },
                    isHead && styles.glyphHead,
                    isHead &&
                      p.headBias > 0.7 && styles.glyphHeadBright,
                    isAccent && styles.glyphAccent,
                    isBright && styles.glyphBright,
                    isFade && styles.glyphFade,
                  ]}
                >
                  {ch}
                </Text>
              );
            })}
          </Animated.View>
        );
      })}

      <View style={styles.wakeUpWrap}>
        <Text style={styles.wakeUpText}>
          {WAKE_UP_TEXT.slice(0, typed)}
          <Text style={styles.caret}>_</Text>
        </Text>
      </View>
    </View>
  );
}

function rollGlyphs(n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push(GLYPHS[(Math.random() * GLYPHS.length) | 0]);
  }
  return out;
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: "#000000ee",
    overflow: "hidden",
    zIndex: 9999,
  },
  column: {
    position: "absolute",
    top: 0,
    alignItems: "center",
  },
  glyph: {
    color: "#00ff41",
    fontFamily: "monospace",
    opacity: 0.6,
    textShadowColor: "#00ff41",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 4,
  },
  // Brightness tiers -------------------------------------------------
  // HEAD — the leader of the trail. White-green, always visible.
  glyphHead: {
    color: "#e2ffe6",
    opacity: 1,
    fontWeight: "700",
    textShadowRadius: 10,
  },
  // Extra-bright variant of head — fires on ~30% of columns for
  // heterogeneous leader intensity.
  glyphHeadBright: {
    color: "#ffffff",
    textShadowColor: "#8affa6",
    textShadowRadius: 14,
  },
  // ACCENT — a sparkle mid-trail on the lucky ~18% of columns.
  glyphAccent: {
    color: "#b6ffc2",
    opacity: 0.95,
    fontWeight: "700",
    textShadowRadius: 10,
  },
  // BRIGHT — the first few glyphs behind the head.
  glyphBright: {
    opacity: 0.85,
    textShadowRadius: 6,
  },
  // FADE — bottom of the trail. Faint and grainy so tails don't
  // pile up as a solid wall.
  glyphFade: {
    opacity: 0.22,
    textShadowRadius: 2,
  },
  wakeUpWrap: {
    position: "absolute",
    top: "40%",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  wakeUpText: {
    color: "#00ff41",
    fontSize: 22,
    fontFamily: "monospace",
    fontWeight: "700",
    letterSpacing: 1.5,
    textShadowColor: "#00ff41",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  caret: {
    color: "#c8ffcf",
    fontSize: 22,
  },
});
