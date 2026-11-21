# Participation et renouvellement du test

- La suppression d’une participation est réservée aux administrateurs authentifiés. Le site public et l’API publique refusent cette opération, même avec un ancien jeton valide.
- Une adresse e-mail identifie une fiche. La casse et les espaces sont normalisés ; les alias Gmail avec points, suffixe `+` ou domaine `googlemail.com` correspondent à la même identité. Le nom reste une information du participant, pas un identifiant unique : des homonymes peuvent avoir des adresses différentes.
- Un démarrage est possible tous les **30 jours révolus**, à partir du dernier démarrage, y compris pour un test abandonné. Le contrôle est effectué en base et résiste aux démarrages simultanés et aux changements de navigateur.
- Pendant les 7 jours d’accès, le navigateur initial permet de reprendre le test existant, sans recommencer ni consommer un nouveau délai.
- Après 30 jours, le formulaire envoie un code à l’adresse déjà enregistrée via Brevo. Il expire après 10 minutes, autorise 5 essais et ne peut être renvoyé qu’après une minute. Le code est conservé sous forme de HMAC, jamais en clair. Un changement de nom seul ne contourne pas le délai.
- Le code valide renouvelle la même fiche et son identifiant, actualise le nom et fait expirer l’ancien accès. Les anciens travaux IA/e-mail sont retirés ; un travail en cours doit d’abord libérer son verrou.
- L’ancien rapport complet reste accessible à l’administration pendant le nouveau test. À la 31e réponse, le nouveau bilan le remplace et une nouvelle synthèse IA peut être produite puis envoyée selon la configuration habituelle. Les e-mails précédemment reçus ne peuvent pas être remplacés dans la messagerie du destinataire.
- La migration conserve les données existantes. En cas de doublons historiques, la participation la plus récente porte l’identité utilisée pour les renouvellements ; les autres lignes ne sont pas supprimées automatiquement.

## Configuration et validation

La confirmation utilise les paramètres Brevo existants (`BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`), sans nouvelle clé. Si l’envoi n’est pas disponible, le rapport précédent est conservé et le renouvellement n’est pas effectué.

La migration `20261029030000_participant_retake` doit être appliquée avant de démarrer cette version. Le lanceur local l’applique automatiquement ; sur PostgreSQL hébergé, utiliser la commande habituelle `npm run db:deploy`.

Les tests API couvrent les doublons, les alias Gmail, la concurrence, le délai, les codes expirés/épuisés, la révocation de l’ancien accès, la conservation temporaire du rapport et son remplacement. `npm run test:browser` vérifie aussi le formulaire FR/AR, l’accès administrateur à l’ancien rapport et un nouveau parcours complet. Les tests utilisent une base isolée et simulent Brevo sans envoyer d’e-mails réels.
