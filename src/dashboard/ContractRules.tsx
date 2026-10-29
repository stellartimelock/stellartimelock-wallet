import { Feather } from "@expo/vector-icons";
import React from "react";
import { Text, View } from "react-native";

import { Card } from "@/src/components/Card";
import { colors, spacing } from "@/src/theme";

import { styles } from "./styles";

export function VaultOnboardingBlock() {
  return (
    <View testID="dashboard-vault-onboarding">
      <Text style={styles.sectionTitle}>Time-lock savings</Text>

      <Card padded style={styles.onboardCard}>
        <View style={styles.onboardRow}>
          <View style={styles.onboardIconWrap}>
            <Feather name="lock" size={16} color={colors.teal} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.onboardTitle}>Locked vs Liquid</Text>
            <Text style={styles.onboardBody}>
              Your wallet holds liquid XLM you can send or swap any time.
              A vault holds XLM you cannot touch. Withdrawal is impossible
              until its unlock timestamp passes.
            </Text>
          </View>
        </View>
        <View style={styles.onboardRow}>
          <View style={styles.onboardIconWrap}>
            <Feather name="shield" size={16} color={colors.teal} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.onboardTitle}>Enforced on-chain</Text>
            <Text style={styles.onboardBody}>
              A Soroban smart contract on Stellar Mainnet enforces the lock.
              There is no admin, no support override, no back-door.
            </Text>
          </View>
        </View>
        <View style={styles.onboardRow}>
          <View style={styles.onboardIconWrap}>
            <Feather name="calendar" size={16} color={colors.teal} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.onboardTitle}>Any date, up to 1000 days</Text>
            <Text style={styles.onboardBody}>
              Set a specific unlock date, or a day-count between 1 and
              1000. You can always extend the lock further; you can
              never pull it back.
            </Text>
          </View>
        </View>
      </Card>

      <Text style={[styles.sectionTitle, { marginTop: spacing.lg }]}>
        Contract rules
      </Text>
      <Card padded testID="dashboard-contract-rules-empty">
        <ContractRule text="Only the vault owner can deposit, extend, or withdraw." />
        <ContractRule text="Deposits cannot change the unlock timestamp." />
        <ContractRule text="Extensions can only push the unlock further out." />
        <ContractRule text="Withdrawals are blocked until ledger time ≥ unlock_timestamp." />
        <ContractRule text="No admin, no pause, no emergency unlock." />
      </Card>
    </View>
  );
}

export function ContractRulesFooter() {
  return (
    <View style={{ marginTop: spacing.lg }} testID="dashboard-contract-rules-footer">
      <Text style={styles.footerEyebrow}>CONTRACT RULES</Text>
      <Card padded>
        <ContractRule text="Only the vault owner can deposit, extend, or withdraw." />
        <ContractRule text="Extensions push the unlock further out — never back." />
        <ContractRule text="No admin, no pause, no emergency unlock." />
      </Card>
    </View>
  );
}

function ContractRule({ text }: { text: string }) {
  return (
    <View style={styles.contractRuleRow}>
      <Feather name="check" size={13} color={colors.teal} />
      <Text style={styles.contractRuleText}>{text}</Text>
    </View>
  );
}
