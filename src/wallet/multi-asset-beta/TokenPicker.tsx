// TokenPicker — dropdown of well-known Mainnet Stellar Asset Contracts
// (SACs) + free-form paste input.
//
// The picker's job is to give a first-time user a curated shortlist of
// trustworthy tokens on Stellar Mainnet, plus a paste path for anyone
// who knows the specific contract address they want to lock. If a
// user pastes a malformed contract id we show an inline error and
// disable the parent Create button until it's fixed.
//
// The curated list holds real Mainnet SACs (native XLM, USDC-Circle,
// EURC-Circle).

import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import React, { useState } from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { useToast } from "@/src/components/Toast";
import { colors, radii, spacing, typography } from "@/src/theme";

/**
 * Curated list of well-known Stellar Mainnet Stellar Asset Contract
 * (SAC) addresses. The dropdown is a nice-to-have shortcut for new
 * users; the source of truth for what tokens are supported is
 * "whatever the user pastes". Add more here freely — the on-chain
 * contract accepts any valid address.
 *
 * SAC addresses were resolved from stellar.expert and match the
 * canonical `stellar contract asset id --asset <CODE:ISSUER>` output
 * against the public network passphrase.
 */
interface KnownToken {
  key: string;
  symbol: string;
  label: string;
  address: string;
}

export const KNOWN_MAINNET_TOKENS: KnownToken[] = [
  {
    key: "native-xlm",
    symbol: "XLM",
    label: "Stellar Lumens (native token)",
    address: "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA",
  },
  {
    key: "usdc-circle",
    symbol: "USDC",
    label: "USDC by Circle",
    address: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
  },
  {
    key: "eurc-circle",
    symbol: "EURC",
    label: "EURC by Circle",
    address: "CDTKPWPLOURQA2SGTKTUQOWRCBZEORB4BWBOMJ3D3ZTQQSGE5F6JBQLV",
  },
  {
    key: "aqua",
    symbol: "AQUA",
    label: "Aquarius (DEX governance token)",
    address: "CAUIKL3IYGMERDRUN6YSCLWVAKIFG5Q4YJHUKM4S4NJZQIA3BAS6OJPK",
  },
  {
    key: "yxlm",
    symbol: "yXLM",
    label: "Yield XLM (Ultra Stellar)",
    address: "CBZVSNVB55ANF24QVJL2K5QCLOAB6XITGTGXYEAF6NPTXYKEJUYQOHFC",
  },
  {
    key: "btc-lobstr",
    symbol: "BTC",
    label: "Bitcoin (LOBSTR bridge)",
    address: "CAO7DDJNGMOYQPRYDY5JVZ5YEK4UQBSMGLAEWRCUOTRMDSBMGWSAATDZ",
  },
  {
    key: "eth-ultra",
    symbol: "ETH",
    label: "Ethereum (Ultra Capital bridge)",
    address: "CBH4M45TQBLDPXOK6L7VYKMEJWFITBOL64BN3WDAIIDT4LNUTWTTOCKF",
  },
  {
    key: "btcln",
    symbol: "BTCLN",
    label: "Bitcoin (Lightning bridge)",
    address: "CBHIQPUXLFLC5O44ZJVUTCL5LMZFLVGU5DEIGSYKBSAPFMOGTKOQEPFM",
  },
  {
    key: "shx",
    symbol: "SHX",
    label: "SHX (Stronghold)",
    address: "CCKCKCPHYVXQD4NECBFJTFSCU2AMSJGCNG4O6K4JVRE2BLPR7WNDBQIQ",
  },
  {
    key: "arst",
    symbol: "ARST",
    label: "Argentine Peso (Anclap)",
    address: "CCRPYMVKZLWGZHEDZ23FOE22E3T3HOCNP5Y2EFZFVRUVIXU5NJ7UNGV2",
  },
];

/**
 * Backwards-compatible alias for the pre-Mainnet name. Kept exported
 * so external tooling / older imports still resolve.
 * @deprecated Use `KNOWN_MAINNET_TOKENS`.
 */
export const KNOWN_TESTNET_TOKENS = KNOWN_MAINNET_TOKENS;

/**
 * Loose contract-address validator: `C` + 55 base32 characters.
 * Full StrKey checksum validation lives in `stellar-sdk` — we do the
 * cheap pre-check here so the UI can gate the Create button without
 * pulling in the full SDK for a form field.
 */
export function isValidContractAddress(s: string): boolean {
  if (!s) return false;
  const trimmed = s.trim();
  if (trimmed.length !== 56) return false;
  if (!trimmed.startsWith("C")) return false;
  // Base32 alphabet used by StrKey (RFC 4648 base32, no padding).
  return /^[A-Z2-7]+$/.test(trimmed);
}

interface Props {
  value: string;
  onChange: (address: string) => void;
}

