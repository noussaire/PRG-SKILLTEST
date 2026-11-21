# SkillQuest — administration, octobre 2026

Ce document remplace les indications anciennes concernant l’administration dans MASTER.md, conformément au nouveau cahier des charges utilisateur. Il ne modifie pas l’identité publique.

## Identité et direction

Les variables --hq-* de globals.css et home.css restent la référence. Navigation bleu #012754, actions positives #146B27, fond de travail --hq-blue-50, feuille blanche, encre --hq-ink, notes --hq-muted. Polices : Outfit pour les titres et chiffres, Plus Jakarta Sans pour les textes, Tajawal en arabe. Grille 8px, panneaux 16px, contrôles 8px, cibles interactives 44px minimum.

UI UX Pro Max : recherche « education nonprofit administration », résultat Minimalism & Swiss Style, accessibilité clavier et lien d’évitement. Le pattern landing page et la palette teal/amber proposés par défaut ne sont pas retenus : le produit possède sa propre marque et il s’agit d’écrans de travail.

Design Taste Frontend : framed-sheet, seed 1211622147, sans redraw. Une feuille blanche dans un cadre teinté, panneaux sans ombre, lignes de tableau discrètes. Exception explicitement demandée : navigation bleu profond, bien que la règle générale du skill préfère une navigation claire. Les polices et les couleurs sont conservées avec --keep palette,type. Les arcs sont limités au login, au titre du dashboard et aux états vides.

## Questions des écrans

- Connexion : comment accéder à l’espace réservé ?
- Tableau de bord : quels parcours et bilans sont disponibles maintenant ?
- Liste : quel participant et quel rapport faut-il consulter ?
- Rapport : que disent les choix, dans leur contexte, et quelle action proposer ?

Signature propre au produit : les 31 observations sont organisées en Communiquer, Réfléchir, Coopérer et Agir, avec la même organisation que l’accueil. Chaque observation associe situation, choix, lecture et conseil. Aucune couleur ne juge la personne.

## Données et limites de présentation

Les routes, les mécanismes d’authentification, les requêtes serveur et le traitement métier sont conservés. Les pages missions/sessions historiques restent des redirections. Aucun écran fictif de paramètres, de contenu ou de gestion d’administrateurs n’est ajouté sans fonctionnalité existante.

Le service fournit des KPI instantanés et une liste de parcours récents, pas une série historique globale. Le graphique est donc intitulé et décrit comme les départs des parcours récents reçus sur les sept derniers jours. Aucun delta mensonger n’est ajouté. La dernière activité est calculée parmi ces mêmes parcours récents. Les nombres de synthèses IA et de synthèses en attente restent visibles.

Recherche, état de test et état IA restent les filtres serveur existants. Langue, période et tri sont des contrôles de présentation sur la page reçue, avec indication explicite de cette portée. L’export CSV contient uniquement les lignes sélectionnées de la page ; une confirmation rappelle la confidentialité. Les préfixes de formules de tableur sont neutralisés.

## Frontières des styles

admin.css est limité aux médias screen et à .ad-root/.ad-*. Les fichiers globals.css et assessment.css sont inchangés, vérifiés par comparaison binaire avec les copies précédentes. Les marqueurs data-admin-root, data-adaptive-report, data-adaptive-summary, data-adaptive-skill, admin-content et admin-drawer sont conservés.

Les règles historiques du rapport public avaient une priorité !important : les exceptions admin sont limitées à screen. Pour l’impression, les détails interactifs sont cachés par la règle existante ; une copie d’impression avec les utilitaires hidden/print:block restitue toutes les 31 observations, même si les accordéons sont repliés. Aucun bloc @media print existant n’a été modifié.
