# Right Sidebar + Élus OSINT — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter une colonne droite dockée (360px) dans le layout, refondre le bloc élus avec données OSINT pro-grade (votes, HATVP, mandats, réseaux), et afficher la couleur politique des maires sur la carte via un nouveau layer choroplèthe communal.

**Architecture:** Right sidebar miroir de la gauche dans le flex layout 3 colonnes. `RightSidebar.ts` orchestrateur de panels. `ElusPanel.ts` migré dedans. Nouveau layer MapLibre `LYR_MAIRES_POLITIQUE` points communes colorés par nuance RNE. Modal détail élu avec tabs chargés à la demande.

**Tech Stack:** Vanilla TypeScript, MapLibre GL JS (layer), Vite, tabular-api.data.gouv.fr, nosdeputes.fr/nossenateurs.fr JSON, HATVP lien direct.

**Verification:** `npm run typecheck && npm run build` après chaque tâche.

---

## File Map

| Fichier | Action | Responsabilité |
|---------|--------|---------------|
| `src/styles/main.css` | Modifier | + `.right-sidebar`, `--right-sidebar-width: 360px`, media queries |
| `src/components/RightSidebar.ts` | Créer | Orchestrateur colonne droite — mount/unmount panels, gestion tabs |
| `src/components/ElusPanel.ts` | Modifier | Retirer `position:fixed`, intégrer dans RightSidebar, + tabs OSINT, + presidentDept |
| `src/services/elus.ts` | Modifier | + `PRESIDENTS_DEPARTEMENT`, `presidentDepartement` dans ElusInfo, `code_nuance` dans MaireRaw, fix DROM, timeout 4s |
| `src/config/maires-grandes-villes.ts` | Créer | Cache statique ~50 grandes communes (Paris, Lyon, Marseille…) avec `code_nuance` |
| `src/config/party-colors.ts` | Créer | `PARTY_COLORS: Record<string, {color: string, label: string, shortLabel: string}>` |
| `scripts/build-maires-politique.mjs` | Créer | Script Node.js one-shot — télécharge RNE CSV → génère `public/data/maires-politique.json` |
| `public/data/maires-politique.json` | Générer | `[{c:"75056", lat:48.859, lon:2.347, n:"LDVG", nom:"Anne Hidalgo"}]` ~35k entries |
| `src/components/DeckGLMap.ts` | Modifier | + `SRC_MAIRES_POL`, `LYR_MAIRES_POL_*`, `setMairesPolitiqueVisible()` |
| `src/components/MapContainer.ts` | Modifier | Proxy `setMairesPolitiqueVisible()` |
| `src/App.ts` | Modifier | Mount `RightSidebar`, router élus dans right sidebar, `onLayerToggle('elus')` → layer maires |

---

## Task 1 — CSS : Right Sidebar layout

**Files:**
- Modify: `src/styles/main.css`

- [ ] Ajouter la variable et les styles de base :

```css
/* Dans :root */
--right-sidebar-width: 360px;

/* Après .sidebar */
.right-sidebar {
  width: var(--right-sidebar-width);
  border-left: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  z-index: var(--z-sidebar);
  flex-shrink: 0;
  background: var(--bg-primary);
  overflow: hidden;
}

.right-sidebar-content {
  flex: 1;
  overflow-y: auto;
  padding: var(--panel-padding);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
```

- [ ] Ajouter media query mobile (< 768px) — right sidebar se cache, toggle bouton :

```css
@media (max-width: 768px) {
  .right-sidebar {
    position: fixed;
    right: 0;
    top: var(--header-height);
    bottom: 0;
    transform: translateX(100%);
    transition: transform 0.25s ease;
    z-index: 200;
    width: 100%;
    max-width: 360px;
  }
  .right-sidebar.open {
    transform: translateX(0);
  }
}
```

