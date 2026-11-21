import { createHash, createHmac, hkdfSync, randomUUID } from 'node:crypto';
import { emitKeypressEvents } from 'node:readline';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

export const ORIGIN = 'https://skillquest-backend-nine.vercel.app';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const email = /^[a-z0-9][a-z0-9._+-]{0,63}@example\.test$/i;
const providers = ['BREVO_API_KEY', 'GROQ_API_KEY', 'QSTASH_TOKEN', 'QSTASH_CURRENT_SIGNING_KEY', 'QSTASH_NEXT_SIGNING_KEY'];
class LauncherStop extends Error {}
class LauncherRequestFailure extends LauncherStop {
  constructor(stage, status) {
    super('REQUEST_FAILED_NO_RETRY'); this.stage = stage; this.status = status;
  }
}
const fail = code => { throw new LauncherStop(code); };
const diagnosticCodes = new Set(['GLOBAL_PUBLICATION_FORBIDDEN', 'ACTION_INVALID', 'SYNTHETIC_CONFIG_REQUIRED',
  'TARGET_INVALID', 'STAGING_SECRET_INVALID', 'PASSWORD_INVALID', 'ADMIN_SESSION_INVALID', 'SESSION_DISPOSED',
  'TARGET_PUBLICATION_UNCONFIRMED', 'SYNTHETIC_STATUS_INVALID', 'TARGET_NOTIFICATION_NOT_CONFIRMED',
  'DELIVERY_NOT_COMPLETE_NO_RETRY', 'TARGET_MAIL_NOT_CONFIRMED', 'TARGET_MAIL_MISMATCH', 'OTP_FORMAT_INVALID',
  'PRIVATE_TTY_REQUIRED', 'EXPLICIT_AUTHORIZATION_REQUIRED', 'CANCELLED', 'REQUEST_FAILED_NO_RETRY']);
const requestStages = new Map([
  ['/api/v1/admin/auth/login', 'LOGIN'], ['/api/v1/admin/auth/logout', 'LOGOUT'],
  ['/api/internal/synthetic/status', 'STATUS'], ['/api/internal/synthetic/notifications/publish-otp', 'PUBLISH_OTP'],
  ['/api/internal/synthetic/notifications/receive', 'RECEIVE'], ['/api/internal/synthetic/mail/read', 'MAIL_READ'],
]);
export function failureSummary(error) {
  const code = error instanceof LauncherStop && diagnosticCodes.has(error.message) ? error.message : 'UNEXPECTED_ERROR';
  const stage = error instanceof LauncherRequestFailure && [...requestStages.values()].includes(error.stage) ? error.stage : 'LOCAL_VALIDATION';
  const http = error instanceof LauncherRequestFailure && Number.isInteger(error.status) && error.status >= 100 && error.status <= 599
    ? String(error.status) : 'UNAVAILABLE';
  return `LAUNCHER_STOPPED code=${code} stage=${stage} http=${http} ; aucune reprise automatique.`;
}

export function configuration(env, action, targetEmail, jobId, notificationId, challengeId) {
  if (action === 'publish') fail('GLOBAL_PUBLICATION_FORBIDDEN');
  if (!['status', 'receive', 'mail', 'publish-otp'].includes(action)) fail('ACTION_INVALID');
  if (env.SKILLQUEST_STAGING_MODE !== 'synthetic-v1' ||
      env.SKILLQUEST_DEPLOYMENT_PURPOSE !== 'synthetic-staging' ||
      env.SKILLQUEST_STAGING_ACK !== 'SYNTHETIC_DATA_ONLY_NO_EXTERNAL_PROVIDERS' ||
      providers.some(k => !!env[k])) fail('SYNTHETIC_CONFIG_REQUIRED');
  if (!uuid.test(env.SKILLQUEST_STAGING_ID ?? '') || !email.test(targetEmail ?? '') ||
      !uuid.test(jobId ?? '') || (['receive', 'publish-otp'].includes(action) && !uuid.test(notificationId ?? '')) ||
      (['publish-otp', 'receive'].includes(action) && !uuid.test(challengeId ?? ''))) fail('TARGET_INVALID');
  return Object.freeze({ action, targetEmail, jobId, notificationId, challengeId, stagingId: env.SKILLQUEST_STAGING_ID });
}

export function material(secret) {
  const key = Buffer.from(secret, 'base64url');
  if (key.length !== 32 || key.toString('base64url') !== secret) fail('STAGING_SECRET_INVALID');
  return key;
}

