# SkillQuest — identité visuelle

Identité adaptée au logo fourni par Chabab Connect. L’original PNG est conservé dans `frontend/public/brand/skillquest-logo.png`, sans retouche ni déformation. Le composant BrandLogo cadre uniquement ses marges transparentes. Utiliser un support blanc afin de préserver la lisibilité des détails bleus et verts.

## Direction actuelle — octobre 2026

La refonte détaillée dans [REDESIGN.md](REDESIGN.md) remplace la composition initiale par cartes. L’accueil suit une direction éditoriale « sentence-as-layout » : une phrase autour de captures réelles du parcours, une démonstration à quatre choix, un aperçu du rapport, un index des compétences et une FAQ. Les sections ont des compositions distinctes. L’administration suit « framed-sheet » : navigation discrète, surface de travail blanche, indicateurs sans tuiles promotionnelles et listes de participants. Aucun dégradé, effet de verre ou ombre décorative sur ces écrans.

Les typographies et les couleurs de marque ci-dessous restent la référence. Sur l’accueil : blanc dominant, encre #123348 et fond secondaire #EDF2EF ; vert #2D6624 pour l’action principale. Les cartes restent réservées aux véritables groupes fonctionnels dans les écrans de travail.

## Principes de marque

Interface éducative destinée aux adultes : claire, calme, structurée et accueillante. UI UX Pro Max a fourni une direction « Accessible & Ethical », applicable aux produits éducatifs. La proposition enfantine initiale a été écartée. La typographie et les couleurs proposées pour les services professionnels ont été adaptées à l’identité réelle du logo et aux deux langues du produit.

## Couleurs

- Bleu : `brand-blue-700` (#074F78), titres, navigation, indicateurs et liens.
- Bleu profond : `brand-blue-950` (#082F47), panneaux de contexte et textes de forte hiérarchie.
- Vert : `brand-green-700` (#2D6624), actions principales avec texte blanc.
- Vert clair : `brand-green-50` (#F1F7ED), sélection et messages positifs.
- Fond : `canvas` (#F5F8F7), cartes blanches, bordures discrètes.
- Erreurs et attentes conservent une signification explicite, avec texte et icône.

Les échelles sont centralisées dans Tailwind. Le vert clair du logo reste un accent décoratif ; les boutons utilisent un vert plus sombre pour assurer le contraste avec le texte blanc.

## Typographie et structure

Plus Jakarta Sans en français, Tajawal en arabe, avec des polices système en secours. Titres courts, paragraphes lisibles, largeur de lecture limitée. Des cartes espacées présentent une action principale identifiable ; aucune statistique fictive ou témoignage inventé.

En-tête : logo officiel, navigation publique, choix FR/العربية. Administration : identité identique, menu limité au tableau de bord et aux participants. Questions : quatre grandes zones de sélection, progression visible et bouton principal vert. Rapports : hiérarchie lisible, synthèse distincte des indicateurs, impression A4 conservée.

## Accessibilité et vérification

Navigation clavier, lien d’évitement, focus visible, nom accessible des icônes interactives, état de langue annoncé, libellés de formulaire, zones cliquables confortables et absence de défilement horizontal. Respecter les préférences de mouvement réduit. Les grandes images de marque gardent leurs proportions ; les icônes d’interface utilisent Lucide.

Vérifier le parcours, les rapports et l’administration dans les deux langues, sur ordinateur et téléphone. Les retouches graphiques ne doivent ni modifier le scoring ni consommer de quota IA lors des essais.
