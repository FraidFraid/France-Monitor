# Maritime AIS Robuste — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Créer un `MaritimePanel` pro-grade dans la right sidebar — 3 tabs (Trafic FR / Marine Nationale / Alertes), filtrage géographique France, scoring de risque par navire, modal OSINT complet (IMO, pavillon, owner, trail SVG, liens MarineTraffic/VesselFinder), et robustesse WebSocket avec reconnexion exponentielle.

**Architecture:** `french-ports.ts` config statique des ports français. Enrichissements dans `military-ships.ts` : filtre France, `riskLevel` calculé, reconnexion exponentielle, état connexion exporté. `MaritimePanel.ts` panel autonome dans la right sidebar. Clic sur navire carte → ouvre le modal détail. Highlight bidirectionnel panel ↔ carte.

**Tech Stack:** Vanilla TypeScript, MapLibre GL JS (highlight), WebSocket AIS, cable-proximity.ts (existant), turf.js (distance).

**Verification:** `npm run typecheck && npm run build` après chaque tâche.

---

## File Map

| Fichier | Action | Responsabilité |
|---------|--------|---------------|
| `src/config/french-ports.ts` | Créer | Liste ports français avec bbox, locode, type |
| `src/config/risk-flags.ts` | Créer | Set pavillons à risque (Paris MOU grey/black list) |
| `src/services/military-ships.ts` | Modifier | + filtre France, `riskLevel`, reconnexion expo, `getAisConnectionState()` |
| `src/components/MaritimePanel.ts` | Créer | Panel right sidebar — 3 tabs, liste, modal OSINT complet |
| `src/components/DeckGLMap.ts` | Modifier | + `onMaritimeShipClick`, `setHighlightedShip()` callback |
| `src/components/MapContainer.ts` | Modifier | Proxy `onMaritimeShipClick`, `setHighlightedShip()` |
| `src/types/index.ts` | Modifier | + `riskLevel` dans `MilitaryShip`, `FrenchPort` interface |
| `src/App.ts` | Modifier | Câbler clic navire → `MaritimePanel`, toggle layer maritime |

---

## Task 1 — french-ports.ts : config des ports

**Files:**
- Create: `src/config/french-ports.ts`

- [ ] Créer la config des 18 ports principaux :

```typescript
/**
 * french-ports.ts — Ports maritimes français avec zone de surveillance.
 * Utilisé pour le filtrage et la contextualisation des navires AIS.
 * Source : Grand Ports Maritimes (GPM) + ports régionaux
 */

export interface FrenchPort {
  id: string;
  name: string;
  locode: string;          // UN/LOCODE
  lat: number;
  lon: number;
  radiusKm: number;        // Rayon de la zone de surveillance
  type: 'commercial' | 'military' | 'fishing' | 'mixed';
  region: string;
  trafficMTons?: number;   // Trafic annuel en millions de tonnes (pour triage)
}

export const FRENCH_PORTS: FrenchPort[] = [
  // ─── Grands Ports Maritimes (GPM) ───
  { id: 'leh', name: 'Le Havre',           locode: 'FRLEH', lat: 49.494,  lon: 0.108,    radiusKm: 25, type: 'commercial', region: 'Normandie',          trafficMTons: 73 },
  { id: 'mrs', name: 'Marseille-Fos',      locode: 'FRMRS', lat: 43.296,  lon: 5.380,    radiusKm: 30, type: 'commercial', region: 'PACA',               trafficMTons: 78 },
  { id: 'dkk', name: 'Dunkerque',          locode: 'FRDKK', lat: 51.036,  lon: 2.377,    radiusKm: 20, type: 'commercial', region: 'Hauts-de-France',    trafficMTons: 51 },
  { id: 'rou', name: 'Rouen',              locode: 'FRURO', lat: 49.443,  lon: 1.100,    radiusKm: 20, type: 'commercial', region: 'Normandie',          trafficMTons: 22 },
  { id: 'nte', name: 'Nantes-St-Nazaire',  locode: 'FRNTS', lat: 47.218,  lon: -2.200,   radiusKm: 25, type: 'commercial', region: 'Pays de la Loire',   trafficMTons: 31 },
  { id: 'brd', name: 'Bordeaux',           locode: 'FRBOD', lat: 44.838,  lon: -0.578,   radiusKm: 20, type: 'commercial', region: 'Nouvelle-Aquitaine', trafficMTons: 9  },
  { id: 'srs', name: 'La Rochelle',        locode: 'FRLRH', lat: 46.160,  lon: -1.151,   radiusKm: 15, type: 'commercial', region: 'Nouvelle-Aquitaine', trafficMTons: 10 },
  { id: 'set', name: 'Sète',              locode: 'FRSET', lat: 43.404,  lon: 3.696,    radiusKm: 15, type: 'commercial', region: 'Occitanie',          trafficMTons: 4  },
  // ─── Ports militaires ───
  { id: 'bst', name: 'Brest (Marine)',     locode: 'FRBST', lat: 48.383,  lon: -4.495,   radiusKm: 20, type: 'military',   region: 'Bretagne' },
  { id: 'tln', name: 'Toulon (Marine)',    locode: 'FRTLN', lat: 43.124,  lon: 5.928,    radiusKm: 20, type: 'military',   region: 'PACA' },
  { id: 'chb', name: 'Cherbourg',         locode: 'FRCHER', lat: 49.646,  lon: -1.622,   radiusKm: 15, type: 'mixed',     region: 'Normandie' },
  // ─── Ports de ferry / passagers ───
  { id: 'cal', name: 'Calais',            locode: 'FRCQF', lat: 50.960,  lon: 1.850,    radiusKm: 15, type: 'commercial', region: 'Hauts-de-France',    trafficMTons: 3  },
  { id: 'dpe', name: 'Dieppe',            locode: 'FRDDP', lat: 49.929,  lon: 1.085,    radiusKm: 10, type: 'mixed',     region: 'Normandie' },
  { id: 'ler', name: 'Roscoff',           locode: 'FRROS', lat: 48.726,  lon: -3.985,   radiusKm: 10, type: 'mixed',     region: 'Bretagne' },
  { id: 'sml', name: 'Saint-Malo',        locode: 'FRSML', lat: 48.651,  lon: -2.025,   radiusKm: 10, type: 'mixed',     region: 'Bretagne' },
  // ─── Ports DROM ───
  { id: 'ftd', name: 'Fort-de-France',    locode: 'MQFDF', lat: 14.609,  lon: -61.079,  radiusKm: 20, type: 'mixed',     region: 'Martinique' },
  { id: 'ptp', name: 'Pointe-à-Pitre',   locode: 'GPPTP', lat: 16.242,  lon: -61.534,  radiusKm: 20, type: 'mixed',     region: 'Guadeloupe' },
  { id: 'reu', name: 'La Réunion',        locode: 'RERNU', lat: -20.930, lon: 55.467,   radiusKm: 20, type: 'commercial',region: 'Réunion' },
];

// Zone France métropolitaine + ZEE proche-côtière (boîte englobante élargie)
export const FRANCE_BBOX = {
  minLat: 41.0, maxLat: 51.5,
  minLon: -6.0, maxLon: 10.0,
};

// Bboxes DROM
export const DROM_BBOXES = [
  { name: 'Martinique',   minLat: 14.3, maxLat: 14.9, minLon: -61.3, maxLon: -60.7 },
  { name: 'Guadeloupe',   minLat: 15.8, maxLat: 16.6, minLon: -61.9, maxLon: -60.9 },
  { name: 'Guyane',       minLat: 2.0,  maxLat: 6.0,  minLon: -55.0, maxLon: -51.0 },
  { name: 'Réunion',      minLat: -21.5,maxLat: -20.5,minLon: 55.0,  maxLon: 56.0  },
  { name: 'Mayotte',      minLat: -13.1,maxLat: -12.5,minLon: 44.9,  maxLon: 45.4  },
];

export function isInFranceZone(lat: number, lon: number): boolean {
  const inMetro = lat >= FRANCE_BBOX.minLat && lat <= FRANCE_BBOX.maxLat &&
                  lon >= FRANCE_BBOX.minLon && lon <= FRANCE_BBOX.maxLon;
  if (inMetro) return true;
  return DROM_BBOXES.some(b => lat >= b.minLat && lat <= b.maxLat && lon >= b.minLon && lon <= b.maxLon);
}

export function getNearestPort(lat: number, lon: number): { port: FrenchPort; distanceKm: number } | null {
  let nearest: FrenchPort | null = null;
  let minDist = Infinity;
  for (const port of FRENCH_PORTS) {
    const dlat = (lat - port.lat) * 111;
    const dlon = (lon - port.lon) * 111 * Math.cos((lat * Math.PI) / 180);
    const dist = Math.sqrt(dlat * dlat + dlon * dlon);
    if (dist < minDist) { minDist = dist; nearest = port; }
  }
  if (!nearest || minDist > 500) return null;
  return { port: nearest, distanceKm: Math.round(minDist * 10) / 10 };
}
```

