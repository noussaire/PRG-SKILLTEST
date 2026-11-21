# API 0.2.0

Toutes les routes ci-dessous sont préfixées par `/api/v1` côté Express. Le navigateur utilise les routes `/api/...` Next.js et leurs cookies ; il ne manipule pas directement les jetons Bearer.

| Méthode | Route Express | Fonction |
|---|---|---|
| GET | `/health` | Disponibilité API et base |
| POST | `/sessions/join` | Code privé + nom ou pseudonyme |
| GET | `/participants/me` | Situation courante et progression persistée |
| POST | `/participants/decisions` | Réponse à la situation de la version figée |
| GET | `/participants/me/report` | Bilan final ; 409 tant que le parcours n'est pas terminé |
| POST | `/participants/logout` | Révocation du jeton invité |
| POST | `/admin/auth/login` | Connexion administrateur |
| POST | `/admin/auth/logout` | Révocation de session administrateur |
| GET | `/admin/auth/me` | Identité et rôle |
| GET | `/admin/dashboard` | Tableau de bord |
| GET | `/admin/participants` | Liste paginée |
| GET | `/admin/participants/:id` | Détail, enveloppe `{ participant: ... }` |
| GET | `/admin/participants/:id/decisions` | Historique figé et alternatives de l'époque |
| GET | `/admin/participants/:id/competencies` | Même calcul que le rapport principal |
| POST | `/admin/participants/:id/revoke` | Révocation de l'accès invité |
| GET / POST | `/admin/sessions` | Liste / création |
| GET / PATCH | `/admin/sessions/:id` | Lecture / modification |
| POST | `/admin/sessions/:id/open` | Ouvrir |
| POST | `/admin/sessions/:id/close` | Fermer |
| POST | `/admin/sessions/:id/archive` | Archiver |
| POST | `/admin/sessions/:id/rotate-code` | Renouveler le code |
| GET / POST | `/admin/missions` | Liste / création |
| GET / PATCH | `/admin/missions/:id` | Lecture / métadonnées |
| PUT | `/admin/missions/:id/graph` | Sauvegarde de brouillon avec `expectedRevision` obligatoire |
| POST | `/admin/missions/:id/validate` | Contrôle de cohérence |
| POST | `/admin/missions/:id/publish` | Nouvelle version avec `expectedRevision` obligatoire |
| POST | `/admin/missions/:id/duplicate` | Nouvelle mission brouillon |
| POST | `/admin/missions/:id/archive` | Archiver |
| GET | `/admin/missions/:id/versions` | Historique |
| GET | `/admin/missions/:id/versions/:version` | Version immuable |
| GET | `/admin/reports` | Rapports filtrés et paginés |
| GET | `/admin/reports/:attemptId` | Rapport individuel ; provisoire si tentative en cours |
| GET | `/admin/reports/sessions/:sessionId/collective` | Statistiques collectives protégées |

Publication : transmettre `{ "expectedRevision": 3 }` avec la révision réellement retournée par la dernière sauvegarde. Une révision absente provoque 400 ; une révision obsolète provoque 409. Le proxy Next.js transmet ce corps jusqu'à Express.

Dans les champs de contenu, une valeur bilingue peut utiliser `:::frTexte français:::arالنص العربي`. Le moteur de présentation choisit la langue sans modifier le texte conservé dans les preuves.
