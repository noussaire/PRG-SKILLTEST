# Accueil — correction de la hauteur disponible à 100 %

La capture utilisateur 1920×828 est reproduite avec une zone CSS 1280×552 et une densité de pixels 1,5, correspondant à une mise à l’échelle système courante. Le navigateur conserve son zoom et les textes leur taille native.

Avant : en-tête 135px, introduction 854px, bouton principal à y=645–701px, sous la limite de 552px.
Après : en-tête 88px, introduction 439px en français / 419px en arabe. Bouton entièrement visible, bas à 409px / 420px. Aperçu complet et commande pause visibles, bas à 503px / 482px.

Le changement se limite à home.css, dans des règles @media screen : en-tête plus compact, titre fluide, proportions des colonnes et espacements ajustés. Sur les écrans larges mais bas, la capture supplémentaire décorative est retirée et le bloc de question conserve ses quatre choix lisibles. Sur tablette, les colonnes se superposent pour éviter l’encombrement. Aucune hauteur fixe ni réduction globale par zoom/transform n’est appliquée aux contenus.

Vérification : compilation de production réussie ; 40 combinaisons de deux langues, deux densités et dix formats d’écran, de 320 à 1920px ; aucun débordement horizontal ; bouton et aperçu entièrement visibles au format de la capture. Interactions de l’accueil vérifiées séparément.

Script reproductible : node docs/check-home-viewport.mjs.
Captures : node_modules/.skillquest-local/zoom-fix/final-fr-1280.png et final-ar-1280.png.
