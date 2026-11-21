# Pages de parcours et administration — affichage à 100 %

Les règles d’affichage se trouvent dans `assessment.css` et `admin.css`, exclusivement sous `@media screen`. Le zoom et la taille racine du navigateur restent natifs. Les vues de bureau prennent en compte la hauteur disponible, notamment 1280 × 552 CSS px correspondant à la capture avec une mise à l’échelle système élevée.

- Catalogue : titre de 32 px sur écran bas, cartes plus compactes, lien Commencer visible dans la première vue.
- Inscription : étapes sur une ligne à côté de la navigation, nom et e-mail côte à côte sur ordinateur, espacement réduit. Les textes de consentement sont conservés.
- Questions : progression et contexte dans une colonne de suivi sur ordinateur ; quatre réponses en deux colonnes sur les écrans larges et bas. Les choix et la validation restent dans la première vue aux étapes contrôlées. Sur mobile, les zones se superposent et le contenu défile naturellement.
- Administration : barre supérieure de 56 px et navigation latérale de 208 px sur écran bas ; titres, KPI, filtres, tableaux, fiches et rapports plus compacts. Les commandes gardent une hauteur minimale de 44 px.
- Accessibilité : le tableau de données du graphique est placé dans un conteneur visuellement masqué, conservant sa lecture assistée tout en empêchant son débordement à 320 px en RTL.

Les changements de structure de la page d’entretien conservent les identifiants de champs, la validation, les appels API et les données. Les règles d’impression ne sont pas modifiées.

Vérification : compilation de production ; parcours complet de 31 réponses, reprise, synthèse bilingue simulée dans une base de test isolée, recherche et export administrateur, impression des 31 compétences ; contrôle de 11 vues/étapes en FR/AR sur huit formats, soit 176 configurations de 320 à 1920 px, sans débordement horizontal ni erreur JavaScript. À 1280 × 552, les boutons de démarrage et de validation contrôlés sont entièrement visibles : formulaire FR jusqu’à y=545, questions contrôlées entre y=433 et y=459. L’accueil conserve ses 40 vérifications de viewport et de densité.

Contrôle design-taste-frontend de la connexion : 0 échec ; un avertissement d’espace libre sur la vue haute de bureau, dû au centrage du formulaire dans la hauteur de la fenêtre. Les captures ont été examinées sur ordinateur, tablette et mobile.

Captures et mesures : `node_modules/.skillquest-local/app-scale/`.
Vérification reproductible : `node --import tsx node_modules/.skillquest-local/run-native-app-scale.mjs`, avec `CHROMIUM_EXECUTABLE` configuré vers Edge ou Chromium.
