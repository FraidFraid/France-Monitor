# Ministres par Portefeuille — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Afficher dans la right sidebar les ministres compétents selon le contexte (layer actif, article sélectionné), avec un modal OSINT complet par ministre (biographie, RSS agenda, HATVP, cabinet, réseaux sociaux).

**Architecture:** `src/config/government.ts` source statique du gouvernement. `src/services/ministers.ts` logique de mapping catégorie→ministre + enrichissement async Wikidata. `MinistresPanel.ts` section right sidebar avec cards cliquables. Le Premier Ministre est toujours visible en tête. Déclenchement contextuel via `App.ts` sur `onArticleSelected` et `onLayerToggle`.

**Tech Stack:** Vanilla TypeScript, Vite, Wikidata REST API (enrichissement async), france.gouv.fr RSS (agenda), HATVP lien direct.

**Verification:** `npm run typecheck && npm run build` après chaque tâche.

---

## File Map

| Fichier | Action | Responsabilité |
|---------|--------|---------------|
| `src/config/government.ts` | Créer | Liste statique gouvernement + mapping catégories + couleurs parti |
| `src/services/ministers.ts` | Créer | `getMinistersForContext()`, enrichissement Wikidata async, cache, RSS agenda |
| `src/components/MinistresPanel.ts` | Créer | Section right sidebar, cards PM + ministres, modal OSINT détail |
| `src/plugins/ministers-proxy.ts` | Créer | Proxy Vite `/api/ministers/wikidata`, `/api/ministers/agenda` |
| `src/types/index.ts` | Modifier | + interface `Minister` exportée |
| `src/components/RightSidebar.ts` | Modifier | Monter `MinistresPanel` |
| `src/App.ts` | Modifier | Écouter `onArticleSelected`, notifier `MinistresPanel.setContext()` |

---

## Task 1 — government.ts : source statique

**Files:**
- Create: `src/config/government.ts`

- [ ] Créer la config complète du gouvernement (Bayrou, mars 2026) :

