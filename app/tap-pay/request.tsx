import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import QRCode from "react-native-qrcode-svg";

import { Button } from "@/src/components/Button";
import { useSession } from "@/src/state/session";
import { isPlayReleaseBuild } from "@/src/wallet/play-network";
import { colors, radii, spacing, typography } from "@/src/theme";
import { deploymentFor, type StellarNetwork } from "@/src/wallet/contract-config";
import { POLL_MIN_INTERVAL_MS } from "@/src/utils/polling";

import { CONFIRM_GRACE_MS, CONFIRM_POLL_MS } from "@/src/tap-pay/constants";
import { findIncomingPayment, fetchMainnetXlmUsd } from "@/src/tap-pay/horizon-pay";
import { loadTapPay, updateTapPay } from "@/src/tap-pay/history-device";
import { canonicalAmount, usdToXlmAmount, xlmToUsd } from "@/src/tap-pay/money";
import {
  clearPaymentRequest,
  finishCheckout,
  openNfcSettings,
  publishPaymentRequest,
  readNfcStatus,
  type NfcStatus,
} from "@/src/tap-pay/native";
import { createPayRequest, type PayRequest } from "@/src/tap-pay/sep7";
import { assessReplay, requestKey } from "@/src/tap-pay/replay";
import { markRequestPaid } from "@/src/tap-pay/save";

type Unit = "XLM" | "USD";
type Phase = "form" | "live" | "done" | "expired";

