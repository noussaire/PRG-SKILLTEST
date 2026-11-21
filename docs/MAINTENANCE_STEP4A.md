# Étape 4A — maintenance locale explicite et bornée

Cette étape n'installe aucun endpoint, Cron, transport externe ou exécution à l'import. Le handler Vercel reste HTTP uniquement. Les six boucles localhost restent en place ; leur activation n'est pas déplacée dans le handler serverless.

## API interne

`runMaintenance(prisma, options)` est un appel explicite. Il reçoit un client PostgreSQL de confiance et ne construit pas de connexion à partir d'une notification. Options validées strictement :

- `batchSize` : 1 à 100, défaut 25 ;
- `maxBatches` : 1 à 100, défaut 22 ;
- `maxRows` : 1 à 10 000, défaut 1 000 ;
- `budgetMs` : 50 à 30 000 ms, défaut 5 000 ;
- `sqlTimeoutMs` : 10 à 4 000 ms, défaut 1 000 ;
- `stages` : liste non vide sans doublons, choisie parmi les onze opérations ci-dessous ;
- `signal` : AbortSignal optionnel.

Un lot correspond à une opération transactionnelle, même lorsqu'elle ne change aucune cible. Les opérations sont parcourues dans l'ordre fourni, puis répétées jusqu'à une limite ou un tour entier sans changement. La mesure initiale du retard ajoute une transaction de lecture, soumise au même budget global, mais n'est pas comptée comme lot de maintenance.

`rows` comptabilise les lignes cibles modifiées ou supprimées par les opérations, pas les lectures, les mutations dérivées des triggers ni l'insertion éventuelle de la ligne de coordination BREVO. `maxRows` limite ce compteur sur l'ensemble de l'appel ; ce n'est pas une limite physique de toutes les écritures internes PostgreSQL.

La rétention réutilise huit opérations bornées de la purge existante dans une transaction : compteurs, throttles, effacement de deux outboxes, suppression de deux outboxes, portes et challenges. Chaque catégorie reçoit au plus `min(batchSize, floor(rowsRestantes/8))` cibles. Si moins de huit places restent lorsque cette étape est atteinte, l'appel s'arrête avec `ROW_LIMIT` plutôt que dépasser son plafond. Pour de très petits plafonds, choisir explicitement les étapes à exécuter ; prévoir une alternance équitable des familles lors de la future orchestration.

## Opérations

1. `otpInitial` : rapprochement des reçus ACCEPTED/UNCERTAIN et neutralisation des payloads expirés.
2. `otpRetake` : même traitement pour les reprises.
3. `reportSummary` : clôture en UNAVAILABLE des synthèses expirées sans bail actif.
4. `reportEmail` : rapprochement d'un reçu ACCEPTED en SENT, y compris depuis UNKNOWN ; classement des interruptions dépassant leur fenêtre sûre en UNKNOWN, ou des travaux expirés sans tentative fournisseur en FAILED.
5. `sessions` : ouverture et fermeture bornées des sessions, avec fermeture prioritaire lorsque les deux dates sont dépassées. Les états DRAFT, ARCHIVED et les sessions administrateur ne sont pas modifiés.
6. `nonces` : suppression bornée des seuls nonces expirés.
7. `retention` : réutilisation de `EmailBudget.purgeExpiredData()` avec taille et contrôle de durée explicites.
8. `missingReports` : réutilisation du rattrapage des entretiens terminés sans job de rapport, sous les conditions existantes, dont la configuration IA.
9. `missingIntents` : création des intentions manquantes pour les activations toujours exécutables.
10. `staleIntents` : annulation des intentions obsolètes sans bail de publication actif.
11. `rearm` : réutilisation du réarmement 3C après 120 secondes d'inactivité d'une publication confirmée, avec nouvel UUID de notification et UUID de job inchangé.

Les opérations n'appellent jamais `processJob`, un publisher, un fournisseur ou un renderer PDF. Une intention PENDING reste une intention non publiée. Un bail PUBLISHING expiré reste reprenable par le publisher existant et son mécanisme de fencing ; la maintenance ne prétend pas l'avoir publié. Elle peut créer l'intention de reprise d'un job dont le bail a expiré, si les vues métier l'autorisent.

## Transactions, temps et reprise

