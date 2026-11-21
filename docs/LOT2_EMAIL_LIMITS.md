# Lot 2 — protections OTP et budget Brevo

État : implémentation locale uniquement, sans migration de base persistante, sans appel réel à Brevo. Qualification PostgreSQL native manquante. Lot 3 non commencé.

## Intégration effectuée

- Tous les envois OTP et rapports passent par la réservation dans `sendReportEmail`. Le transport non comptabilisé est privé au module.
- Une transaction READ COMMITTED verrouille la ligne fournisseur BREVO avant de consulter ou modifier les compteurs, réservations et transitions. Les incréments utilisent également un UPSERT conditionnel avec plafond ; tout refus annule la transaction entière.
- Les transactions utilisent l'heure PostgreSQL et UTC, indépendamment du fuseau Windows. L'horloge synthétique est injectée uniquement par les tests.
- Une réservation est unique par clé logique UUID ; l'empreinte du contenu doit correspondre lors d'une reprise. Les PDF générés sont identifiés par leur source immuable, le HTML et les noms de pièces jointes : les changements de métadonnées binaires ne créent pas un nouvel envoi logique.
- L'état UNCERTAIN et un jeton de tentative sont enregistrés avant le transport. Un bail de 120 secondes évite deux transports simultanés pour la même clé. Le jeton protège les transitions contre une réponse tardive d'un ancien worker.
- Un résultat accepté est mémorisé ; une nouvelle demande identique ne contacte plus le fournisseur. Les refus connus ne remboursent pas automatiquement les unités : choix conservateur.
- Une issue incertaine conserve la même réservation et le même débit local. Les reprises s'arrêtent après dix minutes, ou au changement de journée UTC : aucun deuxième débit automatique d'un envoi incertain à minuit. Une réponse 429 après une précédente réponse perdue ne transforme pas cette incertitude en refus certain.
- Les 429 et quotas fournisseur bloquent OTP et rapports via un état partagé. Une nouvelle erreur ne peut pas raccourcir un blocage déjà plus long. Le délai est borné à 24 heures ; la réservation reste distincte du blocage.
- Les échecs OTP cumulés sont dans des compteurs indépendants du code. Ils sont mis à jour atomiquement avec l'essai par code. Aucun renvoi ne les remet à zéro. Les plafonds sont aussi consultés avant un nouvel envoi.
- Les dix minutes de validité et cinq essais par code sont conservés. La vérification SQL des essais contrôle désormais aussi l'expiration. Le délai de soixante secondes possède un verrou durable supplémentaire indépendant du code.
- L'identité e-mail utilise la normalisation existante, y compris les alias Gmail. Les adresses et origines sont représentées par HMAC dans les nouvelles tables. La clé globale, sans donnée personnelle, reste stable même lors d'une rotation du secret.

## Valeurs configurables proposées

Les compteurs journaliers utilisent des fenêtres fixes UTC. Le délai de renvoi de 60 secondes reste glissant et ne dépend pas du changement de journée.

- `EMAIL_ACCOUNT_DAILY_LIMIT` : **0 par défaut**. Déclaration explicite obligatoire du quota réellement alloué au compte ; aucune offre Brevo n'est supposée.
- `EMAIL_OTHER_USAGE_MARGIN` : **60** unités réservées aux autres usages du compte. À ajuster à leur consommation réelle.
- `EMAIL_APP_DAILY_LIMIT` : **240** au maximum pour cette application, OTP et rapports confondus.
- `OTP_IDENTITY_DAILY_SENDS` : **5**. Permet plusieurs demandes sans renvois continus sur une adresse.
- `OTP_NETWORK_DAILY_SENDS` : **100**. Valeur collective pour tenir compte des réseaux partagés ; à calibrer sur les ateliers réels.
- `OTP_GLOBAL_DAILY_SENDS` : **120**. Limite la part des OTP dans les envois de l'application, sans garantir une priorité d'accès aux crédits.
- `OTP_IDENTITY_DAILY_FAILURES` : **15**. Plafond cumulé distinct des cinq essais autorisés par code.
- `OTP_NETWORK_DAILY_FAILURES` : **150**. Limite une origine multipliant les adresses.
- `OTP_GLOBAL_DAILY_FAILURES` : **1000**. Dernier plafond collectif ; à surveiller pour éviter les blocages collectifs abusifs.

Budget effectif = max(0, min(plafond application, quota déclaré − marge autres usages)). Par exemple : quota déclaré 300, marge 60, plafond application 240 donnent 240. Cet exemple ne décrit pas le compte réel. Avec quota déclaré 100, la même marge laisse 40. Zéro désactive les nouveaux transports ; une configuration invalide échoue sans envoi.

Le fichier `.env` réel n'est pas modifié. Sans configuration explicite, **les envois seront bloqués** ; la présence d'une clé Brevo n'active pas à elle seule le budget. Les mêmes plafonds et secrets doivent être configurés sur toutes les instances. Aucun de ces paramètres n'a été appliqué à la production.

Le compteur local ne connaît pas les consommations d'autres applications. La marge ne remplace pas les réponses quota du fournisseur. Le jour UTC est une règle locale, pas une affirmation sur l'heure de remise à zéro du compte Brevo.

## Origine réseau et limites d'intégration

L'origine utilisée est exclusivement `req.socket.remoteAddress`, passée par la route backend en dehors du corps JSON. Les en-têtes de forwarding et les valeurs fournies par le participant ne sont pas utilisés pour ce quota. En l'absence d'origine, un groupe commun conservateur est utilisé.

Avec le proxy frontend actuel, cela identifie le proxy, et non chaque participant. Cette protection est fiable contre la falsification du corps/en-têtes, mais grossière : elle peut regrouper une classe ou tous les utilisateurs du BFF. La transmission authentifiée de l'origine cliente reste à préparer, sans activation aveugle de `trust proxy`. Aucune interface FR/AR n'est modifiée.

