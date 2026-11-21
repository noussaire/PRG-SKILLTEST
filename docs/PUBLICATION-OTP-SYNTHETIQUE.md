# Publication exclusive d'un OTP synthétique — correctif local

Complément local : [réception OTP liée à la publication](RECEIVE-OTP-SECURITE.md).
La nouvelle liaison doit être créée par le backend candidat avant la réception ;
les captures de l'ancien backend `6b9e1a0` sont refusées. Le nouveau contrat de
`receive` exige également le challenge et l'identité. Aucun changement distant
n'est effectué par cette préparation.

## Résultat

Aucun mécanisme existant ne permettait une publication ciblée. `publishBatch(..., 3)`
choisit dans la file globale ; même `publishBatch(..., 1)` ne garantit pas le bon job.
`/jobs/run` cible l'exécution, pas la publication, et n'est pas utilisé comme substitut.

Le correctif ajoute `POST /api/internal/synthetic/notifications/publish-otp`.
Il n'est **pas déployé**. Aucune opération n'a été exécutée en production.
L'ancienne route globale reste inchangée ; le lanceur continue à la refuser.

Le corps est un objet strict contenant exactement :

```json
{
  "jobId": "UUID du job OTP initial",
  "challengeId": "UUID du challenge de ce formulaire",
  "notificationId": "UUID de son intention de publication active",
  "fullName": "SYNTH-Participant",
  "email": "adresse exacte du participant en @example.test"
}
```

Les UUID sont des métadonnées. Aucun mot de passe, token, OTP ou secret n'entre
dans ce corps. Les tableaux, listes de jobs, limites, propriétés supplémentaires,
rapports et OTP de reprise ne sont pas acceptés. La réponse confirme les trois
UUID et `published: 1`, sans adresse ni contenu du message.

## Validations et transaction

La nouvelle branche passe par les protections communes existantes du routeur :
POST JSON brut borné, `synthetic-v1`, preuve cryptographique liée au corps et au
Bearer, session ADMIN synthétique, base marquée et exclusivement synthétique,
horodatage, anti-rejeu et plafond d'invocations. Le service revérifie le mode et
la base, même s'il est appelé directement.

Dans une transaction bornée, le service verrouille le gate, le challenge, le job
et l'intention **exacts**, puis vérifie :

- le challenge `INITIAL` est actif pour l'identité dérivée de l'adresse fournie,
  non consommé, non expiré et sous son plafond d'essais ;
- le job est rattaché au challenge, possède le même codeHash et reste `PENDING`,
  non expiré, sans bail actif, sous son plafond d'essais et avec son payload ;
- l'intention désignée appartient à ce job en `OTP_INITIAL` / `DELIVER`, est
  `PENDING`, due, sans bail actif, et correspond à la génération/date de
  `JobPublicationReady`, avec moins de 24 publications cumulées ;
- aucune réservation e-mail `ACCEPTED`/`UNCERTAIN` ni capture de notification
  existante n'autorise une republication ;
- le payload chiffré existant, déchiffré uniquement en mémoire côté serveur,
  confirme l'adresse synthétique et le nom exact `SYNTH-Participant`.

Le déchiffrement interne utilise le mécanisme OTP existant. Il ne renvoie ni
ne journalise le code, le payload, le hash ou les clés. Il ne consulte aucun
secret depuis Neon pour configurer le lanceur.

L'intention exacte est passée à `PUBLISHED`, son compteur est incrémenté et le
`SyntheticQstashPublisher` existant capture la notification dans **la même
transaction**. Tout échec entraîne le rollback des deux opérations. Le transport
est uniquement synthétique, sans factory fournisseur réel et sans HTTP externe.
Les fixtures de panne synthétique restent prises en compte ; dans cette route
transactionnelle, même une panne simulée après capture annule toute la transaction.

La publication ne livre pas l'OTP : le job reste en attente jusqu'à la réception
ciblée normale. Les autres intentions, jobs et curseurs globaux ne sont pas traités.
Un second appel sur la même intention est refusé, sans seconde capture. Une erreur
ou un timeout n'autorise aucune reprise aveugle : vérifier les métadonnées avant
toute nouvelle action. Chaque appel HTTP peut tout de même inscrire son nonce
dans `SyntheticInvocation`, conformément au protocole existant.

## Tests locaux

Résultat de cette préparation : **24 tests réussis, zéro échec, zéro ignoré**
(14 pour le lanceur et 10 pour le service/route). Vérification TypeScript
`tsc --noEmit -p backend/tsconfig.tests.json` réussie.

Depuis la racine, Node 24 et les dépendances déjà installées :

```powershell
node --loader ./backend/tests/helpers/local-typescript-loader.mjs --test backend/tests/synthetic-otp-publication.offline.ts backend/scripts/synthetic-admin-launcher.test.mjs
node node_modules/typescript/bin/tsc --noEmit -p backend/tsconfig.tests.json
```

Le loader est réservé à cette suite hors ligne. Il transpile en mémoire et
remplace le module Prisma par un adaptateur de test explicite ; il ne doit jamais
être utilisé pour démarrer l'application. Le schéma SQL existant est chargé
uniquement dans PGlite en mémoire. Aucun schéma distant n'est migré, aucun DSN
Neon n'est fourni. Tout appel HTTP fournisseur est bloqué. Le test HTTP utilise
un serveur loopback et une session ADMIN de fixture.

