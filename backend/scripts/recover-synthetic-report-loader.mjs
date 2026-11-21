// In-memory TypeScript loading, restricted to this offline renderer.
import { resolve as resolveTs, load as loadTs } from '../tests/helpers/local-typescript-loader.mjs';
export async function resolve(specifier, context, next) {
  if (/^(?:@prisma\/client|dotenv(?:\/|$)|@upstash\/|@sparticuz\/)/.test(specifier)) {
    throw Error('RECOVERY_FORBIDDEN_IMPORT');
  }
  return resolveTs(specifier, context, next);
}
export async function load(url, context, next) {
  if (/\/src\/(?:db\/prisma|config\/env)\.[jt]s$/.test(url)) throw Error('RECOVERY_DB_OR_ENV_IMPORT_FORBIDDEN');
  return loadTs(url, context, next);
}
