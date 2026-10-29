// Mount once at the app root so the update check runs on launch.

import { useEffect } from "react";
import { StyleSheet, View } from "react-native";

import { checkForUpdate } from "./check";
import {
  setUpdateBootstrapMounted,
  UpdateAvailableSlot,
} from "./UpdateAvailableCard";

export function UpdateBootstrap() {
  useEffect(() => {
    setUpdateBootstrapMounted(true);
    void checkForUpdate();
    return () => setUpdateBootstrapMounted(false);
  }, []);

  return (
    <View pointerEvents="box-none" style={styles.fill}>
      <View pointerEvents="box-none" style={styles.dock}>
        <UpdateAvailableSlot />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: StyleSheet.absoluteFill,
  dock: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 24,
  },
});
