# Diagnostic serveur du parcours OTP

Instrumentation locale uniquement : aucun déploiement, commit, changement de
variable Vercel, migration ou appel fournisseur réel n'est nécessaire pour les
tests. Aucun endpoint de diagnostic ou réenvoi automatique n'est ajouté.

## Lire les Runtime Logs existants après un déploiement autorisé

1. Dans skillquest-frontend, repérer START_RECEIVED puis START_RESULT pour le
   POST de démarrage. Le requestId est créé côté serveur et envoyé uniquement
   au backend dans x-skillquest-request-id ; une valeur client n'est pas relayée.
2. Dans skillquest-backend, rechercher ce requestId. START_RECEIVED est enregistré
   avant les parseurs et limites applicatives. START_RESULT précise le code
   métier si le handler a été atteint ; START_FINISHED indique le statut HTTP et
   la durée globale. Un 409 EMAIL_VERIFICATION_REQUIRED reste une attente normale.
3. TRACE_LINKED lie le requestId à l'UUID persistant de la tâche : traceId. Chercher
   ce traceId pour suivre création/réutilisation, publication et traitement.
4. DISPATCH_STARTED crée un dispatchId. JOB_SELECTED lie le dispatchId au traceId
   de chaque tâche effectivement sélectionnée. Une exécution indépendante peut
   ne pas avoir de requestId ; les publications restent liées par traceId.
5. QSTASH_PUBLISH_OK code=PROVIDER_ACCEPTED atteste l'acceptation de la publication,
   pas l'exécution du worker. notificationId distingue les intentions d'une même
   tâche. L'enveloppe QStash et son schéma strict ne sont pas modifiés.
6. WORKER_RECEIVED status=ok code=CALLBACK_ACCEPTED suit l'authentification du
   callback ; status=started marque l'entrée effective dans processJob après
   les contrôles de l'intention. WORKER_FINISHED code=ATTEMPT_RETURNED signifie
   seulement que la tentative bornée a rendu la main. Le callback journalise
   séparément la disposition COMPLETE, DEFERRED, BUSY, OBSOLETE, etc.
7. BREVO_SEND_STARTED n'est émis qu'après préparation et réservation de budget,
   juste avant le transport réel. BREVO_SEND_OK code=PROVIDER_ACCEPTED signifie
   acceptation API ; ALREADY_ACCEPTED identifie une déduplication reconnue.
8. OTP_DELIVERY_STATUS code=STATE_PERSISTED suit une écriture confirmée ; un échec
   ou un jeton de bail devenu obsolète donne OTP_STATUS_PERSIST_FAILED. Les
   consultations de statut existantes donnent STATE_OBSERVED. La retraite des
   tâches expirées journalise aussi chaque statut seulement après commit.

## Sorties anticipées et limites

- DISPATCH_FINISHED status=disabled : aucun dispatch autorisé. La préparation
  QStash peut échouer avant toute admission SQL ; QSTASH_PUBLISH_SKIPPED et
  DISPATCH_FAILED rendent ce cas visible sans annoncer un échec SQL imaginaire.
- DB_LEASE_FAILED indique chaque tentative réelle ; DB_LEASE_ACQUIRED n'est émis
  qu'après validation de la transaction. La reprise bornée et les délais existants
  sont conservés.
- NO_JOB_READY code=NO_ELIGIBLE_JOB ne permet pas à lui seul de distinguer un
  lot vide, une échéance future ou un bail concurrent ; aucune requête de diagnostic
  globale supplémentaire n'est lancée pour inventer cette précision.
- BREVO_SEND_SKIPPED rend visibles configuration désactivée, quota, déduplication,
  préparation bloquée et mode synthétique. Le mode synthétique n'annonce jamais
  une publication QStash réelle ou une acceptation Brevo réelle.
- Les statuts ACCEPTED et le statut public SENT décrivent l'acceptation fournisseur,
  pas la réception. Tous les OTP_DELIVERY_STATUS portent receipt=not_observed.
  Sans webhook de livraison existant, la réception en boîte, le spam et les
  événements ultérieurs du fournisseur ne sont pas observables par ce correctif.
- Les logs locaux ne prouvent pas le fonctionnement des déploiements réels. Un
  arrêt brutal de processus peut interrompre une séquence avant son dernier log.
- Les traitements batch du serveur local hors callbacks ciblés peuvent journaliser
  des événements de sélection sans identifiant de requête HTTP. Les liens durables
  ne reposent jamais sur une mémoire partagée entre fonctions Vercel.

## Garanties d'implémentation

Le logger projette explicitement les seuls champs autorisés ; il n'accepte pas
d'objet d'erreur à sérialiser. Les codes sont une liste fermée ou un SQLSTATE/code
Prisma au format contrôlé. Les UUID sont validés ; les statuts, modes et événements
sont fermés. Les messages d'erreur, emails, noms, OTP, hashes d'identité, jetons de
bail, clés d'idempotence sous forme d'en-tête, URLs, cookies, corps, payloads
chiffrés et identifiants retournés par les fournisseurs ne sont jamais copiés.
L'UUID de la tâche, déjà utilisé comme clé d'idempotence, est le traceId autorisé.
Une défaillance de console.info est absorbée par le logger.

Les nouvelles projections SQL lisent uniquement j.id pour la corrélation sur
les lectures existantes. La retraite conserve son UPDATE et ajoute RETURNING
j.id,j.status, puis reconstruit le même compteur ; ces colonnes étaient déjà lues.
Les écritures, filtres d'éligibilité, verrous, quotas et réponses HTTP sont
conservés. Aucune permission supplémentaire n'est nécessaire à ces projections.

## Vérification locale

Les tests de diagnostic couvrent la projection et l'expurgation avec valeurs
pièges, l'isolation des contextes concurrents, les erreurs SQL avant/après commit,
la réutilisation d'une tâche, la publication, les callbacks authentifiés/refusés,
les quotas, l'acceptation Brevo simulée, l'incertitude, les baux périmés et les
écritures d'état. Les tests frontend vérifient le relais du requestId et le maintien
des réponses 409, cookies et métadonnées Retry-After.

Le lanceur tsx est indisponible dans cet environnement Windows (os.userInfo /
uv_os_get_passwd). Les tests ont été compilés en JavaScript et exécutés avec Node,
un résolveur local des imports et un garde-fou interdisant fetch hors loopback.
Les bases de tests sont en mémoire ou sur loopback, les fournisseurs sont simulés.
Les variables de garde sont limitées aux processus de tests locaux.
