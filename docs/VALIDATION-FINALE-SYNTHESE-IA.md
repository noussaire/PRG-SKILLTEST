# Validation finale — synthèse IA

**Décision : pas de GO publication. Migration qualifiée localement ; autorisation et contrôles distants encore nécessaires.**

## Contrôles réussis

- Candidat backend `bfed5450ca45d2de2b7c8276fe827c9ef55be040`, sans modification applicative pendant cette validation. Suite complète `tests/*.test.ts` exécutée : **533 tests, 210 réussis, 323 ignorés, 0 échec**, code de sortie 0. Les tests ignorés dépendent notamment de PostgreSQL natif ; ce résultat ne constitue pas une qualification intégrale des 533 cas. Journal : `output/prepublication/backend-full-final.log`.
- Migration `20261105000100_report_fallback_email` : essai réel avec le CLI Prisma installé et PostgreSQL local isolé sur 127.0.0.1. Premier `migrate deploy` avec les 21 migrations historiques ; ajout de la migration au nom antérieur ; second deploy : elle est appliquée en dernier, 22 entrées réussies et checksums exacts. Troisième deploy : aucune migration en attente. Aucun reset ou seed. Serveur local arrêté. Preuve : `output/prepublication/prisma-order-result.json`, journal `output/prepublication/prisma-order-bvw75z/target-deploy.log`.
- SQL : uniquement CREATE OR REPLACE VIEW. Colonnes conservées : `kind`, `jobId`, `phase`, `generation`, `dueAt`. La branche EMAIL accepte aussi UNAVAILABLE ; branches OTP/SUMMARY inchangées. Aucun DML de suppression. Contrôle PGlite : 270 colonnes inchangées après les 21 migrations puis le remplacement.
- Dépendances : `JobPublicationReady` reste interrogeable. Les services `job-publication.service.ts`, `qstash-consumer.service.ts` et le trigger de publication utilisent les mêmes colonnes. Les routes étudiant/administrateur utilisent les modèles de rapport, sans changement de structure ; consultation et PDF sont couverts par les tests FR/AR de la suite exécutée.
- Lanceur du candidat `run-report-fallback-migration.ps1 -CheckLocal` : succès, 22 empreintes, changement SQL exact, 10 URL dangereuses refusées, zéro connexion Neon.
- synthetic-v1 : sélection par configuration serveur, jamais par seul préfixe SYNTH. Configuration invalide ou clé réelle Groq/Brevo/QStash présente : refus. Les jobs anciens passent par les mêmes services de transport et contrôles d'identité/installation ; aucune exception liée à leur âge. Tests des anciens jobs, baux, trois tentatives, absence de repli Groq et e-mails simulés FR/AR réussis. QStash reste simulé sans fallback fetch réel.
- Entrée serverless `backend/index.mjs` : export HTTP sans import de `src/server.ts`, sans démarrage des workers permanents. POST authentifié et attendu, acquisition atomique, bail 60 s, plafond durable de trois tentatives ; GET de rapport sans génération.
- GitHub, lecture `ls-remote --heads ... main` réussie : backend **2a0616c5956a1eb9163243b5efb5f071cbba3ff5**, frontend **73dc11b10a96610d2c5fcb6ee06b1903ea4d0d1c**. Correspondance exacte avec les SHA attendus. Aucune poussée.

## Contrôles bloqués ou limites

- **Vercel : durée effective non vérifiée.** Aucun maxDuration explicite dans les fichiers examinés. Le timeout fournisseur est de 45 s, le proxy de 65 s ; le bail de 60 s n'est pas une limite totale d'exécution. Les paramètres des projets/fonctions hébergés n'ont pas été consultés dans cette phase. Il faut autoriser leur lecture et confirmer aussi les marges DB et réseau avant de déclarer la compatibilité de durée.
- **Configuration hébergée synthetic-v1 non certifiée dans cette phase.** Les protections du code sont vérifiées, pas les variables actuellement déployées ni les éventuels planificateurs externes. Aucun secret modifié ou exporté.
- **Neon : historique actuel non relu.** La migration est prête techniquement d'après les qualifications locales, mais son application doit rester conditionnée au CheckRemote épinglé (21 historiques exactes, ou 22 si déjà appliquée, destination et installation synthetic vérifiées).
- Les 323 tests ignorés restent une limite de couverture. Aucune affirmation de « 533 tests réussis ».

