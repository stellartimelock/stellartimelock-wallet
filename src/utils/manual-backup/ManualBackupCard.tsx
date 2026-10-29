// ManualBackupCard.
//
// After a successful export we show a full confirmation modal
// with:
//   • File name + size + timestamp
//   • Full URI (with a Copy button) so the user can paste it into a
//     debug tool or find it in the OS Files app.
//   • Android-only: the user-visible external folder label (SAF) plus
//     a "Change save folder…" button that re-opens the folder picker.
//   • "Share file" button → opens the OS share sheet.
//   • "Save file again" → re-runs the export silently (useful if the
//     user wants a second copy in a new location without another
//     folder-pick prompt).
//
// Payload is AES-256 encrypted with the wallet-seed-derived key so an
// intercepted file is worthless without the same seed.

import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Card } from "@/src/components/Card";
import { useToast } from "@/src/components/Toast";
import { colors, radii, spacing, typography } from "@/src/theme";
import { trackEvent } from "@/src/analytics/firebase";
import { RestoreConfirmModal } from "@/src/utils/backup-warning-modal/RestoreConfirmModal";
import {
  exportManualBackup,
  getCurrentAndroidSaveFolderLabel,
  getLastBackupMeta,
  openBackupLocation,
  pickAndroidSaveFolder,
  pickManualBackupFile,
  restoreManualBackupPayload,
  shareBackupFile,
  type ExportResult,
  type LastBackupMeta,
  type PickedBackup,
} from "@/src/utils/manual-backup/manual-backup";
import { useSession } from "@/src/state/session";
import { authenticate } from "@/src/security/biometric";
import { isSessionUnlocked } from "@/src/security/BiometricGate";

interface Counts {
  addresses: number;
  totp: number;
  keys: number;
  wallets: number;
}

