# Intentions de publication — sous-étape 3B locale

La migration additive `20261031020000_job_publication_intents` ajoute la table `JobPublicationIntent`, deux vues d'éligibilité et des triggers sur les trois outboxes existantes. Le modèle Prisma décrit la table ; les contraintes CHECK, vues et triggers restent définis par la migration. Le service utilise du SQL paramétré sans dépendre d'une régénération du client installé. Aucune migration historique n'est modifiée.

Une insertion ou réactivation exécutable de `ParticipantEmailDeliveryJob`, `OtpDeliveryJob` ou `AdaptiveReportJob` crée son intention dans la même transaction PostgreSQL. Une panne du trigger annule aussi l'écriture du job. La transition de synthèse terminée vers la phase EMAIL est couverte sans ajouter d'appelant applicatif susceptible d'oublier l'intention.

L'intention contient : UUID stable de notification, type de job, UUID du job, phase, compteur de tentative métier (`generation`), échéance `dueAt`, état de publication, tentatives de publication, prochaine tentative, bail, jeton UUID et codes d'erreur fixes. Elle ne contient ni OTP, ni adresse e-mail, ni jeton participant, ni PDF, ni payload chiffré. Les UUID restent des identifiants pseudonymes et nécessiteront une politique de conservation.

L'unicité porte sur `(kind, jobId, phase, generation, dueAt)`. Pour une même activation, toutes les reprises de publication conservent le même UUID de notification. Une nouvelle échéance crée une nouvelle intention, même si le compteur d'envoi n'a pas augmenté, notamment après une clé OTP indisponible. L'UUID d'idempotence Brevo reste toujours celui du job ; il ne devient jamais celui d'une notification.

Les vues distinguent candidat transactionnel et job publiable : l'insertion initiale de l'OTP précède la mise à jour de sa gate dans la même transaction ; la publication exige ensuite que cette gate soit courante. Les OTP expirés, consommés, remplacés, épuisés ou associés à une réservation UNCERTAIN ne sont pas publiables. Les statuts terminaux ne sont pas réactivés. Les contrôles de 3A restent nécessaires au moment du traitement ; une notification devenue obsolète entre claim et livraison ne donne aucun droit d'envoyer.

## Publication abstraite

`new JobPublications(db).publishBatch(publisher, limit)` est un appel interne explicite. Il n'a ni publisher par défaut, ni endpoint, ni intervalle. Aucun appel n'est ajouté au serveur HTTP ou aux workers locaux.

Le contrat `JobPublisher.publish(notification, signal)` doit se résoudre uniquement lorsque l'adaptateur confirme l'acceptation par son transport. Aucun adaptateur externe n'est fourni. Le message v1 expose uniquement les champs `version`, `notificationId`, `kind`, `jobId`, `phase`, `generation` et `dueAt`. Un futur consumer doit valider cette enveloppe puis transmettre uniquement kind/jobId/phase au contrat strict de 3A ; il ne doit pas lui passer aveuglément les propriétés de transport.

Le claim est atomique : `FOR UPDATE SKIP LOCKED`, bail de 30 secondes, nouvel attemptToken et incrément des tentatives. Les appels au publisher sont hors transaction, avec un timeout local de 5 secondes et un signal d'annulation. Un adaptateur peut avoir accepté un message malgré une interruption ou un timeout : le résultat est alors inconnu et l'intention revient en PENDING avec backoff de 2 à 256 secondes, même UUID. L'échec n'enregistre aucun texte fournisseur ou donnée personnelle.

La finalisation PUBLISHED/PENDING exige le même attemptToken. Un ancien publisher ne peut pas écraser la reprise d'un bail expiré. Si PostgreSQL échoue après acceptation du transport, le bail persiste et sa reprise republie le même identifiant. La déduplication par le futur fournisseur sera une optimisation ; les contrôles PostgreSQL de 3A demeurent la protection contre les doubles envois.

Les états sont PENDING, PUBLISHING, PUBLISHED et CANCELLED. PUBLISHED signifie uniquement « acceptation confirmée de la notification », pas « job traité » ou « e-mail reçu ». Les triggers peuvent annuler une intention non achevée quand le job commence, change de phase, devient terminal ou est supprimé. Un acquittement devenu obsolète ne la ressuscite pas.

## Rattrapage borné

`new JobPublications(db).reconcile(limit)` est également un appel explicite sans minuteur. La limite est un entier entre 1 et 100, par défaut 25. Les lots s'appliquent séparément aux trois opérations suivantes :

1. Verrouiller au plus `limit` parcours préparés complets, non expirés et sans job de rapport, avec SKIP LOCKED ; créer job et intention atomiquement. La configuration IA existante doit autoriser la génération ; sinon aucun job supplémentaire n'est créé.
2. Insérer au plus `limit` intentions absentes pour les activations existantes encore éligibles, avec contrainte d'unicité et ON CONFLICT. Cela permet le rattrapage des données antérieures à la migration sans backfill massif dans la migration elle-même.
3. Annuler au plus `limit` intentions PENDING/PUBLISHING devenues obsolètes. Les jobs, réservations et reçus PUBLISHED ne sont pas effacés.

La dernière réponse du parcours préparé et le job de rapport sont désormais écrits dans la même transaction Express, lorsque l'enrichissement IA est configuré. L'échec de création de l'intention laisse la réponse précédente intacte et renvoie une erreur technique ; le navigateur peut reprendre la dernière réponse. Le rattrapage couvre les parcours déjà achevés sans job.

La reprise des publications PENDING et des baux PUBLISHING expirés est assurée par publishBatch. Les reçus PUBLISHED ne sont pas automatiquement réémis par 3B : la surveillance de l'exécution après publication et le contrat d'acquittement du futur consumer restent pour une sous-étape ultérieure. Aucun réveil périodique réel n'est garanti sur Vercel à ce stade.

## Préservation et limites

Les workers localhost restent inchangés, sauf l'extraction d'une fonction de création de rapport utilisable dans la transaction de réponse. Les transactions, clés OTP, budgets, idempotence Brevo, baux de traitement, statuts UNCERTAIN/UNKNOWN, consentements et contrôles réseau restent applicables. Une publication répétée n'est pas un nouvel envoi. Les migrations doivent être appliquées uniquement dans l'environnement explicitement autorisé avant utilisation du schéma ; aucun déploiement n'est réalisé ici.

Il n'y a aucun fournisseur, abonnement, callback, endpoint public, nouveau planificateur ni connexion QStash/Vercel Queues. 3C et 3D ne sont pas commencées. La purge automatique des intentions, leur archivage, les limites de tentatives/coûts du futur transport, les alertes, les index/performances sur gros volumes et le dimensionnement serverless restent à qualifier. La rétention des reçus incertains existants n'est pas raccourcie. L'adaptateur réseau Vercel reste désactivé jusqu'à sa validation en staging.
