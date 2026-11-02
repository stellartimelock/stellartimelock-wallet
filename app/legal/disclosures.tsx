import {
  DocBullet,
  DocHeading,
  DocIntro,
  DocParagraph,
  DocSection,
  DocUpdated,
  LegalDocumentScreen,
} from "./_document";

export default function LegalDisclosuresScreen() {
  return (
    <LegalDocumentScreen
      title="Legal & Disclosures"
      testID="legal-disclosures-screen"
      backTestID="legal-disclosures-back"
    >
      <DocHeading>Stellar TimeLock — Legal & Disclosures</DocHeading>
      <DocUpdated>Last updated: August 4, 2026</DocUpdated>
      <DocIntro>StellarTimeLock, LLC</DocIntro>

      <DocSection title="Open Source Components">
        <DocParagraph>
          The App uses open source software including but not limited to:
        </DocParagraph>
        <DocBullet>
          Stellar SDK and Soroban RPC client libraries
        </DocBullet>
        <DocBullet>React Native and Expo framework</DocBullet>
        <DocBullet>
          Various cryptographic libraries for encryption and key derivation
        </DocBullet>
        <DocParagraph>
          Source code excerpts are available within the App under
          Settings → View Source Code.
        </DocParagraph>
      </DocSection>

      <DocSection title="Intellectual Property">
        <DocParagraph>
          "Stellar TimeLock" and associated branding are the property of
          StellarTimeLock, LLC. The App's source code, design, and user
          interface are protected by copyright.
        </DocParagraph>
      </DocSection>

      <DocSection title="Regulatory Disclaimer">
        <DocParagraph>
          The App is a self-custody tool for interacting with the Stellar
          network. It does not:
        </DocParagraph>
        <DocBullet>Hold, transmit, or control user funds</DocBullet>
        <DocBullet>Provide money transmission or payment services</DocBullet>
        <DocBullet>
          Function as a financial institution, exchange, or broker
        </DocBullet>
        <DocBullet>
          Issue, redeem, or manage any financial product
        </DocBullet>
        <DocParagraph>
          Users are responsible for determining whether their use of the App
          complies with applicable laws and regulations in their jurisdiction.
        </DocParagraph>
      </DocSection>

      <DocSection title="Network Disclosures">
        <DocBullet>
          Transaction fees on the Stellar network are determined by network
          conditions
        </DocBullet>
        <DocBullet>
          Vault operations require Soroban smart contract interactions which
          consume network resources
        </DocBullet>
        <DocBullet>
          The App uses public RPC endpoints provided by Ankr; availability may
          vary
        </DocBullet>
      </DocSection>

      <DocSection title="Affiliate Disclosure">
        <DocParagraph>
          The App's swap feature uses SimpleSwap and may include affiliate fees.
          These fees do not affect the exchange rates displayed to users.
        </DocParagraph>
      </DocSection>

      <DocSection title="Contact">
        <DocParagraph>
          Legal inquiries: [contact email to be added]
        </DocParagraph>
        <DocParagraph>
          Governing law: State of Ohio, United States
        </DocParagraph>
      </DocSection>
    </LegalDocumentScreen>
  );
}
