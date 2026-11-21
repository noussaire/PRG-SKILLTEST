// Standalone child process: resolve dependencies from the packaged artifact,
// never from the checkout containing this probe. No database is contacted.
import assert from 'node:assert/strict';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import net from 'node:net';
import tls from 'node:tls';
import timers from 'node:timers';
import childProcess from 'node:child_process';

const entry = resolve(process.argv[2]);
const artifact = resolve(dirname(entry), '..');
const requireArtifact = createRequire(entry);
const prismaPath = requireArtifact.resolve('@prisma/client');
assert.ok(prismaPath.startsWith(artifact + sep), 'Prisma resolved outside the artifact');
const { PrismaClient } = requireArtifact('@prisma/client');
const attempts = [];
const forbid = name => () => { attempts.push(name); throw Error(`IMPORT_SIDE_EFFECT:${name}`); };
globalThis.setInterval = timers.setInterval = forbid('setInterval');
globalThis.setTimeout = timers.setTimeout = forbid('setTimeout');
globalThis.fetch = forbid('fetch');
net.Server.prototype.listen = forbid('listen');
net.Socket.prototype.connect = forbid('connect');
tls.connect = forbid('tls.connect');
for (const name of ['spawn', 'exec', 'execFile', 'fork']) childProcess[name] = forbid(name);
for (const name of ['$connect', '$queryRaw', '$queryRawUnsafe', '$executeRaw', '$executeRawUnsafe', '$transaction']) {
  PrismaClient.prototype[name] = forbid(name);
}
syncBuiltinESMExports();
const signals = ['SIGTERM', 'SIGINT', 'uncaughtException', 'unhandledRejection'];
const before = signals.map(name => process.listenerCount(name));
const first = await import(pathToFileURL(entry).href);
const again = await import(pathToFileURL(entry).href);
assert.equal(typeof first.default, 'function');
assert.equal(first.default, again.default);
assert.equal(first.default.get('trust proxy'), false);
await new Promise(resolve => setImmediate(resolve));
assert.deepEqual(attempts, []);
assert.deepEqual(signals.map(name => process.listenerCount(name)), before);
console.log(JSON.stringify({ imported: true, prismaInsideArtifact: true, attempts, signalHandlersUnchanged: true }));
