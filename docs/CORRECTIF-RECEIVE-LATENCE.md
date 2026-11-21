# Receive : défaut transactionnel reproduit, correctif local uniquement

## Résultat technique

Le parcours valide de receive réalise **59 échanges SQL séquentiels** sur la fixture native : audits synthétiques répétés, verrous, SAVEPOINT, préparation du job, budget, capture simulée et reçu. L'adaptateur réutilise bien une seule connexion et transforme les transactions imbriquées en SAVEPOINT ; les timeouts fournis par les appels internes ne créent pas de nouveaux budgets Prisma indépendants. Le budget externe de 5 secondes couvre l'ensemble du parcours, y compris l'attente des échanges côté client.

Un nouveau test sur PostgreSQL 17.11 natif et Prisma réel ajoute 100 ms de latence client à chaque échange SQL, sans transaction concurrente, HTTP fournisseur ou modification de timeout serveur. Avec l'ancienne limite de 5 s, le service échoue en P2028 et toute la transaction est annulée. Avec le même job fictif, les mêmes clés/proof et une limite externe de 15 s, il termine avec COMPLETE. Cela démontre un défaut de robustesse à la latence, pas un deadlock systématique ni un défaut HMAC.

La latence est injectée par un proxy de test avant chaque appel SQL réel. Ce n'est pas une mesure de RTT Neon. Les erreurs et rollbacks proviennent du vrai moteur Prisma/PostgreSQL, pas d'un faux client de base. Les cas de concurrence existants utilisent deux connexions physiques indépendantes et restent passants.

## Mesures finales

Run : `output/otp-native-qualification/run-DukP2L`.

- Contrôle ancien budget : 5 000 ms, P2028 après 5 226 ms observées dans le callback, 48 échanges tentés, zéro tentative et reçu conservés.
- Service corrigé, sans override du timeout dans le test : 15 000 ms, COMPLETE après 6 458 ms, 59 échanges, une capture, une réservation acceptée, une tentative et un reçu.
- 21 tests PostgreSQL natifs PASS ; aucun appel HTTP externe tenté.
- Typecheck backend/tests PASS ; compilation backend PASS.

Un premier run avant correction (`run-FM4uqD`) avait déjà reproduit le défaut : 5 274 ms puis réussite à 6 460 ms avec le seul override de budget dans la fixture. Le run final vérifie la vraie version locale corrigée, en conservant l'ancienne limite comme contrôle de non-régression.

## Correctif minimal

Seul changement de comportement dans `backend/src/services/synthetic-otp-receive.service.ts` : timeout Prisma de la transaction synthétique externe **5 000 → 15 000 ms**. Aucun changement du mode ReadCommitted, du maxWait de 2 s, des statement_timeout (2 s initialement, 4 s dans le worker), de l'expiration challenge/job, des verrous, du budget e-mail, de l'identité ou des preuves HMAC. Aucun retry ajouté. Les nouvelles attentes SQL ne sont pas rendues illimitées. La durée maximale de détention des verrous peut toutefois atteindre 15 s au lieu de 5 s : c'est le coût borné du correctif.

Le test nouveau se trouve à la fin de `backend/tests/synthetic-otp-publication.native.cases.ts`. Le contexte et les fixtures sont réservés à un cluster local nouvellement créé et vérifié physiquement. Les anciens dossiers PostgreSQL de récupération ne sont jamais utilisés par ce test.

La copie candidate `output/receive-otp-final-candidate` et le paquet Preview préparé précédemment n'ont PAS reçu le correctif : ils conservent le délai de 5 s. Ne pas les considérer comme une version corrigée ni les déployer tels quels pour valider cette modification. Aucun commit, projet, déploiement ou secret distant n'a été créé.

## Portée de la preuve

L'incident Vercel du 9 novembre (503 en 6,42 s, attempts=0, receivedAt=NULL, challenge encore valide) est compatible avec ce mécanisme. Il n'est pas possible de démontrer rétrospectivement que son exception était P2028 avec le seul statut HTTP, car le catch du commit publié efface la distinction entre plusieurs erreurs. La mesure locale de 6,458 s n'est pas une mesure du déploiement et sa proximité avec 6,42 s n'est pas une preuve d'identité de cause.

Il existe désormais un défaut démontré et un correctif reproduit localement ; aucune nouvelle série d'inventaires ou d'inspections de logs n'est nécessaire pour établir ce défaut. Une confirmation sur le runtime Vercel reste une opération distincte à autoriser. Aucun correctif de sécurité ou de budget ne doit être déduit de cette preuve.
