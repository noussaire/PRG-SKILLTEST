# Étape 3D — adaptateur QStash simulé

Qualification locale uniquement. Aucun compte QStash, transport externe, ordonnanceur serverless ou déploiement n'est activé.

## Architecture

PostgreSQL demeure la source de vérité : la transaction métier crée le job et son intention. `JobPublications.publishBatch()` revendique les intentions par bail et jeton de tentative, puis appelle un `JobPublisher` injecté. `QstashPublisher` implémente cette interface sans dépendance à la logique métier. Son transport obligatoire porte le mode `simulated` et ne possède aucun repli vers `fetch`. Aucun assemblage automatique n'est installé dans le serveur.

La requête de publication préparée utilise `/v2/publish/{destination}`, une destination HTTPS canonique, une clé de déduplication égale à l'UUID stable de notification, trois reprises et un délai fournisseur de 90 secondes. Ces paramètres sont une préparation, pas une qualification du service réel. Une réponse sans confirmation explicite reste un échec de publication. Une réponse perdue laisse l'intention reprenable ; la déduplication PostgreSQL reste nécessaire indépendamment de celle du fournisseur.

Le corps contient exclusivement `version`, `notificationId`, `kind`, `jobId`, `phase`, `generation` et `dueAt`. Les champs supplémentaires sont refusés. Aucun OTP, e-mail, jeton étudiant ou PDF n'y figure.

Le callback backend `POST /api/internal/jobs/qstash` reçoit le corps brut avant le parseur JSON global. La vérification officielle `Receiver` de `@upstash/qstash` 2.12.1 est utilisée avec les deux clés dédiées et `devMode:false`. Aucun HMAC Next.js, en-tête IP ou identifiant de message non signé ne vaut authentification QStash.

Après authentification, tous les champs doivent correspondre à une intention PostgreSQL persistante. Seule son activation actuelle peut appeler `processJob({kind, jobId, phase})`. Les travailleurs existants conservent leurs transactions, revendications atomiques, baux, jetons et réservations Brevo. Les anciennes activations, jobs supprimés et jobs terminés sont sans effet dangereux. Une notification valide n'accorde aucun crédit supplémentaire et ne change pas l'identité réseau du participant.

## Vérification du callback

- Corps exact UTF-8, taille maximale 8 Kio, JSON obligatoire, compression refusée.
- JWT signé HS256, clés courante et suivante distinctes ; vérification SDK de la signature, de l'émetteur, du hash du corps, de l'URL destinataire et des dates.
- URL attendue issue de la configuration, jamais de `Host` ou d'en-têtes transférés ; chemin exact, HTTPS, sans paramètres ni fragment.
- `iat`, `nbf`, `exp` et `jti` obligatoires ; fenêtre maximale de 300 secondes, tolérance SDK nulle, avance `iat` maximale de 5 secondes.
- Signature absente ou incorrecte : 401 avant tout traitement métier. Corps authentifié incorrect : 400. Intention absente ou incohérente : 409. Erreur technique : 500. Désactivation : 503.
- Job occupé ou différé : 503 avec `Retry-After: 30`. État terminal, obsolète, expiré ou supprimé : acquittement 200 avec disposition explicite. `UNCERTAIN` ne déclenche aucun renvoi automatique d'OTP.

Un JWT authentique rejoué pendant sa validité peut être reçu plusieurs fois : il est traité comme une notification répétée idempotente. Il n'existe pas de nouveau registre de nonces JWT. La protection contre les effets répétés repose sur les intentions et les revendications PostgreSQL ; les nonces du protocole Next.js restent indépendants et inchangés.

Une publication confirmée, une notification reçue, un job terminé et un e-mail accepté par le fournisseur sont quatre événements distincts. Aucun de ces événements ne prouve la réception dans la boîte du destinataire. Un HTTP 200 `UNCERTAIN` signifie notamment arrêt des reprises automatiques dangereuses, pas livraison réussie.

