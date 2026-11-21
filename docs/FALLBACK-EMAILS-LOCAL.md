# Rapports de secours par e-mail — validation locale du 5 novembre 2026

## Résultat et périmètre

La préparation HTML/PDF et le traitement simulé des rapports de secours sont
implémentés. Aucun e-mail réel, appel Groq, appel QStash, changement Neon, push
ou déploiement n'a été effectué. Aucun secret de déploiement n'a été ajouté.
Coût fournisseur de cette validation : **0 DH**.

Les blocages initiaux étaient le modèle HTML, le sélecteur de la file, le contrôle
SQL avant réservation, la disponibilité du transport et la vue SQL des travaux
éligibles. Ils exigeaient tous une synthèse complète ou une configuration Brevo.
L'absence de fournisseur IA empêchait aussi de créer un travail pour le rapport.

## Choix du contenu

- `COMPLETE` avec une synthèse exploitable : conservation de la synthèse IA
  enregistrée, dans la langue du parcours, avec ses libellés habituels.
- `UNAVAILABLE` avec un bilan déterministe terminé : préparation du bilan
  pédagogique de secours, en français ou en arabe. Le texte ne le présente pas
  comme généré par IA. Un éventuel ancien contenu `job.summary` n'est pas utilisé.
- `PENDING`, `PROCESSING`, `RETRY` : aucun e-mail prématuré et aucune préparation
  PDF par la file. Le bilan consultable et son impression restent disponibles.
- Entretien incomplet, synthèse `COMPLETE` absente, accès expiré, consentement
  absent ou adresse absente : aucun envoi. Une synthèse non exploitable n'est pas
  transformée silencieusement en e-mail de secours au statut `COMPLETE`.

Sans fournisseur IA configuré, un travail `UNAVAILABLE / AI_NOT_CONFIGURED` peut
être créé pour un bilan terminé, uniquement si l'e-mail a été demandé, qu'une
adresse existe et que le transport des rapports est configuré. Cela ne déclenche
aucun transport à la création. Sans adresse, le parcours Code de session reste
utilisable et ne crée pas de demande d'e-mail ; les travaux de synthèse existants
portent `NOT_REQUESTED` côté e-mail.

## Transport et protections

Le mode serveur `synthetic-v1` sélectionne le transport `simulateEmail()` existant
pour les rapports uniquement. Il exige une configuration valide, l'absence de
clés fournisseurs externes, un marqueur de base conforme, des identités
synthétiques et des destinataires `@example.test`. Un nom `SYNTH-` ou une adresse
fictive ne sélectionne jamais à lui seul ce transport. Un échec de ces contrôles
ne bascule pas vers Brevo.

Les messages simulés sont capturés chiffrés dans `SyntheticMail`. Le PDF est
effectivement généré en local ; la boîte simulée conserve seulement son nom et
sa taille, pas son contenu binaire. Le statut `SENT` dans cette base de test
signifie **accepté par le simulateur**, pas livré dans une boîte réelle.

Le transport simulé passe par le budget et les réservations existants : compteur
partagé, empreinte du message, UUID d'idempotence, gestion des réponses perdues
et fenêtre sûre de réessai sont conservés. Un budget nul bloque même le simulateur.
Les quotas utilisés dans les fixtures sont des compteurs de base locale, pas des
crédits fournisseur. La configuration et le transport OTP restent inchangés.

L'acquisition de la file vérifie aussi le statut et la synthèse sélectionnés.
Avant réservation/envoi, la transaction revérifie le bail, son compteur, le statut,
la synthèse, l'état du parcours, le consentement, l'adresse et l'expiration.
Une révocation de consentement pendant la préparation PDF empêche le transport.
Un travail déjà envoyé n'est pas réarmé, notamment lors de consultations répétées.

## Fichiers modifiés dans cette phase

- `backend/src/services/report-email-template.ts` : éligibilité du bilan de secours ;
  réutilisation des libellés pédagogiques FR/AR déjà prévus pour le PDF.
- `backend/src/services/report-email-queue.service.ts` : statuts autorisés,
  expiration et revérification transactionnelle du contenu et du consentement.
