// Finance owns bills. This wallet is not the bills home.
// Deep-link when Finance is installed; otherwise keep a local list.

import { Linking, Platform } from "react-native";

export const FINANCE_SCHEME = "stellartimelock-finance";
export const FINANCE_BILLS_URL = "stellartimelock-finance://bills";
export const FINANCE_PACKAGE = "com.stellartimelock.finance";

export async function openFinanceBills(): Promise<"opened" | "missing"> {
  try {
    const can = await Linking.canOpenURL(FINANCE_BILLS_URL);
    if (can) {
      await Linking.openURL(FINANCE_BILLS_URL);
      return "opened";
    }
  } catch {
    /* try the Android intent next */
  }
  if (Platform.OS === "android") {
    try {
      await Linking.openURL(
        `intent://bills#Intent;scheme=${FINANCE_SCHEME};package=${FINANCE_PACKAGE};end`,
      );
      return "opened";
    } catch {
      return "missing";
    }
  }
  return "missing";
}