## Configuration et activation future

Par défaut, le callback est désactivé. Pour les seuls essais locaux synthétiques :

- `SKILLQUEST_QSTASH_MODE=simulated` et `NODE_ENV=test` ou `development` ;
- `QSTASH_CURRENT_SIGNING_KEY` et `QSTASH_NEXT_SIGNING_KEY`, dédiées, distinctes et différentes des secrets Next.js/OTP ;
- `QSTASH_CALLBACK_URL`, URL HTTPS canonique du backend, chemin `/api/internal/jobs/qstash`.

`NODE_ENV=production` ou `VERCEL=1` interdit ce mode. Le mode `real` n'est pas implémenté. Aucune valeur réelle n'a été ajoutée aux fichiers d'environnement. Les fixtures de tests utilisent uniquement des clés synthétiques.

Le futur assemblage du publisher devra fournir explicitement son token, l'origine QStash autorisée et cette URL. Il n'existe actuellement aucune lecture automatique de token ni connexion. Prévoir à terme `QSTASH_TOKEN` et une origine régionale contrôlée côté backend exclusivement ; aucune variable `NEXT_PUBLIC_*`. Le frontend et le backend Vercel étant deux projets distincts, le callback vise le domaine stable du backend. Ne jamais réutiliser le secret HMAC frontend → backend.

Une interruption avant confirmation de publication est reprise par les intentions persistantes et leur backoff. Les baux expirés permettent une nouvelle revendication ; les réponses tardives ne peuvent acquitter un nouveau jeton. Le rattrapage borné existant peut réarmer les jobs sûrs et annuler les intentions obsolètes. En localhost, les workers restent utilisables sans QStash. En serverless, aucun déclencheur durable de publication ou de rattrapage n'est encore connecté : la livraison immédiate n'est donc pas garantie.

## Vérifications obligatoires avant un staging réel

1. Autoriser séparément le transport réel et l'activation de production ; séparer clés, base synthétique, compte fournisseur, domaines et quotas du staging.
2. Vérifier avec de vraies notifications la provenance, l'encodage des clés, les claims, la durée de validité et les deux clés de rotation. Conserver les anciennes clés tant que des notifications signées avec elles peuvent encore être livrées. Ne retirer aucune clé OTP encore nécessaire aux jobs persistants.
3. Vérifier que Vercel préserve le corps brut, l'en-tête de signature et l'URL attendue ; tester domaines personnalisés, protections de déploiement et absence de redirection. Toute exception à la protection de déploiement doit rester limitée au callback et conserver la signature obligatoire.
4. Qualifier l'URL de publication encodée, l'origine régionale, les confirmations, la déduplication, les délais, les reprises, le traitement des HTTP 409/429/500/503 et de `Retry-After` avec le fournisseur réel.
5. Dimensionner le délai de fonction, les baux, le traitement PDF et les connexions PostgreSQL. Le délai préparé de 90 secondes ne garantit pas que le plan Vercel choisi le permet. Qualifier Chromium et le moteur Prisma sous Linux ; les PDF locaux Windows ne le prouvent pas.
6. Connecter un déclenchement durable et un rattrapage surveillé, avec alerte sur âge des intentions, jobs bloqués, baux expirés et états incertains. Tester panne prolongée, OTP de dix minutes, anciens déploiements et consommateurs compatibles avec la version 1.
7. Qualifier les limites et coûts des plans réellement retenus, les restrictions de l'ingress et la volumétrie. Une simulation locale n'est pas une attestation de provenance ou de disponibilité en production.

Références du protocole : [sécurité QStash](https://upstash.com/docs/qstash/features/security), [publication HTTP](https://upstash.com/docs/qstash/api-reference/messages/publish-a-message), [Receiver officiel](https://github.com/upstash/qstash-js/blob/main/src/receiver.ts). Les tests utilisent le SDK épinglé et un signataire de fixtures indépendant fondé sur `node:crypto`.
