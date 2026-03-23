# RÉFÉRENTIEL DES SOURCES DE DONNÉES — France Monitor

## Vue d'ensemble
Toutes les sources sont **gratuites** (Open Data ou freemium avec limites généreuses).

---

## 1. Actualités — Flux RSS (Presse Quotidienne Régionale)

### Principe
Lecture de flux RSS publics. Pas d'API key requise. Certains flux nécessitent un User-Agent réaliste.

### Sources prioritaires

| Source | URL RSS | Couverture | Notes |
|--------|---------|-----------|-------|
| France Bleu | `https://www.francebleu.fr/rss/a-la-une.xml` | National + régional | Flux régionaux aussi disponibles |
| Ouest-France | `https://www.ouest-france.fr/rss.xml` | Grand Ouest | Très riche en faits divers |
| 20 Minutes | `https://www.20minutes.fr/feeds/rss-actu-france.xml` | National | Rapide, synthétique |
| Le Parisien | `https://www.leparisien.fr/arc/outboundfeeds/rss/` | Île-de-France + national | Peut nécessiter parsing spécifique |
| La Voix du Nord | `https://www.lavoixdunord.fr/rss` | Hauts-de-France | Bonne couverture locale |
| Sud Ouest | `https://www.sudouest.fr/rss.xml` | Nouvelle-Aquitaine | |
| La Dépêche | `https://www.ladepeche.fr/rss.xml` | Occitanie | |
| Le Progrès | `https://www.leprogres.fr/rss` | Auvergne-Rhône-Alpes | |
| France 3 Régions | Multiple flux par région | National (régional) | Via francetvinfo.fr |

### Limites & Contraintes
- **Rate** : 1 requête par flux par 15 min (respecter la politesse)
- **User-Agent** : Utiliser un UA navigateur réaliste
- **Déduplication** : Basée sur l'URL de l'article (unique)
- **Fraîcheur** : Les flux contiennent généralement les 20-50 derniers articles

### Package npm
```
rss-parser (^3.13.0)
```

---

## 2. Énergie — API RTE (Ecowatt & Eco2mix)

### Inscription
- **Portail** : `https://data.rte-france.com`
- Créer un compte → Créer une application → Obtenir `client_id` + `client_secret`
- **Gratuit** pour usage non-commercial

### Endpoints

#### Ecowatt (Signal de tension réseau)
```
GET https://digital.iservices.rte-france.com/open_api/ecowatt/v5/signals
Authorization: Bearer {token}
```
- Retourne le signal Ecowatt (vert/orange/rouge) par jour pour J à J+3
- Données par région
- **Rate limit** : 100 appels/jour

#### Eco2mix (Mix énergétique temps réel)
```
GET https://digital.iservices.rte-france.com/open_api/actual_generation/v1/generation_mix_15min_time_scale
Authorization: Bearer {token}
```
- Production par filière (nucléaire, éolien, solaire, gaz, hydraulique)
- Granularité 15 min
- **Rate limit** : 100 appels/jour

### Authentification OAuth2
```
POST https://digital.iservices.rte-france.com/token/oauth/
Authorization: Basic base64(client_id:client_secret)
Content-Type: application/x-www-form-urlencoded
```
- Token valide 2h
- Stocker et renouveler automatiquement

### Variables `.env`
```
RTE_CLIENT_ID=xxx
RTE_CLIENT_SECRET=xxx
```

---

## 3. Hydrologie — API Vigicrues

### Inscription
- **Aucune** — API publique ouverte

### Endpoints

#### Vigilance crues
```
GET https://www.vigicrues.gouv.fr/services/1/InfoVigiCru.jsonld
```
- Retourne la vigilance par tronçon (vert/jaune/orange/rouge)
- Inclut les géométries GeoJSON des tronçons

#### Hauteurs d'eau
```
GET https://www.vigicrues.gouv.fr/services/1/observations.json?CdStationHydro={code}
```
- Historique des hauteurs d'eau par station
- Utile pour détecter les tendances

