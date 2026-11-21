# Étape 4C — politique de rétention conservatrice

Cette politique est écrite avant l'implémentation de la suppression. Elle distingue les intentions de publication des reçus de maintenance. `MaintenanceInvocations` est la classe d'orchestration ; la table persistante correspondante s'appelle `MaintenanceRun`.

## Audit des dépendances et décision préalable

`JobPublicationIntent` sert à publier, reprendre un bail, réarmer une notification perdue et vérifier les sept champs d'un callback QStash. PUBLISHED signifie seulement publication confirmée. CANCELLED n'exclut pas à lui seul une publication antérieure : une réponse a pu être perdue après contact du transport. Toute publication par le chemin normal revendique d'abord l'intention, incrémente attempts et pose un jeton dans PostgreSQL. Les jobs, réservations et autres intentions du même job restent des dépendances distinctes.

La durée maximale de livraison tardive d'une future file réelle n'est pas qualifiée. Aucune durée d'âge ne justifie donc de supprimer automatiquement les intentions PUBLISHED, déjà tentées, PENDING ou PUBLISHING. Cette décision n'est pas remplacée par une hypothèse sur un TTL fournisseur.

**Seule catégorie supprimable : intention CANCELLED jamais revendiquée ni publiée, dont le job a disparu et sans dépendance de reprise ou preuve incertaine.** Conditions cumulatives, revérifiées dans la transaction de suppression :

- attempts=0, publishedAt NULL, leaseUntil NULL et attemptToken NULL ;
- absence du job UUID dans les trois outboxes, même si son type ne correspond pas ; un job encore présent, même terminal, est conservé par cette politique ;
- aucune autre intention PENDING/PUBLISHING, sous bail ou jeton pour cet UUID ;
- aucune réservation RESERVED/UNCERTAIN, sous bail ou jeton pour ce logicalKey ; les reçus terminaux restent eux-mêmes conservés ;
- observation d'éligibilité depuis au moins **30 jours**, horodatée par PostgreSQL, et date de création cohérente avec cette observation.

Le délai de 30 jours est une marge opérationnelle après observation, pas une preuve de fin de livraison fournisseur. La preuve d'absence de notification en file est ici l'absence totale de revendication/publication dans le chemin transactionnel autorisé. Toute future publication devra conserver cet invariant. Les observations initiales ne sont pas rétrodatées depuis createdAt ; une modification des métadonnées de publication invalide l'observation. L'application ne recycle pas les UUID des jobs supprimés. Une réintroduction manuelle d'UUID dans la base reste hors du contrat normal ; la suppression revérifie néanmoins l'absence de job.

Les anciens UUID supprimés ne peuvent plus autoriser un traitement : le callback exige toujours une intention correspondante et retourne 409 pour un UUID absent, après vérification de signature. Il ne recrée aucun job. Une notification déjà tentée ou pouvant encore être en transit reste conservée.

## Maintenance : conservation de la preuve, réduction des métadonnées

Le Bearer 4B n'a pas de fenêtre temporelle cryptographique. La preuve anti-rejeu d'un UUID admis n'a donc **aucune durée finie de conservation sûre démontrée**. Il est interdit de supprimer automatiquement cet UUID, même après rotation du secret ou expiration du bail.

Une réduction des seules métadonnées est autorisée après **90 jours depuis finishedAt**, pour les runs COMPLETED/PARTIAL/FAILED/INTERRUPTED, avec dates cohérentes, et sans aucune référence depuis MaintenanceLease, même expirée. Le reçu détaillé est remplacé atomiquement par une preuve minimale persistante : UUID et date de réduction. L'admission doit consulter en une seule requête les runs détaillés et ces reçus minimaux. En cas de panne, le reçu détaillé subsiste ou le reçu minimal est commité avec sa suppression ; aucun intervalle sans preuve n'est autorisé.

Le délai de 90 jours dépasse largement bail de 20 secondes, cooldown de 60 secondes et budgets de travail, mais **ne justifie pas la suppression du reçu anti-rejeu**, qui reste conservé sans TTL. Les reçus minimaux sont immuables au niveau SQL. Les runs RUNNING et tous ceux encore référencés par un bail sont conservés. MaintenanceTask, le bail global, les réservations Brevo, les reçus d'idempotence fournisseur et les nonces participant suivent leurs politiques existantes, sans nouvelle suppression ici.

