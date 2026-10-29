import type { UserData } from "./sample-data";
import {
  SectionHeader,
  SettingsGroup,
  SettingsRow,
} from "@/src/components/settings-rows";

function shortPublicKey(publicKey: string): string {
  return publicKey.length > 12
    ? `${publicKey.slice(0, 6)}…${publicKey.slice(-6)}`
    : publicKey;
}

const VAULT_KIND: Record<UserData["vaults"][number]["kind"], string> = {
  "time-lock": "Time-lock",
  "cooling-off": "Cooling-off",
  vesting: "Vesting",
};

export function SampleDataSections({ data }: { data: UserData }) {
  const wallet = data.wallet;
  return (
    <>
      {wallet ? (
        <>
          <SectionHeader label="SAMPLE WALLET" />
          <SettingsGroup>
            <SettingsRow
              icon="credit-card"
              label={wallet.label}
              sublabel={`${wallet.availableXlm} XLM available · sample data`}
              value={shortPublicKey(wallet.publicKey)}
              last
              testID="settings-sample-wallet"
            />
          </SettingsGroup>
        </>
      ) : null}
      {data.vaults.length > 0 ? (
        <>
          <SectionHeader label="SAMPLE VAULTS" />
          <SettingsGroup>
            {data.vaults.map((vault, index) => (
              <SettingsRow
                key={vault.id}
                icon="lock"
                label={vault.name}
                sublabel={`${VAULT_KIND[vault.kind]} · ${vault.detail}`}
                value={`${vault.amountXlm} XLM`}
                last={index === data.vaults.length - 1}
              />
            ))}
          </SettingsGroup>
        </>
      ) : null}
      {data.activity.length > 0 ? (
        <>
          <SectionHeader label="SAMPLE ACTIVITY" />
          <SettingsGroup>
            {data.activity.map((item, index) => (
              <SettingsRow
                key={item.id}
                icon="activity"
                label={item.title}
                sublabel={`${item.detail} · ${item.whenLabel}`}
                last={index === data.activity.length - 1}
              />
            ))}
          </SettingsGroup>
        </>
      ) : null}
      {data.contacts.length > 0 ? (
        <>
          <SectionHeader label="SAMPLE CONTACTS" />
          <SettingsGroup>
            {data.contacts.map((contact, index) => (
              <SettingsRow
                key={contact.id}
                icon="user"
                label={contact.name}
                sublabel={contact.note}
                value={shortPublicKey(contact.publicKey)}
                last={index === data.contacts.length - 1}
              />
            ))}
          </SettingsGroup>
        </>
      ) : null}
    </>
  );
}
