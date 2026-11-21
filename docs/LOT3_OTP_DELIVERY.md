# Lot 3 — livraison OTP asynchrone

Date : 30 octobre 2026. Implémentation locale ; aucune migration persistante, aucun appel réel à Brevo, aucun déploiement. Qualification PostgreSQL native toujours en attente. Le lot 4 n'est pas commencé.

## Fonctionnement livré

La demande de reprise enregistre le hash du code et une tâche dans la même transaction. Elle retourne le contrat existant `409 / RETAKE_VERIFICATION_REQUIRED`, enrichi de `deliveryStatus` et d'un délai `Retry-After`. Elle n'attend jamais le fournisseur. Le premier test conserve son comportement sans OTP obligatoire.

Le worker utilise une tâche persistante : identifiant UUID stable, charge utile chiffrée, expiration, prochaine tentative, compteur, bail et jeton de tentative. Une sélection `FOR UPDATE SKIP LOCKED` et le verrou sur la fiche lors de l'enregistrement évitent les doublons locaux. Une demande répétée réutilise le code encore valable d'une tâche en attente ou incertaine. Les anciens codes potentiellement livrés, sans tâche associée, restent utilisables jusqu'à expiration ; aucune migration de données historiques n'est effectuée.

États :

- `PENDING` : tâche enregistrée ou nouvel essai autorisé après un refus temporaire certain.
- `ACCEPTED` : acceptation connue du transport ou acceptation déjà enregistrée dans la réservation de budget. Cela ne prouve pas la réception dans la boîte e-mail.
- `REJECTED` : refus certain, code expiré/épuisé/obsolète, charge utile invalide, ou délai de reprise dépassant la validité du code.
- `UNCERTAIN` : le fournisseur a pu accepter, ou le worker s'est interrompu après le début d'une tentative.

Les états incertains ne sont pas réexpédiés automatiquement. Le code reste valable et une demande de renvoi ne le remplace pas tant qu'il est encore utilisable. Cette règle est plus prudente que la fenêtre documentée d'idempotence fournisseur : elle ne dépend pas d'une promesse de livraison exactement une fois.

Un code ayant épuisé ses cinq essais n'est pas envoyé. Il peut être remplacé sur demande après le délai de renvoi ; les échecs cumulés du lot 2 ne sont jamais remis à zéro.

## Budget et récupération

Le transport existant du lot 2 reste le seul chemin d'envoi. Chaque tentative autorisée utilise le même UUID et la même charge utile, donc la même réservation. Le worker ne réserve pas une seconde fois lors d'une reprise. Les plafonds, la marge autres usages, les compteurs et le coupe-circuit partagé sont conservés.

- Réponse 429 certaine : respect du délai fournisseur ; reprise bornée par l'expiration et six tentatives maximum.
- Quota : coupe-circuit commun aux OTP et rapports ; aucun nouvel essai OTP si l'attente dépasserait sa validité.
- Timeout, réponse perdue, réponse 5xx ou acceptation mal formée : état incertain, conservation du code et du budget, aucun renvoi automatique.
- Interruption avant réservation de budget : tâche récupérable après le bail, car aucun transport n'a pu commencer via le chemin autorisé.
- Interruption après acceptation persistée : réconciliation locale vers ACCEPTED sans appeler le fournisseur.
- Réponse tardive d'un ancien worker : le jeton de tentative empêche d'écraser l'état du nouveau propriétaire. Une acceptation persistée dans le budget est réconciliée ensuite.

Le bail dure 120 secondes. Le traitement périodique reprend les tâches récupérables après redémarrage ; les tentatives incertaines restent arrêtées pour éviter les doubles envois. Une réconciliation avec les journaux réels du fournisseur ne fait pas partie de ce lot et n'a pas été effectuée.

## Protection de la charge utile

Le code et le message nécessaires à la livraison sont chiffrés avec AES-256-GCM, une clé dérivée avec séparation de domaine du secret serveur existant, et l'identifiant de tâche comme données authentifiées. Aucun secret serveur n'est écrit dans la tâche. Le code reste uniquement sous forme de HMAC dans la participation.

La charge utile chiffrée est supprimée à l'acceptation ou au refus final, et purgée après expiration pour les autres états. Le nettoyage continue même si la configuration d'envoi est retirée. Il nécessite que le worker et sa base soient disponibles. Les métadonnées et réservations ne sont pas effacées automatiquement.

Le secret doit rester stable pendant la courte durée de vie des tâches. Une rotation nécessite une stratégie explicite ; une charge utile devenue indéchiffrable est refusée sans transport.

## Délais HTTP

- Démarrage frontend : **12 secondes**, auparavant 65.
- Attente d'une connexion transactionnelle : **2 secondes**.
- Transaction : **5 secondes**, avec délai SQL local de **4 secondes**.
- Transport OTP dans le worker : **8 secondes**.
- Transport des rapports : **20 secondes**, conservé.

