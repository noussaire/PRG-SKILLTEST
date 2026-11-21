// Private local application host: real routes and real PostgreSQL, no worker timer.
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import type { Server } from 'node:http';
import { PrismaClient } from '@prisma/client';
import { bootstrapSyntheticStaging } from '../src/services/synthetic-installation.service.js';
import { hashPassword } from '../src/security/tokens.js';
import { emailSubjectHash } from '../src/services/email-limits.js';

const file = process.env.SKILLQUEST_LOCAL_RUN_CONTEXT;
if (!file) throw Error('LOCAL_CONTEXT_REQUIRED');
const context = JSON.parse(await readFile(file, 'utf8'));
const root = await realpath(context.root);
if (path.dirname(await realpath(file)) !== root || context.purpose !== 'skillquest-local-e2e' ||
    !Number.isInteger(context.port) || context.port <= 1024 || context.port === 5432) throw Error('LOCAL_CONTEXT_INVALID');
const owner = JSON.parse(await readFile(path.join(root, 'owner.json'), 'utf8'));
if (owner.nonce !== context.nonce || owner.purpose !== context.purpose) throw Error('LOCAL_OWNER_INVALID');
const url = `postgresql://skillquest_local@127.0.0.1:${context.port}/postgres?connection_limit=4&connect_timeout=3&pool_timeout=3&sslmode=disable`;
if (process.env.DATABASE_URL !== url) throw Error('LOCAL_DSN_MISMATCH');
const db = new PrismaClient({ datasourceUrl: url, log: [], __internal: { configOverride: (config: any) =>
  ({ ...config, relativeEnvPaths: { rootEnvPath: null, schemaEnvPath: null } }) } } as any);
const [identity] = await db.$queryRawUnsafe<any[]>(`SELECT current_setting('data_directory') AS directory,
  (SELECT system_identifier::text FROM pg_control_system()) AS "systemId",inet_server_port() AS port,
  current_setting('listen_addresses') AS listen,current_user AS username,current_database() AS db`);
if (await realpath(identity.directory) !== await realpath(context.data) || identity.systemId !== context.systemId ||
    identity.port !== context.port || identity.listen !== '127.0.0.1' || identity.username !== 'skillquest_local' || identity.db !== 'postgres') throw Error('LOCAL_DATABASE_NOT_OWNED');
(globalThis as any).__skillquestLocalPrisma = db;
const nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = ((input: any, init: any) => {
  const u = new URL(input instanceof Request ? input.url : String(input));
  if (u.protocol !== 'http:' || u.hostname !== '127.0.0.1') throw Error('EXTERNAL_HTTP_FORBIDDEN');
  return nativeFetch(input, init);
}) as typeof fetch;
const reply = (id: number, result: unknown, ok = true) => process.stdout.write('LOCAL_RPC ' + JSON.stringify({ id, ok, result }) + '\n');
let server: Server | undefined;
const lines = createInterface({ input: process.stdin, terminal: false });
for await (const line of lines) {
  let request: any;
  try {
    request = JSON.parse(line);
    if (request.action === 'bootstrap') {
      const passwordHash = await hashPassword(request.password); request.password = '';
      await bootstrapSyntheticStaging(db, { adminEmail: 'admin@example.test', passwordHash, explicitDatabaseName: 'postgres' });
      const { app } = await import('../src/app.js');
      server = app.listen(context.backendPort, '127.0.0.1');
      await new Promise<void>(resolve => server!.once('listening', resolve));
      reply(request.id, { ready: true });
    } else if (request.action === 'target') {
      const rows = await db.$queryRawUnsafe<any[]>(`SELECT j.id AS "jobId",c.id AS "challengeId",p.id AS "notificationId",j."expiresAt"
        FROM "ParticipantEmailDeliveryJob" j JOIN "EmailOtpChallenge" c ON c.id=j."challengeId"
        JOIN "ParticipantEmailGate" g ON g."challengeId"=c.id
        JOIN "JobPublicationIntent" p ON p."jobId"=j.id AND p.kind='OTP_INITIAL' AND p.phase='DELIVER'
        JOIN "JobPublicationReady" r ON r.kind=p.kind AND r."jobId"=p."jobId" AND r.phase=p.phase AND r.generation=p.generation AND r."dueAt"=p."dueAt"
        WHERE c."identityHash"=$1 AND c."consumedAt" IS NULL AND j.status='PENDING' AND p.state='PENDING'
          AND j."expiresAt">(clock_timestamp() AT TIME ZONE 'UTC') ORDER BY p."createdAt" DESC LIMIT 2`,
        emailSubjectHash('IDENTITY', 'participant@example.test'));
      if (rows.length !== 1) throw Error('ONE_LOCAL_OTP_REQUIRED');
      reply(request.id, { ...rows[0], email: 'participant@example.test' });
    } else if (request.action === 'check') {
      const rows = await db.$queryRawUnsafe<any[]>(`SELECT i."displayName",jsonb_array_length(i.state->'answers')::int AS answers,
        i."emailVerifiedAt" IS NOT NULL AS verified,j.status AS "reportStatus"
        FROM "AdaptiveInterview" i LEFT JOIN "AdaptiveReportJob" j ON j."interviewId"=i.id WHERE i.email='participant@example.test'`);
      const [counts] = await db.$queryRawUnsafe<any[]>(`SELECT (SELECT count(*)::int FROM "EmailOtpChallenge") AS challenges,
        (SELECT count(*)::int FROM "SyntheticMail" WHERE purpose='OTP') AS "otpCaptures",
        (SELECT count(*)::int FROM "User") AS users`);
      reply(request.id, { participant: rows[0] ?? null, ...counts });
    } else if (request.action === 'stop') {
      server?.close(); server?.closeAllConnections(); await db.$disconnect(); reply(request.id, { stopped: true }); break;
    } else throw Error('LOCAL_ACTION_INVALID');
  } catch (error: any) {
    const code = /^[A-Z][A-Z0-9_]{0,80}$/.test(error?.code ?? '') ? error.code
      : /^[A-Z][A-Z0-9_]{0,80}$/.test(error?.message ?? '') ? error.message : 'LOCAL_COMMAND_FAILED';
    console.error('LOCAL_ACTION_FAILED', request?.action ?? 'parse', error?.name ?? 'Error', code);
    reply(request?.id ?? -1, code, false);
  }
}
server?.close(); server?.closeAllConnections(); await db.$disconnect();
