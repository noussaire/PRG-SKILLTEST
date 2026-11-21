# Envoyer les rapports SkillQuest avec Brevo

Le participant saisit son adresse avant le test et accepte l’utilisation de ses données. Après les 31 réponses, le site génère le bilan puis attend la synthèse IA. Dès que cette synthèse est prête, le serveur transmet à Brevo un e-mail contenant le rapport complet : synthèse, 31 compétences, indicateurs, situations, choix et conseils. Le message est en français ou en arabe selon la langue choisie au démarrage. Le navigateur peut être fermé.

Le rapport reste lisible dans le corps HTML du message. Un PDF A4 complet est aussi joint automatiquement : il contient le logo blanc, la synthèse et les 31 compétences, avec la police française/arabe embarquée et une pagination. Le destinataire peut ouvrir ce fichier, l’enregistrer et l’imprimer hors ligne. Aucun lien d’accès privé ni jeton de session n’est transmis à Brevo.

## Activer le service

### PDF imprimable et logo blanc

Le PDF est généré côté serveur, avec `backend/assets/skillquest-logo-white.png` et la police libre `backend/assets/fonts/NotoSansArabic.ttf` (licence OFL jointe). Ces fichiers doivent accompagner le dossier `dist` lors d’une mise en production. Le navigateur de génération ne charge aucune ressource extérieure et n’exécute aucun script du rapport.

Sur Windows, le serveur utilise Chrome ou Edge s’il est installé. Sur un serveur Linux, installer Chromium une fois avec `npm run pdf:install -w backend` et les dépendances système requises par Playwright. `REPORT_CHROMIUM_EXECUTABLE` permet d’indiquer un navigateur déjà installé. Aucun nouveau service payant n’est nécessaire. Un échec de génération conserve le rapport et diffère l’envoi ; aucun e-mail ne prétend avoir un PDF s’il n’a pas été créé.

Pour afficher aussi le logo directement dans Gmail, renseigner `REPORT_EMAIL_LOGO_URL` avec l’URL HTTPS publique du PNG blanc. Le fichier destiné à l’hébergement est `frontend/public/brand/skillquest-logo-white.png` ; une bibliothèque d’images Brevo convient aussi. Ne jamais utiliser une URL `localhost`, une adresse inventée, une URL avec identifiants, une image `data:` ou un faux identifiant CID dans le HTML envoyé. Le logo du PDF est embarqué et reste disponible même sans cette configuration.

Vérification locale du 29 octobre 2026 : l’origine du frontend est `http://localhost:3000` ; aucune origine HTTPS publique n’est configurée. Le domaine présent dans la valeur CORS par défaut ne se résout pas. Aucun hébergement ni déploiement n’a été effectué. L’emplacement pour la future URL du logo est prêt, sans bloquer l’envoi du PDF.

