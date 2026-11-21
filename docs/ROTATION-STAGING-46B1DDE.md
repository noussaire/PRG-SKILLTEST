# Rotation du secret staging — procédure préparée, non exécutée

Périmètre : backend `46b1ddebe1cb1f53b22acb5d1cba6e49be7597a5`, installation `9ca8e522-2f42-45a4-831e-a070d7ac7cc7`, projet Neon `skillquest-staging`, branche `production`. Version et inventaire distants confirmés par l'utilisateur ; aucune connexion à Neon/Vercel effectuée pour cette qualification.

## Verdict

GO technique pour remplacer uniquement `SKILLQUEST_STAGING_SECRET`, sans suppression, modification des participants, ni traitement du backlog. L'exécution reste soumise à autorisation et aux vérifications de l'étape 1. Ce verdict ne valide pas l'abandon du REPORT PENDING, dont la phase et l'éligibilité ne sont pas encore connues, ni d'éventuelles captures SyntheticMail encore utiles.

Les trois jobs OTP expirés ne sont plus exécutables par `publish-otp`/`receive`, indépendamment de leur statut PENDING. Une publication PENDING n'est pas une preuve de traitement possible : les vues d'éligibilité et les dates font autorité. Ne pas lancer de dispatcher, de publication globale, de réconciliation ou de nettoyage pour vider ces lignes. Le dispatcher peut précisément retirer des jobs et effacer leurs ciphertexts expirés ; il est exclu de cette procédure.

La session OPEN n'est pas chiffrée avec le secret. L'entrée Vercel `backend/index.mjs` importe uniquement l'application HTTP, pas les minuteurs de `src/server.ts`. Une session ouverte permet toutefois encore des inscriptions ; elle ne garantit aucune quiescence. Suspendre tous les clients de test et déclencheurs externes pendant la bascule. Aucun changement de statut de session n'est nécessaire.

## Tests effectués localement

Commande sans connexion à une base et sans chargement de `.env` :

```powershell
node --no-warnings --loader ./backend/tests/helpers/local-typescript-loader.mjs --test backend/tests/staging-secret-rotation.offline.mjs
```

8 tests PASS sur le code du commit exact : identité d'installation inchangée ; invalidation HMAC HTTP ; invalidation otpTargetProof et refus de substitution ; invalidation des anciens mails chiffrés et fonctionnement des nouveaux ; restauration des anciennes preuves/captures en remettant l'environnement A ; indépendance du chiffrement des jobs OTP et des identités ; marqueur d'installation inchangé avec faux client SELECT uniquement ; refus des trois fournisseurs réels.

Deux fixtures publiques déterministes sont utilisées. Aucun nouveau secret réel généré. Ces tests valident la cryptographie applicative et les configurations A/B ; ils ne réalisent pas un rollback Vercel et ne requalifient pas les transactions PostgreSQL déjà testées.

## Étape 1 — avant toute modification distante

1. Attendre l'autorisation explicite. Suspendre les tests et les appels manuels/automatiques au dispatcher, à la maintenance et aux routes de publication. Conserver la session OPEN ; aucun participant ne doit démarrer de parcours pendant la fenêtre.
2. Dans Vercel, relever l'identifiant `dpl_…`, l'URL immuable et le SHA du déploiement Production actuel D0. Garder D0, vérifier les droits de rollback, la politique de conservation et le quota disponible. Ne pas enchaîner d'autres déploiements Production avant la fin de la validation de D1.
3. Conserver la sauvegarde Neon `backup-before-staging-secret-rotation-20261109`, Auto-delete Never. Les comptages concordants constituent une vérification d'inventaire, pas un essai de restauration. Une restauration éventuelle doit rester isolée ; ne pas restaurer la branche production pour annuler une rotation de secret.
4. Compléter l'inventaire en lecture seule, via l'éditeur SQL déjà autorisé, sans sélectionner les ciphertexts ou les secrets :

