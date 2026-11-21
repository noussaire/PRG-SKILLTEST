# Étape 5B — qualification PostgreSQL / PgBouncer / Prisma

## État et limites de portée

Qualification locale Windows avec Node 24.x, Prisma 6.19.3 et **vrai PgBouncer
1.26.1** en mode transaction. La préparation Linux de 5A reste une préparation,
pas une preuve de runtime Linux. Aucun accès Neon, fournisseur d'e-mails, IA ou
file externe, aucun déploiement et aucun travail Chromium/5C.

Les services applicatifs restent inchangés : singleton `PrismaClient` à portée
du module, connexions ouvertes à la demande, pas de déconnexion à chaque requête.
Les paramètres Prisma 6 sont ceux de `DATABASE_URL`. Sans configuration
explicite, sa taille de pool dépend des CPU ; elle n'est pas un budget global
multi-instance. Frontend Next.js et backend Express sont deux projets ; seule
l'application backend doit recevoir les identifiants PostgreSQL.

`DATABASE_URL` reste la destination applicative poolée. `DIRECT_URL` reste la
destination directe pour les opérations administratives autorisées. Les tests
vérifient également qu'un nouveau client runtime utilise `DATABASE_URL` alors
que `DIRECT_URL` désigne un port synthétique inaccessible. Ne pas exécuter de
migration depuis une invocation HTTP ou un consumer.

## Exécution locale reproductible, sans Docker ni service Windows

Fournir des exécutables PostgreSQL natifs et PgBouncer **1.26.1** existants :

```powershell
npm run qualify:pooling -w backend -- --pg-bin CHEMIN_BIN_POSTGRES --pgbouncer CHEMIN_PGBOUNCER_EXE
```

Les chemins sont des arguments du lanceur local, jamais des paramètres d'un
endpoint. Le lanceur crée son dossier sous `output/lot4-pooling-step5b/native-*`,
un nouveau PostgreSQL sans données, des ports aléatoires non standard et des
écoutes limitées à `127.0.0.1`. Il vérifie répertoire, identité du système,
utilisateur, port et schéma vide avant d'appliquer les migrations historiques
au seul cluster temporaire. Les fichiers historiques ne sont pas modifiés.

L'archive Windows officielle est disponible dans les releases du dépôt
`pgbouncer/pgbouncer`. La copie utilisée est vérifiée par le digest SHA-256
publié par GitHub :

`5d3fa0bc9bd40f8845655f50a9bafd315db9e9ac51ee1a511393e9f60828b57b`.

Aucun installateur ni service système n'est utilisé. Version observée :
PgBouncer 1.26.1, libevent 2.1.13-stable, OpenSSL 3.6.5. Les fichiers de version,
configuration effective, logs, mesures et preuves d'arrêt sont conservés.

`auth_type=trust` et TLS désactivé sont **réservés à ce cluster jetable loopback**.
Ils ne constituent pas une configuration de staging ou de production. Les
privilèges permettant `pg_control_system` et les injections `pg_terminate_backend`
sont propres au laboratoire ; ne pas les accorder au rôle applicatif Neon.

## Configuration comparée

Un PgBouncer réel expose des alias distincts vers la même base synthétique,
avec pools physiques de 1, 2 et 4 connexions, `reserve_pool_size=0`,
`pool_mode=transaction`, `max_prepared_statements=1000`, et un timeout d'attente
de trois secondes pour les cas ordinaires. Un alias attend jusqu'à 120 secondes
pour reproduire la politique documentée de Neon ; un autre limite les clients
à deux pour tester la saturation des connexions entrantes.

Neuf combinaisons comparent les tailles Prisma 1/2/4 aux tailles serveur 1/2/4.
Chaque combinaison exécute trois lots de douze transactions interactives,
chacune contenant une attente SQL de 30 ms : **324 transactions mesurées** au
dernier passage. Les p50/p95, durées et PID physiques sont enregistrés. Le
nombre de PID distincts au fil des transactions ne doit pas être confondu avec
le maximum de connexions Prisma simultanées.

Ces mesures Windows constituent une comparaison locale, pas un test de
capacité Neon. Elles ne modélisent ni latence régionale, démarrage du compute,
TLS, charge étudiante réelle ou concurrence de plusieurs déploiements.

## Profil conservateur candidat pour le staging

Après comparaison, retenir comme **point de départ de qualification** :

- `connection_limit=2` par client/instance backend ;
- `pool_timeout=2` secondes pour l'attente dans le pool Prisma ;
- `connect_timeout=5` secondes pour la connexion.

Deux connexions permettent du parallélisme sans multiplier autant les sockets
clientes qu'un pool de quatre. Avec un seul backend physique disponible,
augmenter le pool Prisma n'augmente pas le débit. La réservation Brevo conserve
en outre son verrou global volontaire : davantage de connexions ne suppriment
pas cette sérialisation.

Exemples de structure, sans véritables identifiants :

```text
DATABASE_URL=postgresql://USER:PASSWORD@HOST_POOL/DB?sslmode=require&sslaccept=strict&connection_limit=2&pool_timeout=2&connect_timeout=5
DIRECT_URL=postgresql://ADMIN:PASSWORD@HOST_DIRECT/DB?sslmode=require&sslaccept=strict
```

Reprendre les hôtes, certificats et paramètres réellement fournis par Neon,
puis vérifier TLS avec le moteur retenu. Ne pas recopier ces chaînes fictives.
Aucune URL ni valeur de secret existante n'est modifiée par 5B. Aucun profil
n'est activé automatiquement ; localhost conserve son comportement actuel.