Sources : [pièces jointes PDF de l’API Brevo](https://developers.brevo.com/reference/send-transac-email), [hébergement d’images dans Brevo](https://developers.brevo.com/reference/upload-image-to-gallery), [génération PDF Playwright](https://playwright.dev/docs/api/class-page#page-pdf).

1. Créer un compte Brevo avec l’offre gratuite.
2. Dans les paramètres Brevo, ouvrir **Expéditeurs, domaines et IP**, ajouter un expéditeur nommé **SkillQuest · Chabab Connect**, puis valider son adresse grâce au message reçu. Si l’association possède déjà un domaine, utiliser une adresse de ce domaine et suivre les indications Brevo pour son authentification.
3. Dans **Paramètres → SMTP & API → Clés API & MCP**, créer une clé API pour SkillQuest et la copier au moment de sa création. Il s’agit de la clé API, pas du mot de passe SMTP. [Ouvrir les clés API](https://app.brevo.com/settings/keys/api).
4. Compléter les trois variables ci-dessous dans `backend/.env`, ou dans les variables privées du serveur d’hébergement :

```dotenv
BREVO_API_KEY="VOTRE_CLE_API_BREVO"
BREVO_SENDER_EMAIL="adresse-expediteur-validee@example.org"
BREVO_SENDER_NAME="SkillQuest · Chabab Connect"
```

Ne pas mettre la clé dans le frontend, dans une variable `NEXT_PUBLIC_*`, dans Git ou dans le chat. Les champs sont préparés dans la configuration locale. L’API doit être relancée après leur modification. Le lanceur local charge ces variables ; en production, les définir dans l’environnement du service backend.

Pour une clé restreinte, la ressource **E-mails transactionnels** doit permettre l’envoi (**All/Tous** dans les niveaux actuels de Brevo). La lecture de la ressource **Account/Compte** n’est pas nécessaire au fonctionnement de SkillQuest : un refus sur `GET /senders` ne prouve donc pas que l’envoi est interdit. Le mode de test officiel valide l’appel d’envoi sans message distribué, avec `"headers": {"X-Sib-Sandbox": "drop"}` dans le corps JSON. Le site en production ne met pas ce marqueur et effectue les envois demandés.

La migration `20261029020000_report_email` et la génération du client Prisma sont nécessaires sur la base cible avant de déployer cette version. Elles ont déjà été appliquées à la base locale du projet. Pour un autre environnement, vérifier sa configuration `DATABASE_URL` avant `npm run db:deploy -w backend`.

## Vérifier le fonctionnement

Faire une nouvelle participation avec sa propre adresse, terminer les 31 réponses puis attendre la synthèse IA. Consulter la boîte de réception, le dossier indésirable et les journaux transactionnels Brevo. Le site indique l’attente puis l’acceptation par le service d’envoi. Un message accepté par Brevo n’est pas une preuve de réception dans Gmail ; le fournisseur peut le mettre en attente ou le destinataire peut le classer comme indésirable.

Les anciens participants et rapports ne sont pas inscrits automatiquement à l’envoi. Les nouveaux appels à l’API demandent explicitement `emailReport: true` ; la valeur par défaut est `false` pour préserver les anciens clients. Un rapport en attente de configuration peut être pris en charge après activation si sa nouvelle participation avait demandé l’envoi.

## Gratuité et limites

L’offre gratuite annonce 300 e-mails par jour, partagés avec les autres envois du compte, avec réinitialisation quotidienne et sans report du volume inutilisé. Le compte, son activation transactionnelle et son expéditeur doivent être valides. Un envoi par rapport utilise un e-mail ; la limite Groq de la synthèse IA reste indépendante.

Une adresse Gmail peut recevoir le rapport. Pour l’expéditeur, Brevo recommande un domaine possédé et authentifié. Les adresses gratuites utilisées comme expéditeur peuvent être remplacées temporairement par une adresse Brevo ; cette mesure ne garantit pas la réception et n’est pas une solution permanente d’authentification.

Sources officielles vérifiées pour l’intégration :

- [Limites de l’offre gratuite](https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan)
- [Créer et vérifier un expéditeur](https://help.brevo.com/hc/en-us/articles/208836149-Create-a-new-sender-From-name-and-From-email)
- [Créer une clé API](https://help.brevo.com/hc/en-us/articles/40159485019794-Create-and-manage-your-API-keys)
- [Permissions des clés API](https://help.brevo.com/hc/en-us/articles/40158277171474-About-API-key-permissions)
- [Mode de test sans envoi](https://developers.brevo.com/docs/using-sandbox-mode)
- [Envoi transactionnel par API](https://developers.brevo.com/reference/send-transac-email)
- [Protection contre les doublons](https://developers.brevo.com/docs/heterogenous-versions-batch-emails)
- [Authentification des expéditeurs et adresses gratuites](https://help.brevo.com/hc/en-us/articles/14925263522578-Comply-with-Gmail-Yahoo-and-Microsoft-s-requirements-for-email-senders)

## Reprises et états

L’état est conservé en PostgreSQL, indépendamment du navigateur et du processus serveur. Le travail d’envoi utilise un verrou temporaire et une clé d’idempotence UUID stable. Les erreurs temporaires et les limites de débit sont réessayées. Un manque de crédits diffère les envois ; le bilan reste accessible sur le site.

Si une requête a peut-être été acceptée sans réponse, les reprises utilisent la même clé pendant une fenêtre prudente de dix minutes. Après cette fenêtre, le travail passe à `UNKNOWN` et ne se renvoie pas automatiquement, afin de ne pas risquer un double envoi après l’expiration de l’idempotence chez Brevo. Vérifier alors les journaux Brevo. `FAILED` correspond à un refus définitif ou à l’épuisement des reprises ; aucun état `SENT` n’est inventé. `SENT` signifie accepté par Brevo, pas livré dans la boîte de réception.

La suppression d’une participation supprime ses travaux en attente. Elle ne rappelle pas un message déjà confié au fournisseur.

## Tests sans envoi réel

`node --import tsx --test backend/tests/report-email.test.ts` utilise une base temporaire et des réponses Brevo simulées. Il couvre l’adresse du formulaire, le contenu bilingue complet, l’échappement HTML, la concurrence, les reprises et la déduplication, les quotas, les erreurs définitives, la suppression et les anciennes participations.

Le parcours navigateur complet a également été vérifié avec deux envois simulés : adresse provenant du formulaire, traitement serveur, mise à jour de l’état dans le rapport ouvert, absence de nouvel envoi après rechargement, vues FR/AR et impression des 31 compétences. Les messages HTML complets mesurent environ 35 à 39 ko et ont été vérifiés sur mobile et ordinateur.

La connexion réelle à l’API d’envoi Brevo a été acceptée en mode sandbox (HTTP 201), sans distribution de message. La file locale est activée. La réception effective d’un rapport dans une boîte e-mail doit être constatée avec une nouvelle participation réelle ; les tests de configuration n’envoient aucun rapport historique.
