# Architecture 0.2.0

## Frontière d'authentification

Le navigateur appelle les routes API Next.js. Elles lisent les cookies `sq_admin` et `sq_guest` HTTP-only, puis transmettent un Bearer au backend Express. Les jetons bruts ne sont pas renvoyés au JavaScript du navigateur. Express stocke leur hachage SHA-256.

Le middleware Next.js vérifie l'origine des écritures, le type de contenu et les requêtes intersites. `PUBLIC_APP_ORIGIN` est l'origine publique exacte. Express vérifie les rôles sur toutes les routes administrateur. Les jetons invités expirent et peuvent être révoqués côté serveur.

## Brouillons et publication

- `Mission.draftGraph` contient le brouillon éditable ; `editRevision` empêche un écrasement concurrent.
- Une publication prend un verrou sur la mission, vérifie la révision et valide le graphe.
- Elle crée de nouveaux nœuds et choix avec `graphVersion` ; les anciens enregistrements restent présents pour les clés étrangères et l'historique.
- Elle crée un nouvel instantané `MissionVersion` par insertion. Aucun upsert ne réécrit une version publiée.
- Un déclencheur PostgreSQL refuse les UPDATE et DELETE des versions publiées.
- Une tentative garde `missionVersion`. Affichage, transitions et évaluation utilisent ce même instantané.
- Chaque décision conserve ses impacts et son contexte textuel.

Les métadonnées éditables de `Mission` ne changent pas les métadonnées de ses versions déjà publiées. Une mission publiée ne peut pas être déplacée vers une autre évaluation ; la duplication permet de préparer une autre mission.

## Sessions et concurrence

Les inscriptions verrouillent la ligne de session avec `SELECT ... FOR UPDATE`, puis relisent statut, dates et capacité avant de créer le participant dans la même transaction. Les décisions verrouillent la même ligne ; les UPDATE administrateur sont sérialisés par PostgreSQL sur cette ligne.

La mise à jour d'une tentative est conditionnelle sur son nœud courant et son statut. Deux réponses concurrentes ne peuvent pas créer deux décisions.

La fenêtre est `[opensAt, closesAt[`. Le contrôle est réalisé sur chaque inscription et décision. Une session programmée avec une date de début atteinte est utilisable même si le minuteur n'a pas encore actualisé son statut. Le serveur actualise les statuts toutes les 30 secondes ; la politique à la requête reste la référence.

## Résultats

Un service commun produit les rapports et indicateurs utilisés par les vues étudiant, participant administrateur, tableau de bord et statistiques collectives. Les anciennes compétences `collaboration`, `organisation`, `empathie` sont interprétées avec leurs identifiants standard correspondants. Les instantanés historiques restent conservés.

Chaque compétence affiche la moyenne de ses impacts observés, de −3 à +3, et le nombre de décisions qui l'ont sollicitée. Une dimension non observée n'est pas interprétée comme une compétence nulle. Les profils nécessitent au moins quatre décisions et deux observations par dimension concernée ; ces seuils sont des règles pédagogiques exploratoires, pas des seuils validés scientifiquement.

Les moyennes collectives portent sur les tentatives terminées et sur les moyennes individuelles, afin de ne pas surpondérer les parcours longs. Trois étudiants au minimum sont nécessaires pour afficher une dimension. Une distribution de profils contenant un effectif inférieur à trois est masquée intégralement.

## Limites

Une tentative couvre une mission. La conservation des données et les éventuelles demandes de suppression restent sous la responsabilité de l'organisateur. Les limites de débit en mémoire nécessitent un stockage partagé pour plusieurs instances. Les tests embarqués ne remplacent pas un test de charge PostgreSQL natif.