- `backend/src/services/brevo.service.ts` : disponibilité des rapports distincte
  des OTP, branche de transport simulé et validation commune des pièces jointes.
- `backend/src/services/report-queue.service.ts` : travail de secours sans
  fournisseur IA pour les seuls destinataires éligibles.
- `backend/src/services/adaptive.service.ts` : le statut e-mail d'un rapport
  `UNAVAILABLE` n'affiche plus indéfiniment `WAITING_AI`.
- `backend/src/routes/adaptive.routes.ts` : disponibilité du transport des rapports.
- `backend/prisma/migrations/20261105000100_report_fallback_email/migration.sql` :
  remplacement compatible de la vue des candidats, sans activer de transport.
- `backend/tests/report-fallback-email.test.ts` : 12 scénarios de validation.
- `backend/tests/summary-on-demand.test.ts` : l'assertion de refus d'e-mail
  prématuré porte désormais sur `PENDING`, puisque `UNAVAILABLE` est autorisé.
- `docs/DEPLOYMENT.md` et ce document : référence et compte rendu.

Ni les 31 questions, ni les parcours OTP/Code de session, ni le bouton de synthèse,
ni le moteur de rendu PDF n'ont été modifiés.

## Validation et preuves

- Suite backend finale : **211 réussites, 0 échec, 277 ignorés** (488 tests).
  Journal : `output/fallback-email-backend-final.log`.
- **12/12 tests de secours** sur PostgreSQL natif temporaire : contenu FR/AR,
  `COMPLETE`/`UNAVAILABLE`, PDF réel, traitement concurrent, capture unique,
  refus des statuts intermédiaires, absence d'adresse/consentement, expiration,
  retrait du consentement pendant le PDF, réponse perdue, restrictions synthétiques,
  absence de configuration IA, budget épuisé et pièce jointe invalide.
- **31/31 tests OTP et Code de session** sur un second PostgreSQL temporaire.
- **33/33 tests frontend** ; typechecks et builds backend/frontend réussis.
- Les essais PGlite appliquent toutes les migrations uniquement dans leur base
  locale éphémère. Les essais natifs vérifient l'identité et l'emplacement du
  cluster avant toute migration ; les deux serveurs ont été arrêtés, leurs ports
  fermés et leurs répertoires de données supprimés après les essais.

Preuves natives :
`output/lot4-946647792edf/native-NRHvQE/tests.log` (rapports) et
`output/lot4-946647792edf/native-mdEbra/tests.log` (OTP), avec `shutdown.json`
dans chacun des répertoires.
Autres journaux : `output/fallback-email-frontend-tests.log`,
`output/fallback-email-typecheck.log`, `output/fallback-email-build.log`.

Un premier passage global a rencontré un incident asynchrone de fermeture PGlite
dans `session-full-validation.test.ts`, après réussite de ses assertions. La
relance isolée réussit : `output/fallback-email-session-rerun.log`. Aucun code
de parcours n'a été changé pour masquer cet incident.
La relance globale complète réussit également sans cet incident.

## Limites et points à examiner avant publication

La migration est **locale et non appliquée à Neon**. Elle devra être revue avec
le code si une publication est ensuite autorisée. Sans elle, la file appelée
directement peut préparer le secours, mais la vue de publication historique ne
présentera pas ces travaux à un futur ordonnanceur.

Aucun déclenchement automatique, worker, ordonnanceur ou QStash n'a été activé.
La livraison réelle et la durée du PDF dans une fonction Vercel ne sont pas
qualifiées par ces essais. Hors mode synthétique, le transport Brevo existant
reste disponible si son environnement est configuré : après publication et
traitement explicite de la file, un rapport de secours éligible pourrait alors
être envoyé. Cette validation locale n'autorise ni cette publication ni cet envoi.

Les 277 scénarios qui exigent d'autres bancs dédiés ne sont pas qualifiés par la
suite générique ; les deux bancs natifs ci-dessus couvrent les changements et les
régressions OTP demandés. Aucun secret ni donnée d'un environnement distant n'a
été utilisé comme destinataire ou contenu de ces essais.