```typescript
/**
 * government.ts — Composition du gouvernement français.
 * Source : france.gouv.fr — Gouvernement Bayrou (janv. 2025→)
 * À mettre à jour manuellement après chaque remaniement.
 * Dernier contrôle : 2026-03-24
 */

import type { EventCategory } from '../types/index.ts';

export interface Minister {
  id: string;                    // Slug unique stable
  prenom: string;
  nom: string;
  titre: string;                 // Titre officiel complet
  titreShort: string;            // Libellé court pour les badges
  isPM?: boolean;                // true pour le Premier Ministre
  photoUrl?: string;             // Photo officielle france.gouv.fr ou Wikidata
  wikidataId?: string;           // Q-code pour enrichissement async
  parti?: string;
  nuanceCode?: string;           // Code nuance RNE (cohérence avec PARTY_COLORS)
  dateNomination?: string;       // ISO date
  emailCabinet?: string;         // Contact cabinet (public)
  siteMinistere?: string;        // URL du ministère
  rssUrl?: string;               // RSS communiqués/agenda officiel
  twitter?: string;              // Handle sans @
  categories: EventCategory[];   // Catégories d'événements liées
  portefeuilles: string[];       // Mots-clés domaines
}

export const GOUVERNEMENT: Minister[] = [
  {
    id: 'pm',
    prenom: 'François', nom: 'Bayrou',
    titre: 'Premier Ministre',
    titreShort: 'Premier Ministre',
    isPM: true,
    wikidataId: 'Q290654',
    parti: 'MoDem', nuanceCode: 'LMDM',
    dateNomination: '2025-01-13',
    siteMinistere: 'https://www.gouvernement.fr',
    rssUrl: 'https://www.gouvernement.fr/flux-rss/actualites',
    twitter: 'bayrou',
    categories: ['energy','transport','social','security','health','finance','floods','fires','cyber','weather'],
    portefeuilles: ['premier ministre', 'gouvernement', 'premier ministre'],
  },
  {
    id: 'min-interieur',
    prenom: 'Bruno', nom: 'Retailleau',
    titre: 'Ministre de l\'Intérieur',
    titreShort: 'Intérieur',
    wikidataId: 'Q3039963',
    parti: 'LR', nuanceCode: 'LLR',
    dateNomination: '2024-09-23',
    siteMinistere: 'https://www.interieur.gouv.fr',
    rssUrl: 'https://www.interieur.gouv.fr/rss/actualites',
    twitter: 'brunoretailleau',
    categories: ['security', 'fires'],
    portefeuilles: ['sécurité', 'police', 'gendarmerie', 'immigration', 'terrorisme', 'incendie'],
  },
  {
    id: 'min-economie',
    prenom: 'Éric', nom: 'Lombard',
    titre: 'Ministre de l\'Économie, des Finances et de la Souveraineté industrielle',
    titreShort: 'Économie',
    wikidataId: 'Q55701624',
    parti: 'Ind.',
    dateNomination: '2025-01-13',
    siteMinistere: 'https://www.economie.gouv.fr',
    rssUrl: 'https://www.economie.gouv.fr/rss/actualites',
    twitter: 'EricLombard2025',
    categories: ['finance'],
    portefeuilles: ['économie', 'finances', 'bourse', 'cac40', 'budget', 'fiscalité', 'industrie'],
  },
  {
    id: 'min-affaires-etrangeres',
    prenom: 'Jean-Noël', nom: 'Barrot',
    titre: 'Ministre de l\'Europe et des Affaires étrangères',
    titreShort: 'Affaires étrangères',
    wikidataId: 'Q55700745',
    parti: 'MoDem', nuanceCode: 'LMDM',
    dateNomination: '2024-09-23',
    siteMinistere: 'https://www.diplomatie.gouv.fr',
    rssUrl: 'https://www.diplomatie.gouv.fr/fr/rss/actualites.xml',
    twitter: 'jnbarrot',
    categories: ['security', 'cyber'],
    portefeuilles: ['diplomatie', 'europe', 'affaires étrangères', 'international'],
  },
  {
    id: 'min-ecologie',
    prenom: 'Agnès', nom: 'Pannier-Runacher',
    titre: 'Ministre de la Transition écologique, de l\'Énergie, du Climat et de la Prévention des risques',
    titreShort: 'Énergie & Écologie',
    wikidataId: 'Q55699974',
    parti: 'RE', nuanceCode: 'LREM',
    dateNomination: '2025-01-13',
    siteMinistere: 'https://www.ecologie.gouv.fr',
    rssUrl: 'https://www.ecologie.gouv.fr/rss/actualites',
    twitter: 'AgnesRunacher',
    categories: ['energy', 'weather', 'floods', 'fires'],
    portefeuilles: ['énergie', 'électricité', 'nucléaire', 'écologie', 'crues', 'inondations', 'feux', 'ecowatt', 'rte', 'transition énergétique'],
  },
  {
    id: 'min-travail',
    prenom: 'Astrid', nom: 'Panosyan-Bouvet',
    titre: 'Ministre du Travail et de l\'Emploi',
    titreShort: 'Travail',
    wikidataId: 'Q55701621',
    parti: 'RE', nuanceCode: 'LREM',
    dateNomination: '2025-01-13',
    siteMinistere: 'https://travail-emploi.gouv.fr',
    rssUrl: 'https://travail-emploi.gouv.fr/rss/actualites',
    categories: ['social'],
    portefeuilles: ['travail', 'emploi', 'grève', 'syndicat', 'chômage', 'retraite'],
  },
  {
    id: 'min-sante',
    prenom: 'Yannick', nom: 'Neuder',
    titre: 'Ministre chargé de la Santé et de l\'Accès aux soins',
    titreShort: 'Santé',
    wikidataId: 'Q112765428',
    parti: 'LR', nuanceCode: 'LLR',
    dateNomination: '2025-01-13',
    siteMinistere: 'https://sante.gouv.fr',
    rssUrl: 'https://sante.gouv.fr/rss/actualites',
    twitter: 'YannickNeuder',
    categories: ['health'],
    portefeuilles: ['santé', 'hôpital', 'médecin', 'épidémie', 'covid', 'urgences', 'soins', 'médicament'],
  },
  {
    id: 'min-transports',
    prenom: 'Philippe', nom: 'Tabarot',
    titre: 'Ministre des Transports',
    titreShort: 'Transports',
    wikidataId: 'Q3379978',
    parti: 'LR', nuanceCode: 'LLR',
    dateNomination: '2025-01-13',
    siteMinistere: 'https://www.transports.gouv.fr',
    rssUrl: 'https://www.transports.gouv.fr/rss/actualites',
    twitter: 'philippetabarot',
    categories: ['transport'],
    portefeuilles: ['transports', 'sncf', 'ratp', 'train', 'avion', 'autoroute', 'trafic', 'routier'],
  },
  {
    id: 'min-numerique',
    prenom: 'Clara', nom: 'Chappaz',
    titre: 'Secrétaire d\'État chargée de l\'Intelligence artificielle et du Numérique',
    titreShort: 'Numérique & IA',
    wikidataId: 'Q112766789',
    parti: 'RE', nuanceCode: 'LREM',
    dateNomination: '2025-01-13',
    siteMinistere: 'https://www.economie.gouv.fr/numerique',
    twitter: 'clarachappaz',
    categories: ['cyber'],
    portefeuilles: ['cyber', 'numérique', 'internet', 'ia', 'données', 'cert-fr', 'anssi'],
  },
  {
    id: 'min-defense',
    prenom: 'Sébastien', nom: 'Lecornu',
    titre: 'Ministre des Armées',
    titreShort: 'Armées',
    wikidataId: 'Q51791861',
    parti: 'RE', nuanceCode: 'LREM',
    dateNomination: '2022-07-04',
    siteMinistere: 'https://www.defense.gouv.fr',
    rssUrl: 'https://www.defense.gouv.fr/rss/actualites',
    twitter: 'SebLecornu',
    categories: ['security'],
    portefeuilles: ['défense', 'armée', 'militaire', 'marine', 'aviation', 'otan', 'renseignement'],
  },
];

// ─── Mapping rapide catégorie → ministres ─────────────────────────────────────

export function getMinistersForCategories(categories: EventCategory[]): Minister[] {
  if (categories.length === 0) return [getPM()];
  const seen = new Set<string>();
  const result: Minister[] = [];
  // PM toujours en premier
  const pm = getPM();
  if (pm) { seen.add(pm.id); result.push(pm); }
  for (const cat of categories) {
    for (const minister of GOUVERNEMENT) {
      if (minister.isPM) continue;
      if (!seen.has(minister.id) && minister.categories.includes(cat)) {
        seen.add(minister.id);
        result.push(minister);
      }
    }
  }
  return result;
}

export function getPM(): Minister {
  return GOUVERNEMENT.find(m => m.isPM)!;
}

export function getMinisterById(id: string): Minister | undefined {
  return GOUVERNEMENT.find(m => m.id === id);
}
```

