# Réparation du chargement du tableau de bord — 29 octobre 2026

Les URL CSS et JavaScript signalées ont été contrôlées après redémarrage du serveur de production : toutes répondent HTTP 200 avec le type MIME attendu. Le serveur écoute sur localhost:3000. Les messages GmailAcrobatFteCoachmark/showOneChild concernent des scripts d’extension ; ils ne sont pas présents dans le code de SkillQuest.

Un second problème empêchait le démarrage de l’API locale : pg_control référençait un checkpoint invalide dans le WAL de la base PGlite PostgreSQL 18. Une copie complète du répertoire a été créée avant toute récupération. Sur une deuxième copie uniquement, les CRC de pg_control et des enregistrements de checkpoint ont été vérifiés. Le pointeur a été replacé sur le dernier checkpoint valide, puis PostgreSQL a effectué sa récupération automatique jusqu’à la fin du WAL. Aucun WAL n’a été effacé ou réinitialisé. Les tables ont été comptées ; la base a exécuté CHECKPOINT puis a été fermée proprement avant activation.

Copies conservées :
- node_modules/.skillquest-local/backups/data-20261029-162824
- node_modules/.skillquest-local/backups/data-before-recovery-20261029

Le lanceur local node_modules/.skillquest-local/start.mjs vérifie désormais le port de la base avant de l’ouvrir, utilise un verrou de processus exclusif et ferme la base lors d’un arrêt pris en charge. Deux instances PGlite ne doivent jamais ouvrir le même répertoire. Le lanceur d’origine est conservé en start.mjs.before-guard. Aucun identifiant, mot de passe ou secret n’est consigné ici.

Validation réelle dans Edge : connexion /admin/login, arrivée sur /admin/dashboard, affichage des 4 KPI, rechargement complet, aucune ressource _next/static en erreur et aucune erreur JavaScript. Capture : node_modules/.skillquest-local/dashboard-repair/dashboard-restored.png.

Références de format utilisées pour vérifier la copie :
- https://github.com/postgres/postgres/blob/REL_18_STABLE/src/include/catalog/pg_control.h
- https://github.com/postgres/postgres/blob/REL_18_STABLE/src/include/access/xlogrecord.h

Si un ancien onglet affiche encore l’écran de chargement, effectuer Ctrl+Maj+R. Une nouvelle connexion peut être nécessaire si sa session a expiré.
