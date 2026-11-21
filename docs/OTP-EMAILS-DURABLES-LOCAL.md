# OTP et e-mails durables — préparation locale

État au 8 novembre 2026 : implémentation et qualification locales uniquement.
Aucun fournisseur activé, aucune modification Neon/Vercel, aucun déploiement.
La présence d'une clé n'autorise jamais un appel réel.

## Autorisations indépendantes

Les transports vérifient exactement `SKILLQUEST_ALLOW_REAL_BREVO=1`,
`SKILLQUEST_ALLOW_REAL_QSTASH=1` ou `SKILLQUEST_ALLOW_REAL_GROQ=1` selon le fournisseur.
Absence, `0`, `true`, faute de frappe : refus. Ces variables ne sont créées dans
aucun fichier d'environnement. Chaque appel réseau revérifie l'autorisation ;
les redirections sont refusées. L'autorisation d'un fournisseur n'ouvre pas les autres.

`synthetic-v1` conserve ses contrôles d'installation, de projet, de base et
d'identités `SYNTH-` / `example.test`. Il reste prioritaire même si les trois
autorisations valent `1`. La présence de secrets fournisseurs dans ce mode
reste une erreur bloquante. Les réponses IA, e-mails et notifications sont simulés.

## Parcours durable

1. Challenge/job et intention de publication sont validés dans PostgreSQL.
2. Les routes attendent une tentative de réveil après le commit. Un échec ne
   détruit pas les données validées. Le frontend laisse 20 secondes au démarrage.
3. Le dispatch publie les UUID/phases, jamais l'adresse, le code, le jeton ou le PDF.
4. Le callback authentifie les octets bruts et l'URL, vérifie l'intention persistée
   puis traite un job précis. Il peut publier la phase suivante après traitement.
5. Un ordonnanceur indépendant devra appeler le dispatch pour récupérer les
   commits suivis d'un crash, échéances différées, notifications perdues et baux expirés.

L'ordonnanceur n'est PAS installé par cette phase. Sans ses appels futurs, les
intentions sont conservées mais un réveil autonome n'est pas garanti. Les minuteurs
du serveur local restent accessoires et ne sont pas chargés par l'entrée Vercel.

Le point fixe `GET`/`POST /api/internal/jobs/dispatch` refuse par défaut toute
exécution. Une future activation exige `SKILLQUEST_DISPATCH_ENABLED=1` et un
`SKILLQUEST_DISPATCH_SECRET` distinct (32 octets, base64url canonique).
Authentification par un seul `Authorization: Bearer ...`, aucun corps ni paramètre.
Ce secret ne remplace ni les clés de signature QStash, ni les secrets de maintenance.
Un appel répété ne réexécute pas un envoi : admission partagée et idempotence des jobs.

Le bail d'admission dure 30 secondes, avec 10 secondes entre admissions.
Après admission, travail borné à huit secondes, six publications maximum et lots
de rapprochement de douze éléments. Admission et libération ont des budgets séparés
de deux et 1,5 seconde. Les transactions utilisent des délais SQL et de verrouillage.
Le curseur PostgreSQL donne deux places aux OTP puis une aux rapports ; une catégorie
vide prête sa place. Cette priorité porte sur la publication, sans préemption d'un
envoi déjà commencé ni garantie sur l'ordre d'exécution externe.

## Bornes et incertitude

- OTP : dix minutes, cinq essais de validation, six tentatives de traitement,
  renouvellement après 60 secondes selon l'état. Les compteurs cumulés restent partagés.
- Synthèse : trois tentatives ; dernier crash récupéré vers `UNAVAILABLE` par dispatch.
- Rapport e-mail : six tentatives, préparation/contention/crash inclus.
- Rapport : ancienneté maximale de traitement de 24 heures depuis création du job,
  dans la limite de validité du parcours.
- Publication : au maximum 24 tentatives cumulées par job/phase, tous UUID de
  notification confondus. Reprise exponentielle plafonnée à 300 secondes.
  Une phase ayant épuisé ce plafond n'est pas republiée automatiquement ; ses preuves
  restent consultables et sa durée de vie demeure bornée.
- Une publication confirmée sans progression après deux minutes peut être réarmée
  avec un nouvel UUID de notification, en conservant l'UUID de l'e-mail.

Le budget est réservé avant contact fournisseur. Un OTP à livraison incertaine
reste `UNCERTAIN`, sans renvoi automatique. Un rapport incertain ne peut reprendre
avec le même UUID que dans la fenêtre locale de dix minutes ; ensuite `UNKNOWN`.
Une acceptation persistée est rapprochée sans second envoi. Ces états ne prouvent
pas la réception en boîte : `SENT` signifie acceptation du transport.

Le choix `reportEmailRequested`, l'adresse, la version du contenu et les baux sont
revérifiés dans la transaction de réservation après préparation du PDF.
`POST /api/v1/adaptive/me/report-email/withdraw` retire ce choix avec le jeton
participant ; le proxy Next.js correspondant utilise le cookie privé et la preuve
réseau habituelle. Le retrait est idempotent. Une révocation avant réservation
empêche le contact fournisseur. Après cette frontière, un message déjà accepté
ou en cours de transmission ne peut pas être rappelé. Aucun historique versionné
des consentements n'est ajouté par cette migration.

