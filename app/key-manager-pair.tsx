// Key Manager pairing screen — share seeds with Fortress Key Manager.
//
// QR scheme: stellarvault://kmpair?d=<base64url JSON>
// Either device can show (initiator, sends seeds) or scan (responder, receives seeds).
// Seeds stay in memory only. PICK_KEY is unrelated and unchanged.

import { Feather } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Stack, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import QRCode from "react-native-qrcode-svg";

import { useToast } from "@/src/components/Toast";
import { hasFossQrScanner, scanQrFoss } from "@/src/qr/foss-scanner";
import {
  buildQrUri,
  generateInitiatorSession,
  generateResponderKeypair,
  parseQrUri,
  runInitiator,
  runResponder,
  type PairOffer,
  type PairResult,
  type PairStatus,
} from "@/src/security/key-pairing";
import { colors, radii, spacing, tileShadow, typography } from "@/src/theme";

// ── Types ──────────────────────────────────────────────────────────────

type Mode = "choose" | "show" | "scan";

const STATUS_LABEL: Record<PairStatus, string> = {
  idle: "Ready",
  waiting: "Waiting for other device…",
  exchanging: "Sending seeds…",
  importing: "Importing seeds…",
  done: "Done",
  error: "Failed",
};

const STATUS_ICON: Record<PairStatus, keyof typeof Feather.glyphMap> = {
  idle: "radio",
  waiting: "clock",
  exchanging: "upload",
  importing: "download",
  done: "check-circle",
  error: "alert-circle",
};

// ── Screen ────────────────────────────────────────────────────────────

