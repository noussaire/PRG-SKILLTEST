# Déploiement et exploitation

> Réception OTP synthétique renforcée, préparation locale uniquement :
> [contrôles, 45 tests PASS et compatibilité du candidat](RECEIVE-OTP-SECURITE.md).
> Aucun push, déploiement ou parcours OTP de production n'est autorisé par ce rapport.

> OTP/e-mails durables : voir [préparation locale et conditions d'activation](OTP-EMAILS-DURABLES-LOCAL.md).
> Les adaptations décrites ci-dessous sont historiques ; la nouvelle phase prépare
> un dispatch PostgreSQL et des autorisations fournisseurs indépendantes, tous désactivés par défaut.

> Synthèses, phase 1 locale : voir [corrections et validation](SUMMARY-PHASE1.md).
> Cette phase n'autorise aucune publication ni activation de fournisseur externe.

> E-mails de secours : [implémentation et validation locales](FALLBACK-EMAILS-LOCAL.md).
> La migration `20261105000100_report_fallback_email` est appliquée à Neon selon
> confirmation utilisateur ; aucune nouvelle vérification distante n'a été faite ici.
> Aucun envoi réel n'est activé par la phase OTP/e-mails durables.

> LOT 5 : consulter `LOT5_PROXY_TRUST.md` avant toute ouverture. Le réseau devant
> Next.js reste à choisir. Express conserve désormais `trust proxy=false` ;
> `TRUST_PROXY` n'active plus la confiance dans les en-têtes. Les API adaptatives
> exigent une preuve interne en production et les opérations OTP refusent une
> identité réseau non vérifiée. Le mode local explicite est réservé au loopback.
> Appliquer d'abord la migration additive des nonces dans l'environnement autorisé.

Cette archive ne déploie rien. Tester d'abord une copie de la base et lire `MISE_A_JOUR.md`.

## Backend

- PDF, sous-étape 5C : voir [PDF_LINUX_STEP5C.md](PDF_LINUX_STEP5C.md). Le candidat Chromium Linux reste réservé à une activation explicite après qualification ; les tests Windows et le packaging ne valident pas son runtime réel. Les réserves PostgreSQL 5B restent ouvertes.
- Qualification PostgreSQL/PgBouncer locale, sous-étape 5B : voir [POSTGRES_POOLING_STEP5B.md](POSTGRES_POOLING_STEP5B.md). Profil candidat 2 connexions par instance ; les délais d'un client froid et la compatibilité Neon réelle restent à qualifier avant activation.
- Build et moteur Prisma, sous-étape 5A : voir [VERCEL_BUILD_STEP5A.md](VERCEL_BUILD_STEP5A.md). Node 24.x, Prisma 6.19.3 et cible Linux explicite ; une preuve Windows ne constitue pas une qualification Linux ou Vercel.
- Qualification locale des pannes, sous-étape 3C : voir [JOBS_STEP3C.md](JOBS_STEP3C.md). Elle inclut les contrôles avant réservation et le réarmement borné des publications sans progression ; aucun fournisseur ou réveil automatique n'est activé.
- Intentions transactionnelles, sous-étape 3B : voir [JOBS_STEP3B.md](JOBS_STEP3B.md). La migration est additive ; publication et rattrapage restent des appels internes explicites avec transport abstrait, sans fournisseur ni planificateur connecté.
- Jobs explicites, sous-étape 3A locale : voir [JOBS_STEP3A.md](JOBS_STEP3A.md). Aucun réveil durable ni fournisseur de file n'est intégré par cette interface interne.
- Adaptation Vercel, étape 1 uniquement : voir [VERCEL_BACKEND_STEP1.md](VERCEL_BACKEND_STEP1.md). Le handler HTTP et le démarrage local sont séparés ; l'exécution durable des jobs serverless reste à préparer.
- Installer avec `npm ci` depuis la racine du workspace.
- Fournir `DATABASE_URL`, `DIRECT_URL`, `JOIN_CODE_PEPPER`, `CORS_ORIGIN` et `NODE_ENV=production` au backend uniquement.
- Exécuter `npm run db:generate`, appliquer les migrations vérifiées avec `npm run db:deploy`, puis `npm run build -w backend`.
- Démarrer avec `npm start -w backend`.
- Sonde : `/api/v1/health`. Elle interroge réellement PostgreSQL et répond 503 si la connexion échoue.
- Conserver une instance persistante pour le minuteur des sessions. Les dates sont également contrôlées par requête.

## Frontend

- Projet Next.js, dossier `frontend`, avec prise en charge des workspaces par l'hébergeur.
- Configurer `API_INTERNAL_URL` vers le backend et `PUBLIC_APP_ORIGIN` vers l'origine HTTPS exacte du site.
- Build : `npm run build -w frontend`. Démarrage Node : `npm start -w frontend`.
- Les cookies sont `secure` en production. Utiliser HTTPS sur le déploiement réel.
- Configurer CORS avec des origines explicites. Le joker `*` est refusé.

## Proxies et limites de débit

L'adaptateur Vercel de l'étape 2 est préparé mais non activé : lire [VERCEL_NETWORK_STEP2.md](VERCEL_NETWORK_STEP2.md), notamment les conditions d'ingress direct et les vérifications obligatoires en staging. Les variables locales et secrets existants ne sont pas modifiés.

`trust proxy=false` est imposé dans Express. La future passerelle doit vérifier
la provenance réseau selon son infrastructure avant de signer l'attestation ;
aucun en-tête `X-Forwarded-For` ou `X-Real-IP` n'est accepté comme preuve par
l'application. Les paramètres et le protocole sont décrits dans `LOT5_PROXY_TRUST.md`.

La limite de connexion est calculée par adresse e-mail normalisée ; celle des décisions par jeton et celle des inscriptions par couple code/nom. Une limite globale plus large par adresse IP protège l'instance. Les classes utilisant un serveur Next.js commun ne partagent donc pas une petite limite de 300 décisions pour toute la classe.

Les quotas OTP/e-mail et le budget fournisseur utilisent PostgreSQL partagé.
Les limiteurs HTTP d'appoint restent locaux au processus ; leur coordination
multi-instance et les protections de volumétrie de l'ingress restent à qualifier.

## Secrets et comptes

Aucun identifiant administrateur n'est fourni par défaut. Le seed est réservé aux bases de développement. Pour renouveler le mot de passe d'un administrateur existant, utiliser `npm run admin:password -w backend -- adresse@example.com` depuis un terminal interactif configuré pour la bonne base.

Pour invalider les jetons expirés dans les données, `npm run sessions:cleanup -w backend` peut être exécuté périodiquement ; le refus des accès expirés est déjà assuré même sans ce nettoyage. La révocation d'un participant est disponible dans l'API administrateur.

## Sauvegardes et données

Définir une politique de conservation avant les évaluations réelles. L'expiration d'un accès ne supprime pas les données. Sauvegarder PostgreSQL avant une migration et vérifier la restauration sur une base séparée. Aucune commande de restauration n'est exécutée automatiquement.

Le déclencheur d'immutabilité protège les versions publiées. Une suppression administrative globale nécessiterait une procédure de maintenance dédiée, respectant les obligations de conservation ou de suppression de l'organisateur.

## Validation avant ouverture

La rétention technique 4C s'applique uniquement par appel explicite de maintenance : intentions annulées jamais tentées et orphelines après observation, et réduction des anciennes métadonnées de maintenance avec conservation permanente de l'UUID anti-rejeu. Lire [MAINTENANCE_STEP4C.md](MAINTENANCE_STEP4C.md) ; aucune durée de suppression n'est supposée pour les notifications publiées/tentées ou les preuves incertaines.

Les endpoints fixes de maintenance 4B sont désactivés par défaut. Leur activation exige un secret backend dédié et un UUID d'invocation inédit ; les baux et reçus PostgreSQL sont décrits dans [MAINTENANCE_STEP4B.md](MAINTENANCE_STEP4B.md). Aucun Cron ni déclencheur externe n'est installé.

La maintenance de l'étape 4A est disponible uniquement par appel interne explicite et borné, sans endpoint ni Cron. Voir [MAINTENANCE_STEP4A.md](MAINTENANCE_STEP4A.md) pour ses limites, les rapprochements sans envoi et la préparation de 4B.

La préparation QStash reste entièrement simulée et désactivée sur Vercel. Voir [QSTASH_STEP3D.md](QSTASH_STEP3D.md) pour le callback authentifié, les variables futures, le rattrapage et les vérifications de staging indispensables. Aucun transport réel ni déclenchement durable serverless n'est connecté.

Exécuter `npm run typecheck`, `npm test`, `npm run build` et `npm run test:browser`, puis un essai de charge sur PostgreSQL natif avec la configuration du déploiement. Vérifier la confidentialité du site selon l'hébergeur choisi. Cette version n'a pas été publiée automatiquement.
