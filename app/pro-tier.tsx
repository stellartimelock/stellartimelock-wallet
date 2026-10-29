// Pro Tier Dashboard — Time-Lock, Cooling-Off, Vesting, Multi-Asset.

import { TierMonitorDashboard } from "@/src/vault/TierMonitorDashboard";

export default function ProTierScreen() {
  return (
    <TierMonitorDashboard
      variant="pro"
      title="Pro Dashboard"
      badge="PRO TIER"
      subtitle="Create & track up to ~$50k · Pro vault types"
    />
  );
}