- [ ] `npm run typecheck`

- [ ] Commit :
```bash
git add src/config/government.ts
git commit -m "feat(ministers): add government.ts — full Bayrou cabinet config with categories"
```

---

## Task 2 — types/index.ts : interface Minister

**Files:**
- Modify: `src/types/index.ts`

- [ ] Ajouter `EventCategory` et ré-exporter `Minister` :

```typescript
// Dans src/types/index.ts
export type EventCategory = 'energy' | 'transport' | 'weather' | 'social' | 'security' |
                             'health' | 'finance' | 'floods' | 'fires' | 'cyber';
```

(L'interface `Minister` reste dans `government.ts` — pas besoin de la dupliquer dans `types/index.ts`)

- [ ] `npm run typecheck`

- [ ] Commit :
```bash
git add src/types/index.ts
git commit -m "feat(types): export EventCategory type"
```

---

## Task 3 — ministers.ts : service enrichissement

**Files:**
- Create: `src/services/ministers.ts`

- [ ] Créer le service :

```typescript
/**
 * ministers.ts — Enrichissement async des fiches ministres.
 * Sources : Wikidata (biographie, photo HD), RSS agenda ministère.
 * Tout est mis en cache (Wikidata 24h, RSS 30min).
 */

import { getMinistersForCategories, GOUVERNEMENT, type Minister } from '../config/government.ts';
import type { EventCategory } from '../types/index.ts';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MinisterEnriched extends Minister {
  bioShort?: string;          // Description FR Wikidata (~2 phrases)
  photoHd?: string;           // URL image HD Wikidata
  agendaItems?: AgendaItem[]; // 3 derniers communiqués RSS
  wikidataLoaded?: boolean;
}

export interface AgendaItem {
  title: string;
  date: string;
  url?: string;
}

// ─── Cache ────────────────────────────────────────────────────────────────────

const wikidataCache = new Map<string, { data: Partial<MinisterEnriched>; ts: number }>();
const rssCache = new Map<string, { items: AgendaItem[]; ts: number }>();
const TTL_WIKIDATA = 24 * 60 * 60 * 1000;
const TTL_RSS = 30 * 60 * 1000;

// ─── Wikidata enrichissement ──────────────────────────────────────────────────

export async function enrichMinisterFromWikidata(minister: Minister): Promise<Partial<MinisterEnriched>> {
  if (!minister.wikidataId) return {};
  const cached = wikidataCache.get(minister.wikidataId);
  if (cached && Date.now() - cached.ts < TTL_WIKIDATA) return cached.data;

  try {
    const url = `/api/ministers/wikidata?id=${minister.wikidataId}`;
    const res = await fetch(url);
    if (!res.ok) return {};
    const entity = await res.json();
    const claims = entity?.claims ?? {};
    const descriptions = entity?.descriptions ?? {};

    const bioShort = descriptions?.fr?.value ?? descriptions?.en?.value;

    // Image P18
    let photoHd: string | undefined;
    const imageClaim = claims?.P18?.[0]?.mainsnak?.datavalue?.value;
    if (imageClaim) {
      const filename = encodeURIComponent(imageClaim.replace(/ /g, '_'));
      photoHd = `https://commons.wikimedia.org/wiki/Special:FilePath/${filename}?width=200`;
    }

    const data: Partial<MinisterEnriched> = { bioShort, photoHd, wikidataLoaded: true };
    wikidataCache.set(minister.wikidataId, { data, ts: Date.now() });
    return data;
  } catch {
    return {};
  }
}

