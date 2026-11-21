# SkillQuest — test complet exclusivement local

**Validé sur ce PC : PASS.** Un OTP réel aléatoire, sa validation normale dans le
formulaire, 31 réponses via l'interface, une connexion ADMIN normale et deux exports
PDF FR/AR de neuf pages chacun. Aucun compte, secret ou service de production utilisé.

## Démarrage manuel : une commande

Ouvrir PowerShell dans le dossier `skillquest-starter` puis exécuter :

```powershell
node backend/scripts/local-synthetic-e2e.mjs
```

Choisir personnellement un **mot de passe administrateur fictif local**, d'au moins
12 caractères, dans l'invite masquée. Il n'est pas affiché, enregistré dans un
fichier ou transmis en argument de commande. Ne pas utiliser le mot de passe de
production.

Le lanceur utilise les dépendances et PostgreSQL portable déjà installés. Il crée
un cluster neuf sur un port libre, vérifie sa destination physique et son schéma
vide, puis applique les **23 migrations existantes uniquement à cette base locale**.
Il crée le marqueur synthétique et l'unique compte `admin@example.test` via le service
officiel de bootstrap. Aucun seed de démonstration n'est exécuté ; les 31 questions
proviennent du catalogue applicatif existant.

Le frontend, le backend et PostgreSQL écoutent exclusivement sur `127.0.0.1`.
Les URL exactes et les ports sont affichés après le démarrage. Garder ce terminal
ouvert : le secret staging local est généré aléatoirement et conservé uniquement
dans la mémoire des processus de cette session. Aucune valeur n'est copiée depuis
Vercel ou Neon et aucun `.env` existant n'est chargé.

## Parcours à effectuer

1. Ouvrir **une fenêtre privée** du navigateur et y copier l'URL affichée se
   terminant par `/entretien/soft-skills`.
2. Choisir Français et remplir exactement :
   - nom : `SYNTH-Participant` ;
   - e-mail : `participant@example.test` ;
   - cocher majorité et consentement pour ce participant fictif ;
   - laisser décochée l'option d'envoi du rapport par e-mail.
3. Soumettre le formulaire **une seule fois**. Le champ du code apparaît et le
   test ne commence pas encore.
4. Dans le terminal où tourne le lanceur, taper cette commande interne :

   ```text
   otp
   ```

   Le moteur du lanceur validé réalise une connexion ADMIN normale, puis
   `publish-otp → receive → mail` avec l'identité et les trois UUID exacts. Les
   signatures et contrôles serveur restent actifs. Le transport de ce wrapper
   traduit uniquement les chemins approuvés vers son backend local vérifié :
   l'origine Vercel présente dans le module du lanceur n'est jamais contactée.
   Il n'utilise pas l'ancien script générique qui envoyait seulement `{ id }`.
5. Copier l'URL privée `127.0.0.1` affichée dans la barre d'adresse du navigateur.
   Elle affiche le code une fois, sans journalisation, et ferme son serveur après
   consultation ou 60 secondes. Saisir les six chiffres dans le formulaire SkillQuest
   d'origine et valider avant les **10 minutes** d'expiration du challenge.
6. Répondre aux **31 questions**, puis cliquer sur **Générer la synthèse**. Cette
   synthèse est explicitement simulée : aucun appel Groq.
7. Télécharger le PDF en français, puis changer de langue pour télécharger la
   version arabe. Il s'agit de deux exports localisés du même questionnaire,
   pas de deux participations différentes.
8. Dans le terminal, taper `check` pour confirmer `answers: 31`, `verified: true`,
   `challenges: 1` et `otpCaptures: 1`. Les deux liens PDF sont aussi affichés :
   les ouvrir dans la **même fenêtre privée** ayant effectué le questionnaire.
9. Pour examiner l'administration, ouvrir l'URL locale `/admin/login` affichée,
   avec `admin@example.test` et le mot de passe local choisi au démarrage.
10. Taper `stop` dans le terminal, ou utiliser Ctrl+C. Les processus créés sont
    arrêtés, les ports contrôlés et la base jetable supprimée.

Le délai de dix minutes concerne la validation du code, pas l'achèvement des
31 questions. Le terminal doit rester ouvert pendant tout le parcours.

Commandes internes :

- `otp` : un seul parcours de livraison autorisé pour cette session locale ;
- `code` : rouvrir la vue privée du même code encore valide, sans nouvel OTP ;
- `check` : lecture des compteurs/progrès et affichage des liens PDF ;
- `stop` : arrêt et suppression vérifiée de la base locale.

