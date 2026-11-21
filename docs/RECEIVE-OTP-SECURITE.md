# Réception OTP synthétique — renforcement local

Date : 8 novembre 2026. **PASS sur les suites locales exécutées : 45 tests,
zéro échec, zéro ignoré.** Typecheck et build backend réussis.
Ce correctif n'est pas publié. Aucun appel OTP, accès Neon ou changement Vercel
n'a été effectué. Aucun secret de production n'a été demandé, affiché ou modifié.

## Manque identifié dans 6b9e1a0

La route `/api/internal/synthetic/notifications/receive` acceptait seulement
`{ id }`, lisait l'enveloppe et appelait le consommateur générique. La session
ADMIN, la preuve et le mode synthétique protégeaient bien l'accès, mais le corps
ne liait pas la réception au nom, à l'adresse attendue ou au challenge du formulaire.
Le lanceur vérifiait le couple job/notification dans `status` ; ce contrôle n'était
ni une validation complète côté serveur, ni un verrou couvrant la livraison.

## Correctif

La route conserve son URL, mais exige désormais exactement le même objet strict
que `publish-otp` : `jobId`, `challengeId`, `notificationId`, `fullName` égal à
`SYNTH-Participant`, et l'adresse exacte en `@example.test`.
Les anciens corps `{ id }`, tableaux et propriétés supplémentaires sont refusés.

`publish-otp` ajoute au JSON de la notification une liaison HMAC dédiée,
`otpTargetProof`, dérivée du secret de staging existant par un usage HKDF distinct.
Elle lie les trois UUID, le nom et l'adresse. Aucun nouveau secret ou champ Prisma
n'est nécessaire. Cette liaison n'est ni un OTP ni une session et ne remplace
aucune authentification HTTP.

Le nouveau service `receiveSyntheticOtp` :

1. Revérifie le mode et l'identité de la base synthétique.
2. Prend le verrou du budget partagé dans le même ordre que le mécanisme existant,
   puis verrouille le gate, le challenge, le job, l'intention et la notification exacts.
3. Exige un challenge INITIAL actif, non consommé, non expiré et sous son plafond
   d'essais ; un job PENDING correspondant et non expiré ; une intention PUBLISHED
   de génération/date courantes ; une notification non reçue ; aucune réservation
   déjà acceptée ou incertaine.
4. Compare la liaison HMAC en temps constant, vérifie l'enveloppe et déchiffre
   uniquement en mémoire le payload existant pour confirmer l'adresse et le nom.
5. Exécute la file OTP et le mécanisme de quota existants avec le même client
   transactionnel. Le traitement n'utilise pas le singleton d'une autre connexion.
6. Enregistre le résultat sur cette seule notification avant le commit.

Les sous-transactions habituelles de la file et du budget utilisent des SAVEPOINTs
dans la transaction synthétique englobante. Leurs erreurs logiques ou SQL gardent
leur rollback local ; une erreur fatale finale annule ensemble tentative, compteurs,
réservation, capture et reçu. Il n'y a aucune transaction ouverte pendant un appel
fournisseur : cette réception est exclusivement synthétique et ne fait aucun HTTP.

Le verrou de budget partagé peut sérialiser deux réceptions de jobs différents,
comme l'imposent déjà les quotas ; aucune publication ou réception globale n'est
déclenchée. La nouvelle dépendance DB optionnelle de `sendReportEmail` est interne,
non configurable dans le corps HTTP. Les appels existants sans cet argument
conservent leur résolution du client habituel.

Un résultat COMPLETE exige un job accepté, une réservation acceptée et une capture
OTP chiffrée. Les résultats REJECTED, UNCERTAIN ou DEFERRED restent distincts et le
lanceur s'arrête. Un résultat incertain n'autorise pas un renvoi automatique.
Le challenge n'est jamais consommé par la réception : l'utilisateur doit encore
saisir personnellement le vrai code dans le formulaire normal.

## Résultats PASS/FAIL

- **PASS — bonne cible :** une capture, une réservation acceptée, une tentative,
  une réception ; challenge toujours non consommé.
- **PASS — autre participant :** adresse différente ou nom différent refusés.
- **PASS — challenge incorrect ou devenu inactif :** aucun traitement ; gate
  courant vérifié à nouveau après la publication.
- **PASS — job incorrect :** UUID croisés entre job, challenge et notification refusés.
- **PASS — expiration ou traitement antérieur :** challenge/job expiré, job accepté
  ou notification déjà reçue refusés sans nouvelle capture.
- **PASS — concurrence native :** deux connexions PostgreSQL indépendantes ; attente
  sur verrou réellement observée ; un seul traitement et un seul quota facturé.
- **PASS — substitution publish → receive :** enveloppe modifiée, HMAC remplacé,
  payload d'identité modifié après publication et capture sans liaison refusés.
- **PASS — rollback/reprise :** erreur SQL réelle 22012 injectée à l'écriture du
  reçu final ; aucune capture, tentative, réservation ou charge conservée ; reprise
  avec l'autre connexion réussie une seule fois.
- **PASS — quotas et pannes :** budget zéro bloquant, rejet simulé comptabilisé,
  acceptation incertaine conservée et répétition refusée.
- **PASS — protections :** ADMIN, preuve cryptographique, anti-rejeu, nom/adresse
  stricts, mode désactivé, clés de fournisseurs interdites et refus de publication
  globale dans le lanceur.
