import { LegalPage } from '@/components/auth/legal';

export const metadata = { title: 'Privacy' };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy">
      <p>The full policy will be published here before paid plans open (Phase 6).</p>
      <p>In short: we store what you enter to run your rental business. Mail server, text-message and payment keys are encrypted and never shown again after saving. Coaches&apos; location is collected only while they are en route to an assigned event.</p>
    </LegalPage>
  );
}
