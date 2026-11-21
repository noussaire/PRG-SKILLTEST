# Étape 5A — build et moteur Prisma, qualification locale

Cette étape conserve Prisma 6.19.3, son moteur Rust, les transactions et les
points d'entrée existants. Aucun fournisseur, migration ou déploiement n'est
activé. Le choix Chromium/PDF Linux et le dimensionnement PostgreSQL sont hors
du périmètre 5A.

## Versions et cibles

Node **24.x** est déclaré à la racine et dans les deux workspaces, ainsi que
dans `.node-version`. La qualification Windows utilise 24.14.1. La plateforme
Vercel actualise les versions mineures et correctives : contrôler la version
effective au build et au runtime, sans prétendre fixer leur version exacte.

`prisma` et `@prisma/client` sont verrouillés à **6.19.3** dans le manifeste
backend et le lockfile. Aucun paquet n'a été mis à niveau. La fin de support
sécurité annoncée pour Prisma 6, le 19 novembre 2026, impose une décision
séparée avant production ; cette étape ne réalise aucune migration vers v7.

Le générateur contient `binaryTargets = ["native", "rhel-openssl-3.0.x"]` :

- `native` conserve Windows et permet une qualification Linux locale adaptée
  au système qui exécute le build ;
- `rhel-openssl-3.0.x` prépare le moteur Linux x64/OpenSSL 3 attendu pour la
  cible Node Vercel envisagée. Confirmer l'ABI, l'architecture et le runtime
  réellement fournis en staging. Une modification de plateforme exige de
  requalifier la cible.

`backend/vercel.json` sélectionne toujours `npm run build:vercel`, qui exécute
`prisma generate` **avant** `tsc`. Garder les devDependencies disponibles au
build, car le CLI Prisma et TypeScript en font partie. Aucun `migrate`, seed,
serveur ou worker ne fait partie de ce build. Les `includeFiles` existants
incluent les fichiers `.node`, le schéma généré, `shared` et les ressources.

## Procédure reproductible, sans Docker obligatoire

Sur un hôte **Linux x64 réel** (machine, VM ou distribution WSL déjà installée),
utiliser une copie propre sans `.env` réel, Node 24.x et le lockfile fourni :

```sh
npm ci --ignore-scripts
npm run qualify:build -w backend
```

Sur Windows, la même commande de qualification fonctionne avec les dépendances
déjà installées. Elle ne lance ni `npm install`, ni PostgreSQL, ni navigateur,
ni fournisseur. La génération Prisma peut télécharger son moteur auprès du
distributeur Prisma ; elle n'a besoin d'aucune donnée ou connexion de base.
Ne pas exécuter ce script dans un déploiement : il crée une copie locale de
qualification et consomme de l'espace disque.

Le script crée `output/build-qualification/run-*`, copie les sources nécessaires
et les dépendances installées, exclut les `.env` et le client `.prisma` généré,
puis utilise exclusivement des variables synthétiques. Il conserve ses preuves
et ne supprime aucun répertoire existant.

Deux cycles exécutent la véritable commande `build:vercel` :

1. client généré absent ; génération puis compilation ;
2. mêmes dépendances et caches réutilisés, avec client volontairement marqué
   obsolète ; preuve que `prisma generate` remplace ce client.

Il s'agit d'un **cache de client généré froid puis réutilisé**, pas d'une
simulation du cache npm complet ou du cache distant Vercel. Leur comportement
reste à mesurer avec le builder réel. Le script distingue ces preuves dans
son JSON (`dependencyInstallCacheTested: false`, `vercelBuilderExecuted: false`).

Chaque cycle construit un paquet matériel à partir du traçage NFT et des
inclusions de ressources. Les fichiers sont copiés, avec taille et SHA-256,
dans un artefact distinct. Vérifications : moteur ELF64 x86_64 Linux présent,
Prisma 6.19.3, `shared`, logo, police arabe et licence présents, absence du
serveur local, remplacement du client obsolète. Les avertissements optionnels
de traçage restent enregistrés, sans être assimilés à une qualification de
Chromium Linux.

La sonde d'import résout Prisma **dans l'artefact** et interdit minuteurs,
écoute réseau, connexions, requêtes Prisma, fetch et lancement de processus.
Elle contrôle également les gestionnaires de signaux et `trust proxy=false`.
Le moteur natif hôte est chargé sans connexion à une base. Sous Windows,
le moteur Linux est contrôlé comme fichier ELF, **jamais déclaré chargé ou
exécuté**. Sous Linux, le chargement de la cible Linux est effectivement testé.
Les preuves JSON distinguent `linuxExecuted` et `linuxNativeLoaded`.

## Conditions restant à vérifier sur Vercel

- Root Directory backend, accès monorepo hors racine et commande de build ;
- moteur Linux, architecture/OpenSSL et résolution depuis le paquet final du
  builder Vercel, qui n'est pas remplacé par le traçage NFT local ;
- build sans cache puis avec cache Vercel et changement de schéma contrôlé ;
- version Node effective dans les deux projets, import et requête synthétique ;
- taille finale, démarrage à froid et droits du système de fichiers ;
- PostgreSQL externe/pooling, Chromium Linux, réveil durable des jobs et
  provenance réseau, qui restent des qualifications séparées.

L'absence de Linux local signifie **non exécuté**, jamais réussi. Les tests
Windows, y compris PDF FR/AR et PostgreSQL natif synthétique, ne remplacent
aucun de ces contrôles.

Références : [Node sur Vercel](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions),
[Prisma sur Vercel](https://www.prisma.io/docs/orm/v6/prisma-client/deployment/serverless/deploy-to-vercel),
[cibles du générateur](https://www.prisma.io/docs/orm/v6/prisma-schema/overview/generators),
[support Prisma](https://www.prisma.io/docs/orm/release-status).
