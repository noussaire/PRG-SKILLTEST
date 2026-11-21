# Opérateur synthétique — préparation locale, aucune exécution production

Renforcement local de réception : voir [contrat strict et résultats](RECEIVE-OTP-SECURITE.md).
Le backend annoncé déployé `6b9e1a0` doit être mis à jour après autorisation avant
d'utiliser le lanceur renforcé. Les notifications anciennes sans liaison de cible
sont refusées ; aucune conversion ou opération production automatique n'est prévue.

Mise à jour : le correctif local de publication ciblée est maintenant préparé,
sans déploiement. Voir [PUBLICATION-OTP-SYNTHETIQUE.md](PUBLICATION-OTP-SYNTHETIQUE.md)
pour la route `publish-otp`, les tests et le plan de déploiement soumis à autorisation.
Les limites de publication ci-dessous décrivent le mécanisme officiel antérieur
et l'environnement distant non modifié. La commande globale `publish` reste refusée.

## État et limites de la preuve

Le propriétaire confirme une connexion normale de `admin@example.test` sur
`https://skillquest-frontend-pi.vercel.app/admin/dashboard`, avec deux participations
et deux tests terminés. Cela confirme fonctionnellement le parcours administrateur
de cet environnement au moment de son essai : formulaire, relais frontend,
authentification backend, session et accès au tableau de bord.

Les révisions `d0b92e2` (frontend) et `65ffdab` (backend) sont celles indiquées par
le propriétaire. Leur association aux déploiements actifs n'a pas été vérifiée
indépendamment ; ces objets Git ne sont pas disponibles dans les exports locaux
examinés. Vérifier personnellement les deux SHA dans les déploiements Vercel actifs,
en lecture seule, pour attribuer cette preuve aux révisions exactes. Les nombres
affichés ne prouvent pas la livraison d'un OTP, le mode synthétique ni le rattachement
d'une notification à SYNTH-Participant.

Cette préparation ajoute seulement un lanceur, ses tests et ce document. Aucun appel
production, connexion, cookie, notification, migration, secret distant, changement
Vercel ou fournisseur réel n'est utilisé par les tests. Attendre l'autorisation
explicite du propriétaire avant toute utilisation du lanceur contre la production.

## Procédure officielle examinée

Le script officiel a été retrouvé dans
`output/coordinated-release/backend/backend/src/scripts/synthetic-operator.ts`.
Il n'est pas présent dans `backend/src/scripts` du dossier courant. Il signe les
POST avec `stagingProof`, exige un Bearer ADMIN et écrit chaque réponse dans
`.synthetic-private`. Il ne réalise pas lui-même la connexion administrateur.

Le nouveau lanceur emploie les mêmes routes et le même protocole de signature,
sans lancer de sous-processus ni modifier ce script. Un test compare directement
ses signatures à `backend/src/security/synthetic-staging.ts:stagingProof`.

**Blocage de la publication ciblée :** la route officielle
`/api/internal/synthetic/notifications/publish` accepte seulement `{}` et appelle
`publishBatch(..., 3)`. Elle peut publier jusqu'à trois intentions de n'importe
quel job éligible, y compris des rapports ou d'autres participants. Un contrôle
local de la file ne supprime pas la course avec une nouvelle intention créée
après ce contrôle. Il n'existe pas de publication officielle ciblée par UUID
dans le code examiné. Le lanceur refuse donc toujours `publish`, même avec les
drapeaux d'autorisation. Il refuse aussi `job` et `cleanup`.

La réception ciblée est préparée uniquement pour une notification **déjà publiée**.
Si aucune notification cible n'existe, s'arrêter. La publication exclusive demandée
nécessiterait une évolution distincte du backend autorisant un ciblage atomique
et vérifiant son rattachement au challenge. Elle ne peut pas être obtenue avec
le code actuel tout en respectant l'absence de redéploiement et de traitement
des autres notifications. Ne pas remplacer cela par un traitement SQL manuel
ou un appel global. La procédure complète reste bloquée à cette étape si la
notification n'est pas déjà publiée.

## Provenance autorisée de la configuration

- Origine fixée dans le code : `https://skillquest-backend-nine.vercel.app`.
  Aucun hôte arbitraire, redirection, cookie ou fournisseur n'est accepté.
- Compte fixé : `admin@example.test`. Mot de passe déjà connu, saisi personnellement
  dans un terminal interactif par saisie masquée. Aucun essai de mot de passe deviné.
- `SKILLQUEST_STAGING_ID` : identifiant déjà conservé lors de l'installation ou
  consulté personnellement dans la configuration Vercel autorisée. Ce n'est pas
  une valeur à inventer. Il doit correspondre au marqueur existant.
- `SKILLQUEST_STAGING_SECRET` : valeur **existante**, provenant de votre gestionnaire
  de secrets ou de la conservation sécurisée d'origine. Le lanceur la demande en
  saisie masquée ; il ne lit ni Vercel ni Neon, ni fichier `.env`. Si la valeur est
  uniquement dans Vercel, sa présence ne signifie pas qu'elle est disponible au
  lanceur. Ne pas l'exporter ou la révéler dans cette mission ; sans exemplaire
  autorisé déjà détenu, s'arrêter. Ne pas générer de remplacement.
