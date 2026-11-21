# Consolidation locale des LOTS 1 à 5

Vérification du 31 octobre 2026. Ce document consolide les qualifications déjà
enregistrées ; aucun test n'a été réexécuté pendant cette vérification. Aucun code
applicatif, secret, migration ou environnement de déploiement n'a été modifié.

## Résultats enregistrés

- PostgreSQL natif : **61/61**, dont les 48 tests antérieurs et 13 tests LOT 5.
- Tests unitaires de qualification : **12/12** (8 cryptographiques, 2 du
  planificateur de rétention, 2 du protocole réseau).
- Non-régression backend : **42/42**.
- Frontend : **21/21**, dont les 16 tests antérieurs et 5 tests proxy.
- Total de ces exécutions : **136 réussites**, aucun échec et aucun test ignoré.
- TypeScript backend et frontend : sorties enregistrées à zéro.

La couverture comprend la rétention et ses rollbacks, les budgets persistants,
la réservation du dernier crédit, les envois incertains, la rotation et la lecture
des anciens ciphertexts, l'OTP initial, la reprise après 30 jours, les rapports,
les parcours FR/AR, les sessions administrateur et les preuves réseau anti-rejeu.

Les LOTS 1, 3 et 4 ont été validés par l'utilisateur pour la poursuite du
développement. Les résultats techniques du LOT 5 sont disponibles pour revue ;
ils ne valent pas validation d'une infrastructure réelle d'hébergement.

## Intégrité revérifiée

Comparaison SHA-256 avec les manifestes existants :

- 18 fichiers livrés au LOT 5 : aucune différence.
- 38 entrées de sauvegarde : aucune différence.
- 15 fichiers historiques de migrations : aucune différence.
- Fichiers de tests antérieurs sauvegardés : aucune assertion modifiée.

La migration additive du LOT 5 crée le stockage des nonces. Elle n'a été appliquée
qu'aux clusters synthétiques du lanceur de qualification. Le dernier cluster est
confirmé arrêté, son port fermé et son répertoire de données supprimé.

## Réserves opérationnelles toujours ouvertes

1. L'hébergement et la chaîne d'ingress ne sont pas encore définis. Aucun header
   IP n'est présumé fiable et aucun adaptateur fournisseur n'est activé.
2. Sans attestation réseau vérifiable, les opérations OTP sont volontairement
   indisponibles. Le protocole signé et ses refus ont été testés avec un ingress
   simulé ; l'origine effective de l'IP devra être prouvée sur l'hébergement choisi.
3. Les performances à grande échelle, la coordination des limiteurs HTTP
   d'appoint et les protections volumétriques de l'ingress restent à qualifier.
4. L'archivage des réservations incertaines reste un suivi accepté du LOT 1.
5. Plusieurs identités e-mail peuvent consommer le budget global ; une IP ou un
   NAT ne prouve pas une personne. Aucun envoi Brevo réel n'a été effectué.

## Prochaine étape

Définir l'hébergement, les sauts réseau et la provenance IP vérifiable. Il sera
alors possible de préparer l'adaptateur approprié et une validation sur staging
synthétique, dans un périmètre explicitement autorisé. Aucun changement de secret,
déploiement ou envoi réel n'est autorisé par cette consolidation.

Le plan détaillé de validation des cinq lots demeure dans la section 6 du
[rapport LOT 5](LOT5_PROXY_TRUST.md).

## Preuves

- [Qualification finale enregistrée](../output/lot5-proxy-20261031/qualification.json)
- [Intégrité et liste des fichiers livrés](../output/lot5-proxy-20261031/integrity.json)
- [Sauvegardes préalables](../output/lot5-proxy-20261031/backup/manifest.json)
- [Journal de qualification](../output/lot4-lot5-proxy-20261031/native-6tOlg8/tests.log)
- [Confirmation de nettoyage du cluster](../output/lot4-lot5-proxy-20261031/native-6tOlg8/shutdown.json)
