# Prépublication synthèse IA — 5 novembre 2026

Préparation locale uniquement. Aucune publication autorisée ou effectuée. Les commits candidats sont isolés sous `output/prepublication/`; le workspace applicatif validé est conservé.

## Décision

Préparation possible, **publication conditionnelle, pas de GO distant**. Il reste à vérifier les SHA GitHub actuels, les paramètres effectifs des deux projets Vercel (mode synthetic, entrée serverless, durée et absence de planification) et l'historique Neon. Ces vérifications ne sont pas remplacées par les résultats locaux.

Les deux commandes `git ls-remote` ont été bloquées avant exécution par le contrôle automatique d'autorisation : limite d'utilisation atteinte. Aucun contournement ni accès Neon n'a été réalisé.

## Migration

Nom : `20261105000100_report_fallback_email`.

SHA-256 : `e8153936ba0ea683a4cc0910695c7aa5e993d8d1080113e0c6ec252267d838c9`.

Cette migration remplace seulement `JobPublicationCandidate`. Elle ajoute les rapports `UNAVAILABLE` à la branche EMAIL, avec consentement, adresse et durée de validité toujours requis. Les branches OTP et SUMMARY restent identiques. Aucun DELETE, DROP, UPDATE de données, nouvelle table, transport ou planificateur. Les cinq colonnes et la vue dépendante `JobPublicationReady` sont conservées.

Elle est nécessaire pour aligner la réconciliation des publications d'e-mails de secours avec le traitement direct. Elle n'est pas nécessaire à la génération explicite elle-même. La migration ne lance aucun e-mail.

Attention : son horodatage précède `20261105020000_session_assessment_optional`, déjà présent dans les 21 migrations. Le nom validé est conservé. Le contrôle compare les noms et empreintes exacts, et non une position alphabétique supposée. Les 21 fichiers concordent avec la base Git locale backend. La qualification PGlite a appliqué les 21 migrations historiques, puis celle-ci : 270 colonnes inchangées, vue dépendante valide, remplacement répétable, aucune ligne de fixture insérée. Cela vérifie le SQL local, pas l'état actuel de Neon ni le moteur de déploiement Prisma sur Neon.

## Lanceur

Fichiers ajoutés : `backend/scripts/run-report-fallback-migration.ps1`, `report-fallback-migration.cjs`, `report-fallback-migration-manifest.json`, `qualify-fallback-view.cjs`.

`-CheckLocal` ne charge aucun `.env`, client Prisma ou connexion réseau. Il contrôle les 22 fichiers et leurs empreintes, le changement SQL exact et 10 URL interdites. Exécuté avec succès.

Les modes distants préparés, **non exécutés**, exigent un identifiant staging UUID et le projet `prj_...`. URL saisie masquée, jamais passée en argument ni enregistrée ; hôte épinglé `ep-wispy-paper-bazujx4k.c-8.eu-central-1.aws.neon.tech`, base `neondb`, rôle `neondb_owner`, connexion directe et `sslmode=verify-full`. Autres hôtes, pooler, rôle runtime, base historique, paramètres détournant la destination et TLS dégradé sont refusés. Contrôle en transaction READ ONLY : identité SQL, historique complet avec checksums, installation synthetic, administrateur, noms SYNTH et adresses `@example.test`, y compris emailIdentity. `-Apply` ne lance Prisma deploy qu'après ces contrôles et une nouvelle vérification locale. Aucun reset ou seed. Ce mode doit encore être qualifié et autorisé à distance ; ne pas le considérer comme une migration déjà appliquée.

## Fournisseurs et e-mails

Le choix du fournisseur repose sur `stagingConfiguration()`, jamais uniquement sur le nom SYNTH. En synthetic-v1, une configuration invalide ou la présence d'une clé Groq, Brevo ou QStash fait échouer le contrôle. L'installation et les données synthetic sont contrôlées. Le transport QStash simulé n'a pas de repli HTTP réel.

Le candidat conserve la simulation OTP et entretien de sa base Git. Copier aveuglément les fichiers du workspace aurait retiré ces protections : `adaptive.service.ts` et `brevo.service.ts` ont été fusionnés dans le candidat, sans modifier ces deux fichiers du workspace. Les dépendances et lockfiles des dépôts séparés sont conservés.