// ─── RSS agenda ───────────────────────────────────────────────────────────────

export async function fetchMinisterAgenda(minister: Minister): Promise<AgendaItem[]> {
  if (!minister.rssUrl) return [];
  const cached = rssCache.get(minister.id);
  if (cached && Date.now() - cached.ts < TTL_RSS) return cached.items;

  try {
    const url = `/api/ministers/agenda?id=${minister.id}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const items: AgendaItem[] = await res.json();
    rssCache.set(minister.id, { items, ts: Date.now() });
    return items;
  } catch { return []; }
}

// ─── API publique ─────────────────────────────────────────────────────────────

export { getMinistersForCategories, GOUVERNEMENT };

export async function getMinistersEnrichedForContext(categories: EventCategory[]): Promise<MinisterEnriched[]> {
  const ministers = getMinistersForCategories(categories);
  // Enrichissement en parallèle (non bloquant — on retourne la base d'abord)
  return ministers.map(m => ({ ...m }));
}

export async function getFullMinisterProfile(minister: Minister): Promise<MinisterEnriched> {
  const [wikidata, agenda] = await Promise.allSettled([
    enrichMinisterFromWikidata(minister),
    fetchMinisterAgenda(minister),
  ]);
  return {
    ...minister,
    ...(wikidata.status === 'fulfilled' ? wikidata.value : {}),
    agendaItems: agenda.status === 'fulfilled' ? agenda.value : [],
  };
}
```

- [ ] `npm run typecheck`

- [ ] Commit :
```bash
git add src/services/ministers.ts
git commit -m "feat(ministers): add ministers service — Wikidata enrichment + RSS agenda cache"
```

---

## Task 4 — Proxy Vite : Wikidata + RSS agenda

**Files:**
- Create: `src/plugins/ministers-proxy.ts`

- [ ] Créer le plugin :

```typescript
import type { Plugin } from 'vite';
import { GOUVERNEMENT } from '../src/config/government.ts';

export function ministersProxyPlugin(): Plugin {
  return {
    name: 'ministers-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/ministers/')) return next();

        const url = new URL(req.url, 'http://localhost');

        // ── Wikidata entity ──
        if (req.url.startsWith('/api/ministers/wikidata')) {
          const id = url.searchParams.get('id') ?? '';
          if (!id) { res.statusCode = 400; res.end('{}'); return; }
          try {
            const apiUrl = `https://www.wikidata.org/wiki/Special:EntityData/${id}.json`;
            const r = await fetch(apiUrl, { headers: { 'Accept': 'application/json' } });
            const data = await r.json();
            const entity = data?.entities?.[id] ?? {};
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(entity));
          } catch { res.statusCode = 502; res.end('{}'); }
          return;
        }

        // ── RSS agenda ministère ──
        if (req.url.startsWith('/api/ministers/agenda')) {
          const ministerId = url.searchParams.get('id') ?? '';
          const minister = GOUVERNEMENT.find(m => m.id === ministerId);
          if (!minister?.rssUrl) { res.end('[]'); return; }
          try {
            const r = await fetch(minister.rssUrl, { headers: { 'Accept': 'application/rss+xml, text/xml' } });
            const xml = await r.text();
            // Parse RSS items — extraction basique titre+date+lien
            const items: Array<{ title: string; date: string; url?: string }> = [];
            const itemRegex = /<item>([\s\S]*?)<\/item>/g;
            let m;
            while ((m = itemRegex.exec(xml)) !== null && items.length < 3) {
              const titleMatch = m[1].match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/);
              const dateMatch = m[1].match(/<pubDate>(.*?)<\/pubDate>/);
              const linkMatch = m[1].match(/<link>(.*?)<\/link>/);
              if (titleMatch) {
                items.push({
                  title: (titleMatch[1] ?? titleMatch[2] ?? '').trim(),
                  date: dateMatch?.[1] ?? '',
                  url: linkMatch?.[1]?.trim(),
                });
              }
            }
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(items));
          } catch { res.end('[]'); }
          return;
        }

        next();
      });
    },
  };
}
```

- [ ] Enregistrer dans `vite.config.ts` :

```typescript
import { ministersProxyPlugin } from './src/plugins/ministers-proxy.ts';
// Dans plugins: [...plugins existants, ministersProxyPlugin()]
```

- [ ] `npm run typecheck`

- [ ] Commit :
```bash
git add src/plugins/ministers-proxy.ts vite.config.ts
git commit -m "feat(ministers): add Vite dev proxy — Wikidata + RSS agenda endpoints"
```

---

## Task 5 — MinistresPanel.ts

**Files:**
- Create: `src/components/MinistresPanel.ts`

- [ ] Créer le composant (monté dans right sidebar, section collapsible) :

```typescript
/**
 * MinistresPanel.ts — Section "Gouvernement" dans la right sidebar.
 * Affiche le PM + ministres compétents selon le contexte (categories).
 * Clic → modal OSINT complet avec tabs.
 */

