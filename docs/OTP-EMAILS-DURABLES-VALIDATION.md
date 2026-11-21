# Validation locale OTP / e-mails durables

8 novembre 2026. Aucun fournisseur réel appelé, aucune base distante contactée,
aucun secret ou paramètre Vercel modifié, aucun push ni déploiement.

## Résultats finaux

116 tests backend distincts et 74 tests frontend réussis : 190 au total.
Aucun échec, aucune annulation et aucun test ignoré dans ces suites finales.
La suite globale backend n'a pas été exécutée ; le périmètre exécuté est listé ici.

- `provider-mode.test.ts` : 4 réussis.
- `durable-dispatch-native.test.ts` : 14 réussis.
- `qstash-adapter.test.ts` : 10 réussis.
- `report-fallback-email.test.ts` : 12 réussis.
- `final-email-pdf-validation.test.ts` : 2 réussis.
- `participant-email-native.cases.ts` : 31 réussis.
- `job-processing-native.test.ts` : 22 réussis.
- `job-publication-native.test.ts` : 21 réussis.
- Tous les fichiers `frontend/tests/*.test.ts` : 74 réussis.

Typechecks et builds backend/frontend réussis. Client Prisma régénéré depuis le
schéma courant, avec réseau bloqué, puis backend recompilé et vérifié. Les tables
synthétiques restent interrogées par SQL brut, sans dépendance à un ancien client.
Le build frontend final ne charge pas `.env.local` : le préchargement de qualification
masque les fichiers d'environnement sans les renommer ou modifier.

Les premiers essais ont mis en évidence un ancien test supposant qu'une clé seule
active Brevo, un contrat frontend attendant encore 12 secondes, et un mauvais
répertoire de lancement des tests frontend. Corrections explicites, puis relances
vertes. PostgreSQL/tsx ont nécessité l'exécution locale hors sandbox Windows à
cause des restrictions de création de jeton et d'accès au profil utilisateur.

## Preuves conservées

- Dernière validation du dispatch et PDF avec client Prisma neuf :
  `output/lot4-durable/native-KeTuJX/`.
- Autorisations et dispatch sous le garde-fou final :
  `output/lot4-durable/native-GtSGha/`.
- QStash, rapports et parcours PDF complets :
  `output/lot4-durable/native-FyehUo/`.
- Non-régression OTP/traitement/publication :
  `output/lot4-durable/native-iavJgO/`.
- Typechecks, builds et frontend : `output/durable-local-checks/`.
- Empreintes pièce jointe/téléchargements :
  `output/final-email-pdf-validation/fr-evidence.json` et `ar-evidence.json`.

Les répertoires natifs contiennent `results.json`, `durable-evidence.json` lorsque
applicable, l'identité du cluster avant migration, les empreintes des migrations,
les logs et `shutdown.json`. Les clusters sont arrêtés ; leurs données locales
jetables sont conservées pour inspection. Aucun PostgreSQL existant n'est réutilisé.

## Reprise après arrêt et doubles envois

Le test crée un OTP, lance un processus de publication, attend sa sortie puis
reçoit la notification dans un autre processus. Une troisième réception répétée
conserve une seule entrée de boîte synthétique, une réservation et une tentative.
Les PID distincts sont enregistrés dans `durable-evidence.json`.

Un worker est réellement arrêté à deux frontières :

- Avant réservation : après expiration du bail, un nouveau traitement accepte
  le même job et produit exactement un e-mail synthétique.
- Après réservation, avant transport : le job demeure `UNCERTAIN` ; aucun renvoi
  aveugle et aucune entrée synthétique ne sont produits.

Une acceptation déjà persistée avec achèvement de job perdu est rapprochée en
`ACCEPTED`, sans nouvelle tentative ni second e-mail. Une réponse perdue après
acceptation synthétique conserve elle aussi une seule entrée.

Une notification confirmée puis perdue est réarmée sous un nouvel UUID de
notification, avec le même UUID d'OTP. Huit consommateurs concurrents n'envoient
qu'une fois. Le quota de publication reste partagé après recréation du service.
Le curseur persistant conserve l'ordre OTP, OTP, rapport entre trois publications
unitaires de services distincts.

## OTP, consentement et PDF

Tests d'expiration, renouvellement, code incorrect, cinq essais par code, échecs
cumulés, plafonds d'envoi, temporisation 429, épuisement de crédit, validation
concurrente unique, rejeu, confidentialité et conservation après redémarrage.

Un consentement d'entrée absent ne crée pas de job. L'absence de choix d'e-mail,
son retrait authentifié et son retrait pendant la préparation du PDF empêchent
le transport avant réservation. Les limites de rappel d'un message après cette
frontière sont décrites dans `OTP-EMAILS-DURABLES-LOCAL.md`.

Pour FR et AR : 31 réponses HTTP, vraie pièce jointe PDF locale, neuf pages,
égalité binaire et SHA-256 entre pièce jointe et téléchargements étudiant/admin.
Deux tests supplémentaires comparent le PDF à un rendu dans un processus Node
neuf ; neuf pages et même SHA-256 pour la même source et le même navigateur.
Le nombre d'appels externes enregistré par les parcours complets est zéro.

## Limites de cette qualification

Pas de preuve de délivrabilité Brevo, de comportement réel QStash, de quotas de
compte ou de runtime Linux/Vercel. Le filtrage de test couvre les API réseau Node
et les pages Chromium ; aucun pare-feu système général n'a été installé.
Un crash après réservation peut donc volontairement laisser un OTP non livré
en état incertain jusqu'à expiration : priorité à l'absence de doublons.

Le dispatch et l'adaptateur réel sont préparés mais désactivés. Un ordonnanceur
externe, les vérifications de budget et l'application distante de la migration
nécessitent une autorisation distincte. Aucun engagement de gratuité fournisseur.

Les trois lots candidats et leurs fichiers/empreintes sont disponibles dans
`output/otp-email-durable-candidates/manifest.json`. Aucun commit Git n'a été créé :
ce dossier n'est pas un dépôt Git. Les lots sont des instantanés de revue, pas des
différences contre une archive supposée identique au point de départ.
