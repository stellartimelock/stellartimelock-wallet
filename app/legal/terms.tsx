import {
  DocBullet,
  DocHeading,
  DocIntro,
  DocParagraph,
  DocSection,
  DocUpdated,
  LegalDocumentScreen,
} from "./_document";

export default function TermsOfServiceScreen() {
  return (
    <LegalDocumentScreen
      title="Terms of Service"
      testID="legal-terms-screen"
      backTestID="legal-terms-back"
    >
      <DocHeading>Stellar TimeLock — Terms of Service</DocHeading>
      <DocUpdated>Last updated: August 4, 2026</DocUpdated>
      <DocIntro>
        These Terms of Service ("Terms") govern your use of the Stellar TimeLock
        mobile application (the "App"), operated by StellarTimeLock, LLC
        ("we," "us," or "our"). By using the App, you agree to these Terms.
      </DocIntro>

      <DocSection title="1. Non-Custodial Wallet">
        <DocParagraph>
          The App is a non-custodial wallet. You — and only you — control your
          private keys and seed phrase. We cannot:
        </DocParagraph>
        <DocBullet>Access your funds</DocBullet>
        <DocBullet>
          Recover your wallet if you lose your seed phrase or secret key
        </DocBullet>
        <DocBullet>Reverse, cancel, or refund transactions</DocBullet>
        <DocBullet>Freeze or modify your vaults</DocBullet>
      </DocSection>

      <DocSection title="2. Your Responsibilities">
        <DocParagraph>You are solely responsible for:</DocParagraph>
        <DocBullet>Safeguarding your seed phrase and secret key</DocBullet>
        <DocBullet>
          Verifying all transaction details before confirming
        </DocBullet>
        <DocBullet>
          Understanding how time-lock vaults, vesting schedules, and cooling-off
          periods work before using them
        </DocBullet>
        <DocBullet>
          Complying with all applicable laws in your jurisdiction
        </DocBullet>
      </DocSection>

      <DocSection title="3. No Financial Advice">
        <DocParagraph>
          The App is a tool. Nothing in the App constitutes financial, legal, or
          tax advice. You should consult qualified professionals before making
          financial decisions involving cryptocurrency.
        </DocParagraph>
      </DocSection>

      <DocSection title="4. Third-Party Services">
        <DocParagraph>
          The App integrates with third-party services including Stellar network
          RPC endpoints and SimpleSwap for token exchanges. We are not
          responsible for the availability, security, or performance of these
          third-party services.
        </DocParagraph>
      </DocSection>

      <DocSection title="5. Risks">
        <DocParagraph>
          Cryptocurrency transactions are irreversible. Smart contracts on the
          Stellar/Soroban network carry inherent risks including bugs, network
          congestion, and changes to network parameters. You acknowledge these
          risks when using the App.
        </DocParagraph>
      </DocSection>

      <DocSection title="6. No Warranty">
        <DocParagraph>
          THE APP IS PROVIDED "AS IS" WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
          IMPLIED. WE DO NOT GUARANTEE THAT THE APP WILL BE UNINTERRUPTED,
          ERROR-FREE, OR SECURE.
        </DocParagraph>
      </DocSection>

      <DocSection title="7. Limitation of Liability">
        <DocParagraph>
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, STELLARTIMELOCK, LLC SHALL NOT
          BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, OR
          CONSEQUENTIAL DAMAGES ARISING FROM YOUR USE OF THE APP, INCLUDING BUT
          NOT LIMITED TO LOSS OF FUNDS, DATA, OR PROFITS.
        </DocParagraph>
      </DocSection>

      <DocSection title="8. Changes to These Terms">
        <DocParagraph>
          We may update these Terms from time to time. Continued use of the App
          after changes constitutes acceptance of the new Terms.
        </DocParagraph>
      </DocSection>

      <DocSection title="9. Governing Law">
        <DocParagraph>
          These Terms are governed by the laws of the State of Ohio, United
          States, without regard to conflict of law principles.
        </DocParagraph>
      </DocSection>

      <DocSection title="10. Contact">
        <DocParagraph>
          For questions about these Terms, contact us at: [contact email to be
          added]
        </DocParagraph>
      </DocSection>
    </LegalDocumentScreen>
  );
}