import { getMinistersForCategories, getPM, type Minister } from '../config/government.ts';
import { getFullMinisterProfile, type MinisterEnriched } from '../services/ministers.ts';
import type { EventCategory } from '../types/index.ts';

export class MinistresPanel {
  private containerEl!: HTMLElement;
  private bodyEl!: HTMLElement;
  private currentCategories: EventCategory[] = [];

  constructor(private readonly parentEl: HTMLElement) {}

  mount(): void {
    this.containerEl = document.createElement('div');
    this.containerEl.className = 'panel';
    this.containerEl.innerHTML = `
      <div class="panel-header" style="cursor:pointer;user-select:none;">
        <span class="panel-title">GOUVERNEMENT</span>
        <span class="panel-badge" id="ministers-badge" style="display:none;"></span>
      </div>`;
    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'panel-body';
    this.containerEl.appendChild(this.bodyEl);
    this.parentEl.appendChild(this.containerEl);

    // Toggle collapse
    const header = this.containerEl.querySelector('.panel-header') as HTMLElement;
    let collapsed = false;
    header.addEventListener('click', () => {
      collapsed = !collapsed;
      this.bodyEl.style.display = collapsed ? 'none' : '';
    });

    // Afficher PM par défaut
    this.setContext([]);
  }

  setContext(categories: EventCategory[]): void {
    this.currentCategories = categories;
    this._render();
  }

  private _render(): void {
    const ministers = getMinistersForCategories(this.currentCategories);
    this.bodyEl.innerHTML = '';

    // Chips contexte
    if (this.currentCategories.length > 0) {
      const chips = document.createElement('div');
      chips.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px;';
      this.currentCategories.forEach(cat => {
        const chip = document.createElement('span');
        chip.style.cssText = 'background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:3px;padding:2px 7px;font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;';
        chip.textContent = cat;
        chips.appendChild(chip);
      });
      this.bodyEl.appendChild(chips);
    }

    ministers.slice(0, 4).forEach(m => this.bodyEl.appendChild(this._ministerCard(m)));

    if (ministers.length > 4) {
      const more = document.createElement('div');
      more.style.cssText = 'color:var(--text-muted);font-size:11px;text-align:center;padding:6px;cursor:pointer;';
      more.textContent = `+ ${ministers.length - 4} autre(s) ministre(s)`;
      more.addEventListener('click', () => {
        more.remove();
        ministers.slice(4).forEach(m => this.bodyEl.insertBefore(this._ministerCard(m), more));
      });
      this.bodyEl.appendChild(more);
    }

    // Bouton voir tout
    const seeAll = document.createElement('div');
    seeAll.style.cssText = 'margin-top:8px;text-align:center;font-size:10px;color:var(--text-muted);cursor:pointer;padding:4px;border:1px solid var(--border-color);border-radius:4px;';
    seeAll.textContent = 'Voir tout le gouvernement';
    seeAll.addEventListener('click', () => this._showFullGovt());
    this.bodyEl.appendChild(seeAll);
  }

