// Reviewable post-image bundles, not fabricated Git commits. No .git exists in
// this workspace. Only explicitly inventoried source files are copied.
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'output/otp-email-durable-candidates');
const groups = [
  { name: '01-provider-authorization', title: 'fix(security): require independent explicit provider authorization', files: [
    'backend/src/security/provider-mode.ts', 'backend/src/services/brevo.service.ts', 'backend/src/services/adaptive.service.ts', 'backend/src/services/report-summary.service.ts',
  ] },
  { name: '02-durable-dispatch', title: 'feat(jobs): add bounded PostgreSQL dispatch and consent withdrawal', files: [
    'backend/src/security/dispatch-auth.ts', 'backend/src/security/qstash-signature.ts', 'backend/src/services/qstash-publisher.service.ts',
    'backend/src/services/job-publication.service.ts', 'backend/src/services/job-dispatch.service.ts', 'backend/src/services/report-queue.service.ts',
    'backend/src/services/report-email-queue.service.ts', 'backend/src/routes/job-dispatch.routes.ts', 'backend/src/routes/qstash.routes.ts',
    'backend/src/routes/adaptive.routes.ts', 'backend/src/app.ts', 'backend/prisma/schema.prisma',
    'backend/prisma/migrations/20261107000100_durable_dispatch/migration.sql', 'backend/vercel.json',
    'frontend/src/app/api/adaptive/start/route.ts', 'frontend/src/app/api/adaptive/me/report-email/withdraw/route.ts',
  ] },
  { name: '03-local-qualification', title: 'test(jobs): prove restart recovery, deduplication and bilingual PDF identity', files: [
    'backend/tests/provider-mode.test.ts', 'backend/tests/durable-dispatch-native.test.ts', 'backend/tests/helpers/durable-worker.ts',
    'backend/tests/helpers/local-only-network.mjs', 'backend/tests/final-email-pdf-validation.test.ts', 'backend/tests/report-fallback-email.test.ts',
    'backend/tests/participant-email-native.cases.ts', 'backend/tests/job-processing-native.test.ts', 'backend/tests/job-publication-native.test.ts',
    'backend/tests/adaptive-service.test.ts', 'backend/tests/report-summary.test.ts', 'backend/tests/report-queue.test.ts',
    'backend/tests/report-email.test.ts', 'backend/tests/otp-delivery.test.ts',
    'frontend/tests/adaptive-session.test.ts', 'frontend/tests/otp-http.test.ts',
    'backend/scripts/qualify-durable.mjs', 'backend/scripts/qualify-local-checks.mjs', 'backend/scripts/prepare-durable-candidates.mjs',
    'docs/OTP-EMAILS-DURABLES-LOCAL.md', 'docs/OTP-EMAILS-DURABLES-VALIDATION.md', 'docs/DEPLOYMENT.md',
  ] },
];
const manifest = { format: 'reviewable-post-images-v1', gitCommitsCreated: false, remoteOperations: false, groups: [] };
for (const group of groups) {
  const files = [];
  for (const file of group.files) {
    const destination = path.join(out, group.name, file); await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(root, file), destination);
    const bytes = await readFile(destination); files.push({ path: file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  manifest.groups.push({ name: group.name, proposedCommitTitle: group.title, files });
}
await writeFile(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
await writeFile(path.join(out, 'COMMITS-CANDIDATS.md'), `# Commits candidats locaux

Aucun dépôt .git dans cet espace de travail : aucun commit, branche ou SHA Git inventé.
Les trois dossiers contiennent les versions finales des fichiers et manifest.json
leur empreinte SHA-256. Ce sont des instantanés de revue, pas des patches calculés
contre une archive potentiellement différente de la version initiale.

Ordre proposé dans le véritable dépôt :

${groups.map((g, i) => `${i + 1}. ${g.title} — ${g.name}`).join('\n')}

La migration candidate n'est appliquée qu'aux bases locales jetables.
Ces lots n'autorisent ni migration distante, ni activation fournisseur, ni push.
Les tests locaux autorisent les chemins HTTP réels uniquement sous fetch simulé
et garde-fous réseau ; aucune clé réelle n'est incluse dans ces instantanés.
`);
console.log(JSON.stringify({ out, files: manifest.groups.reduce((n, g) => n + g.files.length, 0) }));
