# Qualification native de la publication OTP synthétique

Date : 8 novembre 2026. Résultat : **PASS pour le périmètre local testé**.
Aucune publication, connexion ou modification de production n'a été effectuée.

## Environnement vérifié

- PostgreSQL **17.11**, natif Windows x86_64, démarré depuis les binaires portables
  déjà présents dans le projet ; aucun téléchargement ni coût.
- Cluster neuf et jetable, schéma public vide vérifié avant chargement du SQL
  existant ; écoute uniquement sur `127.0.0.1`, port aléatoire différent de 5432.
- Deux clients Prisma indépendants, chacun limité à une connexion physique.
  PID PostgreSQL observés : **27568** et **27732**.
- Pour chaque connexion : vérification de l'adresse loopback, du port, de l'utilisateur
  technique local, du nom de base, du répertoire de données et de l'identifiant
  physique du cluster. Aucun DSN fourni par le terminal n'est accepté.
- Environnement enfant limité à une liste de variables système ; configuration
  synthétique de fixture et URL locale explicites. Découverte `.env` désactivée
  pour les clients Prisma et les imports applicatifs des tests.
- Toute utilisation du `fetch` applicatif est bloquée ; le test HTTP appelle
  explicitement uniquement son propre serveur loopback. **Zéro tentative HTTP externe**.

Preuves conservées dans
[le dossier de la qualification réussie](../output/otp-native-qualification/run-5fz6ra) :
[identité du cluster](../output/otp-native-qualification/run-5fz6ra/identity.json),
[preuves de concurrence](../output/otp-native-qualification/run-5fz6ra/native-evidence.json),
[journal des dix tests natifs](../output/otp-native-qualification/run-5fz6ra/tests.stdout.log),
[arrêt et nettoyage](../output/otp-native-qualification/run-5fz6ra/shutdown.json).
Ces preuves ne contiennent aucun secret de production.

## Résultats PASS/FAIL

- **PASS — deux publications du même OTP.** La première transaction est suspendue
  après acquisition de ses verrous. Depuis cette transaction, le test observe
  `pg_stat_activity.wait_event_type='Lock'` pour la seconde connexion et vérifie
  que `pg_blocking_pids` désigne la première. Après libération : première validée,
  seconde refusée, une capture et un seul incrément de publication.
- **PASS — deux jobs différents.** Pendant que le job A reste verrouillé, la
  connexion B publie son propre job et valide sa transaction. Un troisième job
  témoin reste `PENDING`, avec zéro tentative. Après libération de A : deux
  captures au total, exactement une pour chacun des deux jobs autorisés.
- **PASS — autre participant.** Le nom contenu dans le payload chiffré, l'adresse,
  le challenge, le job et la notification sont recoupés. Un nom différent ou
  des identifiants croisés sont refusés sans capture ni incrément de publication.
- **PASS — expiration.** Challenge expiré et job expiré sont refusés selon
  l'horloge PostgreSQL, sans prolongation ni modification de leur validité.
- **PASS — déjà publié, traité ou consommé.** La répétition sur une intention
  publiée, un job `ACCEPTED` et un challenge consommé est refusée sans doublon.
- **PASS — publication multiple et intention inexistante.** Les tableaux, `limit`,
  listes de jobs et UUID d'intention inexistants n'entraînent aucune publication.
- **PASS — rollback et reprise.** Une vraie erreur SQL `division by zero` est
  injectée après le changement de l'intention mais avant la capture ; son code SQL
  `22012` est explicitement vérifié. La transaction
  est annulée : intention `PENDING`, zéro capture, zéro tentative conservée. L'autre
  connexion publie ensuite une fois ; une répétition reste refusée.
- **PASS — courses répétées.** Huit nouveaux jobs sont chacun soumis simultanément
  aux deux connexions : un succès par paire, huit captures et huit incréments
  au total. Aucun doublon observé.
- **PASS — protections HTTP sur PostgreSQL natif.** Session ADMIN de fixture réellement
  enregistrée dans la base locale ; absence de Bearer, rôle STUDENT, preuve invalide,
  mauvais nom/adresse et rejeu sont refusés. Mode désactivé : route indisponible.
  Un appel signé valide publie exactement une intention.
- **PASS — lanceur et régressions ciblées.** Les 24 tests préexistants sont rejoués,
  dont le refus de `publish` global, la signature officielle, la publication ciblée
  stricte, la saisie masquée, la conservation du jeton en mémoire et l'absence de
  fallback vers le batch ou l'exécution directe.
