import React from "react";
import Svg, { G, Path } from "react-native-svg";

import { colors } from "@/src/theme";

interface Props {
  size?: number;
  /** Stroke color for both the cloud outline and the arrow pair.
   *  Defaults to the app's primary accent so this icon reads the
   *  same as every other Feather / SVG glyph in the shell. */
  color?: string;
  /** Optional override for just the arrow pair. Kept for API compat
   *  with the previous version's `arrowColor` prop — most callers
   *  should leave it undefined so the arrows inherit `color`. */
  arrowColor?: string;
}

export function CloudSyncIcon({
  size = 20,
  color,
  arrowColor,
}: Props) {
  const stroke = color ?? colors.cyan;
  const arrowStroke = arrowColor ?? stroke;
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" fill="none">
      <Path
        d="M28 64 Q14 64 16 50 Q18 38 30 36 Q32 22 46 22 Q60 22 64 32 Q76 32 82 44 Q92 48 88 60 Q86 68 74 68 L34 68 Q28 68 28 64 Z"
        fill="none"
        stroke={stroke}
        strokeWidth={4}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      <G>
        <Path
          d="M43 82 L43 58 L37 64 M43 58 L49 64"
          stroke={arrowStroke}
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <Path
          d="M57 58 L57 82 L51 76 M57 82 L63 76"
          stroke={arrowStroke}
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </G>
    </Svg>
  );
}