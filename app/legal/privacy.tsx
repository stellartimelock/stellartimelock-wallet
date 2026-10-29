import {
  DocBoldLead,
  DocBullet,
  DocHeading,
  DocIntro,
  DocParagraph,
  DocSection,
  DocUpdated,
  LegalDocumentScreen,
} from "./_document";

export default function PrivacyPolicyScreen() {
  return (
    <LegalDocumentScreen
      title="Privacy Policy"
      testID="legal-privacy-screen"
      backTestID="legal-privacy-back"
    >
      <DocHeading>Stellar TimeLock — Privacy Policy</DocHeading>
      <DocUpdated>Last updated: October 8, 2026</DocUpdated>
      <DocIntro>
        StellarTimeLock, LLC ("we," "our," or "us") operates the Stellar TimeLock
        mobile application (the "App"). This page says what stays on your phone
        and what the App sends to other services when you use it.
      </DocIntro>

      <DocSection title="What we do not do">
        <DocBullet>We do not have user accounts, and we do not collect names, email addresses, or phone numbers</DocBullet>
        <DocBullet>We do not collect location, advertising IDs, or crash analytics</DocBullet>
        <DocBullet>We do not sell data</DocBullet>
        <DocBullet>We cannot see your Stellar secret key. It stays in memory on this phone after you unlock with your fingerprint</DocBullet>
        <DocBullet>The App is not for anyone under 18</DocBullet>
      </DocSection>

      <DocSection title="What stays on your phone">
        <DocParagraph>
          Your secret key, recovery phrase, Key Manager, address book,
          authenticator codes, and backup files stay on this device unless you
          export a backup or use a feature that talks to a network service.
          Key Manager and backup files are encrypted with your Stellar secret,
          so the same secret opens them on another phone.
        </DocParagraph>
        <DocParagraph>
          The address book is a list you type in the App. It stays on this phone.
        </DocParagraph>
        <DocParagraph>
          The camera is used to scan a pairing QR code. The picture is not saved
          or uploaded. The App does not use the microphone.
        </DocParagraph>
      </DocSection>

      <DocSection title="What leaves the phone">
        <DocParagraph>
          These services see your IP address because the phone connects to them.
          We do not control them.
        </DocParagraph>
        <DocBoldLead
          lead="Stellar Horizon and Soroban RPC: "
          body="Sending, receiving, and vault actions send your public account id and the transaction to Horizon (horizon.stellar.org) and to Soroban RPC hosts, including Ankr. They see the public transaction data the network needs."
        />
        <DocBoldLead
          lead="SimpleSwap: "
          body="A swap sends the pair, the amount, and your payout and refund addresses to the StellarTimeLock swap proxy (stl-swap-proxy.stellartimelock.workers.dev, a Cloudflare Worker), which passes them to SimpleSwap with our partner key. The proxy keeps no logs and stores nothing; Cloudflare sees your IP address to deliver the request. This happens only when you use swap. SimpleSwap's own policy covers the exchange."
        />
        <DocBoldLead
          lead="Key pairing: "
          body="Linking Key Manager to another phone sends sealed ciphertext to fortress-bot.stellartimelock.workers.dev. The relay is not in this app. The phone stops waiting after about 90 seconds."
        />
        <DocBoldLead
          lead="Prices and block explorers: "
          body="Balance and price lookups, and an optional link out to Stellar Expert, send the public account id or transaction id you asked to look up."
        />
      </DocSection>

      <DocSection title="Data security">
        <DocParagraph>
          We cannot recover a lost secret, reset the wallet, or move funds.
          You can delete the on-phone data by uninstalling the App. Data already
          sent to Horizon, an RPC host, or SimpleSwap is on their systems.
          There is no account with us to delete.
        </DocParagraph>
      </DocSection>

      <DocSection title="Contact">
        <DocParagraph>
          Questions about this policy: stellartimelock@gmail.com.
        </DocParagraph>
      </DocSection>

      <DocSection title="Governing Law">
        <DocParagraph>
          This Privacy Policy is governed by the laws of the State of Ohio,
          United States.
        </DocParagraph>
      </DocSection>
    </LegalDocumentScreen>
  );
}
