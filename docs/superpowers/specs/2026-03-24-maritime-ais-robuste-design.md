---
name: Maritime AIS Robuste
description: Panel maritime dédié dans la right sidebar — filtrage portuaire, alertes sécurité, modal OSINT navire complet
type: spec
date: 2026-03-24
---

# Spec — Maritime AIS Robuste

## Contexte

Le service `military-ships.ts` reçoit déjà le flux AIS live via WebSocket (relais local → aisstream.io). Les navires militaires et civils sont dans `livePositions`. Cependant, il n'existe pas de panel dédié au trafic maritime — les navires s'affichent sur la carte mais sans interface de consultation, de filtrage, ni d'analyse. Cette spec introduit un `MaritimePanel` dans la right sidebar avec une couche d'analyse OSINT et de détection d'anomalies.

---

## 1. Architecture du service — Enrichissements

### 1.1 Filtrage portuaire

Nouveau fichier `src/config/french-ports.ts` — liste des grands ports français avec bounding boxes :

```typescript
interface FrenchPort {
  id: string;
  name: string;
  locode: string;        // UN/LOCODE ex: "FRLEH" (Le Havre)
  lat: number;
  lon: number;
  radiusKm: number;      // Zone de surveillance
  type: 'commercial' | 'military' | 'fishing' | 'mixed';
}
```

Ports inclus : Le Havre, Marseille, Dunkerque, Rouen, Nantes-Saint-Nazaire, Bordeaux, Calais, Brest (militaire), Toulon (militaire), La Rochelle, Sète, Bayonne + principaux ports DROM.

Fonction `getShipNearestPort(lat, lon): { port: FrenchPort; distanceKm: number } | null` — retourne le port le plus proche si distance < `port.radiusKm`.

### 1.2 Analyse de risque navire

Nouveau champ calculé `riskLevel: 'none' | 'low' | 'medium' | 'high'` ajouté dans `getAllLiveTraffic()` :

| Critère | Niveau |
|---------|--------|
| Navire éteint AIS > 30 min puis réapparu | `medium` |
| Vitesse anormale (> 25 nœuds pour cargo/tanker) | `low` |
| Route directe vers câble sous-marin (distance < 2km, vitesse < 5 nœuds) | `high` |
| Pavillon à risque (liste noire ITF/Paris MOU) | `medium` |
| Destination déclarée incohérente avec route | `low` |
| Navire militaire étranger dans ZEE française | `medium` |

Le calcul s'appuie sur `cable-proximity.ts` existant pour la détection câbles.

### 1.3 Pavillon à risque

Static set `HIGH_RISK_FLAGS` dans `military-ships.ts` — pays sous embargo ou fréquemment impliqués dans incidents maritimes (Paris MOU grey/black list). Le `getMmsiCountry()` existant fournit déjà le pays.

---

## 2. Panel Maritime — Structure

### 2.1 Tabs

```
[Trafic FR] [Marine Nationale] [Alertes]
```

