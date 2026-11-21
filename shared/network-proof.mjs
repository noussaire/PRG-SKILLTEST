import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

export function digest(value) { return createHash('sha256').update(value).digest('hex'); }
export function proofKey(value) {
  if (typeof value !== 'string') throw Error('PROXY_CONFIG_INVALID');
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32 || key.toString('base64') !== value) throw Error('PROXY_CONFIG_INVALID');
  return key;
}
export function networkOf(ip) {
  if (typeof ip !== 'string' || ip.includes('%') || !isIP(ip)) throw Error('NETWORK_INVALID');
  if (isIP(ip) === 4) return ip + '/32';
  let value = ip.toLowerCase();
  if (value.includes('.')) {
    const at = value.lastIndexOf(':');
    const bytes = value.slice(at + 1).split('.').map(Number);
    value = value.slice(0, at + 1) + ((bytes[0] << 8) | bytes[1]).toString(16) + ':' + ((bytes[2] << 8) | bytes[3]).toString(16);
  }
  const halves = value.split('::'), left = halves[0] ? halves[0].split(':') : [], right = halves[1] ? halves[1].split(':') : [];
  const groups = (halves.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left).map(g => parseInt(g, 16));
  if (groups.slice(0, 5).every(g => g === 0) && groups[5] === 65535) {
    return [groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255].join('.') + '/32';
  }
  return groups.slice(0, 4).map(g => g.toString(16)).join(':') + '::/64';
}
export function canonicalNetwork(value) {
  try { return networkOf(value.slice(0, value.lastIndexOf('/'))) === value ? value : null; }
  catch { return null; }
}
export function signProof(key, audience, method, path, body, authorization, network, nonce = randomUUID(), now = Date.now()) {
  const payload = { aud: audience, method, path, body: digest(body), auth: digest(authorization), network, nonce, ts: now };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return 'v1.' + encoded + '.' + createHmac('sha256', proofKey(key)).update('v1.' + encoded).digest('hex');
}
export function verifyProof(token, key, audience, method, path, bodyHash, authorization, now = Date.now()) {
  try {
    if (typeof token !== 'string' || token.length > 4096) throw Error();
    const [version, encoded, mac, extra] = token.split('.');
    if (version !== 'v1' || extra !== undefined || !/^[a-f0-9]{64}$/.test(mac) || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw Error();
    const expected = createHmac('sha256', proofKey(key)).update('v1.' + encoded).digest();
    if (!timingSafeEqual(expected, Buffer.from(mac, 'hex'))) throw Error();
    const p = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (Object.keys(p).sort().join(',') !== 'aud,auth,body,method,network,nonce,path,ts') throw Error();
    if (p.aud !== audience || p.method !== method || p.path !== path || p.body !== bodyHash || p.auth !== digest(authorization)) throw Error();
    if (!Number.isSafeInteger(p.ts) || (now !== null && (p.ts < now - 60000 || p.ts > now + 5000)) || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(p.nonce)) throw Error();
    if (p.network !== null && typeof p.network !== 'string') throw Error();
    return p;
  } catch { throw Error('PROXY_PROOF_INVALID'); }
}