Une garde SQL refuse également l'insertion d'un MaintenanceRun pour un UUID déjà réduit. Elle protège les anciens binaires 4B qui ne consultaient que MaintenanceRun : ils peuvent retourner une erreur technique au lieu du 409 explicite des nouveaux binaires, mais ne peuvent pas recommencer le travail. Cette protection est nécessaire pendant un changement de version ou un rollback applicatif.

## Bornes et intégration prévues

La maintenance technique s'exécute explicitement, dans une transaction courte contrôlée par les limites 4A et le fencing 4B lorsqu'elle est appelée par HTTP. Trois opérations bornées : observer au plus N intentions, supprimer au plus N intentions éligibles et réduire au plus N runs détaillés. Les lignes verrouillées sont ignorées avec SKIP LOCKED. Le verrou budgétaire existant protège le rapprochement avec les réservations ; aucune publication ou requête fournisseur n'est effectuée.

Le plafond global compte ces cibles, pas les écritures dérivées ni l'insertion des reçus minimaux. Des index additifs ciblent les intentions jamais tentées, les observations arrivées à échéance et les runs terminaux anciens. Les routes 4B restent fixes, désactivées par défaut et dans leurs plafonds existants. Aucun Cron, nouvel endpoint, secret, déploiement ou service externe n'est activé.

## Risques conservés explicitement

Les intentions publiées/tentées et les preuves incertaines peuvent continuer à croître. Les reçus anti-rejeu minimaux croissent avec le nombre d'invocations ; leur réduction limite le volume par UUID sans rendre leur nombre borné. Une borne totale exigerait un protocole de fraîcheur/rejeu différent, qui n'est pas introduit par 4C. La politique ne promet donc pas de supprimer toute croissance au prix des protections de sécurité.

La taille, les index, le coût des lots, le retard accumulé et les exclusions seront mesurés sur des volumes synthétiques importants. La validation locale ne constitue pas une qualification des temps de pause, du pooling ou des notifications réellement délivrées par un fournisseur de production.

## Contrat implémenté

`technicalRetention` est une étape explicite supplémentaire de `runMaintenance`. Les onze étapes par défaut de 4A restent inchangées pour les appels locaux existants. La route fixe 4B `cleanup` inclut désormais cette étape, tout en gardant ses plafonds : quatre lots, 1 000 cibles, cinq secondes de traitement et une seconde maximale par instruction SQL. L'activation, le secret dédié, l'UUID d'invocation et le fencing restent ceux de 4B. Aucun endpoint n'est créé et les routes restent désactivées par défaut.

Un lot technique traite au plus N observations, N suppressions d'intentions et N réductions de runs. Pour respecter le plafond global, N est limité à `min(batchSize, floor(ciblesRestantes/3))`. Les moins de trois places restantes provoquent ROW_LIMIT à cette étape. La création du reçu minimal est une écriture dérivée indispensable, pas une suppression de preuve. Si une instruction ou le contrôle avant commit échoue, tout le lot est annulé.

Les résultats contiennent, uniquement si cette étape s'exécute, `technicalRetention` avec les nombres d'intentions observées/supprimées, de runs réduits et le retard maximal observé des intentions réellement éligibles après leur marge de 30 jours. Aucun e-mail, code, UUID ou jeton n'est exposé dans ces indicateurs. Les mesures de taille distinguent le contenu logique vivant de l'espace physique alloué : une suppression transactionnelle ne promet pas de réduire immédiatement la taille des fichiers.

La migration additive `20261031040000_technical_retention` ajoute l'observation, trois index partiels, le reçu minimal et les gardes SQL. Le runtime n'exige pas de régénération du client Prisma, car ces chemins utilisent du SQL paramétré. L'indexation sur la future base volumineuse reste à qualifier avant toute migration réelle.

Les scripts de qualification, mesures de volume, plans de présélection et contrôles SHA-256 sont conservés sous `output/maintenance-step4c-20261031`. Le rapport final donne les chiffres effectivement observés ; ils ne constituent pas un engagement de délai en production.
