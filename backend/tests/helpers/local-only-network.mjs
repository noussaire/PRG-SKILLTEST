// Opt-in preload for local qualification: no .env, no external network.
import net from 'node:net';
import dns from 'node:dns';
import dgram from 'node:dgram';
import tls from 'node:tls';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
process.env.DOTENV_CONFIG_PATH = '__no_environment_file_for_local_tests__';
process.env.DATABASE_URL = 'postgresql://local@127.0.0.1:9/never_connect';
process.env.DIRECT_URL = process.env.DATABASE_URL;
process.env.JOIN_CODE_PEPPER = 'isolated-local-tests-0123456789abcdef';
for (const key of ['GROQ_API_KEY','BREVO_API_KEY','QSTASH_TOKEN','QSTASH_CURRENT_SIGNING_KEY','QSTASH_NEXT_SIGNING_KEY']) process.env[key] = '';
process.env.SKILLQUEST_STAGING_MODE = 'off';
// Next loads .env.local itself, independently of dotenv. Hide environment files
// from qualification children without renaming or modifying the user's files.
const environmentFile = file => /(?:^|[\\/])\.env(?:\.[^\\/]*)?$/.test(String(file));
const missingEnvironment = () => Object.assign(new Error('LOCAL_ENV_FILE_DISABLED'), { code: 'ENOENT' });
const readSync = fs.readFileSync;
fs.readFileSync = function (file, ...args) { if (environmentFile(file)) throw missingEnvironment(); return readSync.call(this, file, ...args); };
const readAsync = fs.promises.readFile;
fs.promises.readFile = async function (file, ...args) { if (environmentFile(file)) throw missingEnvironment(); return readAsync.call(this, file, ...args); };
for (const key of ['BREVO','QSTASH','GROQ']) delete process.env[`SKILLQUEST_ALLOW_REAL_${key}`];
const local = host => ['127.0.0.1','localhost','::1','[::1]'].includes(host);
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const normalized = Array.isArray(args[0]) ? args[0] : args;
  const options = normalized[0];
  const host = typeof options === 'object' ? options.host ?? 'localhost' : typeof normalized[1] === 'string' ? normalized[1] : 'localhost';
  if (!local(host)) throw Error('EXTERNAL_TCP_FORBIDDEN');
  return connect.apply(this, args);
};
// Also fence DNS/UDP/TLS paths if a library bypasses fetch. The application
// tests may replace fetch with a fake, but cannot open a remote socket.
for (const name of ['lookup','resolve','resolve4','resolve6','resolveAny','resolveCname','resolveMx','resolveNaptr','resolveNs','resolvePtr','resolveSoa','resolveSrv','resolveTxt','reverse']) {
  for (const api of [dns, dns.promises]) {
    if (typeof api[name] !== 'function') continue;
    const original = api[name].bind(api);
    api[name] = (host, ...args) => { if (!local(host)) throw Error('EXTERNAL_DNS_FORBIDDEN'); return original(host, ...args); };
  }
}
dgram.Socket.prototype.send = function () { throw Error('UDP_FORBIDDEN'); };
const secure = tls.connect;
tls.connect = function (...args) {
  const options = typeof args[0] === 'object' ? args[0] : typeof args[1] === 'object' ? args[1] : { host: typeof args[1] === 'string' ? args[1] : 'localhost' };
  if (!local(options.host ?? 'localhost') || options.servername && !local(options.servername)) throw Error('EXTERNAL_TLS_FORBIDDEN');
  return secure.apply(this, args);
};
syncBuiltinESMExports();
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (!local(url.hostname)) throw Error('EXTERNAL_FETCH_FORBIDDEN');
  return originalFetch(input, init);
};
