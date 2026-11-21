# LOT 1 — Purge périodique sécurisée

Implémentation locale du 31 octobre 2026. Aucune exécution sur une base réelle,
aucun appel Brevo, aucune modification de secret ou de migration historique.
Le LOT 3 et le LOT 5 ne sont pas traités ici.

## Périmètre et conservation

Le serveur lance une passe au démarrage, puis toutes les heures. Chaque opération
traite au maximum 100 lignes, dans une transaction de cinq secondes maximum,
avec le verrou partagé du budget et des sélections `FOR UPDATE SKIP LOCKED`.
Deux processus sont sérialisés ; une même instance ne chevauche pas ses passes.
Un échec est journalisé sans données ni secrets et la prochaine heure réessaie.
Une passe en cours termine sa transaction lors de l'arrêt ; aucun nouveau passage
n'est lancé après l'arrêt du planificateur.

- Compteurs : suppression seulement plus de 48 heures après leur expiration.
  Un cutoff fourni à l'ancienne méthode ne peut pas raccourcir cette marge.
- Délais OTP : suppression seulement plus d'une heure après `nextSendAt`.
- Charges utiles des deux outboxes : effacement après expiration OTP et fin du
  bail, sans appel fournisseur ni déchiffrement. `PENDING` devient `REJECTED` ;
  `UNCERTAIN` reste `UNCERTAIN` et ses métadonnées sont conservées.
- Tâches terminées : suppression seulement plus de 48 heures après expiration,
  en état `ACCEPTED` ou `REJECTED`, sans charge utile, prochaine tentative, bail
  ou jeton ; une réservation non terminale ou encore louée empêche la suppression.
- Verrous d'adresse : suppression après 48 heures sans délai actif, uniquement
  si le challenge lié est lui aussi expiré depuis 48 heures et sans tâche.
- Challenges : suppression après 48 heures, sans verrou d'adresse ni tâche liée.
  Aucun effacement par cascade de tâche n'est autorisé par les critères de purge.

Les réservations de budget de **tous** les états sont conservées, y compris leurs
reçus terminaux : `expiresAt` n'est pas une autorisation de suppression. Le chemin
`claim()` continue à s'en servir pour détecter les doublons, même après cette date.
Les réservations incertaines permettent aussi de réconcilier une tâche après une
acceptation persistée suivie d'un crash. La purge ne libère aucun quota.

Le coupe-circuit fournisseur, les participants, codes de reprise historiques,
rapports et sessions administrateur ne sont pas purgés par ce mécanisme.

## Concurrence avec une demande initiale

L'émission effectue désormais un upsert du verrou d'adresse avec `RETURNING`,
qui conserve le verrou jusqu'au commit. L'ancienne paire INSERT sans modification
puis SELECT pouvait perdre sa ligne entre les deux requêtes si la purge la
supprimait. La purge ignore les lignes actuellement verrouillées.

## Utilisation et contrôle

Le planificateur est raccordé à `server.ts` et arrêté avec les autres workers.
La commande existante `npm run counters:cleanup` effectue une seule passe bornée
de la purge complète et affiche uniquement les quantités traitées. Elle n'a pas
été exécutée avec une configuration réelle pendant cette mission.

Le lanceur de qualification local est
`node output/lot4-lot1-retention-20261031/run-native.cjs`.
Il crée un cluster PostgreSQL natif propriétaire sur une adresse loopback et un
port éphémère, vérifie son identité et son schéma vide, applique les migrations
uniquement à ce cluster puis exécute les 31 tests LOT 4 inchangés, les tests de
rétention natifs et les tests du planificateur. Le transport est simulé ou
interdit. Il arrête ensuite son propre cluster et vérifie la fermeture du port
avant suppression de ses données. Aucun DSN externe n'est accepté en secours.

Les sauvegardes préalables et leur manifeste SHA-256 sont dans
`output/lot1-retention-20261031/backup`. Les résultats et l'intégrité finale sont
dans le même dossier de qualification, hors `backup`.

## Limites restantes

Les réservations, états incertains et tâches qui en dépendent peuvent croître
sans limite temporelle : une politique de résolution/archivage avec preuve de
non-rejeu sera nécessaire avant toute suppression supplémentaire. Aucun reçu
d'idempotence n'est sacrifié pour réduire le volume.

La capacité de purge est bornée par catégorie et par passe : un historique
important peut nécessiter plusieurs passes. Les charges utiles expirées sont
également nettoyées par le worker OTP existant. La purge dépend de la disponibilité
du serveur et de PostgreSQL ; après une interruption elle reprend au démarrage.
Un timeout annule toute la passe ; il ne garantit pas son avancement sur une
base fortement chargée. Les index et performances sur une volumétrie réelle
n'ont pas été qualifiés ici, et aucune donnée réelle n'a été utilisée.
