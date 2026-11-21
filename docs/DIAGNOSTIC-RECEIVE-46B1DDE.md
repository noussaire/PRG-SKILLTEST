# Diagnostic receive après publication ciblée

## Requête 503 confirmée — analyse finale locale

Requête fournie par l'utilisateur : `2ts7h-1794264280593-bcc389f503b1`, déploiement `dpl_8pz1BcBXjSrnxu5ousp7p7hB6wuf`, POST receive du 9 novembre 2026 à 22:44:40 UTC, HTTP 503, durée 6,42 s, pare-feu Allowed, aucun appel fournisseur.

Le challenge expirait à 22:46:49.791 UTC : 129,791 secondes après le début, et environ 123 secondes après la fin de la requête. Avec ces horodatages, l'expiration normale de ce challenge pendant cet appel est exclue. Une expiration différente du job ou une substitution de challenge/gate restent à distinguer ; les identifiants de notification et le format de proof ne suffisent pas à valider tout le graphe.

Le code exact 46b1dde contient deux réponses explicites 503 : configuration staging invalide (`SYNTHETIC_STAGING_UNAVAILABLE`) et catch final (`SYNTHETIC_OPERATION_UNAVAILABLE`). Dans l'application complète, une configuration staging invalide peut aussi empêcher l'import initial ; le succès de status/publication rend cette piste secondaire. Le catch final couvre : audit/marqueur de base refusé ; erreur de connexion ; accès à la session ADMIN ; transaction anti-rejeu et verrou advisory (statement_timeout 2 s, maxWait 2 s, timeout 4 s) ; transaction receive (maxWait 2 s, timeout 5 s), verrou fournisseur puis verrous de cible ; cible non éligible ; HMAC otpTargetProof non valide malgré son bon format ; déchiffrement du payload ; erreur SQL/Prisma à toute étape, y compris lors de la persistance finale. Le worker interne modifie ensuite son statement_timeout à 4 s ; le budget de la transaction externe reste 5 s.

Les refus ordinaires ont d'autres statuts : authentification/HMAC HTTP 401, rejeu ou horloge de l'invocation 409, fréquence anti-rejeu 429, schéma Zod/JSON 400. Une erreur de base rencontrée en vérifiant l'authentification peut toutefois produire 503. Le status précédent utilise une invocation distincte : son succès ne prouve pas que la transaction anti-rejeu de receive a réussi.

La durée HTTP totale comprend l'initialisation, les lectures, l'admission anti-rejeu et la transaction receive. Elle n'est pas égale à la durée de cette dernière. 6,42 s est compatible avec une erreur de connexion, acquisition, verrou ou dépassement transactionnel, sans constituer une preuve permettant de choisir entre eux.

**Tests nouveaux : 13 PASS**, sur les vrais routeur et service du commit, avec DB injectée entièrement en mémoire et erreurs contrôlées : configuration invalide, connexion, marqueur refusé, verrou advisory, verrou fournisseur, deadlock, transaction expirée, cible refusée, HMAC de bon format mais faux, déchiffrement invalide, erreur SQL après incrément avec rollback externe, budget zéro, cible malformée. Aucun objet PostgreSQL ni OTP n'est créé. Ces simulations valident les branches applicatives et le mapping HTTP ; elles ne reproduisent pas les latences Neon ou le moteur réel de verrouillage PostgreSQL.

Le test de budget zéro exerce EmailBudget et OtpDeliveryQueue réels : HTTP 200, disposition REJECTED, attempts=1 et reçu enregistré (la temporisation de quota dépasse la validité de la fixture). Ce refus normal ne produit donc pas l'état observé. Une erreur transactionnelle supplémentaire pourrait annuler toute trace, ce qui serait une autre cause à confirmer.

Le test d'erreur SQL injectée après l'incrément atteint effectivement cette étape, puis le rollback externe restaure attempts=0 et receivedAt=NULL. Un zéro persistant ne prouve donc pas qu'aucun traitement n'a commencé. Le reçu anti-rejeu, dans une transaction antérieure séparée, peut rester enregistré : aucune reprise automatique ne doit être tentée.

Les 24 tests existants du lanceur/diagnostic sont également PASS. Reproduction :

```powershell
node --no-warnings --loader ./backend/tests/helpers/local-typescript-loader.mjs --test backend/tests/receive-503.offline.mjs backend/scripts/synthetic-admin-launcher.test.mjs backend/scripts/synthetic-receive-diagnostic.test.mjs
```

