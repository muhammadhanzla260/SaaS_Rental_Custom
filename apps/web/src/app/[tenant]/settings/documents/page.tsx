import { getTenantContext } from '@/server/context';
import { DocumentsForm } from '../forms';

export const metadata = { title: 'Emails and documents' };

export default async function DocumentSettings({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const { prefs } = await getTenantContext(slug);
  return <DocumentsForm slug={slug} initial={{ numbering: prefs.numbering, communication: prefs.communication }} />;
}