L'entrée Vercel `backend/index.mjs` exporte l'application sans démarrer les workers de `src/server.ts`. Ni le déploiement, ni un GET de consultation, ni la génération explicite ne lancent le worker d'e-mails. Un ancien job ne s'exécute pas spontanément. Une invocation explicite du traitement, sous configuration synthetic valide, ne peut utiliser que le transport simulé ; identités réelles refusées. Sans adresse ou sans consentement, pas d'envoi. COMPLETE utilise la synthèse IA validée ; UNAVAILABLE peut utiliser le bilan déterministe ; PENDING, RETRY et PROCESSING n'envoient rien prématurément.

**Limite de preuve :** le `.env` local n'est pas synthetic-v1 et contient des paramètres fournisseur non vides. Aucun contenu secret n'est reproduit, aucun fichier de configuration n'a été modifié. Ne pas démarrer ce serveur local sans isolation, ni copier cet environnement vers Vercel. La configuration distante effective n'a pas été lue. La garantie d'absence d'envoi réel après publication exige sa vérification, y compris absence de cron externe et utilisation d'index.mjs. Le POST interne synthetic/status n'est pas un contrôle distant sans écriture : il peut enregistrer un nonce, donc n'a pas été appelé.

## Génération et statuts

- PENDING : attend une demande explicite éligible.
- PROCESSING : une tentative détient un bail de 60 secondes. Acquisition atomique comparant statut, bail et compteur ; résultat enregistré seulement si le bail et la tentative correspondent encore.
- RETRY : nouvelle demande seulement après nextAttemptAt. Aucun retry automatique du bouton.
- COMPLETE : synthèse enregistrée, aucune nouvelle génération.
- UNAVAILABLE : terminal, bilan pédagogique conservé ; aucune quatrième tentative.

Chaque acquisition, y compris avant un crash, consomme une tentative. Plafond durable de trois ; les upserts ne réinitialisent pas le compteur. GET/me ne crée plus de job. POST/me/summary exige le bearer participant non expiré, le rate limiter et un bilan complet de 31 réponses. Le proxy frontend utilise la session privée existante. Une invocation attend au plus une tentative, sans worker permanent ni QStash. La simulation ne réserve pas de quota Groq.

Un ancien PENDING éligible peut être traité sans réécriture de ses réponses. Les essais locaux couvrent les baux actifs, dates de retry, crashes, langue FR/AR et participants incomplets/expirés. L'existence et l'éligibilité actuelles de SYNTH-Etudiant02 n'ont pas été vérifiées : ne pas effacer son job ou ses réponses pour contourner une expiration ou trois tentatives consommées.

Le timeout fournisseur existant est de 45 s ; le proxy et le client attendent 65 s. Aucun maxDuration explicite n'est déclaré dans les fichiers examinés. La durée effective Vercel et les latences DB restent à vérifier : le bail n'est pas une garantie de durée totale. Une coupure peut laisser PROCESSING jusqu'à expiration du bail, sans dépasser le plafond de trois tentatives.

## Déploiement successif et retour arrière

Migration d'abord : l'ancien backend ignore les candidats UNAVAILABLE qu'il ne sait pas encore traiter ; aucun changement du contrat de données. Backend ensuite : les anciens clients de consultation continuent à recevoir le même bilan et les mêmes statuts, sans génération implicite. Frontend enfin : le nouveau bouton nécessite la nouvelle route POST ; avec un ancien backend il échoue sans effacer le bilan. Garder l'ancien frontend pendant la publication backend. En cas de retour arrière, retirer d'abord le nouveau frontend ; ne pas inverser le DDL ni toucher aux réponses. Un rollback vers un backend ayant l'ancien GET qui crée des jobs réintroduirait ce comportement : il doit être évalué séparément.

## Vérifications et preuves

Les résultats historiques 211 backend / 33 frontend, builds et typechecks concernent le workspace validé, pas automatiquement les commits candidats. Journaux historiques : `output/fallback-email-backend-final.log` et `output/fallback-email-*.log`.

Sur le candidat fusionné : 18 tests synthèse/rapports réussis (dont PDF locaux FR/AR), 16 tests OTP réussis, 33 tests frontend réussis, typechecks backend/frontend et compilation backend réussis. Dépendances locales existantes utilisées, aucun téléchargement. Les tests emploient leurs fixtures éphémères et un garde réseau local ; aucun seed ou reset Neon. Résultats supplémentaires et SHA finaux dans `output/prepublication/candidates.json` et les journaux du même dossier. La suite backend intégrale et la qualification PostgreSQL native synthetic n'ont pas été relancées sur le candidat fusionné ; les 34 tests ciblés ne doivent pas être présentés comme 211 tests de ce commit.

