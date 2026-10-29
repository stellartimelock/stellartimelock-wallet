// WalletSwitcherChip.
//
// Compact chip pinned to the top-left of the Wallet screen header.
// Tap opens a dropdown of every saved wallet: wallet-book entries plus
// Key Manager keys that are not in the book yet. Choosing one switches
// the active signer. Key Manager rows are copied into the book on tap;
// the saved key itself is never deleted.
//
// Design intent:
//   - Single tap to switch — no confirmation modal (destructive-safe).
//   - Long-press does nothing (avoid iOS accidental haptic firing).
//   - Chip auto-hides when fewer than two saved wallets exist.
//   - A stale active id does not hide the chip when other wallets exist.

import { Feather } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type View as RNView,
} from "react-native";

import { useToast } from "@/src/components/Toast";
import { listKeyEntries } from "@/src/security/key-manager-store";
import { useSession } from "@/src/state/session";
import { colors, radii, typography } from "@/src/theme";
import { importKeyManagerEntryAsWallet } from "@/src/wallet/key-manager-wallet-sync";
import { shortenAddress } from "@/src/wallet/stellar";

type Anchor = { x: number; y: number; w: number; h: number };

type SavedKey = { id: string; label: string; publicAddress: string };

type SwitchRow = {
  id: string;
  label: string;
  publicKey: string;
  bookId?: string;
  keyManagerId?: string;
};

function mergeSwitcherRows(
  wallets: { id: string; label: string; publicKey: string }[],
  savedKeys: SavedKey[],
): SwitchRow[] {
  const rows: SwitchRow[] = wallets.map((w) => ({
    id: w.id,
    label: w.label,
    publicKey: w.publicKey,
    bookId: w.id,
  }));
  const seen = new Set(rows.map((r) => r.publicKey.trim().toUpperCase()));
  for (const key of savedKeys) {
    const publicKey = (key.publicAddress || "").trim();
    const norm = publicKey.toUpperCase();
    if (!publicKey || seen.has(norm)) continue;
    seen.add(norm);
    rows.push({
      id: `km:${key.id}`,
      label: key.label || "Saved key",
      publicKey,
      keyManagerId: key.id,
    });
  }
  return rows;
}