- Session ADMIN : obtenue par `POST /api/v1/admin/auth/login`, authentification
  normale. Le jeton reste dans la mémoire du processus et ne passe ni dans les
  arguments, ni dans un fichier, ni dans l'environnement d'un enfant, ni dans
  les sorties. Le lanceur ne récupère pas la session de votre navigateur.

Ne saisir aucun secret dans le chat ou dans une commande PowerShell. Ne pas
utiliser `vercel env pull`, de capture réseau ni de SELECT de colonnes sensibles.
Utiliser un terminal personnel sans capture d'écran ni enregistrement de session.
Les chaînes JavaScript et les copies internes de `fetch` ne peuvent pas être
effacées de façon garantie ; le lanceur relâche les références et remet à zéro
ses buffers cryptographiques. Cela ne protège pas contre un dump mémoire ou
un autre processus local privilégié. L'OTP privé est consultable une fois sur
loopback pendant 60 secondes, sans fichier ni journal. Cela ne prolonge pas
la validité du challenge. Fermer ensuite l'onglet privé.

## Contrôles préalables personnels, sans changement Vercel

Vérifier les métadonnées du déploiement **courant** du backend, pas seulement les
variables destinées au prochain déploiement :

- `SKILLQUEST_STAGING_MODE=synthetic-v1` ;
- `SKILLQUEST_DEPLOYMENT_PURPOSE=synthetic-staging` ;
- `SKILLQUEST_STAGING_ACK=SYNTHETIC_DATA_ONLY_NO_EXTERNAL_PROVIDERS` ;
- ID et secret existants, et `SKILLQUEST_STAGING_VERCEL_PROJECT_ID` correspondant
  au `VERCEL_PROJECT_ID` backend et au marqueur Neon ;
- absence des clés `BREVO_API_KEY`, `GROQ_API_KEY`, `QSTASH_TOKEN`,
  `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY` ;
- base autorisée et exclusivement synthétique ; le serveur contrôle les adresses
  `@example.test` et les noms `SYNTH-` avant chaque opération ;
- routes synthétiques déployées, migrations nécessaires déjà présentes ;
- clés OTP et `JOIN_CODE_PEPPER` valides côté backend, sans consulter leurs valeurs ;
- budget e-mail synthétique positif selon la formule
  `min(EMAIL_APP_DAILY_LIMIT, EMAIL_ACCOUNT_DAILY_LIMIT - EMAIL_OTHER_USAGE_MARGIN)`
  et quotas OTP non épuisés. Le mode simulé conserve ces contrôles et ne les augmente pas.

Le lanceur exige les trois déclarations locales du mode et refuse les clés
fournisseurs héritées du terminal. Ces déclarations ne prouvent pas à elles seules
le mode distant : la vérification personnelle ci-dessus est requise avant la
connexion. Ensuite, le POST signé `status` exige `simulated: true` ; le serveur
vérifie la configuration, le marqueur, la base synthétique et la session ADMIN.
L'ID d'installation sert à la dérivation cryptographique ; l'en-tête
`x-skillquest-staging-id` contient quant à lui un UUID de requête neuf, conformément
au protocole officiel.

## Ciblage du participant et consultation des seules métadonnées

Après autorisation des écritures applicatives, garder ouvert le formulaire du
participant. Utiliser exactement `SYNTH-Participant` et son adresse synthétique
réelle `@example.test`, pas une adresse inventée différente de celle de son challenge.
Ne pas réinitialiser sa session navigateur ni demander plusieurs nouveaux codes.

Pour un OTP initial, noter le `challengeId` renvoyé par la réponse applicative
normale de demande de code. C'est une métadonnée, pas un cookie ni un OTP.
La présence des deux anciens tests terminés ne permet pas d'identifier ce challenge.

Le propriétaire peut exécuter cette requête de métadonnées, strictement en lecture
seule, dans Neon. Remplacer le placeholder uniquement par le challenge de ce
formulaire. Ne sélectionner aucune autre colonne :

```sql
BEGIN TRANSACTION READ ONLY;
SELECT j.id AS job_id, j."challengeId", j.status, j."expiresAt",
       p.id AS notification_id, p.state AS publication_state
FROM "ParticipantEmailDeliveryJob" j
LEFT JOIN "JobPublicationIntent" p
  ON p."jobId" = j.id AND p.kind = 'OTP_INITIAL' AND p.phase = 'DELIVER'
WHERE j."challengeId" = '<CHALLENGE_UUID>'::uuid
ORDER BY p."createdAt" DESC;
ROLLBACK;
```

Une intention n'est pas nécessairement une notification publiée. La sélection
doit correspondre à la génération active et au job non expiré. Le lanceur confirme
ensuite l'UUID exact, le job, `OTP_INITIAL`, `DELIVER`, la version et l'absence de
réception dans `status`. Cette vue ne contient que les vingt dernières notifications :
une cible absente fait arrêter le lanceur, sans recherche globale ni remplacement.

