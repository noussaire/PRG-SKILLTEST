# Synthèses : correction et validation locale — 5 novembre 2026

## Périmètre

Phase locale uniquement. Aucun déploiement, push Git, changement de modèle Groq,
activation QStash, modification Neon ou ajout de secret de déploiement.
Les tests utilisent des réponses simulées et des bases temporaires locales.

## Fonctionnement

- Le fournisseur simulé est sélectionné par `stagingConfiguration()` : mode
  serveur `synthetic-v1`, configuration de staging valide, absence de clés de
  fournisseurs externes. `simulateSummary()` vérifie aussi le marqueur et les
  identités de la base. Le préfixe `SYNTH-` ne choisit jamais le fournisseur.
- En dehors du staging, le fournisseur Groq existant et son modèle restent
  inchangés. Aucun appel réel à ce fournisseur n'a été effectué pour cette phase.
- `GET /api/v1/adaptive/me` consulte seulement l'entretien et son travail existant.
  Il ne crée plus de travail, ne génère pas de synthèse et ne modifie pas la révision.
  La consultation administrateur reste également sans génération.
- `POST /api/v1/adaptive/me/summary` est le déclencheur explicite : jeton Bearer
  étudiant valide, accès non expiré, 31 réponses et bilan terminé, limitation de
  débit existante. Il attend au maximum une tentative du travail de cet étudiant.
- Le proxy navigateur est `POST /api/adaptive/me/summary?lang=fr` (ou `ar`),
  corps JSON `{}`. Il utilise le cookie privé `sq_interview`, les protections
  d'origine du middleware et un délai de 65 secondes. Aucun bouton, polling
  déclencheur ou appel automatique au chargement n'a été ajouté.
- La dernière réponse continue à créer le travail dans sa transaction existante.
  Une ancienne participation sans travail peut le créer par le POST explicite.
  Ni worker permanent ni QStash ne sont nécessaires à ce POST. Les intentions
  SQL de publication déjà prévues par le schéma restent présentes mais aucun
  transport n'est activé par cette correction.

## Statuts et concurrence

- `PENDING` : travail créé, pas encore pris en charge.
- `PROCESSING` : bail de 60 secondes ; acquisition atomique conditionnée par
  l'identifiant, le statut, le bail précédent et le compteur de tentatives.
- `RETRY` : échec transitoire ; la date de réessai persistée et le refroidissement
  fournisseur sont respectés. Le POST ne boucle pas et ne réinitialise pas cette date.
- `COMPLETE` : JSON français/arabe enregistré ; les consultations le localisent.
  Aucun nouveau traitement lors des appels suivants.
- `UNAVAILABLE` : échec définitif ou plafond atteint. Aucun réarmement automatique.

Le plafond est de **trois acquisitions par travail**, y compris après interruption
et expiration du bail. Un ancien travail déjà à trois tentatives est terminalisé
au prochain traitement éligible sans appel fournisseur. L'upsert ne remet jamais
le compteur à zéro. La sauvegarde finale exige toujours le bail et le compteur
de l'acquisition courante. Suppression/reprise du parcours conservent leurs
protections existantes. Le verrou de révision vérifie désormais aussi l'expiration.

Le bilan déterministe et les 31 observations restent disponibles pour tous les
statuts. Les simulations passent par le stockage habituel (source existante `ai`),
avec un texte indiquant explicitement la simulation sans appel IA.

## PDF et e-mails : traitements distincts

Le modèle partagé bloquait les PDF serveur lorsque la synthèse IA n'était pas
complète. L'option interne `printable` permet désormais les bilans déterministes
terminés, avec un titre et une notice pédagogiques en français/arabe. Les tests
génèrent réellement les PDF locaux, avec les polices et ressources embarquées.

**L'envoi des rapports de secours reste désactivé.** Le modèle e-mail non imprimable,
le sélecteur de la file et sa vérification SQL avant envoi exigent encore `COMPLETE`.
La vue affiche aussi `WAITING_AI` pour les autres statuts lorsque Brevo est configuré.

Correction minimale proposée pour une phase ultérieure : autoriser les rapports
terminés `UNAVAILABLE` dans ces trois contrôles, adapter le statut affiché et les
libellés pédagogiques, conserver consentement, expiration, budget, PDF, bail et
UUID d'idempotence. Ne pas envoyer pendant `PENDING/PROCESSING/RETRY`, afin d'éviter
un envoi de secours suivi d'un second envoi enrichi. L'absence de travail lorsque
aucun fournisseur n'est configuré exige aussi de découpler sa création de la
disponibilité IA si l'on veut couvrir ce cas. Cette proposition n'est pas activée.

## Fichiers applicatifs modifiés

- `backend/src/services/report-summary.service.ts` : choix explicite du fournisseur.
- `backend/src/services/report-queue.service.ts` : disponibilité synthétique,
  absence de réservation Groq en simulation, plafond durable, expiration.