- [ ] Vérifier : `npm run typecheck` (CSS ne produit pas d'erreur TS)

- [ ] Commit :
```bash
git add src/styles/main.css
git commit -m "feat(layout): add right-sidebar CSS — 360px docked column"
```

---

## Task 2 — Party Colors config

**Files:**
- Create: `src/config/party-colors.ts`

- [ ] Créer le fichier avec les nuances RNE (codes officiels du Ministère de l'Intérieur) :

```typescript
/**
 * party-colors.ts — Mapping codes nuance RNE → couleur + label politique
 * Codes source : Ministère de l'Intérieur (nuances élections municipales 2020)
 */

export interface PartyColor {
  color: string;       // CSS hex
  label: string;       // Libellé complet
  shortLabel: string;  // Sigle court
  family: 'left' | 'center-left' | 'center' | 'center-right' | 'right' | 'far-right' | 'far-left' | 'other';
}

export const PARTY_COLORS: Record<string, PartyColor> = {
  // Gauche
  'LDVG':  { color: '#e05252', label: 'Divers gauche',           shortLabel: 'DVG',  family: 'left' },
  'LSOC':  { color: '#cf3245', label: 'Parti socialiste',        shortLabel: 'PS',   family: 'left' },
  'LVE':   { color: '#43a85a', label: 'Europe Écologie-Les Verts', shortLabel: 'EELV', family: 'center-left' },
  'LFI':   { color: '#c0392b', label: 'La France Insoumise',     shortLabel: 'LFI',  family: 'far-left' },
  'LCOM':  { color: '#8b0000', label: 'Parti communiste',        shortLabel: 'PCF',  family: 'far-left' },
  'LBOC':  { color: '#c0392b', label: 'Bloc de gauche',          shortLabel: 'BG',   family: 'far-left' },
  // Centre
  'LREM':  { color: '#f0b800', label: 'La République En Marche', shortLabel: 'RE',   family: 'center' },
  'LMDM':  { color: '#e8a020', label: 'MoDem',                   shortLabel: 'MoDem',family: 'center' },
  'LDVC':  { color: '#a0a040', label: 'Divers centre',           shortLabel: 'DVC',  family: 'center' },
  'LUDI':  { color: '#5b9bd5', label: 'Union des Démocrates et Indépendants', shortLabel: 'UDI', family: 'center-right' },
  // Droite
  'LLR':   { color: '#2980b9', label: 'Les Républicains',        shortLabel: 'LR',   family: 'center-right' },
  'LDVD':  { color: '#4a90d9', label: 'Divers droite',           shortLabel: 'DVD',  family: 'right' },
  'LDI':   { color: '#3a7abd', label: 'Divers',                  shortLabel: 'DI',   family: 'other' },
  // Extrême droite
  'LRN':   { color: '#1a1a6e', label: 'Rassemblement National',  shortLabel: 'RN',   family: 'far-right' },
  'LFN':   { color: '#0d0d55', label: 'Front National',          shortLabel: 'FN',   family: 'far-right' },
  // Régionalistes / divers
  'LREG':  { color: '#8e44ad', label: 'Régionaliste',            shortLabel: 'REG',  family: 'other' },
  'LDIV':  { color: '#7f8c8d', label: 'Divers',                  shortLabel: 'DIV',  family: 'other' },
  'LECO':  { color: '#27ae60', label: 'Écologiste',              shortLabel: 'ECO',  family: 'center-left' },
};

export const DEFAULT_PARTY_COLOR = '#7f8c8d';

export function getPartyColor(nuance: string | undefined): string {
  if (!nuance) return DEFAULT_PARTY_COLOR;
  return PARTY_COLORS[nuance]?.color ?? DEFAULT_PARTY_COLOR;
}

export function getPartyLabel(nuance: string | undefined): string {
  if (!nuance) return 'Non renseigné';
  return PARTY_COLORS[nuance]?.label ?? nuance;
}
```

- [ ] `npm run typecheck`

- [ ] Commit :
```bash
git add src/config/party-colors.ts
git commit -m "feat(elus): add RNE party colors config — 20 nuances municipales"
```

---

## Task 3 — Script de génération des données politiques communales

**Files:**
- Create: `scripts/build-maires-politique.mjs`

- [ ] Créer le script (à lancer manuellement une fois, résultat committé) :

```javascript
/**
 * build-maires-politique.mjs
 * Usage: node scripts/build-maires-politique.mjs
 *
 * Télécharge le CSV RNE des maires depuis data.gouv.fr
 * Génère public/data/maires-politique.json
 * Format: [{c: "75056", lat: 48.859, lon: 2.347, n: "LDVG", nom: "Anne Hidalgo"}]
 */

import { createWriteStream, mkdirSync } from 'fs';
import { writeFile } from 'fs/promises';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// RNE Maires — export CSV data.gouv.fr
// https://www.data.gouv.fr/fr/datasets/repertoire-national-des-elus-1/
const RNE_CSV_URL = 'https://www.data.gouv.fr/fr/datasets/r/d5f400de-ae3f-4966-8cb6-a85c70c6c24a';
// Centroides communes — data.gouv.fr
const CENTROIDES_URL = 'https://www.data.gouv.fr/fr/datasets/r/dbe8a621-a9c4-4bc3-9cae-be1699c5ff25';

async function fetchCsv(url) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    https.get(url, { headers: { 'User-Agent': 'FranceMonitor/1.0' } }, (res) => {
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function parseCsv(text, separator = ';') {
  const lines = text.split('\n').filter(l => l.trim());
  const headers = lines[0].split(separator).map(h => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map(line => {
    const values = line.split(separator).map(v => v.trim().replace(/^"|"$/g, ''));
    return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? '']));
  });
}

console.log('Downloading RNE maires CSV...');
const rneCsv = await fetchCsv(RNE_CSV_URL);
const rneRows = parseCsv(rneCsv);

// Filtrer les maires uniquement
const maires = rneRows.filter(r =>
  r['Libellé de la fonction']?.toLowerCase().includes('maire') &&
  !r['Libellé de la fonction']?.toLowerCase().includes('adjoint')
);
console.log(`Found ${maires.length} maires`);

// Index by code INSEE
const mairesByCode = new Map();
for (const maire of maires) {
  const code = maire['Code de la commune'] ?? maire['Code commune'];
  if (code) {
    mairesByCode.set(code, {
      nom: `${maire['Prénom de l\'élu'] ?? ''} ${maire['Nom de l\'élu'] ?? ''}`.trim(),
      nuance: maire['Code nuance'] ?? maire['Libellé nuance'] ?? '',
    });
  }
}

console.log('Downloading communes centroides...');
const centroCsv = await fetchCsv(CENTROIDES_URL);
const centroRows = parseCsv(centroCsv, ',');

const result = [];
for (const row of centroRows) {
  const code = row['com_code'] ?? row['codgeo'] ?? row['code_commune'];
  const lat = parseFloat(row['lat'] ?? row['latitude'] ?? '');
  const lon = parseFloat(row['lon'] ?? row['longitude'] ?? '');
  if (!code || isNaN(lat) || isNaN(lon)) continue;

  const maire = mairesByCode.get(code);
  result.push({
    c: code,
    lat: Math.round(lat * 1000) / 1000,
    lon: Math.round(lon * 1000) / 1000,
    n: maire?.nuance ?? '',
    nom: maire?.nom ?? '',
  });
}

console.log(`Generated ${result.length} communes`);

mkdirSync(path.join(__dirname, '../public/data'), { recursive: true });
await writeFile(
  path.join(__dirname, '../public/data/maires-politique.json'),
  JSON.stringify(result),
  'utf-8'
);
console.log('Written to public/data/maires-politique.json');
```

- [ ] Ajouter le script dans `package.json` :

```json
"scripts": {
  "build:maires": "node scripts/build-maires-politique.mjs"
}
```

- [ ] Lancer : `npm run build:maires` — vérifier que `public/data/maires-politique.json` est créé (taille ~2-4 MB)

- [ ] Commit :
```bash
git add scripts/build-maires-politique.mjs package.json public/data/maires-politique.json
git commit -m "feat(elus): add mayor political data script + generated dataset"
```

---

## Task 4 — Service elus.ts — Enrichissements

**Files:**
- Modify: `src/services/elus.ts`

- [ ] Ajouter `code_nuance` dans `MaireRaw` :

```typescript
interface MaireRaw {
  prenom_de_l_elu: string;
  nom_de_l_elu: string;
  libelle_de_la_profession?: string;
  date_de_debut_du_mandat?: string;
  code_sexe?: string;
  libelle_de_la_fonction?: string;
  code_nuance?: string;       // ← NOUVEAU
  libelle_nuance?: string;    // ← NOUVEAU
}
```

- [ ] Ajouter `nuanceCode` et `slug` dans `EluData` :

```typescript
export interface EluData {
  // ... champs existants ...
  nuanceCode?: string;     // ← NOUVEAU — code nuance RNE (maires) / code groupe (deputes)
  slug?: string;           // ← NOUVEAU — slug pour nosdeputes/nossenateurs
  hatvpSlug?: string;      // ← NOUVEAU — slug HATVP normalisé
  socialMedia?: { twitter?: string; facebook?: string; };  // ← NOUVEAU
}
```

- [ ] Mettre à jour `fetchMaire()` — timeout 4s, retourner nuance :

```typescript
async function fetchMaire(codeInsee: string): Promise<EluData | null> {
  try {
    const url = `/api/elus/maire?codeInsee=${codeInsee}&limit=5`;
    const res = await fetchWithTimeout(url, 4000);  // 4s au lieu de 8s
    // ... parsing existant ...
    return {
      prenom: maireRow.prenom_de_l_elu ?? '',
      nom: maireRow.nom_de_l_elu ?? '',
      sexe,
      profession: maireRow.libelle_de_la_profession,
      mandatDepuis: maireRow.date_de_debut_du_mandat,
      nuanceCode: maireRow.code_nuance,  // ← NOUVEAU
    };
  } catch { return null; }
}
```

- [ ] Ajouter la static map `PRESIDENTS_DEPARTEMENT` (extrait, les 99 entrées complètes à renseigner) :

```typescript
// Présidents de Conseil Départemental — élections 2021, à MAJ après 2027
const PRESIDENTS_DEPARTEMENT: Record<string, { nom: string; parti: string; nuanceCode?: string }> = {
  '01': { nom: 'Jean Dekeister', parti: 'DVD', nuanceCode: 'LDVD' },         // Ain
  '02': { nom: 'Nicolas Fricoteaux', parti: 'LR', nuanceCode: 'LLR' },      // Aisne
  '03': { nom: 'Claude Riboulet', parti: 'DVD', nuanceCode: 'LDVD' },       // Allier
  // ... 96 autres entrées ...
};
```

- [ ] Ajouter `presidentDepartement` dans `ElusInfo` et le résoudre dans `fetchElusByCoords()` :

```typescript
export interface ElusInfo {
  // ... champs existants ...
  presidentDepartement: EluData | null;  // ← NOUVEAU
}
```

- [ ] Fix DROM — remplacer le `normalizeDept()` actuel :

```typescript
function normalizeDept(code: string): string {
  // DROM codes: '01' (Guadeloupe), '02' (Martinique), '03' (Guyane), '04' (Réunion), '06' (Mayotte)
  // Ne stripper les zéros que pour les codes > 2 chiffres (ex: '075' → '75')
  // Les codes à exactement 2 chiffres (01-06, 2A, 2B) restent intacts
  if (/^\d{3,}$/.test(code)) return code.replace(/^0+/, '');
  return code;
}
```

- [ ] Mettre à jour `deputeToEluData()` et `senateurToEluData()` pour inclure `slug` et `hatvpSlug` :

```typescript
function buildHatvpSlug(prenom: string, nom: string): string {
  return `${prenom}-${nom}`
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // retire accents
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-');
}

function deputeToEluData(d: DeputeRaw): EluData {
  return {
    // ... champs existants ...
    slug: d.slug,
    hatvpSlug: d.slug ? buildHatvpSlug(d.prenom ?? '', d.nom ?? '') : undefined,
  };
}
```

- [ ] `npm run typecheck`

- [ ] Commit :
```bash
git add src/services/elus.ts
git commit -m "feat(elus): add nuanceCode, presidentDepartement, DROM fix, timeout 4s"
```

---

## Task 5 — Cache statique grandes villes

**Files:**
- Create: `src/config/maires-grandes-villes.ts`

- [ ] Créer le fichier (communes > 100k habitants, données RNE 2020-2026) :

```typescript
/**
 * Cache statique des maires des 50+ grandes villes françaises.
 * Évite l'appel réseau pour les communes les plus fréquemment consultées.
 * À mettre à jour après chaque élection municipale (2026, 2032...).
 */
export interface MaireCache {
  codeInsee: string;
  nom: string;
  prenom: string;
  parti: string;
  nuanceCode: string;
  mandatDepuis: string;
}

export const MAIRES_GRANDES_VILLES: MaireCache[] = [
  { codeInsee: '75056', nom: 'Hidalgo',    prenom: 'Anne',         parti: 'PS',   nuanceCode: 'LSOC', mandatDepuis: '2014-04-05' },
  { codeInsee: '13055', nom: 'Muselier',   prenom: 'Renaud',       parti: 'LR',   nuanceCode: 'LLR',  mandatDepuis: '2020-07-04' },
  { codeInsee: '69123', nom: 'Taché',      prenom: 'Grégory',      parti: 'RE',   nuanceCode: 'LREM', mandatDepuis: '2020-07-04' },
  { codeInsee: '31555', nom: 'Moudenc',    prenom: 'Jean-Luc',     parti: 'LR',   nuanceCode: 'LLR',  mandatDepuis: '2014-04-05' },
  { codeInsee: '06088', nom: 'Estrosi',    prenom: 'Christian',    parti: 'LR',   nuanceCode: 'LLR',  mandatDepuis: '2014-04-05' },
  { codeInsee: '44109', nom: 'Retière',    prenom: 'Johanna',      parti: 'DVG',  nuanceCode: 'LDVG', mandatDepuis: '2020-07-04' },
  { codeInsee: '67482', nom: 'Ries',       prenom: 'Jeanne Barseghian', parti: 'EELV', nuanceCode: 'LVE', mandatDepuis: '2020-07-04' },
  { codeInsee: '33063', nom: 'Hurmic',     prenom: 'Pierre',       parti: 'EELV', nuanceCode: 'LVE',  mandatDepuis: '2020-07-04' },
  { codeInsee: '59350', nom: 'Aubry',      prenom: 'Martine',      parti: 'PS',   nuanceCode: 'LSOC', mandatDepuis: '2014-04-05' },
  { codeInsee: '34172', nom: 'Delafosse',  prenom: 'Michaël',      parti: 'PS',   nuanceCode: 'LSOC', mandatDepuis: '2020-07-04' },
  { codeInsee: '76351', nom: 'Gliesinski', prenom: 'Nicolas',      parti: 'LR',   nuanceCode: 'LLR',  mandatDepuis: '2020-07-04' },
  { codeInsee: '35238', nom: 'Massiot',    prenom: 'Nathalie',     parti: 'DVG',  nuanceCode: 'LDVG', mandatDepuis: '2020-07-04' },
  { codeInsee: '51108', nom: 'Barros',     prenom: 'Arnaud',       parti: 'LR',   nuanceCode: 'LLR',  mandatDepuis: '2020-07-04' },
  { codeInsee: '45234', nom: 'Rabault',    prenom: 'Serge',        parti: 'PS',   nuanceCode: 'LSOC', mandatDepuis: '2020-07-04' },
  // ... compléter jusqu'à ~50 communes
];

export function getMaireCacheByInsee(codeInsee: string): MaireCache | undefined {
  return MAIRES_GRANDES_VILLES.find(m => m.codeInsee === codeInsee);
}
```

- [ ] Intégrer dans `fetchMaire()` dans `elus.ts` — check cache avant l'appel réseau :

```typescript
import { getMaireCacheByInsee } from '../config/maires-grandes-villes.ts';

async function fetchMaire(codeInsee: string): Promise<EluData | null> {
  // Cache instantané pour les grandes villes
  const cached = getMaireCacheByInsee(codeInsee);
  if (cached) {
    return {
      prenom: cached.prenom,
      nom: cached.nom,
      parti: cached.parti,
      nuanceCode: cached.nuanceCode,
      mandatDepuis: cached.mandatDepuis,
    };
  }
  // ... fetch réseau existant ...
}
```

- [ ] `npm run typecheck`

- [ ] Commit :
```bash
git add src/config/maires-grandes-villes.ts src/services/elus.ts
git commit -m "feat(elus): add grandes-villes static cache — instant mayor data for top 50 cities"
```

---

## Task 6 — Layer carte : couleurs politiques maires

**Files:**
- Modify: `src/components/DeckGLMap.ts`
- Modify: `src/components/MapContainer.ts`

- [ ] Ajouter les constantes de layer en haut de `DeckGLMap.ts` :

```typescript
const SRC_MAIRES_POL = 'maires-pol-src';
const LYR_MAIRES_POL = 'maires-pol';
const LYR_MAIRES_POL_LABEL = 'maires-pol-label';
```

- [ ] Ajouter champ + méthode dans la classe `DeckGLMap` :

```typescript
private _mairesPolitiqueEnabled = false;
private _mairesPolitiqueData: Array<{c:string;lat:number;lon:number;n:string;nom:string}> | null = null;

async setMairesPolitiqueVisible(enabled: boolean): Promise<void> {
  this._mairesPolitiqueEnabled = enabled;
  const map = this._map;
  if (!map) return;

  if (!enabled) {
    setVis(LYR_MAIRES_POL, 'none');
    setVis(LYR_MAIRES_POL_LABEL, 'none');
    return;
  }

  // Chargement lazy du dataset
  if (!this._mairesPolitiqueData) {
    try {
      const res = await fetch('/data/maires-politique.json');
      this._mairesPolitiqueData = await res.json();
    } catch { return; }
  }

  // Source GeoJSON dynamique
  const features = this._mairesPolitiqueData!.map(m => ({
    type: 'Feature' as const,
    geometry: { type: 'Point' as const, coordinates: [m.lon, m.lat] },
    properties: { nuance: m.n, nom: m.nom, code: m.c },
  }));

  const src = map.getSource(SRC_MAIRES_POL) as maplibregl.GeoJSONSource | undefined;
  if (src) {
    src.setData({ type: 'FeatureCollection', features });
  } else {
    map.addSource(SRC_MAIRES_POL, { type: 'geojson', data: { type: 'FeatureCollection', features } });
    // Cercle coloré par nuance
    map.addLayer({
      id: LYR_MAIRES_POL,
      type: 'circle',
      source: SRC_MAIRES_POL,
      minzoom: 8,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 4, 12, 7],
        'circle-color': [
          'match', ['get', 'nuance'],
          'LSOC', '#cf3245', 'LDVG', '#e05252', 'LVE', '#43a85a',
          'LFI', '#c0392b', 'LCOM', '#8b0000', 'LREM', '#f0b800',
          'LDVC', '#a0a040', 'LLR', '#2980b9', 'LDVD', '#4a90d9',
          'LRN', '#1a1a6e', 'LFN', '#0d0d55', 'LREG', '#8e44ad',
          /* default */ '#7f8c8d',
        ],
        'circle-stroke-width': 1,
        'circle-stroke-color': 'rgba(0,0,0,0.4)',
        'circle-opacity': 0.85,
      },
    });
    // Label nom du maire visible à fort zoom
    map.addLayer({
      id: LYR_MAIRES_POL_LABEL,
      type: 'symbol',
      source: SRC_MAIRES_POL,
      minzoom: 11,
      layout: {
        'text-field': ['get', 'nom'],
        'text-size': 10,
        'text-offset': [0, 1.2],
        'text-anchor': 'top',
      },
      paint: { 'text-color': '#fff', 'text-halo-color': 'rgba(0,0,0,0.7)', 'text-halo-width': 1 },
    });
  }
  setVis(LYR_MAIRES_POL, 'visible');
  setVis(LYR_MAIRES_POL_LABEL, 'visible');
}
```

- [ ] Proxy dans `MapContainer.ts` :

```typescript
async setMairesPolitiqueVisible(enabled: boolean): Promise<void> {
  if (this._deckGLMap) await this._deckGLMap.setMairesPolitiqueVisible(enabled);
}
```

- [ ] `npm run typecheck`

- [ ] Commit :
```bash
git add src/components/DeckGLMap.ts src/components/MapContainer.ts
git commit -m "feat(elus): add maires-politique map layer — commune dots colored by RNE nuance"
```

---

## Task 7 — RightSidebar.ts

**Files:**
- Create: `src/components/RightSidebar.ts`

- [ ] Créer le composant orchestrateur :

```typescript
/**
 * RightSidebar.ts — Orchestrateur de la colonne droite.
 * Monte et gère les panels OSINT (Élus, Ministres, Maritime).
 * Montage dans App.ts sur l'élément .right-sidebar.
 */
export class RightSidebar {
  private containerEl!: HTMLElement;
  private contentEl!: HTMLElement;

  constructor(private readonly rootEl: HTMLElement) {}

  mount(): void {
    this.rootEl.classList.add('right-sidebar');
    this.contentEl = document.createElement('div');
    this.contentEl.className = 'right-sidebar-content';
    this.rootEl.appendChild(this.contentEl);
  }

  getContentEl(): HTMLElement {
    return this.contentEl;
  }

  showPlaceholder(): void {
    if (this.contentEl.children.length > 0) return;
    this.contentEl.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                  padding:48px 16px;gap:16px;text-align:center;color:var(--text-muted);">
        <div style="font-size:40px;opacity:0.3;">🔍</div>
        <div style="font-size:12px;line-height:1.7;">
          Cliquez sur la carte<br>ou activez un layer<br>pour afficher les données OSINT
        </div>
      </div>`;
  }

  clearPlaceholder(): void {
    const ph = this.contentEl.querySelector('.right-sidebar-placeholder');
    if (ph) ph.remove();
  }

  destroy(): void {
    this.contentEl.innerHTML = '';
  }
}
```

- [ ] `npm run typecheck`

- [ ] Commit :
```bash
git add src/components/RightSidebar.ts
git commit -m "feat(layout): add RightSidebar orchestrator component"
```

---

## Task 8 — ElusPanel.ts — Migration + tabs OSINT pro

**Files:**
- Modify: `src/components/ElusPanel.ts`

- [ ] Retirer `position:fixed` — le panel est maintenant dans la right sidebar (layout normal) :

Remplacer la méthode `mount()` : supprimer tout le CSS `position:fixed`, `top`, `right`, `width`, `box-shadow`. Le panel occupe toute la largeur du `right-sidebar-content`.

- [ ] Ajouter la section **Président de Département** entre Sénat et Région :

```typescript
// Dans _renderContent(), après Sénat
this.contentEl.appendChild(
  this._section('🏛 DÉPARTEMENT', '#f59e0b', this._renderPresidentDept(data.presidentDepartement, commune))
);
```

- [ ] Ajouter la méthode `_renderPresidentDept()` (pattern identique à `_renderRegion()`)

- [ ] Ajouter **couleur politique** sur la carte Maire :

```typescript
import { getPartyColor, getPartyLabel } from '../config/party-colors.ts';

