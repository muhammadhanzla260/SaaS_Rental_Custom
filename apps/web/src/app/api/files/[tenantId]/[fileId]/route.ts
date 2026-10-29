import { getFile, listUserTenants, readFileBytes } from '@rental/db';
import { auth } from '@/server/auth';
import { db } from '@/server/db';

const UUID = /^[0-9a-f-]{36}$/i;

/** Serves logos (public) and other tenant files (members only). */
export async function GET(req: Request, { params }: { params: Promise<{ tenantId: string; fileId: string }> }) {
  const { tenantId, fileId } = await params;
  if (!UUID.test(tenantId) || !UUID.test(fileId)) return new Response('Not found', { status: 404 });
  const file = await getFile(db, tenantId, fileId);
  if (!file) return new Response('Not found', { status: 404 });

  if (!file.isPublic) {
    const session = await auth.api.getSession({ headers: req.headers });
    const member = session && (await listUserTenants(db, session.user.id)).some((t) => t.tenant_id === tenantId);
    if (!member) return new Response('Not found', { status: 404 });
  }

  // In the database (local development) or the bucket (R2), wherever the file was saved.
  const bytes = await readFileBytes(file);
  if (!bytes) return new Response('Not found', { status: 404 });

  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': file.mime,
      'Content-Length': String(bytes.length),
      // File ids are immutable: a new upload gets a new id. Public files are kept at the CDN edge too (s-maxage).
      'Cache-Control': file.isPublic ? 'public, max-age=31536000, s-maxage=31536000, immutable' : 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      // SVGs must never run scripts when opened directly. (A sandboxed page cannot show a PDF, so PDFs open as downloads-in-place.)
      ...(file.mime === 'application/pdf'
        ? { 'Content-Disposition': `inline; filename="${file.filename.replace(/[^\w. -]/g, '_')}"` }
        : { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" }),
    },
  });
}