- `backend/src/routes/adaptive.routes.ts` : GET sans écriture, POST unitaire,
  disponibilité du fournisseur dans la configuration publique.
- `backend/src/services/report-email-template.ts` : PDF de secours et libellés.
- `frontend/src/app/api/adaptive/me/summary/route.ts` : proxy POST authentifié.

Tests : `backend/tests/summary-on-demand.test.ts`,
`backend/tests/helpers/local-only-network.mjs`,
`backend/tests/participant-email-native.cases.ts`,
`frontend/tests/adaptive-session.test.ts`.
Le test natif historique du code de session a été aligné sur le comportement
existant : une entrée par code crée aussi un parcours Soft Skills, sans OTP.
Aucun code applicatif OTP, Code de session ou catalogue de questions n'a changé.

## Validation

- Suite backend : **197 réussites, 0 échec, 277 ignorés** sur 474 tests.
  Les tests ignorés requièrent leurs bancs PostgreSQL/PgBouncer dédiés.
- Suite ciblée finale : **6 réussites, 0 échec**, incluant français/arabe,
  quatre POST concurrents, consultation étudiant/administrateur, persistance,
  PDF simulé et de secours, bail actif/expiré, dates de réessai, ancien travail,
  trois échecs successifs, absence de fournisseur externe, expiration et accès invalide.
- Suite frontend : **33 réussites, 0 échec**.
- Banc PostgreSQL natif OTP : **31 réussites, 0 échec**, sans tests ignorés.
  Audit : `output/lot4-946647792edf/native-gp46MS/tests.log` ; arrêt du serveur,
  fermeture du port et suppression de sa base temporaire confirmés dans `shutdown.json`.
- Typechecks backend/frontend et builds backend/frontend : réussis.

Journaux dans `output/summary-phase1-backend-tests.log`,
`output/summary-phase1-targeted-tests.log`, `output/summary-phase1-frontend-tests.log`,
`output/summary-phase1-typecheck.log` et `output/summary-phase1-build.log`.
Le préchargement `local-only-network.mjs` bloque fetch/TCP externes et neutralise
les identifiants fournisseurs ; les tests fournisseurs installent leurs propres mocks.
Les fixtures utilisent uniquement du matériel de test en mémoire, sans nouveau
secret enregistré dans une configuration.

Les essais locaux ne qualifient pas la durée maximale d'une fonction Vercel réelle.
La production devra allouer une durée cohérente avec les 45 secondes du fournisseur,
le bail de 60 secondes et le proxy de 65 secondes, puis être validée séparément.
Toute publication reste soumise à l'autorisation du propriétaire.

## Suite locale autorisée : bouton de génération explicite

Le bouton « Générer la synthèse » / « إعداد الخلاصة » est maintenant présent
dans le bilan étudiant lorsque le fournisseur est disponible et le travail
n'est pas terminal. Il appelle uniquement le POST décrit ci-dessus, sur action
de l'étudiant. Les consultations périodiques existantes restent des GET.

- État d'attente, verrou immédiat contre les doubles clics et maintien du bilan.
- Désactivation pendant le délai `aiRetryAt` ou après une erreur réseau/HTTP,
  sans relance automatique ; prise en compte de `Retry-After`.
- Accès expiré signalé ; aucun bouton de génération pour `COMPLETE`,
  `UNAVAILABLE` ou un fournisseur indisponible.
- Pour `PROCESSING`, « Vérifier la synthèse » utilise le même POST protégé :
  le serveur ne reprend une tentative que si son bail a expiré et son budget le permet.
- Traductions FR/AR, sens RTL, bouton de 44 px minimum, focus clavier,
  messages annoncés et commande masquée à l'impression.
- Les réponses d'une commande démontée lors d'un changement de langue ne sont
  pas appliquées au nouvel écran.

Fichiers de cette suite :
`frontend/src/components/report-summary-action.tsx`,
`frontend/src/app/entretien/soft-skills/page.tsx`,
`frontend/tests/browser-summary-action.mjs`, et ce document.

Validation : **33 tests frontend réussis**, typecheck et build frontend réussis,
**9 scénarios navigateur réussis** avec Next local et Edge headless.
Les API sont interceptées par des fixtures ; les requêtes navigateur externes
sont bloquées. Ce banc valide l'interface ; le stockage et les protections backend
ont été validés séparément lors de la phase 1.
Captures aux largeurs 390/768/1440 en FR et AR, résultats dans
`output/summary-button/results.json`, journaux dans
`output/summary-button-browser-tests.log`, `output/summary-button-frontend-tests.log`
et `output/summary-button-build.log`.
Relance locale après build : `node frontend/tests/browser-summary-action.mjs`.
Aucun changement backend, fournisseur, OTP, catalogue, e-mail ou déploiement
n'est nécessaire pour cette suite.