  private _ministerCard(minister: Minister): HTMLElement {
    const card = document.createElement('div');
    card.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px;background:rgba(255,255,255,0.03);border:1px solid var(--border-color);border-radius:6px;margin-bottom:6px;cursor:pointer;transition:background 0.15s;';
    card.addEventListener('mouseenter', () => { card.style.background = 'rgba(255,255,255,0.07)'; });
    card.addEventListener('mouseleave', () => { card.style.background = 'rgba(255,255,255,0.03)'; });
    card.addEventListener('click', () => this._openModal(minister));

    const avatar = document.createElement('div');
    avatar.style.cssText = 'width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,0.1);flex-shrink:0;overflow:hidden;display:flex;align-items:center;justify-content:center;';
    if (minister.photoUrl) {
      const img = document.createElement('img');
      img.src = minister.photoUrl;
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
      img.onerror = () => { img.style.display = 'none'; avatar.textContent = minister.prenom[0] + minister.nom[0]; };
      avatar.appendChild(img);
    } else {
      avatar.style.cssText += 'font-size:12px;color:var(--text-muted);font-weight:700;';
      avatar.textContent = minister.prenom[0] + minister.nom[0];
    }

    const info = document.createElement('div');
    info.style.cssText = 'flex:1;min-width:0;';
    info.innerHTML = `
      <div style="color:var(--text-primary);font-weight:600;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
        ${minister.prenom} ${minister.nom}${minister.isPM ? ' 🏛' : ''}
      </div>
      <div style="color:var(--text-muted);font-size:10px;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
        ${minister.titreShort}${minister.parti ? ` · ${minister.parti}` : ''}
      </div>`;

    const chevron = document.createElement('span');
    chevron.style.cssText = 'color:var(--text-muted);font-size:10px;flex-shrink:0;';
    chevron.textContent = '›';

    card.appendChild(avatar);
    card.appendChild(info);
    card.appendChild(chevron);
    return card;
  }

