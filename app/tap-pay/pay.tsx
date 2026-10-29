import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Modal,
  BackHandler,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/src/components/Button";
import { Checkbox } from "@/src/components/Checkbox";
import { useSession } from "@/src/state/session";
import { colors, radii, spacing, typography } from "@/src/theme";
import { listEntries } from "@/src/wallet/address-book";
import { deploymentFor } from "@/src/wallet/contract-config";
import { isPlayReleaseBuild } from "@/src/wallet/play-network";
import { generateTotpCode } from "@/src/security/totp/generate";
import { listTotpEntries } from "@/src/security/totp/store";

import { assessTapLimits, DEFAULT_TAP_LIMITS, isFirstTimeRecipient, type TapLimits } from "@/src/tap-pay/limits";
import { xlmToUsd } from "@/src/tap-pay/money";
import {
  clearPaymentRequest,
  currentCheckout,
  finishCheckout,
  openNfcSettings,
  readNfcStatus,
  readPaymentRequest,
  stopReadingPayment,
  type NfcStatus,
} from "@/src/tap-pay/native";
import { assessReplay, nonceKey, requestKey } from "@/src/tap-pay/replay";
import { loadTapPay, updateTapPay } from "@/src/tap-pay/history-device";
import { fetchHomeDomain, fetchMainnetXlmUsd, activeHorizon } from "@/src/tap-pay/horizon-pay";
import { signTapPaymentAfterBiometric } from "@/src/tap-pay/sign";
import {
  createPayRequest,
  networkForPassphrase,
  parsePayUri,
  type PayRequest,
} from "@/src/tap-pay/sep7";
import { markRequestPaid, spentSince, withNonceState, withPayment, withoutNonce, withWhitelistedDestination } from "@/src/tap-pay/save";

type Phase = "listen" | "confirm" | "sending" | "done";

