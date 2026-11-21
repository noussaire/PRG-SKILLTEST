# Reprise bornée de l'admission SQL

Changement local uniquement, sans migration ni changement de configuration.

`acquireDispatchAdmission()` autorise deux transactions au maximum. La seconde
n'est ouverte qu'après rejet de la première transaction Prisma (rollback),
et uniquement pour SQLSTATE 40001, 40P01 ou 55P03. Le code est lu dans
`P2010.meta.code` ou directement dans `error.code`, jamais dans le texte du message.
L'attente aléatoire de 100 à 250 ms est attendue et annulable. Aucune promesse
de reprise ne continue en arrière-plan.

Les deux transactions et l'attente partagent une instance MaintenanceControl :
budget 5000 ms, statement_timeout et maxWait plafonnés à 1500 ms,
lock_timeout plafonné à 500 ms. Les plafonds diminuent avec le budget restant.
Les autres utilisateurs de MaintenanceControl gardent leurs limites par défaut.
Ce budget reste coopératif : un transport ou rollback bloqué peut prolonger
la durée murale, sans autoriser une nouvelle tentative après expiration.

L'UPDATE d'admission est conservé, ainsi que le jeton, le bail de 30 secondes,
l'espacement de 10 secondes, les contrôles de bail, le nettoyage conditionnel,
les limites de publication et les permissions fournisseurs. Une réussite
d'admission est validée normalement ; les tâches ne sont traitées qu'ensuite.
Une admission rejetée ne modifie ni les tâches OTP ni les quotas de publication.

Un P2010 sans SQLSTATE reconnu, 57014 (annulation), une erreur permanente,
une erreur de connexion ambiguë ou DISPATCH_BUSY ne sont pas repris automatiquement.
Un signal d'annulation et l'expiration du budget interrompent la reprise.
Les diagnostics existants affichent le SQLSTATE assaini s'il est disponible,
sans le message SQL ni les autres métadonnées.

## Validation locale

- `npm.cmd run build` dans backend : compilation réussie.
- `npm.cmd run typecheck` dans backend : vérification TypeScript réussie.
- 43 tests réussis dans les suites admission-retry, admission-timeouts,
  dispatch-diagnostic, provider-mode et health-dispatch-preflight.
- Les 25 nouveaux tests couvrent les trois codes temporaires, deux échecs,
  les erreurs permanentes/inconnues/ambiguës, l'annulation avant et pendant
  la transaction ou l'attente, le budget partagé, deux admissions concurrentes,
  la conservation des tâches et quotas simulés et une invocation ultérieure.

La commande habituelle est `node --import tsx --test tests/job-dispatch-admission-retry.test.ts`
dans backend. Dans cet environnement Windows, tsx échoue dans os.userInfo avant
de charger les tests. La validation a donc utilisé les tests compilés avec tsc
et le lanceur natif Node. Un résolveur temporaire a conservé le chemin du module
shared/network-proof.mjs pour les tests preflight ; aucun source n'a été changé
pour ce contournement. Les fichiers temporaires ont ensuite été supprimés.

La concurrence et les rollbacks sont simulés : cette validation ne qualifie pas
le comportement de Prisma/PostgreSQL en production. Aucun OTP n'est créé et
aucun fournisseur réel ni base externe n'est appelé par ces tests.

La reprise ne répare pas une erreur SQL permanente. Elle ajoute au maximum une
transaction et 100–250 ms d'attente si le budget le permet. Après deux échecs,
les tâches persistées restent récupérables lors d'une invocation ultérieure,
sous réserve de leur expiration et des protections existantes. Aucun ordonnanceur
ni mécanisme de réveil autonome n'est ajouté.