```sql
BEGIN READ ONLY;
SELECT purpose,
       count(*) AS total,
       count(*) FILTER (WHERE "expiresAt" > (clock_timestamp() AT TIME ZONE 'UTC')) AS encore_valides
FROM "SyntheticMail"
GROUP BY purpose;

SELECT p.id AS publication_id, p.phase, j.status AS summary_status,
       j."emailStatus", i."reportEmailRequested", i."expiresAt",
       NULLIF(BTRIM(j.summary), '') IS NOT NULL AS summary_saved,
       EXISTS (
         SELECT 1 FROM "JobPublicationReady" r
         WHERE r.kind=p.kind AND r."jobId"=p."jobId" AND r.phase=p.phase
           AND r.generation=p.generation AND r."dueAt"=p."dueAt"
       ) AS eligible
FROM "JobPublicationIntent" p
JOIN "AdaptiveReportJob" j ON j.id=p."jobId"
JOIN "AdaptiveInterview" i ON i.id=j."interviewId"
WHERE p.kind='REPORT' AND p.state='PENDING';
ROLLBACK;
```

Conserver le REPORT, quelle que soit son éligibilité ; ne pas le déclarer expiré à partir du seul statut PENDING. Les réponses et la synthèse sauvegardées restent lisibles après rotation. Si une capture chiffrée doit encore être récupérée, arrêter la procédure : avec l'ancien secret perdu, la nouvelle clé ne pourra pas la déchiffrer. Une sauvegarde de ciphertext ne remplace pas la clé perdue. Reconfirmer zéro challenge valide et zéro bail actif juste avant la bascule.

## Étape 2 — nouveau secret, seulement après autorisation

Sur Windows, générer 32 octets cryptographiques et les encoder en base64url canonique sans padding (43 caractères). Conserver d'abord le résultat dans un coffre chiffré. Ne pas utiliser le générateur de mot de passe générique d'un coffre s'il ne garantit pas ce format exact.

Exemple PowerShell, à NE PAS exécuter pendant la préparation : stockage DPAPI lié au compte Windows courant, hors dépôt, puis transfert par presse-papiers sans affichage console. Le fichier chiffré dépend de ce compte et de cette machine ; conserver aussi une copie dans un coffre de mots de passe chiffré et sauvegardé pour survivre à une panne du PC.

```powershell
$rotationFolder = Join-Path $env:LOCALAPPDATA 'SkillQuest'
New-Item -ItemType Directory -Path $rotationFolder -Force | Out-Null
$rotationVault = Join-Path $rotationFolder 'staging-9ca8e522-rotation-20261109.clixml'
if (Test-Path -LiteralPath $rotationVault) { throw 'Sauvegarde existante : ne pas écraser.' }
$rotationBytes = New-Object byte[] 32
$rotationGenerator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rotationGenerator.GetBytes($rotationBytes)
$rotationGenerator.Dispose()
$rotationText = [Convert]::ToBase64String($rotationBytes).TrimEnd('=').Replace('+','-').Replace('/','_')
$rotationSecure = ConvertTo-SecureString -String $rotationText -AsPlainText -Force
$rotationSecure | Export-Clixml -LiteralPath $rotationVault
$rotationReloaded = Import-Clixml -LiteralPath $rotationVault
$rotationCredential = New-Object System.Management.Automation.PSCredential('local-verification', $rotationReloaded)
if ($rotationCredential.GetNetworkCredential().Password -cne $rotationText) { throw 'Échec de vérification du coffre local.' }
Set-Clipboard -Value $rotationText
[Array]::Clear($rotationBytes, 0, $rotationBytes.Length)
$rotationText = $null
$rotationCredential = $null
```

L'historique/synchronisation du presse-papiers doit être désactivé pour ce transfert. Coller directement dans le coffre puis dans le champ Vercel masqué ; ne jamais coller dans le chat, une commande ou un fichier texte. Après transfert : `Set-Clipboard -Value ''`. Les chaînes .NET transitoires ne garantissent pas un effacement immédiat de toute copie mémoire ; fermer ensuite ce terminal. L'opérateur recevra le nouveau secret via sa saisie masquée, pas une variable shell persistante.

## Étape 3 — Vercel, changement unique et redéploiement

Dans le projet backend existant : Settings → Environment Variables → `SKILLQUEST_STAGING_SECRET` → Edit. Vérifier que la portée est Production uniquement ; ne pas élargir à Preview/Development et ne pas éditer une valeur partagée avec d'autres projets. Si la portée est partagée, arrêter pour préparer une modification limitée au projet et à Production.

