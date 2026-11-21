# Preview isolé RECEIVE_DIAGNOSTIC — préparation locale

PASS pour la préparation locale ; déploiement et reproduction Vercel non effectués et non encore qualifiés. Aucun accès à Neon, modification Vercel, nouveau secret réel ou appel OTP distant pendant la préparation.

## Paquet à examiner

`output/receive-preview/package-jLjx2n` : base Git `46b1ddebe1cb1f53b22acb5d1cba6e49be7597a5`, avec uniquement les trois fichiers de diagnostic du candidat :

- `backend/src/routes/synthetic-staging.routes.ts`
- `backend/src/services/synthetic-otp-receive.service.ts`
- `backend/src/security/synthetic-receive-diagnostic.ts`

Le paquet est construit à partir des fichiers suivis du commit, pas d'une copie du workspace principal. Il comprend les 23 migrations existantes et un manifeste SHA256. Aucun `.git`, fichier `.env`, secret, journal, base, script d'exploitation ou test n'est repris dans la source publiée. Les dépendances et fichiers dist ajoutés pour la compilation locale sont exclus de l'upload par `.vercelignore`.

L'entrée `backend/index.mjs` de ce paquet ajoute une garde dédiée AVANT l'import de l'application et de Prisma. Elle refuse : environnement Production ; projet Vercel différent ; DSN hors des hôtes autorisés ; base ou rôle différents de `skillquest_receive_preview` ; connexion sans TLS ; dispatcher actif ; permission ou credentials de fournisseur réel ; secrets de dispatch/maintenance. Une copie de cette garde est `backend/scripts/receive-preview-guard.mjs` dans le workspace.

Ne pas publier le dossier candidat directement : il n'a pas cette garde. Ne pas connecter le nouveau projet à un dépôt Git ou à une intégration qui déploie automatiquement. Ne pas utiliser `--prod`, une promotion, un alias Production ou un domaine de D1.

## Résultats vérifiés