Le nom du participant n'est pas exposé par `status`. Le backend candidat renforcé
vérifie désormais l'identité à partir du payload chiffré, le gate du challenge actif
et une liaison cryptographique de la notification, à la publication puis à la réception.
Le lanceur transmet les trois UUID et l'adresse attendue lors de ces deux actions.
Il vérifie aussi l'adresse destinataire avant de rendre l'OTP consultable et ne
traite jamais de rapport ou d'OTP de reprise dans ce parcours initial.

## Commandes futures — ne pas exécuter avant autorisation

Depuis la racine du projet, Node 24 : les tests seuls sont sans production :

```powershell
node --experimental-transform-types --test backend/scripts/synthetic-admin-launcher.test.mjs
```

Préparation locale sans secret dans la commande :

```powershell
$env:SKILLQUEST_STAGING_MODE = 'synthetic-v1'
$env:SKILLQUEST_DEPLOYMENT_PURPOSE = 'synthetic-staging'
$env:SKILLQUEST_STAGING_ACK = 'SYNTHETIC_DATA_ONLY_NO_EXTERNAL_PROVIDERS'
$env:SKILLQUEST_STAGING_ID = '<ID_INSTALLATION_EXISTANT>'
```

Ne pas charger `backend/.env` : il contient des configurations de fournisseurs
réels. Si les contrôles locaux les détectent dans le terminal, utiliser un terminal
propre ; ne pas modifier les variables Vercel pour faire passer les contrôles.

Après autorisation explicite du propriétaire, pour chaque commande ci-dessous,
remplacer les placeholders puis saisir personnellement la confirmation masquée,
le secret existant et le mot de passe connu. Le lanceur crée une session par
commande et tente la déconnexion normale dans `finally`, sans toucher à la session
du navigateur. Ne pas lancer en boucle : l'authentification limite les essais à
dix par quinze minutes et les opérations synthétiques à trente par minute/session.

```powershell
node backend/scripts/synthetic-admin-launcher.mjs status <ADRESSE_EXAMPLE_TEST> <JOB_UUID> - --authorized-production-writes --confirmed-synthetic-deployment
```

Si la notification exacte est déjà publiée et tous les rattachements vérifiés :

```powershell
node backend/scripts/synthetic-admin-launcher.mjs receive <ADRESSE_EXAMPLE_TEST> <JOB_UUID> <NOTIFICATION_UUID> <CHALLENGE_UUID> --authorized-production-writes --confirmed-synthetic-deployment
```

Continuer uniquement si le résultat est `TARGET_DELIVERY_COMPLETE`. Ne pas forcer
un statut `UNCERTAIN`, `EXPIRED`, `BUSY`, `DEFERRED`, `REJECTED` ou un timeout ; un
timeout ne prouve pas l'annulation d'un commit. Aucune reprise automatique.

Lire ensuite le mail synthétique du même job :

```powershell
node backend/scripts/synthetic-admin-launcher.mjs mail <ADRESSE_EXAMPLE_TEST> <JOB_UUID> - --authorized-production-writes --confirmed-synthetic-deployment
```

Ouvrir personnellement l'URL `127.0.0.1` affichée. Elle contient uniquement le port,
pas le jeton, le secret ni l'OTP. La vue est liée à loopback, refuse les requêtes
cross-site, sert le code une seule fois en texte brut avec `no-store`, sans exécuter
le HTML du mail, puis ferme le serveur. Un processus local privilégié reste dans
le périmètre de confiance du poste. Ne pas enregistrer cette vue dans un rapport.

Saisir personnellement les six chiffres dans le formulaire SkillQuest d'origine,
avant les dix minutes d'expiration du challenge, puis poursuivre le questionnaire
normal. Ne pas modifier les cinq essais, les compteurs, le statut de vérification
ou l'état du participant. Si le code expire, arrêter et demander une nouvelle
autorisation de parcours, sans réinitialisation SQL.

## Écritures futures et limites résiduelles

Une connexion crée `AdminSession` ; sa déconnexion supprime cette session. Chaque
commande signée, même `status` ou `mail`, crée `SyntheticInvocation`. `receive`
déclenche les réservations, le job ciblé, la capture synthétique et la mise à jour
de la notification. La saisie correcte du code consomme le challenge et peut créer
la participation. Ces écritures normales nécessitent l'autorisation future.

En cas d'arrêt brutal du processus ou d'échec de déconnexion, la session créée
peut rester valide côté serveur jusqu'à son expiration normale (sept jours).
Son jeton n'est pas sauvegardé par le lanceur. Les contrôles serveur restent
indispensables : ce lanceur ne peut pas certifier une version distante modifiée.
Aucun nouveau staging n'est créé ni nécessaire sur la seule base d'une variable
locale manquante ; le blocage de publication ciblée doit être résolu séparément.
