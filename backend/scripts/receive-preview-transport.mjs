// Map the existing official launcher to one explicitly approved Preview origin.
// No request, credential or environment mutation occurs when importing this file.
import { ORIGIN } from './synthetic-admin-launcher.mjs';
const paths = new Set(['/api/v1/admin/auth/login', '/api/v1/admin/auth/logout', '/api/v1/adaptive/start', '/api/internal/synthetic/status',
  '/api/internal/synthetic/notifications/publish-otp', '/api/internal/synthetic/notifications/receive',
  '/api/internal/synthetic/mail/read']);
export function previewTransport(origin, expectedHostname, bypassSecret, fetcher = globalThis.fetch) {
  const preview = new URL(origin);
  if (preview.origin !== origin || preview.protocol !== 'https:' || preview.hostname !== expectedHostname ||
      !/^[a-z0-9-]+\.vercel\.app$/.test(expectedHostname) || preview.origin === ORIGIN) throw Error('PREVIEW_ORIGIN_REFUSED');
  if (typeof bypassSecret !== 'string' || !bypassSecret || /[\r\n]/.test(bypassSecret)) throw Error('PREVIEW_PROTECTION_SECRET_REQUIRED');
  return async (input, init) => {
    const original = new URL(String(input));
    if (original.origin !== ORIGIN || original.search || original.hash || !paths.has(original.pathname) || init?.method !== 'POST') {
      throw Error('PREVIEW_REQUEST_REFUSED');
    }
    const headers = new Headers(init.headers);
    headers.set('x-vercel-protection-bypass', bypassSecret);
    return fetcher(preview.origin + original.pathname, { ...init, redirect: 'error', headers });
  };
}
