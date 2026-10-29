// Bi-directional XLM/SOL ↔ USD converter.
//
// Renders on the Wallet screen between the balance card and the
// Send/Receive/Swap action row. Users can:
//   * type a token amount → see live USD equivalent
//   * type a USD amount   → see the equivalent token amount
//   * toggle between XLM and SOL (SOL gated behind premium)
//
// Prices come from the shared `usePrices` hook (backed by /api/prices,
// Coinbase primary, CoinGecko fallback, 60 s cache). The last-refresh
// timestamp and stale/error state are surfaced inline so users know
// exactly how fresh the number is.
//
// Numeric input handling: we accept both `.` and `,` as decimal marks
// so European-locale keyboards work, but we render output using the
// en-US locale for consistency with the rest of the app.

import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { colors, radii, spacing, typography } from "@/src/theme";
import {
  formatUsd,
  priceOf,
  relativeFromNow,
  tokenToUsd,
  usdToToken,
  usePrices,
  type Token,
} from "@/src/utils/prices";

type Direction = "token-to-usd" | "usd-to-token";

const TOKENS: { id: Token; label: string }[] = [
  { id: "XLM", label: "XLM" },
  { id: "SOL", label: "SOL" },
];

/**
 * Parse an amount string that may use `.` or `,` as decimal.
 * Empty strings and non-numeric inputs return NaN so callers can
 * blank the counterpart field.
 */
function parseAmount(raw: string): number {
  const cleaned = raw.replace(/,/g, ".").replace(/[^0-9.]/g, "");
  const n = Number(cleaned);
  return isFinite(n) ? n : NaN;
}

/** 4-decimal trimmed formatter for the counterpart input's placeholder value. */
function fmtTokenPlain(n: number | null): string {
  if (n == null || !isFinite(n)) return "";
  const abs = Math.abs(n);
  const decimals = abs >= 1 ? 4 : 6;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
    useGrouping: false, // no commas in inputs
  });
}

/** 2- or 4-decimal formatter for the USD input's placeholder value. */
function fmtUsdPlain(n: number | null): string {
  if (n == null || !isFinite(n)) return "";
  const abs = Math.abs(n);
  const decimals = abs >= 1 ? 2 : 4;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
    useGrouping: false,
  });
}