function one(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default function RequestPaymentScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    amount?: string;
    memo?: string;
    requestId?: string;
    label?: string;
  }>();
  const requestId = one(params.requestId);
  const label = one(params.label);
  const { wallet, network, setNetwork } = useSession();
  const settled = useRef(false);

  const [unit, setUnit] = useState<Unit>("XLM");
  const [draft, setDraft] = useState(one(params.amount));
  const [memo, setMemo] = useState(one(params.memo));
  const [usdRate, setUsdRate] = useState<number | null>(null);
  const [rateAt, setRateAt] = useState<number | null>(null);
  const [rateError, setRateError] = useState<string | null>(null);
  const [nfc, setNfc] = useState<NfcStatus>({ available: false, enabled: false });
  const [showQr, setShowQr] = useState(false);
  const [phase, setPhase] = useState<Phase>("form");
  const [request, setRequest] = useState<PayRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [result, setResult] = useState<{ hash: string; from: string; ledger: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [closed, setClosed] = useState(false);

  const publicKey = wallet?.publicKey ?? "";
  const nfcReady = nfc.available && nfc.enabled;

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const rate = await fetchMainnetXlmUsd();
        if (!alive) return;
        setUsdRate(rate.usd);
        setRateAt(rate.fetchedAt);
        setRateError(null);
      } catch (e) {
        if (!alive) return;
        setRateError(e instanceof Error ? e.message : "The USD rate is unavailable.");
      }
    };
    void pull();
    const id = setInterval(pull, POLL_MIN_INTERVAL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!requestId) return;
    let alive = true;
    void loadTapPay().then((doc) => {
      if (!alive) return;
      if (assessReplay(doc.nonces, requestKey(requestId), Date.now()) === "replay") {
        setClosed(true);
        setError("This checkout was already paid.");
      }
    });
    return () => {
      alive = false;
    };
  }, [requestId]);

  useEffect(() => {
    void readNfcStatus().then(setNfc);
  }, [phase]);

  const amountXlm = useMemo(() => {
    if (unit === "XLM") return canonicalAmount(draft);
    if (usdRate == null) return null;
    return usdToXlmAmount(draft, usdRate);
  }, [unit, draft, usdRate]);

  const usdCaption = amountXlm && usdRate ? xlmToUsd(amountXlm, usdRate) : null;

  const leave = useCallback(async () => {
    await clearPaymentRequest();
    if (!settled.current && requestId) {
      settled.current = true;
      await finishCheckout({ requestId, ok: false, error: "canceled" });
    }
    router.back();
  }, [requestId, router]);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      void leave();
      return true;
    });
    return () => sub.remove();
  }, [leave]);

  const startRequest = useCallback(async () => {
    if (closed) return;
    if (!publicKey) {
      router.push("/wallet-setup");
      return;
    }
    if (!amountXlm) {
      setError("Enter a positive amount.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const dep = deploymentFor(network);
      const created = createPayRequest({
        destination: publicKey,
        amount: amountXlm,
        memo,
        networkPassphrase: dep.networkPassphrase,
      });
      const status = await readNfcStatus();
      setNfc(status);
      const ready = status.available && status.enabled;
      if (ready) await publishPaymentRequest(created.raw);
      setShowQr(!ready);
      setRequest(created);
      setPhase("live");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the payment request.");
    } finally {
      setBusy(false);
    }
  }, [amountXlm, closed, memo, network, publicKey, router]);

  useEffect(() => {
    if (phase !== "live" || !request || !publicKey) return;
    let stop = false;
    const tick = async () => {
      const clock = Date.now();
      setNow(clock);
      if (clock > request.expiresAt + CONFIRM_GRACE_MS) {
        if (!stop) {
          stop = true;
          await clearPaymentRequest();
          setPhase("expired");
        }
        return;
      }
      if (clock > request.expiresAt) {
        await clearPaymentRequest();
      }
      try {
        const found = await findIncomingPayment({
          horizonUrl: deploymentFor(network).horizonUrl,
          accountId: publicKey,
          chainMemo: request.chainMemo,
          amount: request.amount,
        });
        if (stop || !found) return;
        stop = true;
        settled.current = true;
        await clearPaymentRequest();
        try {
          await updateTapPay((doc) => {
            const withRow = {
              ...doc,
              writtenAt: Date.now(),
              payments: [
                ...doc.payments,
                {
                  id: request.nonce,
                  role: "request" as const,
                  network,
                  destination: publicKey,
                  source: found.from,
                  amount: request.amount,
                  memo: request.memo,
                  chainMemo: request.chainMemo,
                  hash: found.hash,
                  ledger: found.ledger,
                  createdAt: Date.now(),
                  name: label,
                },
              ],
            };
            return requestId
              ? markRequestPaid(withRow, requestId, request.expiresAt, Date.now())
              : withRow;
          });
        } catch {
          /* The payment is already on the network. History can be saved later. */
        }
        if (requestId) {
          await finishCheckout({
            requestId,
            ok: true,
            hash: found.hash,
            amount: request.amount,
            destination: publicKey,
            payer: found.from,
          });
        }
        setResult(found);
        setPhase("done");
      } catch {
        /* The next tick tries Horizon again. */
      }
    };
    void tick();
    const id = setInterval(() => void tick(), CONFIRM_POLL_MS);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [label, network, phase, publicKey, request, requestId]);

  useEffect(() => {
    return () => {
      void clearPaymentRequest();
    };
  }, []);

  const remainingSec = request ? Math.max(0, Math.ceil((request.expiresAt - now) / 1000)) : 0;
  const qrValue = request?.raw ?? "";

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Text style={styles.headerBtn} onPress={() => void leave()}>
          <Feather name="chevron-left" size={20} color={colors.text} />
        </Text>
        <Text style={styles.title}>Request payment</Text>
        <View style={styles.headerBtn} />
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: insets.bottom + spacing.xl }}>
        {label ? <Text style={styles.labelLine}>{label}</Text> : null}
        <NetworkLine network={network} onChange={(next) => void setNetwork(next)} disabled={phase !== "form"} />

        {phase === "form" ? (
          <View>
            <Text style={styles.kicker}>AMOUNT</Text>
            <View style={styles.unitRow}>
              <Text
                style={[styles.unit, unit === "XLM" && styles.unitOn]}
                onPress={() => setUnit("XLM")}
              >
                XLM
              </Text>
              <Text
                style={[styles.unit, unit === "USD" && styles.unitOn, usdRate == null && styles.unitOff]}
                onPress={() => {
                  if (usdRate == null) return;
                  setUnit("USD");
                }}
              >
                USD
              </Text>
            </View>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              keyboardType="decimal-pad"
              placeholder={unit === "XLM" ? "0.0000000" : "0.00"}
              placeholderTextColor={colors.textTertiary}
              style={styles.input}
              testID="tap-request-amount"
            />
            <Text style={styles.caption}>
              {amountXlm
                ? `${amountXlm} XLM${usdCaption ? ` · $${usdCaption}` : ""}`
                : "Enter the amount to request."}
            </Text>
            <Text style={styles.caption}>
              {usdRate
                ? `1 XLM = $${usdRate.toFixed(4)} on the Stellar DEX${rateAt ? ` · ${new Date(rateAt).toLocaleTimeString()}` : ""}`
                : rateError ?? "Fetching the live USD rate…"}
            </Text>
            <Text style={styles.kicker}>MEMO</Text>
            <TextInput
              value={memo}
              onChangeText={setMemo}
              placeholder="Optional"
              placeholderTextColor={colors.textTertiary}
              style={styles.input}
              maxLength={80}
              testID="tap-request-memo"
            />
            <Text style={styles.caption}>
              A short code is added to the on-chain memo so the other phone can match the payment. Notes longer than 13 bytes are shortened on chain. The full note still shows on the pay screen.
            </Text>
            <Text style={styles.kicker}>YOUR STELLAR ADDRESS</Text>
            <Text selectable style={styles.address}>
              {publicKey || "Add a wallet seed to request a payment."}
            </Text>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button
              label="Request payment"
              onPress={() => void startRequest()}
              loading={busy}
              disabled={!publicKey || busy || closed}
              testID="tap-request-start"
              style={{ marginTop: spacing.md }}
            />
            <Text style={styles.caption}>
              The request expires in 2 minutes. The other phone reads it over NFC, or from the QR code when NFC is off.
            </Text>
          </View>
        ) : null}

        {phase === "live" && request ? (
          <View>
            <Text style={styles.amount}>{request.amount} XLM</Text>
            {usdCaption ? <Text style={styles.caption}>about ${usdCaption}</Text> : null}
            <Text selectable style={styles.address}>{request.destination}</Text>
            {request.memo ? <Text style={styles.caption}>Memo: {request.memo}</Text> : null}
            <Text style={styles.caption}>Signed memo: {request.chainMemo}</Text>
            <Text style={styles.countdown}>
              {remainingSec > 0 ? `Expires in ${remainingSec}s` : "Waiting for the network to confirm…"}
            </Text>
            {nfcReady && !showQr ? (
              <Text style={styles.body}>Hold the other phone against this one. NFC is sending the payment link.</Text>
            ) : (
              <View style={styles.qrCard}>
                <QRCode value={qrValue} size={240} backgroundColor="#FFFFFF" color="#000000" ecl="M" />
              </View>
            )}
            <Button
              label={showQr ? "Hide QR code" : "Show QR code"}
              variant="secondary"
              onPress={() => setShowQr((value) => !value)}
              style={{ marginTop: spacing.md }}
            />
            {!nfcReady ? (
              <Button
                label="Turn on NFC"
                variant="secondary"
                onPress={() => void openNfcSettings()}
                style={{ marginTop: spacing.sm }}
              />
            ) : null}
            <Button
              label="Copy payment link"
              variant="secondary"
              onPress={() => void Clipboard.setStringAsync(request.raw)}
              style={{ marginTop: spacing.sm }}
            />
          </View>
        ) : null}

        {phase === "done" && request && result ? (
          <View>
            <Text style={styles.amount}>Paid</Text>
            <Text style={styles.caption}>{request.amount} XLM</Text>
            <Text style={styles.kicker}>FROM</Text>
            <Text selectable style={styles.address}>{result.from}</Text>
            <Text style={styles.kicker}>TRANSACTION</Text>
            <Text selectable style={styles.address}>{result.hash}</Text>
            <Text style={styles.caption}>Ledger {result.ledger} · {network}</Text>
            <Button
              label="View on Stellar Expert"
              variant="secondary"
              onPress={() => void Linking.openURL(`${deploymentFor(network).explorerTxBase}${result.hash}`)}
              style={{ marginTop: spacing.md }}
            />
            <Button label="Done" onPress={() => router.back()} style={{ marginTop: spacing.sm }} />
          </View>
        ) : null}

        {phase === "expired" ? (
          <View>
            <Text style={styles.amount}>Request expired</Text>
            <Text style={styles.body}>No matching payment arrived. Start a new request to get a new code.</Text>
            <Button label="Start over" onPress={() => { setPhase("form"); setRequest(null); }} style={{ marginTop: spacing.md }} />
          </View>
        ) : null}
        {phase === "live" ? <ActivityHint /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function ActivityHint() {
  return (
    <View style={styles.waiting}>
      <ActivityIndicator color={colors.cyan} />
      <Text style={styles.caption}>Checking Horizon for the payment.</Text>
    </View>
  );
}

function NetworkLine(props: {
  network: StellarNetwork;
  onChange: (network: StellarNetwork) => void;
  disabled?: boolean;
}) {
  const testnet = props.network === "testnet";
  const playRelease = isPlayReleaseBuild();
  return (
    <View style={styles.network}>
      <Text style={styles.networkText}>{playRelease || !testnet ? "Mainnet — real XLM" : "Testnet — practice XLM"}</Text>
      {playRelease ? null : (
        <Text
          style={[styles.unit, props.disabled && styles.unitOff]}
          onPress={() => {
            if (props.disabled) return;
            props.onChange(testnet ? "mainnet" : "testnet");
          }}
        >
          {testnet ? "Use mainnet" : "Use testnet"}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  headerBtn: { width: 32 },
  title: { flex: 1, textAlign: "center", color: colors.text, fontSize: 18, ...typography.heading },
  labelLine: { color: colors.gold, textAlign: "center", marginBottom: spacing.sm },
  kicker: { color: colors.textTertiary, marginTop: spacing.md, ...typography.label, fontSize: 11 },
  unitRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  unit: {
    color: colors.cyan,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.chip,
    paddingHorizontal: 12,
    paddingVertical: 6,
    overflow: "hidden",
  },
  unitOn: { backgroundColor: colors.tealMuted, borderColor: colors.cyan },
  unitOff: { opacity: 0.4 },
  input: {
    marginTop: spacing.sm,
    backgroundColor: colors.surface,
    color: colors.text,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.input,
    padding: spacing.md,
    fontSize: 22,
  },
  caption: { color: colors.textSecondary, marginTop: spacing.sm, fontSize: 13 },
  address: { color: colors.text, marginTop: spacing.sm, fontSize: 14, lineHeight: 20 },
  error: { color: colors.danger, marginTop: spacing.sm },
  amount: { color: colors.text, fontSize: 28, fontWeight: "700", marginTop: spacing.md },
  countdown: { color: colors.gold, marginTop: spacing.sm, fontSize: 16 },
  body: { color: colors.text, marginTop: spacing.md, fontSize: 15, lineHeight: 22 },
  qrCard: {
    alignSelf: "center",
    backgroundColor: "#FFFFFF",
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  network: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.sm,
  },
  networkText: { color: colors.text, flex: 1 },
  waiting: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md },
});
