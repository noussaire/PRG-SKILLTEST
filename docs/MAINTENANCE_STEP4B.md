# Étape 4B — endpoints de maintenance authentifiés

Préparation et qualification locales uniquement. Aucun Cron, publication, transport externe ou secret réel n'est installé. Les routes sont désactivées par défaut ; les tests les activent uniquement dans des processus synthétiques.

## Activation et authentification

Deux variables backend, jamais publiques côté Next.js :

- `SKILLQUEST_MAINTENANCE_ENABLED=1` : activation explicite, toute autre valeur désactive les routes ;
- `SKILLQUEST_MAINTENANCE_SECRET` : secret dédié de 32 octets aléatoires, encodés en base64url canonique sans padding, soit 43 caractères.

Aucune valeur réelle n'est fournie ou écrite par 4B. Une future configuration d'hébergement devra fournir le secret depuis son gestionnaire de secrets, sur le backend uniquement, et utiliser HTTPS. Ne pas mettre le secret dans une URL, un log, une variable `NEXT_PUBLIC_*` ou le navigateur.

Chaque requête exige exactement un `Authorization: Bearer <secret>` et exactement un `X-Skillquest-Maintenance-Id` contenant un nouvel UUID canonique en minuscules, version 1 à 5. Les fixtures utilisent des UUID v4. L'UUID est une clé d'idempotence persistante, pas un secret ni une preuve d'authentification. Réutiliser le même UUID après une réponse perdue permet uniquement de constater le rejet de rejeu ; cela ne relance pas le traitement.

La comparaison du Bearer est effectuée en temps constant pour des buffers de même longueur. La configuration refuse les réutilisations littérales ou du même matériau encodé avec les clés OTP courantes/précédentes et le keyring, les HMAC Next.js/edge, les clés et token QStash, ainsi que les clés fournisseur connues. Une configuration manquante, non canonique ou incohérente ferme les routes. Les secrets ne figurent pas dans les erreurs.

Ni IP, User-Agent, en-tête Cron, cookie administrateur, signature QStash ni preuve HMAC participant ne remplace le Bearer dédié. L'authentification est exécutée avant CORS, avant les parseurs de corps et avant l'accès aux tables métier. Les prévols OPTIONS non authentifiés ne sont pas acceptés automatiquement.

Le Bearer reste un secret statique : sa possession autorise à produire de nouveaux UUID. La protection de rejeu porte sur les identifiants déjà admis, et le cooldown limite les nouveaux appels. Il n'existe pas de signature temporelle personnalisée prétendument fournie par Vercel. Une compromission du secret impose désactivation et remplacement ; l'UUID ne compense pas un secret compromis.

## Routes fixes

GET et POST sans corps sont admis sur les trois chemins exacts :

- `/api/internal/maintenance/reconcile` : OTP initial/reprise, synthèses et e-mails interrompus, rapports et intentions manquants, intentions obsolètes et réarmement ; 25 cibles par opération, 16 lots, 1 000 cibles maximum.
- `/api/internal/maintenance/cleanup` : nonces et purge sécurisée existante ; 100 cibles par catégorie, 4 lots, 1 000 cibles maximum.
- `/api/internal/maintenance/sessions` : fenêtres de sessions ; 25 cibles par lot, 4 lots, 100 cibles maximum.

Chaque tâche reçoit 5 secondes de budget 4A et un timeout SQL maximal d'une seconde. Ces paramètres sont fixés dans le code backend. Les query strings, corps, encodages de corps, transferts chunked, chemins alternatifs et méthodes autres que GET/POST sont refusés. Aucun appelant ne peut sélectionner SQL, commande, URL, publisher, renderer, job particulier, plafond ou timeout.

Les règles de comptage des cibles et les limites coopératives de [4A](MAINTENANCE_STEP4A.md) restent applicables, notamment les huit catégories de rétention et les écritures dérivées des triggers. Les transactions d'admission/finalisation ont des limites propres courtes, en plus des cinq secondes du traitement : il ne faut pas interpréter cinq secondes comme une limite dure de toute la réponse HTTP.

## Bail global et jetons PostgreSQL

La migration additive `20261031030000_maintenance_invocations` crée :

- `MaintenanceLease` : une ligne globale sérialisant les trois familles HTTP ;
- `MaintenanceRun` : UUID reçu, tâche, jeton de tentative interne, état et dates techniques ;
- `MaintenanceTask` : prochaine admission autorisée par famille.

Le runtime utilise du SQL paramétré, sans remplacement obligatoire du client Prisma généré. Les modèles descriptifs sont ajoutés au schéma source ; aucune migration historique n'est modifiée.