Cause distante non établie : restent les refus de graphe/proof, les erreurs de connexion/acquisition et les erreurs SQL/verrous/timeout. Aucun changement de durée, quota, secret ou contrôle de cible n'est justifié. Le routeur ne journalise pas l'exception qu'il intercepte ; il est possible que les Function Logs existants ne permettent pas de retrouver la cause. Prochaine action unique : consulter les Function Logs attachés au Request ID ci-dessus et relever uniquement un éventuel code Prisma/SQLSTATE et son heure, sans requête SQL, paramètres, stack ou environnement. Si aucun code n'a été enregistré, ce constat limitera le diagnostic rétrospectif ; un futur diagnostic expurgé nécessitera une préparation et autorisation distinctes.

Seuls des tests et cette documentation locale ont été ajoutés pour cette analyse. Aucun correctif métier, connexion distante, génération de secret, traitement OTP ou déploiement effectué.

## Précisions après le nouvel inventaire

Job PENDING avec attempts=0 et receivedAt=NULL : aucun traitement receive terminé n'est démontré. Une absence d'appel, un refus avant traitement ou une transaction annulée expliquent cet état. Une livraison différée par le budget qui aurait été validée en base laisserait receivedAt non NULL ; ce scénario n'est donc plus l'explication directe privilégiée. Un rollback peut néanmoins effacer les modifications intermédiaires, et le compteur 0 ne suffit pas à prouver l'absence de requête HTTP.

ERR_ERL_UNEXPECTED_X_FORWARDED_FOR a été reproduit avec le limiteur du candidat et la dépendance installée : sous la limite, la validation écrit l'avertissement puis le middleware appelle next. Le message seul n'est donc pas une preuve de refus HTTP. Un véritable dépassement de limite reste possible et doit être confirmé par un statut 429. Ne pas activer trust proxy=true pour supprimer ce message.

Le lanceur ne consulte ni le budget ni le compteur attempts avant son POST receive : il valide la configuration, les arguments, l'authentification, puis la notification renvoyée par status. Une proof de bon format n'est pas une preuve HMAC valide, et la présence en base ne prouve pas que la notification figurait dans les 20 lignes du status au moment de l'appel.

Prochaine preuve utile : métadonnées de la requête receive existante (heure UTC et statut HTTP, ou absence de requête dans des journaux suffisamment complets). Ne pas rejouer le challenge expiré. À ce stade, aucun changement des quotas ou du proxy n'est justifié.

## Conclusion et preuves disponibles

Cause de l'incident distant non déterminée : le lanceur de `46b1dde` masque toute erreur sous `LAUNCHER_STOPPED`. Le lanceur principal local était strictement identique à celui du candidat avant cette modification (SHA256 identique). Aucun appel distant, challenge créé, secret lu ou état Neon/Vercel modifié pendant ce diagnostic.

La réussite de publish-otp confirme, à cet instant, l'identité du payload déchiffré, la cible job/challenge/notification, l'éligibilité et l'insertion transactionnelle de la notification munie d'otpTargetProof. Elle ne constitue ni une livraison ni une consommation d'OTP. Le job PENDING après publication est normal.

Horodatages fournis : publication 2026-11-09 22:42:25.010, expiration 22:46:49.791, soit 264,781 secondes restantes. Le code utilise UTC. Sans l'horodatage exact de receive et le résultat HTTP de cette requête, impossible de conclure que l'expiration a causé l'échec. Ne pas réutiliser ce challenge.

## Hypothèses à départager dans cet ordre

1. **Arrêt local ou avant receive** : challengeId omis dans la commande ; drapeaux d'autorisation manquants ; saisie annulée ; secret/mot de passe invalide ; login ou status échoué. Le précontrôle status refuse aussi une notification absente des 20 plus récentes, une cible différente, receivedAt non NULL ou un otpTargetProof absent/malformé. Examiner uniquement les métadonnées Vercel pour savoir si `/notifications/receive` a réellement été appelé.
2. **Livraison différée par les quotas/configurations** : `EMAIL_ACCOUNT_DAILY_LIMIT` vaut 0 par défaut ; le transport synthétique conserve EmailBudget. Avec un budget nul, un cooldown ou une limite atteinte, receive peut répondre HTTP 200 avec disposition DEFERRED, le job rester PENDING, et le lanceur s'arrêter correctement car il exige COMPLETE. Ce scénario est déjà couvert par le test natif existant `receive preserves zero budget and synthetic rejection accounting without provider fallback` (non rejoué ici). Un résultat receivedAt non NULL + disposition DEFERRED + lastErrorCode permet de le distinguer.
3. **Refus backend** : expiration, challenge remplacé/consommé, bail, réservation déjà acceptée/incertaine, proof HMAC non valide, enveloppe incohérente, problème SQL ou délai transactionnel. Le backend regroupe ces refus sous HTTP 503. Un timeout SQL est possible avec le statement_timeout de 2 s et la transaction de 5 s. Le job PENDING ne prouve pas que receive n'a pas commencé : une transaction peut avoir été annulée.
4. **Transport ou fermeture** : panne réseau, réponse non JSON ou supérieure à la borne, timeout, logout échoué. Le `finally` de la CLI peut même masquer une erreur initiale par une erreur de logout. Si le message de succès de livraison était affiché avant l'arrêt, examiner en priorité cette fermeture ; le statut ACCEPTED serait alors attendu, sous réserve de modifications ultérieures.

