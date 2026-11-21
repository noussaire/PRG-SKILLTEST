# Qualification locale des pannes — sous-étape 3C

Le simulateur est exclusivement dans les tests : `backend/tests/helpers/local-notification-simulator.ts`. Il n'ajoute aucun endpoint, consumer, fournisseur, abonnement ou planificateur. Il permet doublons, délai logique, inversion d'ordre, perte d'une livraison avec nouvelle tentative, publication acceptée avec réponse perdue, acquittement perdu et perte définitive d'une notification confirmée.

Les événements sont distincts :

1. **Publiée** : le transport simulé a enregistré la notification ; cela ne signifie pas que le consumer l'a reçue.
2. **Reçue** : le simulateur a appelé le traitement du job ; une invocation peut rendre la main sans effectuer le travail (bail actif, échéance future, état terminal).
3. **Job terminé** : état métier persistant, par exemple ACCEPTED pour OTP ou SENT pour un rapport ; la résolution de Promise<void> ne le prouve pas.
4. **E-mail accepté** : l'API Brevo simulée a accepté une clé d'envoi. Les réponses perdues peuvent empêcher la base de confirmer cette acceptation.
5. **E-mail reçu par le destinataire** : non observé et non garanti. Aucun SMTP ni appel Brevo réel n'est exécuté.

## Corrections issues des reproductions

### Contrôle transactionnel avant réservation

Une course a été reproduite entre prise du bail et réservation Brevo : suppression du job, changement d'attemptToken ou expiration de l'OTP pouvaient survenir après la sélection. Un appel au transport restait alors possible depuis le snapshot du worker.

`sendReportEmail` transmet maintenant au budget un callback interne `beforeClaim`, jamais sérialisé ni issu d'une notification. `EmailBudget.claim` l'exécute dans la même transaction que la réservation, sous les verrous existants. Pour l'OTP, il recontrôle le job, l'attemptToken, le bail, les expirations, le code courant, la gate et la consommation. Pour le rapport, il recontrôle le bail, le compteur de tentative, l'accès, le consentement et l'adresse du participant. Un refus n'ajoute ni réservation ni unité budgétaire et ne contacte pas le transport.

Ce contrôle ne rend pas PostgreSQL et Brevo atomiques. Après l'engagement d'une tentative externe, une interruption ou une suppression concurrente ne prouve pas que l'e-mail n'a pas été accepté. Les réservations UNCERTAIN et la politique de non-renvoi restent nécessaires. Une suppression ne peut pas annuler un e-mail déjà accepté.

### Publication confirmée sans progression

Une notification confirmée mais définitivement perdue par le simulateur laissait le job PENDING avec une intention PUBLISHED. Le rattrapage de 3B ne la réarmait pas.

`reconcile(limit)` comporte désormais une quatrième opération bornée, au plus limit réarmements au total : rechercher les activations encore dues et non commencées, dont la publication est confirmée depuis au moins 120 secondes. Le job doit toujours correspondre à l'activation publiée. Le verrou SKIP LOCKED et la comparaison de l'échéance courante protègent les réconciliateurs concurrents.

Seule l'échéance de réveil est avancée. Le trigger existant crée un nouvel UUID de notification, évitant la déduplication éventuelle de l'ancienne notification ; l'UUID d'idempotence Brevo, le code et l'expiration OTP ne changent pas. Une ancienne notification retrouvée après la nouvelle demeure sans effet supplémentaire grâce aux contrôles métier. Les jobs expirés, déjà terminés, sous traitement et les réservations OTP UNCERTAIN ne sont pas réactivés par ce mécanisme. Les quatre opérations de reconcile sont bornées séparément ; aucun minuteur n'est installé.

## Interruption et concurrence

Le helper `output/job-failures-step3c-20261031/crash-worker.mjs` vérifie d'abord l'identité du PostgreSQL synthétique. Le parent arrête son propre processus enfant après prise du bail, réservation budgétaire, acceptation simulée, persistance de l'acceptation budgétaire ou achèvement du job avant acquittement. Les reprises prouvent notamment :

- absence de réservation avant le contact : reprise possible avec un envoi unique ;
- réservation UNCERTAIN sans confirmation : pas de nouveau contact automatique ;
- reçu ACCEPTED persistant : réconciliation du job sans renvoi ;
- job déjà terminé avec acquittement perdu : notifications répétées sans effet.

Les interruptions PDF FR/AR sont injectées dans `page.pdf` d'un vrai Chromium local, avec vérification de fermeture du navigateur. Le retry génère ensuite un vrai PDF et produit un seul envoi simulé. Ces tests ne simulent pas l'arrêt forcé d'un processus Chromium par le système d'exploitation.

Le retard de rattrapage est injecté dans les échéances PostgreSQL : cinq minutes d'âge synthétique pour douze jobs. Le temps de récupération est mesuré par horloge monotone locale. Ce n'est ni une panne réelle de cinq minutes ni un SLO de production. Le volume de qualification est de 150 jobs et 600 notifications, avec lots de 37 et huit workers logiques ; il ne représente pas un benchmark de grande échelle.

## Préservation et limites

Les migrations historiques et le schéma sont inchangés. Les transactions budget, statuts incertains, compteurs persistants, coupe-circuits, protections réseau, rotation de clés, rétention, parcours FR/AR, sessions administrateur, localhost et import serverless restent soumis aux non-régressions.

Aucun réveil durable réel n'est installé. Si reconcile ne s'exécute pas, même une correction de rattrapage reste inactive. Le seuil de 120 secondes et les limites de lot devront être qualifiés en staging ; ils ne garantissent pas une livraison immédiate. Une panne dépassant l'expiration de l'OTP ne prolonge pas sa validité. Les limites de coûts, la rétention des intentions, les performances à grande échelle et le fonctionnement Linux restent à qualifier. Les résultats d'acceptation Brevo et de PDF restent ceux d'une simulation et d'un navigateur Windows local.

3D n'est pas commencée. L'intégration d'un fournisseur, d'un callback authentifié, d'un scheduler et tout déploiement exigent une autorisation ultérieure. L'adaptateur réseau Vercel reste désactivé jusqu'à sa validation en staging.
