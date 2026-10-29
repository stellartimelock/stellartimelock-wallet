// Plus Tier Dashboard — Time-Lock + Cooling-Off monitoring and creation.

import { TierMonitorDashboard } from "@/src/vault/TierMonitorDashboard";

export default function PlusTierScreen() {
  return (
    <TierMonitorDashboard
      variant="plus"
      title="Plus Dashboard"
      badge="PLUS TIER"
      subtitle="Time-Lock · Cooling-Off · monitoring + create"
    />
  );
}
