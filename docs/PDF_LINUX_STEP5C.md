# Étape 5C — rendu PDF borné et candidat Chromium Linux

## Portée

Préparation locale uniquement. La qualification Windows est distincte d'une
exécution Linux. Aucune VM/distribution Linux exploitable n'a été identifiée ;
Docker/Podman ne sont pas supposés présents et aucun n'est installé. Ni Neon,
Brevo, QStash ou IA réels ne sont utilisés. Aucun déploiement.

Les réserves 5B restent ouvertes : le premier accès PostgreSQL peut dépasser
les délais configurés et une écriture peut terminer après un timeout appelant.
Cette étape n'ajoute pas de timeout, retry ou autre mécanisme PostgreSQL.

## Deux chemins explicitement séparés

Le défaut `REPORT_PDF_BROWSER_MODE=local` conserve le Playwright **1.62.1**
existant, `REPORT_CHROMIUM_EXECUTABLE` et la recherche Chrome/Edge Windows.
Aucun navigateur Windows n'a été mis à niveau par cette étape. La version
exacte du navigateur système est enregistrée lors de la qualification.

Le candidat `REPORT_PDF_BROWSER_MODE=serverless` accepte uniquement Linux x64,
Node 24 et aucune surcharge `REPORT_CHROMIUM_EXECUTABLE`. Il utilise :

- `@sparticuz/chromium` **153.0.0**, avec son binaire et ressources locaux ;
- l'alias indépendant `playwright-core-serverless`, pointant exactement vers
  `playwright-core` **1.63.0**, dont le manifeste cible Chromium 153.0.8010.12.

Cet alias évite de remplacer aveuglément le Playwright Windows. Le client
1.62.1 cible Chromium 151 et le client stable 1.64.1 inspecté cible Chromium 156 ;
ces numéros ne correspondent pas à la génération du candidat 153. Le choix
aligne la génération du protocole, sans prouver son fonctionnement Linux.

Les imports du candidat et l'extraction sont différés jusqu'au rendu explicite.
L'import du handler Express ne décompresse rien et ne lance aucun navigateur.
Aucun pack distant ou URL de navigateur n'est accepté au runtime. Le navigateur
lancé doit annoncer la majeure 153, sinon il est fermé avant création de page.
Cela évite une substitution silencieuse par un cache `/tmp/chromium` obsolète.

Le mode serverless est **désactivé par défaut** et ne constitue pas une
configuration de production activée. Les polices, ABI, bibliothèques et options
de compilation de ce binaire restent à valider réellement sur Linux.

## Budget et concurrence

`report-limits.ts` conserve le bail e-mail de **120 000 ms** et fixe :

- **45 000 ms** pour la préparation/résolution du navigateur/rendu ;
- **5 000 ms** supplémentaires au maximum pour attendre la fermeture ;
- un seul rendu propriétaire de la capacité par instance de module.

Il n'existe pas de file mémoire d'attente. Un rendu concurrent reçoit
`REPORT_PDF_BUSY` immédiatement. Le worker persistant le remet en RETRY sans
réserver de budget Brevo ni consommer définitivement les six tentatives de
livraison. Les compteurs de tentative restent strictement croissants pour
préserver le fencing ; aucun décrément ou recyclage de jeton n'est ajouté.

Une erreur de page, contenu, police, PDF ou version ferme le navigateur dans
les chemins contrôlables. Un timeout rejette le résultat et ferme aussi un
navigateur arrivé tardivement. Si la fermeture ne se confirme pas dans le
budget, la capacité est mise en quarantaine ; aucun deuxième navigateur n'est
lancé pour empiler les ressources. Une fermeture tardive confirmée la libère.
Une erreur de fermeture persistante nécessite le recyclage de l'instance.

Ces délais dépendent de la disponibilité de la boucle Node : ils ne préemptent
pas du code synchrone qui la bloquerait. SIGKILL, arrêt de Function ou OOM ne
garantissent pas l'exécution du finally. Les preuves de bail et l'éligibilité
PostgreSQL restent recontrôlées avant toute réservation fournisseur.

La marge nominale est de **70 secondes** dans le bail. Elle ne résout pas les
attentes PostgreSQL à froid de 5B et ne constitue pas un budget de bout en bout.
La limite d'une instance n'est pas une limite de toute la flotte Vercel : la
concurrence du futur transport durable devra aussi être plafonnée et mesurée.

## HTML, polices et qualité

Le HTML reste produit par le serveur à partir du rapport préparé ; les champs
participant sont échappés. La page a JavaScript désactivé, service workers
bloqués, contexte hors ligne et routes réseau avortées. Une CSP locale limite
images/polices aux données incorporées, interdit les scripts, bases et formulaires.
Les options de lancement désactivent les principaux mécanismes de réseau
d'arrière-plan. Il ne s'agit pas d'une preuve de pare-feu global de Vercel.

Le logo et les polices sont incorporés en data URI, sans Google Fonts ou autre
ressource distante. La police variable NotoSansArabic d'origine et sa licence
restent intactes. Deux instances PDF statiques dérivées, renommées
SkillQuestArabicPDF, utilisent les poids 400/700 et la largeur 100. Elles
conservent les tables GSUB/GPOS et les glyphes. Elles corrigent les avertissements
Type 3 observés avec Chromium Windows lors de l'inspection Poppler.