`MaintenanceControl` utilise une échéance monotone locale, vérifiée avant chaque transaction et avant son commit. PostgreSQL fournit les références temporelles métier en UTC. Les transactions ReadCommitted ont un timeout limité au budget restant ; le timeout SQL est limité au minimum du plafond demandé et du temps restant. L'attente de verrou est limitée à 250 ms au maximum et l'attente d'acquisition Prisma à 500 ms au maximum, dans le budget restant.

Une annulation observée avant le commit annule le lot en cours. Les lots précédemment validés restent acquis et sont inclus dans le résultat. La reprise repart des lignes PostgreSQL, sans curseur en mémoire nécessaire à la sécurité. SKIP LOCKED et les contrôles existants permettent des clients concurrents. Les opérations touchant les preuves de livraison prennent le même verrou BREVO que les réservations pour préserver leur ordre de sérialisation.

Ce sont des limites applicatives coopératives, pas une interruption dure de processus à la milliseconde : signal reçu pendant une requête, attente de pool, annulation SQL, commit ou rollback peuvent ajouter un délai de résolution. Aucune Promise.race ne laisse tourner un lot détaché après un faux succès. Une interruption brutale du processus peut perdre le rapport de résultat ; PostgreSQL demeure la référence pour déterminer quels lots ont effectivement commité.

Le futur endpoint devra garder une marge sous la durée maximale de la fonction Vercel. Aucun bail global d'orchestration n'est ajouté ici ; les verrous de lignes, transactions et fencing existants protègent les données. Un éventuel bail d'endpoint et son authentification appartiennent à 4B.

## Préservation des preuves

- Les réservations et reçus d'idempotence ne sont ni supprimés ni réinitialisés.
- Un OTP avec réservation UNCERTAIN reste UNCERTAIN ; sa prochaine tentative est neutralisée, sans publication ni appel Brevo.
- Un reçu ACCEPTED permet uniquement de réparer le statut local, pas de refaire l'envoi. SENT signifie ici acceptation fournisseur connue, sans garantie de réception dans une boîte e-mail.
- Un OTP expiré perd son ciphertext lorsque les baux le permettent, mais sa preuve incertaine est conservée.
- Les baux actifs du job, de la réservation ou de publication sont préservés par les opérations de rapprochement. La purge existante reçoit également des exclusions pour les réservations et publications encore sous bail.
- La fenêtre de reprise existante des rapports encore sûrs n'est pas transformée en autorisation d'envoi par la maintenance. Au-delà de la fenêtre sûre, l'état devient UNKNOWN. UNKNOWN avec reçu ACCEPTED peut être rapproché en SENT sans fournisseur.
- Les participants, jetons, sessions administrateur, clés, coupe-circuit et réservations restent conservés.
- Aucune rétention des intentions ni archivage des réservations UNCERTAIN n'est introduit.

## Résultats et indicateurs

Le résultat contient `stop`, `batches`, `rows`, `elapsedMs`, `stage`, `changed` et `oldestUnpublishedDueLagSeconds`. Les arrêts sont IDLE, MAX_BATCHES, ROW_LIMIT, DEADLINE, ABORTED ou FAILED. Une erreur technique expose seulement `MAINTENANCE_UNAVAILABLE` ; elle ne remplace pas un échec par un succès.

Le retard est un instantané initial, exprimé en secondes, de la plus ancienne échéance PENDING due ou du plus ancien bail PUBLISHING expiré. Ce n'est ni un inventaire exhaustif du backlog ni une preuve de livraison ; le temps de bail et l'échéance d'envoi sont deux références différentes. L'indicateur peut être null si l'observation échoue ou si l'appel est arrêté avant cette lecture. Il ne contient aucun e-mail, IP, OTP, jeton ou UUID.

## Qualification et suite

Les tests natifs couvrent les limites, les rollbacks, les baux actifs, les reçus incertains, les reprises, les sessions, les clients indépendants et la création concurrente. Des processus de test possédés sont arrêtés avant et après commit. Une barrière de verrou PostgreSQL maintient le lot pré-commit afin que le scénario ne dépende pas d'un délai arbitraire. Les PDF FR/AR sont interrompus dans un Chromium local ; la maintenance ne les relance pas, puis un traitement explicite avec Brevo simulé confirme une seule réservation et un seul appel.

4B pourra préparer des endpoints désactivés par défaut, authentifiés avec un secret de maintenance indépendant du HMAC participant, des limites fixées côté serveur et un éventuel bail d'orchestration. Aucun Cron ni transport réel ne doit être activé implicitement. La rétention des intentions, les volumes importants, le déclenchement périodique réel et Linux/Vercel restent à qualifier séparément.
