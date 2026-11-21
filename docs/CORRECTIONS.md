# Bilan des corrections — 26 octobre 2026

## Données et parcours

| Problème | Correction |
|---|---|
| Anciennes versions mêlées aux choix courants | Brouillon JSON séparé, nouveaux nœuds par version, instantané figé utilisé pour l'affichage et les transitions |
| Écrasement des versions publiées | Insertions versionnées, verrou de mission, révision obligatoire et déclencheur PostgreSQL d'immutabilité |
| Textes historiques modifiés après une réponse | Contexte de décision et lecture depuis la version de la tentative |
| Graphes cycliques ou sans fin accessible | Publication bloquée ; validation des départs, clés, destinations, choix, cycles et accessibilité |
| Suppressions ou choix résiduels dans l'éditeur | Le brouillon peut supprimer ses éléments sans modifier les lignes historiques |
| Sauvegarde échouée suivie d'une publication | Le client arrête l'action si la sauvegarde ne retourne pas une nouvelle révision |
| Dépassement de capacité lors d'inscriptions simultanées | Verrou PostgreSQL sur la session et recomptage dans la transaction |
| Réponses autorisées après la date limite | Même fenêtre temporelle appliquée aux inscriptions et aux décisions |
| Sessions programmées inactives | Politique à la requête et actualisation périodique des statuts |
| Champs description/capacité impossibles à effacer | Distinction entre `null` et champ absent |
| Compteur perdu après actualisation | Nombre de décisions lu depuis la base et estimation des situations restantes |
| Code de démonstration et ancien code de session inventés dans l'UI | Retrait des valeurs codées en dur et du repli lié à un identifiant fixe |

## Évaluation

| Problème | Correction |
|---|---|
| Calcul différent selon l'écran | Service commun pour rapports, compétences, tableau de bord et collectif |
| Profil équilibré attribué par défaut à des résultats négatifs | États explicites : observations insuffisantes, axes de progression et tendances à approfondir |
| Parcours longs favorisés par les sommes | Moyennes par observation ; nombre d'observations affiché et seuils documentés |
| Anciennes compétences incohérentes avec les sept dimensions | Référentiel standard initialisé et anciens slugs interprétés sans supprimer les preuves |
| Graphique écrêtant les sommes à ±3 | Affichage de la moyenne sur une échelle réelle de −3 à +3 ; non-observé distinct de zéro |
| Rapport final accessible trop tôt | 409 pour le participant tant que le parcours n'est pas terminé ; bilan administrateur indiqué comme provisoire |
| Distribution collective toujours vide | Comptage réel des profils terminés et masquage des petits effectifs |
| Moyennes collectives mêlant les tentatives inachevées | Agrégation des seules tentatives terminées, selon les moyennes individuelles |

## Sécurité et interface

- Retrait des `.env` actifs et des identifiants administrateur affichés dans la page de connexion.
- Aucune révocation externe automatique : les secrets réellement utilisés doivent être renouvelés par leur propriétaire.
- Expiration et révocation des jetons invités côté serveur ; révocation administrateur au changement de mot de passe.
- Erreurs utilisateur génériques, sans détail Prisma ou trace de pile.
- Origines CORS explicites, protection des écritures Next.js, en-têtes de sécurité et limites de temps des appels au backend.
- Limites de débit par compte, participant ou couple code/nom, en complément d'une limite IP globale.
- Formulaire de participation étiqueté, cartes de compétences accessibles au clavier et libellés d'actions ajoutés.
- Contenu de démonstration français/arabe ; nouveaux états du rapport traduits ; langue persistée avec tolérance au blocage de localStorage.
- Retrait de la promesse d'anonymat total ; information sur l'accès administrateur et page de confidentialité.
- Corrections du détail participant, de l'adresse du collectif et des redirections interceptées par `catch`.
- Masquage de la navigation publique dans l'espace administrateur, adaptation mobile et impression A4.
- README, architecture, API et guide de déploiement réécrits ; guide de migration existante ajouté.

## Vérifications et limites

- Vérifications TypeScript incluant sources, seed et tests.
- Tests de règles et API, base PostgreSQL embarquée temporaire et migration d'un ancien schéma rempli.
- Build de production frontend et backend.
- Test navigateur desktop 1440 px et mobile 390 px : parcours de quatre décisions, reprise, résultats, RTL, clavier, administration, collectif, éditeur et protection intersite.
- Contrôle interne du PDF d'impression et de captures des résultats.

Les résultats exacts de la dernière exécution figurent dans `VALIDATION.md`.

Les données historiques déjà écrasées avant la correction ne peuvent pas être reconstituées. Les reconstructions sont signalées. Les tests PGlite ne remplacent pas une validation de charge multi-connexion sur PostgreSQL natif. La limitation distribuée du débit et la politique organisationnelle de conservation restent à définir selon le déploiement. Cette archive n'ajoute ni comptes étudiants ni enchaînement de missions, fonctionnalités qui n'existaient pas dans le parcours analysé.

Aucune connexion à la base fournie dans l'archive d'origine, aucune migration sur cette base, aucun déploiement et aucun envoi à des tiers n'ont été effectués.