## Commandes et ordre après autorisation séparée

Depuis la racine du workspace, contrôle local sans coût distant :

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File backend/scripts/run-report-fallback-migration.ps1 -CheckLocal
node backend/scripts/qualify-fallback-view.cjs
```

Avant toute écriture, reprendre les lectures GitHub bloquées :

```powershell
git ls-remote --heads https://github.com/noussben67-s/skill_test_backend.git
git ls-remote --heads https://github.com/noussben67-s/skill_test_frontend.git
```

Comparer main aux bases enregistrées dans candidates.json. Toute divergence impose une nouvelle fusion et requalification. Vérifier les paramètres Vercel actuels sans exporter les secrets. Ne pas exécuter les commandes suivantes tant que ces préconditions et l'autorisation explicite ne sont pas obtenues.

1. Migration Neon : substituer les identifiants existants vérifiés, pas de nouveaux secrets. D'abord lecture puis application seulement si absente :

```powershell
$stagingId = '<UUID existant vérifié>'
$projectId = '<prj_ existant vérifié>'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File backend/scripts/run-report-fallback-migration.ps1 -CheckRemote -ExpectedStagingId $stagingId -ExpectedProjectId $projectId
# ÉCRITURE DISTANTE : autorisation de migration nécessaire
powershell.exe -NoProfile -ExecutionPolicy Bypass -File backend/scripts/run-report-fallback-migration.ps1 -Apply -ExpectedStagingId $stagingId -ExpectedProjectId $projectId
```

2. Publication backend : commit candidat backend uniquement, après contrôle du branchement Git/Vercel. Une poussée peut déclencher Vercel automatiquement ; elle exige donc une autorisation de publication. Aucun force push. Les dépôts candidats bloquent volontairement push via pushurl et hook ; ne pas retirer ces barrières maintenant. La commande de build du projet est `npm run build:vercel --workspace=backend`. La commande distante de publication ne peut être figée sans confirmer le projet, la branche de déploiement et le SHA distant ; ne pas inventer ces paramètres.

3. Publication frontend : seulement après vérification du backend, commit candidat frontend, build `npm run build --workspace=frontend`. Même précondition Git/Vercel et même interdiction actuelle de push.

4. Test SYNTH-Etudiant02 : ouvrir sa session existante, relever les 31 réponses et le statut avant action, cliquer une fois « Générer la synthèse », vérifier COMPLETE et la consultation FR/AR. Recharger doit conserver la synthèse sans tentative supplémentaire. Si RETRY, respecter la date ; si UNAVAILABLE/expiré, consigner le résultat sans reset. Comparer les réponses avant/après. Aucun test d'e-mail réel.

5. Administrateur : vérifier le même participant, ses 31 réponses, le bilan et la synthèse ; ouvrir le rapport et le PDF existants en FR/AR. Vérifier absence d'envoi réel et absence de job automatique lancé par la consultation. Les appels de recette après publication peuvent écrire des données de simulation : ils nécessitent eux aussi l'autorisation de cette phase.

Le budget de cette préparation est nul en services externes : aucune API payante, Neon, QStash, publication ou installation distante exécutée. Les éventuels coûts d'une future opération hébergée doivent être confirmés avant son autorisation, sans changement de forfait.

## SQL intégral

```sql
-- Terminal fallback reports use the existing dormant email publication path.
-- No transport, credential or scheduler is enabled by this migration.
CREATE OR REPLACE VIEW "JobPublicationCandidate" AS
WITH clock AS MATERIALIZED (SELECT (clock_timestamp() AT TIME ZONE 'UTC') AS now)
SELECT 'OTP_INITIAL'::text AS kind,j.id AS "jobId",'DELIVER'::text AS phase,j.attempts AS generation,
  j."nextAttemptAt" AS "dueAt"
FROM "ParticipantEmailDeliveryJob" j JOIN "EmailOtpChallenge" c ON c.id=j."challengeId" CROSS JOIN clock
WHERE j.status IN ('PENDING','UNCERTAIN') AND j."nextAttemptAt" IS NOT NULL
  AND j."expiresAt">clock.now AND c."expiresAt">clock.now AND c."consumedAt" IS NULL
  AND c."codeHash"=j."codeHash" AND c.attempts<LEAST(5,c."maxAttempts") AND j.attempts<6 AND j."encryptedPayload" IS NOT NULL
  AND (j."leaseUntil" IS NULL OR j."leaseUntil"<=clock.now)
  AND NOT EXISTS (SELECT 1 FROM "EmailBudgetReservation" r WHERE r."logicalKey"=j.id::text AND r.status='UNCERTAIN')