// Wire-compatible with security/synthetic-staging.ts:stagingProof. No DB imports,
// environment mutation, child process, cookie, credential file or response log.
export function proof(key, stagingId, path, body, authorization, id, timestamp) {
  const derived = Buffer.from(hkdfSync('sha256', key, `skillquest:synthetic:${stagingId}:v1`, 'operations-authentication', 32));
  try {
    const data = JSON.stringify(['synthetic-operations-v1', 'POST', path, id, timestamp,
      createHash('sha256').update(body).digest('hex'), createHash('sha256').update(authorization).digest('hex')]);
    return createHmac('sha256', derived).update(data).digest('base64url');
  } finally { derived.fill(0); }
}

export async function post(fetcher, path, body, headers = {}) {
  let status;
  try {
    const response = await fetcher(ORIGIN + path, { method: 'POST', redirect: 'error',
      signal: AbortSignal.timeout(65000), headers: { 'content-type': 'application/json', ...headers }, body });
    status = response.status;
    if (!response.ok) throw new LauncherRequestFailure(requestStages.get(path), status);
    // Bounded streamed response: never include upstream bodies/errors in output.
    const reader = response.body.getReader();
    const chunks = []; let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 131072) { await reader.cancel(); fail('RESPONSE_TOO_LARGE'); }
        chunks.push(Buffer.from(value));
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } finally { for (const chunk of chunks) chunk.fill(0); }
  } catch { throw new LauncherRequestFailure(requestStages.get(path), status); }
}

export async function authenticate(fetcher, password) {
  if (!password || password.length > 1024) fail('PASSWORD_INVALID');
  const result = await post(fetcher, '/api/v1/admin/auth/login', JSON.stringify({ email: 'admin@example.test', password }));
  if (!/^[a-f0-9]{64}$/.test(result.token ?? '') || result.admin?.role !== 'ADMIN' ||
      result.admin?.email !== 'admin@example.test') fail('ADMIN_SESSION_INVALID');
  return result.token;
}

export function session(fetcher, config, key, token) {
  let disposed = false;
  const call = async (suffix, data) => {
    if (disposed) fail('SESSION_DISPOSED');
    const path = '/api/internal/synthetic' + suffix, body = JSON.stringify(data);
    const id = randomUUID(), timestamp = String(Date.now()), authorization = `Bearer ${token}`;
    return post(fetcher, path, body, { authorization, 'x-skillquest-staging-id': id,
      'x-skillquest-staging-time': timestamp,
      'x-skillquest-staging-proof': proof(key, config.stagingId, path, body, authorization, id, timestamp) });
  };
  return {
    async run() {
      if (config.action === 'publish-otp') {
        const result = await call('/notifications/publish-otp', { jobId: config.jobId, challengeId: config.challengeId,
          notificationId: config.notificationId, email: config.targetEmail, fullName: 'SYNTH-Participant' });
        if (result.simulated !== true || result.published !== 1 || result.jobId !== config.jobId ||
            result.challengeId !== config.challengeId || result.notificationId !== config.notificationId) fail('TARGET_PUBLICATION_UNCONFIRMED');
        return { state: 'TARGET_OTP_PUBLISHED' };
      }
      const status = await call('/status', {});
      if (status.simulated !== true || !Array.isArray(status.notifications) || !Array.isArray(status.mail)) fail('SYNTHETIC_STATUS_INVALID');
      if (config.action === 'status') return { state: 'SYNTHETIC_STATUS_OK' };
      if (config.action === 'receive') {
        const matches = status.notifications.filter(n => n.id === config.notificationId &&
          n.payload?.notificationId === config.notificationId && n.payload?.jobId === config.jobId &&
          n.payload?.kind === 'OTP_INITIAL' && n.payload?.phase === 'DELIVER' && n.payload?.version === 1 &&
          /^[A-Za-z0-9_-]{43}$/.test(n.payload?.otpTargetProof ?? '') && n.receivedAt === null);
        if (matches.length !== 1) fail('TARGET_NOTIFICATION_NOT_CONFIRMED');
        const result = await call('/notifications/receive', { notificationId: config.notificationId, jobId: config.jobId,
          challengeId: config.challengeId, email: config.targetEmail, fullName: 'SYNTH-Participant' });
        if (result.simulated !== true || result.disposition !== 'COMPLETE' || result.jobId !== config.jobId ||
            result.challengeId !== config.challengeId || result.notificationId !== config.notificationId) fail('DELIVERY_NOT_COMPLETE_NO_RETRY');
        return { state: 'TARGET_DELIVERY_COMPLETE' };
      }
      const matches = status.mail.filter(m => m.id === config.jobId && m.purpose === 'OTP' && Date.parse(m.expiresAt) > Date.now());
      if (matches.length !== 1) fail('TARGET_MAIL_NOT_CONFIRMED');
      const message = await call('/mail/read', { id: config.jobId });
      if (message.simulated !== true || message.recipient !== config.targetEmail || typeof message.htmlContent !== 'string') fail('TARGET_MAIL_MISMATCH');
      // Never execute captured HTML. Extract only the six-digit OTP for a private view.
      const codes = [...message.htmlContent.matchAll(/\b[0-9]{6}\b/g)].map(m => m[0]);
      if (new Set(codes).size !== 1 || codes.length === 0) fail('OTP_FORMAT_INVALID');
      return { state: 'PRIVATE_OTP_READY', otp: codes[0] };
    },
    async close() {
      try {
        if (!disposed) await post(fetcher, '/api/v1/admin/auth/logout', '{}', { authorization: `Bearer ${token}` });
      } finally { disposed = true; token = ''; key.fill(0); }
    },
    dispose() { disposed = true; token = ''; key.fill(0); },
  };
}

