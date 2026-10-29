import React from "react";
import { View } from "react-native";

export function Pad({ size = 16 }: { size?: number }) {
  return <View style={{ height: size, width: size }} />;
}