export function TokenPicker({ value, onChange }: Props) {
  const toast = useToast();
  const [expanded, setExpanded] = useState(false);
  const [pasteMode, setPasteMode] = useState(false);
  const [search, setSearch] = useState("");

  const trimmed = value.trim();
  const validity: "empty" | "ok" | "malformed" = !trimmed
    ? "empty"
    : isValidContractAddress(trimmed)
      ? "ok"
      : "malformed";

  const selectedKnown = KNOWN_MAINNET_TOKENS.find(
    (t) => t.address === trimmed,
  );

  // Filter the curated list based on the search query. Empty query
  // returns the full list — this is the default state on first
  // expand. Case-insensitive match on either the ticker symbol or
  // the human-readable label.
  const searchTrim = search.trim();
  const filteredTokens = React.useMemo(() => {
    if (!searchTrim) return KNOWN_MAINNET_TOKENS;
    const q = searchTrim.toLowerCase();
    return KNOWN_MAINNET_TOKENS.filter(
      (t) =>
        t.symbol.toLowerCase().includes(q) ||
        t.label.toLowerCase().includes(q) ||
        // Also match against the SAC address itself so pasting the
        // exact address of a curated token surfaces that token's
        // curated row (e.g. tapping BTCLN's SAC then re-pasting it
        // finds the BTCLN entry instead of falling through to the
        // generic "Use this address" affordance).
        t.address.toLowerCase().includes(q),
    );
  }, [searchTrim]);

  // If the search input LOOKS like a contract address, treat it as
  // one — power users can just paste directly into the search bar
  // without hunting for a paste toggle.
  const searchLooksLikeAddress = isValidContractAddress(searchTrim);

  const paste = async () => {
    try {
      const raw = (await Clipboard.getStringAsync()).trim();
      if (!raw) {
        toast.show("Clipboard is empty.", "error");
        return;
      }
      onChange(raw);
      setPasteMode(true);
      setExpanded(false);
    } catch (e) {
      toast.show(
        `Paste failed: ${e instanceof Error ? e.message : String(e)}`,
        "error",
      );
    }
  };

  return (
    <View style={styles.wrap} testID="multi-asset-token-picker">
      <Text style={styles.label}>TOKEN</Text>

      {/* Selected value display + expand chevron */}
      <TouchableOpacity
        onPress={() => setExpanded((v) => !v)}
        style={styles.selectedRow}
        activeOpacity={0.85}
        testID="multi-asset-token-selected"
      >
        <Feather
          name={
            validity === "ok"
              ? "check-circle"
              : validity === "malformed"
                ? "alert-circle"
                : "circle"
          }
          size={14}
          color={
            validity === "ok"
              ? colors.teal
              : validity === "malformed"
                ? colors.danger
                : colors.textTertiary
          }
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.selectedLabel} numberOfLines={1}>
            {selectedKnown
              ? `${selectedKnown.symbol} — ${selectedKnown.label}`
              : trimmed
                ? `${trimmed.slice(0, 6)}…${trimmed.slice(-6)}`
                : "Choose a token or paste a contract address"}
          </Text>
          {validity === "malformed" ? (
            <Text style={styles.errorText}>
              That doesn&apos;t look right. A token address is exactly
              56 characters and starts with C.
            </Text>
          ) : null}
        </View>
        <Feather
          name={expanded ? "chevron-up" : "chevron-down"}
          size={16}
          color={colors.textSecondary}
        />
      </TouchableOpacity>

      {expanded ? (
        <View style={styles.dropdown}>
          {/* Unified search bar. */}
          <View style={styles.searchRow}>
            <Feather name="search" size={12} color={colors.textTertiary} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search by name/symbol, or paste an address"
              placeholderTextColor={colors.textTertiary}
              style={styles.searchInput}
              autoCorrect={false}
              spellCheck={false}
              testID="multi-asset-token-search"
            />
            {search.length > 0 ? (
              <TouchableOpacity
                onPress={() => setSearch("")}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                testID="multi-asset-token-search-clear"
              >
                <Feather name="x" size={12} color={colors.textSecondary} />
              </TouchableOpacity>
            ) : null}
          </View>

          {/* If the search input is a valid contract address, offer a
              one-tap "Use this address" affordance — power users can
              paste directly here instead of hunting for the paste
              toggle. */}
          {searchLooksLikeAddress && !filteredTokens.some((t) => t.address === searchTrim) ? (
            <TouchableOpacity
              onPress={() => {
                onChange(searchTrim);
                setSearch("");
                setExpanded(false);
              }}
              style={[styles.optionRow, styles.customAddressRow]}
              testID="multi-asset-token-use-typed-address"
            >
              <Feather name="link" size={12} color={colors.teal} />
              <View style={{ flex: 1 }}>
                <Text style={styles.optionSymbol}>Use this address</Text>
                <Text style={styles.optionLabel} numberOfLines={1}>
                  {searchTrim.slice(0, 8)}…{searchTrim.slice(-8)}
                </Text>
              </View>
            </TouchableOpacity>
          ) : null}

          {filteredTokens.length === 0 && !searchLooksLikeAddress ? (
            <View style={styles.emptySearchRow}>
              <Text style={styles.emptySearchText}>
                No matching tokens. Paste a full contract address to add
                a custom token.
              </Text>
            </View>
          ) : (
            filteredTokens.map((t) => {
              const active = t.address === trimmed;
              return (
                <TouchableOpacity
                  key={t.key}
                  onPress={() => {
                    onChange(t.address);
                    setExpanded(false);
                    setPasteMode(false);
                    setSearch("");
                  }}
                  style={[styles.optionRow, active && styles.optionRowActive]}
                  testID={`multi-asset-token-option-${t.key}`}
                >
                  <Feather
                    name={active ? "check" : "circle"}
                    size={12}
                    color={active ? colors.teal : colors.textTertiary}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.optionSymbol}>{t.symbol}</Text>
                    <Text style={styles.optionLabel}>{t.label}</Text>
                  </View>
                </TouchableOpacity>
              );
            })
          )}

          {/* Divider + paste-custom action */}
          <View style={styles.divider} />
          <TouchableOpacity
            onPress={() => {
              setPasteMode(true);
              setExpanded(false);
            }}
            style={styles.pasteBtn}
            testID="multi-asset-token-paste-mode"
          >
            <Feather name="edit-3" size={12} color={colors.gold} />
            <Text style={styles.pasteBtnText}>
              Paste any Stellar token contract address
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {pasteMode ? (
        <View style={styles.pasteRow}>
          <TextInput
            value={value}
            onChangeText={onChange}
            placeholder="Contract address (starts with C, 56 characters)"
            placeholderTextColor={colors.textTertiary}
            style={styles.pasteInput}
            autoCapitalize="characters"
            autoCorrect={false}
            spellCheck={false}
            testID="multi-asset-token-paste-input"
          />
          <TouchableOpacity
            onPress={paste}
            style={styles.pasteClipBtn}
            testID="multi-asset-token-paste-clipboard"
          >
            <Feather name="clipboard" size={12} color={colors.teal} />
            <Text style={styles.pasteClipBtnText}>Paste</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Look up a token's symbol from its contract
 * address. Used by Create Vault to show the correct unit label (e.g.
 * "INITIAL DEPOSIT (USDC)" instead of the hard-coded XLM). Returns
 * undefined when the address isn't in the curated list — the caller
 * falls back to a generic "amount" label.
 */
export function tokenSymbolForAddress(address: string): string | undefined {
  const t = KNOWN_MAINNET_TOKENS.find((k) => k.address === address.trim());
  return t?.symbol;
}

/**
 * Detect the Stellar Mainnet native XLM SAC.
 * The native XLM SAC never needs a trust line (every classic Stellar
 * account carries XLM by default), so callers can skip the trust-line
 * pre-check and reminder banners for this specific address.
 */
export const NATIVE_XLM_MAINNET_SAC =
  "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA";
export function isNativeXlmAddress(address: string): boolean {
  return address.trim() === NATIVE_XLM_MAINNET_SAC;
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.md },
  label: {
    color: colors.textTertiary,
    fontSize: 10,
    ...typography.label,
    marginBottom: 6,
  },
  selectedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  selectedLabel: { color: colors.text, fontSize: 13, fontWeight: "600" },
  errorText: { color: colors.danger, fontSize: 11, marginTop: 2 },
  dropdown: {
    marginTop: 6,
    padding: 4,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    marginBottom: 4,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 12,
    padding: 0,
  },
  emptySearchRow: {
    padding: 12,
  },
  emptySearchText: {
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 15,
  },
  customAddressRow: {
    borderColor: colors.teal,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: colors.tealMuted,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 10,
    borderRadius: radii.sm,
  },
  optionRowActive: { backgroundColor: colors.surfaceElevated },
  optionSymbol: { color: colors.text, fontSize: 13, fontWeight: "800" },
  optionLabel: { color: colors.textSecondary, fontSize: 11, marginTop: 1 },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderSubtle,
    marginVertical: 4,
  },
  pasteBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    padding: 10,
    borderRadius: radii.sm,
  },
  pasteBtnText: { color: colors.gold, fontSize: 12, fontWeight: "700" },
  pasteRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 6,
  },
  pasteInput: {
    flex: 1,
    color: colors.text,
    fontSize: 12,
    ...typography.mono,
    backgroundColor: colors.surfaceElevated,
    padding: 10,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pasteClipBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: radii.sm,
    backgroundColor: colors.tealMuted,
    borderWidth: 1,
    borderColor: colors.teal,
  },
  pasteClipBtnText: { color: colors.teal, fontSize: 11, fontWeight: "800" },
});