- [ ] `npm run typecheck`

- [ ] Commit :
```bash
git add src/config/french-ports.ts
git commit -m "feat(maritime): add french-ports config — 18 ports with bbox + getNearestPort()"
```

---

## Task 2 — risk-flags.ts : pavillons à risque

**Files:**
- Create: `src/config/risk-flags.ts`

- [ ] Créer la blacklist Paris MOU (liste noire/grise 2024) :

```typescript
/**
 * risk-flags.ts — Pavillons à risque selon Paris MOU (Port State Control)
 * Source : Paris MOU Annual Report 2024 — Black & Grey List
 * Clé = code pays ISO2 extrait du MMSI (via getMmsiCountry)
 */

// Black list Paris MOU 2024 — taux de rétention > 10%
export const BLACK_LIST_FLAGS = new Set([
  'TZ', // Tanzanie
  'KH', // Cambodge
  'GQ', // Guinée équatoriale
  'SL', // Sierra Leone
  'TG', // Togo
  'MG', // Madagascar
  'CF', // Centrafrique
  'CD', // Congo (RDC)
]);

// Grey list Paris MOU 2024 — taux de rétention 5-10%
export const GREY_LIST_FLAGS = new Set([
  'PA', // Panama (important — 1er registre mondial)
  'VU', // Vanuatu
  'PW', // Palau
  'KM', // Comores
  'BO', // Bolivie
  'MD', // Moldavie
  'SB', // Îles Salomon
  'GN', // Guinée
]);

// Registres OFAC sanctionnés (Iran, Russie, Corée du Nord, etc.)
export const SANCTIONED_FLAGS = new Set([
  'KP', // Corée du Nord
  'IR', // Iran
  'SY', // Syrie
  'CU', // Cuba
  'VE', // Venezuela (partiel)
]);

export type FlagRisk = 'blacklist' | 'greylist' | 'sanctioned' | 'none';

export function getFlagRisk(countryIso2: string | undefined): FlagRisk {
  if (!countryIso2) return 'none';
  if (SANCTIONED_FLAGS.has(countryIso2)) return 'sanctioned';
  if (BLACK_LIST_FLAGS.has(countryIso2)) return 'blacklist';
  if (GREY_LIST_FLAGS.has(countryIso2)) return 'greylist';
  return 'none';
}
```

- [ ] `npm run typecheck`

- [ ] Commit :
```bash
git add src/config/risk-flags.ts
git commit -m "feat(maritime): add risk-flags config — Paris MOU black/grey list + OFAC sanctions"
```

---

## Task 3 — military-ships.ts : enrichissements majeurs

**Files:**
- Modify: `src/services/military-ships.ts`

- [ ] Ajouter `riskLevel` dans `MilitaryShip` interface :

