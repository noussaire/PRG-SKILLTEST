# Accueil SkillQuest — direction et revue

## Identité

Logo fourni conservé. Dominantes opaques relevées : bleu #012754, vert #146B27. Encre d’accompagnement #123348. Le PNG contient plusieurs nuances et de l’anticrénelage : ces deux couleurs servent de références de palette, et non de prétendue charte vectorielle exhaustive.

Personnalité : éducative, engagée, institutionnelle. Le globe devient un motif de cercles et de méridiens SVG, présent autour du test et dans l’appel final. Titres Outfit, textes Plus Jakarta Sans, arabe Tajawal. Palette bleue et verte 50–900, neutres teintés, grille 8px, titres fluides et ombres en couches pour les aperçus.

## Composition appliquée

1. Barre institutionnelle et navigation fixe, logo et CTA.
2. Grande déclaration et fenêtre de test animée avec quatre choix.
3. Bande de quatre chiffres animés (informations produit, pas statistiques de fréquentation).
4. Association et mission, aperçu asymétrique.
5. Parcours relié : quatre étapes, décalées sur ordinateur et verticales sur téléphone.
6. Démonstration interactive réelle, réponse annoncée dans aria-live.
7. Rapport sur fond décalé, trois bénéfices.
8. Quatre familles en onglets : les 31 compétences sont couvertes une fois chacune.
9. Trois publics dans des compositions différentes.
10. Limites pédagogiques, données et accès autorisés.
11. Les six FAQ existantes, en FR et AR.
12. Appel final sur fond de marque.
13. Pied de page avec logo, liens et grand wordmark.

## Skills et choix explicites

UI UX Pro Max a servi à la hiérarchie, aux contrastes et aux interactions. Design Taste Frontend a servi à la direction « page-is-the-object », au rythme de composition et aux revues sur captures. Le brief utilisateur prime sur les préférences du skill pour des surfaces sans ombre ni lignes : badges, arcs, cadres d’application, ombres et ligne du parcours sont intentionnels.

## Autocritique et corrections

La première revue révélait des petites tailles de texte et un en-tête trop haut sur téléphone. Les textes courants sont passés à 16px, l’introduction à 18px et les principales notes à 13px. Le header mobile a été compacté. Les doublons du nom de l’association au-dessus des titres ont été retirés. Les points décoratifs de fenêtre ont été assombris. Le fond cassé a été remplacé par un neutre teinté bleu-vert.

Le résultat repose sur le produit réel : décision, conséquence et rapport. La décoration reste limitée au vocabulaire du globe. Les compositions en deux colonnes restent présentes pour les blocs éditoriaux, mais alternent avec bandeau, chemin, fenêtre interactive, onglets et grands aplats.

Évaluation subjective après les deux revues : design 8/10, utilisabilité 8/10, créativité 7/10, contenu 8/10, soit 7,8/10 pondéré. C’est une interprétation soignée du brief, pas une revendication de prix de design.

L’inspecteur final indique 0 échec et 6 avertissements avec les exceptions documentées shadow, hairline et covered-text. Ce dernier concerne les titres passant derrière le header sticky lors du défilement : la navigation fixe est explicitement demandée. La derni?re note de d?monstration ? 12px a ?galement ?t? port?e ? 13px apr?s cette mesure. Les avertissements restants concernent les cadres, la variété des tailles fluides et alignements, une petite note de fenêtre, l’absence de vidéo et une animation mesurée modérée. Pas de vidéo ajoutée : aucun tournage de l’association n’a été fourni et les visuels du parcours montrent le produit réel. Les animations restent volontairement sobres et désactivables.

## Vérifications

- Compilation de production réussie, 34 pages générées.
- Vérification TypeScript réussie.
- 75 tests backend et 8 tests frontend réussis.
- Parcours navigateur complet : 31 réponses sauvegardées, reprise, rapport bilingue, administration, KPI, recherche et PDF ; aucune erreur JavaScript.
- Revue ciblée de l’accueil : FR et AR à 375, 768, 1024 et 1440px, aucun débordement, CTA visible, quatre familles, 31 compétences, clavier RTL, démo et FAQ.
- Captures complètes de la revue Taste ouvertes et examinées aux trois formats.
- CSS d’impression et logique des parcours inchangés. Les header/footer publics sont partagés avec les autres pages publiques.

Commandes : npm.cmd run build ; npm.cmd run typecheck ; npm.cmd test ; npm.cmd run test:browser ; node docs/check-home.mjs.

Fichiers complets : HOME_FILES.md. Entrée : frontend/src/app/page.tsx. Styles : frontend/src/app/home.css. Textes bilingues : frontend/src/lib/home-content.ts.
