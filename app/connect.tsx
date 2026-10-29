import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { copySecretToClipboard } from "@/src/security/clipboard-secret";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/src/components/Button";
import { Card } from "@/src/components/Card";
import { Checkbox } from "@/src/components/Checkbox";
import { useToast } from "@/src/components/Toast";
import { api } from "@/src/api/client";
import { useSession } from "@/src/state/session";
import { isGuidedTourActive } from "@/src/onboarding/guided-tour";
import { colors, radii, spacing, typography } from "@/src/theme";
import { setWalletMnemonic } from "@/src/security/session-keystore";
import {
  generateSeedPhrase,
  keypairFromMnemonic,
  mnemonicWords,
  type SeedStrength,
} from "@/src/wallet/seed-phrase";
import { promptSaveWalletToKeyManager } from "@/src/wallet/key-manager-wallet-sync";
import { shortenAddress } from "@/src/wallet/stellar";

type Phase = "choose" | "generating" | "ready";
type CreateMode = "secret_seed" | "seed_phrase";

export default function Connect() {
  const router = useRouter();
  const { setWallet, addBurnerWallet, addImportedWallet } = useSession();
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>("choose");
  const [mode, setMode] = useState<CreateMode>("seed_phrase");
  const [strength, setStrength] = useState<SeedStrength>(12);
  const [pubKey, setPubKey] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [secret, setSecret] = useState("");
  const [phrase, setPhrase] = useState("");
  const [acked, setAcked] = useState(false);

  const generate = async () => {
    try {
      setPhase("generating");
      if (mode === "seed_phrase") {
        // Phrase → SEP-0005 S… secret → same import/persist path.
        const mnemonic = await generateSeedPhrase(strength);
        const derived = keypairFromMnemonic(mnemonic);
        const { meta } = await addImportedWallet(
          "My Wallet",
          derived.secretSeed,
        );
        await setWalletMnemonic(meta.id, mnemonic);
        await api.registerWallet(derived.publicKey).catch(() => {
          /* backend optional */
        });
        setWallet(derived);
        setPubKey(derived.publicKey);
        setSecret(derived.secretSeed);
        setPhrase(mnemonic);
      } else {
        // Existing raw S… burner path — unchanged.
        await addBurnerWallet("My Wallet");
        const { loadActiveKeypair } = await import("@/src/wallet/wallet-book");
        const kp = await loadActiveKeypair();
        if (!kp) throw new Error("Failed to create wallet.");
        setPubKey(kp.publicKey);
        setSecret(kp.secretSeed);
        setPhrase("");
        await api.registerWallet(kp.publicKey).catch(() => {
          /* backend optional */
        });
        setWallet(kp);
      }
      setPhase("ready");
    } catch (e) {
      console.warn("[Connect] wallet generation failed:", e);
      toast.show("Couldn't create the wallet. Please try again.", "error");
      setPhase("choose");
    }
  };

  const copyAddress = async () => {
    await Clipboard.setStringAsync(pubKey);
    toast.show("Address copied", "success");
  };

  const copySecret = async () => {
    await copySecretToClipboard(secret);
    toast.show("Secret seed copied — store it offline. The clipboard clears in 30 seconds.", "info");
  };

  const copyPhrase = async () => {
    await copySecretToClipboard(phrase);
    toast.show("Recovery phrase copied — store it offline. The clipboard clears in 30 seconds.", "info");
  };

  const words = phrase ? mnemonicWords(phrase) : [];
  const backupMaterial = mode === "seed_phrase" ? phrase : secret;

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.root} testID="connect-screen">
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.back}
          testID="connect-back-button"
        >
          <Feather name="arrow-left" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Connect wallet</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
        {phase === "choose" && (
          <>
            <Card padded>
              <View style={styles.iconCircle}>
                <Feather name="zap" size={22} color={colors.teal} />
              </View>
              <Text style={styles.h2}>Generate a Stellar wallet</Text>
              <Text style={styles.p}>
                We&apos;ll create an Ed25519 keypair entirely on your device. Key
                material is written to your device&apos;s secure storage and{" "}
                <Text style={styles.pStrong}>
                  never sent to our backend or any external server
                </Text>
                .
              </Text>
            </Card>

            <Text style={styles.sectionLabel}>BACKUP FORMAT</Text>
            <View style={styles.modeRow}>
              <ModeChip
                testID="connect-mode-phrase"
                label="Seed phrase"
                selected={mode === "seed_phrase"}
                onPress={() => setMode("seed_phrase")}
              />
              <ModeChip
                testID="connect-mode-seed"
                label="Secret seed"
                selected={mode === "secret_seed"}
                onPress={() => setMode("secret_seed")}
              />
            </View>

            {mode === "seed_phrase" ? (
              <>
                <Text style={styles.sectionLabel}>PHRASE LENGTH</Text>
                <View style={styles.modeRow}>
                  <ModeChip
                    testID="connect-strength-12"
                    label="12 words"
                    selected={strength === 12}
                    onPress={() => setStrength(12)}
                  />
                  <ModeChip
                    testID="connect-strength-24"
                    label="24 words"
                    selected={strength === 24}
                    onPress={() => setStrength(24)}
                  />
                </View>
                <Card padded status="locked" style={{ marginTop: spacing.md }}>
                  <Text style={styles.eyebrow}>HOW THIS WORKS</Text>
                  <Bullet
                    icon="cpu"
                    text="BIP-39 recovery phrase from your device's CSPRNG."
                  />
                  <Bullet
                    icon="git-branch"
                    text="SEP-0005 path m/44'/148'/0' → standard Stellar S… secret."
                  />
                  <Bullet
                    icon="lock"
                    text="Phrase + derived secret saved to Keychain / EncryptedSharedPreferences."
                  />
                  <Bullet
                    icon="shield"
                    text="Compatible with LOBSTR, Freighter, and other SEP-0005 wallets."
                  />
                </Card>
              </>
            ) : (
              <Card padded status="locked" style={{ marginTop: spacing.md }}>
                <Text style={styles.eyebrow}>HOW THIS WORKS</Text>
                <Bullet icon="cpu" text="32 random bytes from your device's CSPRNG." />
                <Bullet
                  icon="lock"
                  text="Secret saved to Keychain (iOS) / EncryptedSharedPreferences (Android)."
                />
                <Bullet
                  icon="shield"
                  text="Secret seed never leaves the device — only your public G… address is sent to our servers."
                />
                <Bullet
                  icon="git-branch"
                  text="Standard Stellar Ed25519 — fully compatible with LOBSTR and Freighter."
                />
              </Card>
            )}

            <View style={{ height: spacing.lg }} />

            <Button
              testID="connect-generate-button"
              label={
                mode === "seed_phrase"
                  ? `Generate ${strength}-word phrase`
                  : "Generate Stellar keypair"
              }
              icon="key"
              onPress={generate}
            />
          </>
        )}

        {phase === "generating" && (
          <View style={styles.center}>
            <Feather name="loader" size={28} color={colors.teal} />
            <Text style={styles.p}>Generating keypair…</Text>
          </View>
        )}

        {phase === "ready" && (
          <>
            <Card padded status="locked">
              <Text style={styles.eyebrow}>YOUR STELLAR ADDRESS</Text>
              <Text testID="connect-public-key" style={styles.address} selectable>
                {pubKey}
              </Text>
              <Text style={styles.addressShort}>{shortenAddress(pubKey)}</Text>
              <TouchableOpacity
                onPress={copyAddress}
                style={styles.copy}
                testID="connect-copy-address"
              >
                <Feather name="copy" size={14} color={colors.teal} />
                <Text style={styles.copyText}>Copy address</Text>
              </TouchableOpacity>
            </Card>

            <Card
              padded
              style={{ marginTop: spacing.md, borderColor: colors.danger, borderWidth: 1 }}
            >
              <Text style={[styles.eyebrow, { color: colors.danger }]}>
                {mode === "seed_phrase"
                  ? "RECOVERY PHRASE — DO NOT SHARE"
                  : "SECRET SEED — DO NOT SHARE"}
              </Text>
              <Text style={styles.p}>
                This is the only key to your funds. Write it down and store it
                offline. Anyone with this{" "}
                {mode === "seed_phrase" ? "phrase" : "seed"} controls your vaults.
              </Text>
              {revealed ? (
                <>
                  {mode === "seed_phrase" ? (
                    <View style={styles.phraseGrid} testID="connect-secret-phrase">
                      {words.map((w, i) => (
                        <View key={`${i}-${w}`} style={styles.phraseChip}>
                          <Text style={styles.phraseIndex}>{i + 1}</Text>
                          <Text style={styles.phraseWord} selectable>
                            {w}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <View style={styles.secretBox}>
                      <Text testID="connect-secret-seed" selectable style={styles.secret}>
                        {secret}
                      </Text>
                    </View>
                  )}
                  <TouchableOpacity
                    onPress={mode === "seed_phrase" ? copyPhrase : copySecret}
                    style={styles.copy}
                    testID="connect-copy-secret"
                  >
                    <Feather name="copy" size={14} color={colors.gold} />
                    <Text style={[styles.copyText, { color: colors.gold }]}>
                      {mode === "seed_phrase" ? "Copy phrase" : "Copy secret"}
                    </Text>
                  </TouchableOpacity>
                </>
              ) : (
                <Button
                  testID="connect-reveal-secret"
                  label={
                    mode === "seed_phrase"
                      ? "Reveal recovery phrase"
                      : "Reveal secret seed"
                  }
                  variant="secondary"
                  icon="eye"
                  onPress={() => setRevealed(true)}
                />
              )}
            </Card>

            <Checkbox
              testID="connect-ack-checkbox"
              checked={acked}
              onChange={setAcked}
              label={
                mode === "seed_phrase"
                  ? "I've safely stored my recovery phrase. I understand losing it means losing access to my vaults."
                  : "I've safely stored my secret seed. I understand losing it means losing access to my vaults."
              }
            />

            <View style={{ height: spacing.md }} />

            <Button
              testID="connect-continue-button"
              label="Enter Stellar TimeLock"
              icon="arrow-right"
              disabled={!acked || !backupMaterial}
              onPress={async () => {
                if (secret && pubKey) {
                  const result = await promptSaveWalletToKeyManager({
                    label: "My Wallet",
                    secretSeed: secret,
                    publicAddress: pubKey,
                    seedPhrase: phrase || undefined,
                  });
                  if (result === "saved") {
                    toast.show("Saved to Key Manager", "success");
                  }
                }
                // Guided first-run: continue into creating the first time-lock vault.
                if (await isGuidedTourActive()) {
                  toast.show(
                    "Wallet ready. Next: set up your first time-lock vault.",
                    "info",
                  );
                  router.replace("/create-vault");
                } else {
                  router.replace("/(tabs)/wallet");
                }
              }}
            />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function ModeChip({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <TouchableOpacity
      testID={testID}
      onPress={onPress}
      style={[styles.modeChip, selected && styles.modeChipOn]}
      activeOpacity={0.85}
    >
      <Text style={[styles.modeChipText, selected && styles.modeChipTextOn]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function Bullet({ icon, text }: { icon: keyof typeof Feather.glyphMap; text: string }) {
  return (
    <View style={styles.bulletRow}>
      <Feather name={icon} size={14} color={colors.teal} />
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomColor: colors.borderSubtle,
    borderBottomWidth: 1,
  },
  back: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: colors.text, fontSize: 16, ...typography.heading },
  body: { padding: spacing.md, paddingBottom: spacing.xl },

  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: radii.sm,
    backgroundColor: colors.tealMuted,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  h2: { color: colors.text, fontSize: 20, ...typography.heading, marginBottom: 8 },
  p: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 4 },
  pStrong: { color: colors.text, fontWeight: "700" },
  eyebrow: { color: colors.teal, fontSize: 11, ...typography.label, marginBottom: spacing.sm },
  center: { alignItems: "center", paddingVertical: spacing.xxl, gap: 12 },

  sectionLabel: {
    color: colors.textTertiary,
    fontSize: 10,
    ...typography.label,
    marginTop: spacing.md,
    marginBottom: 8,
  },
  modeRow: { flexDirection: "row", gap: 8 },
  modeChip: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
    alignItems: "center",
  },
  modeChipOn: {
    borderColor: colors.teal,
    backgroundColor: colors.tealMuted,
  },
  modeChipText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: "700",
  },
  modeChipTextOn: { color: colors.teal },

  bulletRow: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 6 },
  bulletText: { color: colors.text, fontSize: 13, flex: 1 },

  address: {
    color: colors.text,
    fontSize: 13,
    fontFamily: undefined,
    ...typography.mono,
    marginTop: 4,
  },
  addressShort: { color: colors.textSecondary, fontSize: 12, marginTop: 6 },
  copy: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.sm },
  copyText: { color: colors.teal, fontSize: 13, fontWeight: "600" },

  secretBox: {
    backgroundColor: colors.surfaceElevated,
    padding: spacing.md,
    borderRadius: radii.md,
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secret: { color: colors.gold, fontSize: 13, ...typography.mono },

  phraseGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: spacing.sm,
  },
  phraseChip: {
    width: "30%",
    flexGrow: 1,
    minWidth: "28%",
    backgroundColor: colors.surfaceElevated,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 8,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  phraseIndex: {
    color: colors.textTertiary,
    fontSize: 10,
    fontWeight: "700",
    minWidth: 14,
  },
  phraseWord: {
    color: colors.gold,
    fontSize: 13,
    fontWeight: "600",
  },
});