```typescript
export type RiskLevel = 'none' | 'low' | 'medium' | 'high' | 'critical';

export interface MilitaryShip {
  // ... champs existants ...
  riskLevel?: RiskLevel;          // ← NOUVEAU
  riskReasons?: string[];         // ← NOUVEAU — raisons détaillées
  nearestPort?: { name: string; locode: string; distanceKm: number }; // ← NOUVEAU
  flagRisk?: 'blacklist' | 'greylist' | 'sanctioned' | 'none';       // ← NOUVEAU
}
```

- [ ] Remplacer la reconnexion fixe (5s) par **exponentielle** :

```typescript
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 30000;

ws.onclose = () => {
  wsConnected = false;
  const delay = Math.min(5000 * Math.pow(1.5, reconnectAttempts), MAX_RECONNECT_DELAY);
  reconnectAttempts++;
  setTimeout(() => connectAisStream(), delay);
};
ws.onopen = () => {
  wsConnected = true;
  reconnectAttempts = 0;  // reset au succès
  // ...
};
```

- [ ] Exporter l'état de connexion complet :

```typescript
export function getAisConnectionState(): {
  connected: boolean;
  shipCount: number;
  franceShipCount: number;
  reconnectAttempts: number;
  lastMessageAt: number | null;
} {
  return {
    connected: wsConnected,
    shipCount: livePositions.size,
    franceShipCount: Array.from(livePositions.values()).filter(p => isInFranceZone(p.lat, p.lon)).length,
    reconnectAttempts,
    lastMessageAt: lastMessageTs,
  };
}
```

- [ ] Mettre à jour `getAllLiveTraffic()` — ajouter filtre France + calcul riskLevel :

```typescript
import { isInFranceZone, getNearestPort } from '../config/french-ports.ts';
import { getFlagRisk } from '../config/risk-flags.ts';

export function getAllLiveTraffic(maxAgeMs = 10 * 60 * 1000, filterFrance = true): MilitaryShip[] {
  const now = Date.now();
  const ships: MilitaryShip[] = [];

  for (const [mmsi, pos] of livePositions) {
    if ((now - pos.ts) > maxAgeMs) continue;
    if (filterFrance && !isInFranceZone(pos.lat, pos.lon)) continue;

    const countryIso2 = pos.country?.split('|')[0];
    const flagRisk = getFlagRisk(countryIso2);
    const nearestPort = getNearestPort(pos.lat, pos.lon);
    const { level: riskLevel, reasons: riskReasons } = computeRiskLevel(mmsi, pos, flagRisk, nearestPort);

    // ... reste du mapping existant ...
    ships.push({
      // ... champs existants ...
      riskLevel,
      riskReasons,
      nearestPort: nearestPort ? { name: nearestPort.port.name, locode: nearestPort.port.locode, distanceKm: nearestPort.distanceKm } : undefined,
      flagRisk,
    });
  }
  return ships;
}
```

- [ ] Ajouter la fonction `computeRiskLevel()` :

```typescript
function computeRiskLevel(
  mmsi: string,
  pos: LivePosition,
  flagRisk: ReturnType<typeof getFlagRisk>,
  nearestPort: ReturnType<typeof getNearestPort>
): { level: RiskLevel; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // Pavillon sanctionné
  if (flagRisk === 'sanctioned') { score += 40; reasons.push('Pavillon sanctionné OFAC'); }
  if (flagRisk === 'blacklist')  { score += 20; reasons.push('Pavillon liste noire Paris MOU'); }
  if (flagRisk === 'greylist')   { score += 10; reasons.push('Pavillon liste grise Paris MOU'); }

  // Vitesse anormale pour cargo/tanker (SOG > 22 kn)
  const isCargo = pos.shipType != null && pos.shipType >= 70 && pos.shipType <= 89;
  if (isCargo && pos.speed > 22) { score += 15; reasons.push(`Vitesse anormale: ${pos.speed.toFixed(1)} kn`); }

  // Navire militaire étranger (navire non Marine Nationale, shipType=35)
  if (pos.shipType === 35 && !NAVY_MMSI_SET.has(mmsi)) {
    const country = pos.country?.split('|')[1] ?? 'Inconnu';
    if (country !== 'France') { score += 25; reasons.push(`Navire militaire étranger (${country})`); }
  }

  // AIS coupé récemment (gap > 20 min, navire réapparu)
  // (simplifié : si lastSeen très récent mais navire jamais vu avant = premier point)
  // TODO: tracker les gaps AIS dans une map séparée pour détection précise

  // Proximité câble sous-marin : delégué au service cable-threats.ts existant
  // Le score câble est calculé séparément et merge dans App.ts

  if (score >= 40) return { level: 'critical', reasons };
  if (score >= 25) return { level: 'high', reasons };
  if (score >= 15) return { level: 'medium', reasons };
  if (score >= 5)  return { level: 'low', reasons };
  return { level: 'none', reasons };
}
```

- [ ] `npm run typecheck`

- [ ] Commit :
```bash
git add src/services/military-ships.ts
git commit -m "feat(maritime): add riskLevel, filterFrance, exponential reconnect, getAisConnectionState"
```

---

## Task 4 — types/index.ts : MilitaryShip update

**Files:**
- Modify: `src/types/index.ts`

- [ ] Si `MilitaryShip` est défini dans `types/index.ts`, y ajouter `riskLevel` et `flagRisk`. Sinon, les champs sont déjà dans `military-ships.ts` — vérifier la cohérence des imports.

- [ ] `npm run typecheck`

- [ ] Commit :
```bash
git add src/types/index.ts
git commit -m "feat(maritime): sync MilitaryShip type with riskLevel/flagRisk fields"
```

---

## Task 5 — DeckGLMap.ts : clic navire + highlight

**Files:**
- Modify: `src/components/DeckGLMap.ts`
- Modify: `src/components/MapContainer.ts`

