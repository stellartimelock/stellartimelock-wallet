// Self-contained month-grid picker — community DateTimePicker fails on web/Android.

import { Feather } from "@expo/vector-icons";
import React, { useMemo, useRef, useState, useEffect } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { colors, radii, spacing, typography } from "@/src/theme";

interface Props {
  visible: boolean;
  value: Date;
  minDate?: Date;
  maxDate?: Date;
  onSelect: (d: Date) => void;
  onClose: () => void;
}

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function sameDay(a: Date | null | undefined, b: Date | null | undefined): boolean {
  if (!a || !b) return false;
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function buildMonth(year: number, month: number): (Date | null)[] {
  const firstOfMonth = new Date(year, month, 1);
  const firstWeekday = firstOfMonth.getDay(); // 0 = Sunday
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function Calendar({
  visible,
  value,
  minDate,
  maxDate,
  onSelect,
  onClose,
}: Props) {
  const today = useMemo(() => startOfDay(new Date()), []);
  const [cursor, setCursor] = useState<{ year: number; month: number }>(() => {
    const v = value && !Number.isNaN(value.getTime()) ? value : today;
    const anchor = v.getTime() >= today.getTime() ? v : today;
    return { year: anchor.getFullYear(), month: anchor.getMonth() };
  });

  useEffect(() => {
    if (visible) {
      const v = value && !Number.isNaN(value.getTime()) ? value : today;
      const anchor = v.getTime() >= today.getTime() ? v : today;
      setCursor({ year: anchor.getFullYear(), month: anchor.getMonth() });
    }
  }, [visible, value, today]);

  const cells = useMemo(
    () => buildMonth(cursor.year, cursor.month),
    [cursor.year, cursor.month]
  );

  const isOutOfRange = (d: Date): boolean => {
    if (minDate && d < startOfDay(minDate)) return true;
    if (maxDate && d > startOfDay(maxDate)) return true;
    return false;
  };

  const goPrev = () => {
    const m = cursor.month - 1;
    if (m < 0) setCursor({ year: cursor.year - 1, month: 11 });
    else setCursor({ ...cursor, month: m });
  };
  const goNext = () => {
    const m = cursor.month + 1;
    if (m > 11) setCursor({ year: cursor.year + 1, month: 0 });
    else setCursor({ ...cursor, month: m });
  };

  const prevDisabledRef = useRef(false);
  const nextDisabledRef = useRef(false);

  // Disable arrows when the next/prev page is entirely out of range.
  const prevDisabled = (() => {
    if (!minDate) return false;
    const lastOfPrev = new Date(cursor.year, cursor.month, 0);
    return lastOfPrev < startOfDay(minDate);
  })();
  const nextDisabled = (() => {
    if (!maxDate) return false;
    const firstOfNext = new Date(cursor.year, cursor.month + 1, 1);
    return firstOfNext > startOfDay(maxDate);
  })();
  prevDisabledRef.current = prevDisabled;
  nextDisabledRef.current = nextDisabled;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} testID="calendar-backdrop" />
      <View style={styles.sheet} testID="calendar-sheet">
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={goPrev}
            disabled={prevDisabled}
            style={[styles.arrow, prevDisabled && styles.arrowDisabled]}
            testID="calendar-prev"
          >
            <Feather
              name="chevron-left"
              size={20}
              color={prevDisabled ? colors.textTertiary : colors.text}
            />
          </TouchableOpacity>
          <Text
            style={styles.title}
            testID="calendar-title"
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
          >
            {MONTHS[cursor.month]} {cursor.year}
          </Text>
          <TouchableOpacity
            onPress={goNext}
            disabled={nextDisabled}
            style={[styles.arrow, nextDisabled && styles.arrowDisabled]}
            testID="calendar-next"
          >
            <Feather
              name="chevron-right"
              size={20}
              color={nextDisabled ? colors.textTertiary : colors.text}
            />
          </TouchableOpacity>
        </View>

        <View style={styles.weekRow}>
          {WEEKDAYS.map((w, i) => (
            <Text key={i} style={styles.weekday}>
              {w}
            </Text>
          ))}
        </View>

        <View style={styles.grid} testID="calendar-grid">
          {cells.map((cell, idx) => {
            if (!cell) return <View key={idx} style={styles.cell} />;
            const disabled = isOutOfRange(cell);
            const isToday = sameDay(cell, today);
            const isSelected = sameDay(cell, value);
            return (
              <TouchableOpacity
                key={idx}
                disabled={disabled}
                onPress={() => onSelect(cell)}
                style={[
                  styles.cell,
                  isSelected && styles.cellSelected,
                  !isSelected && isToday && styles.cellToday,
                ]}
                activeOpacity={0.75}
                testID={`calendar-day-${cell.getFullYear()}-${cell.getMonth() + 1}-${cell.getDate()}`}
              >
                <Text
                  style={[
                    styles.dayText,
                    disabled && styles.dayTextDisabled,
                    isSelected && styles.dayTextSelected,
                    !isSelected && isToday && styles.dayTextToday,
                  ]}
                >
                  {cell.getDate()}
                </Text>
                {isToday && !isSelected ? (
                  <View style={styles.todayDot} />
                ) : null}
              </TouchableOpacity>
            );
          })}
        </View>

        <TouchableOpacity
          onPress={() => {
            setCursor({ year: today.getFullYear(), month: today.getMonth() });
          }}
          style={styles.todayBtn}
          testID="calendar-today"
        >
          <Feather name="calendar" size={12} color={colors.teal} />
          <Text style={styles.todayText}>Today</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={onClose}
          style={styles.closeButton}
          testID="calendar-close"
        >
          <Text style={styles.closeText}>Close</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const CELL_WIDTH = `${100 / 7}%` as const;

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.65)" },
  sheet: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    top: "12%",
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm + 2,
  },
  arrow: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  arrowDisabled: { opacity: 0.35 },
  title: {
    color: colors.text,
    fontSize: 16,
    ...typography.heading,
    flex: 1,
    textAlign: "center",
    paddingHorizontal: 4,
  },
  weekRow: { flexDirection: "row", marginBottom: 6 },
  weekday: {
    width: CELL_WIDTH,
    textAlign: "center",
    color: colors.textTertiary,
    fontSize: 11,
    ...typography.label,
  },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: {
    width: CELL_WIDTH,
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 2,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "transparent",
  },
  cellSelected: {
    backgroundColor: colors.teal,
    borderColor: colors.teal,
  },
  cellToday: {
    borderColor: colors.teal,
    borderWidth: 2,
    backgroundColor: colors.tealMuted,
  },
  dayText: { color: colors.text, fontSize: 15, fontWeight: "600", ...typography.mono },
  dayTextDisabled: { color: colors.textTertiary, opacity: 0.4 },
  dayTextSelected: { color: colors.textInverse, fontWeight: "800" },
  dayTextToday: { color: colors.teal, fontWeight: "800" },
  todayDot: {
    position: "absolute",
    bottom: 2,
    right: 4,
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: colors.teal,
  },
  swipeHint: {
    marginTop: spacing.sm,
    color: colors.textTertiary,
    fontSize: 11,
    textAlign: "center",
  },

  todayBtn: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginTop: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.tealMuted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.teal,
  },
  todayText: { color: colors.teal, fontSize: 12, fontWeight: "700" },
  closeButton: { alignSelf: "center", paddingVertical: spacing.sm, marginTop: 6 },
  closeText: { color: colors.textSecondary, fontSize: 13, fontWeight: "600" },
});