export function hidden(prompt, input = process.stdin, output = process.stdout) {
  if (!input.isTTY || !output.isTTY) fail('PRIVATE_TTY_REQUIRED');
  output.write(prompt); emitKeypressEvents(input);
  const previousRaw = !!input.isRaw;
  input.setRawMode(true); input.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const done = (error) => {
      input.removeListener('keypress', listener); input.removeListener('end', ended);
      input.setRawMode(previousRaw); input.pause(); output.write('\n');
      if (error) { value = ''; reject(new Error(error)); } else resolve(value);
    };
    const ended = () => done('INPUT_CLOSED');
    const listener = (text, key = {}) => {
      if (key.ctrl && ['c', 'd'].includes(key.name)) return done('CANCELLED');
      if (key.name === 'return') return done();
      if (key.name === 'backspace') { value = Array.from(value).slice(0, -1).join(''); return; }
      if (text && !key.ctrl && !key.meta && !/[\x00-\x1f\x7f]/.test(text)) {
        if (value.length + text.length > 1024) return done('INPUT_TOO_LONG');
        value += text;
      }
    };
    input.on('keypress', listener); input.once('end', ended);
  });
}

export function privateOtpView(otp, announce, ttl = 60000) {
  if (!/^[0-9]{6}$/.test(otp)) fail('OTP_FORMAT_INVALID');
  return new Promise((resolve, reject) => {
    let timer;
    const server = createServer((req, res) => {
      if (req.method !== 'GET' || req.url !== '/' || req.headers.host !== `127.0.0.1:${server.address().port}` ||
          req.headers.origin || ![undefined, 'none'].includes(req.headers['sec-fetch-site'])) {
        res.writeHead(403); res.end(); return;
      }
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'private, no-store',
        'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer' });
      res.end(`OTP synthétique : ${otp}\nSaisissez-le dans le formulaire SkillQuest puis fermez cet onglet.`);
      close();
    });
    const close = () => { otp = ''; clearTimeout(timer); server.close(() => resolve()); server.closeIdleConnections(); };
    server.once('error', () => { otp = ''; clearTimeout(timer); reject(new Error('PRIVATE_VIEW_FAILED')); });
    server.listen(0, '127.0.0.1', () => {
      timer = setTimeout(close, ttl);
      announce(`http://127.0.0.1:${server.address().port}/`);
    });
  });
}

async function main() {
  const [action, targetEmail, jobId, notificationId, ...flags] = process.argv.slice(2);
  const challengeId = ['publish-otp', 'receive'].includes(action) ? flags.shift() : undefined;
  const config = configuration(process.env, action, targetEmail, jobId, notificationId, challengeId);
  if (flags.length !== 2 || !flags.includes('--authorized-production-writes') || !flags.includes('--confirmed-synthetic-deployment')) fail('EXPLICIT_AUTHORIZATION_REQUIRED');
  if (await hidden('Après autorisation, confirmer la cible SYNTH-Participant et le déploiement synthetic-v1 (taper SYNTH-Participant) : ') !== 'SYNTH-Participant') fail('CANCELLED');
  let secret = '', password = '', token = '', key, client;
  try {
    secret = await hidden('Secret staging EXISTANT (saisie masquée) : ');
    key = material(secret); secret = '';
    password = await hidden('Mot de passe CONNU de admin@example.test (saisie masquée) : ');
    token = await authenticate(fetch, password); password = '';
    client = session(fetch, config, key, token); token = '';
    const result = await client.run();
    console.log(result.state);
    if (result.otp) {
      const otp = result.otp; delete result.otp;
      await privateOtpView(otp, url => console.log(`Vue privée locale, une consultation, 60 secondes : ${url}`));
    }
  } finally {
    secret = ''; password = ''; token = '';
    try { await client?.close(); } finally { client?.dispose(); key?.fill(0); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(failureSummary(error)); process.exitCode = 1; });
}
