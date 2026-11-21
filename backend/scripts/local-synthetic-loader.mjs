// Local sandbox only; never used by a deployed handler.
import { resolve as resolveTs, load as loadTs } from '../tests/helpers/local-typescript-loader.mjs';
export const resolve = resolveTs;
export async function load(url, context, next) {
  if (url.endsWith('/src/db/prisma.ts')) return { format: 'module', shortCircuit: true,
    source: `if (!globalThis.__skillquestLocalPrisma) throw Error('VERIFIED_LOCAL_DB_REQUIRED');
      export const prisma = globalThis.__skillquestLocalPrisma;` };
  return loadTs(url, context, next);
}