- [ ] Ajouter le callback `onMaritimeShipClick` dans la classe :

```typescript
private _onMaritimeShipClick: ((ship: MilitaryShip, x: number, y: number) => void) | null = null;

setOnMaritimeShipClick(cb: (ship: MilitaryShip, x: number, y: number) => void): void {
  this._onMaritimeShipClick = cb;
}
```

- [ ] Dans le handler de clic sur les layers navires (chercher `onMilitaryShipClick` existant) — vérifier si le callback existe déjà. Si oui, utiliser le même pattern pour le trafic civil. Sinon, ajouter dans le handler de click MapLibre :

```typescript
// Dans le handler map.on('click', ...) — après la vérification des layers existants
const maritimeFeatures = map.queryRenderedFeatures(e.point, { layers: [LYR_GLOBAL_TRAFFIC, LYR_MILITARY_SHIPS] });
if (maritimeFeatures.length > 0 && this._onMaritimeShipClick) {
  const mmsi = maritimeFeatures[0].properties?.mmsi as string;
  const ship = getAllLiveTraffic().find(s => s.mmsi === mmsi) ?? getMilitaryShips().find(s => s.mmsi === mmsi);
  if (ship) this._onMaritimeShipClick(ship, e.point.x, e.point.y);
}
```

- [ ] Ajouter `setHighlightedShip(mmsi: string | null)` — change le style du point sur la carte :

```typescript
private _highlightedMmsi: string | null = null;

setHighlightedShip(mmsi: string | null): void {
  this._highlightedMmsi = mmsi;
  const map = this._map;
  if (!map) return;
  // Filtrer le layer highlight (si existant) ou changer la taille via expression
  try {
    map.setPaintProperty(LYR_GLOBAL_TRAFFIC, 'circle-radius', mmsi
      ? ['case', ['==', ['get', 'mmsi'], mmsi], 12, 6]
      : 6
    );
  } catch { /* layer pas encore chargé */ }
}
```

- [ ] Proxies dans `MapContainer.ts` :

```typescript
setOnMaritimeShipClick(cb: (ship: MilitaryShip, x: number, y: number) => void): void {
  this._deckGLMap?.setOnMaritimeShipClick(cb);
  // Stocker aussi pour init() tardive si map pas encore prête
  this._onMaritimeShipClickCb = cb;
}

setHighlightedShip(mmsi: string | null): void {
  this._deckGLMap?.setHighlightedShip(mmsi);
}
```

- [ ] `npm run typecheck`

- [ ] Commit :
```bash
git add src/components/DeckGLMap.ts src/components/MapContainer.ts
git commit -m "feat(maritime): add onMaritimeShipClick + setHighlightedShip to DeckGLMap/MapContainer"
```

---

## Task 6 — MaritimePanel.ts

**Files:**
- Create: `src/components/MaritimePanel.ts`

- [ ] Créer le panel (structure complète) :