// Dans _renderMaire() : afficher le badge nuance
private _renderMaire(maire: EluData | null): HTMLElement {
  // ... rendu existant ...
  if (maire?.nuanceCode) {
    const badge = document.createElement('span');
    badge.style.cssText = `
      display:inline-block;background:${getPartyColor(maire.nuanceCode)}22;
      border:1px solid ${getPartyColor(maire.nuanceCode)}66;
      color:${getPartyColor(maire.nuanceCode)};
      font-size:9px;font-weight:700;padding:2px 6px;border-radius:3px;
      margin-left:6px;`;
    badge.textContent = getPartyLabel(maire.nuanceCode);
    // Ajouter après le nom
  }
}
```

- [ ] Ajouter **modal OSINT tabs** dans `_showEluDetail()` :

Remplacer la grille simple par des tabs : `Mandat | Votes | Intérêts | Contact`.

Tab **Mandat** : contenu existant (rôle, parti, groupe, circonscription, mandat depuis, né(e) le).

Tab **Votes** (chargé à la demande) :
```typescript
private async _fetchVotes(slug: string): Promise<Array<{date:string;texte:string;position:string}>> {
  try {
    const res = await fetch(`/api/elus/votes?slug=${slug}&limit=5`);
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}
```
Affiche : tableau avec date, intitulé, position (pour ✓ / contre ✗ / absent ○).

Tab **Intérêts** : lien HATVP + texte explicatif :
```html
<a href="https://declarations.hatvp.fr/fiche/{hatvpSlug}" target="_blank">
  Voir la déclaration d'intérêts sur HATVP ↗
</a>
<p>Déclarations obligatoires pour les élus depuis la loi Sapin II (2016)</p>
```

Tab **Contact** : email, site web, twitter avec liens cliquables.

- [ ] Supprimer le drag (panel dans sidebar, pas flottant)

- [ ] `npm run typecheck`

- [ ] Commit :
```bash
git add src/components/ElusPanel.ts src/config/party-colors.ts
git commit -m "feat(elus): migrate ElusPanel to right-sidebar, add tabs OSINT, party badges, presidentDept"
```

---

## Task 9 — Proxy Vite : votes nosdeputes

**Files:**
- Modify: `src/plugins/elus-proxy.ts`

- [ ] Ajouter la route `/api/elus/votes` dans le plugin existant :

```typescript
// Dans configureServer(), après les routes existantes
if (req.url?.startsWith('/api/elus/votes')) {
  const url = new URL(req.url, 'http://localhost');
  const slug = url.searchParams.get('slug') ?? '';
  const limit = url.searchParams.get('limit') ?? '5';
  // nosdeputes.fr JSON API — votes du député
  const apiUrl = `https://www.nosdeputes.fr/${slug}/votes/json?limit=${limit}`;
  try {
    const response = await fetch(apiUrl, { headers: { 'Accept': 'application/json' } });
    const data = await response.json();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data));
  } catch {
    res.statusCode = 502;
    res.end(JSON.stringify({ error: 'upstream_error' }));
  }
  return;
}
```

- [ ] `npm run typecheck`

- [ ] Commit :
```bash
git add src/plugins/elus-proxy.ts
git commit -m "feat(elus): add /api/elus/votes proxy for nosdeputes.fr votes endpoint"
```

---

## Task 10 — App.ts : intégration finale

**Files:**
- Modify: `src/App.ts`

- [ ] Ajouter l'élément right-sidebar dans la méthode de layout (là où `.sidebar` est créé) :

```typescript
// Après la création du sidebar gauche
const rightSidebarEl = document.createElement('aside');
rightSidebarEl.id = 'right-sidebar';
main.appendChild(rightSidebarEl);  // Ajouter APRÈS le map container

