// Test-only ESM loader; transpiles in memory, never emits build files.
import ts from 'typescript';
import { readFile } from 'node:fs/promises';
export async function resolve(specifier, context, next) {
  try { return await next(specifier, context); }
  catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('.') && specifier.endsWith('.js')) {
      return next(specifier.slice(0, -3) + '.ts', context);
    }
    throw error;
  }
}
export async function load(url, context, next) {
  // Dedicated offline route tests: never instantiate Prisma or auto-load .env.
  if (url.endsWith('/src/db/prisma.ts')) return { format: 'module', shortCircuit: true,
    source: `if (!globalThis.__skillquestSyntheticTestPrisma) throw Error('OWNED_TEST_DB_REQUIRED');
      export const prisma = globalThis.__skillquestSyntheticTestPrisma;` };
  if (url.endsWith('.ts')) return { format: 'module', shortCircuit: true,
    source: ts.transpileModule(await readFile(new URL(url), 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText };
  return next(url, context);
}