- **PASS — TypeScript.** `tsc --noEmit -p backend/tsconfig.tests.json`.
- **PASS — build backend.** `tsc -p backend/tsconfig.json`, commande équivalente au
  script npm `build` du backend. Aucun build Vercel ni déploiement.

Total : **34 tests réussis, zéro échec, zéro ignoré** dans les suites exécutées
(10 PostgreSQL natifs + 24 tests locaux ciblés). Ce total n'est pas celui de
l'ensemble des tests du dépôt.

## Pourquoi une intention n'est pas publiée deux fois

Le service verrouille le gate, le challenge, le job et l'intention exacte, puis
effectue le passage `PENDING → PUBLISHED` sous condition dans la même transaction
que la capture synthétique. Le second appel ne peut plus effectuer cette transition
après le premier commit. L'UUID de notification est en outre une clé primaire de
`SyntheticNotification` ; la transaction annule ensemble capture et état sur erreur.
Le protocole anti-rejeu HTTP complète ces contraintes sans s'y substituer.

La qualification vérifie ces propriétés avec deux sessions natives et un blocage
réel observé lors d'appels concurrents au service. Les tests HTTP vérifient
séparément la preuve et le rejeu de nonce. Il s'agit d'une preuve sur les scénarios exécutés et le
code examiné, pas d'une garantie absolue sur toute évolution future du système.

## Anomalies et corrections de qualification

Aucune anomalie fonctionnelle du service n'a été reproduite ; aucun changement du
service ou de la route n'a été nécessaire pendant cette qualification.

Deux adaptations de l'outillage ont été nécessaires :

1. Le lancement initial de `pg_ctl` dans le sandbox Windows échouait avec une
   erreur de jeton restreint (code 87), avant tout test fonctionnel. Après nettoyage
   vérifié, le lanceur local a été exécuté hors sandbox avec autorisation d'exécution.
2. Le contrôle de destination du nouveau test attendait `127.0.0.1` uniquement ;
   PostgreSQL renvoie aussi la représentation exacte `127.0.0.1/32` pour `inet::text`.
   Les deux représentations loopback exactes sont maintenant admises, comme dans
   les helpers natifs existants. Aucune adresse externe n'est admise.

Les dossiers des essais interrompus sont conservés avec leurs journaux ; chaque
cluster a été arrêté et ses données supprimées. La qualification finale utilise
un cluster neuf. Son `shutdown.json` confirme : processus arrêté, port fermé,
répertoire de données supprimé et code de sortie des tests égal à zéro.

## Reproduction locale

Depuis la racine du dépôt, avec Node 24 et les binaires PostgreSQL existants :

```powershell
node backend/scripts/qualify-synthetic-otp-native.mjs --pg-bin output/pg-native-ef583905f4cd/portable/pgsql/bin
node --loader ./backend/tests/helpers/local-typescript-loader.mjs --test backend/tests/synthetic-otp-publication.offline.ts backend/scripts/synthetic-admin-launcher.test.mjs
node node_modules/typescript/bin/tsc --noEmit -p backend/tsconfig.tests.json
node node_modules/typescript/bin/tsc -p backend/tsconfig.json
```

Le premier lanceur crée son propre cluster et refuse un DSN arbitraire. Sous le
sandbox Windows, son démarrage peut nécessiter l'exécution hors sandbox décrite
ci-dessus. Ne pas lancer le fichier de cas natifs directement ; il exige le contexte
de propriété émis par le lanceur. Le loader de tests remplace uniquement le module
singleton DB par le client du cluster local vérifié pour le test de route ; le
service, les transactions SQL, les verrous et la vérification ADMIN restent réels.

## Fichiers et suite éventuelle

- [Lanceur natif ajouté](../backend/scripts/qualify-synthetic-otp-native.mjs).
- [Dix cas PostgreSQL natifs ajoutés](../backend/tests/synthetic-otp-publication.native.cases.ts).
- Ce rapport et les références documentaires de qualification actualisées.
- Les sorties compilées sous `backend/dist` sont régénérées par le build local.

La qualification locale native demandée est levée. Elle ne certifie pas Neon,
PgBouncer, Vercel ou les révisions distantes ; aucun de ces services n'a été testé.
Le [plan de déploiement](PUBLICATION-OTP-SYNTHETIQUE.md) reste soumis à autorisation
sur un candidat backend exact. Aucun push, déploiement, changement de secret ou
parcours OTP de production n'est autorisé par ce rapport. Budget : **0 DH**.
