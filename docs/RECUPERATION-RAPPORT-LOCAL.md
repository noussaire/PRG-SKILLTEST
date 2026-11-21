# Export du rapport synthétique sauvegardé

Depuis la racine du projet, avec PostgreSQL récupéré déjà démarré :

```powershell
node .\backend\scripts\recover-synthetic-report.mjs
```

L'outil accepte uniquement `127.0.0.1:55439`, base `postgres`, rôle `skillquest_local`, répertoire physique `output/local-synthetic/run-nBEqzk/data-recuperation`, entretien `7cd650d3-9028-4439-b9a4-e24247be04e3` et identité `SYNTH-Participant` avec adresse `@example.test` et OTP vérifié. Il exige 31 réponses, une participation terminée, un job COMPLETE et les deux synthèses FR/AR déjà sauvegardées. Aucun argument ne permet de changer la cible.

Les lectures utilisent psql avec `default_transaction_read_only=on`, une transaction REPEATABLE READ READ ONLY terminée par ROLLBACK, sans configuration psql personnelle ni fichier de mots de passe existant. La projection exclut les jetons, hashes d'accès, mots de passe et payloads OTP. Les données nécessaires passent uniquement par mémoire et stdin. Deux lectures comparent les données du rapport avant et après l'export.

Le moteur PDF et le modèle proviennent de la copie de code du test dans `output/local-synthetic/run-nBEqzk/workspace/backend`. Aucun serveur ni worker n'est démarré, aucune session ou nouveau jeton n'est créé, aucune synthèse n'est régénérée. Un chargeur TypeScript refuse Prisma, dotenv et la configuration de connexion de l'application. Les transports réseau Node sont bloqués ; Chromium utilise un profil temporaire distinct, le mode hors ligne du moteur existant, ses ressources embarquées, et un proxy local fermé. Aucun navigateur personnel n'est consulté.

L'environnement enfant contient seulement les chemins système nécessaires et des réglages locaux. Le matériel de staging est une fixture publique de 32 octets nuls, uniquement en mémoire pour les vérifications de configuration lors du rendu. Il ne signe aucune requête, ne chiffre aucune donnée et n'est installé dans aucune base. Aucun secret existant n'est nécessaire.

Chaque exécution crée un nouveau dossier `output/recuperation-rapport/7cd650d3-9028-4439-b9a4-e24247be04e3/export-*` contenant les deux PDF, `verification.json`, les images de toutes les pages dans `verification/`, et les fichiers temporaires du navigateur. Aucun fichier de récupération précédent n'est écrasé ou supprimé. Les dossiers PostgreSQL existants ne sont jamais modifiés par l'outil. Les PDF sont des fichiers locaux accessibles avec les droits de votre compte Windows : aucun lien public n'est créé.

`pdfinfo` compte les pages ; `pdftotext` vérifie la présence du nom et du texte de chaque langue ; `pdftoppm` rend toutes les pages pour inspection. Les outils MiKTeX existants et Chrome/Edge installés sont utilisés ; aucune installation réseau n'est effectuée. La commande affiche PASS et les chemins si les contrôles automatiques aboutissent. La vérification visuelle reste nécessaire pour juger les coupures et la disposition RTL.

Tests de refus, sans accès à une base :

```powershell
node --test .\backend\tests\recover-synthetic-report.test.mjs
```