L'admission verrouille la ligne globale et crée atomiquement le reçu RUNNING avec un jeton UUID aléatoire et un bail de 20 secondes. Un UUID déjà admis est rejeté dans toutes les familles. Un bail actif bloque toute autre famille. Après finalisation, un cooldown de 60 secondes s'applique à la famille concernée ; les autres familles peuvent fonctionner après libération du bail global.

Chaque transaction 4A vérifie le run, son jeton et l'échéance PostgreSQL sous verrou, avant travail et avant commit. Un ancien worker réveillé après remplacement de son bail ne peut ni modifier les cibles ni finaliser/libérer le bail de son successeur. Une expiration observée avant commit annule le lot. Aucun verrou de session durable, heartbeat ou timer permanent n'est ajouté.

Les contentions de verrou PostgreSQL à l'admission sont classées BUSY uniquement pour le code SQL précis `55P03`. Les erreurs SQL, tables manquantes et défaillances de connexion restent des erreurs techniques. Elles ne deviennent pas un succès ou un rejet métier trompeur.

## Interruptions et reprises

- Avant commit de l'admission : aucun reçu ou bail partiel.
- Après admission et avant travail : reçu RUNNING et bail persistent. Après expiration, un nouvel UUID peut reprendre ; l'ancien reçu devient INTERRUPTED.
- Après certains commits 4A : les changements validés restent acquis ; le nouvel appel reprend les lignes restantes depuis PostgreSQL.
- Après finalisation mais réponse perdue : le reçu persiste, le rejeu du même UUID est rejeté et le cooldown reste actif.
- Annulation du client : AbortSignal transmis à 4A ; l'arrêt reste coopératif. Si la finalisation réussit, le résultat est PARTIAL ; si la fonction est tuée ou perd sa connexion, le bail expirant permet la reprise.
- Ancien résultat reçu tardivement : le jeton ne permet pas d'acquitter le nouveau propriétaire.

COMPLETED signifie que l'invocation bornée a terminé normalement, y compris par limite de lots ou lignes. Cela ne signifie pas que tout le backlog est vide. PARTIAL représente DEADLINE ou ABORTED ; FAILED représente un échec de maintenance. Les lignes commitées restent la référence après une réponse perdue.

Cette couche ne publie aucune notification et n'appelle ni Brevo, QStash, l'IA ou le renderer PDF. Les OTP UNCERTAIN restent sans renvoi automatique. Les réservations, reçus d'idempotence et baux métier actifs sont préservés. Les workers localhost et les appels explicites 4A restent utilisables ; leurs protections métier sont inchangées. Le bail global concerne les invocations HTTP 4B, pas tous les traitements locaux indépendants.

## Réponses HTTP

- 503 : désactivation, configuration invalide, perte de bail, traitement FAILED/ABORTED/DEADLINE ;
- 401 : authentification invalide, absente ou dupliquée ;
- 400 : identifiant manquant/invalide/dupliqué, paramètres ou corps interdits ;
- 404 : chemin non autorisé ; 405 : méthode non admise ;
- 409 : rejeu d'un UUID admis ou bail occupé, avec code distinct ;
- 429 : cooldown persistant, avec Retry-After ;
- 500 : défaillance technique d'admission ou de finalisation ;
- 200 : résultat structuré du traitement borné.

Les réponses sont privées et non mises en cache. Elles ne révèlent ni jeton interne, e-mail, IP, OTP, document ou secret. Il n'existe pas d'endpoint public de consultation des reçus dans cette étape.

## Limites de cette qualification

Les reçus anti-rejeu ne sont pas purgés en 4B. Leur croissance et leur archivage restent à décider explicitement ; supprimer un reçu sans politique pourrait réautoriser un ancien UUID. Aucun nettoyage actuel ne les supprime automatiquement.

La durée du bail, le cooldown et les budgets sont qualifiés localement, pas sous les pauses, démarrages à froid et pools du futur hébergement. Les parseurs, en-têtes et corps devront aussi être vérifiés à l'ingress réel. Les contrôles coopératifs ne constituent pas une interruption dure à la milliseconde.

Un Cron Vercel natif n'est pas automatiquement compatible avec l'UUID dynamique obligatoire de ce contrat. Aucun UUID constant ne doit être utilisé pour contourner cette règle. Une adaptation de déclenchement distincte devra être conçue et autorisée ; 4B n'installe ni Cron ni pont de confiance implicite.

La rotation du secret est testée avec des valeurs synthétiques. Un remplacement réel sur plusieurs déploiements nécessite une procédure explicite : anciennes instances, désactivation, reçus persistants et vérification de tous les environnements. Aucun secret réel n'est touché ici.

Les limites Linux/Chromium/Prisma, la rétention des intentions et réservations incertaines, les charges importantes et la surveillance externe restent ouvertes. La sous-étape 4C n'est pas commencée.
