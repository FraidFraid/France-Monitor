# Rejeu du moteur d'anticipation

Généré le 2026-11-13T10:33:21.897Z. Constats, pas des critères de recette : le moteur réel est rejoué sur ce que les archives publiques permettent de reconstituer, avec un registre vide à chaque instant. Les entrées non archivées sont inconnues, donc une règle qui en dépend ne peut pas s'ouvrir : l'absence de scénario ne prouve rien.

## Portée

Avec les archives d'aujourd'hui, le rejeu exerce la plomberie (lecture des archives, signaux, moteur, rapport) mais aucune règle ne peut s'ouvrir sur des données réelles : SNCF, pannes, Écowatt, carburants et veille cyber ne sont pas archivés. Il devient significatif quand l'archive des signaux, déployée avec ce moteur, aura accumulé des relevés.

## 2026-11-04T16:00:00Z

| Règle | Département | Mot | Fenêtre | Titre |
| --- | --- | --- | --- | --- |
| mobilisation-transports | 33 | possibilité réelle | 2026-11-04T13:00:00.000Z à 2026-11-04T21:00:00.000Z | Foule bloquée ou débordements en fin de cortège |
| mobilisation-transports | 54 | possibilité réelle | 2026-11-04T21:00:00.000Z à 2026-11-05T05:00:00.000Z | Foule bloquée ou débordements en fin de cortège |
| mobilisation-transports | 59 | possibilité réelle | 2026-11-04T21:00:00.000Z à 2026-11-05T05:00:00.000Z | Foule bloquée ou débordements en fin de cortège |
| mobilisation-transports | 75 | possibilité réelle | 2026-11-04T21:00:00.000Z à 2026-11-05T05:00:00.000Z | Foule bloquée ou débordements en fin de cortège |
| lycees-mobilisation | 24 | possibilité réelle | 2026-11-05T05:00:00.000Z à 2026-11-05T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 31 | possibilité réelle | 2026-11-05T05:00:00.000Z à 2026-11-05T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 34 | possibilité réelle | 2026-11-05T05:00:00.000Z à 2026-11-05T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 38 | possibilité réelle | 2026-11-05T05:00:00.000Z à 2026-11-05T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 59 | possibilité réelle | 2026-11-05T05:00:00.000Z à 2026-11-05T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 67 | possibilité réelle | 2026-11-05T05:00:00.000Z à 2026-11-05T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 69 | possibilité réelle | 2026-11-05T05:00:00.000Z à 2026-11-05T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 75 | possibilité réelle | 2026-11-05T05:00:00.000Z à 2026-11-05T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 77 | possibilité réelle | 2026-11-05T05:00:00.000Z à 2026-11-05T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 91 | possibilité réelle | 2026-11-05T05:00:00.000Z à 2026-11-05T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | national | possibilité réelle | 2026-11-05T05:00:00.000Z à 2026-11-05T17:00:00.000Z | Extension des incidents dans les lycées à d’autres départements |

Signaux par genre : presse 2268 · rassemblement_annonce 1435 · rassemblement_signale 118 · mouvement_social_transport 8 · perturbation_sncf 0 · arrete_prefectoral 0 · vigilance 0 · panne 0 · ecowatt 0 · cyber_pic 0 · cyber_revendication 0 · tension_carburant 0 · evenement_sportif 0

Règles privées d'une entrée :

- Règle tempete-reseaux : aucun signal de vigilance (vigilance par département non rejouable) · pannes (pannes non archivées), parmi 3433 articles de presse lus
- Règle chaleur-sante : aucun signal de vigilance (vigilance par département non rejouable) · Écowatt (Écowatt non archivé), parmi 3433 articles de presse lus
- Règle social-cyber : aucun signal de cyber (veille cyber non archivée), parmi 3433 articles de presse lus
- Règle greve-carburant : aucun signal de tension carburant (carburants non archivés), parmi 3433 articles de presse lus
- Règle evenement-mobilisation : aucun signal de calendrier sportif (calendrier sportif non archivé), parmi 3433 articles de presse lus

Lu : presse : 3433 élément(s) lus · manifestations : 1661 élément(s) lus

Inconnus : Météo-France non lue · SNCF non lue · Pannes non lues · Veille cyber non lue · Écowatt non lu · Carburants non lus

### Limites

