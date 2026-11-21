# Identité réseau Vercel — étape 2, qualification locale

## Garanties documentées et limites

Sources officielles consultées le 31 octobre 2026 : [en-têtes de requête](https://vercel.com/docs/headers/request-headers), [proxy supplémentaire devant Vercel](https://vercel.com/kb/guide/can-i-use-a-proxy-on-top-of-my-vercel-deployment).

Vercel documente le remplacement de X-Forwarded-For pour empêcher l'usurpation et décrit x-vercel-forwarded-for comme son équivalent, avec une distinction lorsque XFF est réécrit par un proxy supplémentaire. X-Real-IP est également décrit comme équivalent. Ce sont des métadonnées d'infrastructure, pas une preuve cryptographique autonome. Leur nom ne prouve pas qu'une requête a traversé Vercel.

La documentation de x-vercel-signature concerne notamment les webhooks et drains. Aucune signature personnalisée SkillQuest ni signature de l'IP des requêtes navigateur ordinaires n'est supposée fournie par Vercel. L'application ne vérifie ni n'utilise cet en-tête.

L'adaptateur est préparé uniquement pour un navigateur arrivant directement à l'ingress Vercel du projet frontend. Une configuration Trusted Proxy, un CDN/proxy supplémentaire, une réécriture de ces en-têtes dans du middleware ou un chemin contournant l'ingress annulent cette hypothèse : ne pas activer ce mode sans nouvelle qualification.

## Chaîne de confiance

Navigateur → ingress Vercel du projet Next.js → adaptateur serveur Next.js → preuve HMAC applicative → URL HTTPS du projet Express → contrôle atomique de fraîcheur/nonce dans PostgreSQL.

`frontend/src/lib/vercel-network.ts` exige des variables serveur : VERCEL=1, NODE_ENV=production, VERCEL_ENV=preview ou production et SKILLQUEST_VERCEL_INGRESS=direct. Le sélectionneur exige SKILLQUEST_NETWORK_SOURCE=vercel. Les variables de processus constituent une configuration de déploiement contrôlée par l'opérateur ; elles ne sont ni lues dans les en-têtes ni une attestation cryptographique de l'hébergement. Les copier sur un autre hébergement ne rend pas ses en-têtes fiables.

Dans ce mode, une seule IP est lue dans x-vercel-forwarded-for. Aucun choix du premier élément d'une liste, ni repli vers XFF, X-Real-IP, Forwarded, CF-Connecting-IP, paramètres, corps, cookies ou preuve edge personnalisée n'est effectué. IP avec port, liste, CIDR, zone IPv6 ou syntaxe ambiguë refusée. IPv4 et IPv4 mappée sont normalisées en /32 ; IPv6 en /64 avant signature. Aucune géolocalisation n'est collectée.

Une IP absente/invalide produit une identité réseau inconnue signée. Express refuse alors les opérations OTP avec 503 EMAIL_NETWORK_UNAVAILABLE, avant challenge, compteurs OTP, budget ou participant. Une preuve et son nonce peuvent néanmoins être traités : le refus ne désactive pas la protection contre les rejeux. Les consultations autorisées d'un parcours existant restent possibles selon les règles du LOT 5. Une configuration d'adaptateur invalide entraîne un 503 Next.js avant appel au backend.

Le défaut reste le mode edge existant ; il ne fait pas confiance aux en-têtes Vercel par leur simple présence. Le mode localhost contrôlé demeure utilisable uniquement sans activation de l'adaptateur Vercel et selon les contraintes déjà existantes.

## Protocole entre projets inchangé

SKILLQUEST_PROXY_HMAC_KEY reste une clé dédiée partagée uniquement par Next.js et Express, jamais NEXT_PUBLIC. Les clés OTP et le pepper ne sont pas réutilisés. Le BFF construit lui-même x-skillquest-proxy-proof, sans relayer les preuves ou en-têtes réseau du navigateur. En mode Vercel, SKILLQUEST_EDGE_HMAC_KEY n'est pas nécessaire ; les preuves edge entrantes sont ignorées, même si leur signature est valide.

HMAC-SHA-256 lie audience, méthode, chemin/query backend, corps relayé, Bearer et réseau normalisé. Chaque nouvelle requête Vercel reçoit un UUID aléatoire et un horodatage nouveaux ; le rejeu d'une requête navigateur ordinaire est une nouvelle demande applicative, soumise aux compteurs OTP, pas une preuve d'infrastructure réutilisable. Le rejeu d'une preuve interne conserve son UUID et est refusé atomiquement dans PostgreSQL. Le mode edge historique conserve toujours l'UUID et l'horodatage de sa preuve ingress.

Express conserve trust proxy=false, la fenêtre de 60 secondes, la tolérance future de 5 secondes et le stockage de nonces partagé. Ni l'adresse socket du frontend ni les en-têtes Vercel reçus directement par Express n'autorisent un accès adaptive. L'URL publique du backend reste protégée par HMAC ; CORS ou le nom de domaine ne remplacent pas cette authentification. Les autres routes historiques et administrateur conservent leurs contrôles existants, sans élargissement de périmètre.

Les plafonds par e-mail, réseau/e-mail et budget Brevo restent les mêmes, persistants en PostgreSQL. Plusieurs étudiants derrière un NAT ou un /64 ne partagent pas un petit quota OTP unique : la dimension NETWORK du LOT 5 reste liée à l'identité e-mail. Changer de réseau ne réinitialise pas les plafonds e-mail. Les empreintes réseau, leur rétention et la gestion des envois incertains restent inchangées. Les IP brutes ne sont pas ajoutées aux journaux ou aux tables par cette étape.

## Configuration à préparer sans la modifier maintenant

Frontend Vercel :

- SKILLQUEST_NETWORK_SOURCE=vercel et SKILLQUEST_VERCEL_INGRESS=direct, uniquement après qualification de l'ingress.
- Variables système VERCEL, VERCEL_ENV disponibles ; NODE_ENV=production dans le build Next.js, y compris preview. Vercel dev ou NODE_ENV=test ne suffisent pas.
- SKILLQUEST_PROXY_HMAC_KEY : clé interne dédiée existante, même version que le backend, jamais publique. Aucune valeur réelle n'est créée, affichée ou modifiée ici.
- API_INTERNAL_URL : URL HTTPS exacte du backend autorisé, sans redirection ; paramètres PUBLIC_APP_ORIGIN et cookies existants conservés.

Backend Vercel :

- SKILLQUEST_PROXY_HMAC_KEY correspondante ; protections de production obligatoires, trust proxy=false.
- PostgreSQL externe partagé par les instances pour les nonces et quotas. CORS_ORIGIN explicite et autres paramètres existants conservés.
- Aucun mode réseau Vercel n'est nécessaire côté Express : l'IP fournie par Vercel au backend identifie le BFF, pas l'étudiant.

Localhost : conserver le mode local explicite existant, sans SKILLQUEST_NETWORK_SOURCE=vercel. Les tests simulent les variables Vercel uniquement dans leurs processus isolés avec des clés synthétiques ; cela n'active aucun environnement réel.

## Validation obligatoire en staging Vercel, non effectuée ici

1. Utiliser deux projets de staging, une base synthétique dédiée et des secrets de test distincts. Brevo doit rester simulé ; aucun appel fournisseur n'est nécessaire pour cette validation.
2. Vérifier que toutes les URL accessibles (preview, alias, domaine personnalisé, chemins réécrits et fonctions) traversent l'ingress Vercel attendu. Inventorier middleware, rewrites, intégrations et configuration Trusted Proxy ; aucun autre proxy ne doit injecter/remplacer l'identité choisie.
3. Depuis des clients contrôlés IPv4 et IPv6, envoyer des valeurs arbitraires, multiples et contradictoires dans x-vercel-forwarded-for, XFF, X-Real-IP, Forwarded, x-vercel-id, x-vercel-signature et preuves SkillQuest. Vérifier que la valeur effectivement reçue par la route correspond au client de test et ne peut pas être choisie par lui, notamment pour x-vercel-forwarded-for. Si cette garantie ne tient pas, désactiver l'adaptateur et bloquer l'OTP ; ne pas ajouter un fallback.
4. Observer le résultat à travers la vraie route App Router, pas seulement dans un middleware ou un endpoint de diagnostic. Les diagnostics éventuels doivent être temporaires, protégés et sans stockage d'IP réelles ; ils ne sont pas ajoutés par cette étape.
5. Tester l'appel direct à toutes les URL du backend sans preuve, avec preuve altérée/expirée et le rejeu concurrent d'une même preuve sur plusieurs instances. Attendre 403, aucun OTP et une seule consommation de nonce pour une preuve initialement acceptée.
6. Vérifier l'absence d'IP dans les journaux applicatifs et l'absence des clés/preuves dans le navigateur, les réponses et les bundles publics. Contrôler les horloges, délais interprojets, cookies HTTPS, parcours FR/AR et sessions administrateur.
7. Tester NAT, /64 IPv6, changement de réseau mobile, concurrence et budget partagé, ainsi que le comportement sans origine fiable. Rejouer les qualifications des LOTS 1 à 5.

Ces tests locaux ne prouvent pas la provenance des en-têtes en production. Le déploiement et l'activation restent soumis à autorisation. L'exécution durable des jobs OTP/rapports, la purge périodique, le pooling PostgreSQL et Chromium Linux restent hors de cette étape ; aucune file durable n'est intégrée.
