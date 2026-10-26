# France Monitor

**Poste de situation de la France en sources ouvertes** · version bêta · octobre 2026
https://www.francemonitor.com

## Objet

France Monitor rassemble sur une même carte, à la même heure, ce que publient une quarantaine de sources publiques sur l'état du pays. Il croise ces informations par territoire et indique un niveau national (vert, jaune, orange, rouge) dont chaque élément renvoie à sa source.

Il s'adresse aux cabinets ministériels, aux préfectures et aux opérateurs qui veulent savoir, en quelques minutes, où regarder et pourquoi.

## Ce que l'outil fait

- **Agrège** des sources ouvertes, officielles pour la plupart : Météo-France, Vigicrues, RTE, SNCF, Bison Futé, ARCEP, ASNR, CERT-FR, Banque centrale européenne, Santé publique France, Copernicus, presse nationale et régionale.
- **Croise** ces sources par thème et par territoire, jusqu'à une fiche par département.
- **Mesure l'étendue** d'un mouvement social ou de violences : le nombre d'événements distincts rapportés sur 24 heures, chacun compté une fois quel que soit le nombre d'articles.
- **Explique** le niveau national. La méthode est publique, chaque contribution est détaillée, et chaque donnée porte son heure et sa source.
- **Reprend les échéances annoncées** par les émetteurs eux-mêmes (signal Écowatt des jours suivants, vigilance du lendemain, rassemblements annoncés), toujours attribuées.
- **Publie ses alertes** au format CAP, la norme internationale des alertes de crise, et en flux Atom, reprenables par d'autres outils.
- **Archive** une note de situation toutes les six heures, consultable pendant 90 jours.
- **Signale ses propres lacunes** : une source en panne est affichée comme telle, une donnée périmée est écartée, une absence d'information n'est jamais présentée comme une situation calme.

## Une méthode éprouvée sur des faits

Le niveau national a été **rejoué sur la mobilisation du 17 octobre 2026**. Il était resté jaune, alors que les violences étaient étendues à plusieurs villes. Les causes ont été identifiées et corrigées, et la correction a été mesurée sur deux semaines d'actualité avant d'être mise en ligne. Ces journées passent désormais en orange, sans effet sur les journées calmes. La méthode et ce constat sont publics.

## Ce que l'outil ne fait pas

- Il **ne prédit pas**. Les échéances affichées sont celles annoncées par les organismes émetteurs, qui sont cités.
- Il **ne constitue pas une évaluation officielle** et ne remplace aucun dispositif de l'État.
- Il **n'utilise aucune information confidentielle** : tout ce qu'il montre est consultable par ailleurs.
- Il **ne collecte aucune donnée sur ses utilisateurs**.

## Où en est le projet

| | |
|---|---|
| Statut | Bêta, sans utilisateur à ce jour |
| Équipe | Une personne |
| Hébergement | Offres gratuites (serveur Oracle Cloud, Cloudflare), en attente de financement |
| Fiabilité technique | 5 880 tests automatisés, contrôle et déploiement automatiques à chaque modification |
| Historique | Niveau national relevé toutes les 15 minutes depuis le 26 octobre 2026, sauvegardé chaque nuit |

## Limites connues, assumées

- Les seuils et pondérations sont des choix de conception. Ils ont été confrontés à un premier épisode réel et le seront à chaque nouvel épisode marquant.
- Une source muette ne pèse pas : la situation peut alors paraître plus calme qu'elle n'est.
- La note de synthèse recourt à un service d'intelligence artificielle situé hors de l'Union européenne, auquel seuls des extraits de presse publique sont transmis. Un déploiement public passerait par un fournisseur souverain.
- Il n'y a pas encore de comptes d'accès, d'alertes envoyées par courriel ni de redondance de l'hébergement.

## Ce qu'apporterait un pilote

- Un hébergement qualifié en France et un modèle d'intelligence artificielle souverain.
- Des comptes d'accès et des alertes adressées à chaque service (courriel, messagerie de l'État).
- Une validation du niveau national avec des praticiens, sur leurs propres épisodes de référence.

*Méthode détaillée : https://www.francemonitor.com/methodology.html*