- **PASS — compatibilité locale :** tests de publication et de signature conservés,
  typecheck complet du backend et build backend.

Les 45 tests comprennent **20 tests PostgreSQL natifs**, **15 tests du lanceur**
et **10 tests locaux de publication**. Ce n'est pas l'ensemble des tests du dépôt.

Preuves natives : PostgreSQL **17.11**, connexions physiques PID **39020** et
**3472**, [journal de tests](../output/otp-native-qualification/run-UJcmkv/tests.stdout.log),
[observations de concurrence](../output/otp-native-qualification/run-UJcmkv/native-evidence.json),
[arrêt et nettoyage](../output/otp-native-qualification/run-UJcmkv/shutdown.json).
Le cluster était neuf et local sur loopback ; après les tests : processus arrêté,
port fermé, données supprimées. Zéro tentative HTTP externe.

Une anomalie d'outillage a été corrigée lors de l'extension des tests : les captures
`SyntheticMail` des nouveaux cas de réception devaient être vidées entre fixtures.
Après ajout de cette table au nettoyage de la base de test, les suites ont été
rejouées sur des clusters neufs. Aucun changement des contrôles de production
n'a été fait pour obtenir leur réussite.

## Fichiers modifiés

- [Service de réception ajouté](../backend/src/services/synthetic-otp-receive.service.ts).
- [Route synthétique](../backend/src/routes/synthetic-staging.routes.ts).
- [Liaison cryptographique dédiée](../backend/src/security/synthetic-staging.ts).
- [Publication liée à la cible](../backend/src/services/synthetic-otp-publication.service.ts).
- [Envoi avec client DB interne optionnel](../backend/src/services/brevo.service.ts).
- [Lanceur : challenge et réponse stricts](../backend/scripts/synthetic-admin-launcher.mjs).
- [Tests du lanceur](../backend/scripts/synthetic-admin-launcher.test.mjs).
- [Tests PostgreSQL natifs](../backend/tests/synthetic-otp-publication.native.cases.ts).
- [Fixture locale de publication complétée](../backend/tests/synthetic-otp-publication.offline.ts).
- Ce rapport, `DEPLOYMENT.md`, `SYNTHETIC-OPERATOR-LOCAL.md` et
  `PUBLICATION-OTP-SYNTHETIQUE.md` : références et procédure actualisées.
- Sorties `backend/dist` régénérées par le build local, sans déploiement.

Aucune migration, modification du schéma Prisma, configuration Neon, dépendance
npm, variable Vercel ou changement de secret n'est requis par ce correctif.
Les scripts de qualification restent locaux ; le handler importe le service
applicatif, jamais les scripts ou tests. Le consommateur QStash générique et les
routes réelles de l'application ne sont pas remplacés par ce service.

## Compatibilité et candidat de publication

**Le backend annoncé déployé 6b9e1a0 n'inclut pas ce renforcement.** Le nouveau
lanceur ne doit pas être utilisé pour un parcours OTP de production avant le
déploiement autorisé du candidat backend correspondant.

Les notifications publiées par l'ancien code n'ont pas `otpTargetProof` : elles
sont intentionnellement refusées. Ne pas les réparer en SQL ni ajouter une liaison
après coup. Une nouvelle demande OTP normale devra être explicitement autorisée
après mise à jour du backend et préparation des prérequis. Pas de migration ou
de conversion automatique des captures existantes.

La future commande de réception inclut maintenant le challenge, après la
notification, comme celle de publication :

```powershell
node backend/scripts/synthetic-admin-launcher.mjs receive <ADRESSE_EXAMPLE_TEST> <JOB_UUID> <NOTIFICATION_UUID> <CHALLENGE_UUID> --authorized-production-writes --confirmed-synthetic-deployment
```

Les trois UUID et l'adresse doivent être exactement ceux validés par `publish-otp`.
La saisie du mot de passe et du secret existants reste masquée et personnelle.
Aucun retry ou fallback vers l'ancienne réception, le batch ou `/jobs/run` n'est ajouté.

**Aucun commit n'est créé.** Candidat proposé après revue du diff sur la base
backend exacte `6b9e1a0` : `fix(otp): bind synthetic receive to its published target`.
Publication et réception doivent être livrées dans le même candidat, car la seconde
exige la liaison créée par la première. Un retour à l'ancien backend réintroduirait
l'ancien contrat de réception ; le lanceur renforcé doit alors rester arrêté.

Reproduction locale :

```powershell
node backend/scripts/qualify-synthetic-otp-native.mjs --pg-bin output/pg-native-ef583905f4cd/portable/pgsql/bin
node --loader ./backend/tests/helpers/local-typescript-loader.mjs --test backend/tests/synthetic-otp-publication.offline.ts backend/scripts/synthetic-admin-launcher.test.mjs
node node_modules/typescript/bin/tsc --noEmit -p backend/tsconfig.tests.json
node node_modules/typescript/bin/tsc -p backend/tsconfig.json
```

Sous le sandbox Windows, le lanceur natif nécessite l'exécution locale hors sandbox
déjà utilisée pour la qualification précédente ; il n'accepte pas de DSN arbitraire.
Le service n'a pas été validé sur Neon ou Vercel. Aucun push, déploiement ou parcours
OTP de production n'est effectué. Budget de la préparation : **0 DH**.
