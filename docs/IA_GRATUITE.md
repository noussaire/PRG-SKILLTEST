# Parcours gratuit : questions préparées, synthèse IA facultative

## Fonctionnement

La page `/entretien` présente le choix des tests : soft skills disponible et égogramme à venir. Le test `/entretien/soft-skills` demande le nom complet et une adresse e-mail valide avant de commencer, sans création de compte. Gmail et les autres fournisseurs d’e-mail sont acceptés. Il utilise une banque préparée de 31 situations en français et en arabe. Chaque question présente quatre actions. Le choix sélectionné détermine une priorité et oriente la prochaine compétence encore inexplorée. Toutes les compétences sont abordées une fois.

La version `prepared-v2` associe à chacune des 124 propositions une conséquence narrative et une suite privilégiée, en français et en arabe. Le choix précédent et sa conséquence sont affichés avant la nouvelle question. La question sauvegardée contient ces éléments : recharger la page ne réécrit pas l’histoire. Si la compétence prévue a déjà été abordée, une compétence liée encore inexplorée est choisie, en conservant la conséquence du choix. Des réponses différentes produisent donc des branches différentes ; deux personnes faisant les mêmes choix peuvent suivre la même branche.

**Aucun appel à une IA n’est effectué pour démarrer, afficher une question, enregistrer une réponse ou produire le bilan complet.** L’absence de clé, un quota Groq épuisé ou une panne du fournisseur ne bloque pas les questions.

Les propositions sont mélangées avant affichage, puis sauvegardées. La grille de chaque question reste sur le serveur et les identifiants de choix sont vérifiés. La banque versionnée se trouve dans `backend/src/services/prepared-bank.ts`. Elle doit être relue pédagogiquement ; ce dispositif n’est pas un test psychométrique validé ni un classement d’étudiants.

Les anciens parcours conservent leurs réponses. Au rechargement, la question non encore répondue est remplacée par une situation préparée, au même niveau de progression.

## Bilan immédiat et enrichissement IA

Après la 31e réponse, le bilan complet contient les 31 compétences, les choix enregistrés, les indicateurs contextuels, les conseils et une synthèse automatique. Il est immédiatement consultable et imprimable en PDF.

Si Groq est configuré, une tâche de synthèse IA est ajoutée à une file persistante. Un appel court utilise seulement les principaux points d’appui, priorités et deux courts extraits de choix. Le nom, l’e-mail, le jeton d’accès et l’historique complet ne sont pas envoyés. L’IA enrichit la synthèse ; elle ne modifie pas les 31 observations ni leur grille.

Le serveur traite au plus une tâche à la fois, avec un espacement de six secondes minimum. Si le fournisseur impose une attente, la file respecte ce délai. Les tâches peuvent reprendre après un redémarrage et ne sont pas dupliquées. Après trois échecs, le bilan automatique reste disponible sans bloquer le participant.

La page consulte les mises à jour toutes les 30 secondes uniquement lorsqu’elle est visible. Le participant peut aussi revenir plus tard depuis le même navigateur. Le backend doit rester en fonctionnement pour traiter la file.

## Configuration gratuite