```typescript
/**
 * MaritimePanel.ts — Panel maritime OSINT dans la right sidebar.
 * 3 tabs : Trafic FR | Marine Nationale | Alertes
 * Clic navire → modal détail complet avec trail SVG, risk analysis, liens externes.
 */

import { getAllLiveTraffic, getMilitaryShips, getAisConnectionState, type MilitaryShip, type RiskLevel } from '../services/military-ships.ts';
import { getNearestPort } from '../config/french-ports.ts';

const RISK_COLORS: Record<RiskLevel, string> = {
  none: '#34c759', low: '#ffcc00', medium: '#ff9500', high: '#ff3b30', critical: '#ff2d55',
};

const SHIP_TYPE_ICONS: Record<string, string> = {
  'Cargo': '📦', 'Tanker': '🛢', 'Passagers': '🚢', 'Pêche': '🎣',
  'Militaire': '⚔️', 'Remorqueur/Spécial': '🔧', 'Plaisance': '⛵',
};

function shipIcon(type: string): string {
  for (const [k, v] of Object.entries(SHIP_TYPE_ICONS)) {
    if (type.includes(k)) return v;
  }
  return '⚓';
}

const NAV_STATUS_LABELS: Record<number, string> = {
  0: 'En route (moteur)', 1: 'Mouillé', 2: 'Commandement restreint',
  3: 'Manœuvre restreinte', 5: 'Amarré', 6: 'Échoué', 7: 'Pêche en cours',
  8: 'En voilure', 15: 'Indéfini',
};

export class MaritimePanel {
  private containerEl!: HTMLElement;
  private bodyEl!: HTMLElement;
  private activeTab: 'traffic' | 'navy' | 'alerts' = 'traffic';
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private onHighlightShipCb: ((mmsi: string | null) => void) | null = null;

  constructor(private readonly parentEl: HTMLElement) {}

  setOnHighlightShip(cb: (mmsi: string | null) => void): void {
    this.onHighlightShipCb = cb;
  }

  mount(): void {
    this.containerEl = document.createElement('div');
    this.containerEl.className = 'panel';

    // Header avec état AIS
    const header = document.createElement('div');
    header.className = 'panel-header';
    header.innerHTML = `
      <span class="panel-title">MARITIME</span>
      <span id="ais-status-badge" style="font-size:9px;margin-left:8px;"></span>`;
    this.containerEl.appendChild(header);

    // Tabs
    const tabBar = document.createElement('div');
    tabBar.style.cssText = 'display:flex;gap:2px;padding:6px 12px;border-bottom:1px solid var(--border-color);';
    const tabDefs: Array<{ key: 'traffic'|'navy'|'alerts'; label: string }> = [
      { key: 'traffic', label: 'Trafic FR' },
      { key: 'navy', label: 'Marine Nat.' },
      { key: 'alerts', label: 'Alertes' },
    ];
    tabDefs.forEach(({ key, label }) => {
      const btn = document.createElement('button');
      btn.id = `mtab-${key}`;
      btn.textContent = label;
      btn.dataset['tab'] = key;
      btn.style.cssText = 'background:transparent;border:none;color:var(--text-muted);cursor:pointer;padding:4px 9px;border-radius:4px;font-size:11px;';
      btn.addEventListener('click', () => this._switchTab(key));
      tabBar.appendChild(btn);
    });
    this.containerEl.appendChild(tabBar);

    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'panel-body';
    this.bodyEl.style.cssText = 'padding:8px 12px;max-height:400px;overflow-y:auto;';
    this.containerEl.appendChild(this.bodyEl);

    this.parentEl.appendChild(this.containerEl);

    this._switchTab('traffic');
    this._updateAisBadge();

    // Refresh toutes les 10s
    this.refreshInterval = setInterval(() => {
      this._renderCurrentTab();
      this._updateAisBadge();
    }, 10000);
  }

  // Appelé depuis App.ts quand un navire est cliqué sur la carte
  openShipModal(ship: MilitaryShip): void {
    this._openModal(ship);
  }

  private _switchTab(tab: 'traffic' | 'navy' | 'alerts'): void {
    this.activeTab = tab;
    this.containerEl.querySelectorAll('[data-tab]').forEach(btn => {
      const b = btn as HTMLButtonElement;
      const isActive = b.dataset['tab'] === tab;
      b.style.background = isActive ? 'rgba(255,255,255,0.08)' : 'transparent';
      b.style.color = isActive ? 'var(--text-primary)' : 'var(--text-muted)';
    });
    this._renderCurrentTab();
  }

  private _renderCurrentTab(): void {
    if (this.activeTab === 'traffic') this._renderTraffic();
    else if (this.activeTab === 'navy') this._renderNavy();
    else this._renderAlerts();
  }

  private _renderTraffic(): void {
    const ships = getAllLiveTraffic(10 * 60 * 1000, true)
      .sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0));

    if (ships.length === 0) {
      this.bodyEl.innerHTML = '<div style="color:var(--text-muted);font-size:11px;text-align:center;padding:24px;">Aucun navire civil détecté en zone France</div>';
      return;
    }

    // Stats rapides
    const alerts = ships.filter(s => s.riskLevel && s.riskLevel !== 'none').length;
    this.bodyEl.innerHTML = `
      <div style="display:flex;gap:12px;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--border-color);">
        <div style="text-align:center;"><div style="color:var(--text-primary);font-weight:700;font-size:16px;">${ships.length}</div><div style="color:var(--text-muted);font-size:9px;">navires</div></div>
        <div style="text-align:center;"><div style="color:${alerts > 0 ? '#ff3b30' : 'var(--text-muted)'};font-weight:700;font-size:16px;">${alerts}</div><div style="color:var(--text-muted);font-size:9px;">alertes</div></div>
      </div>`;

    const list = document.createElement('div');
    ships.slice(0, 20).forEach(ship => list.appendChild(this._shipCard(ship)));
    this.bodyEl.appendChild(list);
  }

  private _renderNavy(): void {
    const ships = getMilitaryShips();
    this.bodyEl.innerHTML = '';
    ships.forEach(ship => this.bodyEl.appendChild(this._shipCard(ship)));
  }

  private _renderAlerts(): void {
    const all = getAllLiveTraffic(10 * 60 * 1000, true);
    const alerts = all.filter(s => s.riskLevel && ['medium','high','critical'].includes(s.riskLevel));

    if (alerts.length === 0) {
      this.bodyEl.innerHTML = '<div style="color:#34c759;font-size:11px;text-align:center;padding:24px;">● Aucune alerte active</div>';
      return;
    }
    this.bodyEl.innerHTML = '';
    alerts.sort((a, b) => {
      const order = { critical: 4, high: 3, medium: 2, low: 1, none: 0 };
      return (order[b.riskLevel ?? 'none'] ?? 0) - (order[a.riskLevel ?? 'none'] ?? 0);
    }).forEach(ship => {
      const card = this._shipCard(ship);
      // Ajouter les raisons
      if (ship.riskReasons?.length) {
        const reasons = document.createElement('div');
        reasons.style.cssText = 'padding:4px 8px;background:rgba(255,59,48,0.05);border-radius:0 0 4px 4px;margin-top:-4px;';
        ship.riskReasons.forEach(r => {
          const tag = document.createElement('div');
          tag.style.cssText = 'color:#ff6b60;font-size:10px;padding:2px 0;';
          tag.textContent = `⚠ ${r}`;
          reasons.appendChild(tag);
        });
        card.appendChild(reasons);
      }
      this.bodyEl.appendChild(card);
    });
  }

  private _shipCard(ship: MilitaryShip): HTMLElement {
    const card = document.createElement('div');
    const riskColor = RISK_COLORS[ship.riskLevel ?? 'none'];
    card.style.cssText = 'display:flex;align-items:center;gap:8px;padding:7px 4px;border-bottom:1px solid rgba(255,255,255,0.05);cursor:pointer;';
    card.addEventListener('mouseenter', () => {
      card.style.background = 'rgba(255,255,255,0.04)';
      this.onHighlightShipCb?.(ship.mmsi ?? null);
    });
    card.addEventListener('mouseleave', () => {
      card.style.background = '';
      this.onHighlightShipCb?.(null);
    });
    card.addEventListener('click', () => this._openModal(ship));

    const countryIso = ship.country?.split('|')[0] ?? '';
    const countryName = ship.country?.split('|')[1] ?? '';
    const flagEmoji = countryIso ? String.fromCodePoint(...countryIso.toUpperCase().split('').map(c => 127397 + c.charCodeAt(0))) : '🏳';

    const elapsed = ship.lastSeen ? Math.round((Date.now() - ship.lastSeen) / 60000) : null;

    card.innerHTML = `
      <span style="font-size:18px;flex-shrink:0;">${shipIcon(ship.type)}</span>
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="color:var(--text-primary);font-weight:600;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:140px;">${ship.name}</span>
          <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${riskColor};flex-shrink:0;" title="${ship.riskLevel}"></span>
        </div>
        <div style="color:var(--text-muted);font-size:10px;margin-top:1px;">${ship.type} · ${flagEmoji} ${countryName || 'Inconnu'}</div>
        <div style="color:var(--text-muted);font-size:10px;">
          ${ship.speed != null ? `${ship.speed.toFixed(1)} kn` : '—'}
          ${ship.nearestPort ? ` → ${ship.nearestPort.name} (${ship.nearestPort.distanceKm}km)` : ''}
          ${elapsed != null ? ` · vu il y a ${elapsed}min` : ''}
        </div>
      </div>
      <span style="color:var(--text-muted);font-size:10px;flex-shrink:0;">›</span>`;

    return card;
  }

  private _openModal(ship: MilitaryShip): void {
    const existing = this.parentEl.querySelector('.maritime-modal');
    if (existing) { existing.remove(); return; }

    const modal = document.createElement('div');
    modal.className = 'maritime-modal';
    modal.style.cssText = 'position:absolute;inset:0;background:var(--bg-surface);z-index:30;display:flex;flex-direction:column;overflow:hidden;border-radius:8px;';

    const countryIso = ship.country?.split('|')[0] ?? '';
    const countryName = ship.country?.split('|')[1] ?? '';
    const flagEmoji = countryIso ? String.fromCodePoint(...countryIso.toUpperCase().split('').map(c => 127397 + c.charCodeAt(0))) : '🏳';
    const riskColor = RISK_COLORS[ship.riskLevel ?? 'none'];
    const riskLabel = { none: 'Nominal', low: 'Faible', medium: 'Modéré', high: 'Élevé', critical: 'Critique' }[ship.riskLevel ?? 'none'];

    const hdr = document.createElement('div');
    hdr.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--border-color);flex-shrink:0;';
    hdr.innerHTML = `
      <button id="maritime-back" style="background:rgba(255,255,255,0.1);border:none;color:var(--text-muted);cursor:pointer;width:26px;height:26px;border-radius:13px;font-size:13px;flex-shrink:0;">←</button>
      <span style="color:var(--text-primary);font-weight:600;font-size:13px;flex:1;">${ship.name}</span>
      <span style="background:${riskColor}22;border:1px solid ${riskColor}66;color:${riskColor};font-size:9px;font-weight:700;padding:2px 6px;border-radius:3px;">${riskLabel}</span>`;
    hdr.querySelector('#maritime-back')!.addEventListener('click', () => modal.remove());
    modal.appendChild(hdr);

    const body = document.createElement('div');
    body.style.cssText = 'flex:1;overflow-y:auto;padding:14px;';

    // Hero identité
    body.innerHTML = `
      <div style="display:flex;gap:12px;margin-bottom:14px;">
        <div style="font-size:36px;">${shipIcon(ship.type)}</div>
        <div>
          <div style="color:var(--text-primary);font-weight:700;font-size:14px;">${ship.name}</div>
          <div style="color:var(--text-muted);font-size:11px;margin-top:2px;">${ship.type} · ${flagEmoji} ${countryName}</div>
          ${ship.mmsi ? `<div style="color:var(--text-muted);font-size:10px;margin-top:3px;font-family:monospace;">MMSI: ${ship.mmsi}</div>` : ''}
          ${ship.imoNumber ? `<div style="color:var(--text-muted);font-size:10px;font-family:monospace;">IMO: ${ship.imoNumber}</div>` : ''}
          ${ship.callSign ? `<div style="color:var(--text-muted);font-size:10px;font-family:monospace;">Call Sign: ${ship.callSign}</div>` : ''}
        </div>
      </div>

      <!-- Tabs -->
      <div style="display:flex;gap:2px;margin-bottom:10px;border-bottom:1px solid var(--border-color);padding-bottom:6px;" id="mship-tabs">
        <button data-tab="position" class="mstab" style="background:rgba(255,255,255,0.08);border:none;color:var(--text-primary);cursor:pointer;padding:4px 9px;border-radius:4px;font-size:11px;">Position</button>
        <button data-tab="specs" class="mstab" style="background:transparent;border:none;color:var(--text-muted);cursor:pointer;padding:4px 9px;border-radius:4px;font-size:11px;">Specs</button>
        <button data-tab="risque" class="mstab" style="background:transparent;border:none;color:var(--text-muted);cursor:pointer;padding:4px 9px;border-radius:4px;font-size:11px;">Risque</button>
        <button data-tab="liens" class="mstab" style="background:transparent;border:none;color:var(--text-muted);cursor:pointer;padding:4px 9px;border-radius:4px;font-size:11px;">Liens</button>
      </div>
      <div id="mship-tab-content"></div>`;

    modal.appendChild(body);

    const rsContent = this.parentEl.closest('.right-sidebar-content') as HTMLElement;
    if (rsContent) { rsContent.style.position = 'relative'; rsContent.appendChild(modal); }

    this._setupShipTabs(modal, ship, flagEmoji, riskColor);
  }

  private _setupShipTabs(modal: HTMLElement, ship: MilitaryShip, flagEmoji: string, riskColor: string): void {
    const tabs = modal.querySelectorAll('.mstab');
    const contentEl = modal.querySelector('#mship-tab-content') as HTMLElement;

    const renderTab = (tabName: string) => {
      tabs.forEach(t => {
        const btn = t as HTMLButtonElement;
        const isActive = btn.dataset['tab'] === tabName;
        btn.style.background = isActive ? 'rgba(255,255,255,0.08)' : 'transparent';
        btn.style.color = isActive ? 'var(--text-primary)' : 'var(--text-muted)';
      });

      if (tabName === 'position') {
        const navStatusLabel = ship.navStatus != null ? (NAV_STATUS_LABELS[ship.navStatus] ?? `Statut ${ship.navStatus}`) : '—';
        const destStr = ship.destination ?? (ship.nearestPort ? `~ ${ship.nearestPort.name}` : '—');
        const etaStr = ship.eta ? `${String(ship.eta.day).padStart(2,'0')}/${String(ship.eta.month).padStart(2,'0')} ${String(ship.eta.hour).padStart(2,'0')}:${String(ship.eta.minute).padStart(2,'0')} UTC` : '—';

        contentEl.innerHTML = `
          <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:11px;margin-bottom:12px;">
            <span style="color:var(--text-muted);">Statut</span><span style="color:var(--text-primary);">${navStatusLabel}</span>
            <span style="color:var(--text-muted);">Vitesse</span><span style="color:var(--text-primary);">${ship.speed != null ? ship.speed.toFixed(1) + ' nœuds' : '—'}</span>
            <span style="color:var(--text-muted);">Cap (COG)</span><span style="color:var(--text-primary);">${ship.cog != null ? ship.cog.toFixed(0) + '°' : '—'}</span>
            <span style="color:var(--text-muted);">Heading</span><span style="color:var(--text-primary);">${ship.heading != null ? ship.heading.toFixed(0) + '°' : '—'}</span>
            <span style="color:var(--text-muted);">Destination</span><span style="color:var(--text-primary);">${destStr}</span>
            <span style="color:var(--text-muted);">ETA</span><span style="color:var(--text-primary);">${etaStr}</span>
            <span style="color:var(--text-muted);">Port proche</span><span style="color:var(--text-primary);">${ship.nearestPort ? `${ship.nearestPort.name} (${ship.nearestPort.distanceKm} km)` : '—'}</span>
            <span style="color:var(--text-muted);">Coord.</span><span style="color:var(--text-primary);font-family:monospace;">${ship.lat.toFixed(4)}, ${ship.lon.toFixed(4)}</span>
          </div>
          ${ship.trail && ship.trail.length > 2 ? this._renderTrailSvg(ship.trail) : '<div style="color:var(--text-muted);font-size:10px;">Trail insuffisant</div>'}`;

      } else if (tabName === 'specs') {
        const dims = ship.dimensions;
        contentEl.innerHTML = `
          <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:11px;">
            <span style="color:var(--text-muted);">Type AIS</span><span style="color:var(--text-primary);">${ship.shipType != null ? `${ship.type} (code ${ship.shipType})` : ship.type}</span>
            <span style="color:var(--text-muted);">Pavillon</span><span style="color:var(--text-primary);">${flagEmoji} ${ship.country?.split('|')[1] ?? '—'}${ship.flagRisk && ship.flagRisk !== 'none' ? ` ⚠ (${ship.flagRisk})` : ''}</span>
            ${dims?.length ? `<span style="color:var(--text-muted);">Longueur</span><span style="color:var(--text-primary);">${dims.length} m</span>` : ''}
            ${dims?.width ? `<span style="color:var(--text-muted);">Largeur</span><span style="color:var(--text-primary);">${dims.width} m</span>` : ''}
            ${ship.draught ? `<span style="color:var(--text-muted);">Tirant d'eau</span><span style="color:var(--text-primary);">${ship.draught} m</span>` : ''}
            ${ship.port ? `<span style="color:var(--text-muted);">Port attache</span><span style="color:var(--text-primary);">${ship.port}</span>` : ''}
          </div>`;

      } else if (tabName === 'risque') {
        const riskLabel = { none: 'Nominal', low: 'Faible', medium: 'Modéré', high: 'Élevé', critical: 'Critique' }[ship.riskLevel ?? 'none'];
        contentEl.innerHTML = `
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;padding:8px;background:${riskColor}11;border:1px solid ${riskColor}33;border-radius:6px;">
            <div style="width:10px;height:10px;border-radius:50%;background:${riskColor};flex-shrink:0;"></div>
            <span style="color:${riskColor};font-weight:700;font-size:13px;">Risque ${riskLabel}</span>
          </div>
          ${ship.riskReasons?.length ? `
            <div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Critères déclencheurs</div>
            ${ship.riskReasons.map(r => `<div style="padding:5px 8px;background:rgba(255,59,48,0.06);border-left:2px solid #ff3b30;margin-bottom:4px;font-size:11px;color:var(--text-primary);">${r}</div>`).join('')}
          ` : '<div style="color:var(--text-muted);font-size:11px;">Aucun critère de risque détecté</div>'}
          <div style="margin-top:12px;font-size:10px;color:var(--text-muted);line-height:1.5;">Sources : Paris MOU 2024, OFAC sanctions list, analyse comportementale AIS</div>`;

      } else if (tabName === 'liens') {
        contentEl.innerHTML = `
          <div style="display:flex;flex-direction:column;gap:6px;">
            ${ship.mmsi ? `<a href="https://www.marinetraffic.com/en/ais/details/ships/mmsi:${ship.mmsi}" target="_blank" style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:rgba(255,255,255,0.04);border:1px solid var(--border-color);border-radius:5px;text-decoration:none;color:var(--text-primary);font-size:11px;">MarineTraffic <span style="color:var(--text-muted);">↗</span></a>` : ''}
            ${ship.mmsi ? `<a href="https://www.vesseltracker.com/en/Ships/mmsi/${ship.mmsi}.html" target="_blank" style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:rgba(255,255,255,0.04);border:1px solid var(--border-color);border-radius:5px;text-decoration:none;color:var(--text-primary);font-size:11px;">VesselTracker <span style="color:var(--text-muted);">↗</span></a>` : ''}
            ${ship.mmsi ? `<a href="https://www.vesselfinderimage.com/?mmsi=${ship.mmsi}" target="_blank" style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:rgba(255,255,255,0.04);border:1px solid var(--border-color);border-radius:5px;text-decoration:none;color:var(--text-primary);font-size:11px;">VesselFinder <span style="color:var(--text-muted);">↗</span></a>` : ''}
            ${ship.imoNumber ? `<a href="https://www.equasis.org/EquasisWeb/public/HomePage" target="_blank" style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:rgba(255,255,255,0.04);border:1px solid var(--border-color);border-radius:5px;text-decoration:none;color:var(--text-primary);font-size:11px;">Equasis (IMO) <span style="color:var(--text-muted);">↗</span></a>` : ''}
            ${ship.imoNumber ? `<a href="https://www.shipinfo.net/pages/default.aspx?shimsid=${ship.imoNumber}" target="_blank" style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:rgba(255,255,255,0.04);border:1px solid var(--border-color);border-radius:5px;text-decoration:none;color:var(--text-primary);font-size:11px;">ShipInfo (propriétaire) <span style="color:var(--text-muted);">↗</span></a>` : ''}
          </div>
          <div style="margin-top:10px;font-size:10px;color:var(--text-muted);">Equasis donne accès aux données IMO : propriétaire, classe, certifications, inspections PSC.</div>`;
      }
    };

    tabs.forEach(t => t.addEventListener('click', () => renderTab((t as HTMLButtonElement).dataset['tab'] ?? '')));
    renderTab('position');
  }

  private _renderTrailSvg(trail: Array<[number, number]>): string {
    if (trail.length < 2) return '';
    const lons = trail.map(p => p[0]);
    const lats = trail.map(p => p[1]);
    const minLon = Math.min(...lons); const maxLon = Math.max(...lons);
    const minLat = Math.min(...lats); const maxLat = Math.max(...lats);
    const W = 280; const H = 100; const PAD = 10;
    const scaleX = (lon: number) => PAD + (lon - minLon) / (maxLon - minLon || 1) * (W - 2 * PAD);
    const scaleY = (lat: number) => H - PAD - (lat - minLat) / (maxLat - minLat || 1) * (H - 2 * PAD);
    const points = trail.map(([lon, lat]) => `${scaleX(lon)},${scaleY(lat)}`).join(' ');
    const last = trail[trail.length - 1];
    return `
      <div style="margin-top:10px;">
        <div style="font-size:10px;color:var(--text-muted);margin-bottom:4px;">Route récente (${trail.length} points)</div>
        <svg width="${W}" height="${H}" style="background:rgba(255,255,255,0.03);border-radius:4px;display:block;">
          <polyline points="${points}" fill="none" stroke="#3b82f6" stroke-width="1.5" stroke-opacity="0.7"/>
          <circle cx="${scaleX(last[0])}" cy="${scaleY(last[1])}" r="4" fill="#3b82f6"/>
        </svg>
      </div>`;
  }

  private _updateAisBadge(): void {
    const badge = document.getElementById('ais-status-badge');
    if (!badge) return;
    const state = getAisConnectionState();
    if (state.connected) {
      badge.style.cssText = 'color:#34c759;font-size:9px;';
      badge.textContent = `● ${state.franceShipCount} navires FR`;
    } else if (state.reconnectAttempts > 0) {
      badge.style.cssText = 'color:#ff9500;font-size:9px;';
      badge.textContent = `○ reconnexion…`;
    } else {
      badge.style.cssText = 'color:#ff3b30;font-size:9px;';
      badge.textContent = `✗ hors ligne`;
    }
  }

  destroy(): void {
    if (this.refreshInterval) clearInterval(this.refreshInterval);
    this.containerEl.remove();
  }
}
```