export default function KeyManagerPairScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const [mode, setMode] = useState<Mode>("choose");
  const [qrUri, setQrUri] = useState<string>("");
  const [status, setStatus] = useState<PairStatus>("idle");
  const [result, setResult] = useState<PairResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [scanned, setScanned] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  // ── Initiator — shows QR and sends seeds ──────────────────────────────

  const startInitiator = useCallback(async () => {
    setMode("show");
    setStatus("idle");
    setResult(null);
    setErrorMsg("");
    setScanned(false);
    setQrUri("");
    abortRef.current?.abort();

    const { session, offer } = await generateInitiatorSession();
    setQrUri(buildQrUri(offer));

    const ac = new AbortController();
    abortRef.current = ac;

    await runInitiator(
      session,
      offer,
      (s) => { setStatus(s); },
      (r) => { setResult(r); },
      (msg) => { setErrorMsg(msg); },
      ac.signal,
    );
  }, []);

  // ── Responder — scans QR and receives seeds ───────────────────────────

  const startScan = useCallback(async () => {
    if (!cameraPermission?.granted) {
      const res = await requestCameraPermission();
      if (!res.granted) {
        toast.show("Camera permission is required to scan a pairing code.", "error");
        return;
      }
    }
    setMode("scan");
    setStatus("idle");
    setResult(null);
    setErrorMsg("");
    setScanned(false);
  }, [cameraPermission, requestCameraPermission, toast]);

  const onBarcodeScanned = useCallback(
    async ({ data }: { data: string }) => {
      if (scanned) return;
      const offer = parseQrUri(data);
      if (!offer) {
        toast.show("Not a valid Fortress Key Manager pairing code.", "error");
        return;
      }
      setScanned(true);
      setStatus("waiting");

      // Generate responder keypair (memory-only for the session).
      const { privKey, pubKeyB64 } = generateResponderKeypair();

      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      await runResponder(
        privKey,
        pubKeyB64,
        offer,
        (s) => { setStatus(s); },
        (r) => { setResult(r); },
        (msg) => { setErrorMsg(msg); },
        ac.signal,
      );
    },
    [scanned, toast],
  );

  // F-Droid flavor: ZXing scanner instead of expo-camera's ML Kit scanner.
  const startFossScan = useCallback(async () => {
    let data: string | null = null;
    try {
      data = await scanQrFoss("Scan the pairing QR from the other device");
    } catch {
      toast.show("Could not open the QR scanner.", "error");
      return;
    }
    if (!data) return;
    if (!parseQrUri(data)) {
      toast.show("Not a valid Fortress Key Manager pairing code.", "error");
      return;
    }
    setMode("scan");
    setStatus("idle");
    setResult(null);
    setErrorMsg("");
    setScanned(false);
    await onBarcodeScanned({ data });
  }, [onBarcodeScanned, toast]);

  const beginScan = hasFossQrScanner ? startFossScan : startScan;

  // ── Reset ─────────────────────────────────────────────────────────────

  const reset = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setMode("choose");
    setStatus("idle");
    setResult(null);
    setErrorMsg("");
    setScanned(false);
    setQrUri("");
  };

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          onPress={() => { abortRef.current?.abort(); router.back(); }}
          style={styles.headerBtn}
          testID="pair-back"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather name="arrow-left" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Pair Key Managers</Text>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.body,
          { paddingBottom: insets.bottom + spacing.xl },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {mode === "choose" && (
          <ChooseMode onShowQR={startInitiator} onScanQR={beginScan} />
        )}
        {mode === "show" && (
          <ShowPanel
            qrUri={qrUri}
            status={status}
            result={result}
            errorMsg={errorMsg}
            onRetry={startInitiator}
            onDone={reset}
          />
        )}
        {mode === "scan" && (
          <ScanPanel
            scanned={scanned}
            status={status}
            result={result}
            errorMsg={errorMsg}
            onBarcodeScanned={onBarcodeScanned}
            onRetry={beginScan}
            onDone={reset}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Sub-components ────────────────────────────────────────────────────

function ChooseMode({
  onShowQR,
  onScanQR,
}: {
  onShowQR: () => void;
  onScanQR: () => void;
}) {
  return (
    <View style={styles.chooseCt}>
      <View style={styles.iconCircle}>
        <Feather name="link" size={24} color={colors.cyan} />
      </View>
      <Text style={styles.chooseTitle}>Pair with Fortress</Text>
      <Text style={styles.chooseBody}>
        Share Key Manager seeds between this wallet and Fortress Key Manager.
        The device that shows the QR sends its seeds to the device that scans.
      </Text>

      <View style={styles.noteRow}>
        <Feather name="shield" size={13} color={colors.cyan} />
        <Text style={styles.noteText}>
          Seeds are end-to-end encrypted with X25519 + XChaCha20 and stay in
          memory only — nothing is written to disk or stored on the relay.
        </Text>
      </View>

      <TouchableOpacity
        style={styles.bigBtn}
        onPress={onShowQR}
        testID="pair-show-qr"
        activeOpacity={0.85}
      >
        <Feather name="monitor" size={18} color={colors.textInverse} />
        <Text style={styles.bigBtnText}>Show QR — send my seeds</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.bigBtn, styles.bigBtnSecondary]}
        onPress={onScanQR}
        testID="pair-scan-qr"
        activeOpacity={0.85}
      >
        <Feather name="camera" size={18} color={colors.cyan} />
        <Text style={[styles.bigBtnText, styles.bigBtnTextSecondary]}>
          Scan QR — receive seeds
        </Text>
      </TouchableOpacity>
    </View>
  );
}

