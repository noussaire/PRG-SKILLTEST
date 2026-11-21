# LOT 3 — Rotation versionnée du chiffrement OTP

Implémentation et qualification locales du 31 octobre 2026. Aucun `.env` inspecté ou
modifié pour cette mission, aucune clé réelle affichée ou remplacée, aucune
migration, aucun déploiement et aucun appel réel à Brevo. LOT 5 non commencé.

## Inventaire et séparation des usages

`JOIN_CODE_PEPPER` sert actuellement à plusieurs fonctions historiques :

- HMAC des codes de session (`tokens.ts`) ;
- chiffrement des codes de session (`tokens.ts`, clé SHA-256 historique) ;
- HMAC des OTP initiaux (`entry:...`) et de reprise (`retake:...`) ;
- HMAC des identités et réseaux des compteurs (`email-limit:...`) ;
- ancienne clé de chiffrement des payloads OTP (`otp-outbox:v1`).

Changer ce secret pour renouveler seulement le chiffrement OTP risquerait de
rendre les codes de session illisibles et de changer les identifiants des
compteurs. Ces usages historiques et leurs empreintes ne sont pas modifiés.
La clé globale de budget, indépendante du pepper, reste également inchangée.

La nouvelle clé AES-256-GCM est une sous-clé HKDF-SHA-256 (32 octets), avec le sel
de domaine `skillquest:otp-outbox:hkdf:v2` et l'info `aes-256-gcm:<key-id>`.
Elle n'est jamais la clé HMAC brute. Une racine dédiée au chiffrement OTP peut
être fournie par version, indépendamment de `JOIN_CODE_PEPPER`. La rotation de
ces racines dédiées ne modifie aucun HMAC, compteur, code de session ou jeton.

## Configuration prévue, non appliquée à des secrets réels

- `OTP_ENCRYPTION_KEYS` : objet JSON associant chaque identifiant à une racine
  dédiée de 32 octets aléatoires encodés en base64 canonique ; 16 versions maximum.
- `OTP_ENCRYPTION_ACTIVE_KEY_ID` : version utilisée pour les nouvelles écritures.
  Elle doit exister dans le trousseau. Les autres versions sont seulement lues.
- `OTP_PAYLOAD_WRITE_VERSION` : `v2` par défaut ; `v1` uniquement pour la phase
  de déploiement des lecteurs avant activation du nouveau format.

Un identifiant contient 1 à 48 caractères ASCII alphanumériques, `_` ou `-`.
Un identifiant doit rester associé à la même racine pour toujours. Ne jamais
remplacer le matériau d'une clé en conservant son identifiant. Ne pas réutiliser
ces racines pour d'autres fonctions cryptographiques. Les erreurs de configuration
n'incluent aucune valeur de variable ni détail de parsing dans leurs messages.

Sans configuration dédiée, les installations existantes restent fonctionnelles :
les nouvelles écritures utilisent `v2:join-pepper` avec une clé dérivée par HKDF
du pepper existant. `join-pepper` est réservé et interdit dans le trousseau.
Ce mode bootstrap sépare les sous-clés, mais conserve une racine partagée :
l'indépendance des secrets exige l'activation future d'une racine dédiée.
Aucune racine dédiée de production n'a été créée ni activée pendant cette mission.

## Formats et compatibilité

Le nouveau format est `v2:<key-id>:<iv-hex>:<tag-hex>:<ciphertext-base64>`.
L'IV aléatoire fait 12 octets ; le tag GCM, 16 octets. Les données authentifiées
sont la sérialisation JSON de `["skillquest","otp-outbox","v2",keyId,jobId]` :
modifier l'identifiant, copier le ciphertext vers une autre tâche ou altérer un
champ empêche l'authentification. Le décodage est strict et refuse les composants
supplémentaires, les encodages non canoniques et les versions inconnues.

Les anciens messages `v1` conservent exactement leur KDF et leurs données
authentifiées historiques. Ils sont déchiffrés avec `JOIN_CODE_PEPPER`, puis
`JOIN_CODE_PEPPER_PREVIOUS` si nécessaire. Le mode bootstrap dispose de la même
transition à deux peppers. Les clés dédiées utilisent exclusivement l'identifiant
annoncé : aucun essai des autres clés nommées en cas d'échec.

La preuve de compatibilité utilise un générateur de fixtures indépendant,
reproduisant le writer v1 sauvegardé avant cette modification. Elle ne fabrique
pas les anciens messages au moyen du nouveau writer sous test.

## Rotation progressive, sans réécriture des messages

1. Préparer le nouveau trousseau dans le gestionnaire de secrets autorisé, en
   conservant toutes les anciennes clés nécessaires. Cette étape relève d'une
   future opération de configuration, pas de cette implémentation locale.
