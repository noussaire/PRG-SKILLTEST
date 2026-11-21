# Backend Vercel — étape 1, qualification locale uniquement

L'adaptateur réseau optionnel de l'étape 2 est désormais préparé : voir [VERCEL_NETWORK_STEP2.md](VERCEL_NETWORK_STEP2.md). Sa provenance réelle doit encore être qualifiée en staging ; les autres limites de cette étape 1 restent applicables.

## Points d'entrée

- `backend/index.mjs` exporte l'application Express compilée et vérifie la configuration du proxy. Il n'importe jamais `src/server.ts` ou `dist/server.js`.
- `backend/src/app.ts` conserve les routes, middlewares et contrôles existants.
- `backend/src/server.ts` reste identique : `npm run dev -w backend` et `npm start -w backend` démarrent le serveur local et ses six minuteurs, puis les arrêtent lors de la fermeture.
- Le handler HTTP ne démarre aucun worker, planificateur, serveur ou connexion PostgreSQL à son import. Les connexions sont ouvertes à la demande des requêtes.

Les limiteurs HTTP utilisaient le MemoryStore d'express-rate-limit, qui crée un intervalle dès l'initialisation. `http-rate-limit.ts` fournit désormais un stockage en mémoire sans minuteur : mêmes clés et seuils des routes, fenêtres par clé, expiration à la demande et collecte opportuniste bornée. Les protections encore actives ne sont pas évincées. Une instance inactive peut conserver des entrées expirées jusqu'aux prochaines requêtes ; les compteurs PostgreSQL OTP et budget restent inchangés et partagés. Les limiteurs HTTP locaux ne sont toujours pas distribués entre instances.

## Préparation du paquet

Le futur projet backend aura `backend` comme Root Directory, avec accès aux fichiers du workspace hors de cette racine (`shared` et dépendances npm hoistées). Installer les workspaces depuis la racine avec le lockfile existant. La configuration `backend/vercel.json` sélectionne Express et `npm run build:vercel` : génération Prisma, puis compilation TypeScript. Cette commande ne lance ni migration ni seed. Le moteur Prisma devra être généré sur Linux dans le build Vercel, et non copié depuis Windows.

`includeFiles` ajoute explicitement les ressources `assets`, `shared` et le moteur/schéma du client Prisma hoisté. Le traçage local contrôle les dépendances HTTP compilées et l'absence du point d'entrée local. Le graphe du moteur PDF est contrôlé séparément, car il appartient au worker de rapports, absent du graphe HTTP.

Les logos, police arabe et licence sont conservés. Les tests PDF Windows utilisent le navigateur local ; ils ne qualifient pas Chromium Linux. Le traçage PDF signale des dépendances optionnelles Playwright non résolues (BidiMapper, CdpConnection, electron, fsevents, utf-8-validate, kerberos, bufferutil). Aucun navigateur ni nouveau paquet n'a été installé. Le paquet exact du builder Vercel, ses chemins monorepo et le moteur natif Linux restent à valider avant staging. Aucune CLI Vercel, liaison de projet ou publication n'a été exécutée.

## Jobs persistants : limite volontaire de cette étape

Les requêtes continuent à créer les jobs PostgreSQL. Un job OTP reste PENDING sans réserver de budget ni envoyer d'e-mail tant qu'un consommateur ne s'exécute pas. Les tests invoquent ce consommateur explicitement ; ce n'est pas un mécanisme de réveil serverless.

Cette étape ne garantit ni livraison OTP, ni génération/envoi des rapports, ni purge périodique sur Vercel. Ne pas ouvrir ce backend à des utilisateurs réels avec le seul handler HTTP. Aucune nouvelle file durable ni Cron n'est intégré.

## Adaptations suivantes, soumises à autorisation

1. Choisir un mécanisme durable de réveil/reprise des jobs et de maintenance, avec latence OTP mesurée, concurrence, gestion des envois incertains et absence de double envoi.
2. Finaliser l'adaptateur d'identité réseau Vercel devant Next.js, avec provenance documentée et preuves interprojets du LOT 5. Sans identité vérifiable, les opérations OTP restent fermées. Ne pas activer `trust proxy`.
3. Qualifier PostgreSQL externe, pooling, limites de connexions, transactions et déploiement coordonné des versions de clés. Ne pas retirer une ancienne clé encore référencée par un job.
4. Qualifier le moteur PDF Linux, les tailles, la mémoire et les délais ; le plafond applicatif actuel de 12 MiB ne prouve pas l'acceptation d'un transfert par Vercel.
5. Préparer un staging isolé, clés et base synthétiques dédiées, Brevo simulé, puis exécuter l'ensemble des tests des cinq lots et les tests de panne/charge.

Les paramètres de production ne sont ni lus ni modifiés par cette qualification. Les exigences existantes de secrets, cookies, CORS et preuves internes restent applicables.

Références : [Express sur Vercel](https://vercel.com/docs/frameworks/backend/express), [configuration des fonctions](https://vercel.com/docs/project-configuration/vercel-json), [monorepos](https://vercel.com/docs/monorepos).
