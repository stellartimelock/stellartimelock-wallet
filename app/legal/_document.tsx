import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const BG = "#0A0E17";
const TEXT = "#A2A8B2";
const MUTED = "#687281";

export function LegalDocumentScreen({
  title,
  testID,
  backTestID,
  children,
}: {
  title: string;
  testID: string;
  backTestID: string;
  children: ReactNode;
}) {
  const router = useRouter();

  return (
    <SafeAreaView edges={["top"]} style={styles.root} testID={testID}>
      <View style={styles.headerBar}>
        <TouchableOpacity
          onPress={() =>
            router.canGoBack() ? router.back() : router.replace("/settings")
          }
          style={styles.headerBack}
          hitSlop={12}
          accessibilityLabel="Back"
          testID={backTestID}
        >
          <Feather name="arrow-left" size={22} color={TEXT} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title}
        </Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function DocHeading({ children }: { children: string }) {
  return <Text style={styles.docHeading}>{children}</Text>;
}

export function DocUpdated({ children }: { children: string }) {
  return <Text style={styles.docUpdated}>{children}</Text>;
}

export function DocIntro({ children }: { children: string }) {
  return <Text style={styles.docIntro}>{children}</Text>;
}

export function DocSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

export function DocParagraph({ children }: { children: string }) {
  return <Text style={styles.paragraph}>{children}</Text>;
}

export function DocBullet({ children }: { children: string }) {
  return (
    <View style={styles.bulletRow}>
      <Text style={styles.bulletMark}>•</Text>
      <Text style={styles.bulletText}>{children}</Text>
    </View>
  );
}

export function DocBoldLead({ lead, body }: { lead: string; body: string }) {
  return (
    <Text style={styles.paragraph}>
      <Text style={styles.bold}>{lead}</Text>
      {body}
    </Text>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  headerBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomColor: "rgba(255,255,255,0.06)",
    borderBottomWidth: 1,
    gap: 8,
  },
  headerBack: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    color: TEXT,
    fontSize: 17,
    fontWeight: "700",
  },
  body: {
    padding: 16,
    paddingBottom: 48,
    gap: 4,
  },
  docHeading: {
    color: TEXT,
    fontSize: 20,
    fontWeight: "800",
    lineHeight: 26,
    marginBottom: 6,
  },
  docUpdated: {
    color: MUTED,
    fontSize: 12,
    fontStyle: "italic",
    marginBottom: 16,
  },
  docIntro: {
    color: TEXT,
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 12,
  },
  section: {
    marginTop: 16,
    gap: 8,
  },
  sectionTitle: {
    color: TEXT,
    fontSize: 15,
    fontWeight: "800",
    marginBottom: 2,
  },
  paragraph: {
    color: MUTED,
    fontSize: 14,
    lineHeight: 21,
  },
  bold: {
    color: TEXT,
    fontWeight: "700",
  },
  bulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingLeft: 2,
  },
  bulletMark: {
    color: MUTED,
    fontSize: 14,
    lineHeight: 21,
    width: 12,
  },
  bulletText: {
    flex: 1,
    color: MUTED,
    fontSize: 14,
    lineHeight: 21,
  },
});