L'essai PostgreSQL initial a été bloqué par le sandbox Windows (pg_ctl, jeton restreint, erreur 87). La relance locale autorisée avec les permissions nécessaires a réussi ; ce blocage est résolu. Le blocage GitHub précédent est également résolu. Aucun accès Neon, aucun fournisseur réel, aucun déploiement ou dépense externe pendant cette validation ; seules les lectures GitHub demandées ont été effectuées à distance.

## Commandes préparées — ne pas exécuter sans autorisation

Racine : `C:\Users\pc\Downloads\skillquest-corrige\skillquest-starter`. Les commits restent backend `bfed5450ca45d2de2b7c8276fe827c9ef55be040` et frontend `cd8bc11874262bfaca57b20e7267741c5be0d20e`.

1. Après autorisation de lecture Neon, renseigner `$stagingId` et `$projectId` avec les **identifiants existants vérifiés**. Ils ne sont pas inventés dans ce rapport. URL saisie masquée par le lanceur. Après autorisation distincte d'écriture, appliquer seulement si nécessaire :

```powershell
$launcher = '.\output\prepublication\backend-candidate\backend\scripts\run-report-fallback-migration.ps1'
& $launcher -CheckLocal
& $launcher -CheckRemote -ExpectedStagingId $stagingId -ExpectedProjectId $projectId
# Écriture Neon : uniquement après autorisation explicite
& $launcher -Apply -ExpectedStagingId $stagingId -ExpectedProjectId $projectId
```

2. Publication backend puis frontend, **uniquement si la liaison Vercel à main a été confirmée et la publication autorisée**. Les commandes ci-dessous utilisent des copies neuves des bundles pour préserver les candidats dont le push est volontairement désactivé. Aucun force push ; si main a avancé, arrêter et requalifier. Une poussée sur main peut déclencher Vercel : ces lignes sont des opérations de publication, pas des vérifications.

```powershell
# Vérification fraîche immédiatement avant publication autorisée
git ls-remote --heads https://github.com/noussben67-s/skill_test_backend.git main
git ls-remote --heads https://github.com/noussben67-s/skill_test_frontend.git main

# Backend : après migration et validation des paramètres Vercel
git clone --branch review/summary-publication-20261105 .\output\prepublication\backend-candidate.bundle .\output\prepublication\publish-backend
git -C .\output\prepublication\publish-backend push https://github.com/noussben67-s/skill_test_backend.git bfed5450ca45d2de2b7c8276fe827c9ef55be040:refs/heads/main

# Attendre et vérifier le déploiement backend avant cette seconde publication
git clone --branch review/summary-publication-20261105 .\output\prepublication\frontend-candidate.bundle .\output\prepublication\publish-frontend
git -C .\output\prepublication\publish-frontend push https://github.com/noussben67-s/skill_test_frontend.git cd8bc11874262bfaca57b20e7267741c5be0d20e:refs/heads/main
```

Ces commandes ne remplacent pas la vérification du branchement des projets Vercel. Si main n'est pas leur branche de publication, **ne pas les exécuter** : la commande Vercel exacte reste bloquée par l'absence de paramètres de projet vérifiés. Aucun `vercel --prod` sans projet explicitement identifié.

3. Après autorisation de recette : session existante SYNTH-Etudiant02, relever les 31 réponses, cliquer une seule fois sur le bouton, vérifier synthèse FR/AR persistée et absence de tentative supplémentaire au rechargement. Respecter RETRY/expiration/plafond de trois ; aucun reset.

4. Vérifier le même bilan et les PDF administrateur FR/AR, puis l'absence d'envoi réel. Pas de worker, QStash ou transport Brevo à activer.

**Ordre obligatoire : contrôles distants autorisés → migration si nécessaire → backend → frontend → SYNTH-Etudiant02 → bilan/PDF administrateur.**
