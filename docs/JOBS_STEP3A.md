# Jobs explicites — sous-étape 3A, local uniquement

`processJob(input)` dans `backend/src/services/job-processing.service.ts` est une interface interne, sans endpoint, publication, abonnement ou dépendance à un fournisseur de file.

Entrées acceptées, sans propriété supplémentaire :

- `{ kind: "OTP_INITIAL", jobId: "<UUID du ParticipantEmailDeliveryJob>", phase: "DELIVER" }`
- `{ kind: "OTP_RETAKE", jobId: "<UUID du OtpDeliveryJob>", phase: "DELIVER" }`
- `{ kind: "REPORT", jobId: "<UUID du AdaptiveReportJob>", phase: "SUMMARY" }`
- `{ kind: "REPORT", jobId: "<UUID du AdaptiveReportJob>", phase: "EMAIL" }`

L'identifiant désigne le job, pas le challenge ou le participant. Type, phase et UUID sont validés avant dispatch. Aucun destinataire, payload, nom de table, URL ou corps d'e-mail ne peut être fourni par ce contrat. Les phases sont séparées : une synthèse terminée ne déclenche pas automatiquement un e-mail.

Le traitement OTP sélectionne la table fixée par le type et filtre le même UUID dans la réconciliation et la sélection. Il ne lance pas la purge des autres jobs. Un job absent, expiré, déjà terminé, sous bail actif ou non encore dû ne déclenche aucun autre job. Un OTP consommé ou remplacé est rejeté selon les contrôles existants. Les réservations ACCEPTED sont réconciliées uniquement pour le job demandé ; les réservations UNCERTAIN interdisent le renvoi automatique. Le bail de 120 secondes et l'attemptToken UUID existants sont conservés.

Les phases de rapport filtrent le job et leur propre éligibilité. Un message EMAIL ne génère pas la synthèse manquante. Un rapport dont l'accès participant est expiré n'est pas traité par l'interface ciblée. La préparation PDF conserve son contrôle du bail avant contact fournisseur, notamment après suppression administrative. Les mises à jour des rapports incluent désormais le compteur de tentative attendu, en complément du bail : un ancien résultat ne peut pas écraser la tentative suivante, même si les dates de bail se répètent. Aucun nouveau champ ou migration n'est nécessaire.

Les compteurs et réservations partagés restent actifs. Un quota rencontré pendant un appel ciblé ne réécrit pas les échéances d'autres jobs. Les coupe-circuits persistants et la consultation des cooldowns partagés restent applicables.

Localhost conserve `runOnce()`, `processReportQueue()` et `processReportEmails()` sans identifiant ainsi que leurs planificateurs existants. Ils utilisent les mêmes chemins de traitement ; leur sélection locale et leurs opérations de maintenance/report global des échéances sont conservées. Les appels ciblés ne dépendent pas des variables locales de single-flight ou d'attente : ils utilisent les conditions atomiques PostgreSQL pour leurs baux.

La résolution de la promesse `Promise<void>` signifie seulement que la tentative bornée a rendu la main. Elle n'est ni un accusé de livraison e-mail ni un contrat d'acquittement de file. Job absent, non dû, occupé, en attente de clé ou incertain peuvent tous rendre la main sans envoi. Une erreur technique PostgreSQL se propage. Un futur adaptateur devra lire le statut persistant ou utiliser un résultat métier explicite défini à l'étape suivante avant d'acquitter.

Cette interface ne constitue pas une authentification : seul du code serveur autorisé peut l'appeler actuellement. Un futur callback devra être authentifié avant cet appel, avec une séparation des usages par rapport aux preuves réseau du LOT 5. L'origine réseau de l'OTP demeure celle du payload enregistré ; l'IP d'un futur fournisseur de file ne doit pas la remplacer.

Restent hors périmètre : intentions transactionnelles de publication, notifications externes, réconciliateur durable, nouveaux endpoints, choix/connexion QStash ou Vercel Queues, garantie de réveil serverless, qualification Linux des PDF. L'adaptateur réseau Vercel reste désactivé jusqu'à validation de son ingress réel.

Plan proposé pour 3B, non implémenté : sauvegarde vérifiée ; définition de la disposition persistante après tentative ; intention de publication écrite atomiquement avec chaque job/phase exécutable ; identifiant de notification distinct de l'UUID d'envoi ; simulation des échecs commit/publication/acquittement ; rattrapage borné des intentions et jobs dus, y compris parcours terminés sans rapport. Les migrations éventuelles seront additives. Aucun fournisseur externe ne doit être connecté sans autorisation séparée.
