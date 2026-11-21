# Diagnostic local de l'admission SQL

Préparation uniquement : aucun connecteur réel n'est inclus et aucun paramètre
d'environnement n'est lu par le script. Ni Prisma, ni dotenv, ni le démarrage
de l'application ne sont importés. Aucun OTP, publication ou fournisseur externe.

Depuis la racine du projet :

```powershell
node --test backend/tests/isolated-admission.test.mjs
node backend/scripts/diagnose-dispatch-admission.mjs --simulate ok
node backend/scripts/diagnose-dispatch-admission.mjs --simulate busy
node backend/scripts/diagnose-dispatch-admission.mjs --simulate lock
node backend/scripts/diagnose-dispatch-admission.mjs --simulate statement
node backend/scripts/diagnose-dispatch-admission.mjs --simulate pool
```

Les deux premiers résultats métier sont `ADMISSION_OK` et `DISPATCH_BUSY`.
Les erreurs PostgreSQL produisent uniquement `PG_` suivi d'un SQLSTATE validé
sur cinq caractères. Une erreur sans SQLSTATE exploitable (notamment acquisition
Prisma P2028, délai global ou erreur inconnue) produit `ADMISSION_ERROR`.
Le processus sort avec 1 pour une erreur, 0 pour OK ou BUSY.
Aucun message d'erreur, pile, URL, secret, paramètre SQL ou contenu de ligne n'est
affiché. La CLI refuse toute utilisation sans `--simulate` et un scénario reconnu.
Les simulations n'exigent aucun secret et ignorent même une DATABASE_URL présente.

## Transaction et délais

Le noyau reçoit un adaptateur de transaction interactive compatible Prisma.
Il utilise ReadCommitted, un budget de 5000 ms, maxWait de 1500 ms,
statement_timeout de 1500 ms et lock_timeout de 500 ms. Les délais sont réduits
si le budget restant est inférieur. Le jeton UUID est un paramètre lié, jamais
une interpolation dans la requête.

Après UPDATE, même si une ligne est retournée, le callback lève une sentinelle
privée. Avec Prisma, le rejet du callback provoque ROLLBACK. Toutes les erreurs
du callback suivent la même voie. Aucun chemin normal ne retourne du callback
pour autoriser COMMIT. Si ROLLBACK échoue, aucun ADMISSION_OK n'est annoncé.
Si l'acquisition échoue avant BEGIN, aucune transaction n'existe à annuler.
L'adaptateur simulé enregistre BEGIN/ROLLBACK et restaure l'état mémoire.

## Limites

- Le dossier ne contient pas de métadonnées Git. La comparaison automatique
  prouve l'identité de l'UPDATE avec le fichier source local, pas avec le commit
  distant a91a776. Les trois délais viennent de la consigne utilisateur ; le
  service local contient encore d'autres délais et n'a pas été modifié.
- Les simulations vérifient le protocole du script, pas le comportement réel
  de Prisma, PostgreSQL, Neon, du pool, des migrations, des droits ou des verrous.
  Le résultat ne qualifie donc pas l'admission en Production.
- Le budget applicatif est coopératif, avec délais transmis au pilote et à SQL.
  Il ne garantit pas une durée murale stricte en cas de blocage du transport,
  de l'acquisition ou du rollback. Aucun Promise.race ne laisse une transaction
  continuer en arrière-plan après un faux succès.
- Une future exécution réelle doit attendre la fin du rollback. En cas de perte
  de connexion, sa confirmation peut être impossible ; le diagnostic échoue
  alors sans annoncer un succès. Le serveur annule une transaction abandonnée
  lorsque la session est effectivement close.
- Même annulé, UPDATE prend temporairement des verrous et peut produire du WAL
  ou déclencher des triggers. La méthode ne promet pas une absence d'impact sur
  une base réelle. Aucune base réelle n'est utilisée ici.
- DISPATCH_BUSY signifie qu'aucune ligne ne satisfait le WHERE ; cela peut aussi
  correspondre à un singleton manquant, et pas seulement à un dispatcher actif.
- Une admission réussie puis annulée ne teste ni commit durable, ni traitement
  des tâches, ni QStash, ni Brevo, ni OTP. Aucune réservation n'est conservée.

Aucun push, déploiement, changement de configuration ou activation nécessaire
pour ces tests. Coût externe engagé : 0 DH.