### Hub'Eau (Nappes phréatiques)
```
GET https://hubeau.eaufrance.fr/api/v1/niveaux_nappes/stations
GET https://hubeau.eaufrance.fr/api/v1/niveaux_nappes/chroniques
```
- Niveaux des nappes phréatiques
- **Rate limit** : 200 appels/heure
- **Aucune inscription requise**

---

## 4. Météo — Météo-France (Données Publiques)

### Inscription
- **Portail** : `https://portail-api.meteofrance.fr`
- Créer un compte → Souscrire à l'API gratuite
- Clé API fournie

### Endpoints

#### Alertes par département
```
GET https://public-api.meteofrance.fr/public/DPVigilance/v1/cartevigilance/encours
Authorization: apikey {API_KEY}
```
- Vigilance par département + type de risque
- Niveaux : vert, jaune, orange, rouge, violet
- Types : vent, pluie-inondation, orages, neige-verglas, canicule, grand-froid, avalanches, vagues-submersion

#### Prévisions
```
GET https://public-api.meteofrance.fr/public/DPPaquetObs/v1/paquet/infrahoraire-6m?id_bdp={station}
```
- Observations infra-horaires

### Variables `.env`
```
METEO_FRANCE_API_KEY=xxx
```

### Limites
- **Rate limit** : 50 appels/min (gratuit)
- Données mises à jour 2x/jour pour les alertes

---

## 5. Transports — SNCF Open Data

### Inscription
- **Portail** : `https://data.sncf.com`
- Créer un compte → Obtenir une API key

### Endpoints

#### Perturbations temps réel
```
GET https://api.sncf.com/v1/coverage/sncf/disruptions
Authorization: {API_KEY}
```
- Retards, annulations, travaux sur le réseau ferré
- Format GTFS-RT (General Transit Feed Specification - Realtime)

#### Gares
```
GET https://api.sncf.com/v1/coverage/sncf/stop_areas
```
- Liste des gares avec coordonnées GPS

### Variables `.env`
```
SNCF_API_KEY=xxx
```

### Limites
- **Rate limit** : 90 appels/15 min (gratuit)

---

## 6. Trafic Routier — Bison Futé / data.gouv.fr

### Source
- **data.gouv.fr** : Données de trafic routier en open data
- URL : `https://www.data.gouv.fr/fr/datasets/trafic-routier-bison-fute/`
- Format : GeoJSON / CSV

### Accès
- **Aucune inscription** — téléchargement direct
- Mise à jour : quotidienne en période de grands départs, sinon hebdomadaire

### Alternative : Overpass API (OpenStreetMap)
```
GET https://overpass-api.de/api/interpreter?data=[out:json];way["highway"="motorway"](41.3,-5.5,51.1,9.6);out;
```
- Tracé des autoroutes pour l'affichage sur la carte
- Gratuit, aucune inscription

---

## 7. Géocodage — API Adresse (Gouvernement)

### Inscription
- **Aucune** — API publique ouverte

### Endpoints

#### Recherche texte → coordonnées
```
GET https://api-adresse.data.gouv.fr/search/?q=20+avenue+de+Ségur+Paris&limit=1
```
- Retourne `[longitude, latitude]` + score de confiance
- Très rapide (< 100ms)

#### Recherche inversée
```
GET https://api-adresse.data.gouv.fr/reverse/?lon=2.37&lat=48.357
```
- Coordonnées → adresse

#### Batch (CSV)
```
POST https://api-adresse.data.gouv.fr/search/csv/
Content-Type: multipart/form-data
```
- Envoyer un CSV avec des adresses → retour CSV avec coordonnées
- Jusqu'à 50 000 lignes par requête

### Limites
- **Rate limit** : 50 requêtes/seconde (très généreux)
- **Couverture** : France métropolitaine + DOM-TOM
- **Précision** : Niveau adresse (numéro de rue) dans la plupart des cas

---

## 8. Données Administratives — API Geo (Gouvernement)

### Inscription
- **Aucune** — API publique ouverte

### Endpoints

#### Communes
```
GET https://geo.api.gouv.fr/communes?nom=Paris&fields=nom,code,codesPostaux,centre,departement,region&limit=5
```

#### Départements
```
GET https://geo.api.gouv.fr/departements?fields=nom,code,codeRegion
```