Le succès de publish rend une preuve initialement manquante moins probable, mais n'exclut ni substitution ultérieure ni commande receive différente. La vérification de format d'une proof dans le lanceur ne vérifie pas sa signature : la validation HMAC appartient au backend.

## Correction minimale préparée localement

Seul le lanceur principal local est modifié : codes d'erreur autorisés, étape HTTP fixe et statut numérique, sans réponse serveur, stack, URL libre, identifiant, mot de passe, OTP, token ou proof. Le message REQUEST_FAILED_NO_RETRY est conservé pour compatibilité. Aucune validation métier, signature, durée, protection anti-rejeu ou stratégie de retry n'est changée.

Exemples de sorties sûres, avec données fictives :

```text
LAUNCHER_STOPPED code=TARGET_INVALID stage=LOCAL_VALIDATION http=UNAVAILABLE ; aucune reprise automatique.
LAUNCHER_STOPPED code=TARGET_NOTIFICATION_NOT_CONFIRMED stage=LOCAL_VALIDATION http=UNAVAILABLE ; aucune reprise automatique.
LAUNCHER_STOPPED code=REQUEST_FAILED_NO_RETRY stage=RECEIVE http=503 ; aucune reprise automatique.
LAUNCHER_STOPPED code=DELIVERY_NOT_COMPLETE_NO_RETRY stage=LOCAL_VALIDATION http=UNAVAILABLE ; aucune reprise automatique.
```

Ce changement améliore le prochain diagnostic ; il n'établit pas rétrospectivement la cause de l'incident. La copie Git du candidat 46b1dde est laissée intacte ; aucun déploiement backend n'est nécessaire pour ces diagnostics locaux.

## Vérifications et suite

24 tests locaux PASS : 15 tests existants du lanceur et 9 cas ciblés. Les nouveaux tests utilisent des réponses HTTP fictives, la fonction pure de budget et un appel en mémoire au middleware du limiteur : notification absente, proof absente, challenge omis, HTTP 503 sans fuite du corps, DEFERRED sans retry, livraison COMPLETE exacte, budget nul par défaut, erreur réseau/arbitraire masquée, avertissement X-Forwarded-For sans blocage sous la limite.

```powershell
node --no-warnings --loader ./backend/tests/helpers/local-typescript-loader.mjs --test backend/scripts/synthetic-admin-launcher.test.mjs backend/scripts/synthetic-receive-diagnostic.test.mjs
```

Pour résoudre le cas existant sans le rejouer : relever l'heure, le chemin et le statut HTTP dans les métadonnées Vercel existantes, sans contenu de requête ni dump d'environnement. L'absence de trace n'est concluante que si la période de rétention et la couverture des journaux sont suffisantes. L'audit SQL facultatif `backend/scripts/diagnose-receive-readonly.sql` ne sélectionne que des états et booléens, et termine par ROLLBACK ; il n'a pas été exécuté ici.

Si disposition DEFERRED et EMAIL_LOCAL_LIMIT sont confirmés, contrôler les seuls réglages numériques EMAIL_ACCOUNT_DAILY_LIMIT, EMAIL_OTHER_USAGE_MARGIN, EMAIL_APP_DAILY_LIMIT et les limites OTP. Il faut un budget synthétique positif, conservateur, dans le mode synthetic-v1, sans clé ni autorisation fournisseur réel. Ne pas modifier automatiquement ces réglages et ne pas contourner EmailBudget. Si cooldown/limite est confirmé, attendre la fenêtre normale plutôt que réarmer ce job.

Si expiration est confirmée, aucun correctif de durée ni suppression de garde : conserver le refus et raccourcir le temps de saisie lors d'un futur test explicitement autorisé. Si la cible ou la proof est incorrecte, ne pas la reconstruire ni modifier la notification en base ; identifier la divergence avant toute nouvelle tentative. Si HTTP 503 sans cause déterminée, conserver l'arrêt et obtenir le code SQL/erreur backend expurgé par une investigation dédiée avant tout correctif métier.

Aucun nouveau test OTP de production ne doit être lancé sans autorisation. Ne pas relancer receive, publish-otp ou mail sur les identifiants de cet incident.