La clé n’est nécessaire que pour la synthèse IA facultative. Pour l’obtenir : créer un compte sur [Groq Console](https://console.groq.com/), rester sur Free, puis créer une clé dans [API Keys](https://console.groq.com/keys). Ne pas activer l’offre payante ni ajouter de moyen de paiement pour cet usage.

Dans le fichier privé `backend/.env` :

```dotenv
GROQ_API_KEY="CLE_PRIVEE_ICI"
GROQ_MODEL="openai/gpt-oss-120b"
AI_DAILY_REQUEST_LIMIT=400
```

Ne jamais mettre la clé dans une variable `NEXT_PUBLIC_`, un dépôt public ou un message. La clé reste côté backend. Le lanceur local de la démonstration charge ces trois paramètres au démarrage ; redémarrer le backend après une modification.

`AI_DAILY_REQUEST_LIMIT` est un plafond d’appels de synthèse par jour pour l’ensemble du site, et non une réservation garantie chez Groq. Les questions ne consomment plus ce compteur. Les tentatives échouées de synthèse y sont comptées.

Les [limites du fournisseur](https://console.groq.com/docs/rate-limits) restent partagées par le compte : une synthèse IA instantanée pour 300 personnes n’est pas garantie avec une offre gratuite. Le bilan complet reste utilisable pendant cette attente. Aucun passage automatique à une offre payante n’est prévu.

Le titulaire du compte Groq et les participants de cette version doivent être majeurs. Voir les [conditions Groq](https://console.groq.com/docs/legal/services-agreement) et [le traitement des données](https://console.groq.com/docs/your-data).

## Base de données et démarrage

Les migrations ajoutent la file des synthèses puis la colonne e-mail nullable pour les nouveaux formulaires. Les anciens parcours conservent leur progression et n’ont pas d’e-mail inventé. Lire `docs/MISE_A_JOUR.md` et `docs/ADMINISTRATION_ADAPTATIVE.md` pour une installation existante, vérifier les URL de la base visée et sauvegarder les données. Ne pas effectuer de reset ni de seed sur une base réelle.

Serveurs arrêtés, depuis la racine sous PowerShell :

```powershell
npm.cmd run db:generate
npm.cmd run db:deploy
npm.cmd run dev
```

Sous Windows, arrêter le backend avant de régénérer Prisma évite le verrouillage de sa bibliothèque. Les migrations de la démonstration locale sont appliquées à sa base isolée par son lanceur, sans réinitialiser les réponses.

## Groupe de 100 à 300 personnes

Les limites d’inscription tiennent compte du fait qu’une classe peut partager une même adresse réseau. Les tests couvrent 300 parcours complets simulés sans appel externe et 300 inscriptions via l’API de test. Ils ne constituent pas une garantie de 300 connexions simultanées sur n’importe quel hébergement.

Le déploiement doit disposer d’un frontend Next.js, d’un backend Express restant actif et d’une base PostgreSQL native. La démonstration PGlite sur ordinateur n’est pas un hébergement de production. Une offre gratuite possède aussi des limites de calcul, stockage et disponibilité : vérifier celles du service choisi et faire un essai de charge avant une séance avec des participants.

`localhost:3000` est une adresse locale, pas une publication sur Internet. Aucun hébergement public n’a été créé. Voir `docs/DEPLOYMENT.md` pour les besoins de configuration et de déploiement.

## Français et arabe

Le bouton de langue traduit les 31 questions préparées, leurs quatre choix, les conséquences des décisions et le bilan détaillé. Les identifiants des choix et la progression restent identiques ; aucune traduction externe n’est appelée pendant les questions.

Pour les nouveaux rapports, un seul appel IA demande deux versions équivalentes de la synthèse : français et arabe standard. Les deux textes sont conservés avec le rapport ; changer de langue ne déclenche aucun nouvel appel. Si l’IA est indisponible, le bilan et sa synthèse automatique restent disponibles dans les deux langues. Le PDF utilise la langue affichée.

Les anciennes réponses libres restent conservées dans leur langue d’origine. Une ancienne synthèse IA disponible dans une seule langue est remplacée à l’affichage par la synthèse automatique dans l’autre langue, sans consommation supplémentaire du quota.

## Conservation des parcours

L’accès expire après sept jours, sans suppression automatique des données. Le participant peut supprimer son parcours ; la tâche de synthèse associée est alors supprimée aussi. L’organisateur doit définir une durée de conservation. Le traitement déjà effectué par un fournisseur externe dépend de ses conditions.

## Vérifications

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Les tests utilisent une base temporaire et un fournisseur simulé. Ils ne consomment pas le quota Groq de l’organisateur.