Les tests couvrent les six cas demandés : autorisé, autre participant, déjà traité,
expiré, intention inexistante et publication multiple. Ils vérifient aussi les
UUID croisés, le nom authentifié, le challenge consommé, le rollback, le mode
désactivé, les clés fournisseurs interdites, l'authentification ADMIN, la preuve,
l'anti-rejeu et l'absence de fallback vers le batch ou l'exécution directe.

La première suite ci-dessus utilise PGlite. La qualification complémentaire est
maintenant réalisée sur PostgreSQL natif 17.11 local et jetable, avec deux connexions
physiques indépendantes : **10 tests natifs réussis**, en plus des 24 tests locaux.
Voir [les résultats et preuves natives](QUALIFICATION-OTP-POSTGRES-NATIF.md).
Cette qualification ne constitue pas une validation Neon/PgBouncer ou Vercel.

## Utilisation future après autorisations

1. Autoriser et effectuer séparément le déploiement backend décrit plus bas.
2. Vérifier le déploiement actif, le marqueur et les variables existantes du mode
   synthétique, sans afficher les secrets ni les modifier.
3. Dans le formulaire normal, conserver la session de `SYNTH-Participant`, son
   adresse synthétique exacte et le `challengeId` de sa demande OTP. Obtenir par
   la requête de métadonnées documentée dans `SYNTHETIC-OPERATOR-LOCAL.md` le job
   et l'intention active correspondants. Aucune extraction de contenu sensible.
4. Après autorisation des écritures applicatives, publier avec la commande suivante.
   Les trois déclarations locales de mode et l'ID d'installation doivent déjà être
   configurés selon le guide du lanceur. Saisir personnellement le secret existant
   et le mot de passe connu dans les invites masquées, jamais en arguments.

```powershell
node backend/scripts/synthetic-admin-launcher.mjs publish-otp <ADRESSE_EXAMPLE_TEST> <JOB_UUID> <NOTIFICATION_UUID> <CHALLENGE_UUID> --authorized-production-writes --confirmed-synthetic-deployment
```

5. Continuer seulement sur `TARGET_OTP_PUBLISHED`. Utiliser ensuite `receive` sur
   **le même** job et la même notification, puis `mail` pour le même job, selon
   le guide existant. Ces deux commandes restent séparées et ne sont jamais lancées
   automatiquement après la publication.
6. Consulter personnellement la vue privée locale et saisir le vrai OTP dans le
   formulaire d'origine avant expiration. Poursuivre normalement le questionnaire.
   Aucun statut de vérification, compteur ou mot de passe n'est modifié manuellement.

Si la route n'existe pas encore, si une cible diffère ou si la réponse annonce plus
d'une publication, le lanceur s'arrête sans retry ni appel global. La fenêtre OTP
n'est pas prolongée par le correctif. Un challenge expiré nécessite un nouveau
parcours normal explicitement autorisé.

## Plan de déploiement éventuel — non exécuté

1. Relire le diff local et l'appliquer sur la révision backend effectivement
   déployée, après identification de sa source Git. Ne pas déployer indistinctement
   l'ensemble du dossier de travail ; plusieurs exports et états y coexistent.
2. La qualification des verrous/concurrences PostgreSQL natifs locaux est réussie
   sur le code courant. Rejouer les suites et le build sur le candidat exact si
   son code diffère. Aucun test ne doit utiliser Neon.
3. Soumettre le candidat exact à autorisation pour push/déploiement backend.
   Aucun changement frontend, schéma, migration, secret ou variable Vercel n'est
   nécessaire pour ce correctif, sous réserve des prérequis déjà présents.
4. Après autorisation, déployer uniquement le backend candidat, puis confirmer
   sa révision active. La version frontend annoncée reste inchangée.
5. Demander une autorisation distincte pour le parcours OTP ciblé : connexion,
   nonces, publication, réception, capture et validation sont des écritures
   applicatives, même en simulation. Pas de connexion préalable automatique.
6. En cas de problème, suspendre le parcours et revenir au déploiement backend
   précédent par la procédure autorisée. Aucun rollback SQL ou reset du challenge
   n'est requis par ce correctif. Un rollback de code n'annule pas une publication
   déjà validée ; le lanceur refusera la route absente sans fallback.

Préparation et vérifications réalisées avec les dépendances locales : 0 DH.
Aucune ressource cloud, aucun push, déploiement, fournisseur réel ou secret modifié.

## Fichiers concernés

- [Service ciblé ajouté](../backend/src/services/synthetic-otp-publication.service.ts).
- [Route synthétique modifiée](../backend/src/routes/synthetic-staging.routes.ts).
- [Signature de type du contrôle DB élargie aux transactions](../backend/src/security/synthetic-staging.ts).
- [Types du transport synthétique compatibles avec les transactions](../backend/src/services/synthetic-providers.service.ts).
- [Lanceur adapté](../backend/scripts/synthetic-admin-launcher.mjs).
- [Tests du lanceur complétés](../backend/scripts/synthetic-admin-launcher.test.mjs).
- [Suite SQL/HTTP hors ligne ajoutée](../backend/tests/synthetic-otp-publication.offline.ts).
- [Loader de tests hors ligne ajouté](../backend/tests/helpers/local-typescript-loader.mjs).
- [Guide du lanceur actualisé](SYNTHETIC-OPERATOR-LOCAL.md).
- Ce document : proposition réalisée localement, résultats et plan non exécuté.
