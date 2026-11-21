# Administration SkillQuest — livraison et autocritique

Les fichiers sont déjà appliqués. Le site local est servi sur http://localhost:3000/admin/login.

## Mini design system

Identité publique conservée : --hq-blue-800 pour la navigation, --hq-green-700 pour l’action principale, --hq-blue-50 pour le cadre, blanc pour la feuille de travail, --hq-ink et --hq-muted pour les textes. Statuts sémantiques : bleu information, vert opération réussie, ambre attente, rouge erreur ; fonds pâles et libellés sombres. Ils décrivent des opérations, jamais la valeur d’un participant.

Titres Outfit, texte Plus Jakarta Sans, arabe Tajawal. Taille de titre admin 24–28px, corps de travail 13–15px, métadonnées 11–12px, chiffres tabulaires. Espacements de 8/16/24/32px, rayons 8/16px, contrôles 44px minimum. Ombres uniquement pour les éléments flottants : profil, confirmation, notification.

## Écrans livrés

- Login scindé avec logo et globe discret ; formulaire étiqueté, mot de passe affichable, chargement et erreur annoncée.
- Cadre réutilisable avec sidebar fixe, lien actif explicite, compte et déconnexion ; tiroir dialog sur mobile, recherche globale, fil d’Ariane et choix FR/AR.
- Tableau de bord : quatre indicateurs réels, graphique des parcours récents, activité récente, raccourcis et suivi des synthèses IA.
- Participants : tableau sémantique, recherche et filtres existants, tri et filtres locaux signalés, pagination, sélection de lignes et export CSV confirmé, états vide/chargement/erreur.
- Fiche : coordonnées, dates, langue, état, confidentialité, synthèse et 31 observations en quatre familles, accordéons, réponses et PDF complet.

Les anciennes pages missions/sessions sont maintenues en redirection. L’application ne possède pas de pages actives de paramètres ou d’édition de contenu : aucune navigation factice n’a été inventée.

## Arborescence

frontend/src/app/admin/layout.tsx
frontend/src/app/admin/login/page.tsx
frontend/src/app/admin/(protected)/layout.tsx
frontend/src/app/admin/(protected)/dashboard/page.tsx
frontend/src/app/admin/(protected)/participants/page.tsx
frontend/src/app/admin/(protected)/participants/[id]/page.tsx
frontend/src/app/admin.css
frontend/src/lib/admin-content.ts
frontend/src/components/admin/
  AdminShell.tsx, Sidebar.tsx, Topbar.tsx, Breadcrumbs.tsx,
  PageHeader.tsx, StatCard.tsx, DataTable.tsx, FilterBar.tsx,
  StatusBadge.tsx, EmptyState.tsx, Skeleton.tsx, ConfirmDialog.tsx,
  Toast.tsx, FormField.tsx, Button.tsx, ActivityChart.tsx,
  ReportView.tsx, adaptive-ui.tsx

## Autocritique

1. Hiérarchie : le nombre de participations est dominant. Le graphique est limité aux données effectivement fournies, avec une explication à proximité. Les listes et rapports ont une action accessible dès leur en-tête.
2. Cadre : navigation et contenu ont des zones fixes ; le contenu s’étend jusqu’au bord utile. L’e-mail de l’administrateur est tronqué dans sa zone, avec le texte complet dans le menu profil.
3. Couleur : aucun dégradé ni effet de verre, pas d’icône dans une tuile colorée sur chaque KPI. La sidebar bleu profond est une demande de marque explicite et une exception au conseil général du skill.
4. Données : aucune statistique de variation n’est inventée. Zéro reste zéro, une date absente est un tiret. Les cinq repères reçus du service sont affichés par ordre alphabétique et sans classement de personnes.
5. Lecture : les 31 compétences sont regroupées et repliables. Situation, choix, justification et conseil conservent leur texte. Les valeurs /4 ont une présentation neutre identique.
6. Mobile : le tiroir est un dialog natif ; la recherche globale est aussi accessible dans ce tiroir. Les tableaux deviennent des lignes structurées en dessous de 768px, sans perte de champs ni défilement horizontal de la page.
7. Corrections réalisées après captures : suppression du débordement d’e-mail de la sidebar, isolation des anciens espacements du rapport public, graphique redimensionné avec des axes lisibles sur téléphone, textes secondaires augmentés, séparateurs de dates arabes normalisés dans le graphique.

Les captures montrent une interprétation institutionnelle calme plutôt qu’un tableau de bord spectaculaire. Les jeux de test contiennent parfois une seule participation : l’espace restant est laissé honnête, sans inventer des lignes pour remplir le compte.

Les inspecteurs de la deuxième revue indiquent 0 FAIL sur login, dashboard, liste vide et rapport aux largeurs 1440/768/390. Dashboard et rapport : 0 WARN. Login : 1 avertissement panel-void, lié au centrage vertical du formulaire dans un écran scindé ; cet espace est intentionnel. Liste vide : 1 avertissement tiny-text sur téléphone, car les métadonnées et les notices constituent l’essentiel d’un écran sans lignes ; les noms et données principales gardent une taille lisible. Les trois ombres signalées au lint appartiennent à des surfaces flottantes. backdrop-filter:none est explicitement utilisé pour annuler l’ancien flou du tiroir, pas pour ajouter du verre.

## Tests effectués

- npm.cmd run build : compilation de production et 34 pages générées.
- npm.cmd run typecheck : frontend et backend.
- npm.cmd test : 75 tests backend + 8 frontend réussis.
- npm.cmd run test:browser : parcours public complet, reprise, rapport, administration et anciennes redirections.
- Admin FR/AR à 375, 768, 1024 et 1440px : aucun débordement horizontal.
- Clavier : ouverture du tiroir, fermeture par Échap, retour du focus au bouton menu ; onglets et contrôles accessibles.
- Recherche globale et recherche des participants, filtre IA, ouverture du rapport.
- Sélection des lignes, annulation de confirmation puis téléchargement CSV.
- Ouverture et fermeture des 31 accordéons ; quatre familles.
- Mode print : 31 observations visibles alors que les accordéons sont fermés ; sidebar cachée ; PDF arabe généré.
- Erreur réseau simulée dans un contexte de test puis Réessayer fonctionnel.
- Connexion à la base locale réelle et état vide des participants vérifiés, sans ajouter de participation.
- Captures des trois formats ouvertes pour la revue visuelle.

Les tests utilisent une base isolée et une synthèse IA de démonstration enregistrée comme fixture. Ils ne sollicitent pas un fournisseur IA. Les captures de test ne représentent pas de vrais participants. Aucun test ne vaut certification complète de lecteur d’écran ou de conformité WCAG.

## Périmètre des données conservé

Pour respecter la demande de ne changer ni les appels ni le métier, les variations historiques globales ne sont pas fabriquées ; langue/période/tri portent sur la page courante et le disent. Une future évolution du service serait nécessaire pour des séries et filtres historiques globaux. L’authentification, les endpoints, les rapports privés et les règles de calcul sont conservés.

Fichiers complets, un par un : ADMIN_FILES.md. Archive à intégrer dans le projet existant : skillquest-admin-source.zip.