## Adaptateur réel préparé, non activé

QStash exige en plus le mode explicite `SKILLQUEST_QSTASH_MODE=real`, ses secrets
propres, une URL HTTPS exacte du callback et une allocation
`QSTASH_APP_DAILY_LIMIT` déclarée (zéro par défaut, maximum local 1 000).
Chaque publication réserve quatre unités PostgreSQL : première livraison et trois
reprises QStash possibles. Pas de remboursement automatique en cas d'incertitude.
Les appels de l'ordonnanceur et autres consommateurs doivent être déduits de
l'allocation avant configuration. Ce compteur n'est pas une mesure des livraisons
effectives du fournisseur, notamment lorsqu'elles traversent minuit.

Brevo garde le budget partagé existant, nul sans allocation de compte déclarée.
Les rapports peuvent attendre lorsque le budget global est épuisé ; la priorité
OTP n'invente pas de crédits. Groq demeure indépendant et facultatif : un rapport
de secours peut être produit sans synthèse IA.

`backend/vercel.json` prépare une durée maximale de 90 secondes pour le handler.
Vérifier impérativement sa compatibilité avec le plan et Fluid Compute avant
tout déploiement : cette qualification Windows ne valide pas le runtime Vercel.

## Migration candidate

`20261107000100_durable_dispatch` ajoute `JobDispatchState`, `JobDispatchUsage`,
`JobLifetime` et renforce la vue `JobPublicationReady`. Aucun secret ni contenu
d'e-mail n'y est stocké. Les données existantes et reçus d'idempotence sont conservés.
Les modèles Prisma des deux nouvelles tables figurent dans le schéma ; le runtime
utilise du SQL brut, sans dépendre d'un nouveau client généré.

Migration appliquée uniquement par le lanceur aux clusters locaux neufs, vérifiés
avant migration par répertoire, port loopback et identifiant système PostgreSQL.
Elle n'est pas appliquée à Neon. Aucun script de démarrage ou build ne l'applique.
La migration antérieure `20261105000100_report_fallback_email` est déjà appliquée
à Neon selon la confirmation utilisateur ; elle n'a pas été revérifiée à distance ici.

## Qualification reproductible hors réseau

Avec les binaires PostgreSQL déjà présents :

```powershell
node backend/scripts/qualify-durable.mjs --pg-bin output/pg-native-ef583905f4cd/portable/pgsql/bin
node backend/scripts/qualify-local-checks.mjs
```

Le premier lanceur n'accepte aucune URL de base, crée un cluster vierge avec un
port aléatoire hors 5432, inventorie les migrations et nettoie le schéma entre
suites. Il arrête uniquement son propre cluster. Les données locales sont conservées
pour inspection, sans serveur restant actif. Il peut recevoir une liste explicite
de fichiers `backend/tests/*.test.ts` ou `*.cases.ts`.

Les enfants reçoivent un environnement système sur liste blanche, sans `.env` ni
secret hérité. Le préchargement bloque fetch, TCP, TLS, DNS et UDP externes ;
les appels de contrat HTTP sont remplacés par des réponses en mémoire.
Chromium rend une page hors connexion, sans JavaScript, avec ressources intégrées
et requêtes de page interdites. Ces protections de test ne constituent pas un
pare-feu système applicable à tous les sous-processus.

Preuves produites : résultats des suites, identités PostgreSQL, inventaire SHA-256
des migrations, arrêt du cluster, PID de publication/réception, crash avant/après
réservation, nouveaux UUID après notification perdue et hashes PDF FR/AR.

## Conditions avant toute activation distante

- Autorisation utilisateur distincte ; aucun changement distant inclus ici.
- Vérifier offres, éligibilité, quotas, consommation partagée et absence de
  bascule payante dans les tableaux de bord Vercel/Neon/QStash/Brevo.
- Choisir et installer un ordonnanceur indépendant authentifié, avec cadence,
  plages et réserve de quota documentées ; ne pas supposer le Cron Hobby suffisant.
- Calculer CPU, mémoire PDF, veille Neon et reprises. Ne pas maintenir une base
  éveillée 24h/24 par simple balayage fréquent sans vérifier son allocation.
- Qualifier le callback, la rotation des signatures et les PDF sur Linux/Vercel
  avec transport simulé avant de prévoir un essai d'envoi réel autorisé séparément.
- Vérifier l'expéditeur/domaine Brevo et la politique de conservation/consentement.
- Superviser les retards, plafonds atteints et états incertains ; aucune remise à
  zéro automatique d'UUID ni nouvelle tentative manuelle aveugle.

Avec 0 DH, dépasser une allocation doit suspendre le traitement. Aucune offre
payante, relance facturable supplémentaire ou activation fournisseur n'est automatique.
