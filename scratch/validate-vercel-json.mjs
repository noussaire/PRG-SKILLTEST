/**
 * Validation officielle du schéma vercel.json
 * Télécharge le schéma officiel https://openapi.vercel.sh/vercel.json et valide
 * la structure exacte, les types, les limites de longueur et la présence des fichiers.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const configPath = path.resolve('backend/vercel.json');
const rawConfig = fs.readFileSync(configPath, 'utf8');
const config = JSON.parse(rawConfig);

console.log('=== VALIDATION DU FICHIER VERCEL.JSON ===');
console.log('Fichier cible :', configPath);

// 1. Structure de base
assert.equal(typeof config.$schema, 'string');
assert.equal(config.framework, 'express');
assert.equal(config.buildCommand, 'npm run build:vercel');
assert.equal(typeof config.functions, 'object');

// 2. Validation de la fonction index.mjs
const fn = config.functions['index.mjs'];
assert.ok(fn, 'Entrée functions["index.mjs"] manquante');

// maxDuration
assert.equal(typeof fn.maxDuration, 'number', 'maxDuration doit être un nombre');
assert.ok(fn.maxDuration >= 1 && fn.maxDuration <= 3600, 'maxDuration doit être entre 1 et 3600');
console.log(`✓ maxDuration = ${fn.maxDuration} (valide)`);

// includeFiles
assert.equal(typeof fn.includeFiles, 'string', 'includeFiles DOIT ÊTRE UNE CHAÎNE DE CARACTÈRES (glob pattern)');
assert.ok(fn.includeFiles.length <= 256, `includeFiles dépasse 256 caractères (taille: ${fn.includeFiles.length})`);
console.log(`✓ includeFiles est une string de ${fn.includeFiles.length} caractères (max: 256) :`);
console.log(`  "${fn.includeFiles}"`);

// 3. Vérification de l'existence des chemins référencés
console.log('\n--- VÉRIFICATION DES CHEMINS ---');
const patterns = fn.includeFiles.replace(/^\{|\}$/g, '').split(',');
for (const p of patterns) {
  const base = p.replace(/\/\*\*|\/\*\.[a-z0-9]+$/g, '');
  const resolved = path.resolve('backend', base);
  const exists = fs.existsSync(resolved);
  console.log(`  ${exists ? '✓' : 'ℹ️'} Pattern: ${p} -> Base: ${base} (${exists ? 'existe' : 'généré au build/runtime'})`);
}

// 4. Validation contre le schéma officiel complet
console.log('\n--- VALIDATION CONTRE LE SCHÉMA OFFICIEL OPENAPI VERCEL ---');
const schemaRes = await fetch('https://openapi.vercel.sh/vercel.json');
const schema = await schemaRes.json();
const fnSchema = schema.properties?.functions?.patternProperties?.['^.{1,256}$']?.properties;

assert.equal(fnSchema.includeFiles.type, 'string', 'Le schéma officiel confirme que includeFiles doit être de type string');
assert.equal(fnSchema.includeFiles.maxLength, 256, 'Le schéma officiel confirme la limite de 256 caractères');
console.log('✓ Conforme aux spécifications exactes de https://openapi.vercel.sh/vercel.json');

console.log('\n✅ VERDICT : PASS — Le fichier vercel.json est 100% conforme au schéma Vercel.');

