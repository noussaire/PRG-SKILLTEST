# SkillQuest — revue de la refonte

29 octobre 2026. Skills appliqués : UI UX Pro Max et design-taste-frontend.

## Direction

### Ajustement institutionnel demandé

La demande suivante souhaite davantage de décoration, sans petites icônes ni multiplication des couleurs. Le hero adopte un champ bleu profond, un arc unique inspiré du globe du logo et un bouton clair. Une bande d’association nomme Chabab Connect ; une section de démarche associe sa mission aux deux données réelles du produit (31 compétences et FR/AR). Le catalogue et les aperçus du rapport utilisent un accent vert structurel, et le footer ferme la page sur le même bleu. Cette décoration est une exception explicite aux préférences par défaut de Taste Skill contre les formes décoratives et les traits : elle répond à la demande du client. L’identité, les fonctions, les données et le scoring restent identiques.

Contrôle de cette édition : compilation et TypeScript réussis ; parcours navigateur complet réussi sans erreurs JavaScript, sans appel réel à Groq. Inspection finale FR/AR à 1440, 768 et 390 : 0 erreur bloquante ; captures revues dans `.taste-skill/institutional-fr` et `.taste-skill/institutional-ar`. Les avertissements sont conservés avec raisons : l’arc détourne volontairement la préférence contre les contours à la demande du client ; les tailles différencient navigation, légende, texte, donnée et titres ; le libellé d’association mobile reste à 12 px, avec les textes principaux à 16 px ; aucun film associatif fourni, donc vues réelles du produit ; mouvement mesuré volontairement modéré, stoppable et désactivé selon les préférences. L’alerte arabe sur les bords gauche ne représente pas son alignement de lecture à droite.

Revue institutionnelle : design 7,5 · utilisabilité 8 · créativité 7 · contenu 8, soit 7,6/10 d’appréciation interne. L’accueil gagne du contraste et une présence associative ; les aperçus restent petits sur téléphone, mais la démonstration réelle fournit le contenu à taille lisible. Aucun nouveau témoignage, partenaire, chiffre de fréquentation, photo de stock ou donnée de participant réel n’a été ajouté.

Accueil : `sentence-as-layout`, seed `1954362474`. Idée : les décisions et le rapport réel du parcours occupent l’espace entre « Vos choix » et « votre voie ». L’identité bleu/vert, le logo fourni, Plus Jakarta Sans et Tajawal sont conservés. Le logo n’a subi aucune retouche.

Administration : `framed-sheet`, seed `1997044426`. Un cadre gris vert accueille la navigation et une feuille blanche concentre les indicateurs, les participants et leurs rapports. Les données proviennent des API existantes.

La démonstration publique utilise une véritable situation préparée, quatre actions et leurs conséquences différentes. Elle montre la question suivante sans enregistrer la visite et sans appeler de fournisseur IA. Le catalogue distingue le test disponible de l’égogramme à venir. Les formulaires, questions, rapports et écrans administratifs suivent la même identité.

## Critique visuelle

ROUND 2

Seen in one second: la phrase « Vos choix, votre voie » et le parcours réel au centre.

Idea (one sentence): le parcours issu des décisions devient le sujet visuel de la page.

Live thing: choisir une action modifie la conséquence et la question suivante dans la démonstration.

Layout words by section: hero=phrase et défilement / démo=atelier / rapport=aperçu et faits / compétences=index / FAQ=questions ouvertes / footer=signature.

Scores: design 7 · usability 8 · creativity 7 · content 8 → overall 7.4.

Caps applied: mouvement volontairement sobre, plafond design 7 ; concept éditorial connu, créativité 7. Il s’agit d’une autoévaluation, pas d’une note externe.

Top three problems (most visible first), each with the screenshot it shows in and the fix:

1. Première passe : le média précédait visuellement le titre (`round-1/desktop-fold.jpg`). Correction : hiérarchie et empilement du titre, réinspectés sans erreur.
2. Première passe : échelle des titres et texte d’introduction trop faible (`round-1/tablet-fold.jpg`). Correction : titres secondaires 48 px sur ordinateur, introduction 18 px et composition mobile spécifique.
3. Administration : informations secondaires petites (`admin-overview/desktop-fold.jpg`, première capture). Correction finale : 13 px minimum pour les petites classes textuelles de l’administration, libellé de navigation en casse normale et chiffres tabulaires.

## Validation et limites

Compilation et types validés. 83 tests automatisés réussis. Le contrôle navigateur utilise une base isolée de démonstration : accueil interactif, sélection du test, formulaire, 31 réponses, reprise, rapport bilingue, administration authentifiée, recherche, filtres, menu mobile, impression PDF et anciennes redirections. Aucun appel réel à Groq pendant ces essais.

L’inspecteur public a mesuré les versions FR et AR à 1440, 768 et 390 px : aucune erreur bloquante. Toutes les captures finales publiques ont été ouvertes pour revue visuelle. Les captures administratives utilisent le DOM effectivement rendu par le navigateur avec des données fictives ; les vérifications fonctionnelles portent sur l’application complète, pas sur ces exports statiques.