Remplacer uniquement cette valeur par celle du coffre et conserver le type Secret (ou Sensitive selon l'interface). Ne modifier ni le staging ID, ni DATABASE_URL, ni les peppers, ni le trousseau OTP, ni les autres autorisations. Enregistrer, puis Deployments → D0 (`46b1dde`) → Redeploy en Production avec les réglages actuels du projet. Vérifier que le récapitulatif applique les nouvelles variables ; ne pas sélectionner une option qui réutilise les anciennes valeurs de l'environnement. Aucun push Git n'est nécessaire.

Le déploiement D1 doit avoir exactement le même SHA que D0 mais un nouvel identifiant de déploiement. Aucun changement de schéma Prisma ou migration n'est nécessaire à cette rotation. Le build existant `build:vercel` génère le client et compile le backend, sans lancer `prisma migrate deploy`.

## Étape 4 — validation avant tout nouvel OTP

1. Attendre D1 Ready, vérifier le SHA `46b1dde`, puis appeler `GET /api/v1/health` sur son URL immuable et sur l'alias public. Attendre HTTP 200, status ok, database connected. Cette sonde ne valide pas à elle seule le secret ni le marqueur.
2. Avec le lanceur du commit exact, s'authentifier normalement comme admin@example.test et appeler uniquement l'action `status`, en fournissant le nouveau secret par saisie masquée. La configuration exige aussi une adresse synthétique et un UUID de job : utiliser ceux d'un objet existant identifié dans l'inventaire, sans appeler publish-otp/receive/mail. Attendre `SYNTHETIC_STATUS_OK`.
3. `status` enregistre une invocation anti-rejeu et l'authentification crée une session ADMIN : ces petites écritures techniques doivent faire partie de l'autorisation future. Elles ne modifient aucun participant ni traitement en attente. Ne jamais qualifier ce contrôle de lecture seule.
4. Vérifier les comptages et les états des participants/rapports : inchangés. Ne pas réutiliser d'ancien job, notification ou capture. La création d'un nouveau parcours OTP ciblé et d'une identité `@example.test` inédite est une étape distincte à autoriser après cette validation.

## Étape 5 — rollback sans connaissance de l'ancien secret

Si D1 n'est pas Ready ou échoue aux contrôles : suspendre les tests ; si D0 est encore actif, le laisser servir. Sinon Vercel → Production Deployment → Instant Rollback → sélectionner **D0 par son identifiant**, vérifier les domaines et confirmer après autorisation. Ce rollback réutilise le déploiement existant et son environnement d'origine. **Ne pas redéployer l'ancien commit** : un nouveau build prendrait la nouvelle valeur du projet.

Après rollback : vérifier health et l'accès normal aux rapports, sans opération OTP. Les paramètres du projet contiennent toujours la nouvelle valeur, gardée dans le coffre. L'ancien secret reste inconnu : le rollback restaure le service antérieur, pas la capacité de l'opérateur à signer avec cette ancienne clé. Les objets créés sous la nouvelle clé ne deviennent pas lisibles sous l'ancienne. Ne pas restaurer Neon, supprimer des objets ou réarmer des jobs. Il faut préparer une nouvelle bascule avant toute reprise des tests.

## Limites Hobby et sources officielles vérifiées le 9 novembre 2026

- Instant Rollback Hobby : uniquement le déploiement immédiatement précédent, même si plusieurs anciens déploiements sont conservés. Vérifier que D0 est la cible, sans déploiement intermédiaire. Les anciennes variables restent attachées aux déploiements existants ; changer les paramètres ne les modifie pas rétroactivement.
- La rétention Hobby protège notamment les trois dernières productions, les trois derniers déploiements de tout type et la production actuelle. Cela ne donne pas trois cibles de rollback sur Hobby, ni un archivage permanent. La mention Auto-delete Never fournie concerne la sauvegarde Neon, pas Vercel.
- Le stockage de déploiement Hobby est limité à 10 Go ; un dépassement peut bloquer un nouveau déploiement. Vérifier les quotas réels dans le compte, sans achat ni upgrade. Aucune garantie de quota disponible ne peut être déduite de l'audit local.
- Un Instant Rollback désactive l'affectation automatique des nouveaux déploiements aux domaines Production jusqu'à réactivation explicite ; conserver cet état pendant l'analyse.

Sources : [Instant Rollback](https://vercel.com/docs/instant-rollback), [variables d'environnement](https://vercel.com/docs/environment-variables), [rétention Hobby du 16 septembre 2026](https://vercel.com/changelog/hobby-projects-now-retain-fewer-deployments-to-free-up-storage).

Aucun changement distant, secret réel généré, appel fournisseur, suppression ou déploiement effectué pendant cette préparation.
