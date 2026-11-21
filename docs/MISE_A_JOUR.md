# Mettre à jour une installation existante

1. Conserver l'ancien dossier, la version déployée et une sauvegarde PostgreSQL vérifiée.
2. Essayer d'abord la mise à niveau sur une copie isolée de la base (exemple : branche Neon de test).
3. Remplacer les sources, sans recopier les anciens `node_modules`, `.next` ou `dist`.
4. Reconfigurer les fichiers `.env` localement avec de nouveaux secrets et les adresses correctes. Ne pas recopier les valeurs exposées dans une archive partagée.
5. Depuis la racine, exécuter `npm ci`, puis `npm run db:generate`.
6. Vérifier la destination des chaînes `DATABASE_URL` et `DIRECT_URL` sans afficher leurs mots de passe. Les deux doivent viser la même branche et la même base.
7. Exécuter `npm run db:deploy` sur la copie d'essai. Cette commande utilise les migrations versionnées ; ne pas utiliser `migrate reset`, `db push --force-reset` ou un seed pour mettre à jour les données réelles.
8. Exécuter `npm run typecheck`, `npm test`, `npm run build`, puis tester des anciennes participations et une nouvelle publication.
9. Après validation et sauvegarde, appliquer la même mise à niveau à l'installation voulue, pendant une période sans évaluations actives.

## Installations précédemment créées avec db push

La nouvelle migration utilise `IF NOT EXISTS` pour les champs et la table de versions qui pouvaient avoir été ajoutés hors migrations. Cela ne remplace pas la vérification de l'historique Prisma : si les anciennes migrations ne sont pas enregistrées dans `_prisma_migrations` alors que leurs tables existent, `migrate deploy` peut échouer. Ne pas marquer arbitrairement des migrations comme appliquées. Comparer le schéma existant avec chaque migration avant de préparer une baseline adaptée.

## Ce que fait la migration ajoutée

- Ajoute les champs absents `missionVersion`, `impactSnapshot`, la table `MissionVersion`, et les champs de brouillon, révision, expiration et contexte.
- Conserve les participants, tentatives et décisions.
- Reconstruit uniquement les versions absentes à partir des données disponibles, avec un marqueur `LEGACY_BACKFILL`.
- Conserve les instantanés existants sans les réécrire.
- Initialise les sept compétences standard sans supprimer les identifiants historiques.
- Empêche la modification ou la suppression des versions publiées par un déclencheur PostgreSQL.
- Donne aux anciens jetons une expiration calculée à partir de la date de création du participant ; des accès anciens peuvent donc être déjà expirés.

Des informations déjà modifiées avant la correction peuvent être irrécupérables. Le rapport indique explicitement les versions reconstruites. Ne pas présenter ces reconstructions comme une preuve intacte de l'état initial.

## Renouvellement des secrets et des codes

- Changer les mots de passe PostgreSQL exposés auprès de l'hébergeur, puis mettre à jour les connexions côté backend.
- Changer le mot de passe administrateur réel ; le seed ne réinitialise pas les comptes existants. Un outil dédié de réinitialisation est fourni : `npm run admin:password -w backend -- adresse@example.com`. Il demande le nouveau mot de passe en saisie masquée et révoque les sessions de ce compte.
- Pour un nouveau pepper, les codes existants ne peuvent plus être vérifiés/déchiffrés : faire une rotation des codes depuis l'administration après avoir basculé sur la nouvelle clé. Les jetons d'accès existants ne dérivent pas du pepper.
- L'archive corrigée ne contient aucun secret réel.
