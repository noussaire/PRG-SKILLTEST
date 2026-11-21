# Accueil à 100 % — toutes les sections

La correction de l’affichage couvre maintenant l’ensemble de l’accueil, en complément de la correction initiale du hero : titres, espacements, colonnes, aperçus, étapes, démonstration, compétences, publics, confidentialité, FAQ, carte finale et footer.

Le changement reste dans `frontend/src/app/home.css`, sous `@media screen`. Aucun zoom CSS, transform global, hauteur fixe de section ou changement de la taille racine n’est appliqué. Les liens du footer et le texte principal restent à 16 px. La hauteur disponible est prise en compte pour les écrans d’au moins 1024 px de large et au plus 720 px de haut.

À 1280 × 552, correspondant à la capture à forte densité système :

- En français : document de 7421 à 4460 px ; footer de 669 à 451 px ; titres de section de 52 à 35 px environ.
- En arabe : document de 6909 à 4216 px ; footer de 643 à 433 px.
- Toutes les sections restent présentes. Le contenu conserve son défilement naturel ; les longs textes et les réponses de FAQ ouvertes peuvent augmenter la hauteur.

Vérifications : compilation de production réussie ; contrôle des 12 sections et des quatre familles dans 16 configurations (FR/AR, 320 à 1920 px), sans débordement ni texte tronqué ; 40 contrôles de viewport et de densité ; interactions de la démonstration, des onglets et des six FAQ ; chevauchement de la carte finale conservé sur les formats larges et mobiles.

Captures et mesures détaillées : `node_modules/.skillquest-local/full-home-scale/`.
Contrôles reproductibles : `node docs/check-home.mjs`, `node docs/check-home-viewport.mjs`, `node node_modules/.skillquest-local/check-full-home-scale.mjs`.
