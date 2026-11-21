# PRG-SKILLTEST

Ce dépôt regroupe le projet SkillQuest complet : `backend/`, `frontend/`, `shared/`, les tests et la documentation. Les deux dépôts de déploiement existants restent séparés : `noussben67-s/skill_test_backend` pour `skillquest-backend` et `noussben67-s/skill_test_frontend` pour `skillquest-frontend`. Ce dépôt de regroupement ne remplace pas leurs connexions Vercel.

# SkillQuest — version corrigée 0.2.0

Plateforme pédagogique français/arabe pour explorer les soft skills à travers des scénarios à embranchements. Next.js/React/TypeScript, Express, Prisma et PostgreSQL.

Les résultats sont des repères contextuels, sans validation psychométrique. Ils ne constituent pas une note scolaire ni un classement des étudiants.

L’identité visuelle utilise le logo officiel fourni par Chabab Connect, une palette bleu/vert et des composants partagés entre les pages publiques, les rapports et l’administration. Les règles graphiques sont documentées dans [le système de design SkillQuest](design-system/skillquest/MASTER.md). Le logo original est conservé sans retouche.

La page `/entretien` permet de choisir un test. Le test de soft skills, disponible dans `/entretien/soft-skills`, commence par un formulaire nom complet et e-mail, puis propose 31 situations préparées, quatre choix et un bilan complet immédiat, sans appel IA pendant les questions. Le test égogramme est présenté comme « Bientôt disponible » et n’est pas activé. Une synthèse IA facultative peut enrichir le rapport ensuite via une file persistante. Voir [le fonctionnement et la configuration gratuite](docs/IA_GRATUITE.md). Le site n’est pas encore publié sur Internet.

## Ce que contient cette version

- Choix du test, formulaire nom complet et e-mail, puis parcours adaptatif sans compte ni code avec accès privé par cookie HTTP-only.
- 31 questions et quatre choix par situation, avec des conséquences et des suites adaptées aux réponses.
- Questions, choix et bilan en français et en arabe ; progression sauvegardée pendant le changement de langue.
- Bilan complet immédiat sans quota IA ; synthèse IA bilingue facultative, ajoutée via une file persistante.
- Interface française/arabe, navigation RTL, indication de progression, impression A4.
- Administration : tableau de bord et participants. KPI des tests terminés, des rapports enrichis par IA, des parcours en cours et des compétences les plus représentées.
- Fiche participant : nom, e-mail, langue, dates, progression, réponses et rapport consultable et imprimable dans les deux langues. Les anciens pseudonymes restent conservés sans e-mail inventé.
- Tests automatiques sans accès à votre base réelle.

Les anciennes pages de missions et de sessions ne font plus partie de l’interface et redirigent vers le parcours adaptatif ou le tableau de bord. Leurs données historiques sont conservées et exclues des nouveaux KPI. Voir [l’administration adaptative](docs/ADMINISTRATION_ADAPTATIVE.md).

## Avant de commencer

Prérequis : Node.js 24.x, npm et une base PostgreSQL distincte pour les essais. La qualification du build et du moteur Prisma est décrite dans [VERCEL_BUILD_STEP5A.md](docs/VERCEL_BUILD_STEP5A.md). Pour Neon, utiliser les chaînes pooled et direct du même projet et de la même branche.

L'archive ne contient aucun `.env` actif. Les secrets de l'ancienne archive et les identifiants autrefois affichés dans la page de connexion doivent être renouvelés s'ils ont été utilisés réellement. Supprimer une valeur du code ne la révoque pas auprès du service.

## Installation neuve, sous Windows / PowerShell

Ouvrir le dossier `skillquest-starter` dans VS Code, puis son terminal :

```powershell
npm ci
Copy-Item backend/.env.example backend/.env
Copy-Item frontend/.env.example frontend/.env.local
```

Renseigner les connexions PostgreSQL et générer un secret pour `JOIN_CODE_PEPPER` :

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Conserver ce secret : changer le pepper invalide les codes existants et leur déchiffrement. Pour renouveler un pepper exposé sur une base existante, sauvegarder puis faire une rotation des codes avec les nouveaux paramètres ; ne pas espérer déchiffrer les anciens codes avec la nouvelle clé.

Après avoir vérifié que les connexions pointent vers votre base d'essai :

```powershell
npm run db:generate
npm run db:deploy
```

Sur une base neuve de développement uniquement, choisir votre propre adresse, mot de passe et code dans `backend/.env`, puis définir `ALLOW_DEMO_SEED=true` et exécuter :

```powershell
npm run db:seed
npm run dev
```

Ouvrir `http://localhost:3000/entretien`. Administration : `/admin/login`, avec les identifiants configurés. Aucun compte ou code universel n'est affiché dans l'interface.

Le seed crée un exemple bilingue avec quatre décisions par parcours. Il refuse la production et n'écrase pas une démonstration existante. Il ne doit pas servir à réinitialiser les données réelles ni le mot de passe d'un compte existant.

## Mettre à jour une installation existante

Lire **docs/MISE_A_JOUR.md** avant toute commande de migration. Ne pas remplacer votre base ni exécuter un reset. Les migrations sont préparées dans l'archive ; elles ne sont pas appliquées automatiquement à votre installation.

Les anciennes données restent présentes. Une version manquante est reconstruite uniquement à partir de ce qui existe au moment de la migration et porte un avertissement : aucune correction ne peut retrouver des textes ou des impacts déjà écrasés avant cette mise à niveau.

## Vérifications

```powershell
npm run typecheck
npm test
npm run build
```

`npm test` démarre PostgreSQL embarqué PGlite en mémoire et son interface TCP sur une adresse locale choisie par le test. Il remplace la configuration avant d'importer l'application. Il n'utilise pas votre `DATABASE_URL`, ne modifie pas votre base et n'appelle aucun service de production.

PGlite utilise un moteur PostgreSQL mais une connexion d'exécution interne unique. Les tests vérifient les parcours, migrations et invariants ; une validation de charge avec plusieurs connexions PostgreSQL natives reste à réaliser dans votre environnement de préproduction.

Pour le test navigateur, après le build :

```powershell
npx playwright install chromium
npm run test:browser
```

Ce test crée aussi sa propre base temporaire. Il lance les deux serveurs localement, effectue les parcours desktop/mobile, puis les arrête. Un Chromium local existant peut être fourni via `CHROMIUM_EXECUTABLE`. `SMOKE_OUTPUT_DIR` permet de produire des captures et un PDF d'essai ; il est facultatif.

## Limites explicites

- Un parcours sauvegardé correspond à une participation, pas à une identité vérifiée. Une personne peut recommencer avec un nouveau parcours et être comptée plusieurs fois.
- Les seuils de profil sont exploratoires et documentés ; ils ne constituent pas une validation scientifique.
- La limite de débit utilise la mémoire d'une instance. Plusieurs instances nécessitent un stockage partagé, par exemple Redis, configuré pour le déploiement choisi.
- La durée de conservation des données doit être définie par l'organisateur. L'expiration d'un jeton ne supprime pas le parcours.
- Le PDF utilise l'impression du navigateur, avec une feuille de style A4 ; ce n'est pas un service PDF externe.
- Aucun déploiement ou changement de configuration des services existants n'est réalisé par cette archive.

Voir `docs/CORRECTIONS.md`, `docs/ARCHITECTURE.md`, `docs/API_EXEMPLES.md` et `docs/DEPLOYMENT.md`.