La requête navigateur est découplée du transport. Les délais transactionnels bornent le travail concerné, sans prétendre annuler tout accès initial à une base indisponible. Une expiration HTTP n'annule pas une tâche déjà commitée ; une nouvelle demande réutilise la tâche existante. Le frontend conserve les réponses d'erreur et cookies existants. Les composants, pages et traductions FR/AR ne sont pas modifiés.

## Qualification et tests

Toutes les migrations et données de test concernent des bases PGlite éphémères ou des destinations synthétiques construites par le banc. Aucun DATABASE_URL réel n'est utilisé pour migrer. Les appels fournisseur sont simulés ; le garde réseau refuse les fetch externes non simulés.

La suite OTP couvre : enregistrement sans réseau, chiffrement et intégrité, demandes et workers concurrents disponibles sur PGlite, budgets et rapports conservés, coupure après acceptation possible, utilisation du code après coupure via l'API, 429, quota, refus définitif, 5xx, acceptation mal formée, timeout, interruption avant réservation, interruption après acceptation persistée, réponse tardive, expiration, retrait de configuration et épuisement des essais. Une migration sur des fiches synthétiques peuplées et son retrait/réapplication en mémoire préservent les rapports et sessions administrateur.

Les trois tests PostgreSQL natifs du lot 2 sont conservés et obligatoires. Aucun serveur, processus ou service PostgreSQL utilisable n'a été trouvé par les vérifications locales ; aucun écouteur sur le port standard 5432 ni outil serveur accessible n'a été trouvé. Le répertoire Docker observé n'a fourni aucun exécutable utilisable. Aucune installation, aucun démarrage de service existant et aucun changement système n'ont été forcés.

Ces trois tests sont donc explicitement **ignorés / en attente**, et ne sont pas remplacés par les essais PGlite : concurrence entre connexions distinctes sur le dernier crédit, fencing des transitions et persistance après redémarrage du serveur natif. Leurs conditions et le cluster temporaire propriétaire restent définis dans `email-budget-postgres.test.ts`.

Résultats exacts et empreintes :

Dernière exécution : **64 réussites backend, 12 réussites frontend, aucun échec ; 3 tests PostgreSQL natifs ignorés et maintenus en attente**. Les contrôles TypeScript backend/frontend et la validation du schéma Prisma réussissent.

- `output/lot3-rollback-6f44523a33/backend-results.txt`
- `output/lot3-rollback-6f44523a33/frontend-results.txt`
- `output/lot3-rollback-6f44523a33/verification.json`
- `output/lot3-rollback-6f44523a33/changes.json`

Les tests navigateur complets n'ont pas été exécutés. Le scénario existant a été adapté pour piloter explicitement le worker simulé. Les contrôles TypeScript backend et frontend sont exécutés sans génération de code ni cache de construction.

## Fichiers et retour arrière

Fichiers applicatifs modifiés : schéma Prisma, service de reprise, transport Brevo, bornes transactionnelles du budget, démarrage/arrêt du worker, route backend start, délai de la route frontend start. Les tests adaptatifs et le scénario navigateur sont adaptés au traitement asynchrone.

Fichiers créés : migration additive outbox, module de chiffrement OTP, service de file OTP, tests de livraison et de migration OTP, tests HTTP frontend et ce rapport.

Le dossier `output/lot3-rollback-6f44523a33` contient les copies préalables, le manifeste et les journaux. Aucun `.env` n'y est copié. Les migrations antérieures restent inchangées. Pour un retour local avant migration persistante, vérifier les empreintes puis restaurer seulement les fichiers modifiés et retirer seulement les nouveaux fichiers identifiés, après revue des changements intervenus entre-temps. Aucun retour arrière automatique n'est exécuté.

Après une éventuelle application ultérieure, conserver les structures additives et drainer les tâches avant tout retour applicatif : revenir au transport synchrone sans coordination pourrait invalider des codes ou créer des doublons. Ne jamais supprimer les réservations pour libérer artificiellement du quota.

## Limites restantes et préparation du lot 4

La qualification finale demeure en attente des tests PostgreSQL natifs. Le comportement exact de Brevo n'est pas vérifié sur un compte réel ; aucun envoi d'essai n'est autorisé par ce lot.

Les interfaces restent inchangées et n'affichent pas les nouveaux états détaillés : elles utilisent le formulaire et les messages existants. L'administration n'a pas de nouvelle commande de réconciliation. Une requête déjà confiée au fournisseur ne peut pas être rappelée. L'origine réseau reste celle du pair TCP, donc souvent le proxy commun. Les métadonnées ont besoin d'une politique de rétention.

Plan proposé pour le lot 4, sans implémentation :

1. Lever le blocage de qualification PostgreSQL avec un environnement isolé disponible, sans toucher aux services ni bases existants.
2. Préparer le challenge OTP initial sans réserver une adresse non vérifiée ni modifier rétroactivement les étudiants existants.
3. Réutiliser le budget et l'outbox validés pour créer la participation et son accès seulement après vérification, avec consommation atomique du challenge.
4. Réduire l'énumération par les réponses publiques et préparer, sous validation distincte, la présentation FR/AR des états d'attente et d'incertitude.
5. Tester le parcours historique, la reprise, les rapports et l'authentification administrateur avant toute autre activation.