2. Déployer d'abord les lecteurs compatibles sur **tous** les producteurs et
   workers avec `OTP_PAYLOAD_WRITE_VERSION=v1`. Les vieux binaires ne savent pas
   lire v2 et pourraient supprimer une tâche : aucune écriture v2 avant cette étape.
3. Après vérification de tous les lecteurs, activer v2 et la nouvelle version
   sur les producteurs. Les nouveaux messages portent son identifiant. Les
   messages existants restent chiffrés à l'identique sous leur ancienne version.
4. Pour une rotation suivante, distribuer d'abord l'ancienne ET la nouvelle clé
   sur tous les lecteurs, puis changer seulement l'identifiant actif des writers.
5. Attendre le drainage et vérifier les conditions de retrait ci-dessous.

La rotation ne réenfile ni ne réécrit les tâches. UUID, hash OTP, charge utile,
date d'expiration, clé d'idempotence et réservation budgétaire restent identiques.
Les workers conservent le verrou SQL, le bail et le jeton de tentative existants.
Une réponse perdue reste `UNCERTAIN` et ne déclenche aucun renvoi automatique.
Une acceptation persistée se réconcilie sans appel fournisseur, même si la clé
du payload n'est plus disponible. Un refus 429 certain peut reprendre avec le
même UUID et la même réservation dans la validité initiale du code.

Une clé absente, un format inconnu ou un échec d'authentification bloque le
transport. Le worker conserve le ciphertext et programme un nouveau contrôle
local après une minute, sans consommer d'essai de transport ni de budget. Une
correction du trousseau permet de reprendre la même tâche. Les messages altérés
ne sont jamais envoyés. La purge habituelle reste applicable à l'expiration ;
elle respecte les baux et conserve les métadonnées et réservations incertaines.

## Vérification avant retrait d'une ancienne clé

`inspectOtpKeyUsage` et le script `audit-otp-keys.ts` sont en lecture seule.
Ils comptent les payloads des **deux** outboxes par format et identifiant, avec
les sous-comptes non expirés, loués et incertains. Ils ne retournent ni code,
ciphertext, adresse ni matériau de clé. Le script n'a été exercé sur aucune base
réelle. `assertOtpKeyRetirable` refuse une clé active, encore référencée, ou un
inventaire comportant un format non classifiable.

Avant un retrait futur, il faut cumulativement :

- vérifier que tous les producteurs ont cessé d'écrire cette version ;
- conserver la clé sur tous les lecteurs jusqu'à zéro référence dans les deux
  outboxes, y compris les payloads expirés mais encore sous bail ou incertains ;
- laisser terminer les opérations en vol (bail actuel 120 secondes, transport OTP
  borné à 8 secondes), puis contrôler une seconde fois l'inventaire ;
- inspecter les tâches bloquées et les formats inconnus plutôt que les supprimer ;
- maintenir un retour applicatif compatible v1/v2 et toutes les clés encore utiles.

Un inventaire SQL seul ne prouve pas qu'un ancien producteur ne peut pas créer
une nouvelle référence après sa lecture. L'arrêt des écritures de l'ancienne
version est une condition opérationnelle indispensable. Le helper ne retire
aucune clé et ne modifie aucune configuration.

Pour les lecteurs v1/bootstrap, zéro ciphertext ne permet **pas** de supprimer
`JOIN_CODE_PEPPER` : les HMAC, codes de session et compteurs peuvent toujours en
dépendre. Retirer `JOIN_CODE_PEPPER_PREVIOUS` exige aussi de vérifier les OTP HMAC
initiaux et de reprise encore valides ; cet inventaire HMAC n'est pas remplacé
par l'inventaire des seuls ciphertexts. La rotation générale du pepper reste
hors périmètre de cette levée de réserve.

## Qualification et limites

Le lanceur `output/lot4-lot3-rotation-20261031/run-native.cjs` vérifie un nouveau
cluster PostgreSQL natif propriétaire avant toute migration synthétique. Il
conserve les 40 tests natifs précédents et les tests de planificateur, puis ajoute
les tests cryptographiques et les scénarios natifs de rotation. Brevo est simulé,
les connexions sont exclusivement loopback et les données exclusivement fictives.
Les empreintes préalables sont dans `output/lot3-key-rotation-20261031/backup`.

L'absence de double envoi est vérifiée dans ces scénarios, sans promesse de
livraison exactement une fois par le fournisseur. Une mauvaise configuration
non corrigée avant l'expiration de l'OTP empêche sa livraison utile. Le trousseau
doit être homogène avant activation et les anciennes racines doivent être gardées
dans le gestionnaire de secrets et les procédures de reprise appropriées.
L'archivage des réservations incertaines et les performances à grande échelle
restent les suivis déjà acceptés du LOT 1.