function ShowPanel({
  qrUri,
  status,
  result,
  errorMsg,
  onRetry,
  onDone,
}: {
  qrUri: string;
  status: PairStatus;
  result: PairResult | null;
  errorMsg: string;
  onRetry: () => void;
  onDone: () => void;
}) {
  const isDone = status === "done";
  const isError = status === "error";
  const isActive = !isDone && !isError;

  return (
    <View style={styles.panelCt}>
      <Text style={styles.panelTitle}>Show QR on this screen</Text>
      <Text style={styles.panelBody}>
        On Fortress Key Manager, tap "Scan QR — receive seeds" and point the
        camera at this code.
      </Text>

      {qrUri ? (
        <View style={styles.qrCard}>
          <QRCode
            value={qrUri}
            size={220}
            backgroundColor="#FFFFFF"
            color="#000000"
            ecl="M"
          />
        </View>
      ) : (
        <View style={[styles.qrCard, styles.qrCardLoading]}>
          <ActivityIndicator color={colors.cyan} />
          <Text style={styles.loadingText}>Generating session…</Text>
        </View>
      )}

      <StatusPill status={status} />

      {isDone && result && <InitiatorResult result={result} />}

      {isError && errorMsg ? (
        <ErrorCard msg={errorMsg} />
      ) : null}

      <View style={styles.actionRow}>
        {isActive && (
          <TouchableOpacity style={styles.ghostBtn} onPress={onDone} testID="pair-cancel">
            <Text style={styles.ghostBtnText}>Cancel</Text>
          </TouchableOpacity>
        )}
        {isError && (
          <>
            <TouchableOpacity style={styles.ghostBtn} onPress={onDone} testID="pair-back-btn">
              <Text style={styles.ghostBtnText}>Back</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryBtn} onPress={onRetry} testID="pair-retry">
              <Text style={styles.primaryBtnText}>Try Again</Text>
            </TouchableOpacity>
          </>
        )}
        {isDone && (
          <TouchableOpacity style={styles.primaryBtn} onPress={onDone} testID="pair-done">
            <Feather name="check" size={16} color={colors.textInverse} />
            <Text style={styles.primaryBtnText}>Done</Text>
          </TouchableOpacity>
        )}
      </View>

      <RelayNote />
    </View>
  );
}

function ScanPanel({
  scanned,
  status,
  result,
  errorMsg,
  onBarcodeScanned,
  onRetry,
  onDone,
}: {
  scanned: boolean;
  status: PairStatus;
  result: PairResult | null;
  errorMsg: string;
  onBarcodeScanned: (e: { data: string }) => void;
  onRetry: () => void;
  onDone: () => void;
}) {
  const isDone = status === "done";
  const isError = status === "error";

  return (
    <View style={styles.panelCt}>
      <Text style={styles.panelTitle}>Scan QR from other device</Text>
      <Text style={styles.panelBody}>
        On Fortress Key Manager (or this wallet), tap "Show QR — send my seeds"
        and point this camera at that code.
      </Text>

      {!scanned && !hasFossQrScanner ? (
        <View style={styles.cameraCard}>
          <CameraView
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={onBarcodeScanned}
          />
          <View style={styles.cameraOverlay} pointerEvents="none">
            <View style={[styles.corner, styles.cornerTL]} />
            <View style={[styles.corner, styles.cornerTR]} />
            <View style={[styles.corner, styles.cornerBL]} />
            <View style={[styles.corner, styles.cornerBR]} />
          </View>
        </View>
      ) : (
        <View style={[styles.cameraCard, styles.cameraFiller]}>
          <Feather
            name={STATUS_ICON[status]}
            size={36}
            color={isDone ? colors.cyan : isError ? colors.danger : colors.textSecondary}
          />
          <Text style={styles.scanStatusText}>{STATUS_LABEL[status]}</Text>
        </View>
      )}

      <StatusPill status={status} />

      {isDone && result && <ResponderResult result={result} />}

      {isError && errorMsg ? (
        <ErrorCard msg={errorMsg} />
      ) : null}

      <View style={styles.actionRow}>
        {!scanned && (
          <TouchableOpacity style={styles.ghostBtn} onPress={onDone} testID="pair-cancel">
            <Text style={styles.ghostBtnText}>Cancel</Text>
          </TouchableOpacity>
        )}
        {isError && (
          <>
            <TouchableOpacity style={styles.ghostBtn} onPress={onDone} testID="pair-back-btn">
              <Text style={styles.ghostBtnText}>Back</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryBtn} onPress={onRetry} testID="pair-retry">
              <Text style={styles.primaryBtnText}>Try Again</Text>
            </TouchableOpacity>
          </>
        )}
        {isDone && (
          <TouchableOpacity style={styles.primaryBtn} onPress={onDone} testID="pair-done">
            <Feather name="check" size={16} color={colors.textInverse} />
            <Text style={styles.primaryBtnText}>Done</Text>
          </TouchableOpacity>
        )}
      </View>

      <RelayNote />
    </View>
  );
}