  private async _openModal(minister: Minister): Promise<void> {
    // Overlay plein panel
    const existing = this.containerEl.parentElement?.querySelector('.minister-modal');
    if (existing) { existing.remove(); return; }

    const modal = document.createElement('div');
    modal.className = 'minister-modal';
    modal.style.cssText = 'position:absolute;inset:0;background:var(--bg-surface);border-radius:8px;z-index:20;display:flex;flex-direction:column;overflow:hidden;';

    // Header
    const hdr = document.createElement('div');
    hdr.style.cssText = 'display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--border-color);flex-shrink:0;';
    const backBtn = document.createElement('button');
    backBtn.textContent = '←';
    backBtn.style.cssText = 'background:rgba(255,255,255,0.1);border:none;color:var(--text-muted);cursor:pointer;width:28px;height:28px;border-radius:14px;font-size:14px;flex-shrink:0;';
    backBtn.onclick = () => modal.remove();
    const hdrTitle = document.createElement('div');
    hdrTitle.style.cssText = 'color:var(--text-primary);font-weight:600;font-size:12px;flex:1;';
    hdrTitle.textContent = minister.titreShort;
    hdr.appendChild(backBtn);
    hdr.appendChild(hdrTitle);
    modal.appendChild(hdr);

    // Body scrollable
    const body = document.createElement('div');
    body.style.cssText = 'flex:1;overflow-y:auto;padding:16px;';

    // Hero section (identité rapide)
    body.innerHTML = `
      <div style="display:flex;gap:14px;align-items:flex-start;margin-bottom:16px;">
        <div id="minister-photo" style="width:72px;height:72px;border-radius:50%;background:rgba(255,255,255,0.1);flex-shrink:0;overflow:hidden;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;color:var(--text-muted);">
          ${minister.prenom[0]}${minister.nom[0]}
        </div>
        <div style="flex:1;min-width:0;">
          <div style="color:var(--text-primary);font-weight:700;font-size:14px;">${minister.prenom} ${minister.nom}</div>
          <div style="color:var(--text-muted);font-size:11px;margin-top:3px;line-height:1.5;">${minister.titre}</div>
          ${minister.parti ? `<div style="margin-top:5px;"><span style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:3px;padding:2px 6px;font-size:10px;color:var(--text-muted);">${minister.parti}</span></div>` : ''}
          ${minister.dateNomination ? `<div style="color:var(--text-muted);font-size:10px;margin-top:4px;">Nommé(e) le ${new Date(minister.dateNomination).toLocaleDateString('fr-FR')}</div>` : ''}
        </div>
      </div>
      <div id="minister-bio" style="color:var(--text-muted);font-size:11px;font-style:italic;margin-bottom:14px;line-height:1.6;"></div>

      <!-- Tabs -->
      <div style="display:flex;gap:2px;margin-bottom:12px;border-bottom:1px solid var(--border-color);padding-bottom:8px;" id="minister-tabs">
        <button data-tab="portefeuille" class="mtab active" style="background:rgba(255,255,255,0.08);border:none;color:var(--text-primary);cursor:pointer;padding:5px 10px;border-radius:4px;font-size:11px;">Portefeuille</button>
        <button data-tab="agenda" class="mtab" style="background:transparent;border:none;color:var(--text-muted);cursor:pointer;padding:5px 10px;border-radius:4px;font-size:11px;">Agenda</button>
        <button data-tab="contact" class="mtab" style="background:transparent;border:none;color:var(--text-muted);cursor:pointer;padding:5px 10px;border-radius:4px;font-size:11px;">Contact</button>
      </div>
      <div id="minister-tab-content"></div>

      <!-- Liens externes -->
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:16px;padding-top:12px;border-top:1px solid var(--border-color);">
        ${minister.siteMinistere ? `<a href="${minister.siteMinistere}" target="_blank" style="display:inline-flex;align-items:center;gap:4px;background:rgba(255,255,255,0.06);border:1px solid var(--border-color);border-radius:4px;padding:4px 8px;font-size:10px;color:var(--text-muted);text-decoration:none;">Ministère ↗</a>` : ''}
        <a href="https://declarations.hatvp.fr/fiche/${minister.prenom.toLowerCase()}-${minister.nom.toLowerCase()}" target="_blank" style="display:inline-flex;align-items:center;gap:4px;background:rgba(255,255,255,0.06);border:1px solid var(--border-color);border-radius:4px;padding:4px 8px;font-size:10px;color:var(--text-muted);text-decoration:none;">HATVP ↗</a>
        ${minister.wikidataId ? `<a href="https://www.wikidata.org/wiki/${minister.wikidataId}" target="_blank" style="display:inline-flex;align-items:center;gap:4px;background:rgba(255,255,255,0.06);border:1px solid var(--border-color);border-radius:4px;padding:4px 8px;font-size:10px;color:var(--text-muted);text-decoration:none;">Wikidata ↗</a>` : ''}
        ${minister.twitter ? `<a href="https://twitter.com/${minister.twitter}" target="_blank" style="display:inline-flex;align-items:center;gap:4px;background:rgba(255,255,255,0.06);border:1px solid var(--border-color);border-radius:4px;padding:4px 8px;font-size:10px;color:var(--text-muted);text-decoration:none;">X/Twitter ↗</a>` : ''}
      </div>`;

    modal.appendChild(body);

    // Mount modal
    const rightSidebarContent = this.containerEl.closest('.right-sidebar-content');
    if (rightSidebarContent) {
      (rightSidebarContent as HTMLElement).style.position = 'relative';
      rightSidebarContent.appendChild(modal);
    }

    // Tab switching
    this._setupTabs(modal, minister);

    // Enrichissement async
    this._enrichModal(modal, minister);
  }

  private _setupTabs(modal: HTMLElement, minister: Minister): void {
    const tabs = modal.querySelectorAll('.mtab');
    const contentEl = modal.querySelector('#minister-tab-content') as HTMLElement;
    const renderTab = (tabName: string) => {
      tabs.forEach(t => {
        const btn = t as HTMLButtonElement;
        const isActive = btn.dataset['tab'] === tabName;
        btn.style.background = isActive ? 'rgba(255,255,255,0.08)' : 'transparent';
        btn.style.color = isActive ? 'var(--text-primary)' : 'var(--text-muted)';
      });
      if (tabName === 'portefeuille') {
        contentEl.innerHTML = `
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px;">Domaines de compétence</div>
          <div style="display:flex;flex-wrap:wrap;gap:5px;">
            ${minister.portefeuilles.map(p => `<span style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:3px;padding:3px 8px;font-size:11px;color:var(--text-primary);">${p}</span>`).join('')}
          </div>`;
      } else if (tabName === 'agenda') {
        contentEl.innerHTML = '<div style="color:var(--text-muted);font-size:11px;">Chargement agenda...</div>';
        this._loadAgenda(contentEl, minister);
      } else if (tabName === 'contact') {
        contentEl.innerHTML = `
          ${minister.emailCabinet ? `<div style="margin-bottom:8px;"><span style="color:var(--text-muted);font-size:10px;">Cabinet : </span><a href="mailto:${minister.emailCabinet}" style="color:var(--text-primary);font-size:11px;">${minister.emailCabinet}</a></div>` : ''}
          ${minister.siteMinistere ? `<div style="margin-bottom:8px;"><span style="color:var(--text-muted);font-size:10px;">Site : </span><a href="${minister.siteMinistere}" target="_blank" style="color:var(--text-primary);font-size:11px;">${minister.siteMinistere}</a></div>` : ''}
          ${minister.twitter ? `<div><span style="color:var(--text-muted);font-size:10px;">Twitter/X : </span><a href="https://twitter.com/${minister.twitter}" target="_blank" style="color:var(--text-primary);font-size:11px;">@${minister.twitter}</a></div>` : '<div style="color:var(--text-muted);font-size:11px;">Pas d\'info de contact disponible</div>'}`;
      }
    };
    tabs.forEach(t => {
      t.addEventListener('click', () => renderTab((t as HTMLButtonElement).dataset['tab'] ?? ''));
    });
    renderTab('portefeuille');
  }

  private async _loadAgenda(el: HTMLElement, minister: Minister): Promise<void> {
    const { fetchMinisterAgenda } = await import('../services/ministers.ts');
    const items = await fetchMinisterAgenda(minister);
    if (items.length === 0) { el.innerHTML = '<div style="color:var(--text-muted);font-size:11px;">Aucun agenda disponible</div>'; return; }
    el.innerHTML = items.map(item => `
      <div style="padding:8px 0;border-bottom:1px solid var(--border-color);">
        <div style="color:var(--text-primary);font-size:11px;line-height:1.5;">${item.title}</div>
        <div style="color:var(--text-muted);font-size:10px;margin-top:3px;">${item.date}</div>
        ${item.url ? `<a href="${item.url}" target="_blank" style="color:var(--text-muted);font-size:10px;">Voir ↗</a>` : ''}
      </div>`).join('');
  }

  private async _enrichModal(modal: HTMLElement, minister: Minister): Promise<void> {
    const { enrichMinisterFromWikidata } = await import('../services/ministers.ts');
    const enriched = await enrichMinisterFromWikidata(minister);
    if (enriched.photoHd) {
      const photoEl = modal.querySelector('#minister-photo') as HTMLElement;
      photoEl.innerHTML = `<img src="${enriched.photoHd}" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none'">`;
    }
    if (enriched.bioShort) {
      const bioEl = modal.querySelector('#minister-bio') as HTMLElement;
      bioEl.textContent = enriched.bioShort;
    }
  }

  private _showFullGovt(): void {
    this.setContext([]);
  }

  destroy(): void {
    this.containerEl.remove();
  }
}
```

- [ ] `npm run typecheck`

- [ ] Commit :
```bash
git add src/components/MinistresPanel.ts
git commit -m "feat(ministers): add MinistresPanel — contextual cards + OSINT modal with tabs"
```

---

## Task 6 — App.ts : intégration

**Files:**
- Modify: `src/App.ts`

- [ ] Importer et monter `MinistresPanel` dans la right sidebar :

```typescript
import { MinistresPanel } from './components/MinistresPanel.ts';
// Dans la classe App, champ : private ministresPanel: MinistresPanel | null = null;