Ne pas ajouter aveuglément `pgbouncer=true` : la qualification utilise les
prepared statements protocolaires d'un pooler récent, avec capacité non nulle.
Les anciennes versions nécessitent une qualification différente. Ne pas
remplacer les transactions interactives par une API Neon HTTP non interactive.

## Sémantique et pannes réellement testées

- transaction interactive conservant son backend physique jusqu'au commit ;
- SAVEPOINT puis erreur SQL, ROLLBACK TO SAVEPOINT et commit des seules
  mutations valides ;
- SET LOCAL sans fuite après commit ou rollback, même entre deux clients
  réutilisant le même backend ;
- deux transactions réellement simultanées, PID distincts et claims disjoints
  avec FOR UPDATE SKIP LOCKED ;
- timeouts SQL, de verrou, de pool Prisma, maxWait et expiration de transaction ;
- file d'attente PgBouncer et plafond de connexions clientes ;
- coupure d'un backend PostgreSQL avec rollback, puis nouvelle connexion ;
- arrêt brutal du processus PgBouncer possédé par le lanceur, redémarrage réel
  et reprise sans renvoi de l'OTP UNCERTAIN déjà enregistré ;
- concurrence OTP initial/reprise après 30 jours, dernier crédit Brevo,
  publications, maintenance, PDF FR/AR et e-mails de rapports ;
- atomicité de la création du rapport et de son intention ;
- notification publiée plusieurs fois après réponse perdue avec UUID stable.

Tous les appels e-mail/IA sont interceptés ; la publication est un transport
injecté simulé. Publication, réception, job terminé, acceptation Brevo et
réception finale par le destinataire restent des faits différents.

## Réserve importante : les délais ne couvrent pas tous la même phase

`pool_timeout` borne le pool **Prisma**, pas la file d'attente **PgBouncer**.
Une configuration Neon à `query_wait_timeout=120` ne devient pas une attente de
deux secondes parce que Prisma possède `pool_timeout=2`.

Le test chaud avec `socket_timeout=1` borne une requête déjà initialisée vers
l'alias attendant 120 secondes. Le premier accès d'un client froid présente un
comportement différent, mesuré séparément. Il est interdit de déduire une borne
globale de ces seuls paramètres. Le rapport conserve la durée observée et les
horizons de contrôle ; il ne prétend pas avoir laissé expirer les 120 secondes.

Un test supplémentaire laisse expirer un délai d'appelant de 200 ms pendant
qu'un INSERT froid attend derrière une transaction. Après libération, l'INSERT
commit effectivement. **L'expiration d'un fetch, un Promise.race ou une réponse
HTTP d'erreur ne prouvent pas l'annulation d'une écriture PostgreSQL.** Ne pas
ajouter de retry générique des écritures ou renvoi d'e-mails sur ce seul signal.

Les réservations persistantes, UUID, reçus, baux et fencing existants restent
indispensables. Un résultat fournisseur incertain reste incertain ; une nouvelle
invocation doit consulter PostgreSQL avant toute action et ne doit jamais
renvoyer automatiquement un OTP UNCERTAIN.

Le proxy adaptatif utilise généralement un délai de dix secondes ; les budgets
transactionnels existants vont de quelques centaines de millisecondes à
cinq secondes, avec certains parcours administratifs jusqu'à vingt secondes.
La limite maximale d'une Function n'est donc pas le seul délai pertinent.
Budgeter connexion, attente, SQL, préparation et finalisation par parcours.
Un `socket_timeout` global ne doit pas être imposé sans qualifier les opérations
administratives plus longues. La borne globale à froid et l'annulation réelle
restent des conditions à résoudre/qualifier avant ouverture serverless.

## Contrôles requis sur Neon/Vercel réels

Après autorisation distincte, sur une base et deux projets de staging dédiés,
avec données exclusivement synthétiques :

1. Confirmer versions PostgreSQL/PgBouncer, mode transaction, prepared statements,
   capacité et timeouts effectifs du pooler ; ne pas supposer le réglage local.
2. Vérifier destinations poolée/directe, rôles, TLS strict et absence de secrets
   dans les logs ou le frontend.
3. Rejouer les transactions, savepoints, verrous, interruptions et les protections
   métier sur le chemin effectif Prisma → Neon pooler → PostgreSQL.
4. Mesurer démarrages à froid, suspension/réveil du compute, connexions cassées,
   attente sous saturation, retours HTTP et écritures éventuellement tardives.
5. Démontrer une politique de délai global et de reprise sûre ; examiner avec
   Neon les possibilités de borne d'attente. Ne pas promettre une annulation
   par simple déconnexion ou par délai d'appelant non confirmé côté base.
6. Dimensionner la concurrence maximale : chaque instance chaude a son pool.
   Les 10 000 clients annoncés par Neon ne sont pas autant de requêtes physiques
   simultanées. Inclure jobs, maintenance et accès administratifs dans le budget.
7. Rejouer redéploiements, prepared statements après DDL, lecteurs anciens,
   rotations de clés et conservation des reçus UNCERTAIN.

Ne pas cloner une base réelle pour constituer le staging. Les migrations
éventuelles restent un acte administratif séparé, jamais automatique ici.

Références : [PgBouncer Windows](https://www.pgbouncer.org/install.html),
[configuration PgBouncer](https://www.pgbouncer.org/config.html),
[pooling Neon](https://neon.com/docs/connect/connection-pooling),
[paramètres PostgreSQL Prisma 6](https://www.prisma.io/docs/orm/v6/overview/databases/postgresql),
[Prisma et PgBouncer](https://www.prisma.io/docs/orm/v6/prisma-client/setup-and-configuration/databases-connections/pgbouncer).
