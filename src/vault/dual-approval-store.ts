/**
 * Compatibility shim — Dual Approval was renamed to Multi-Sig.
 * Prefer importing from `@/src/vault/multi-sig-store`.
 */

export {
  listMultiSigEntries,
  upsertMultiSigEntry,
  markMultiSigSeen,
  removeMultiSigEntry,
  listDualApprovalEntries,
  upsertDualApprovalEntry,
  markDualApprovalSeen,
  removeDualApprovalEntry,
  type MultiSigEntry,
  type MultiSigRole,
  type DualApprovalEntry,
  type DualApprovalRole,
} from "@/src/vault/multi-sig-store";