// Dans la méthode d'init, après mount de RightSidebar :
this.ministresPanel = new MinistresPanel(rightContent);
this.ministresPanel.mount();
```

- [ ] Connecter `onArticleSelected` — à déclencher depuis `NewsPanel` quand un article est cliqué :

```typescript
// Dans l'handler de sélection d'article dans App.ts (là où newsPanel.setOnArticleSelect est câblé) :
this.newsPanel?.setOnArticleSelect((article) => {
  // ... logique existante (affichage popup, etc.) ...
  const categories = article.category ? [article.category] : [];
  this.ministresPanel?.setContext(categories as EventCategory[]);
});
```

- [ ] `npm run build && npm run typecheck`

- [ ] Commit :
```bash
git add src/App.ts
git commit -m "feat(ministers): wire MinistresPanel to right sidebar + article context trigger"
```

---

## Vérification finale

- [ ] `npm run build` — clean
- [ ] `npm run typecheck` — 0 erreurs
- [ ] Tester dans le navigateur :
  - Section "GOUVERNEMENT" visible dans right sidebar avec PM en tête
  - Clic sur un article RSS catégorie "energy" → ministres Énergie + PM affichés
  - Clic sur carte Ministre → modal avec hero, tabs Portefeuille / Agenda / Contact
  - Tab Agenda → charge RSS du ministère (3 derniers items)
  - Liens HATVP / Wikidata / Twitter fonctionnels
  - Enrichissement Wikidata async : photo HD et bio apparaissent après ~1s
