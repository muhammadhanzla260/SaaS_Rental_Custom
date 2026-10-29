import { LegalPage } from '@/components/auth/legal';

export const metadata = { title: 'Terms' };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of service">
      <p>The full terms are being finalised with counsel and will be published here before paid plans open (Phase 6).</p>
      <p>During the trial: your organization owns its data; you can export or delete it at any time; we keep it private and only open your workspace for support when you ask, with every such session recorded in your activity log.</p>
    </LegalPage>
  );
}
