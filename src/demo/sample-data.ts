// Realistic sample wallet content for Demo mode.
// Public keys are randomly generated, unfunded accounts. No seeds live here.

export interface WalletProfile {
  label: string;
  publicKey: string;
  availableXlm: string;
}

export interface VaultRecord {
  id: string;
  name: string;
  kind: "time-lock" | "cooling-off" | "vesting";
  amountXlm: string;
  detail: string;
  status: string;
}

export interface ActivityRecord {
  id: string;
  title: string;
  detail: string;
  whenLabel: string;
}

export interface ContactRecord {
  id: string;
  name: string;
  publicKey: string;
  note: string;
}

export interface UserData {
  wallet: WalletProfile | null;
  vaults: VaultRecord[];
  activity: ActivityRecord[];
  contacts: ContactRecord[];
}

export function emptyUserData(): UserData {
  return { wallet: null, vaults: [], activity: [], contacts: [] };
}

/** Fresh object every call so a writer can't mutate the template. */
export function createSampleUserData(): UserData {
  return {
    wallet: {
      label: "Harbor sample",
      publicKey: "GB6P6K3CFDBVJ2N6IYO526U33UTWRYJLSDYF2NJC54B3BGO46URROVJX",
      availableXlm: "842.15",
    },
    vaults: [
      {
        id: "vault-emergency",
        name: "Emergency reserve",
        kind: "time-lock",
        amountXlm: "1500.00",
        detail: "Unlocks 1 Jun 2027",
        status: "Locked",
      },
      {
        id: "vault-deposit",
        name: "Apartment deposit",
        kind: "cooling-off",
        amountXlm: "600.00",
        detail: "14-day notice before release",
        status: "Notice not started",
      },
      {
        id: "vault-grant",
        name: "Studio grant",
        kind: "vesting",
        amountXlm: "2400.00",
        detail: "200 XLM each month · 8 releases left",
        status: "Vesting",
      },
    ],
    activity: [
      {
        id: "act-received",
        title: "Received from Northwind Studio",
        detail: "250 XLM",
        whenLabel: "12 Sep 2026",
      },
      {
        id: "act-locked",
        title: "Locked Emergency reserve",
        detail: "1,500 XLM",
        whenLabel: "2 Aug 2026",
      },
      {
        id: "act-checkin",
        title: "Check-in recorded",
        detail: "Dead man's switch",
        whenLabel: "28 Sep 2026",
      },
      {
        id: "act-cooling",
        title: "Armed cooling-off",
        detail: "Apartment deposit",
        whenLabel: "20 Sep 2026",
      },
    ],
    contacts: [
      {
        id: "contact-northwind",
        name: "Northwind Studio",
        publicKey: "GAWEHPRGF6VWNIZUR5NO7JR7DGRPX5PGZMX6HFJJI5AX3OWQ4VRJTK5C",
        note: "Invoices and grant payments",
      },
      {
        id: "contact-alex",
        name: "Alex Rivera",
        publicKey: "GAP7KCHNWMPVRWOFITQNRNV6BN3XODNS5YQSKLG6S4EYSEZ3544BIB3C",
        note: "Shared rent vault",
      },
      {
        id: "contact-sam",
        name: "Sam Okonkwo",
        publicKey: "GD7TBA5EBJXZPZ3BRRY4LSWPKAYJBFRTMQ5R5PFEW3LQY627HMBCB6WL",
        note: "Beneficiary on the studio grant",
      },
    ],
  };
}
