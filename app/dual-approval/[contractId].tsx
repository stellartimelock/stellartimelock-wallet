/**
 * Compatibility redirect — Dual Approval routes renamed to Multi-Sig.
 */

import { Redirect, useLocalSearchParams } from "expo-router";

export default function DualApprovalRedirect() {
  const params = useLocalSearchParams<{ contractId?: string }>();
  const contractId = (params.contractId ?? "").trim();
  if (!contractId) {
    return <Redirect href="/(tabs)/wallet" />;
  }
  return <Redirect href={`/multi-sig/${contractId}`} />;
}