Avertissements publics conservés : absence de film original ; les quatre captures de produit sont plus pertinentes que des images de personnes sans lien avec l’association. Mouvement modéré en français (15 éléments détectés). L’alerte d’alignement arabe mesure les départs à gauche de textes RTL de longueurs différentes ; les marges externes et colonnes restent alignées à droite. Le mouvement peut être mis en pause et respecte le réglage de réduction des animations.

Limites visuelles restantes : les aperçus de produit sont des illustrations de l’interface, donc leur petit texte n’est pas destiné à la lecture ; la démonstration adjacente est lisible. Certains aperçus sont en français même dans la présentation arabe pour montrer les deux langues. La liste des 31 compétences allonge la page mobile, mais reste complète.

## Vérification finale et finitions

Les aperçus d’accueil suivent maintenant la langue sélectionnée : question, conséquence et synthèse existent en français et en arabe. Ils sont capturés dans les véritables composants avec des réponses de démonstration, sans IA externe ni participant réel. L’animation s’arrête hors écran, lorsque l’onglet est masqué et avec la préférence de mouvement réduit ; le bouton de pause conserve le contrôle manuel.

La version compilée a été vérifiée à nouveau : 83 tests automatiques réussis, test navigateur complet réussi (dont changement des aperçus et pause), accueil FR et AR à 1440/768/390 sans erreur bloquante. Mesures : `.taste-skill/final-fr/report.json` et `.taste-skill/final-ar/report.json`. L’absence de vidéo est assumée : aucun film de Chabab Connect n’a été fourni et les vues réelles du produit portent la présentation. Le mouvement volontairement modéré ne cherche pas à multiplier les animations ; les colonnes arabes restent alignées sur leur bord de lecture à droite, malgré l’alerte de l’inspecteur fondée sur les départs à gauche.

Les nouvelles inspections des exports administratifs issus du DOM rendu sont dans `.taste-skill/admin-overview-verified` et `.taste-skill/admin-participant-verified` : tableau de bord sans erreur ni avertissement ; fiche participant sans erreur, deux avertissements concernant l’espace avant le rapport et une marge mobile de 16 px. Ces marges sont conservées après revue. Les captures finales publiques et administratives ont été ouvertes. Les aperçus restent illustratifs et leur texte réduit se lit dans la démonstration et le parcours réels, pas dans l’image.

ROUND 3

Seen in one second: la phrase « Vos choix, votre voie » et les preuves concrètes du parcours.

Idea (one sentence): les choix de SkillQuest deviennent le contenu visuel entre les deux parties de la phrase.

Live thing: quatre actions réelles affichent des conséquences et questions suivantes distinctes.

Layout words by section: hero=phrase et vues produit / démo=atelier / rapport=document et faits / compétences=index / FAQ=accordéon / footer=signature.

Scores: design 7 · usability 8 · creativity 7 · content 8 → overall 7.4. Appréciation qualitative interne, pas une certification.

Caps applied: les captures d’interface remplissent la fonction d’images du produit ; aucun contenu de preuve inventé.

Top three problems (most visible first), each with the screenshot it shows in and the fix:
1. Les petits textes des vues produit restent réduits dans le hero mobile ; la démonstration interactive immédiatement après offre les textes à taille de lecture.
2. Les aperçus français sur l’accueil arabe ont été remplacés par les captures arabes correspondantes.
3. Le défilement pouvait continuer hors écran ; il suit maintenant la visibilité du hero, de l’onglet et la préférence de réduction du mouvement.

## Provenance

Mesure administrative finale : tableau de bord 0 erreur / 0 avertissement ; fiche participant 0 erreur / 3 avertissements. La fiche exportée a employé la police de secours sur la première capture ordinateur, puis chargé la police prévue sur tablette et mobile ; les inspections publiques et du tableau de bord ont chargé la police prévue. Les deux autres alertes concernent la respiration de 84 px avant le rapport et une marge de 16 px sur téléphone, conservées après revue. Les alertes de texte trop petit et de chiffres non tabulaires sont corrigées. Toutes les captures administratives finales ont été ouvertes.

Les quatre fichiers `frontend/public/brand/previews/*.png` proviennent de véritables composants SkillQuest, avec une identité et des réponses de démonstration. Aucune donnée de participant réel, photographie de stock, police payante, fausse statistique ou faux témoignage. Le logo original fourni reste `frontend/public/brand/skillquest-logo.png` ; seul le cadrage de ses marges transparentes est réalisé en CSS.

Les décisions détaillées sont conservées dans `.taste-skill/brief.md`, les directions dans `.taste-skill/direction.json` et `.taste-skill/app/direction.json`. Les mesures publiques sont dans `.taste-skill/after-fr/report.json` et `.taste-skill/after-ar/report.json`.