- [ ] `npm run typecheck`

- [ ] Commit :
```bash
git add src/components/MaritimePanel.ts
git commit -m "feat(maritime): add MaritimePanel — 3 tabs, ship cards, OSINT modal with trail SVG + risk analysis"
```

---

## Task 7 — App.ts : intégration finale

**Files:**
- Modify: `src/App.ts`

- [ ] Monter `MaritimePanel` dans la right sidebar :

```typescript
import { MaritimePanel } from './components/MaritimePanel.ts';
// Champ : private maritimePanel: MaritimePanel | null = null;

// Dans init, après RightSidebar :
this.maritimePanel = new MaritimePanel(rightContent);
this.maritimePanel.mount();

// Highlight bidirectionnel
this.maritimePanel.setOnHighlightShip((mmsi) => {
  this.mapContainer?.setHighlightedShip(mmsi);
});
```

- [ ] Connecter le clic navire carte → modal :

```typescript
this.mapContainer?.setOnMaritimeShipClick((ship) => {
  this.maritimePanel?.openShipModal(ship);
});
```

- [ ] Connecter `onLayerToggle('trafficMaritime')` → show/hide `MaritimePanel` :

```typescript
// Dans onLayerToggle, case 'trafficMaritime' (déjà existant) :
case 'trafficMaritime':
  // Logique carte existante...
  if (enabled) this.maritimePanel?.mount();
  break;
```

- [ ] `npm run build && npm run typecheck`

- [ ] Commit :
```bash
git add src/App.ts
git commit -m "feat(maritime): wire MaritimePanel to right sidebar, map click, layer toggle"
```

---

## Vérification finale

- [ ] `npm run build` — clean
- [ ] `npm run typecheck` — 0 erreurs
- [ ] Tester dans le navigateur :
  - Toggle layer "Maritime" → MaritimePanel apparaît dans right sidebar
  - Tab "Trafic FR" : navires en zone France (si relais AIS actif)
  - Tab "Marine Nationale" : liste statique + statut AIS live/offline
  - Tab "Alertes" : navires à risque medium/high mis en avant
  - Hover navire dans panel → highlight sur la carte
  - Clic navire sur la carte → modal détail
  - Modal → tab Position : grid données + trail SVG
  - Modal → tab Risque : badge couleur + raisons détaillées
  - Modal → tab Liens : MarineTraffic, VesselFinder, Equasis ouvrent dans un nouvel onglet
  - Badge AIS status en header : ● vert / ○ orange / ✗ rouge
  - Si relais AIS offline : mode dégradé Marine Nationale uniquement
