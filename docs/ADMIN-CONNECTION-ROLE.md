# Identifier le rôle de la connexion du dispatcher

Préparation locale uniquement. Aucun déploiement ni changement de permission,
de variable ou de fournisseur. Aucun nouveau mécanisme d'authentification.

## Session existante vérifiée dans le code

- La page /admin/login appelle le BFF /api/admin/login.
- Le backend /api/v1/admin/auth/login crée une AdminSession et retourne son jeton.
- Le BFF conserve ce jeton dans le cookie HttpOnly sq_admin (Secure en Production,
  SameSite=Lax) et ne le retourne pas au JavaScript du navigateur.
- AdminShell vérifie la session par /api/admin/me ; les BFF transmettent le cookie
  au backend dans Authorization, uniquement côté serveur.
- Le backend vérifie le hash du jeton, l'expiration et le rôle ADMIN.

Cette vérification établit l'existence du parcours dans le code, pas la présence
d'une session actuellement valide en Production. Aucune session réelle n'a été
consultée ou créée pendant la préparation.

## Utilisation après déploiement explicitement autorisé

Dans le navigateur déjà connecté à l'administration du site, ouvrir sur le même
domaine frontend :

    /api/admin/connection-role

Le BFF utilise le cookie existant et API_INTERNAL_URL déjà configurée. Aucun
token Vercel ou secret applicatif n'est à créer, copier, afficher ou saisir.
Ne pas utiliser directement l'URL du backend dans le navigateur : son
authentification Bearer est fournie automatiquement par le BFF frontend.

Le backend /api/v1/admin/connection-role utilise le singleton src/db/prisma.ts
également importé par configuredDispatch. La requête de diagnostic est fixe :

```sql
SELECT
current_user = 'skillquest_app' AS is_app,
current_user = 'skillquest_runtime' AS is_runtime
```

Le résultat de succès contient exactement is_app et is_runtime, tous deux
booléens. Deux valeurs false indiquent que le rôle effectif n'est aucun des
deux rôles testés. Aucun autre nom de rôle ni URL de connexion n'est retourné.
Il s'agit de la même configuration de client et du même singleton dans chaque
processus, pas d'une garantie de réutilisation d'une connexion physique précise.

## Protections et conditions

La vérification de session lit AdminSession et User avant le SELECT de diagnostic.
Elle réutilise l'authentification existante avec le nettoyage des sessions
expirées désactivé pour cette action uniquement. Une session expirée est refusée,
sans suppression. Le comportement des autres routes administrateur est conservé.
Les deux points d'entrée renvoient Cache-Control: private, no-store et n'exposent
aucun résultat sans authentification. Aucun paramètre ne peut changer la requête.
Le BFF refuse les redirections de l'upstream et filtre sa réponse aux deux booléens.
Les erreurs de diagnostic restent génériques, sans journalisation des détails.

La connexion utilisée doit pouvoir lire les sessions et utilisateurs existants.
Si elle ne le peut pas, ou si aucune session admin valide n'existe, le diagnostic
reste inaccessible : 503 ou 401. Il n'existe aucun contournement de cette protection.
Ouvrir cette URL ne crée pas de session. Une nouvelle connexion via /admin/login
créerait une session en base et constitue donc une opération différente.

Aucun démarrage du serveur de jobs, OTP, réveil du dispatcher, appel QStash ou
Brevo n'est ajouté. Les seules opérations SQL de cette action sont des lectures.

## Tests locaux

Tests backend avec le singleton Prisma simulé : accès anonyme/malformé refusé
avant lecture, session expirée/inconnue/non-admin refusée sans diagnostic ni
suppression, session valide acceptée, SELECT exact sans interpolation, filtrage
des deux booléens, erreurs SQL/authentification et résultat invalide masqués.

Tests frontend avec fetch simulé : réutilisation du cookie côté serveur,
refus sans cookie, absence de Set-Cookie, requête fixe sans redirection ni cache,
filtrage des réponses et erreurs, aucune configuration/connexion divulguée.

Ces tests ne contactent ni Neon ni un fournisseur. Aucun token réel n'est utilisé.
Ils ne prouvent pas la validité d'une session ni les droits du rôle en Production.