UNION ALL
SELECT 'OTP_RETAKE',j.id,'DELIVER',j.attempts,j."nextAttemptAt"
FROM "OtpDeliveryJob" j JOIN "AdaptiveInterview" i ON i.id=j."interviewId" CROSS JOIN clock
WHERE j.status IN ('PENDING','UNCERTAIN') AND j."nextAttemptAt" IS NOT NULL AND j."expiresAt">clock.now
  AND i."retakeCodeHash"=j."codeHash" AND i."retakeCodeExpiresAt">clock.now AND i."retakeCodeAttempts"<5
  AND j.attempts<6 AND j."encryptedPayload" IS NOT NULL AND (j."leaseUntil" IS NULL OR j."leaseUntil"<=clock.now)
  AND NOT EXISTS (SELECT 1 FROM "EmailBudgetReservation" r WHERE r."logicalKey"=j.id::text AND r.status='UNCERTAIN')
UNION ALL
SELECT 'REPORT',j.id,'SUMMARY',j.attempts,
  CASE WHEN j.status='PROCESSING' THEN j."leaseUntil" ELSE j."nextAttemptAt" END
FROM "AdaptiveReportJob" j JOIN "AdaptiveInterview" i ON i.id=j."interviewId" CROSS JOIN clock
WHERE i."expiresAt">clock.now AND
  ((j.status IN ('PENDING','RETRY') AND j."nextAttemptAt" IS NOT NULL)
   OR (j.status='PROCESSING' AND j."leaseUntil"<=clock.now))
UNION ALL
SELECT 'REPORT',j.id,'EMAIL',j."emailAttempts",
  CASE WHEN j."emailStatus"='PROCESSING' THEN j."emailLeaseUntil" ELSE j."emailNextAttemptAt" END
FROM "AdaptiveReportJob" j JOIN "AdaptiveInterview" i ON i.id=j."interviewId" CROSS JOIN clock
WHERE i."expiresAt">clock.now AND i."reportEmailRequested" AND i.email IS NOT NULL
  AND ((j.status='COMPLETE' AND j.summary IS NOT NULL) OR j.status='UNAVAILABLE')
  AND ((j."emailStatus" IN ('PENDING','RETRY')) OR (j."emailStatus"='PROCESSING' AND j."emailLeaseUntil"<=clock.now))
  AND (j."emailAttemptWindowAt" IS NULL OR j."emailAttemptWindowAt">clock.now-interval '10 minutes');
```

## R?sultat final des candidats locaux

Backend : `bfed5450ca45d2de2b7c8276fe827c9ef55be040`, base `2a0616c5956a1eb9163243b5efb5f071cbba3ff5`.

Frontend : `cd8bc11874262bfaca57b20e7267741c5be0d20e`, base `73dc11b10a96610d2c5fcb6ee06b1903ea4d0d1c`.

Branche locale dans chaque d?p?t : `review/summary-publication-20261105`. Arbres de travail propres. Bundles et patches dans `output/prepublication/`. La liste exacte des 20 fichiers backend et 5 fichiers frontend figure dans `candidates.json`. Aucun de ces SHA n'a ?t? pouss?.

Build frontend final confirm? : code natif 0, 37 pages g?n?r?es, journal `frontend-build-confirmed.log`, r?sultat `frontend-build-result.json`. Un premier essai depuis une mauvaise racine puis une relance chevauchante ont produit un artefact manquant ; arr?t, nettoyage limit? au dossier .next du candidat et relance s?quentielle. Un avertissement Next sur les lockfiles imbriqu?s a ?galement n?cessit? de capturer le code natif ind?pendamment de PowerShell. Aucun changement du code frontend ou de sa configuration pour contourner ces essais.

Le d?lai de retry OTP simul? de la base (30 s) a ?t? conserv? dans la fusion finale ; les 16 tests OTP, le typecheck et la compilation backend ont ?t? relanc?s apr?s cette pr?cision. Les 18 tests de rapports restent applicables : leur branche conserve son d?lai de 60 s. Le rapport pr?sent dans le commit backend pr?c?de cette annexe de r?sultats et renvoie au manifeste final.