#### Régions
```
GET https://geo.api.gouv.fr/regions
```

### Usage
- Convertir un nom de département/région en coordonnées centroïde
- Utile pour les alertes météo (par département)

---

## Tableau Récapitulatif

| Source | Auth | Rate Limit | Refresh | Priorité |
|--------|------|-----------|---------|----------|
| Flux RSS PQR | Aucune (User-Agent) | 1/flux/15min | 15 min | P0 |
| API RTE (Ecowatt) | OAuth2 | 100/jour | 30 min | P1 |
| Vigicrues | Aucune | Raisonnable | 30 min | P1 |
| Météo-France | API Key | 50/min | 15 min | P1 |
| SNCF | API Key | 90/15min | 15 min | P2 |
| Bison Futé | Aucune | N/A (fichier) | Quotidien | P2 |
| API Adresse | Aucune | 50/s | À la demande | P0 |
| API Geo | Aucune | Raisonnable | Statique | P1 |
| Hub'Eau | Aucune | 200/h | 1h | P3 |

**Légende Priorité** : P0 = indispensable dès Phase 2, P1 = Phase 2-3, P2 = Phase 4, P3 = Nice to have

---

## 9. Énergie Étendue — API Agence ORE (Phase 13)

### Inscription
- **Portail** : `https://opendata.agenceore.fr`
- **Aucune clé requise** — Open Data

### Endpoints

#### Incidents Réseau Électricité/Gaz
```
GET https://opendata.agenceore.fr/api/explore/v2.1/catalog/datasets/incidents-reseau/records
```
- Incidents temps réel sur les réseaux de distribution
- Géolocalisation des zones affectées
- Type : électricité ou gaz

#### Bornes IRVE (Recharge VE)
```
GET https://opendata.agenceore.fr/api/explore/v2.1/catalog/datasets/bornes-irve/records
```
- Localisation des bornes de recharge
- Puissance, opérateur, disponibilité

### Limites
- **Rate limit** : Raisonnable (non documenté, ~100/min estimé)
- **Format** : JSON, GeoJSON

---

## 10. Pannes Internet — free-reseau.fr (Phase 13)

### Accès
- **Pas d'API publique** — Scraping requis via Scrapling proxy
- **URL** : `https://free-reseau.fr/` + pages régionales

### Données disponibles
- État des DSLAM (concentrateurs ADSL)
- État des NRO (Nœuds de Raccordement Optique)
- Zones de couverture affectées
- Horodatage des pannes

### Technique
```python
# Via Scrapling proxy existant (services/scrapling-proxy/)
POST http://localhost:8080/scrape
{
  "url": "https://free-reseau.fr/etat-du-reseau",
  "selector": ".incident-list"
}
```

### Limites
- Scraping → respecter robots.txt et rate limit
- Données principalement Free/Orange (pas SFR/Bouygues)

---

## 11. Travaux & Voirie — data.gouv.fr (Phase 13)

### Inscription
- **Aucune** — Open Data

### Endpoints

#### Recherche de datasets
```
GET https://www.data.gouv.fr/api/1/datasets/?q=travaux+voirie&format=geojson
```

#### Datasets utiles
- `travaux-sur-la-voirie` (Paris, Lyon, Marseille...)
- `chantiers-en-cours` (métropoles)
- `autorisations-de-stationnement-travaux`

### Format
- GeoJSON avec polygones des zones de travaux
- Métadonnées : dates début/fin, type de travaux, gestionnaire

### Limites
- Couverture variable selon les communes
- Mise à jour non temps réel (quotidien au mieux)

---

## Tableau Récapitulatif Étendu (Phase 13)

| Source | Auth | Rate Limit | Refresh | Priorité |
|--------|------|-----------|---------|----------|
| API ORE Incidents | Aucune | ~100/min | 15 min | P1 |
| API ORE IRVE | Aucune | ~100/min | 24h | P2 |
| free-reseau.fr | Scraping | Prudent | 15 min | P2 |
| data.gouv.fr Travaux | Aucune | Raisonnable | 6h | P3 |
| Hub'Eau Nappes | Aucune | 200/h | 1h | P3 |