La vérification OTP initiale n'est pas activée. Le premier test conserve son fonctionnement actuel. Les nouvelles protections concernent les OTP de reprise et tous les envois de rapports. Les messages et états détaillés d'attente OTP, ainsi que le délai HTTP frontend/backend, restent à traiter au lot 3. Un échec d'envoi peut encore invalider le code de reprise selon le comportement antérieur.

Les tables ne sont pas encore purgées automatiquement. Ne pas supprimer une réservation incertaine pour libérer du quota. Une politique de rétention et de rotation des HMAC reste à définir ; changer le secret peut changer les identités pseudonymisées, même si le budget global reste stable.

## Idempotence

La documentation Brevo décrit une clé UUID dans les headers du corps de la requête, une fenêtre de trente minutes et `duplicate_parameter` en cas de répétition. Sources :

- https://developers.brevo.com/docs/heterogenous-versions-batch-emails
- https://developers.brevo.com/reference/send-transac-email

Le code ne considère pas cela comme une garantie absolue : fenêtre locale de reprise de dix minutes, conservation de UNCERTAIN, arrêt au changement de jour et aucune reprise hors fenêtre. Le simulateur ne prouve pas le fonctionnement du compte réel. Aucun appel de vérification au fournisseur n'a été effectué.

## Tests et qualification

La suite `email-budget.test.ts` est explicitement une suite fonctionnelle **PGlite**, avec base en mémoire vide vérifiée avant migration. Elle teste la configuration, les plafonds par identité/réseau/globaux, le dernier crédit OTP/rapport, le rollback des compteurs partiels, les renvois et échecs cumulés, le fencing, les circuits 429/quota, le passage de minuit et la relecture du stockage après fermeture/recréation de la base et des clients. Elle ne constitue pas une validation de concurrence PostgreSQL native.

La suite `email-budget-postgres.test.ts` ne lit jamais DATABASE_URL. Si `LOT2_POSTGRES_BIN` désigne des outils natifs locaux initdb/pg_ctl/psql, elle crée un nouveau cluster synthétique dans un répertoire temporaire unique, le lie à 127.0.0.1 et vérifie le data_directory et l'absence de tables publiques avant toute migration. Elle vérifie deux PID PostgreSQL distincts, la course OTP/rapport pour le dernier crédit, les réservations et transitions concurrentes, puis le redémarrage du serveur et des clients. Elle arrête et retire seulement son propre cluster temporaire vérifié.

Dans cet environnement : PostgreSQL et Docker non trouvés aux emplacements vérifiés ; WSL refuse l'accès. Les **trois tests natifs sont explicitement ignorés**, et non remplacés silencieusement par PGlite. Ils devront passer avant de considérer les garanties multi-instance comme validées expérimentalement.

Les suites existantes adaptative, administration adaptative, migration et envoi de rapports sont exécutées sur leurs bases synthétiques isolées. Le compte déclaré 300 dans les tests est une configuration synthétique. Les transports fournisseur sont simulés ; le garde réseau du lanceur interdit les fetch externes.

Commandes locales :

```powershell
node node_modules/typescript/bin/tsc --noEmit -p backend/tsconfig.tests.json
node --loader ./output/lot1-rollback-0a5d32857757/test-loader.mjs --import ./output/lot1-rollback-0a5d32857757/network-guard.mjs --test --test-concurrency=1 backend/tests/email-budget.test.ts backend/tests/email-budget-postgres.test.ts backend/tests/email-foundation.test.ts backend/tests/adaptive-api.test.ts backend/tests/admin-adaptive-api.test.ts backend/tests/report-email.test.ts backend/tests/migration.test.ts
```

Résultats exacts et empreintes : `output/lot2-rollback-16875a52d0/final-results.txt` et `verification.json`. Les échecs intermédiaires ont révélé une importation Prisma trop précoce dans les tests et un décalage UTC dans les requêtes brutes ; ces deux problèmes sont corrigés.

## Retour arrière local

Le dossier `output/lot2-rollback-16875a52d0` contient les copies préalables des huit fichiers modifiés et leurs empreintes dans `baseline.json`. Les copies n'incluent aucun `.env`. Les onze migrations antérieures doivent conserver leurs empreintes. `changes.json` inventorie les fichiers et artefacts créés et modifiés.

Aucune migration n'a été appliquée à une base persistante. Avant toute restauration locale, comparer les empreintes actuelles avec l'inventaire pour ne pas écraser des changements ultérieurs. Restaurer seulement les huit fichiers concernés et retirer seulement les fichiers nouveaux identifiés, après revue. Aucun rollback destructif automatique n'est lancé.

Si la migration additive est appliquée ultérieurement, le retour applicatif doit laisser les colonnes et tables en place. Ne pas supprimer les compteurs ou réservations déjà utilisés. Le retrait de ce lot retire aussi les nouveaux contrôles : il ne doit pas devenir un mode de fonctionnement durable.

## Préparation du lot 3, sans implémentation

1. Exécuter la qualification PostgreSQL native et valider les plafonds réels avant toute activation persistante.
2. Stabiliser la livraison asynchrone OTP : challenge durable, contenu/clés persistants, états refusé/incertain distincts, délais HTTP cohérents et information FR/AR adaptée.
3. Préserver un code potentiellement livré après perte de réponse ; borner les reprises et prévoir la réconciliation des états incertains.
4. Tester pannes, redémarrages et réponses tardives avec le budget partagé, sans ajouter encore l'OTP obligatoire à la première participation.

L'activation de la vérification initiale et la réduction de l'énumération restent des lots ultérieurs soumis à validation.
