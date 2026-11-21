import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const schemaPath = path.resolve('backend/prisma/schema.prisma');
const currentSchema = fs.readFileSync(schemaPath, 'utf8');

const prodSchemaPath = path.resolve('output/prepublication/backend-candidate/backend/prisma/schema.prisma');
// In main branch of backend-candidate:
const mainSchema = execSync('git -c safe.directory=* -C output/prepublication/backend-candidate show main:backend/prisma/schema.prisma', { encoding: 'utf8' });

console.log('Main schema contains Synthetic:', mainSchema.includes('SyntheticStagingInstallation'));
console.log('Current workspace schema contains Synthetic:', currentSchema.includes('SyntheticStagingInstallation'));
console.log('Candidate schema contains JobDispatchState:', currentSchema.includes('JobDispatchState'));

// Let's verify why synthetic models were removed from candidate schema:
// Notice the lines in mainSchema:
// lines 12-55 define the 5 models.
// Let's see if having both synthetic models AND JobDispatchState is valid in Prisma:
const combinedSchema = currentSchema.replace('enum UserRole {', `// Synthetic sandbox only. Additive, dormant tables: migration never enables it.
model SyntheticStagingInstallation {
  singleton    Int      @id
  stagingId    String   @unique @db.Uuid
  projectId    String?
  databaseName String
  createdAt    DateTime @default(dbgenerated("(clock_timestamp() AT TIME ZONE 'UTC'::text)")) @db.Timestamp(3)
}

model SyntheticMail {
  id         String   @id @db.Uuid
  purpose    String   @db.VarChar(10)
  ciphertext String
  expiresAt  DateTime @db.Timestamp(3)
  createdAt  DateTime @default(dbgenerated("(clock_timestamp() AT TIME ZONE 'UTC'::text)")) @db.Timestamp(3)
  @@index([expiresAt, id], map: "SyntheticMail_expiry_idx")
}

model SyntheticNotification {
  id          String   @id @db.Uuid
  payload     Json
  receivedAt  DateTime? @db.Timestamp(3)
  disposition String?  @db.VarChar(16)
  createdAt   DateTime @default(dbgenerated("(clock_timestamp() AT TIME ZONE 'UTC'::text)")) @db.Timestamp(3)
  @@index([createdAt, id], map: "SyntheticNotification_created_idx")
}

model SyntheticInvocation {
  id        String   @id @db.Uuid
  actor     String   @db.Char(64)
  expiresAt DateTime @db.Timestamp(3)
  createdAt DateTime @default(dbgenerated("(clock_timestamp() AT TIME ZONE 'UTC'::text)")) @db.Timestamp(3)
  @@index([expiresAt, id], map: "SyntheticInvocation_expiry_idx")
  @@index([actor, createdAt], map: "SyntheticInvocation_actor_idx")
}

model SyntheticProviderFault {
  provider  String @db.VarChar(8)
  id        String @db.Uuid
  outcome   String @db.VarChar(32)
  remaining Int
  @@id([provider, id])
}

enum UserRole {`);

fs.writeFileSync(schemaPath, combinedSchema);
console.log('Running npx prisma generate on combined schema...');
try {
  execSync('npx prisma generate', { cwd: path.resolve('backend'), stdio: 'inherit' });
  console.log('Prisma generate OK!');
  execSync('npm run typecheck -w backend', { stdio: 'inherit' });
  console.log('Backend typecheck OK!');
} finally {
  // restore current
  fs.writeFileSync(schemaPath, currentSchema);
  execSync('npx prisma generate', { cwd: path.resolve('backend'), stdio: 'inherit' });
}