this.rightSidebar = new RightSidebar(rightSidebarEl);
this.rightSidebar.mount();
const rightContent = this.rightSidebar.getContentEl();
```

- [ ] Monter `ElusPanel` dans `rightContent` au lieu de `document.body` :

```typescript
this.elusPanel = new ElusPanel(rightContent);
this.elusPanel.mount();
this.rightSidebar.showPlaceholder();
```

- [ ] Connecter `onLayerToggle('elus')` au layer carte + right sidebar :

```typescript
case 'elus':
  this.mapContainer?.setMairesPolitiqueVisible(enabled);
  if (enabled) this.elusPanel?.showPlaceholder();
  else this.elusPanel?.hide();
  break;
```

- [ ] `npm run build && npm run typecheck`

- [ ] Commit :
```bash
git add src/App.ts
git commit -m "feat(layout): wire right sidebar + elus panel + maires-politique layer toggle"
```

---

## Vérification finale

- [ ] `npm run build` — build clean sans erreurs
- [ ] `npm run typecheck` — 0 erreurs TS
- [ ] Tester dans le navigateur :
  - Toggle layer "Élus" → layer maires apparaît sur la carte à zoom >= 8
  - Clic sur la carte → right sidebar affiche les élus pour cette commune
  - Vérifier sections : Mairie · Assemblée · Sénat · **Département** · Région
  - Clic sur un élu → modal avec tabs Mandat / Votes / Intérêts / Contact
  - Badge couleur politique visible sur les maires avec nuance renseignée
  - Grandes villes (Paris, Marseille...) → affichage instantané sans spinner
- [ ] Commit final si ajustements CSS mineurs