Si la livraison échoue ou si le code expire, ne pas bricoler les tables ni relancer
des notifications : arrêter ce sandbox et en démarrer un neuf. Aucun retry OTP
automatique ni remise à zéro de compteur n'est ajouté au parcours.

## Vérification automatique, déjà exécutée avec succès

Pour rejouer l'intégralité du test fictif sans saisie personnelle :

```powershell
node backend/scripts/local-synthetic-e2e.mjs --self-test
```

Ce mode crée également un mot de passe fictif aléatoire en mémoire. Un navigateur
de test neuf ouvre le vrai frontend, soumet les consentements fictifs, demande le
code, utilise le même opérateur local, saisit le vrai code et valide les 31 choix
dans l'interface. Les cookies restent gérés par le navigateur ; aucun cookie d'un
navigateur personnel n'est récupéré ou exporté.

Le test télécharge les deux PDF par les routes BFF authentifiées normales, vérifie
le format PDF, les polices/images incorporées, neuf pages et du texte FR/AR, puis
teste la connexion au tableau de bord ADMIN. Les PDF, captures du résultat et
compteurs sont conservés sous `output/local-synthetic/run-.../results` ; la base et
les processus sont supprimés automatiquement en fin de test.

Résultat de référence :

- **PASS :** 23 migrations, un administrateur, un challenge et une capture OTP ;
- **PASS :** aucun participant créé avant vérification, puis e-mail vérifié normalement ;
- **PASS :** 31 réponses enregistrées et rapport COMPLETE ;
- **PASS :** PDF français et arabe, neuf pages chacun ; contrôle visuel des 18 pages ;
- **PASS :** connexion ADMIN locale normale ;
- **PASS :** arrêt des applications et de PostgreSQL, ports fermés, données supprimées.

Preuves du premier parcours complet :
[compteurs](../output/local-synthetic/run-AsG8y2/results.json) et
[nettoyage](../output/local-synthetic/run-AsG8y2/shutdown.json).
Le navigateur de test bloque les requêtes externes, y compris les polices Google
déclarées par le frontend. Les PDF incorporent leurs propres polices.

## Isolation et prérequis

- Node 24, Next/Playwright et dépendances déjà installées ; aucun `npm install`.
- PostgreSQL 17.11 portable déjà présent sous
  `output/pg-native-ef583905f4cd/portable/pgsql/bin`.
- Chrome ou Edge déjà installé, `pdfinfo` et `pdftotext` disponibles sur ce PC.
- Source backend validé : checkout local propre
  `output/receive-otp-final-candidate`, commit
  `46b1ddebe1cb1f53b22acb5d1cba6e49be7597a5`.
- Frontend existant copié sans ses `.env`, `node_modules`, `.next` ou fichiers privés.

Le lanceur copie les sources dans son espace jetable ; il ne modifie pas le
checkout validé, les sources frontend, les `.env` existants ou les paramètres
Vercel. Le client Prisma est relocalisé à côté de cette copie sans `.env` et reçoit
uniquement une URL loopback vérifiée. Aucun DSN arbitraire ou environnement hérité
de production n'est accepté. Les requêtes HTTP applicatives sortantes non locales
sont bloquées côté backend ; aucune clé Brevo, Groq ou QStash n'est fournie.

Le serveur local charge les vraies routes et services avec un vrai client PostgreSQL.
Il ne démarre aucun worker automatique : le challenge reste en attente jusqu'à
la commande `otp`. Les comptes, tokens et secrets sont exclusivement fictifs.
Le secret staging n'est jamais écrit sur disque ; un processus local privilégié
reste néanmoins dans le périmètre de confiance du poste.

Sous le sandbox Windows de l'agent, PostgreSQL peut demander l'exécution hors
sandbox ; dans votre PowerShell Windows normal, utiliser les commandes ci-dessus.
Ne pas terminer tous les processus `node.exe` : le lanceur arrête seulement les
processus qu'il a créés. En cas d'arrêt brutal du PC, conserver le dossier de run
pour vérifier son propriétaire et arrêter le cluster avant tout nettoyage manuel.

Fichiers ajoutés uniquement pour ce test local :
`backend/scripts/local-synthetic-e2e.mjs`, `local-synthetic-app.ts`,
`local-synthetic-loader.mjs`, `local-synthetic-browser.mjs`, et ce guide.
Le commit backend préparé précédemment reste inchangé. Aucun push, déploiement,
changement Neon/Vercel ou secret de production. Budget : **0 DH**.