export function WalletSwitcherChip({ testID }: { testID?: string }) {
  const { wallet, wallets, activeWalletId, switchWallet, refreshWallets } = useSession();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [savedKeys, setSavedKeys] = useState<SavedKey[]>([]);
  const chipRef = useRef<RNView>(null);

  const reloadSaved = useCallback(async () => {
    await refreshWallets().catch(() => undefined);
    try {
      const entries = await listKeyEntries();
      setSavedKeys(
        entries.map((entry) => ({
          id: entry.id,
          label: entry.label,
          publicAddress: entry.publicAddress,
        })),
      );
    } catch {
      setSavedKeys([]);
    }
  }, [refreshWallets]);

  useFocusEffect(
    useCallback(() => {
      // After the first paint, so price polling and buttons are already live.
      const handle = setTimeout(() => {
        void reloadSaved();
      }, 0);
      return () => clearTimeout(handle);
    }, [reloadSaved]),
  );

  const rows = useMemo(
    () => mergeSwitcherRows(wallets, savedKeys),
    [wallets, savedKeys],
  );
  const sessionKey = wallet?.publicKey?.trim().toUpperCase() ?? "";
  const active =
    rows.find((row) => row.bookId && row.bookId === activeWalletId) ??
    rows.find((row) => row.publicKey.trim().toUpperCase() === sessionKey) ??
    rows[0];

  const openMenu = useCallback(() => {
    chipRef.current?.measureInWindow((x, y, w, h) => {
      setAnchor({ x, y, w, h });
      setOpen(true);
    });
  }, []);

  const onPick = useCallback(
    async (row: SwitchRow) => {
      if (row.bookId && row.bookId === activeWalletId) {
        setOpen(false);
        return;
      }
      if (
        !row.bookId &&
        row.publicKey.trim().toUpperCase() === sessionKey &&
        sessionKey
      ) {
        setOpen(false);
        return;
      }
      try {
        if (row.bookId) {
          await switchWallet(row.bookId);
        } else if (row.keyManagerId) {
          const entries = await listKeyEntries();
          const entry = entries.find((item) => item.id === row.keyManagerId);
          if (!entry) throw new Error("Saved key is no longer on this device.");
          const { meta } = await importKeyManagerEntryAsWallet(entry, {
            makeActive: false,
          });
          await switchWallet(meta.id);
        }
        toast.show("Active wallet switched", "success");
      } catch {
        toast.show("Couldn't switch wallet", "error");
      } finally {
        setOpen(false);
        void reloadSaved();
      }
    },
    [activeWalletId, reloadSaved, sessionKey, switchWallet, toast],
  );

  const openManage = useCallback(() => {
    setOpen(false);
    router.push({ pathname: "/settings", params: { expand: "wallet" } });
  }, []);

  // Hide the chip when fewer than two saved wallets exist.
  if (rows.length < 2 || !active) return null;

  const dropdownTop = anchor ? anchor.y + anchor.h + 6 : 0;
  const dropdownLeft = anchor ? Math.max(8, anchor.x) : 0;

  return (
    <>
      <TouchableOpacity
        ref={chipRef}
        style={styles.chip}
        activeOpacity={0.7}
        onPress={openMenu}
        testID={testID ?? "wallet-switcher-chip"}
        accessibilityLabel={`Switch wallet, current: ${active.label}`}
      >
        <View style={styles.chipDot} />
        <Text style={styles.chipLabel} numberOfLines={1}>
          {active.label}
        </Text>
        <Feather name="chevron-down" size={12} color={colors.textSecondary} />
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable
          style={styles.backdrop}
          onPress={() => setOpen(false)}
          testID="wallet-switcher-backdrop"
        />
        {anchor ? (
          <View
            style={[
              styles.dropdown,
              { top: dropdownTop, left: dropdownLeft },
            ]}
            testID="wallet-switcher-sheet"
          >
            <ScrollView
              style={styles.dropdownScroll}
              bounces={false}
              nestedScrollEnabled
            >
              {rows.map((row) => {
                const isActive = row.id === active.id;
                return (
                  <TouchableOpacity
                    key={row.id}
                    style={[styles.row, isActive && styles.rowActive]}
                    onPress={() => onPick(row)}
                    activeOpacity={0.7}
                    testID={`wallet-switcher-row-${row.id}`}
                  >
                    <View style={[styles.dot, isActive && styles.dotOn]}>
                      {isActive ? (
                        <Feather name="check" size={9} color={colors.textInverse} />
                      ) : null}
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.rowLabel} numberOfLines={1}>
                        {row.label}
                      </Text>
                      <Text style={styles.rowAddress} numberOfLines={1}>
                        {shortenAddress(row.publicKey, 6, 4)}
                      </Text>
                    </View>
                    {isActive ? (
                      <Text style={styles.activeTag}>ON</Text>
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <TouchableOpacity
              onPress={openManage}
              style={styles.manageRow}
              activeOpacity={0.7}
              testID="wallet-switcher-manage"
            >
              <Feather name="settings" size={12} color={colors.cyan} />
              <Text style={styles.manageText}>Manage in Settings</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.surfaceFrost,
    borderWidth: 1,
    borderColor: colors.borderGlow,
    maxWidth: 160,
  },
  chipDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.statusActive,
  },
  chipLabel: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "600",
    flexShrink: 1,
  },

  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  dropdown: {
    position: "absolute",
    minWidth: 200,
    maxWidth: 260,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingVertical: 4,
    // Solid opaque card — no frost / transparency.
    overflow: "hidden",
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
  },
  dropdownScroll: {
    maxHeight: 220,
  },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  rowActive: { backgroundColor: colors.cyanMuted },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  dotOn: { backgroundColor: colors.cyan, borderColor: colors.cyan },
  rowLabel: { color: colors.text, fontSize: 12, fontWeight: "600" },
  rowAddress: {
    color: colors.textTertiary,
    fontSize: 10,
    ...typography.mono,
    marginTop: 1,
  },
  activeTag: {
    color: colors.cyan,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.4,
  },

  manageRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 2,
    paddingTop: 8,
    paddingBottom: 8,
    paddingHorizontal: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
  },
  manageText: { color: colors.cyan, fontSize: 11, fontWeight: "600", flex: 1 },
});