export function ManualBackupCard() {
  const toast = useToast();
  const { wallet, refreshWallets } = useSession();
  const [busy, setBusy] = useState<
    null | "export" | "import" | "share" | "pick-folder" | "open"
  >(null);
  const [lastResult, setLastResult] = useState<null | {
    kind: "export" | "import";
    at: number;
    fileName?: string;
    counts?: Counts;
  }>(null);
  const [pickedFolderLabel, setPickedFolderLabel] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ExportResult | null>(null);
  const [importConfirmVisible, setImportConfirmVisible] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<PickedBackup | null>(null);
  const [overwritePrompt, setOverwritePrompt] = useState<LastBackupMeta | null>(
    null,
  );

  useEffect(() => {
    void (async () => {
      const l = await getCurrentAndroidSaveFolderLabel();
      setPickedFolderLabel(l);
    })();
  }, []);

  const runExport = useCallback(
    async (overwrite: boolean) => {
      if (!wallet?.secretSeed) {
        toast.show("No wallet loaded", "error");
        return;
      }
      setBusy("export");
      setOverwritePrompt(null);
      try {
        const r = await exportManualBackup(wallet.secretSeed, {
          overwrite,
          // Manual exports are always interactive for the first SAF
          // folder pick; overwrite still reuses the prior file URI.
          interactive: true,
        });
        if (r.ok) {
          setLastResult({
            kind: "export",
            at: Date.now(),
            fileName: r.fileName,
            counts: {
              addresses: r.addresses,
              totp: r.totp,
              keys: r.keys,
              wallets: r.wallets,
            },
          });
          setConfirm(r);
          // Refresh the folder label (user may have picked a folder mid-export).
          setPickedFolderLabel(await getCurrentAndroidSaveFolderLabel());
          trackEvent({ name: "backup_synced", target: "manual_json", ok: true });
        } else {
          toast.show(r.error ?? "Export failed.", "error");
          trackEvent({ name: "backup_synced", target: "manual_json", ok: false });
        }
      } finally {
        setBusy(null);
      }
    },
    [toast, wallet],
  );

  const onExport = useCallback(async () => {
    if (busy) return;
    if (!wallet?.secretSeed) {
      toast.show("No wallet loaded", "error");
      return;
    }
    // Close any prior confirm sheet so the overwrite choice is visible.
    setConfirm(null);
    const last = await getLastBackupMeta();
    if (last?.fileName) {
      setOverwritePrompt(last);
      return;
    }
    await runExport(false);
  }, [busy, toast, wallet, runExport]);


  const onImport = useCallback(async () => {
    if (busy) return;
    if (!wallet?.secretSeed) {
      toast.show("No wallet loaded", "error");
      return;
    }
    setBusy("import");
    try {
      const picked = await pickManualBackupFile();
      if (!picked.ok) {
        if (picked.error !== "Import cancelled.") {
          toast.show(picked.error, "error");
        }
        return;
      }
      setPendingRestore(picked.file);
      setImportConfirmVisible(true);
    } finally {
      setBusy(null);
    }
  }, [busy, toast, wallet]);

  const handleImportFile = useCallback(async () => {
    if (busy || !pendingRestore) return;
    if (!wallet?.secretSeed) {
      toast.show("No wallet loaded", "error");
      return;
    }
    setBusy("import");
    try {
      if (!isSessionUnlocked()) {
        const ok = await authenticate("Confirm restore");
        if (!ok) {
          toast.show("Restore cancelled. Nothing changed.", "info");
          return;
        }
      }
      const r = await restoreManualBackupPayload(
        wallet.secretSeed,
        pendingRestore.raw,
        pendingRestore.fileName,
      );
      setImportConfirmVisible(false);
      setPendingRestore(null);
      if (r.ok && r.applied) {
        await refreshWallets().catch(() => undefined);
        setLastResult({
          kind: "import",
          at: Date.now(),
          fileName: pendingRestore.fileName,
          counts: {
            addresses: r.applied.addresses,
            totp: r.applied.totp ?? 0,
            keys: r.applied.keys ?? 0,
            wallets: r.applied.wallets ?? 0,
          },
        });
        const walletBit =
          (r.applied.wallets ?? 0) > 0
            ? `, ${r.applied.wallets} wallet name${r.applied.wallets === 1 ? "" : "s"}`
            : "";
        toast.show(
          `Restored ${r.applied.addresses} contacts, ${r.applied.totp ?? 0} authenticator entries, ${r.applied.keys ?? 0} saved keys${walletBit}.`,
          "success",
        );
        router.replace("/(tabs)/wallet");
      } else {
        toast.show(r.error ?? "Import failed.", r.tone === "info" ? "info" : "error");
      }
    } finally {
      setBusy(null);
    }
  }, [busy, pendingRestore, toast, wallet, refreshWallets]);

  const onChangeFolder = useCallback(async () => {
    if (busy) return;
    setBusy("pick-folder");
    try {
      const r = await pickAndroidSaveFolder();
      if (r.ok && r.dirUri) {
        setPickedFolderLabel(r.label ?? "Selected folder");
        toast.show(`Backup folder set: ${r.label ?? "custom folder"}`, "success");
      } else if (r.error && r.error !== "Folder pick cancelled.") {
        toast.show(r.error, "error");
      }
    } finally {
      setBusy(null);
    }
  }, [busy, toast]);

  return (
    <>
    <Card padded testID="manual-backup-card">
      <View style={styles.headerRow}>
        <View style={styles.iconWrap}>
          <Feather name="hard-drive" size={18} color={colors.teal} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Encrypted backup</Text>
          <Text style={styles.sub}>
            Your encrypted .stvault backup file containing your contacts,
            saved keys, and wallet data.
          </Text>
        </View>
      </View>

      {Platform.OS === "android" ? (
        <View style={styles.folderBlock}>
          <Feather name="folder" size={12} color={colors.textSecondary} />
          <Text style={styles.folderLabel} numberOfLines={1}>
            {pickedFolderLabel
              ? `Saving to: ${pickedFolderLabel}`
              : "Files land in-app; picking a folder makes them visible in Files app."}
          </Text>
          <TouchableOpacity
            onPress={onChangeFolder}
            disabled={busy === "pick-folder"}
            style={styles.folderBtn}
            testID="manual-backup-change-folder"
          >
            <Text style={styles.folderBtnText}>
              {pickedFolderLabel ? "Change" : "Pick folder"}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <View style={styles.actionRow}>
        <TouchableOpacity
          onPress={onExport}
          disabled={!!busy}
          style={[styles.actionBtn, !!busy && styles.actionBtnDisabled]}
          testID="manual-backup-export"
          activeOpacity={0.85}
        >
          {busy === "export" ? (
            <ActivityIndicator size="small" color={colors.textInverse} />
          ) : (
            <>
              <Feather name="download" size={14} color={colors.textInverse} />
              <Text style={styles.actionBtnText}>Export file</Text>
            </>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onImport}
          disabled={!!busy}
          style={[
            styles.actionBtn,
            styles.actionBtnSecondary,
            !!busy && styles.actionBtnDisabled,
          ]}
          testID="manual-backup-import"
          activeOpacity={0.85}
        >
          {busy === "import" ? (
            <ActivityIndicator size="small" color={colors.teal} />
          ) : (
            <>
              <Feather name="upload" size={14} color={colors.teal} />
              <Text style={styles.actionBtnTextSecondary}>Import file</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {lastResult ? (
        <Text style={styles.footnote} testID="manual-backup-footnote">
          Last {lastResult.kind === "export" ? "export" : "import"}:{" "}
          {new Date(lastResult.at).toLocaleString()}
          {lastResult.fileName ? ` · ${lastResult.fileName}` : ""}
        </Text>
      ) : (
        <Text style={styles.footnote}>
          Files carry a .stvault extension. Only importable with the same
          wallet seed used to export.
        </Text>
      )}

      {confirm && confirm.ok ? (
        <ExportConfirmModal
          result={confirm}
          onClose={() => setConfirm(null)}
          busyShare={busy === "share"}
          busyOpen={busy === "open"}
          onShare={async () => {
            if (!confirm.saved?.documentUri) return;
            setBusy("share");
            try {
              const r = await shareBackupFile(confirm.saved.documentUri);
              if (!r.ok) toast.show(r.error ?? "Share failed.", "error");
            } finally {
              setBusy(null);
            }
          }}
          onCopy={async () => {
            if (!confirm.saved?.documentUri) return;
            await Clipboard.setStringAsync(confirm.saved.documentUri);
            toast.show("Path copied to clipboard", "success");
          }}
          onOpenFolder={async () => {
            if (!confirm.saved) return;
            setBusy("open");
            try {
              const r = await openBackupLocation(confirm.saved);
              if (r.reranSafPicker) {
                // The user just picked a folder because we didn't
                // have one. Re-run the export silently so the file
                // actually lands there THIS time.
                toast.show(
                  "Folder chosen \u2014 saving a fresh copy in it now",
                  "success",
                );
                const rr = await exportManualBackup(wallet?.secretSeed!, { interactive: false });
                if (rr.ok) setConfirm(rr);
                else toast.show(rr.error ?? "Re-export failed.", "error");
              } else if (!r.ok) {
                toast.show(r.error ?? "Couldn\u2019t open location.", "error");
              }
              setPickedFolderLabel(await getCurrentAndroidSaveFolderLabel());
            } finally {
              setBusy(null);
            }
          }}
          onExportAgain={async () => {
            // Offer overwrite vs new-copy for subsequent manual saves
            // (same choice as the primary Export button).
            setConfirm(null);
            const last = await getLastBackupMeta();
            if (last?.fileName) {
              setOverwritePrompt(last);
              return;
            }
            setBusy("export");
            try {
              const r = await exportManualBackup(wallet?.secretSeed!, {
                interactive: false,
              });
              if (r.ok) {
                setConfirm(r);
                toast.show("Saved another copy.", "success");
              } else {
                toast.show(r.error ?? "Export failed.", "error");
              }
            } finally {
              setBusy(null);
            }
          }}
        />
      ) : null}
    </Card>
    {/* Import confirmation modal (destructive). */}
    <RestoreConfirmModal
      visible={importConfirmVisible}
      title="Restore this backup?"
      body={
        pendingRestore
          ? `Restore “${pendingRestore.fileName}” into this wallet. This replaces your current contacts, keys, and related data. The file only decrypts with the same wallet seed it was exported from.`
          : "This will replace ALL your current data with the contents of the backup file. The file only decrypts with the same wallet seed it was exported from."
      }
      bulletList={[
        "Authenticator (TOTP) entries",
        "Address book contacts",
        "Saved keys (Key Manager)",
        "Wallet nicknames",
        "Contacts, saved keys, and wallet names",
      ]}
      confirmLabel="Restore now"
      onCancel={() => {
        setImportConfirmVisible(false);
        setPendingRestore(null);
      }}
      onConfirm={() => {
        void handleImportFile();
      }}
      busy={busy === "import"}
      testIDPrefix="manual-import-confirm"
    />
    {overwritePrompt ? (
      <OverwriteChoiceModal
        fileName={overwritePrompt.fileName}
        busy={busy === "export"}
        onOverwrite={() => {
          void runExport(true);
        }}
        onSaveNew={() => {
          void runExport(false);
        }}
        onCancel={() => setOverwritePrompt(null)}
      />
    ) : null}
    </>
  );
}

function OverwriteChoiceModal({
  fileName,
  busy,
  onOverwrite,
  onSaveNew,
  onCancel,
}: {
  fileName: string;
  busy: boolean;
  onOverwrite: () => void;
  onSaveNew: () => void;
  onCancel: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <Pressable style={styles.backdrop} onPress={onCancel} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
        <View style={styles.sheetHandle} />
        <View style={styles.sheetHeader}>
          <View style={[styles.successIcon, { backgroundColor: colors.gold }]}>
            <Feather name="file" size={22} color={colors.textInverse} />
          </View>
          <Text style={styles.sheetTitle}>Overwrite last backup?</Text>
          <Text style={styles.sheetSub}>
            A previous backup file was found. Overwrite it, or save a new copy
            alongside it.
          </Text>
        </View>
        <View style={styles.detailBlock}>
          <View style={styles.detailRow}>
            <Text style={styles.detailKey}>LAST FILE</Text>
            <Text
              style={styles.detailVal}
              numberOfLines={3}
              testID="manual-backup-overwrite-filename"
            >
              {fileName}
            </Text>
          </View>
        </View>
        <View style={styles.sheetActions}>
          <TouchableOpacity
            onPress={onOverwrite}
            disabled={busy}
            style={[styles.sheetBtn, busy && { opacity: 0.5 }]}
            testID="manual-backup-overwrite"
          >
            {busy ? (
              <ActivityIndicator size="small" color={colors.textInverse} />
            ) : (
              <>
                <Feather name="refresh-cw" size={14} color={colors.textInverse} />
                <Text style={styles.sheetBtnText}>Overwrite</Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onSaveNew}
            disabled={busy}
            style={[styles.sheetBtn, styles.sheetBtnGhost, busy && { opacity: 0.5 }]}
            testID="manual-backup-save-new"
          >
            <Feather name="plus" size={14} color={colors.teal} />
            <Text style={styles.sheetBtnTextGhost}>Save as new</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          onPress={onCancel}
          style={styles.sheetClose}
          testID="manual-backup-overwrite-cancel"
          disabled={busy}
        >
          <Text style={styles.sheetCloseText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

function ExportConfirmModal({
  result,
  onClose,
  onShare,
  onCopy,
  onOpenFolder,
  onExportAgain,
  busyShare,
  busyOpen,
}: {
  result: ExportResult;
  onClose: () => void;
  onShare: () => void | Promise<void>;
  onCopy: () => void | Promise<void>;
  onOpenFolder: () => void | Promise<void>;
  onExportAgain: () => void | Promise<void>;
  busyShare: boolean;
  busyOpen: boolean;
}) {
  const insets = useSafeAreaInsets();
  const saved = result.saved;
  const sizeLabel = formatBytes(result.fileSize ?? 0);
  const isWeb = Platform.OS === "web";
  const isAndroid = Platform.OS === "android";
  const openLabel = isAndroid
    ? saved?.externalUri
      ? "Open folder"
      : "Save to a visible folder"
    : "Reveal in Files";

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
        <View style={styles.sheetHandle} />
        <ScrollView style={{ maxHeight: 520 }}>
          <View style={styles.sheetHeader}>
            <View style={styles.successIcon}>
              <Feather name="check" size={22} color={colors.textInverse} />
            </View>
            <Text style={styles.sheetTitle}>Backup saved</Text>
            <Text style={styles.sheetSub}>
              {isWeb
                ? "Your browser downloaded the .stvault file. Check your Downloads folder."
                : isAndroid
                  ? saved?.externalUri
                    ? `Also copied to ${saved.externalLabel ?? "your chosen folder"}. Tap Open folder to view it in Files.`
                    : "Encrypted with your wallet seed. The current copy is inside the app's private storage — tap \u201CSave to a visible folder\u201D to also drop it somewhere you can browse."
                  : "Encrypted with your wallet seed. Tap Reveal in Files to save or share the .stvault file."}
            </Text>
          </View>

          <View style={styles.detailBlock}>
            <View style={styles.detailRow}>
              <Text style={styles.detailKey}>FILE</Text>
              <Text style={styles.detailVal} numberOfLines={2}>
                {result.fileName}
              </Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailKey}>SIZE</Text>
              <Text style={styles.detailVal}>{sizeLabel}</Text>
            </View>
            {saved?.externalUri ? (
              <View style={styles.detailRow}>
                <Text style={styles.detailKey}>VISIBLE IN</Text>
                <Text style={styles.detailVal} numberOfLines={2}>
                  {saved.externalLabel ?? "External folder"} — open the Files
                  app to find it.
                </Text>
              </View>
            ) : null}
            <View style={styles.detailRow}>
              <Text style={styles.detailKey}>APP COPY</Text>
              <Text
                style={styles.detailValPath}
                numberOfLines={3}
                selectable
                testID="manual-backup-export-path"
              >
                {saved?.documentUri ?? "(unknown)"}
              </Text>
            </View>
          </View>

          <View style={styles.countsBlock}>
            {result.totp > 0 ? (
              <Count label="2FA" value={result.totp} />
            ) : null}
            {result.addresses > 0 ? (
              <Count label="Contacts" value={result.addresses} />
            ) : null}
            {result.keys > 0 ? (
              <Count label="Keys" value={result.keys} />
            ) : null}
            {result.wallets > 0 ? (
              <Count label="Wallets" value={result.wallets} />
            ) : null}
          </View>

          <View style={styles.sheetActions}>
            {/* Primary post-export action is now
                "Open folder" (Android) / "Reveal in Files" (iOS) so
                users can immediately VERIFY where the file landed.
                The old share-first flow buried the actual location. */}
            {!isWeb ? (
              <TouchableOpacity
                onPress={onOpenFolder}
                disabled={busyOpen}
                style={[styles.sheetBtn, busyOpen && { opacity: 0.5 }]}
                testID="manual-backup-open-folder"
              >
                {busyOpen ? (
                  <ActivityIndicator size="small" color={colors.textInverse} />
                ) : (
                  <>
                    <Feather
                      name="folder"
                      size={14}
                      color={colors.textInverse}
                    />
                    <Text style={styles.sheetBtnText}>{openLabel}</Text>
                  </>
                )}
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              onPress={onShare}
              disabled={busyShare || isWeb}
              style={[
                styles.sheetBtn,
                styles.sheetBtnGhost,
                (busyShare || isWeb) && { opacity: 0.5 },
              ]}
              testID="manual-backup-share"
            >
              {busyShare ? (
                <ActivityIndicator size="small" color={colors.teal} />
              ) : (
                <>
                  <Feather
                    name="share-2"
                    size={14}
                    color={colors.teal}
                  />
                  <Text style={styles.sheetBtnTextGhost}>Share file</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            onPress={onCopy}
            style={styles.sheetLink}
            testID="manual-backup-copy-path"
          >
            <Feather name="copy" size={12} color={colors.textSecondary} />
            <Text style={styles.sheetLinkText}>Copy path</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={onExportAgain}
            style={styles.sheetLink}
            testID="manual-backup-export-again"
          >
            <Feather name="refresh-ccw" size={12} color={colors.textSecondary} />
            <Text style={styles.sheetLinkText}>Save another copy</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={onClose}
            style={styles.sheetClose}
            testID="manual-backup-confirm-close"
          >
            <Text style={styles.sheetCloseText}>Done</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.countCell}>
      <Text style={styles.countValue}>{value}</Text>
      <Text style={styles.countLabel}>{label}</Text>
    </View>
  );
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + 2,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.tealMuted,
  },
  title: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 2,
  },
  sub: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
  },
  folderBlock: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
  },
  folderLabel: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 15,
  },
  folderBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radii.sm,
    backgroundColor: colors.tealMuted,
    borderWidth: 1,
    borderColor: colors.teal,
  },
  folderBtnText: {
    color: colors.teal,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  actionRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: radii.sm,
    backgroundColor: colors.teal,
  },
  actionBtnSecondary: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.teal,
  },
  actionBtnDisabled: { opacity: 0.5 },
  actionBtnText: {
    color: colors.textInverse,
    fontSize: 12,
    fontWeight: "700",
  },
  actionBtnTextSecondary: {
    color: colors.teal,
    fontSize: 12,
    fontWeight: "700",
  },
  footnote: {
    color: colors.textTertiary,
    fontSize: 11,
    marginTop: spacing.sm,
    ...typography.mono,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: spacing.md + 4,
  },
  sheetHandle: {
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderSubtle,
    alignSelf: "center",
    marginBottom: spacing.md,
  },
  sheetHeader: {
    alignItems: "center",
    marginBottom: spacing.md,
  },
  successIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.teal,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  sheetTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 4,
  },
  sheetSub: {
    color: colors.textSecondary,
    fontSize: 12,
    textAlign: "center",
    lineHeight: 17,
    paddingHorizontal: spacing.md,
  },
  detailBlock: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radii.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
  },
  detailRow: {
    flexDirection: "column",
    gap: 2,
  },
  detailKey: {
    color: colors.textTertiary,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  detailVal: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "600",
  },
  detailValPath: {
    color: colors.textSecondary,
    fontSize: 11,
    ...typography.mono,
  },
  countsBlock: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: spacing.md,
  },
  countCell: {
    flexGrow: 1,
    minWidth: 60,
    alignItems: "center",
    padding: 8,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
  },
  countValue: {
    color: colors.teal,
    fontSize: 16,
    fontWeight: "800",
  },
  countLabel: {
    color: colors.textTertiary,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginTop: 2,
  },
  sheetActions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  sheetBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: radii.md,
    backgroundColor: colors.teal,
  },
  sheetBtnGhost: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.teal,
  },
  sheetBtnText: {
    color: colors.textInverse,
    fontSize: 13,
    fontWeight: "800",
  },
  sheetBtnTextGhost: {
    color: colors.teal,
    fontSize: 13,
    fontWeight: "800",
  },
  sheetLink: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 4,
  },
  sheetLinkText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
    textDecorationLine: "underline",
  },
  sheetClose: {
    alignSelf: "center",
    padding: 10,
  },
  sheetCloseText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: "800",
  },
});
