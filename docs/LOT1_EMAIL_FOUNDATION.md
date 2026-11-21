# Lot 1 ? socle dormant

Seul backend/prisma/schema.prisma est modifi? parmi les fichiers applicatifs existants.
Aucun service, endpoint, interface FR/AR ou m?canisme administrateur n'utilise encore les nouvelles tables.

## Structures
- EmailOtpChallenge : identit? pseudonymis?e, finalit? INITIAL/RETAKE, HMAC, expiration, consommation et essais born?s. Aucun lien aux ?tudiants, aucune r?servation d'adresse.
- EmailAbuseCounter : cl? compos?e scope/sujet/m?trique/fen?tre, expiration et compteur positif. Les incr?ments conditionnels atomiques sont d?montr?s dans les tests, pas encore int?gr?s.
- EmailBudgetReservation : cl? logique et UUID uniques, empreinte de requ?te, unit?s, ?tat, fen?tre de budget, bail et fen?tre de reprise. Une r?servation d?j? tent?e ne peut ?tre lib?r?e par simple changement de statut.
- EmailProviderState : blocage durable du fournisseur, code interne et r?vision.

Les limites globales, transactions r?unissant plusieurs compteurs/r?servations, r?tention, HMAC et transitions m?tier seront impl?ment?s au lot 2. Ces tables ne garantissent pas seules un plafond global.

## Migration
20261030010000_email_security_foundation : CREATE TABLE et CREATE INDEX seulement. Aucun changement des dix migrations existantes ni backfill ?tudiant. Contraintes CHECK SQL suppl?mentaires aux mod?les Prisma. Ne pas utiliser db push pour remplacer cette migration.

## Isolation et r?sultats
Le nouveau helper alloue PGlite en m?moire sans URL, sans dataDir et v?rifie que le sch?ma public est vide avant migration. Tests synth?tiques uniquement. Les suites existantes retenues allouent aussi PGlite en m?moire avant migration et remplacent DATABASE_URL par le socket local avant import du client.
3 nouveaux tests r?ussis, 31 tests existants cibl?s r?ussis, 0 ?chec au dernier passage. TypeScript backend/tests et validation Prisma r?ussis. Aucun prisma migrate ou db deploy ex?cut?.
Les concurrences sont des requ?tes simultan?es contre PGlite ; elles ne remplacent pas une validation future entre plusieurs processus PostgreSQL.
Le simulateur couvre acceptation, doublon, expiration de d?duplication, quota, 429 et r?ponse perdue apr?s acceptation. Aucun appel Brevo. Un garde fetch pr?charg? refuse toute destination sauf HTTP 127.0.0.1 pour les suites API locales.
Le lanceur tsx ?choue ici avec uv_os_get_passwd ENOMEM. Le chargeur de secours local corrige la r?solution TS sans modifier les sources. Un premier essai de ce chargeur a ?chou? sur la r?solution des imports ; apr?s correction toutes les suites cibl?es passent.

## Idempotence Brevo
Documentation consult?e le 30 octobre 2026 :
https://developers.brevo.com/docs/heterogenous-versions-batch-emails
https://developers.brevo.com/reference/send-transac-email
Support document? : UUID dans headers du corps JSON, TTL 30 minutes, duplicate_parameter en cas de r?utilisation pendant cette fen?tre. La r?f?rence montre aussi IdempotencyKey pour smtp/email. Aucune v?rification r?elle sur le compte n'a ?t? effectu?e. Le simulateur ne prouve pas le comportement du fournisseur. Ne pas pr?senter cela comme une garantie exactement-une-fois ; borner les reprises et conserver UNCERTAIN apr?s expiration.

## Retour arri?re local pr?par?, non ex?cut?
Dossier : output/lot1-rollback-0a5d32857757.
- schema.prisma : copie exacte du sch?ma avant lot 1 ; hash dans baseline.json.
- baseline.json : empreintes des dix anciennes migrations.
- verification.json : v?rifications finales.
- test-loader.mjs et network-guard.mjs : lanceur local de secours et garde r?seau.
- regression-results.txt : r?sultats du dernier passage.
La sauvegarde de pr?paration de 192 fichiers reste intacte. Elle n'incluait pas les extensions .prisma : la copie d?di?e du sch?ma corrige ce manque pour ce lot.
Pour revenir en arri?re avant toute utilisation : v?rifier les hashes, restaurer uniquement le sch?ma depuis cette copie et retirer uniquement les fichiers nouveaux de ce lot apr?s revue. Ne jamais restaurer globalement un dossier au risque d'?craser d'autres changements. Aucune commande destructive automatique fournie.
Aucune migration n'a ?t? appliqu?e ? une base persistante : aucun rollback de base r?elle n?cessaire. Le retrait et la r?application des quatre tables ont ?t? v?rifi?s uniquement dans PGlite avec comparaison des lignes synth?tiques ?tudiant et session administrateur.
Si ces structures sont appliqu?es plus tard ? une base persistante, pr?f?rer un retour applicatif laissant les tables additives en place ; aucune suppression SQL sans analyse de leurs donn?es.

## Reproduction locale
node --loader ./output/lot1-rollback-0a5d32857757/test-loader.mjs --import ./output/lot1-rollback-0a5d32857757/network-guard.mjs --test --test-concurrency=1 backend/tests/email-foundation.test.ts backend/tests/adaptive-api.test.ts backend/tests/admin-adaptive-api.test.ts backend/tests/report-email.test.ts backend/tests/migration.test.ts
node node_modules/typescript/bin/tsc --noEmit -p backend/tsconfig.tests.json

## Suite
Lot 2 non commenc?. Aucun changement des parcours initiaux, reprises ou rapports : les cinq probl?mes fonctionnels restent ? corriger selon le plan valid?.