La recette est `backend/scripts/derive-pdf-fonts.py`, avec FontTools **4.68.0**
comme outil de développement, sans dépendance Python au runtime. Les axes,
empreintes et origine sont dans `assets/fonts/pdf-fonts-build.json`. Le logiciel
de police dérivé conserve la licence OFL et les crédits d'origine.

Le renderer refuse un PDF invalide, dépassant les **12 Mio** existants ou sans
police incorporée, logo et structure de balisage. La présence de StructTreeRoot
ne vaut **pas certification PDF/UA**. L'extraction arabe peut introduire des
espaces selon le lecteur ; les vérifications visuelles restent nécessaires.

Le candidat Sparticuz doit produire réellement les balises et signets attendus.
La disponibilité des options de compilation d'accessibilité n'est pas déduite
du seul argument `tagged: true` : l'absence de structure requise provoque un refus,
sans envoi automatique d'un document dégradé. Si le binaire ne satisfait pas ce
contrat, qualifier un build adapté ou une autre exécution Linux, sans bascule
silencieuse.

## Packaging

Les `includeFiles` Vercel conservent assets, shared et Prisma et ajoutent les
répertoires complets du candidat Chromium et du client Playwright aliasé. Ne pas
aplatir leur arborescence ou supprimer leurs binaires Brotli. Aucun téléchargement
de Chromium à chaque requête n'est prévu ; le package complet est embarqué.

`npm run qualify:build -w backend` matérialise deux paquets (client Prisma absent,
puis cache réutilisé), contrôle leur import et les SHA-256, décompresse les
ressources en flux pour mesurer leur expansion et vérifie ELF64 x86_64 sans
exécuter Chromium sous Windows. Le seuil de bundle contrôlé est le standard
**250 000 000 octets**. Il ne suppose aucune option Vercel large-functions bêta.

La taille déployée, la taille après décompression dans `/tmp` et la mémoire RAM
sont trois mesures différentes. Le builder Vercel réel, la résolution monorepo,
les bibliothèques AL2023 et les résidus de profils temporaires restent à qualifier.

## Qualification de rendu reproductible

Dans une copie sans secrets réels, avec Node 24, dépendances du lockfile et
navigateur local déjà disponible :

```sh
npm run qualify:pdf -w backend -- local
```

Sur **Linux x64 réel**, pour tester le candidat :

```sh
npm ci --ignore-scripts
npm run qualify:build -w backend
npm run qualify:pdf -w backend -- serverless
```

Cette méthode n'impose pas Docker. Une machine ou VM Linux déjà disponible
suffit, avec ses dépendances système appropriées. La seconde commande doit
réellement lancer Chromium avant de déclarer le rendu Linux qualifié.

La qualification crée uniquement des données synthétiques et des preuves sous
`output/pdf-render-qualification/run-*`. Elle contrôle FR/AR, textes longs,
ligatures, diacritiques, chiffres des deux écritures, rendu concurrent et une
interruption contrôlée. La mémoire mesurée additionne Node et ses descendants
(working sets Windows ou RSS `/proc` Linux), avec échantillonnage : les pages
partagées peuvent être comptées plusieurs fois, et ce n'est pas la mesure cgroup
d'une Function. Un résultat sans mesure disponible n'est pas déclaré mesuré.

Rasteriser les PDF avec Poppler et inspecter toutes les pages, avec détails
des textes mixtes et diacritiques. Vérifier également polices, balises, signets,
texte extrait et boîtes des mots. Les résultats Windows ne sont jamais renommés
« qualification Linux ».

## Avant staging réel

Prévoir au départ **2 Go** de mémoire pour le candidat et mesurer sous la limite
effective ; ce n'est pas une preuve que 2 Go suffisent en Linux. Qualifier durée
de Function et marge de finalisation par rapport au bail, sans oublier 5B.
Ne pas modifier les paramètres de production pour réaliser ces essais.

Sur des projets/base de staging neufs et synthétiques, après autorisation :

1. Confirmer Node 24, Linux x64, OpenSSL/libc, bibliothèques du navigateur et
   version complète réellement exécutée ;
2. Mesurer extraction froide, cache chaud, RAM cgroup, CPU, `/tmp`, profils
   résiduels et bundle exact du builder Vercel ;
3. Produire et inspecter PDF FR/AR réels, glyphes, ligatures, textes mixtes,
   sauts de page, polices incorporées, balisage et signets ;
4. Tester concurrence dans une instance puis plusieurs instances, timeouts,
   fermeture bloquée, OOM et interruption brutale ;
5. Vérifier absence de double réservation/envoi, reprise persistante et
   conservation des preuves UNCERTAIN ;
6. Vérifier l'absence d'egress navigateur inattendu et la confidentialité des
   artefacts/logs ;
7. Rejouer les réserves PostgreSQL à froid et les commits tardifs avant ouverture.

Aucune route de téléchargement binaire n'est ajoutée. Les PDF servent toujours
aux pièces jointes ; le plafond applicatif 12 Mio n'autorise pas un transfert
HTTP classique de cette taille par les Functions.

Références : [Sparticuz](https://github.com/Sparticuz/chromium),
[Playwright et navigateur fourni](https://playwright.dev/docs/api/class-browsertype),
[limites Vercel](https://vercel.com/docs/functions/limitations).