function StatusPill({ status }: { status: PairStatus }) {
  const isDone = status === "done";
  const isError = status === "error";
  const isActive = !isDone && !isError && status !== "idle";

  return (
    <View
      style={[
        styles.statusPill,
        isDone && styles.statusPillDone,
        isError && styles.statusPillError,
      ]}
      testID={`pair-status-${status}`}
    >
      {isActive ? (
        <ActivityIndicator
          size="small"
          color={colors.cyan}
          style={{ marginRight: 8 }}
        />
      ) : (
        <Feather
          name={STATUS_ICON[status]}
          size={14}
          color={isDone ? colors.cyan : isError ? colors.danger : colors.textSecondary}
          style={{ marginRight: 8 }}
        />
      )}
      <Text
        style={[
          styles.statusPillText,
          isDone && styles.statusPillTextDone,
          isError && styles.statusPillTextError,
        ]}
      >
        {STATUS_LABEL[status]}
      </Text>
    </View>
  );
}

function InitiatorResult({ result }: { result: PairResult }) {
  return (
    <View style={styles.resultCard} testID="pair-result">
      <Text style={styles.resultTitle}>
        {result.total === 0 ? "No seeds to send" : `Sent ${result.total} seed${result.total === 1 ? "" : "s"} to the other device`}
      </Text>
      <Text style={styles.resultNote}>
        The other device will import the ones it does not already have.
      </Text>
    </View>
  );
}