function one(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default function PayScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    uri?: string;
    destination?: string;
    amount?: string;
    memo?: string;
    requestId?: string;
    label?: string;
  }>();
  const { wallet, network, setNetwork } = useSession();
  const settled = useRef(false);
  const [requestId, setRequestId] = useState(one(params.requestId));
  const [label, setLabel] = useState(one(params.label));
  const [phase, setPhase] = useState<Phase>("listen");
  const [fromUri, setFromUri] = useState(false);
  const [request, setRequest] = useState<PayRequest | null>(null);
  const [nfc, setNfc] = useState<NfcStatus>({ available: false, enabled: false });
  const [paste, setPaste] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saveWarning, setSaveWarning] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [limits, setLimits] = useState<TapLimits>(DEFAULT_TAP_LIMITS);
  const [spentToday, setSpentToday] = useState("0.0000000");
  const [firstTime, setFirstTime] = useState(false);
  const [checked, setChecked] = useState(false);
  const [savedName, setSavedName] = useState<string | null>(null);
  const [domain, setDomain] = useState<string | null>(null);
  const [usdRate, setUsdRate] = useState<number | null>(null);
  const [paid, setPaid] = useState<{ hash: string; ledger: number; source: string } | null>(null);
  const [replayBlock, setReplayBlock] = useState<string | null>(null);
  const [sendConfirmVisible, setSendConfirmVisible] = useState(false);
  const [rememberAddress, setRememberAddress] = useState(false);
  const [allowOverLimit, setAllowOverLimit] = useState(false);
  const [otpRequired, setOtpRequired] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [whitelisted, setWhitelisted] = useState(false);

  const acceptUri = useCallback((raw: string, id?: string) => {
    const parsed = parsePayUri(raw, Date.now());
    if (!parsed.ok) {
      setError(parsed.message);
      setPhase("listen");
      return;
    }
    setError(null);
    setRequest(parsed.request);
    setFromUri(true);
    setChecked(false);
    if (id) setRequestId(id);
    setPhase("confirm");
  }, []);

  const acceptForm = useCallback((destination: string, amount: string, memo: string, id: string, name: string) => {
    try {
      const created = createPayRequest({
        destination,
        amount,
        memo,
        networkPassphrase: deploymentFor(network).networkPassphrase,
      });
      setRequest(created);
      setFromUri(false);
      setRequestId(id);
      setLabel(name);
      setChecked(false);
      setError(null);
      setPhase("confirm");
    } catch (e) {
      setError(e instanceof Error ? e.message : "This payment could not be prepared.");
      setPhase("listen");
    }
  }, [network]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const checkout = await currentCheckout();
      if (!alive) return;
      const uri = one(params.uri) || (checkout?.action === "PAY" ? checkout.uri ?? "" : "");
      const destination = one(params.destination) || (checkout?.action === "PAY" ? checkout.destination ?? "" : "");
      const amount = one(params.amount) || (checkout?.action === "PAY" ? checkout.amount ?? "" : "");
      const memo = one(params.memo) || (checkout?.action === "PAY" ? checkout.memo ?? "" : "");
      const id = one(params.requestId) || (checkout?.action === "PAY" ? checkout.requestId : "");
      const name = one(params.label) || (checkout?.action === "PAY" ? checkout.label ?? "" : "");
      if (name) setLabel(name);
      if (id) setRequestId(id);
      if (uri) {
        acceptUri(uri, id);
        return;
      }
      if (destination && amount) {
        acceptForm(destination, amount, memo, id, name);
      }
    })();
    return () => {
      alive = false;
    };
    // The intent is read once when the screen opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phase !== "listen") return;
    let alive = true;
    void readNfcStatus().then((status) => {
      if (alive) setNfc(status);
    });
    void readPaymentRequest().then((uri) => {
      if (alive && uri) acceptUri(uri);
    });
    return () => {
      alive = false;
      void stopReadingPayment();
    };
  }, [acceptUri, phase]);

  useEffect(() => {
    if (!request || fromUri) return;
    const passphrase = deploymentFor(network).networkPassphrase;
    if (request.networkPassphrase === passphrase) return;
    try {
      setRequest(createPayRequest({
        destination: request.destination,
        amount: request.amount,
        memo: request.memo,
        networkPassphrase: passphrase,
      }));
      setChecked(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not move this payment to the selected network.");
    }
  }, [fromUri, network, request]);

  useEffect(() => {
    if (phase !== "confirm") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (!request) return;
    let alive = true;
    const net = networkForPassphrase(request.networkPassphrase);
    void (async () => {
      const [doc, book, rate] = await Promise.all([
        loadTapPay(),
        listEntries("stellar").catch(() => []),
        fetchMainnetXlmUsd().catch(() => null),
      ]);
      if (!alive) return;
      setLimits(doc.limits);
      if (net) setSpentToday(spentSince(doc, net, Date.now()));
      const listed = doc.whitelistedDestinations.includes(request.destination);
      setWhitelisted(listed);
      setOtpRequired(doc.requireOtpForNewAddresses && !listed);
      setFirstTime(isFirstTimeRecipient({
        destination: request.destination,
        knownRecipients: doc.knownRecipients,
        savedAddresses: book.map((entry) => entry.publicKey),
        whitelistedDestinations: doc.whitelistedDestinations,
      }));
      setSavedName(book.find((entry) => entry.publicKey === request.destination)?.label ?? null);
      const replay = assessReplay(doc.nonces, nonceKey(request.nonce), Date.now());
      const checkoutReplay = requestId
        ? assessReplay(doc.nonces, requestKey(requestId), Date.now())
        : "ok";
      if (replay === "replay" || checkoutReplay === "replay") {
        setReplayBlock("This payment was already sent.");
      } else if (replay === "pending" || checkoutReplay === "pending") {
        setReplayBlock("This payment is already waiting to be signed.");
      } else {
        setReplayBlock(null);
      }
      if (rate) setUsdRate(rate.usd);
      if (net) {
        const home = await fetchHomeDomain(deploymentFor(net).horizonUrl, request.destination);
        if (alive) setDomain(home);
      }
    })();
    return () => {
      alive = false;
    };
  }, [request, requestId]);

  const leave = useCallback(async () => {
    await stopReadingPayment();
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

  const requestNetwork = request ? networkForPassphrase(request.networkPassphrase) : null;
  const networkMatches = requestNetwork === network;
  const expired = request ? request.expiresAt <= now : false;
  const limit = request
    ? assessTapLimits({ amount: request.amount, limits, spentToday })
    : null;
  const usd = request && usdRate ? xlmToUsd(request.amount, usdRate) : null;
  const untrustedName = [label, domain].filter(Boolean).join(" · ");
  const playRelease = isPlayReleaseBuild();
  const otpOk = !otpRequired || otpCode.trim().length === 6;
  const overLimitOk = !limit || limit.ok || ((firstTime || allowOverLimit) && allowOverLimit);
  const canPay = Boolean(
    request &&
      networkMatches &&
      !expired &&
      overLimitOk &&
      !replayBlock &&
      (!firstTime || checked) &&
      otpOk &&
      phase === "confirm" &&
      wallet?.publicKey &&
      wallet.publicKey !== request.destination,
  );

  const verifyAuthenticator = useCallback(async (): Promise<boolean> => {
    if (!otpRequired) return true;
    const code = otpCode.trim();
    if (!/^\d{6}$/.test(code)) return false;
    const entries = await listTotpEntries();
    const now = Date.now();
    for (const entry of entries) {
      for (const skew of [-30_000, 0, 30_000]) {
        if (generateTotpCode(entry.secret, now + skew) === code) return true;
      }
    }
    return false;
  }, [otpCode, otpRequired]);

  const pay = useCallback(async () => {
    if (!request || !canPay || !requestNetwork) return;
    if (!(await verifyAuthenticator())) {
      setError("That authenticator code is not right. Nothing was sent.");
      setSendConfirmVisible(false);
      return;
    }
    const reviewed = request;
    const horizon = activeHorizon();
    if (horizon.passphrase !== reviewed.networkPassphrase) {
      setError("Switch to the network named on this payment before signing.");
      return;
    }
    setPhase("sending");
    setError(null);
    const clock = Date.now();
    const nonce = nonceKey(reviewed.nonce);
    const checkout = requestId ? requestKey(requestId) : "";
    try {
      await updateTapPay((doc) => {
        let next = withNonceState(doc, nonce, reviewed.expiresAt, "pending", clock);
        if (checkout) next = withNonceState(next, checkout, reviewed.expiresAt, "pending", clock);
        return next;
      });
    } catch (e) {
      setPhase("confirm");
      setError(e instanceof Error ? e.message : "Could not save this payment attempt.");
      return;
    }
    const result = await signTapPaymentAfterBiometric({
      destination: reviewed.destination,
      amount: reviewed.amount,
      memo: reviewed.chainMemo,
      horizonUrl: horizon.url,
      networkPassphrase: reviewed.networkPassphrase,
      prompt: `Pay ${reviewed.amount} XLM to ${reviewed.destination}`,
      confirmStillSafe: () => {
        const active = activeHorizon();
        return active.passphrase === reviewed.networkPassphrase && reviewed.expiresAt > Date.now();
      },
    });
    if (!result.ok) {
      try {
        await updateTapPay((doc) => {
          let next = withoutNonce(doc, nonce, Date.now());
          if (checkout) next = withoutNonce(next, checkout, Date.now());
          return next;
        });
      } catch {
        /* The pending mark expires with the request. */
      }
      setPhase("confirm");
      setError(result.message);
      return;
    }
    try {
      await updateTapPay((doc) => {
        let next = withPayment(doc, {
          id: reviewed.nonce,
          role: "pay",
          network: requestNetwork,
          destination: reviewed.destination,
          source: result.source,
          amount: reviewed.amount,
          memo: reviewed.memo,
          chainMemo: reviewed.chainMemo,
          hash: result.hash,
          ledger: result.ledger,
          createdAt: Date.now(),
          name: savedName || "",
        }, Date.now());
        if (requestId) next = markRequestPaid(next, requestId, reviewed.expiresAt, Date.now());
        if (rememberAddress) next = withWhitelistedDestination(next, reviewed.destination, Date.now());
        return next;
      });
    } catch (e) {
      setSaveWarning(e instanceof Error ? e.message : "The payment was sent, but the history file was not updated.");
    }
    settled.current = true;
    if (requestId) {
      await finishCheckout({
        requestId,
        ok: true,
        hash: result.hash,
        amount: reviewed.amount,
        destination: reviewed.destination,
        payer: result.source,
      });
    }
    setPaid({ hash: result.hash, ledger: result.ledger, source: result.source });
    setSendConfirmVisible(false);
    setPhase("done");
  }, [canPay, rememberAddress, request, requestId, requestNetwork, savedName, verifyAuthenticator]);

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Text style={styles.headerBtn} onPress={() => void leave()}>
          <Feather name="chevron-left" size={20} color={colors.text} />
        </Text>
        <Text style={styles.title}>Pay</Text>
        <View style={styles.headerBtn} />
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: insets.bottom + spacing.xl }}>
        {phase === "listen" ? (
          <View>
            <Text style={styles.body}>
              {nfc.available && nfc.enabled
                ? "Hold this phone against the one requesting payment."
                : "NFC is off or unavailable. Paste the payment link, or open the QR link from the camera."}
            </Text>
            {!nfc.enabled && nfc.available ? (
              <Button label="Turn on NFC" variant="secondary" onPress={() => void openNfcSettings()} style={{ marginTop: spacing.md }} />
            ) : null}
            <Text style={styles.kicker}>PAYMENT LINK</Text>
            <TextInput
              value={paste}
              onChangeText={setPaste}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="web+stellar:pay?..."
              placeholderTextColor={colors.textTertiary}
              style={styles.input}
              testID="tap-pay-paste"
            />
            <Button
              label="Review payment link"
              onPress={() => acceptUri(paste)}
              style={{ marginTop: spacing.md }}
              testID="tap-pay-review-link"
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>
        ) : null}

        {request && (phase === "confirm" || phase === "sending") ? (
          <View testID="tap-pay-confirm">
            <Text style={styles.kicker}>AMOUNT</Text>
            <Text selectable style={styles.amount} testID="tap-pay-amount">{request.amount} XLM</Text>
            <Text style={styles.caption}>{usd ? `$${usd} at the live Stellar DEX rate` : "USD rate unavailable"}</Text>
            <Text style={styles.kicker}>PAY THIS ADDRESS</Text>
            <Text selectable style={styles.address} testID="tap-pay-destination">{request.destination}</Text>
            <Text style={styles.caption} testID="tap-pay-untrusted-name">
              {untrustedName
                ? `Name on this link: ${untrustedName}. That name is not verified.`
                : "This link has no name. The address above is what gets paid."}
            </Text>
            {savedName ? (
              <Text style={styles.caption} testID="tap-pay-saved-name">
                Your saved name for this address: {savedName}
              </Text>
            ) : null}
            <Text style={styles.kicker}>MEMO</Text>
            <Text selectable style={styles.body}>{request.memo || "None"}</Text>
            <Text style={styles.caption}>Signed memo: {request.chainMemo}</Text>
            <Text style={styles.kicker}>NETWORK</Text>
            <Text style={styles.body}>{requestNetwork === "testnet" ? "Testnet" : "Mainnet"}</Text>
            {playRelease ? null : (
              <Text
                style={styles.link}
                onPress={() => {
                  if (!requestNetwork || phase === "sending") return;
                  void setNetwork(network === "testnet" ? "mainnet" : "testnet");
                }}
              >
                {network === "testnet" ? "Use mainnet" : "Use testnet"}
              </Text>
            )}
            {!networkMatches ? (
              <Text style={styles.warn}>
                This request is for {requestNetwork}. Switch networks before signing. The payment is not sent when you switch.
              </Text>
            ) : null}
            {network === "testnet" ? <Text style={styles.warn}>Testnet is on. This spends practice XLM.</Text> : null}
            {expired ? <Text style={styles.error}>This request has expired.</Text> : null}
            {limit && !limit.ok ? (
              <View style={styles.warnBox}>
                <Text style={styles.warn}>{limit.message}</Text>
                {firstTime ? (
                  <Checkbox
                    checked={allowOverLimit}
                    onChange={setAllowOverLimit}
                    label="Allow this new address once, over the usual cap"
                    testID="tap-pay-allow-over-limit"
                  />
                ) : (
                  <Text style={styles.error}>{limit.message}</Text>
                )}
              </View>
            ) : null}
            {replayBlock ? <Text style={styles.error}>{replayBlock}</Text> : null}
            {wallet?.publicKey === request.destination ? (
              <Text style={styles.error}>Choose a different recipient.</Text>
            ) : null}
            {!wallet?.publicKey ? (
              <Text style={styles.error}>Add a wallet seed before paying.</Text>
            ) : null}
            {firstTime ? (
              <View style={styles.warnBox}>
                <Text style={styles.warn}>You have not paid this address before. Check the full address above.</Text>
                <Checkbox
                  checked={checked}
                  onChange={setChecked}
                  label="I have checked this recipient"
                  testID="tap-pay-first-time"
                />
              </View>
            ) : null}
            {otpRequired ? (
              <View style={styles.warnBox}>
                <Text style={styles.warn}>New address — enter a 6-digit authenticator code.</Text>
                <TextInput
                  value={otpCode}
                  onChangeText={setOtpCode}
                  keyboardType="number-pad"
                  maxLength={6}
                  placeholder="000000"
                  placeholderTextColor={colors.textTertiary}
                  style={styles.input}
                  testID="tap-pay-otp"
                />
              </View>
            ) : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Text style={styles.caption}>
              A phone tap never sends. Fingerprint plus the next confirm are both required.
            </Text>
            <Button
              label="Continue"
              onPress={() => setSendConfirmVisible(true)}
              disabled={!canPay}
              testID="tap-pay-confirm-button"
              style={{ marginTop: spacing.md }}
            />
          </View>
        ) : null}

        {phase === "done" && request && paid ? (
          <View>
            <Text style={styles.amount}>Sent</Text>
            <Text selectable style={styles.body}>{request.amount} XLM</Text>
            <Text style={styles.kicker}>TO</Text>
            <Text selectable style={styles.address}>{request.destination}</Text>
            {untrustedName ? (
              <Text style={styles.caption}>Name on the link (not verified): {untrustedName}</Text>
            ) : null}
            <Text style={styles.kicker}>TRANSACTION</Text>
            <Text selectable style={styles.address}>{paid.hash}</Text>
            <Text style={styles.caption}>Ledger {paid.ledger} · {requestNetwork}</Text>
            {saveWarning ? <Text style={styles.warn}>{saveWarning}</Text> : null}
            <Button
              label="Copy transaction id"
              variant="secondary"
              onPress={() => void Clipboard.setStringAsync(paid.hash)}
              style={{ marginTop: spacing.md }}
            />
            {requestNetwork ? (
              <Button
                label="View on Stellar Expert"
                variant="secondary"
                onPress={() => void Linking.openURL(`${deploymentFor(requestNetwork).explorerTxBase}${paid.hash}`)}
                style={{ marginTop: spacing.sm }}
              />
            ) : null}
            <Button label="Done" onPress={() => router.back()} style={{ marginTop: spacing.sm }} />
          </View>
        ) : null}
      </ScrollView>
      <Modal
        visible={sendConfirmVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSendConfirmVisible(false)}
        testID="tap-pay-send-confirm"
      >
        <View style={styles.modalRoot}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Send this payment?</Text>
            {request ? (
              <>
                <Text selectable style={styles.amount} testID="tap-pay-send-amount">
                  {request.amount} XLM
                </Text>
                <Text selectable style={styles.address} testID="tap-pay-send-destination">
                  {request.destination}
                </Text>
              </>
            ) : null}
            <Text style={styles.caption}>
              Fingerprint is next. This is the in-app confirm. A tap on the phone does not send.
            </Text>
            <Checkbox
              checked={rememberAddress}
              onChange={setRememberAddress}
              label="Remember this address (optional)"
              testID="tap-pay-whitelist"
            />
            <Button
              label={phase === "sending" ? "Sending" : "Send now"}
              onPress={() => void pay()}
              loading={phase === "sending"}
              disabled={!canPay || phase === "sending"}
              testID="tap-pay-send-now"
              style={{ marginTop: spacing.md }}
            />
            <Button
              label="Cancel"
              variant="secondary"
              onPress={() => setSendConfirmVisible(false)}
              disabled={phase === "sending"}
              testID="tap-pay-send-cancel"
              style={{ marginTop: spacing.sm }}
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
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
  kicker: { color: colors.textTertiary, marginTop: spacing.md, ...typography.label, fontSize: 11 },
  amount: { color: colors.text, fontSize: 28, fontWeight: "700", marginTop: spacing.xs },
  name: { color: colors.text, fontSize: 18, fontWeight: "600", marginTop: spacing.xs },
  address: { color: colors.text, marginTop: spacing.xs, fontSize: 14, lineHeight: 20 },
  body: { color: colors.text, marginTop: spacing.sm, fontSize: 15, lineHeight: 22 },
  caption: { color: colors.textSecondary, marginTop: spacing.sm, fontSize: 13 },
  error: { color: colors.danger, marginTop: spacing.sm },
  warn: { color: colors.gold, marginTop: spacing.sm, marginBottom: spacing.sm },
  warnBox: {
    marginTop: spacing.md,
    borderColor: colors.borderGold,
    borderWidth: 1,
    padding: spacing.md,
  },
  link: { color: colors.cyan, marginTop: spacing.sm },
  input: {
    marginTop: spacing.sm,
    backgroundColor: colors.surface,
    color: colors.text,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.input,
    padding: spacing.md,
    fontSize: 14,
  },
  modalRoot: {
    flex: 1,
    justifyContent: "center",
    padding: spacing.lg,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  modalTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "700",
    marginBottom: spacing.sm,
  },
});
