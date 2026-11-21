# Validation du 26 octobre 2026

| Vérification | Résultat |
|---|---|
| TypeScript frontend | Réussi |
| TypeScript backend, scripts, seed et tests | Réussi |
| Tests automatiques | 36 réussis, 0 échec, 0 ignoré |
| Migration d'un ancien schéma avec données | Réussie sur base temporaire |
| Build de production backend et frontend | Réussi |
| Parcours navigateur desktop 1440 × 1000 | Réussi |
| Parcours navigateur mobile 390 × 844 | Réussi |
| Reprise après actualisation | Réussie dans les deux tailles |
| Résultats français/arabe et RTL | Réussis |
| Activation des cartes au clavier | Réussie |
| Connexion administrateur et détail participant | Réussis |
| Interface des statistiques collectives | Réussie |
| Requête d'écriture provenant d'une autre origine | Refusée avec HTTP 403 |
| Chargement de l'éditeur | Réussi |
| Sauvegarde et publication depuis l'éditeur | Réussies |
| Erreurs JavaScript navigateur durant ces parcours | Aucune |
| Impression A4 | PDF de test généré et première page inspectée |
| Fichiers de configuration actifs dans le ZIP livré | Aucun |

Les tests API et navigateur créent une base PostgreSQL embarquée PGlite distincte, en mémoire, avec une interface TCP locale. Les valeurs de configuration du test sont définies avant l'import de l'application. Ils ne se connectent pas à la base de l'archive initiale.

La vérification de rafale d'inscriptions et de doubles réponses valide les invariants sur ce moteur embarqué. PGlite multiplexe les connexions sur une exécution PostgreSQL interne unique ; cela ne constitue pas une preuve de charge ou d'isolation multi-processus d'un hébergement PostgreSQL natif. Un test de charge sur la préproduction réelle reste nécessaire avant un usage à grande échelle.

Aucune migration ni aucun déploiement n'a été effectué sur les services réels. Le renouvellement des secrets exposés reste une opération à effectuer auprès des services concernés.