function ResponderResult({ result }: { result: PairResult }) {
  return (
    <View style={styles.resultCard} testID="pair-result">
      <Text style={styles.resultTitle}>
        {result.imported === 0
          ? "Already up to date"
          : `${result.imported} seed${result.imported === 1 ? "" : "s"} imported`}
      </Text>
      <View style={styles.resultRow}>
        <Stat label="Offered" value={result.total} />
        <Stat label="Imported" value={result.imported} />
        <Stat label="Skipped" value={result.skipped} />
      </View>
      {result.skipped > 0 && (
        <Text style={styles.resultNote}>
          {result.skipped === 1
            ? "1 seed was already in your Key Manager."
            : `${result.skipped} seeds were already in your Key Manager.`}
        </Text>
      )}
    </View>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function ErrorCard({ msg }: { msg: string }) {
  return (
    <View style={styles.errorCard}>
      <Feather name="alert-circle" size={14} color={colors.danger} />
      <Text style={styles.errorText}>{msg}</Text>
    </View>
  );
}

function RelayNote() {
  return (
    <View style={styles.relayNote}>
      <Feather name="wifi" size={11} color={colors.textTertiary} />
      <Text style={styles.relayNoteText}>
        Tries local network first; falls back to end-to-end encrypted relay on
        HTTPS 443.
      </Text>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  headerBtn: { padding: 8, width: 40 },
  headerTitle: {
    color: colors.text,
    fontSize: 17,
    ...typography.heading,
  },
  body: { paddingHorizontal: spacing.md },

  // Choose mode
  chooseCt: { paddingTop: spacing.lg, gap: spacing.md },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: radii.md,
    backgroundColor: colors.cyanMuted,
    borderWidth: 1,
    borderColor: colors.borderGlow,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: spacing.xs,
  },
  chooseTitle: {
    color: colors.text,
    fontSize: 20,
    ...typography.heading,
    textAlign: "center",
  },
  chooseBody: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
  noteRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: colors.cyanMuted,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderGlow,
    padding: spacing.md,
  },
  noteText: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  bigBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: spacing.md,
    borderRadius: radii.button,
    backgroundColor: colors.cyan,
  },
  bigBtnSecondary: {
    backgroundColor: colors.cyanMuted,
    borderWidth: 1,
    borderColor: colors.borderGlow,
  },
  bigBtnText: {
    color: colors.textInverse,
    fontSize: 15,
    fontWeight: "700",
  },
  bigBtnTextSecondary: { color: colors.cyan },

  // Panel
  panelCt: { paddingTop: spacing.lg, gap: spacing.md },
  panelTitle: { color: colors.text, fontSize: 17, ...typography.heading },
  panelBody: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
  },

  // QR
  qrCard: {
    alignSelf: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: radii.lg,
    padding: 16,
    ...tileShadow(),
  },
  qrCardLoading: {
    width: 252,
    height: 252,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  loadingText: { color: colors.textSecondary, fontSize: 13 },

  // Camera
  cameraCard: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: radii.md,
    overflow: "hidden",
    backgroundColor: colors.surface,
    position: "relative",
    ...tileShadow(),
  },
  cameraFiller: {
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  camera: { flex: 1 },
  cameraOverlay: { ...StyleSheet.absoluteFillObject },
  scanStatusText: { color: colors.textSecondary, fontSize: 14 },

  // Corner markers
  corner: {
    position: "absolute",
    width: 28,
    height: 28,
    borderColor: colors.cyan,
  },
  cornerTL: { top: 20, left: 20, borderTopWidth: 3, borderLeftWidth: 3 },
  cornerTR: { top: 20, right: 20, borderTopWidth: 3, borderRightWidth: 3 },
  cornerBL: { bottom: 20, left: 20, borderBottomWidth: 3, borderLeftWidth: 3 },
  cornerBR: { bottom: 20, right: 20, borderBottomWidth: 3, borderRightWidth: 3 },

  // Status pill
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radii.chip,
    backgroundColor: colors.surfaceFrost,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  statusPillDone: {
    borderColor: colors.borderGlow,
    backgroundColor: colors.cyanMuted,
  },
  statusPillError: {
    borderColor: colors.dangerOutline,
    backgroundColor: colors.dangerMuted,
  },
  statusPillText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: "600",
  },
  statusPillTextDone: { color: colors.cyan },
  statusPillTextError: { color: colors.danger },

  // Results
  resultCard: {
    backgroundColor: colors.surfaceFrost,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderGlow,
    padding: spacing.md,
    gap: spacing.sm,
    ...tileShadow(),
  },
  resultTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
    textAlign: "center",
  },
  resultRow: {
    flexDirection: "row",
    justifyContent: "space-around",
  },
  stat: { alignItems: "center", gap: 2 },
  statValue: { color: colors.cyan, fontSize: 22, fontWeight: "700" },
  statLabel: {
    color: colors.textTertiary,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  resultNote: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    textAlign: "center",
  },

  // Error
  errorCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: colors.dangerMuted,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.dangerOutline,
    padding: spacing.md,
  },
  errorText: {
    flex: 1,
    color: colors.danger,
    fontSize: 13,
    lineHeight: 18,
  },

  // Action row
  actionRow: {
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "center",
  },
  ghostBtn: {
    flex: 1,
    alignItems: "center",
    paddingVertical: spacing.md - 2,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  ghostBtnText: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: "700",
  },
  primaryBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: spacing.md - 2,
    borderRadius: radii.button,
    backgroundColor: colors.cyan,
  },
  primaryBtnText: {
    color: colors.textInverse,
    fontSize: 14,
    fontWeight: "700",
  },

  // Relay note
  relayNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    paddingTop: spacing.xs,
  },
  relayNoteText: {
    flex: 1,
    color: colors.textTertiary,
    fontSize: 11,
    lineHeight: 15,
  },
});
