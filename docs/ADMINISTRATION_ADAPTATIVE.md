# Administration du parcours adaptatif

L’interface publique présente l’accueil et le choix des tests dans `/entretien`. La carte « Test de soft skills » ouvre `/entretien/soft-skills` avec le formulaire nom complet et e-mail, ou le parcours sauvegardé dans ce navigateur. La carte « Test égogramme » porte la mention « Bientôt disponible » et son bouton est désactivé. Les anciennes pages `/participer`, `/espace` et `/mes-resultats` redirigent vers `/entretien`. L’administration comporte deux rubriques : **Tableau de bord** et **Participants**. Les anciens écrans de missions, sessions et rapports de missions redirigent vers ces rubriques. Aucune donnée historique n’est supprimée.

## Tableau de bord

Les statistiques utilisent exclusivement `AdaptiveInterview` et `AdaptiveReportJob` :

- Participants : nombre de parcours enregistrés, y compris ceux dont l’accès participant a expiré. Ce n’est pas un décompte de personnes uniques : il est possible de recommencer avec la même adresse e-mail, sans compte ni vérification d’identité.
- Tests terminés : 31 réponses sauvegardées, aucune question en cours et un bilan final disponible.
- Rapports enrichis par IA : tests terminés disposant effectivement d’une synthèse IA enregistrée. Deux traductions comptent pour un seul rapport. Les synthèses automatiques et les tâches en attente ne sont pas comptées comme IA.
- Tests en cours : parcours non terminés.
- Synthèses IA en attente : tâches `PENDING`, `PROCESSING` ou `RETRY` pour un test terminé.
- Top compétences : cinq meilleurs indicateurs moyens sur 4, uniquement sur les tests terminés ; une observation par participant et par compétence. Les valeurs inconnues sont exclues. Chaque moyenne indique le nombre de participations prises en compte. Ce résultat reste exploratoire, sans classement de personnes ni validation psychométrique.

Les anciens tests de missions sont conservés séparément et ne contribuent à aucun de ces compteurs.

## Participants et rapports

La liste permet la recherche par nom ou e-mail, le filtrage par progression et par disponibilité de la synthèse IA, avec pagination. La fiche expose les informations collectées : nom complet, e-mail déclaré, langue de départ, dates, progression, choix et rapport. Les anciens parcours gardent leur nom/pseudonyme et affichent « E-mail non renseigné ». Aucun téléphone ou autre profil personnel n’est demandé. Les coordonnées ne sont ni envoyées au fournisseur IA ni publiées dans les réponses de l’API participant. Aucun e-mail automatique n’est envoyé.

Les onglets **Rapport personnel** et **Questions et réponses** séparent la synthèse et les 31 indicateurs du détail du parcours. Le rapport indique si la synthèse affichée vient de l’IA ou des règles. L’impression utilise la langue sélectionnée, français ou arabe. Une tâche en attente n’empêche pas de consulter le bilan automatique ; la fiche vérifie périodiquement la disponibilité de la synthèse.

L’accès administrateur reste soumis à une session authentifiée, même lorsque l’accès du participant a expiré. Consulter ou imprimer un rapport ne déclenche jamais d’appel IA, de relance de tâche ou de modification du parcours.

## API de l’interface

Routes privées avec authentification administrateur :

- `GET /api/v1/admin/adaptive/dashboard?lang=fr|ar`
- `GET /api/v1/admin/adaptive/participants?page=1&limit=12&search=&status=ALL&ai=ALL`
- `GET /api/v1/admin/adaptive/participants/:id?lang=fr|ar`

Les filtres de statut acceptent `ALL`, `COMPLETED`, `IN_PROGRESS`. Le filtre IA accepte `ALL`, `COMPLETE`, `PENDING`, `UNAVAILABLE` (bilan automatique seul). Le BFF Next.js utilise `/api/admin/adaptive/...` et le cookie administrateur privé. Les jetons des participants, leurs empreintes et les grilles de correction ne sont jamais retournés.

La migration `20261029010000_adaptive_participant_email` ajoute une colonne e-mail nullable et son index, sans modifier les parcours ou comptes existants. Sur une installation externe : arrêter le backend, générer Prisma puis appliquer les migrations avec `npm.cmd run db:generate` et `npm.cmd run db:deploy`, après vérification de la base cible et sauvegarde. Le lanceur de démonstration locale applique cette migration à sa base isolée sans reset. La durée de conservation reste à définir par l’organisateur. La notice de confidentialité et le consentement au démarrage expliquent l’accès de l’administration aux coordonnées, réponses et rapports.