- Typecheck du candidat instrumenté : PASS.
- Compilation TypeScript du paquet Preview : PASS, avec dépendances locales existantes, sans téléchargement ni connexion DB.
- 24 tests de diagnostic/chemins 503 : PASS (11 tests d'instrumentation et 13 tests de branches), dont distinction timeout 57014, deadlock 40P01, connexion P1001, transaction P2028 et proof incorrecte, ainsi qu'absence de valeurs sensibles dans les logs.
- 9 tests de garde/transport Preview : PASS, dont refus de Production, autre projet/base, dispatcher, clé/permission réelle, origine Production et publication globale.
- Les outils de bootstrap et de test Preview passent `node --check`. Ils n'ont pas été exécutés contre une base ou un déploiement distant.

Le diagnostic émet uniquement `step`, `category`, `dbCode` et `correlationId`. Il ne journalise ni message brut d'exception, SQL, paramètres, secret, proof, payload ou OTP. Il permet d'identifier les causes munies d'un code SQL/Prisma et l'étape atteinte ; une catégorie générique ne garantit pas à elle seule une cause racine précise. Un crash avant l'application ou une interruption forcée par Vercel peut ne produire aucune ligne de diagnostic. Aucune hausse de timeout n'est incluse.

## Après autorisation : ressources et configuration

1. Créer un projet Vercel vide distinct nommé `skillquest-receive-preview`, sans import Git ni déploiement initial. Avec la CLI déjà installée/authentifiée : `vercel project add skillquest-receive-preview`. Noter son identifiant `prj_…`. Aucun réglage du projet D1 ne doit être modifié.
2. Créer un projet PostgreSQL distant neuf, vide, dans le quota gratuit. Pour Neon, utiliser un nouveau projet de diagnostic et une branche `preview-receive`, sans parent/copie depuis `skillquest-staging`. Créer un rôle distinct `skillquest_receive_preview`, propriétaire de la seule base `skillquest_receive_preview`. Ce rôle ne doit avoir aucun accès à l'ancienne base. Ne pas réutiliser les credentials Neon existants. Préférer la même version PostgreSQL, région et mode de pooling que D1 afin de réduire les différences de latence. Si le quota gratuit ne suffit pas, arrêter sans achat ni suppression.
3. Générer après autorisation un staging UUID et les secrets Preview distincts dans un coffre chiffré. Le secret staging doit représenter exactement 32 octets en base64url sans padding ; la clé proxy représente 32 autres octets en base64 canonique ; le pepper est une troisième valeur distincte d'au moins 32 caractères. Choisir un mot de passe ADMIN spécifique au Preview. Aucun secret de D1 n'est nécessaire.
4. Dans le NOUVEAU projet Vercel : Root Directory `backend`, Express, Node 24.x, inclusion des sources hors Root Directory activée pour `shared` et le workspace, build `npm run build:vercel`. Activer l'exposition des variables système Vercel nécessaires à la garde (`VERCEL`, `VERCEL_ENV`, `VERCEL_PROJECT_ID`). Aucun Cron, webhook de réveil, dispatcher ou worker externe.
5. Définir les variables ci-dessous exclusivement pour Preview. Aucune variable partagée d'équipe ne doit apporter de credentials métier/fournisseur.

Réglages publics fixes :

```text
NODE_ENV=production
SKILLQUEST_STAGING_MODE=synthetic-v1
SKILLQUEST_DEPLOYMENT_PURPOSE=synthetic-staging
SKILLQUEST_STAGING_ACK=SYNTHETIC_DATA_ONLY_NO_EXTERNAL_PROVIDERS
SKILLQUEST_DISPATCH_ENABLED=0
SKILLQUEST_ALLOW_REAL_BREVO=0
SKILLQUEST_ALLOW_REAL_GROQ=0
SKILLQUEST_ALLOW_REAL_QSTASH=0
SKILLQUEST_PROXY_MODE=required
REPORT_PDF_BROWSER_MODE=serverless
EMAIL_ACCOUNT_DAILY_LIMIT=65
EMAIL_OTHER_USAGE_MARGIN=60
EMAIL_APP_DAILY_LIMIT=5
QSTASH_APP_DAILY_LIMIT=0
```

Le budget positif de cinq captures simulées évite le refus par défaut de budget zéro ; ce n'est pas une autorisation d'appel Brevo. Les autres quotas OTP gardent leurs limites normales. Ne pas assouplir les limites temporelles de receive pour la reproduction initiale.

Métadonnées à renseigner :

```text
SKILLQUEST_PREVIEW_PROJECT_ID=<nouveau prj_…>
SKILLQUEST_STAGING_VERCEL_PROJECT_ID=<même nouveau prj_…>
SKILLQUEST_PREVIEW_DB_HOSTS=<hôte direct>,<hôte poolé si utilisé>
SKILLQUEST_STAGING_ID=<nouvel UUID distinct de D1>
CORS_ORIGIN=https://example.test
```

DSN et secrets, saisis dans les champs Secret du projet, jamais dans une commande :

```text
DATABASE_URL=<DSN de test, base et rôle skillquest_receive_preview, sslmode=require>
DIRECT_URL=<DSN DIRECT de cette même base de test, sslmode=require>
SKILLQUEST_STAGING_SECRET=<secret Preview du coffre>
JOIN_CODE_PEPPER=<pepper Preview du coffre>
SKILLQUEST_PROXY_HMAC_KEY=<clé proxy Preview du coffre>
```

Ne définir ni BREVO_API_KEY, GROQ_API_KEY, QSTASH_TOKEN, clés de signature QStash, secret de maintenance ou secret de dispatch. Le trousseau OTP dédié peut rester absent : le mécanisme existant utilise le pepper Preview distinct pour ce test.

6. Conserver la protection Vercel du nouveau projet. Créer sa clé **Protection Bypass for Automation**, disponible sur Hobby, et la conserver dans le coffre. L'outil ne l'envoie que comme header vers l'URL Preview exacte. Ce mécanisme officiel ne remplace ni ADMIN, ni HMAC staging, ni proxy signé, ni vérification OTP. Ne pas utiliser de secret dans une query string ou une URL.

## Initialiser uniquement la base de test

Installer/compiler le paquet local isolé, après accord pour les téléchargements nécessaires, en partant de la racine du workspace :

```powershell
npm ci --prefix .\output\receive-preview\package-jLjx2n
npm run db:generate --prefix .\output\receive-preview\package-jLjx2n
npm run build --prefix .\output\receive-preview\package-jLjx2n
```

Ces trois commandes ne doivent pas recevoir de secret de production. Ne pas lancer le seed. La génération et compilation n'appliquent aucune migration.

Puis utiliser le bootstrap explicite préparé, avec les MÉTADONNÉES publiques réelles à la place des marqueurs :

```powershell
node .\backend\scripts\receive-preview-bootstrap.mjs .\output\receive-preview\package-jLjx2n '<prj_preview>' '<uuid_staging_preview>' '<hote_direct>,<hote_poole>' --authorized-preview-database-writes
```

Il demande le DSN DIRECT, le pepper Preview, le secret staging Preview et le mot de passe ADMIN via saisies masquées. Il vérifie l'hôte autorisé, le nom de base, le rôle réellement connecté et l'absence totale de tables avant d'appliquer les 23 migrations et d'appeler `bootstrapSyntheticStaging` pour créer uniquement le marqueur et admin@example.test. Aucun participant ou OTP n'est créé par ce bootstrap. Aucun reset, suppression ou reprise destructive en cas d'échec. La garde logique ne remplace pas la création d'un rôle réellement séparé et la vérification du nouveau projet PostgreSQL dans sa console.

## Déploiement Preview uniquement

Toujours depuis la racine du workspace, lier SEULEMENT le paquet au nouveau projet :

```powershell
vercel link --project skillquest-receive-preview --cwd .\output\receive-preview\package-jLjx2n
```

Vérifier le `projectId` du `.vercel/project.json` nouvellement créé : il doit être le nouveau prj, jamais celui de D1. Puis, uniquement après autorisation de déploiement :

```powershell
vercel deploy --environment=preview --cwd .\output\receive-preview\package-jLjx2n
```

Utiliser une CLI prenant en charge `--environment=preview`, avec une session déjà authentifiée. Ne pas employer `--temporary` : ce mode cible Production. Vérifier Environment Preview, Ready, nouveau projet, puis health authentifié par la protection Vercel. L'application refuse de démarrer en environnement Production avant toute connexion Prisma. Ne pas créer de domaine/alias sur le projet D1.

## Test le plus court : une seule création puis publish-otp et receive ciblés

L'outil suivant reste local et n'est pas inclus dans les routes déployées. À lancer uniquement après accord explicite pour le test OTP Preview :

```powershell
node .\backend\scripts\receive-preview-probe.mjs 'https://<URL-IMMUTABLE-PREVIEW>.vercel.app' '<uuid_staging_preview>' --authorized-preview-otp
```

Il demande les quatre credentials Preview avant toute création, s'authentifie normalement comme ADMIN, vérifie status, puis appelle une seule fois le `/adaptive/start` normal pour `SYNTH-Participant`, `receive-diagnostic@example.test`, sans demande d'e-mail de rapport. Le proxy HMAC signé par la clé Preview représente le client synthétique local : aucun proxy de Production ni modification de trust proxy. Il imprime seulement le nouveau challenge UUID.

Pendant sa pause, exécuter dans la NOUVELLE base ce SELECT, en remplaçant seulement le challenge UUID public :

```sql
BEGIN READ ONLY;
SELECT j.id AS job_id, p.id AS notification_id
FROM "ParticipantEmailDeliveryJob" j
JOIN "JobPublicationIntent" p ON p."jobId"=j.id
WHERE j."challengeId"='<NOUVEAU_CHALLENGE_UUID>'::uuid
  AND p.kind='OTP_INITIAL' AND p.phase='DELIVER' AND p.state='PENDING';
ROLLBACK;
```

Fournir les deux UUID à l'outil. Il publie cette seule cible, appelle receive une seule fois avec la liaison complète, puis ferme sa session ADMIN. Aucun retry, publication globale ou accès mail. Si receive échoue, lire la ligne `[RECEIVE_DIAGNOSTIC]` corrélée au Request ID dans les Function Logs du NOUVEAU projet. Garder seulement step/category/dbCode/correlationId. Si la cible a expiré pendant la pause, ne pas réarmer ni relancer automatiquement.

Après le test, suspendre les clients. Aucun nettoyage n'est automatique : garder les données et preuves. Une correction métier ne sera préparée qu'après identification de la cause ; aucun correctif de production n'est implicitement autorisé.

## Limites de la conclusion

Un succès sur base vide Preview ne prouve pas la résolution de l'ancien incident. Les données anciennes, la latence, le pool, la région, le chemin direct/poolé et l'état du fournisseur peuvent différer. Si l'erreur ne réapparaît pas, comparer uniquement les métadonnées et configurations non secrètes avant de conclure. Une base localhost ne convient pas à ce Preview : Vercel ne peut pas joindre le PostgreSQL de votre PC via 127.0.0.1. Aucun tunnel public n'est préparé.

Sources officielles vérifiées : [CLI Preview](https://vercel.com/docs/cli/deploy), [Protection Bypass for Automation](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation), [monorepo et sources hors racine](https://vercel.com/docs/monorepos/monorepo-faq).