- manifestations : lignes filtrées sur firstSeenAt, chacune garde son dernier état (relevé peut-être après l'instant)
- vigilance par département (l'archive ne garde que des comptes par jour) : non rejouable
- SNCF : non rejouable
- pannes : non rejouable
- veille cyber : non rejouable
- Écowatt : non rejouable
- carburants : non rejouable
- calendrier sportif : non rejouable
- archive des signaux (Task 3) : absente, elle n'existe qu'à partir du déploiement du moteur

## 2026-11-05T07:00:00Z

| Règle | Département | Mot | Fenêtre | Titre |
| --- | --- | --- | --- | --- |
| mobilisation-transports | 29 | possibilité réelle | 2026-11-05T05:00:00.000Z à 2026-11-05T13:00:00.000Z | Foule bloquée ou débordements en fin de cortège |
| mobilisation-transports | 29 | possibilité réelle | 2026-11-05T13:00:00.000Z à 2026-11-05T21:00:00.000Z | Foule bloquée ou débordements en fin de cortège |
| lycees-mobilisation | 25 | possibilité réelle | 2026-11-05T05:00:00.000Z à 2026-11-05T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 31 | possibilité réelle | 2026-11-05T05:00:00.000Z à 2026-11-05T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 34 | possibilité réelle | 2026-11-05T05:00:00.000Z à 2026-11-05T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 38 | possibilité réelle | 2026-11-05T05:00:00.000Z à 2026-11-05T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 44 | possibilité réelle | 2026-11-05T05:00:00.000Z à 2026-11-05T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 54 | possibilité réelle | 2026-11-05T05:00:00.000Z à 2026-11-05T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 59 | possibilité réelle | 2026-11-05T05:00:00.000Z à 2026-11-05T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 69 | possibilité réelle | 2026-11-05T05:00:00.000Z à 2026-11-05T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 77 | possibilité réelle | 2026-11-05T05:00:00.000Z à 2026-11-05T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 91 | possibilité réelle | 2026-11-05T05:00:00.000Z à 2026-11-05T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 93 | possibilité réelle | 2026-11-05T05:00:00.000Z à 2026-11-05T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 95 | peu probable | 2026-11-05T05:00:00.000Z à 2026-11-05T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | national | possibilité réelle | 2026-11-05T05:00:00.000Z à 2026-11-05T17:00:00.000Z | Extension des incidents dans les lycées à d’autres départements |

Signaux par genre : presse 2238 · rassemblement_annonce 1562 · rassemblement_signale 173 · mouvement_social_transport 10 · perturbation_sncf 0 · arrete_prefectoral 0 · vigilance 0 · panne 0 · ecowatt 0 · cyber_pic 0 · cyber_revendication 0 · tension_carburant 0 · evenement_sportif 0

Règles privées d'une entrée :

- Règle tempete-reseaux : aucun signal de vigilance (vigilance par département non rejouable) · pannes (pannes non archivées), parmi 3285 articles de presse lus
- Règle chaleur-sante : aucun signal de vigilance (vigilance par département non rejouable) · Écowatt (Écowatt non archivé), parmi 3285 articles de presse lus
- Règle social-cyber : aucun signal de cyber (veille cyber non archivée), parmi 3285 articles de presse lus
- Règle greve-carburant : aucun signal de tension carburant (carburants non archivés), parmi 3285 articles de presse lus
- Règle evenement-mobilisation : aucun signal de calendrier sportif (calendrier sportif non archivé), parmi 3285 articles de presse lus

Lu : presse : 3285 élément(s) lus · manifestations : 1759 élément(s) lus

Inconnus : Météo-France non lue · SNCF non lue · Pannes non lues · Veille cyber non lue · Écowatt non lu · Carburants non lus

### Limites

- manifestations : lignes filtrées sur firstSeenAt, chacune garde son dernier état (relevé peut-être après l'instant)
- vigilance par département (l'archive ne garde que des comptes par jour) : non rejouable
- SNCF : non rejouable
- pannes : non rejouable
- veille cyber : non rejouable
- Écowatt : non rejouable
- carburants : non rejouable
- calendrier sportif : non rejouable
- archive des signaux (Task 3) : absente, elle n'existe qu'à partir du déploiement du moteur

## 2026-11-05T13:00:00Z

| Règle | Département | Mot | Fenêtre | Titre |
| --- | --- | --- | --- | --- |
| mobilisation-transports | 27 | possibilité réelle | 2026-11-05T13:00:00.000Z à 2026-11-05T21:00:00.000Z | Foule bloquée ou débordements en fin de cortège |
| mobilisation-transports | 33 | possibilité réelle | 2026-11-05T13:00:00.000Z à 2026-11-05T21:00:00.000Z | Foule bloquée ou débordements en fin de cortège |
| mobilisation-transports | 33 | possibilité réelle | 2026-11-05T21:00:00.000Z à 2026-11-06T05:00:00.000Z | Foule bloquée ou débordements en fin de cortège |
| lycees-mobilisation | 06 | possibilité réelle | 2026-11-05T05:00:00.000Z à 2026-11-05T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 14 | possibilité réelle | 2026-11-05T05:00:00.000Z à 2026-11-05T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 25 | possibilité réelle | 2026-11-05T05:00:00.000Z à 2026-11-05T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 31 | possibilité réelle | 2026-11-05T05:00:00.000Z à 2026-11-05T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 34 | possibilité réelle | 2026-11-05T05:00:00.000Z à 2026-11-05T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 35 | possibilité réelle | 2026-11-05T05:00:00.000Z à 2026-11-05T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 44 | possibilité réelle | 2026-11-05T05:00:00.000Z à 2026-11-05T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 45 | possibilité réelle | 2026-11-05T05:00:00.000Z à 2026-11-05T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 54 | possibilité réelle | 2026-11-05T05:00:00.000Z à 2026-11-05T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 59 | possibilité réelle | 2026-11-05T05:00:00.000Z à 2026-11-05T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 69 | possibilité réelle | 2026-11-05T05:00:00.000Z à 2026-11-05T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 81 | possibilité réelle | 2026-11-05T05:00:00.000Z à 2026-11-05T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 93 | possibilité réelle | 2026-11-05T05:00:00.000Z à 2026-11-05T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 95 | peu probable | 2026-11-05T05:00:00.000Z à 2026-11-05T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | national | possibilité réelle | 2026-11-05T05:00:00.000Z à 2026-11-05T17:00:00.000Z | Extension des incidents dans les lycées à d’autres départements |
| alertes-serie | national | possibilité réelle | 2026-11-04T23:00:00.000Z à 2026-11-05T23:00:00.000Z | Série de fausses alertes à la bombe |

Signaux par genre : presse 2229 · rassemblement_annonce 1580 · rassemblement_signale 202 · mouvement_social_transport 8 · perturbation_sncf 0 · arrete_prefectoral 0 · vigilance 0 · panne 0 · ecowatt 0 · cyber_pic 0 · cyber_revendication 0 · tension_carburant 0 · evenement_sportif 0

Règles privées d'une entrée :

- Règle tempete-reseaux : aucun signal de vigilance (vigilance par département non rejouable) · pannes (pannes non archivées), parmi 3319 articles de presse lus
- Règle chaleur-sante : aucun signal de vigilance (vigilance par département non rejouable) · Écowatt (Écowatt non archivé), parmi 3319 articles de presse lus
- Règle social-cyber : aucun signal de cyber (veille cyber non archivée), parmi 3319 articles de presse lus
- Règle greve-carburant : aucun signal de tension carburant (carburants non archivés), parmi 3319 articles de presse lus
- Règle evenement-mobilisation : aucun signal de calendrier sportif (calendrier sportif non archivé), parmi 3319 articles de presse lus

Lu : presse : 3319 élément(s) lus · manifestations : 1820 élément(s) lus

Inconnus : Météo-France non lue · SNCF non lue · Pannes non lues · Veille cyber non lue · Écowatt non lu · Carburants non lus

### Limites

- manifestations : lignes filtrées sur firstSeenAt, chacune garde son dernier état (relevé peut-être après l'instant)
- vigilance par département (l'archive ne garde que des comptes par jour) : non rejouable
- SNCF : non rejouable
- pannes : non rejouable
- veille cyber : non rejouable
- Écowatt : non rejouable
- carburants : non rejouable
- calendrier sportif : non rejouable
- archive des signaux (Task 3) : absente, elle n'existe qu'à partir du déploiement du moteur

## 2026-11-06T08:00:00Z

| Règle | Département | Mot | Fenêtre | Titre |
| --- | --- | --- | --- | --- |
| lycees-mobilisation | 06 | possibilité réelle | 2026-11-06T05:00:00.000Z à 2026-11-06T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 14 | possibilité réelle | 2026-11-06T05:00:00.000Z à 2026-11-06T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 22 | peu probable | 2026-11-06T05:00:00.000Z à 2026-11-06T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 31 | possibilité réelle | 2026-11-06T05:00:00.000Z à 2026-11-06T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 35 | possibilité réelle | 2026-11-06T05:00:00.000Z à 2026-11-06T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 44 | possibilité réelle | 2026-11-06T05:00:00.000Z à 2026-11-06T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 45 | possibilité réelle | 2026-11-06T05:00:00.000Z à 2026-11-06T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 59 | possibilité réelle | 2026-11-06T05:00:00.000Z à 2026-11-06T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 69 | possibilité réelle | 2026-11-06T05:00:00.000Z à 2026-11-06T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 72 | peu probable | 2026-11-06T05:00:00.000Z à 2026-11-06T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 75 | peu probable | 2026-11-06T05:00:00.000Z à 2026-11-06T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 81 | peu probable | 2026-11-06T05:00:00.000Z à 2026-11-06T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 93 | peu probable | 2026-11-06T05:00:00.000Z à 2026-11-06T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | national | possibilité réelle | 2026-11-06T05:00:00.000Z à 2026-11-06T17:00:00.000Z | Extension des incidents dans les lycées à d’autres départements |
| alertes-serie | national | possibilité réelle | 2026-11-05T23:00:00.000Z à 2026-11-06T23:00:00.000Z | Série de fausses alertes à la bombe |

Signaux par genre : presse 2187 · rassemblement_annonce 908 · rassemblement_signale 196 · mouvement_social_transport 1 · perturbation_sncf 0 · arrete_prefectoral 0 · vigilance 0 · panne 0 · ecowatt 0 · cyber_pic 0 · cyber_revendication 0 · tension_carburant 0 · evenement_sportif 0

Règles privées d'une entrée :

- Règle tempete-reseaux : aucun signal de vigilance (vigilance par département non rejouable) · pannes (pannes non archivées), parmi 3169 articles de presse lus
- Règle chaleur-sante : aucun signal de vigilance (vigilance par département non rejouable) · Écowatt (Écowatt non archivé), parmi 3169 articles de presse lus
- Règle social-cyber : aucun signal de cyber (veille cyber non archivée), parmi 3169 articles de presse lus
- Règle greve-carburant : aucun signal de tension carburant (carburants non archivés), parmi 3169 articles de presse lus
- Règle evenement-mobilisation : aucun signal de calendrier sportif (calendrier sportif non archivé), parmi 3169 articles de presse lus

Lu : presse : 3169 élément(s) lus · manifestations : 1175 élément(s) lus

Inconnus : Météo-France non lue · SNCF non lue · Pannes non lues · Veille cyber non lue · Écowatt non lu · Carburants non lus

### Limites

- manifestations : lignes filtrées sur firstSeenAt, chacune garde son dernier état (relevé peut-être après l'instant)
- vigilance par département (l'archive ne garde que des comptes par jour) : non rejouable
- SNCF : non rejouable
- pannes : non rejouable
- veille cyber : non rejouable
- Écowatt : non rejouable
- carburants : non rejouable
- calendrier sportif : non rejouable
- archive des signaux (Task 3) : absente, elle n'existe qu'à partir du déploiement du moteur

## 2026-11-07T08:00:00Z

| Règle | Département | Mot | Fenêtre | Titre |
| --- | --- | --- | --- | --- |
| lycees-mobilisation | 25 | peu probable | 2026-11-09T05:00:00.000Z à 2026-11-09T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 30 | peu probable | 2026-11-09T05:00:00.000Z à 2026-11-09T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 31 | possibilité réelle | 2026-11-09T05:00:00.000Z à 2026-11-09T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 37 | peu probable | 2026-11-09T05:00:00.000Z à 2026-11-09T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 45 | peu probable | 2026-11-09T05:00:00.000Z à 2026-11-09T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 54 | possibilité réelle | 2026-11-09T05:00:00.000Z à 2026-11-09T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 64 | peu probable | 2026-11-09T05:00:00.000Z à 2026-11-09T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 67 | possibilité réelle | 2026-11-09T05:00:00.000Z à 2026-11-09T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 69 | possibilité réelle | 2026-11-09T05:00:00.000Z à 2026-11-09T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 74 | peu probable | 2026-11-09T05:00:00.000Z à 2026-11-09T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 77 | peu probable | 2026-11-09T05:00:00.000Z à 2026-11-09T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 81 | peu probable | 2026-11-09T05:00:00.000Z à 2026-11-09T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | national | possibilité réelle | 2026-11-09T05:00:00.000Z à 2026-11-09T17:00:00.000Z | Extension des incidents dans les lycées à d’autres départements |
| alertes-serie | national | possibilité réelle | 2026-11-06T23:00:00.000Z à 2026-11-07T23:00:00.000Z | Série de fausses alertes à la bombe |

Signaux par genre : presse 2113 · rassemblement_annonce 402 · rassemblement_signale 103 · mouvement_social_transport 0 · perturbation_sncf 0 · arrete_prefectoral 0 · vigilance 0 · panne 0 · ecowatt 0 · cyber_pic 0 · cyber_revendication 0 · tension_carburant 0 · evenement_sportif 0

Règles privées d'une entrée :

- Règle mobilisation-transports : aucun signal de transport (SNCF non archivée, presse : aucun article grève + opérateur), parmi 3038 articles de presse lus
- Règle tempete-reseaux : aucun signal de vigilance (vigilance par département non rejouable) · pannes (pannes non archivées), parmi 3038 articles de presse lus
- Règle chaleur-sante : aucun signal de vigilance (vigilance par département non rejouable) · Écowatt (Écowatt non archivé), parmi 3038 articles de presse lus
- Règle social-cyber : aucun signal de cyber (veille cyber non archivée), parmi 3038 articles de presse lus
- Règle greve-carburant : aucun signal de tension carburant (carburants non archivés), parmi 3038 articles de presse lus
- Règle evenement-mobilisation : aucun signal de calendrier sportif (calendrier sportif non archivé), parmi 3038 articles de presse lus

Lu : presse : 3038 élément(s) lus · manifestations : 584 élément(s) lus

Inconnus : Météo-France non lue · SNCF non lue · Pannes non lues · Veille cyber non lue · Écowatt non lu · Carburants non lus

### Limites

- manifestations : lignes filtrées sur firstSeenAt, chacune garde son dernier état (relevé peut-être après l'instant)
- vigilance par département (l'archive ne garde que des comptes par jour) : non rejouable
- SNCF : non rejouable
- pannes : non rejouable
- veille cyber : non rejouable
- Écowatt : non rejouable
- carburants : non rejouable
- calendrier sportif : non rejouable
- archive des signaux (Task 3) : absente, elle n'existe qu'à partir du déploiement du moteur

## 2026-11-08T10:00:00Z

| Règle | Département | Mot | Fenêtre | Titre |
| --- | --- | --- | --- | --- |
| alertes-serie | national | possibilité réelle | 2026-11-07T23:00:00.000Z à 2026-11-08T23:00:00.000Z | Série de fausses alertes à la bombe |

Signaux par genre : presse 1487 · rassemblement_annonce 436 · rassemblement_signale 76 · mouvement_social_transport 0 · perturbation_sncf 0 · arrete_prefectoral 0 · vigilance 0 · panne 0 · ecowatt 0 · cyber_pic 0 · cyber_revendication 0 · tension_carburant 0 · evenement_sportif 0

Règles privées d'une entrée :

- Règle mobilisation-transports : aucun signal de transport (SNCF non archivée, presse : aucun article grève + opérateur), parmi 2190 articles de presse lus
- Règle tempete-reseaux : aucun signal de vigilance (vigilance par département non rejouable) · pannes (pannes non archivées), parmi 2190 articles de presse lus
- Règle chaleur-sante : aucun signal de vigilance (vigilance par département non rejouable) · Écowatt (Écowatt non archivé), parmi 2190 articles de presse lus
- Règle social-cyber : aucun signal de cyber (veille cyber non archivée), parmi 2190 articles de presse lus
- Règle greve-carburant : aucun signal de tension carburant (carburants non archivés), parmi 2190 articles de presse lus
- Règle evenement-mobilisation : aucun signal de calendrier sportif (calendrier sportif non archivé), parmi 2190 articles de presse lus

Lu : presse : 2190 élément(s) lus · manifestations : 555 élément(s) lus

Inconnus : Météo-France non lue · SNCF non lue · Pannes non lues · Veille cyber non lue · Écowatt non lu · Carburants non lus

### Limites

- manifestations : lignes filtrées sur firstSeenAt, chacune garde son dernier état (relevé peut-être après l'instant)
- vigilance par département (l'archive ne garde que des comptes par jour) : non rejouable
- SNCF : non rejouable
- pannes : non rejouable
- veille cyber : non rejouable
- Écowatt : non rejouable
- carburants : non rejouable
- calendrier sportif : non rejouable
- archive des signaux (Task 3) : absente, elle n'existe qu'à partir du déploiement du moteur

## 2026-11-09T08:00:00Z

| Règle | Département | Mot | Fenêtre | Titre |
| --- | --- | --- | --- | --- |
| lycees-mobilisation | 67 | possibilité réelle | 2026-11-09T05:00:00.000Z à 2026-11-09T17:00:00.000Z | Violences aux abords des lycées |

Signaux par genre : presse 1583 · rassemblement_annonce 377 · rassemblement_signale 35 · mouvement_social_transport 0 · perturbation_sncf 0 · arrete_prefectoral 0 · vigilance 0 · panne 0 · ecowatt 0 · cyber_pic 0 · cyber_revendication 0 · tension_carburant 0 · evenement_sportif 0

Règles privées d'une entrée :

- Règle mobilisation-transports : aucun signal de transport (SNCF non archivée, presse : aucun article grève + opérateur), parmi 2259 articles de presse lus
- Règle tempete-reseaux : aucun signal de vigilance (vigilance par département non rejouable) · pannes (pannes non archivées), parmi 2259 articles de presse lus
- Règle chaleur-sante : aucun signal de vigilance (vigilance par département non rejouable) · Écowatt (Écowatt non archivé), parmi 2259 articles de presse lus
- Règle social-cyber : aucun signal de cyber (veille cyber non archivée), parmi 2259 articles de presse lus
- Règle greve-carburant : aucun signal de tension carburant (carburants non archivés), parmi 2259 articles de presse lus
- Règle evenement-mobilisation : aucun signal de calendrier sportif (calendrier sportif non archivé), parmi 2259 articles de presse lus

Lu : presse : 2259 élément(s) lus · manifestations : 441 élément(s) lus

Inconnus : Météo-France non lue · SNCF non lue · Pannes non lues · Veille cyber non lue · Écowatt non lu · Carburants non lus

### Limites

- manifestations : lignes filtrées sur firstSeenAt, chacune garde son dernier état (relevé peut-être après l'instant)
- vigilance par département (l'archive ne garde que des comptes par jour) : non rejouable
- SNCF : non rejouable
- pannes : non rejouable
- veille cyber : non rejouable
- Écowatt : non rejouable
- carburants : non rejouable
- calendrier sportif : non rejouable
- archive des signaux (Task 3) : absente, elle n'existe qu'à partir du déploiement du moteur

## 2026-11-10T12:00:00Z

| Règle | Département | Mot | Fenêtre | Titre |
| --- | --- | --- | --- | --- |
| lycees-mobilisation | 06 | possibilité réelle | 2026-11-10T05:00:00.000Z à 2026-11-10T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 07 | possibilité réelle | 2026-11-10T05:00:00.000Z à 2026-11-10T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 13 | possibilité réelle | 2026-11-10T05:00:00.000Z à 2026-11-10T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 31 | possibilité réelle | 2026-11-10T05:00:00.000Z à 2026-11-10T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 54 | possibilité réelle | 2026-11-10T05:00:00.000Z à 2026-11-10T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 59 | possibilité réelle | 2026-11-10T05:00:00.000Z à 2026-11-10T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 67 | possibilité réelle | 2026-11-10T05:00:00.000Z à 2026-11-10T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 69 | possibilité réelle | 2026-11-10T05:00:00.000Z à 2026-11-10T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 74 | peu probable | 2026-11-10T05:00:00.000Z à 2026-11-10T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 76 | possibilité réelle | 2026-11-10T05:00:00.000Z à 2026-11-10T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 77 | possibilité réelle | 2026-11-10T05:00:00.000Z à 2026-11-10T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 81 | possibilité réelle | 2026-11-10T05:00:00.000Z à 2026-11-10T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | national | possibilité réelle | 2026-11-10T05:00:00.000Z à 2026-11-10T17:00:00.000Z | Extension des incidents dans les lycées à d’autres départements |

Signaux par genre : presse 2081 · rassemblement_annonce 582 · rassemblement_signale 75 · mouvement_social_transport 0 · perturbation_sncf 0 · arrete_prefectoral 0 · vigilance 0 · panne 0 · ecowatt 0 · cyber_pic 0 · cyber_revendication 0 · tension_carburant 0 · evenement_sportif 0

Règles privées d'une entrée :

- Règle mobilisation-transports : aucun signal de transport (SNCF non archivée, presse : aucun article grève + opérateur), parmi 2985 articles de presse lus
- Règle tempete-reseaux : aucun signal de vigilance (vigilance par département non rejouable) · pannes (pannes non archivées), parmi 2985 articles de presse lus
- Règle chaleur-sante : aucun signal de vigilance (vigilance par département non rejouable) · Écowatt (Écowatt non archivé), parmi 2985 articles de presse lus
- Règle social-cyber : aucun signal de cyber (veille cyber non archivée), parmi 2985 articles de presse lus
- Règle greve-carburant : aucun signal de tension carburant (carburants non archivés), parmi 2985 articles de presse lus
- Règle evenement-mobilisation : aucun signal de calendrier sportif (calendrier sportif non archivé), parmi 2985 articles de presse lus

Lu : presse : 2985 élément(s) lus · manifestations : 678 élément(s) lus

Inconnus : Météo-France non lue · SNCF non lue · Pannes non lues · Veille cyber non lue · Écowatt non lu · Carburants non lus

### Limites

- manifestations : lignes filtrées sur firstSeenAt, chacune garde son dernier état (relevé peut-être après l'instant)
- vigilance par département (l'archive ne garde que des comptes par jour) : non rejouable
- SNCF : non rejouable
- pannes : non rejouable
- veille cyber : non rejouable
- Écowatt : non rejouable
- carburants : non rejouable
- calendrier sportif : non rejouable
- archive des signaux (Task 3) : absente, elle n'existe qu'à partir du déploiement du moteur

## 2026-11-12T08:00:00Z

| Règle | Département | Mot | Fenêtre | Titre |
| --- | --- | --- | --- | --- |
| lycees-mobilisation | 13 | peu probable | 2026-11-12T05:00:00.000Z à 2026-11-12T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 19 | peu probable | 2026-11-12T05:00:00.000Z à 2026-11-12T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 33 | possibilité réelle | 2026-11-12T05:00:00.000Z à 2026-11-12T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 34 | possibilité réelle | 2026-11-12T05:00:00.000Z à 2026-11-12T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 37 | peu probable | 2026-11-12T05:00:00.000Z à 2026-11-12T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 54 | possibilité réelle | 2026-11-12T05:00:00.000Z à 2026-11-12T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 72 | peu probable | 2026-11-12T05:00:00.000Z à 2026-11-12T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 75 | peu probable | 2026-11-12T05:00:00.000Z à 2026-11-12T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 91 | possibilité réelle | 2026-11-12T05:00:00.000Z à 2026-11-12T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 95 | possibilité réelle | 2026-11-12T05:00:00.000Z à 2026-11-12T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | national | possibilité réelle | 2026-11-12T05:00:00.000Z à 2026-11-12T17:00:00.000Z | Extension des incidents dans les lycées à d’autres départements |
| alertes-serie | national | possibilité réelle | 2026-11-11T23:00:00.000Z à 2026-11-12T23:00:00.000Z | Série de fausses alertes à la bombe |

Signaux par genre : presse 1766 · rassemblement_annonce 543 · rassemblement_signale 26 · mouvement_social_transport 0 · perturbation_sncf 0 · arrete_prefectoral 0 · vigilance 0 · panne 0 · ecowatt 0 · cyber_pic 0 · cyber_revendication 0 · tension_carburant 0 · evenement_sportif 0

Règles privées d'une entrée :

- Règle mobilisation-transports : aucun signal de transport (SNCF non archivée, presse : aucun article grève + opérateur), parmi 2577 articles de presse lus
- Règle tempete-reseaux : aucun signal de vigilance (vigilance par département non rejouable) · pannes (pannes non archivées), parmi 2577 articles de presse lus
- Règle chaleur-sante : aucun signal de vigilance (vigilance par département non rejouable) · Écowatt (Écowatt non archivé), parmi 2577 articles de presse lus
- Règle social-cyber : aucun signal de cyber (veille cyber non archivée), parmi 2577 articles de presse lus
- Règle greve-carburant : aucun signal de tension carburant (carburants non archivés), parmi 2577 articles de presse lus
- Règle evenement-mobilisation : aucun signal de calendrier sportif (calendrier sportif non archivé), parmi 2577 articles de presse lus

Lu : presse : 2577 élément(s) lus · manifestations : 600 élément(s) lus

Inconnus : Météo-France non lue · SNCF non lue · Pannes non lues · Veille cyber non lue · Écowatt non lu · Carburants non lus

### Limites

- manifestations : lignes filtrées sur firstSeenAt, chacune garde son dernier état (relevé peut-être après l'instant)
- vigilance par département (l'archive ne garde que des comptes par jour) : non rejouable
- SNCF : non rejouable
- pannes : non rejouable
- veille cyber : non rejouable
- Écowatt : non rejouable
- carburants : non rejouable
- calendrier sportif : non rejouable
- archive des signaux (Task 3) : absente, elle n'existe qu'à partir du déploiement du moteur

## 2026-11-12T13:00:00Z

| Règle | Département | Mot | Fenêtre | Titre |
| --- | --- | --- | --- | --- |
| lycees-mobilisation | 13 | peu probable | 2026-11-12T05:00:00.000Z à 2026-11-12T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 31 | possibilité réelle | 2026-11-12T05:00:00.000Z à 2026-11-12T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 33 | possibilité réelle | 2026-11-12T05:00:00.000Z à 2026-11-12T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 34 | possibilité réelle | 2026-11-12T05:00:00.000Z à 2026-11-12T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 37 | peu probable | 2026-11-12T05:00:00.000Z à 2026-11-12T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 38 | possibilité réelle | 2026-11-12T05:00:00.000Z à 2026-11-12T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 44 | peu probable | 2026-11-12T05:00:00.000Z à 2026-11-12T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 50 | peu probable | 2026-11-12T05:00:00.000Z à 2026-11-12T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 54 | possibilité réelle | 2026-11-12T05:00:00.000Z à 2026-11-12T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 67 | possibilité réelle | 2026-11-12T05:00:00.000Z à 2026-11-12T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 75 | possibilité réelle | 2026-11-12T05:00:00.000Z à 2026-11-12T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 77 | peu probable | 2026-11-12T05:00:00.000Z à 2026-11-12T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 91 | possibilité réelle | 2026-11-12T05:00:00.000Z à 2026-11-12T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | 95 | possibilité réelle | 2026-11-12T05:00:00.000Z à 2026-11-12T17:00:00.000Z | Violences aux abords des lycées |
| lycees-mobilisation | national | possibilité réelle | 2026-11-12T05:00:00.000Z à 2026-11-12T17:00:00.000Z | Extension des incidents dans les lycées à d’autres départements |
| alertes-serie | national | possibilité réelle | 2026-11-11T23:00:00.000Z à 2026-11-12T23:00:00.000Z | Série de fausses alertes à la bombe |

Signaux par genre : presse 1885 · rassemblement_annonce 550 · rassemblement_signale 23 · mouvement_social_transport 0 · perturbation_sncf 0 · arrete_prefectoral 0 · vigilance 0 · panne 0 · ecowatt 0 · cyber_pic 0 · cyber_revendication 0 · tension_carburant 0 · evenement_sportif 0

Règles privées d'une entrée :

- Règle mobilisation-transports : aucun signal de transport (SNCF non archivée, presse : aucun article grève + opérateur), parmi 2746 articles de presse lus
- Règle tempete-reseaux : aucun signal de vigilance (vigilance par département non rejouable) · pannes (pannes non archivées), parmi 2746 articles de presse lus
- Règle chaleur-sante : aucun signal de vigilance (vigilance par département non rejouable) · Écowatt (Écowatt non archivé), parmi 2746 articles de presse lus
- Règle social-cyber : aucun signal de cyber (veille cyber non archivée), parmi 2746 articles de presse lus
- Règle greve-carburant : aucun signal de tension carburant (carburants non archivés), parmi 2746 articles de presse lus
- Règle evenement-mobilisation : aucun signal de calendrier sportif (calendrier sportif non archivé), parmi 2746 articles de presse lus

Lu : presse : 2746 élément(s) lus · manifestations : 612 élément(s) lus

Inconnus : Météo-France non lue · SNCF non lue · Pannes non lues · Veille cyber non lue · Écowatt non lu · Carburants non lus

### Limites

- manifestations : lignes filtrées sur firstSeenAt, chacune garde son dernier état (relevé peut-être après l'instant)
- vigilance par département (l'archive ne garde que des comptes par jour) : non rejouable
- SNCF : non rejouable
- pannes : non rejouable
- veille cyber : non rejouable
- Écowatt : non rejouable
- carburants : non rejouable
- calendrier sportif : non rejouable
- archive des signaux (Task 3) : absente, elle n'existe qu'à partir du déploiement du moteur