export function CurrencyConverter({ compact = false }: { compact?: boolean } = {}) {
  const { prices, loading, error, refresh } = usePrices();

  const [token, setToken] = useState<Token>("XLM");
  const [tokenInput, setTokenInput] = useState<string>("1");
  const [usdInput, setUsdInput] = useState<string>("");
  // Which field the user last edited — determines which side is the
  // source of truth and which is derived.
  const [lastEdited, setLastEdited] = useState<Direction>("token-to-usd");
  // Force a "seconds ago" re-render every 10 s without refetching.
  const [, setTick] = useState(0);

  // Tick every 10 s so the "Updated Xs ago" caption stays live without
  // triggering a network refresh.
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 10_000);
    return () => clearInterval(id);
  }, []);

  // Recompute the derived field whenever the source input, token, or
  // price snapshot changes.
  const price = useMemo(() => priceOf(prices, token), [prices, token]);
  useEffect(() => {
    if (lastEdited === "token-to-usd") {
      const amt = parseAmount(tokenInput);
      if (isNaN(amt) || tokenInput.trim() === "") {
        setUsdInput("");
      } else {
        const usd = tokenToUsd(prices, token, amt);
        setUsdInput(fmtUsdPlain(usd));
      }
    } else {
      const usd = parseAmount(usdInput);
      if (isNaN(usd) || usdInput.trim() === "") {
        setTokenInput("");
      } else {
        const t = usdToToken(prices, token, usd);
        setTokenInput(fmtTokenPlain(t));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenInput, usdInput, token, price, lastEdited]);

  const onTokenChange = useCallback((v: string) => {
    setLastEdited("token-to-usd");
    setTokenInput(v);
  }, []);
  const onUsdChange = useCallback((v: string) => {
    setLastEdited("usd-to-token");
    setUsdInput(v);
  }, []);

  const swapDirection = useCallback(() => {
    setLastEdited((d) => (d === "token-to-usd" ? "usd-to-token" : "token-to-usd"));
  }, []);

  const priceUnavailable = price == null;

  return (
    <View
      style={[styles.card, compact && styles.cardCompact]}
      testID="wallet-currency-converter"
    >
      <View style={styles.headerRow}>
        <Text style={styles.eyebrow}>CURRENCY CONVERTER</Text>
        <TouchableOpacity
          onPress={refresh}
          testID="currency-converter-refresh"
          accessibilityLabel="Refresh prices"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather
            name="refresh-cw"
            size={13}
            color={loading ? colors.textTertiary : colors.cyan}
          />
        </TouchableOpacity>
      </View>

      {/* Token toggle — XLM · SOL (both free) */}
      <View style={styles.tokenToggleRow}>
        {TOKENS.map((t) => {
          const active = token === t.id;
          return (
            <TouchableOpacity
              key={t.id}
              onPress={() => setToken(t.id)}
              style={[
                styles.tokenChip,
                active && styles.tokenChipActive,
              ]}
              testID={`currency-converter-token-${t.id.toLowerCase()}`}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={t.label}
            >
              <Text
                style={[
                  styles.tokenChipText,
                  active && styles.tokenChipTextActive,
                ]}
              >
                {t.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Bi-directional input row.
          Left  = token amount, Right = USD amount.  The middle icon
          shows the direction the user last edited so it's clear which
          way the math is flowing. */}
      <View style={styles.inputRow}>
        <View style={styles.inputCol}>
          <Text style={styles.inputLabel}>{token}</Text>
          <TextInput
            value={tokenInput}
            onChangeText={onTokenChange}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={colors.textTertiary}
            selectionColor={colors.cyan}
            editable={!priceUnavailable}
            style={styles.input}
            testID="currency-converter-token-input"
            accessibilityLabel={`${token} amount`}
          />
        </View>

        <TouchableOpacity
          onPress={swapDirection}
          style={styles.arrowBtn}
          accessibilityLabel="Swap conversion direction"
          testID="currency-converter-swap-direction"
        >
          <Feather
            name={lastEdited === "token-to-usd" ? "arrow-right" : "arrow-left"}
            size={14}
            color={colors.gold}
          />
        </TouchableOpacity>

        <View style={styles.inputCol}>
          <Text style={styles.inputLabel}>USD</Text>
          <TextInput
            value={usdInput}
            onChangeText={onUsdChange}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={colors.textTertiary}
            selectionColor={colors.cyan}
            editable={!priceUnavailable}
            style={styles.input}
            testID="currency-converter-usd-input"
            accessibilityLabel="USD amount"
          />
        </View>
      </View>

      {/* Status footer — current price + freshness caption + error strip */}
      <View style={styles.footerRow}>
        <Text style={styles.priceText} testID="currency-converter-spot">
          1 {token} = {price != null ? formatUsd(price) : "—"}
        </Text>
        <Text
          style={[
            styles.updatedText,
            prices?.stale ? styles.updatedTextStale : null,
          ]}
          testID="currency-converter-updated"
        >
          {prices?.fetched_at
            ? `Updated ${relativeFromNow(prices.fetched_at)}${prices.stale ? " • stale" : ""}`
            : loading
              ? "Fetching…"
              : "—"}
        </Text>
      </View>

      {error && !prices ? (
        <View style={styles.errorStrip} testID="currency-converter-error">
          <Feather name="wifi-off" size={12} color={colors.danger} />
          <Text style={styles.errorText}>
            Couldn&apos;t reach price service — tap refresh to retry.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    padding: spacing.md,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  cardCompact: {
    backgroundColor: "transparent",
    borderWidth: 0,
    borderColor: "transparent",
    paddingHorizontal: 0,
    paddingTop: spacing.sm,
    paddingBottom: 0,
    marginHorizontal: 0,
    marginBottom: 0,
    gap: 8,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  eyebrow: {
    color: colors.textTertiary,
    fontSize: 10,
    ...typography.label,
  },
  tokenToggleRow: {
    flexDirection: "row",
    gap: 6,
  },
  tokenChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceElevated,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  tokenChipActive: {
    backgroundColor: colors.cyanMuted,
    borderColor: colors.cyan,
  },
  tokenChipLocked: {
    opacity: 0.7,
    borderStyle: "dashed",
  },
  tokenChipText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  tokenChipTextActive: {
    color: colors.cyan,
  },
  tokenChipTextLocked: {
    color: colors.textSecondary,
  },
  premiumPip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: colors.goldMuted,
  },
  premiumPipText: {
    color: colors.gold,
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 0.5,
  },

  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
  },
  inputCol: {
    flex: 1,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  inputLabel: {
    color: colors.textTertiary,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  input: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
    padding: 0,
    minHeight: 22,
  },
  arrowBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.goldMuted,
    marginBottom: 4,
  },

  footerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 2,
  },
  priceText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: "600",
  },
  updatedText: {
    color: colors.textTertiary,
    fontSize: 10,
    fontWeight: "600",
  },
  updatedTextStale: {
    color: colors.warning ?? colors.gold,
  },

  errorStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: radii.sm,
    backgroundColor: colors.dangerMuted,
  },
  errorText: {
    color: colors.danger,
    fontSize: 11,
    fontWeight: "600",
    flex: 1,
  },
});