**Tab Trafic FR** : liste paginée des navires civils dans les zones portuaires françaises (ou visible sur la carte si pas de filtre port). Tri par `lastSeen` (plus récent d'abord). Filtres rapides : Cargo | Tanker | Passagers | Pêche.

**Tab Marine Nationale** : liste statique des navires Marine Nationale avec statut AIS (live vert / hors AIS gris). Affiche position actuelle (live) ou port d'attache.

**Tab Alertes** : navires avec `riskLevel >= 'medium'`. Badge rouge sur le tab si alertes actives. Chaque alerte montre : nom navire, raison, distance côte/câble, timestamp.

### 2.2 Carte navire (list item)

```
[Type icon] NOM NAVIRE              [risk badge]
             Cargo · 🇵🇦 Panama
             12.4 kn → FRLEH (Le Havre)  · vu il y a 2min
```

- Icône par type : ⚓ cargo, 🛢 tanker, 🚢 passagers, ⛵ pêche, ⚔️ militaire
- Badge risque : point coloré (vert/jaune/orange/rouge)
- Clic → modal OSINT complet

### 2.3 Stats en tête de panel

```
Trafic FR actif
[47 navires]  [3 alertes]  [AIS ●]
Zone : Méditerranée · Manche · Atlantique
```

---

## 3. Modal OSINT — Détail navire

Clic sur un navire dans le panel OU clic direct sur la carte → modal overlay dans la right sidebar.

### Données affichées

| Section | Source | Données |
|---------|--------|---------|
| Identité | AIS static data | Nom, MMSI, IMO, indicatif radio, pavillon (flag emoji + pays) |
| Caractéristiques | AIS static data | Type navire, longueur × largeur, tirant d'eau, jauge brute |
| Position live | AIS position report | Lat/lon, vitesse (SOG), cap (COG), heading, statut nav (mouillé/en route/amarré...) |
| Destination | AIS static data | Destination déclarée (normalisée via `AIS_DESTINATION_ALIASES`), ETA |
| Route | `shipTrails` | Mini-carte trail (SVG ou canvas inline, dernières 80 positions) |
| Port context | `french-ports.ts` | Port le plus proche + distance, type port |
| Analyse risque | Calcul interne | `riskLevel` + détail des critères déclencheurs |
| Propriétaire | Lien externe | Bouton "Voir sur MarineTraffic ↗" (url `marinetraffic.com/en/ais/details/ships/mmsi:{mmsi}`) |
| Historique AIS | Lien externe | Bouton "VesselFinder ↗" |

### Statuts de navigation AIS (décodés)

Champ `navStatus` converti en label FR :
- 0 → En route (moteur)
- 1 → Mouillé
- 3 → Manœuvre restreinte
- 5 → Amarré
- 8 → Pêche en cours
- 15 → Indéfini

### Structure UI

```
[← Retour]  [NOM NAVIRE]  [risk badge]
─────────────────────────────────────
[Type icon 40px]  [MMSI: 123456789]
                  [IMO: 9876543]
                  [Pavillon: 🇵🇦 Panama]
                  [Type: Cargo vrac]
─────────────────────────────────────
[Tabs: Position | Caractéristiques | Risque | Liens]
─────────────────────────────────────
[Tab Position]
  Vitesse: 12.4 kn  Cap: 087°  Statut: En route
  Destination: Le Havre (FRLEH)  ETA: 25/03 08:00
  [Mini-trail SVG 200×120px]
─────────────────────────────────────
[MarineTraffic ↗]  [VesselFinder ↗]
```

---

## 4. Interactions carte ↔ panel

- Clic sur un navire sur la carte `DeckGLMap` → `onMaritimeShipClick(ship)` → ouvre `MaritimePanel` + scroll vers le navire dans la liste + ouvre le modal détail
- Hover sur navire dans le panel → highlight le point sur la carte (nouveau callback `setHighlightedShip(mmsi)`)
- Toggle layer maritime OFF → `MaritimePanel` se vide (mais reste monté dans la right sidebar)

---

## 5. Relais AIS — Robustesse

Le relais WebSocket local (`ws://localhost:8090`) est fragile en prod. Améliorations dans `military-ships.ts` :

- **Reconnexion exponentielle** : délai 5s → 10s → 20s → 30s (max) au lieu de 5s fixe
- **Indicateur d'état** dans le panel : `AIS ● connecté` (vert) / `AIS ○ reconnexion…` (orange) / `AIS ✗ hors ligne` (rouge)
- **Mode dégradé** : si AIS offline > 5 min, afficher uniquement les navires militaires (base statique) + message "Relais AIS déconnecté — données statiques"
- **Timeout initial** : si pas de données dans les 10s après connexion WebSocket, passer en mode dégradé immédiatement

---

## 6. Filtrage géographique

Par défaut, ne pas afficher tous les navires mondiaux (le cache `livePositions` peut recevoir des navires de partout si le relais est configuré globalement). Filtre dans `getAllLiveTraffic()` :

```
Option A (recommandée) : filtre boîte englobante France + ZEE
  lat: [40, 52], lon: [-8, 10] + DOM-TOM bounding boxes
Option B : filtre par port (n'affiche que les navires near FR ports)
```

→ Option A : plus complet, garde les navires en transit Manche/Méditerranée.

Nouveau paramètre `getAllLiveTraffic(maxAgeMs, filterFrance = true)`.

---

## 7. Fichiers créés/modifiés (résumé)

| Fichier | Action |
|---------|--------|
| `src/config/french-ports.ts` | CRÉÉ — liste ports FR avec bounding boxes |
| `src/services/military-ships.ts` | + `riskLevel`, filtre France, reconnexion exponentielle, `getAisConnectionState()` |
| `src/components/MaritimePanel.ts` | CRÉÉ — 3 tabs, liste navires, modal OSINT, état connexion AIS |
| `src/components/RightSidebar.ts` | Monter `MaritimePanel` |
| `src/components/DeckGLMap.ts` | + `onMaritimeShipClick`, `setHighlightedShip()` |
| `src/components/MapContainer.ts` | Proxy `onMaritimeShipClick`, `setHighlightedShip()` |
| `src/App.ts` | Câblage clic navire → `MaritimePanel`, toggle layer |
| `src/types/index.ts` | + `riskLevel` dans `MilitaryShip`, `FrenchPort` interface |
