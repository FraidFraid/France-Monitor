# Alertes « grands feux » — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformer l'alerte incendie nationale saturée en dossiers d'incident localisés, enrichis de faits d'impact sourcés et notés (hectares, évacuations, habitations détruites).

**Architecture:** Extraction déterministe des faits d'impact dans le cron d'ingestion news existant (`api/ingest/news.ts`, 15 min) vers une table Neon append-only. Le client joint ces faits aux `FireIncident` issus du clustering DBSCAN VIIRS déjà en place, produit un `WildfireDossier` par fonctions pures, et n'appelle Ollama qu'à l'ouverture du dossier. Aucun chiffre n'est réconcilié : l'API expose des séries.

**Tech Stack:** TypeScript strict (vanilla, pas de JSX), Vite 6, vitest, Vercel Functions (Node), Neon Postgres (`@neondatabase/serverless`), Ollama local.

**Spec de référence :** `docs/design-alertes-grands-feux-2026-07.md` — les renvois `§N` ci-dessous y pointent.

## Global Constraints

- TypeScript `strict: true`. **Aucun `any`**, aucun `!` non justifié.
- Vanilla DOM uniquement. Pas de React/JSX.
- Commentaires et libellés d'interface **en français**.
- Alias de chemin : `@/*` → `./src/*`. Imports relatifs avec extension `.ts` explicite (convention du dépôt).
- Fichiers `api/**` : JavaScript ou TypeScript Node runtime. `api/_lib/*.js` est en JSDoc typé — **ne pas convertir en TS**.
- Tests services client : colocalisés `src/services/X.test.ts`, `import { describe, expect, it } from 'vitest'`.
- Tests API : `tests/X.test.ts`.
- **Aucun `ImpactFact` sans `quote` + `sourceUrl` + `observedAt`** — un fait incomplet est rejeté, jamais dégradé (§3.3).
- **Aucune fonction ne renvoie un scalaire réconcilié** pour une grandeur déclarée. Pas de `getCurrentAreaHa()`, pas de moyenne, pas de `max`, pas de « dernier connu » (§12.4).
- **`escapeHtml` sur tout texte tiers** rendu dans le DOM (§6.2).
- Ollama n'est appelé que côté client. **Jamais de bascule vers Groq** pour du texte préfectoral (§7).
- Clôture de chaque tâche : `npm run typecheck` puis `npm test`.

## Structure des fichiers

| fichier | responsabilité |
|---|---|
| `api/_lib/impact-extractor.js` | **créer** — extraction déterministe : texte → `ImpactFact[]`. Fonctions pures, zéro I/O. |
| `api/_lib/migrations/002-fire-impact-facts.sql` | **créer** — schéma `fire_impact_facts` + `fire_incident_history`. |
| `api/ingest/news.ts` | **modifier** — brancher l'extraction après l'INSERT ; enrichir `InsertedItem`. |
| `api/fires/impacts.js` | **créer** — `GET /api/fires/impacts` : séries de faits par département. |
| `src/plugins/fires-dossier-proxy.ts` | **créer** — proxy Vite dev pour `/api/fires/impacts` et `/api/fires/incident-history`. Exigé par `CLAUDE.md` : tout `/api/*` a son miroir dev. |
| `src/plugins/fires-proxy.ts` | **modifier** — rendre l'interception **exacte** sur `/api/fires` (voir Task 4, Step 0). |
| `api/fires/incident-history.js` | **créer** — `POST` persistance des incidents, `GET` historique. |
| `src/types/index.ts` | **modifier** — `ImpactFact`, `WildfireDossier`, `SourceLevel`, `Reliability`, `Credibility`. |
| `src/services/wildfire-dossier.ts` | **créer** — `selectMajorIncidents`, `gradeCredibility`, `buildDossier` : **pures**. |
| `src/services/wildfire-enrich.ts` | **créer** — `enrichWithLlm` : seul point d'effet de bord Ollama. |
| `src/services/situation-engine.ts` | **modifier** — `detectWildfireEscalation` par incident. |
| `src/components/WildfireDossierModal.ts` | **créer** — rendu du dossier. |
| `src/components/AlertMonitor.ts` | **modifier** — hook `onOpenDossier`. |

Découpage volontaire : `wildfire-dossier.ts` ne contient que des fonctions pures et porte toute la logique décidable ; l'effet de bord Ollama est isolé dans `wildfire-enrich.ts` pour que le premier soit testable sans réseau.

---

### Task 1: Extraction déterministe des faits d'impact

**Files:**
- Create: `api/_lib/impact-extractor.js`
- Test: `tests/impact-extractor.test.ts`

**Interfaces:**
- Consumes: rien (premier maillon).
- Produces:
  - `FIRE_LEXICON: RegExp` — porte d'entrée « ce texte parle-t-il d'incendie ? »
  - `mentionsFire(text: string): boolean`
  - `deriveReliability(sourceUrl: string, tier: number | null): 'A'|'B'|'C'|'D'|'E'`
  - `deriveSourceLevel(sourceUrl: string): 'primary'|'secondary'|'tertiary'`
  - `extractImpactFacts(input): RawImpactFact[]` où
    `input = { text, sourceUrl, sourceName, tier, observedAt }` et
    `RawImpactFact = { kind, value: number|null, unit: string|null, quote, sourceUrl, sourceName, sourceLevel, reliability, hedged, observedAt }`
  - `kind ∈ 'area_ha' | 'evacuated' | 'dwellings_destroyed' | 'injured' | 'evacuation_order' | 'road_closed' | 'rail_disrupted'`

- [ ] **Step 1: Write the failing test**

```ts
// tests/impact-extractor.test.ts
import { describe, expect, it } from 'vitest';
import {
  mentionsFire, deriveReliability, deriveSourceLevel, extractImpactFacts,
} from '../api/_lib/impact-extractor.js';

const BASE = {
  sourceUrl: 'https://www.sudouest.fr/a/1',
  sourceName: 'Sud Ouest',
  tier: 3,
  observedAt: '2026-07-26T08:00:00Z',
};

describe('mentionsFire', () => {
  it('reconnaît le vocabulaire incendie et ignore le reste', () => {
    expect(mentionsFire('Un incendie ravage la forêt')).toBe(true);
    expect(mentionsFire('feu de forêt maîtrisé')).toBe(true);
    expect(mentionsFire('42 000 hectares brûlés')).toBe(true);
    expect(mentionsFire('Le conseil municipal a voté le budget')).toBe(false);
  });
});

describe('deriveSourceLevel / deriveReliability', () => {
  it('classe un domaine officiel en primaire noté A', () => {
    expect(deriveSourceLevel('https://www.gironde.gouv.fr/x')).toBe('primary');
    expect(deriveReliability('https://www.gironde.gouv.fr/x', null)).toBe('A');
  });

  it('classe la presse par tier, et une encyclopédie en tertiaire', () => {
    expect(deriveSourceLevel('https://www.sudouest.fr/a')).toBe('secondary');
    expect(deriveReliability('https://www.lemonde.fr/a', 1)).toBe('B');
    expect(deriveReliability('https://www.sudouest.fr/a', 3)).toBe('D');
    expect(deriveSourceLevel('https://fr.wikipedia.org/wiki/X')).toBe('tertiary');
  });
});

describe('extractImpactFacts — formulations réelles du cas Gironde', () => {
  it('extrait les hectares avec espace insécable, point et abréviation', () => {
    for (const text of ['42 000 hectares de forêt ont été détruits',
                        '42.000 hectares détruits',
                        'le feu a parcouru 42 000 ha']) {
      const facts = extractImpactFacts({ ...BASE, text });
      const area = facts.filter(f => f.kind === 'area_ha');
      expect(area).toHaveLength(1);
      expect(area[0].value).toBe(42000);
      expect(area[0].quote).toContain('42');
    }
  });

  it('marque hedged sur une formulation approximative', () => {
    const [fact] = extractImpactFacts({ ...BASE, text: 'près de 8 000 hectares brûlés' });
    expect(fact.value).toBe(8000);
    expect(fact.hedged).toBe(true);
  });

  it('extrait évacués, habitations et blessés', () => {
    const facts = extractImpactFacts({
      ...BASE,
      text: "L'incendie a contraint 220 000 personnes à évacuer. 175 maisons ont brûlé. 42 sapeurs-pompiers blessés.",
    });
    const byKind = Object.fromEntries(facts.map(f => [f.kind, f.value]));
    expect(byKind['evacuated']).toBe(220000);
    expect(byKind['dwellings_destroyed']).toBe(175);
    expect(byKind['injured']).toBe(42);
  });

  it("retient un ordre d'évacuation sans chiffre — la préfecture ne quantifie pas", () => {
    const facts = extractImpactFacts({
      ...BASE,
      sourceUrl: 'https://www.gironde.gouv.fr/c',
      sourceName: 'Préfecture de la Gironde',
      tier: null,
      text: "Le préfet a décidé de déclencher une alerte FR-Alert afin d'ordonner l'évacuation immédiate.",
    });
    const order = facts.find(f => f.kind === 'evacuation_order');
    expect(order).toBeDefined();
    expect(order?.value).toBeNull();
    expect(order?.reliability).toBe('A');
    expect(order?.sourceLevel).toBe('primary');
  });

  it('extrait une coupure routière avec son kilométrage', () => {
    const [fact] = extractImpactFacts({ ...BASE, text: "l'A63 est coupée sur 70 km" });
    expect(fact.kind).toBe('road_closed');
    expect(fact.value).toBe(70);
    expect(fact.unit).toBe('km');
  });

  it('ne produit RIEN sur un texte incendie sans fait chiffrable', () => {
    expect(extractImpactFacts({ ...BASE, text: "Les pompiers restent mobilisés sur l'incendie." }))
      .toEqual([]);
  });

  it('ne produit RIEN sur un texte hors sujet, même truffé de nombres', () => {
    expect(extractImpactFacts({ ...BASE, text: '42 000 spectateurs au stade, 175 buts marqués' }))
      .toEqual([]);
  });

  it('rejette un fait dont la provenance est incomplète', () => {
    expect(extractImpactFacts({ ...BASE, sourceUrl: '', text: '42 000 hectares détruits' }))
      .toEqual([]);
    expect(extractImpactFacts({ ...BASE, observedAt: '', text: '42 000 hectares détruits' }))
      .toEqual([]);
  });

  it('ignore un nombre aberrant (garde-fou anti-faux positif)', () => {
    expect(extractImpactFacts({ ...BASE, text: "l'incendie a détruit 99 000 000 hectares" }))
      .toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/impact-extractor.test.ts`
Expected: FAIL — `Failed to resolve import "../api/_lib/impact-extractor.js"`

- [ ] **Step 3: Write the implementation**

```js
// api/_lib/impact-extractor.js
/**
 * api/_lib/impact-extractor.js — Extraction déterministe des faits d'impact
 * incendie depuis du texte de presse ou de communiqué préfectoral.
 *
 * Fonctions PURES, aucune I/O : tout est testable sans réseau ni base.
 * Voir docs/design-alertes-grands-feux-2026-07.md §3, §12.
 *
 * Principe : on préfère ne rien extraire plutôt qu'extraire un fait douteux.
 * Un blanc honnête vaut mieux qu'un chiffre plausible (§7).
 */

/** Vocabulaire incendie : porte d'entrée de l'extraction. */
const FIRE_LEXICON =
  /\b(incendies?|feux?\s+de\s+for[êe]t|feux?\s+de\s+v[ée]g[ée]tation|sinistr[ée]s?|br[ûu]l[ée]s?|flammes?|hectares?\s+br[ûu]l)/i;

/** Domaines officiels = source primaire (l'acteur lui-même). */
const OFFICIAL_HOST = /(^|\.)gouv\.fr$|(^|\.)sdis\d*\.fr$|(^|\.)prefectures-regions\.gouv\.fr$/i;

/** Consolidations tertiaires. */
const TERTIARY_HOST = /(^|\.)wikipedia\.org$|(^|\.)wikimedia\.org$/i;

/** Formulations approximatives : le chiffre reste exploitable mais signalé. */
const HEDGE = /\b(pr[èe]s\s+de|environ|quelque|plus\s+de|au\s+moins|autour\s+de|une\s+(?:cinquantaine|centaine|dizaine|vingtaine))\b/i;

/** Bornes de vraisemblance — au-delà, on suppose une erreur de lecture. */
const PLAUSIBLE = {
  area_ha: 1_000_000,
  evacuated: 5_000_000,
  dwellings_destroyed: 100_000,
  injured: 10_000,
  road_closed: 2_000,
};

/**
 * @param {string} text
 * @returns {boolean}
 */
export function mentionsFire(text) {
  return typeof text === 'string' && FIRE_LEXICON.test(text);
}

/** @param {string} sourceUrl @returns {string|null} */
function hostOf(sourceUrl) {
  try {
    return new URL(sourceUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Niveau de source, indépendant de sa fiabilité (§12.2).
 * @param {string} sourceUrl
 * @returns {'primary'|'secondary'|'tertiary'}
 */
export function deriveSourceLevel(sourceUrl) {
  const host = hostOf(sourceUrl);
  if (!host) return 'secondary';
  if (OFFICIAL_HOST.test(host)) return 'primary';
  if (TERTIARY_HOST.test(host)) return 'tertiary';
  return 'secondary';
}

/**
 * Fiabilité de la source, dérivée du domaine puis du tier de feeds.ts (§12.1).
 * A = officiel primaire, B/C/D = presse par tier, E = inconnu.
 * @param {string} sourceUrl
 * @param {number|null} tier
 * @returns {'A'|'B'|'C'|'D'|'E'}
 */
export function deriveReliability(sourceUrl, tier) {
  if (deriveSourceLevel(sourceUrl) === 'primary') return 'A';
  if (tier === 1) return 'B';
  if (tier === 2) return 'C';
  if (tier === 3) return 'D';
  return 'E';
}

/**
 * Normalise « 42 000 », « 42.000 », « 42 000 » (insécable) → 42000.
 * @param {string} raw
 * @returns {number|null}
 */
function parseFrenchNumber(raw) {
  const cleaned = raw.replace(/[\s  .]/g, '');
  if (!/^\d+$/.test(cleaned)) return null;
  const value = Number.parseInt(cleaned, 10);
  return Number.isSafeInteger(value) ? value : null;
}

/** Phrase englobant l'index donné, pour la citation verbatim. */
function sentenceAt(text, index) {
  const start = Math.max(0, text.lastIndexOf('.', index - 1) + 1);
  const dot = text.indexOf('.', index);
  const end = dot === -1 ? text.length : dot + 1;
  return text.slice(start, end).trim();
}

/**
 * Motifs chiffrés. `unit` null = compte de personnes/objets.
 * @type {Array<{kind: string, re: RegExp, unit: string|null}>}
 */
const NUMERIC_PATTERNS = [
  { kind: 'area_ha', unit: 'ha', re: /([\d\s  .]+?)\s*(?:hectares?|ha)\b/gi },
  { kind: 'evacuated', unit: null, re: /([\d\s  .]+?)\s*(?:personnes?|habitants?|r[ée]sidents?)\b[^.]{0,60}?\b(?:[ée]vacu|d[ée]plac)/gi },
  { kind: 'dwellings_destroyed', unit: null, re: /([\d\s  .]+?)\s*(?:maisons?|habitations?|logements?|b[âa]timents?)\b/gi },
  { kind: 'injured', unit: null, re: /([\d\s  .]+?)\s*(?:sapeurs?-pompiers?|pompiers?|personnes?)\s+bless[ée]s?\b/gi },
  { kind: 'road_closed', unit: 'km', re: /(?:coup[ée]e?|ferm[ée]e?|neutralis[ée]e?)\s+sur\s+([\d\s  .]+?)\s*km\b/gi },
];

/** Motifs qualitatifs : un fait sans chiffre reste un fait (§3.4). */
const QUALITATIVE_PATTERNS = [
  { kind: 'evacuation_order', re: /\b(?:FR-Alert|ordre\s+d['’]?[ée]vacuation|ordonner\s+l['’]?[ée]vacuation|[ée]vacuation\s+(?:imm[ée]diate|pr[ée]ventive))\b/i },
  { kind: 'rail_disrupted', re: /\b(?:circulation\s+(?:ferroviaire|des\s+trains)\s+(?:interrompue|suspendue)|trafic\s+(?:TER|TGV)\s+(?:interrompu|suspendu))\b/i },
];

/**
 * Extrait les faits d'impact d'un texte. Retourne [] plutôt qu'un fait douteux.
 * @param {{text: string, sourceUrl: string, sourceName: string, tier: number|null, observedAt: string}} input
 * @returns {Array<object>}
 */
export function extractImpactFacts(input) {
  const { text, sourceUrl, sourceName, tier, observedAt } = input ?? {};
  // Provenance incomplète → aucun fait affichable (§3.3). On rejette, on ne dégrade pas.
  if (!text || !sourceUrl || !sourceName || !observedAt) return [];
  if (!mentionsFire(text)) return [];

  const sourceLevel = deriveSourceLevel(sourceUrl);
  const reliability = deriveReliability(sourceUrl, tier ?? null);
  /** @type {Array<object>} */
  const facts = [];
  const seen = new Set();

  const push = (kind, value, unit, quote) => {
    const key = `${kind}|${value}`;
    if (seen.has(key)) return;
    seen.add(key);
    facts.push({
      kind, value, unit, quote,
      sourceUrl, sourceName, sourceLevel, reliability,
      hedged: HEDGE.test(quote),
      observedAt,
    });
  };

  for (const { kind, re, unit } of NUMERIC_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const value = parseFrenchNumber(m[1]);
      if (value === null || value <= 0) continue;
      if (value > PLAUSIBLE[kind]) continue; // garde-fou anti-faux positif
      push(kind, value, unit, sentenceAt(text, m.index));
    }
  }

  for (const { kind, re } of QUALITATIVE_PATTERNS) {
    const m = re.exec(text);
    if (m) push(kind, null, null, sentenceAt(text, m.index));
  }

  return facts;
}

export { FIRE_LEXICON };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/impact-extractor.test.ts`
Expected: PASS — 10 tests.

Si le cas `dwellings_destroyed` capte aussi « 42 000 hectares … bâtiments », resserrer la fenêtre du motif plutôt que d'assouplir l'assertion : le test encode l'exigence, pas l'inverse.

- [ ] **Step 5: Typecheck et commit**

```bash
npm run typecheck && npx vitest run tests/impact-extractor.test.ts
git add api/_lib/impact-extractor.js tests/impact-extractor.test.ts
git commit -m "feat: extraction déterministe des faits d'impact incendie"
```

---

### Task 2: Schéma Neon — faits d'impact et historique des incidents

**Files:**
- Create: `api/_lib/migrations/002-fire-impact-facts.sql`
- Test: `tests/fire-impact-schema.test.ts`

**Interfaces:**
- Consumes: `RawImpactFact` (Task 1).
- Produces: tables `fire_impact_facts` et `fire_incident_history`. Le test verrouille le contrat de colonnes que les Tasks 3, 4 et 5 consomment.

- [ ] **Step 1: Write the failing test**

```ts
// tests/fire-impact-schema.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SQL = readFileSync('api/_lib/migrations/002-fire-impact-facts.sql', 'utf8');

describe('migration fire_impact_facts', () => {
  it('crée les deux tables de façon idempotente', () => {
    expect(SQL).toMatch(/CREATE TABLE IF NOT EXISTS fire_impact_facts/i);
    expect(SQL).toMatch(/CREATE TABLE IF NOT EXISTS fire_incident_history/i);
  });

  it('porte toute la provenance exigée par le §3.3', () => {
    for (const col of ['quote', 'source_url', 'source_name', 'source_level',
                       'reliability', 'observed_at']) {
      expect(SQL).toMatch(new RegExp(`\\b${col}\\b[^,]*NOT NULL`, 'i'));
    }
  });

  it('laisse value nullable — un ordre d\'évacuation n\'a pas de valeur', () => {
    expect(SQL).toMatch(/\bvalue\s+(numeric|real|double precision)(?![^,]*NOT NULL)/i);
  });

  it('ne stocke PAS credibility : elle est dérivée à l\'assemblage (§12.1)', () => {
    expect(SQL).not.toMatch(/\bcredibility\b/i);
  });

  it('déduplique sur le contenu du fait, sans écraser les révisions', () => {
    expect(SQL).toMatch(/UNIQUE|unique index/i);
    expect(SQL).not.toMatch(/\bON CONFLICT[\s\S]*DO UPDATE\b/i);
  });

  it('indexe les axes de lecture : département et temps', () => {
    expect(SQL).toMatch(/CREATE INDEX IF NOT EXISTS[\s\S]*dept_code/i);
    expect(SQL).toMatch(/CREATE INDEX IF NOT EXISTS[\s\S]*observed_at/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/fire-impact-schema.test.ts`
Expected: FAIL — `ENOENT: no such file or directory ... 002-fire-impact-facts.sql`

- [ ] **Step 3: Write the migration**

```sql
-- api/_lib/migrations/002-fire-impact-facts.sql
-- Faits d'impact incendie + historique des incidents FIRMS.
-- Voir docs/design-alertes-grands-feux-2026-07.md §3, §9.1, §12.
--
-- APPEND-ONLY : chaque révision d'un chiffre est une NOUVELLE ligne.
-- Aucun UPDATE, aucune réconciliation (§12.4). L'API expose des séries.

CREATE TABLE IF NOT EXISTS fire_impact_facts (
  id            bigserial PRIMARY KEY,
  fact_hash     text        NOT NULL,
  news_item_id  bigint      REFERENCES news_items(id) ON DELETE SET NULL,
  kind          text        NOT NULL,
  value         numeric,            -- NULL pour un fait qualitatif (§3.4)
  unit          text,
  quote         text        NOT NULL,
  source_url    text        NOT NULL,
  source_name   text        NOT NULL,
  source_level  text        NOT NULL CHECK (source_level IN ('primary','secondary','tertiary')),
  reliability   text        NOT NULL CHECK (reliability IN ('A','B','C','D','E','F')),
  hedged        boolean     NOT NULL DEFAULT false,
  provisional   boolean     NOT NULL DEFAULT true,
  dept_code     text,
  communes      text[]      NOT NULL DEFAULT '{}',
  method        text        NOT NULL DEFAULT 'pattern' CHECK (method IN ('pattern','llm')),
  observed_at   timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Déduplique la ré-ingestion du MÊME fait par le MÊME article.
-- N'empêche pas une révision : un chiffre différent produit un hash différent.
CREATE UNIQUE INDEX IF NOT EXISTS fire_impact_facts_hash_uniq
  ON fire_impact_facts (fact_hash);

CREATE INDEX IF NOT EXISTS fire_impact_facts_dept_code_idx
  ON fire_impact_facts (dept_code, observed_at DESC);

CREATE INDEX IF NOT EXISTS fire_impact_facts_observed_at_idx
  ON fire_impact_facts (observed_at DESC);

-- Historique des incidents FIRMS (§9.1).
-- Sans cette table, la fenêtre FIRMS de 24 h ne montre qu'une tranche
-- d'un événement de plusieurs jours : le pic reste invisible.
CREATE TABLE IF NOT EXISTS fire_incident_history (
  id                bigserial   PRIMARY KEY,
  incident_id       text        NOT NULL,
  observed_at       timestamptz NOT NULL,
  centroid_lat      double precision NOT NULL,
  centroid_lon      double precision NOT NULL,
  detections_count  integer     NOT NULL,
  frp_total         double precision NOT NULL,
  frp_max           double precision NOT NULL,
  bbox_min_lat      double precision NOT NULL,
  bbox_max_lat      double precision NOT NULL,
  bbox_min_lon      double precision NOT NULL,
  bbox_max_lon      double precision NOT NULL,
  near_urban        boolean     NOT NULL DEFAULT false,
  dept_codes        text[]      NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS fire_incident_history_snapshot_uniq
  ON fire_incident_history (incident_id, observed_at);

CREATE INDEX IF NOT EXISTS fire_incident_history_observed_at_idx
  ON fire_incident_history (observed_at DESC);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/fire-impact-schema.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Appliquer la migration**

**`psql` n'est pas installé sur la machine de développement.** Passer par le driver Neon déjà
présent dans les dépendances (`@neondatabase/serverless`). Créer
`scripts/apply-migration.mjs` :

```js
// Applique un fichier .sql via le driver Neon. Node lit .env.development.local
// avec --env-file, donc aucun secret ne transite par la ligne de commande.
import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

const file = process.argv[2];
if (!file) throw new Error('usage: node --env-file=.env.development.local scripts/apply-migration.mjs <fichier.sql>');
const sql = neon(process.env.DATABASE_URL);
// Découpage sur les ';' de fin d'instruction : suffisant pour du DDL sans
// corps de fonction. Ne pas généraliser à du SQL contenant des blocs $$.
for (const statement of readFileSync(file, 'utf8').split(/;\s*$/m).map(s => s.trim()).filter(Boolean)) {
  await sql.query(statement);
  console.log('OK :', statement.slice(0, 70).replace(/\s+/g, ' '), '…');
}
```

```bash
node --env-file=.env.development.local scripts/apply-migration.mjs \
  api/_lib/migrations/002-fire-impact-facts.sql
```

Puis vérifier le schéma réellement créé :

```bash
node --env-file=.env.development.local -e "
import('@neondatabase/serverless').then(async ({ neon }) => {
  const sql = neon(process.env.DATABASE_URL);
  const cols = await sql\\`SELECT table_name, column_name, is_nullable, data_type
    FROM information_schema.columns
    WHERE table_name IN ('fire_impact_facts','fire_incident_history')
    ORDER BY table_name, ordinal_position\\`;
  console.table(cols);
});"
```

Attendu : les deux tables présentes, `value` avec `is_nullable = YES`, **aucune** colonne
`credibility`.

**Pré-requis bloquant à vérifier avant de commencer :** la base doit répondre. Un
`HTTP 402 — compute time quota exceeded` signifie que le projet Neon est suspendu ; dans ce cas
la migration ne peut pas être appliquée et cette tâche est BLOQUÉE. Le fichier SQL et son test de
contrat (Steps 1-4) restent livrables, seule l'application attend.

- [ ] **Step 6: Commit**

```bash
git add api/_lib/migrations/002-fire-impact-facts.sql tests/fire-impact-schema.test.ts
git commit -m "feat: schéma append-only des faits d'impact et de l'historique incidents"
```

---

### Task 3: Brancher l'extraction sur le cron d'ingestion

**Files:**
- Modify: `api/ingest/news.ts` — `InsertedItem` (l.71-75), `RETURNING` (l.254), fin du handler
- Test: `tests/ingest-impact-facts.test.ts`

**Interfaces:**
- Consumes: `extractImpactFacts` (Task 1), table `fire_impact_facts` (Task 2).
- Produces: `persistImpactFacts(sql, items): Promise<number>` exportée pour test, et `InsertedItem` enrichi de `link`, `description`, `publishedAt`, `sourceName`, `tier`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/ingest-impact-facts.test.ts
import { describe, expect, it, vi } from 'vitest';
import { buildImpactRows } from '../api/ingest/news.ts';

const ITEM = {
  id: 42,
  title: 'Incendie en Gironde : 42 000 hectares détruits',
  description: "Le feu a contraint 220 000 personnes à évacuer. 175 maisons ont brûlé.",
  link: 'https://www.sudouest.fr/a/1',
  publishedAt: '2026-07-26T08:00:00Z',
  sourceName: 'Sud Ouest',
  tier: 3,
  region: 'Nouvelle-Aquitaine',
};

describe('buildImpactRows', () => {
  it('produit un lot de faits horodatés et sourcés depuis un item', () => {
    const rows = buildImpactRows([ITEM]);
    const kinds = rows.map(r => r.kind).sort();
    expect(kinds).toContain('area_ha');
    expect(kinds).toContain('evacuated');
    expect(kinds).toContain('dwellings_destroyed');
    for (const row of rows) {
      expect(row.newsItemId).toBe(42);
      expect(row.sourceUrl).toBe(ITEM.link);
      expect(row.observedAt).toBe(ITEM.publishedAt);
      expect(row.factHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('donne des hash distincts à deux valeurs différentes du même genre', () => {
    const a = buildImpactRows([ITEM]);
    const b = buildImpactRows([{ ...ITEM, id: 43, link: 'https://www.sudouest.fr/a/2',
      title: 'Incendie en Gironde : 32 000 hectares détruits', description: '' }]);
    const hashA = a.find(r => r.kind === 'area_ha')?.factHash;
    const hashB = b.find(r => r.kind === 'area_ha')?.factHash;
    expect(hashA).toBeDefined();
    expect(hashB).toBeDefined();
    expect(hashA).not.toBe(hashB); // une révision ne doit pas écraser (§12.4)
  });

  it('ignore un item hors sujet sans lever', () => {
    expect(buildImpactRows([{ ...ITEM, title: 'Conseil municipal', description: 'budget voté' }]))
      .toEqual([]);
  });

  it('ignore un item sans lien — provenance incomplète', () => {
    expect(buildImpactRows([{ ...ITEM, link: '' }])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ingest-impact-facts.test.ts`
Expected: FAIL — `buildImpactRows is not exported by api/ingest/news.ts`

- [ ] **Step 3: Enrichir `InsertedItem` et le `RETURNING`**

Dans `api/ingest/news.ts`, remplacer l'interface (l.71-75) :

```ts
interface InsertedItem {
  id: number;
  title: string;
  region: string | null;
  // Ajoutés pour l'extraction des faits d'impact (§5.1) : le texte doit
  // voyager avec l'item, sinon il faut le relire en base.
  link: string;
  description: string;
  publishedAt: string;
  sourceName: string;
  tier: number | null;
}
```

Élargir le `RETURNING` (l.254) :

```ts
        ON CONFLICT (content_hash) DO NOTHING
        RETURNING id, title, link, description, published_at
      `;
      for (const row of rows) {
        inserted.push({
          id: Number(row.id),
          title: String(row.title),
          region: feed.region,
          link: String(row.link ?? ''),
          description: String(row.description ?? ''),
          publishedAt: row.published_at ? new Date(String(row.published_at)).toISOString() : '',
          sourceName: feed.name ?? feed.id,
          tier: feed.tier,
        });
      }
```

- [ ] **Step 4: Ajouter `buildImpactRows` et `persistImpactFacts`**

Après `geocodeInserted` (l.323) :

```ts
// ─── Faits d'impact incendie (§5.1) ───

interface ImpactRow {
  factHash: string;
  newsItemId: number;
  kind: string;
  value: number | null;
  unit: string | null;
  quote: string;
  sourceUrl: string;
  sourceName: string;
  sourceLevel: string;
  reliability: string;
  hedged: boolean;
  observedAt: string;
}

/**
 * Transforme les items ingérés en lignes de faits d'impact.
 * Fonction PURE — exportée pour test, aucun accès base.
 */
export function buildImpactRows(items: InsertedItem[]): ImpactRow[] {
  const rows: ImpactRow[] = [];
  for (const item of items) {
    const text = `${item.title}. ${item.description}`;
    const facts = extractImpactFacts({
      text,
      sourceUrl: item.link,
      sourceName: item.sourceName,
      tier: item.tier,
      observedAt: item.publishedAt,
    }) as Array<Omit<ImpactRow, 'factHash' | 'newsItemId'>>;
    for (const fact of facts) {
      rows.push({
        // Le hash inclut la VALEUR : une révision produit un nouveau fait,
        // elle n'écrase jamais l'ancien (§12.4).
        factHash: contentHash(item.link, fact.kind, String(fact.value ?? 'null')),
        newsItemId: item.id,
        ...fact,
      });
    }
  }
  return rows;
}

/** Insère les faits, en ignorant les doublons exacts. */
async function persistImpactFacts(sql: NeonSql, items: InsertedItem[]): Promise<number> {
  const rows = buildImpactRows(items);
  if (rows.length === 0) return 0;
  const inserted = await sql`
    INSERT INTO fire_impact_facts
      (fact_hash, news_item_id, kind, value, unit, quote,
       source_url, source_name, source_level, reliability, hedged, observed_at)
    SELECT * FROM unnest(
      ${rows.map(r => r.factHash)}::text[],
      ${rows.map(r => r.newsItemId)}::bigint[],
      ${rows.map(r => r.kind)}::text[],
      ${rows.map(r => r.value)}::numeric[],
      ${rows.map(r => r.unit)}::text[],
      ${rows.map(r => r.quote)}::text[],
      ${rows.map(r => r.sourceUrl)}::text[],
      ${rows.map(r => r.sourceName)}::text[],
      ${rows.map(r => r.sourceLevel)}::text[],
      ${rows.map(r => r.reliability)}::text[],
      ${rows.map(r => r.hedged)}::boolean[],
      ${rows.map(r => r.observedAt)}::timestamptz[]
    )
    ON CONFLICT (fact_hash) DO NOTHING
    RETURNING id
  `;
  return inserted.length;
}
```

Ajouter l'import en tête de fichier :

```ts
import { extractImpactFacts } from '../_lib/impact-extractor.js';
```

Vérifier que `contentHash` est déjà importé depuis `../_lib/db.js` ; sinon l'ajouter à l'import existant.

- [ ] **Step 5: Appeler la passe dans le handler**

Après le bloc de géocodage, avant la réponse :

```ts
    // 5. Faits d'impact incendie — best-effort, ne doit jamais faire échouer le tick.
    let impactFacts = 0;
    try {
      impactFacts = await persistImpactFacts(sql, insertedItems);
    } catch (error) {
      errors.push({ feedId: 'impact-facts', error: String(error) });
    }
```

Ajouter `impactFacts` au résumé `IngestTickSummary` et à la réponse JSON.

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/ingest-impact-facts.test.ts tests/ingest.test.ts`
Expected: PASS — les nouveaux tests et la suite d'ingestion existante.

- [ ] **Step 7: Typecheck et commit**

```bash
npm run typecheck && npm test
git add api/ingest/news.ts tests/ingest-impact-facts.test.ts
git commit -m "feat: extraction des faits d'impact dans le cron d'ingestion"
```

---

### Task 4: Endpoint de lecture — des séries, jamais un scalaire

**Files:**
- Create: `api/fires/impacts.js`
- Test: `tests/fires-impacts-endpoint.test.ts`

**Interfaces:**
- Consumes: table `fire_impact_facts` (Task 2).
- Produces: `GET /api/fires/impacts?dept=33&since=<ISO>` →
  `{ facts: ImpactFactDTO[], deptCodes: string[], generatedAt: string }`.
  `ImpactFactDTO = { id, kind, value, unit, quote, sourceUrl, sourceName, sourceLevel, reliability, hedged, provisional, observedAt, communes }`.
  Export testable : `buildImpactsQueryParams(query)`.

- [ ] **Step 0: Corriger l'interception trop large de `fires-proxy` (BLOQUANT)**

`src/plugins/fires-proxy.ts:129` fait `server.middlewares.use('/api/fires', …)`. Connect traite
ce chemin comme un **préfixe** : le middleware capture donc aussi `/api/fires/impacts`. Et le
handler ignore `_req` — il renvoie systématiquement le payload FIRMS.

Sans ce correctif, `/api/fires/impacts` ne renvoie pas 404 en dev : il renvoie **les détections
FIRMS déguisées en faits d'impact**. Une réponse fausse et silencieuse, pire qu'une erreur.

Rendre l'interception exacte :

```ts
        configureServer(server) {
            server.middlewares.use('/api/fires', async (req, res, next) => {
                // Connect traite '/api/fires' comme un PRÉFIXE : sans ce garde,
                // /api/fires/impacts serait servi avec le payload FIRMS.
                const path = (req.url ?? '').split('?')[0];
                if (path !== '/' && path !== '') return next();
```

`req.url` est relatif au point de montage : pour `/api/fires` il vaut `/` ou `''`, pour
`/api/fires/impacts` il vaut `/impacts`. Passer la main à `next()` laisse le proxy suivant
répondre.

Vérifier ensuite que `/api/fires` fonctionne toujours en dev — c'est la source de tout le panneau
incendies, une régression ici casse la carte.

- [ ] **Step 1: Write the failing test**

```ts
// tests/fires-impacts-endpoint.test.ts
import { describe, expect, it } from 'vitest';
import { buildImpactsQueryParams, toImpactDto } from '../api/fires/impacts.js';

describe('buildImpactsQueryParams', () => {
  it('accepte plusieurs départements — un incident peut en couvrir plusieurs (§3.5)', () => {
    expect(buildImpactsQueryParams({ dept: '33,40' }).deptCodes).toEqual(['33', '40']);
  });

  it('rejette un code département malformé', () => {
    expect(() => buildImpactsQueryParams({ dept: "33; DROP TABLE" })).toThrow(/département/i);
  });

  it('exige au moins un département', () => {
    expect(() => buildImpactsQueryParams({})).toThrow(/département/i);
  });

  it('borne la fenêtre par défaut et refuse une date invalide', () => {
    expect(buildImpactsQueryParams({ dept: '33' }).since).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(() => buildImpactsQueryParams({ dept: '33', since: 'hier' })).toThrow(/since/i);
  });
});

describe('toImpactDto', () => {
  it('expose la provenance et ne calcule aucune credibility', () => {
    const dto = toImpactDto({
      id: 1, kind: 'area_ha', value: '42000', unit: 'ha', quote: '42 000 hectares',
      source_url: 'https://x/1', source_name: 'Sud Ouest', source_level: 'secondary',
      reliability: 'D', hedged: false, provisional: true,
      observed_at: '2026-07-26T08:00:00.000Z', communes: ['Le Porge'],
    });
    expect(dto.value).toBe(42000);
    expect(dto.reliability).toBe('D');
    expect(dto.observedAt).toBe('2026-07-26T08:00:00.000Z');
    expect(dto).not.toHaveProperty('credibility'); // dérivée côté client (§12.1)
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/fires-impacts-endpoint.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Write the implementation**

```js
// api/fires/impacts.js
/**
 * GET /api/fires/impacts?dept=33,40&since=<ISO>
 *
 * Renvoie la SÉRIE des faits d'impact, pas un état courant.
 * Il n'existe volontairement aucun paramètre « latest » ni agrégat :
 * réconcilier des chiffres divergents est une faute (§12.4).
 */

import { getDb, hasDatabaseUrl } from '../_lib/db.js';

const DEPT_RE = /^(?:0[1-9]|[1-8]\d|9[0-5]|2[AB]|97[1-6])$/;
const DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FACTS = 500;

/**
 * @param {Record<string, string|undefined>} query
 * @returns {{deptCodes: string[], since: string}}
 */
export function buildImpactsQueryParams(query) {
  const raw = String(query?.dept ?? '').trim();
  if (!raw) throw new Error('paramètre "dept" requis : au moins un code département');
  const deptCodes = raw.split(',').map(s => s.trim()).filter(Boolean);
  if (deptCodes.length === 0) throw new Error('paramètre "dept" requis');
  for (const code of deptCodes) {
    if (!DEPT_RE.test(code)) throw new Error(`code département invalide : ${code}`);
  }
  let since;
  if (query?.since) {
    const parsed = Date.parse(String(query.since));
    if (Number.isNaN(parsed)) throw new Error('paramètre "since" invalide : ISO 8601 attendu');
    since = new Date(parsed).toISOString();
  } else {
    since = new Date(Date.now() - DEFAULT_WINDOW_MS).toISOString();
  }
  return { deptCodes, since };
}

/** @param {Record<string, unknown>} row */
export function toImpactDto(row) {
  return {
    id: Number(row.id),
    kind: String(row.kind),
    value: row.value === null || row.value === undefined ? null : Number(row.value),
    unit: row.unit === null || row.unit === undefined ? null : String(row.unit),
    quote: String(row.quote),
    sourceUrl: String(row.source_url),
    sourceName: String(row.source_name),
    sourceLevel: String(row.source_level),
    reliability: String(row.reliability),
    hedged: Boolean(row.hedged),
    provisional: Boolean(row.provisional),
    observedAt: new Date(String(row.observed_at)).toISOString(),
    communes: Array.isArray(row.communes) ? row.communes.map(String) : [],
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (!hasDatabaseUrl()) {
    res.status(503).json({ error: 'base non configurée' });
    return;
  }
  let params;
  try {
    params = buildImpactsQueryParams(req.query ?? {});
  } catch (error) {
    res.status(422).json({ error: String(error instanceof Error ? error.message : error) });
    return;
  }
  try {
    const sql = getDb();
    const rows = await sql`
      SELECT id, kind, value, unit, quote, source_url, source_name, source_level,
             reliability, hedged, provisional, observed_at, communes
      FROM fire_impact_facts
      WHERE observed_at >= ${params.since}
        AND (dept_code IS NULL OR dept_code = ANY(${params.deptCodes}::text[]))
      ORDER BY observed_at ASC
      LIMIT ${MAX_FACTS}
    `;
    res.setHeader('Cache-Control', 'public, max-age=120');
    res.status(200).json({
      facts: rows.map(toImpactDto),
      deptCodes: params.deptCodes,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[fires/impacts]', error);
    res.status(502).json({ error: 'lecture des faits d\'impact indisponible' });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/fires-impacts-endpoint.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Créer le miroir dev**

`CLAUDE.md` impose que toute route `/api/*` ait son miroir Vite dev. Créer
`src/plugins/fires-dossier-proxy.ts` exportant `firesDossierProxyPlugin()`, sur le modèle
structurel de `src/plugins/news-proxy.ts`, et l'enregistrer dans `vite.config.ts`
**avant** `firesProxyPlugin()`.

Il monte `/api/fires/impacts` et réutilise `buildImpactsQueryParams` / `toImpactDto` du handler
— pas de logique dupliquée, sinon les deux implémentations divergent (piège connu du projet :
les fichiers edge et proxy dev sont des **miroirs**). En dev sans `DATABASE_URL`, il répond
`{ facts: [], deptCodes, generatedAt }` avec un code 200 : le dossier s'affiche alors avec la
détection seule et la mention « impacts non renseignés », ce qu'exige le §7.

- [ ] **Step 6: Vérifier le routage en dev**

```bash
npm run dev:vite &
sleep 6
curl -s -o /dev/null -w "/api/fires          -> %{http_code}\n" "http://localhost:3001/api/fires"
curl -s -w "/api/fires/impacts  -> %{http_code}\n" "http://localhost:3001/api/fires/impacts?dept=33"
kill %1
```

Attendu : `/api/fires` renvoie 200 avec ses détections (non régressé) ; `/api/fires/impacts`
renvoie 200 avec `facts`, et **surtout pas** le payload FIRMS.

- [ ] **Step 7: Commit**

```bash
npm run typecheck
git add api/fires/impacts.js tests/fires-impacts-endpoint.test.ts \
        src/plugins/fires-dossier-proxy.ts src/plugins/fires-proxy.ts vite.config.ts
git commit -m "feat: endpoint /api/fires/impacts exposant des séries de faits"
```

---

### Task 5: Types partagés et sélection des incidents majeurs

**Files:**
- Modify: `src/types/index.ts` (après `FireIncidentScore`, ~l.443)
- Create: `src/services/wildfire-dossier.ts`
- Test: `src/services/wildfire-dossier.test.ts`

**Interfaces:**
- Consumes: `FireIncident`, `FireIncidentScore` (existants), `ImpactFactDTO` (Task 4), fixture `gironde-2026-07-26-viirs.json`, `clusterFireDetections` (existant).
- Produces:
  - Types `SourceLevel`, `Reliability`, `Credibility`, `ImpactFactKind`, `ImpactFact`, `LocatedFireIncident`, `WildfireDossier`
    (la sévérité réutilise `SituationSeverity`, déjà existant — pas de type dédié, voir §6.3)
  - `MAJOR_FIRE_GATE = { minDetections: 40, minFrpTotal: 300 }`
  - `selectMajorIncidents(incidents: FireIncident[]): FireIncident[]`
  - `wildfireSeverity(incident: FireIncident): SituationSeverity`

- [ ] **Step 1: Write the failing test — fixture-contrat**

```ts
// src/services/wildfire-dossier.test.ts
import { describe, expect, it } from 'vitest';
import type { ActiveFire } from '../types/index.ts';
import { clusterFireDetections } from './fire-clustering.ts';
import { selectMajorIncidents, wildfireSeverity } from './wildfire-dossier.ts';
import fixture from './__fixtures__/gironde-2026-07-26-viirs.json';

// Fixture-contrat : ces cibles viennent des données réelles du 2026-07-26.
// NE JAMAIS les ajuster pour faire passer un changement de formule (§4.2).
const detections = fixture as unknown as ActiveFire[];

describe('selectMajorIncidents — calibration Gironde', () => {
  const incidents = clusterFireDetections(detections);

  it('isole le front principal et le second front, rien d\'autre', () => {
    const major = selectMajorIncidents(incidents);
    // « rien d'autre » doit être vérifié, pas seulement annoncé dans le titre :
    // la fixture réelle produit 8 clusters, dont exactement 2 franchissent la porte.
    expect(major).toHaveLength(2);
    const biggest = [...major].sort((a, b) => b.detectionsCount - a.detectionsCount)[0];
    expect(biggest.detectionsCount).toBeGreaterThan(400);
    expect(biggest.frpTotal).toBeGreaterThan(5000);
  });

  it('classe le front principal en critical', () => {
    const biggest = [...incidents].sort((a, b) => b.detectionsCount - a.detectionsCount)[0];
    expect(wildfireSeverity(biggest)).toBe('critical');
  });

  it('écarte tout cluster sous la porte d\'entrée', () => {
    const major = selectMajorIncidents(incidents);
    for (const incident of major) {
      expect(incident.detectionsCount).toBeGreaterThanOrEqual(40);
      expect(incident.frpTotal).toBeGreaterThanOrEqual(300);
    }
    const rejected = incidents.filter(i => !major.includes(i));
    for (const incident of rejected) {
      expect(incident.detectionsCount < 40 || incident.frpTotal < 300).toBe(true);
    }
  });

  it('ne retient jamais un cluster de 22 détections (bruit de fond estival)', () => {
    const major = selectMajorIncidents(incidents);
    expect(major.every(i => i.detectionsCount > 22)).toBe(true);
  });
});

describe('wildfireSeverity — bandes', () => {
  const base = {
    id: 'x', centroidLat: 44.8, centroidLon: -0.9,
    bboxMinLat: 44, bboxMaxLat: 45, bboxMinLon: -1, bboxMaxLon: 0,
    frpMean: 10, frpMax: 100, confidenceMax: 'nominal' as const,
    startDatetime: '2026-07-26T00:00:00Z', endDatetime: '2026-07-26T12:00:00Z',
    durationMinutes: 720, satellites: ['SNPP'], hasNightDetection: true,
    clusterMethod: 'dbscan' as const, epsKm: 3, minPoints: 2,
    score: { severityScore: 50, impactScore: 50, labels: [] },
    detectionIds: [],
  };

  it('applique les seuils du §4 sans dépendre du FRP moyen', () => {
    expect(wildfireSeverity({ ...base, detectionsCount: 650, frpTotal: 7178, nearUrban: false })).toBe('critical');
    expect(wildfireSeverity({ ...base, detectionsCount: 120, frpTotal: 900, nearUrban: false })).toBe('high');
    expect(wildfireSeverity({ ...base, detectionsCount: 57, frpTotal: 488, nearUrban: false })).toBe('medium');
    expect(wildfireSeverity({ ...base, detectionsCount: 50, frpTotal: 3200, nearUrban: true })).toBe('critical');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/wildfire-dossier.test.ts`
Expected: FAIL — `Failed to resolve import './wildfire-dossier.ts'`

- [ ] **Step 3: Ajouter les types partagés**

Dans `src/types/index.ts`, après `FireIncidentScore` :

```ts
/** Niveau de source, indépendant de sa fiabilité (§12.2 du design). */
export type SourceLevel = 'primary' | 'secondary' | 'tertiary';

/** Fiabilité de la source, code Admiralty simplifié (§12.1). */
export type Reliability = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

/** Crédibilité de l'information : DÉRIVÉE à l'assemblage, jamais stockée (§12.1). */
export type Credibility = 1 | 2 | 3 | 4 | 5 | 6;

export type ImpactFactKind =
  | 'area_ha' | 'evacuated' | 'dwellings_destroyed' | 'injured'
  | 'evacuation_order' | 'road_closed' | 'rail_disrupted';

/**
 * Un fait d'impact déclaré. L'unité est LE FAIT, pas le nombre :
 * `value` est nul pour un ordre d'évacuation (§3.4).
 */
export interface ImpactFact {
  id: number;
  kind: ImpactFactKind;
  value: number | null;
  unit: string | null;
  quote: string;              // phrase source verbatim — obligatoire (§3.3)
  sourceUrl: string;
  sourceName: string;
  sourceLevel: SourceLevel;
  reliability: Reliability;
  hedged: boolean;
  provisional: boolean;
  observedAt: string;
  communes: string[];
  credibility?: Credibility;  // calculée par buildDossier
  corroboration?: string[];   // sources indépendantes (§12.3)
}

/**
 * Un incident dont la géographie administrative a été résolue.
 * `FireIncident` ne porte QUE des coordonnées : le rattachement commune/département
 * exige un appel réseau (geo.api.gouv.fr), donc il vit dans un type distinct
 * produit par resolveIncidentGeography (Task 10).
 */
export interface LocatedFireIncident extends FireIncident {
  deptCodes: string[];
  communes: string[];
}

/** Dossier d'incident : observé et déclaré côte à côte, jamais fusionnés (§12.5). */
export interface WildfireDossier {
  incident: FireIncident;
  severity: SituationSeverity;
  deptCodes: string[];        // un incident peut en couvrir plusieurs (§3.5)
  communes: string[];
  facts: ImpactFact[];
  /** Séries par genre, ordonnées dans le temps. Aucune valeur réconciliée (§12.4). */
  series: Record<ImpactFactKind, ImpactFact[]>;
}
```

- [ ] **Step 3b: Étendre `FranceRawData`**

`FranceRawData` est défini dans `src/services/france-country-intel.ts` (**pas** dans
`types/index.ts`) et ne connaît aujourd'hui que `activeFires`. Le détecteur de la Task 7 a besoin
des incidents déjà clusterisés — les recalculer dans la règle dupliquerait un DBSCAN que `App.ts`
exécute déjà.

Ajouter au type `FranceRawData` :

```ts
  /** Incidents clusterisés et géo-résolus, fournis par App.ts (Task 10). */
  fireIncidents?: LocatedFireIncident[];
```

Champ **optionnel** : les consommateurs existants de `FranceRawData` ne doivent pas casser.

- [ ] **Step 4: Write the implementation**

```ts
// src/services/wildfire-dossier.ts
/**
 * wildfire-dossier.ts — Sélection et assemblage des dossiers « grand feu ».
 *
 * Fonctions PURES uniquement : aucun accès réseau, aucun DOM.
 * L'effet de bord Ollama vit dans wildfire-enrich.ts.
 *
 * Voir docs/design-alertes-grands-feux-2026-07.md §4, §12.
 */

import type { FireIncident, SituationSeverity } from '../types/index.ts';

/**
 * Porte d'entrée « grand feu », calibrée sur l'épisode Gironde du 2026-07-26 :
 * le front principal comptait 650 détections / 7 178 MW, le plus gros cluster
 * hors zone 22 détections. Voir §4.1 — et la réserve du §4.3 : la fixture est
 * une traîne, pas un pic, donc cette porte est volontairement conservatrice.
 */
export const MAJOR_FIRE_GATE = { minDetections: 40, minFrpTotal: 300 } as const;

/** Sévérité d'un incident. Ne dépend PAS du FRP moyen (mauvais discriminant, §4.1). */
export function wildfireSeverity(incident: FireIncident): SituationSeverity {
  const { detectionsCount, frpTotal, nearUrban } = incident;
  if (detectionsCount >= 300 || (frpTotal >= 3000 && nearUrban)) return 'critical';
  if (detectionsCount >= 100 || frpTotal >= 1500) return 'high';
  return 'medium';
}

/** Retient les incidents franchissant la porte d'entrée. */
// Générique : préserve le sous-type de l'appelant (LocatedFireIncident) sans
// cast, puisque la fonction ne fait que filtrer et ne transforme jamais.
export function selectMajorIncidents<T extends FireIncident>(incidents: T[]): T[] {
  return incidents.filter(
    incident =>
      incident.detectionsCount >= MAJOR_FIRE_GATE.minDetections &&
      incident.frpTotal >= MAJOR_FIRE_GATE.minFrpTotal,
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/services/wildfire-dossier.test.ts`
Expected: PASS — 5 tests.

Si `clusterFireDetections` exige des options, les passer explicitement (`{ epsKm: 3, minPoints: 2 }`) pour que la fixture-contrat reste reproductible.

- [ ] **Step 6: Typecheck et commit**

```bash
npm run typecheck && npx vitest run src/services/wildfire-dossier.test.ts
git add src/types/index.ts src/services/wildfire-dossier.ts src/services/wildfire-dossier.test.ts
git commit -m "feat: sélection des incidents majeurs calibrée sur l'épisode Gironde"
```

---

### Task 6: Assemblage du dossier — corroboration et non-réconciliation

**Files:**
- Modify: `src/services/wildfire-dossier.ts`
- Test: `src/services/wildfire-dossier.test.ts` (compléter)

**Interfaces:**
- Consumes: `selectMajorIncidents`, `wildfireSeverity` (Task 5), `ImpactFact` (Task 5).
- Produces:
  - `gradeCredibility(fact: ImpactFact, corroboration: string[]): Credibility`
  - `buildDossier(incident, facts, deptCodes): WildfireDossier`

- [ ] **Step 1: Write the failing test**

```ts
// à ajouter dans src/services/wildfire-dossier.test.ts
import { buildDossier, gradeCredibility } from './wildfire-dossier.ts';
import type { FireIncident, ImpactFact } from '../types/index.ts';

function fact(over: Partial<ImpactFact> = {}): ImpactFact {
  return {
    id: 1, kind: 'area_ha', value: 42000, unit: 'ha',
    quote: '42 000 hectares de forêt ont été détruits',
    sourceUrl: 'https://www.sudouest.fr/a/1', sourceName: 'Sud Ouest',
    sourceLevel: 'secondary', reliability: 'D',
    hedged: false, provisional: true,
    observedAt: '2026-07-26T08:00:00Z', communes: [],
    ...over,
  };
}

const INCIDENT = {
  id: 'gironde', centroidLat: 44.78, centroidLon: -0.93,
  bboxMinLat: 44.37, bboxMaxLat: 44.97, bboxMinLon: -1.22, bboxMaxLon: -0.61,
  detectionsCount: 650, frpMean: 11, frpMax: 222, frpTotal: 7178,
  confidenceMax: 'high' as const,
  startDatetime: '2026-07-26T01:32:00Z', endDatetime: '2026-07-26T12:55:00Z',
  durationMinutes: 683, satellites: ['SNPP', 'NOAA-20'], hasNightDetection: true,
  nearUrban: true, clusterMethod: 'dbscan' as const, epsKm: 3, minPoints: 2,
  score: { severityScore: 90, impactScore: 80, labels: [] }, detectionIds: [],
} satisfies FireIncident;

describe('gradeCredibility', () => {
  it('note 1 une source primaire corroborée, 3 une primaire isolée', () => {
    const official = fact({ sourceLevel: 'primary', reliability: 'A' });
    expect(gradeCredibility(official, ['Préfecture', 'Sud Ouest'])).toBe(1);
    expect(gradeCredibility(official, ['Préfecture'])).toBe(3);
  });

  it('note 2 une info corroborée sans source primaire, 4 une secondaire isolée', () => {
    expect(gradeCredibility(fact(), ['Sud Ouest', 'France Info'])).toBe(2);
    expect(gradeCredibility(fact(), ['Sud Ouest'])).toBe(4);
  });

  it('dégrade en 5 une formulation approximative isolée', () => {
    expect(gradeCredibility(fact({ hedged: true }), ['Sud Ouest'])).toBe(5);
  });

  it('note 6 un fait tertiaire isolé — ne peut être jugé', () => {
    expect(gradeCredibility(fact({ sourceLevel: 'tertiary' }), ['Wikipédia'])).toBe(6);
  });
});

describe('buildDossier', () => {
  it('conserve DEUX valeurs divergentes sans les réconcilier (§12.4)', () => {
    const dossier = buildDossier(INCIDENT, [
      fact({ id: 1, value: 32000, observedAt: '2026-07-25T12:00:00Z' }),
      fact({ id: 2, value: 42000, observedAt: '2026-07-26T08:00:00Z' }),
    ], ['33']);
    expect(dossier.series.area_ha).toHaveLength(2);
    expect(dossier.series.area_ha.map(f => f.value)).toEqual([32000, 42000]);
    // aucune propriété n'expose une valeur unique réconciliée
    expect(Object.keys(dossier)).not.toContain('currentAreaHa');
    expect(Object.keys(dossier)).not.toContain('latestAreaHa');
  });

  it('ordonne chaque série chronologiquement', () => {
    const dossier = buildDossier(INCIDENT, [
      fact({ id: 2, value: 42000, observedAt: '2026-07-26T08:00:00Z' }),
      fact({ id: 1, value: 32000, observedAt: '2026-07-25T12:00:00Z' }),
    ], ['33']);
    expect(dossier.series.area_ha.map(f => f.observedAt))
      .toEqual(['2026-07-25T12:00:00Z', '2026-07-26T08:00:00Z']);
  });

  it('ne compte qu\'une corroboration pour deux reprises de la même source', () => {
    const dossier = buildDossier(INCIDENT, [
      fact({ id: 1, sourceName: 'Sud Ouest', sourceUrl: 'https://www.sudouest.fr/a/1' }),
      fact({ id: 2, sourceName: 'Sud Ouest', sourceUrl: 'https://www.sudouest.fr/a/2' }),
    ], ['33']);
    expect(dossier.series.area_ha[0].corroboration).toEqual(['Sud Ouest']);
    expect(dossier.series.area_ha[0].credibility).toBe(4); // isolée, pas corroborée
  });

  it('rejette un fait sans provenance complète plutôt que de l\'afficher', () => {
    const dossier = buildDossier(INCIDENT, [
      fact({ id: 1 }),
      fact({ id: 2, quote: '' }),
      fact({ id: 3, sourceUrl: '' }),
      fact({ id: 4, observedAt: '' }),
    ], ['33']);
    expect(dossier.facts.map(f => f.id)).toEqual([1]);
  });

  it('porte plusieurs départements et agrège les communes sans doublon', () => {
    const dossier = buildDossier(INCIDENT, [
      fact({ id: 1, communes: ['Le Porge', 'Lanton'] }),
      fact({ id: 2, value: 3500, communes: ['Lanton', 'Biscarrosse'] }),
    ], ['33', '40']);
    expect(dossier.deptCodes).toEqual(['33', '40']);
    expect(dossier.communes).toEqual(['Biscarrosse', 'Lanton', 'Le Porge']);
  });

  it('reporte la sévérité de l\'incident, indépendante des faits déclarés (§12.5)', () => {
    expect(buildDossier(INCIDENT, [], ['33']).severity).toBe('critical');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/wildfire-dossier.test.ts`
Expected: FAIL — `buildDossier is not exported`

- [ ] **Step 3: Write the implementation**

Ajouter à `src/services/wildfire-dossier.ts` :

```ts
import type {
  Credibility, ImpactFact, ImpactFactKind, WildfireDossier,
} from '../types/index.ts';

const FACT_KINDS: ImpactFactKind[] = [
  'area_ha', 'evacuated', 'dwellings_destroyed', 'injured',
  'evacuation_order', 'road_closed', 'rail_disrupted',
];

/** Un fait sans provenance complète n'est pas affichable (§3.3). */
function hasFullProvenance(fact: ImpactFact): boolean {
  return Boolean(fact.quote && fact.sourceUrl && fact.sourceName && fact.observedAt);
}

/**
 * Crédibilité de l'information, dérivée — jamais stockée (§12.1).
 * Deux reprises d'une même source ne font pas une corroboration (§12.3).
 */
export function gradeCredibility(fact: ImpactFact, corroboration: string[]): Credibility {
  const corroborated = new Set(corroboration).size >= 2;
  if (fact.sourceLevel === 'tertiary' && !corroborated) return 6;
  if (fact.hedged && !corroborated) return 5;
  if (corroborated) return fact.sourceLevel === 'primary' ? 1 : 2;
  return fact.sourceLevel === 'primary' ? 3 : 4;
}

/**
 * Assemble un dossier. Regroupe les faits en SÉRIES chronologiques :
 * aucune valeur n'est moyennée, choisie ou écrasée (§12.4).
 */
export function buildDossier(
  incident: FireIncident,
  facts: ImpactFact[],
  deptCodes: string[],
): WildfireDossier {
  const usable = facts.filter(hasFullProvenance);

  // Corroboration par (genre, valeur) : qui affirme le même fait ?
  const assertions = new Map<string, Set<string>>();
  for (const fact of usable) {
    const key = `${fact.kind}|${fact.value ?? 'null'}`;
    const sources = assertions.get(key) ?? new Set<string>();
    sources.add(fact.sourceName);
    assertions.set(key, sources);
  }

  const graded = usable
    .map(fact => {
      const corroboration = [...(assertions.get(`${fact.kind}|${fact.value ?? 'null'}`) ?? [])].sort();
      return { ...fact, corroboration, credibility: gradeCredibility(fact, corroboration) };
    })
    .sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));

  const series = Object.fromEntries(
    FACT_KINDS.map(kind => [kind, graded.filter(f => f.kind === kind)]),
  ) as Record<ImpactFactKind, ImpactFact[]>;

  const communes = [...new Set(graded.flatMap(f => f.communes))].sort((a, b) =>
    a.localeCompare(b, 'fr'),
  );

  return {
    incident,
    severity: wildfireSeverity(incident),
    // Trié comme communes : sans cela, buildDossier(..., ['40','33']) et
    // buildDossier(..., ['33','40']) produiraient des dossiers différents.
    deptCodes: [...new Set(deptCodes)].sort(),
    communes,
    facts: graded,
    series,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/wildfire-dossier.test.ts`
Expected: PASS — 15 tests au total sur ce fichier.

- [ ] **Step 5: Typecheck et commit**

```bash
npm run typecheck && npm test
git add src/services/wildfire-dossier.ts src/services/wildfire-dossier.test.ts
git commit -m "feat: assemblage du dossier avec corroboration et séries non réconciliées"
```

---

### Task 7: Détecteur par incident — corriger le capteur saturé

**Files:**
- Modify: `src/services/situation-engine.ts` (`detectWildfireEscalation`, l.245-284 ; `RULES`, l.568)
- Test: `src/services/situation-engine.wildfire.test.ts`

**Interfaces:**
- Consumes: `selectMajorIncidents`, `wildfireSeverity` (Task 5).
- Produces: `detectWildfireIncidents(raw: FranceRawData): DetectedSituation[]` — remplace la règle
  mono-situation. **`RULES` garde sa signature** `Array<(raw) => DetectedSituation | null>` : la
  règle incendie est appelée **à part**, hors de la boucle `RULES`, dans son propre `try/catch`.
- Produces: `selectMajorIncidents<T extends FireIncident>(incidents: T[]): T[]` — la fonction de la
  Task 5 devient **générique** pour préserver le sous-type `LocatedFireIncident` sans cast.

- [ ] **Step 1: Write the failing test**

```ts
// src/services/situation-engine.wildfire.test.ts
import { describe, expect, it } from 'vitest';
import type { LocatedFireIncident } from '../types/index.ts';
import type { FranceRawData } from './france-country-intel.ts';
import { detectWildfireIncidents } from './situation-engine.ts';

function incident(over: Partial<LocatedFireIncident> & { id: string }): LocatedFireIncident {
  return {
    centroidLat: 44.78, centroidLon: -0.93,
    bboxMinLat: 44.7, bboxMaxLat: 44.9, bboxMinLon: -1.0, bboxMaxLon: -0.8,
    detectionsCount: 650, frpMean: 11, frpMax: 222, frpTotal: 7178,
    confidenceMax: 'high', startDatetime: '2026-07-26T01:32:00Z',
    endDatetime: '2026-07-26T12:55:00Z', durationMinutes: 683,
    satellites: ['SNPP'], hasNightDetection: true, nearUrban: true,
    clusterMethod: 'dbscan', epsKm: 3, minPoints: 2,
    score: { severityScore: 90, impactScore: 80, labels: [] },
    detectionIds: [],
    deptCodes: ['33'],
    communes: ['Lanton'],
    ...over,
  } as LocatedFireIncident;
}

function raw(incidents: LocatedFireIncident[]): FranceRawData {
  return { activeFires: [], fireIncidents: incidents, meteoAlerts: [] } as unknown as FranceRawData;
}

describe('detectWildfireIncidents', () => {
  it('émet UNE situation par incident majeur, localisée', () => {
    const situations = detectWildfireIncidents(raw([
      incident({ id: 'front-principal' }),
      incident({ id: 'second-front', detectionsCount: 57, frpTotal: 488 }),
    ]));
    expect(situations).toHaveLength(2);
    expect(situations.map(s => s.severity)).toEqual(['critical', 'medium']);
    for (const situation of situations) {
      expect(situation.type).toBe('WILDFIRE_ESCALATION');
      // Le défaut corrigé : plus jamais ['France'] (§1.3)
      expect(situation.affectedZones).not.toEqual(['France']);
      expect(situation.affectedZones.length).toBeGreaterThan(0);
      expect(situation.id).toContain('wildfire');
    }
  });

  it('n\'émet rien sous la porte d\'entrée, même avec beaucoup de petits foyers', () => {
    const petits = Array.from({ length: 30 }, (_, i) =>
      incident({ id: `petit-${i}`, detectionsCount: 22, frpTotal: 361 }));
    expect(detectWildfireIncidents(raw(petits))).toEqual([]);
  });

  it('donne des identifiants stables et distincts', () => {
    const situations = detectWildfireIncidents(raw([
      incident({ id: 'a' }), incident({ id: 'b', detectionsCount: 120, frpTotal: 900 }),
    ]));
    expect(new Set(situations.map(s => s.id)).size).toBe(2);
    const again = detectWildfireIncidents(raw([incident({ id: 'a' })]));
    expect(again[0].id).toBe(situations[0].id);
  });

  it('n\'invente aucun chiffre d\'impact dans le résumé', () => {
    const [situation] = detectWildfireIncidents(raw([incident({ id: 'a' })]));
    expect(situation.summary).not.toMatch(/hectare/i);
    expect(situation.summary).not.toMatch(/[ée]vacu/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/situation-engine.wildfire.test.ts`
Expected: FAIL — `detectWildfireIncidents is not exported`

- [ ] **Step 3: Remplacer le détecteur**

Dans `src/services/situation-engine.ts`, remplacer `detectWildfireEscalation` (l.245-284) :

```ts
// ─── Règle 4 : WILDFIRE_ESCALATION, une situation PAR INCIDENT ───────────────
//
// L'ancienne version comptait raw.activeFires.length au national avec un seuil
// critical de 20. Mesuré le 2026-07-26 : 886 détections en France métropole,
// donc le capteur restait épinglé sur critical tout l'été en indiquant
// seulement « France ». Voir §1.3 du design.

export function detectWildfireIncidents(raw: FranceRawData): DetectedSituation[] {
  const incidents = raw.fireIncidents ?? [];
  if (incidents.length === 0) return [];

  return selectMajorIncidents(incidents).map(incident => {
    const severity = wildfireSeverity(incident);
    // deptCodes vient de LocatedFireIncident (Task 10). Si la résolution
    // géographique n'a pas encore abouti, on affiche les coordonnées plutôt
    // que « France » : une position vaut mieux qu'une zone qui ne dit rien.
    const zone = incident.deptCodes.length > 0
      ? incident.deptCodes.map(code => `Dépt ${code}`)
      : [`${incident.centroidLat.toFixed(2)} N, ${incident.centroidLon.toFixed(2)} E`];
    const extentKm = Math.round((incident.bboxMaxLat - incident.bboxMinLat) * 111);

    return situation(
      `wildfire-${incident.id}`,
      'WILDFIRE_ESCALATION',
      severity,
      Math.min(0.9, 0.6 + Math.min(incident.detectionsCount, 600) / 600 * 0.3),
      'Incendie majeur en cours',
      // Uniquement de l'OBSERVÉ : les hectares et les évacuations sont des
      // faits déclarés, ils vivent dans le dossier, pas dans l'alerte (§12.5).
      `${incident.detectionsCount} détections VIIRS agrégées, ${Math.round(incident.frpTotal)} MW cumulés, emprise ~${extentKm} km.`,
      zone,
      [
        `${incident.detectionsCount} détections sur ${incident.satellites.join(', ')}`,
        `Puissance radiative cumulée ${Math.round(incident.frpTotal)} MW`,
        ...(incident.nearUrban ? ['Foyer à moins de 15 km d\'une zone urbanisée'] : []),
        ...(incident.hasNightDetection ? ['Activité nocturne confirmée'] : []),
      ],
      [
        action('Ouvrir le dossier d\'incident', 'Analyste OSINT', 'investigate', true),
        action('Croiser avec les communiqués préfectoraux', 'Analyste OSINT', 'cross-check'),
      ],
      ['NASA FIRMS'],
    );
  });
}
```

Ajouter l'import en tête :

```ts
import type { LocatedFireIncident } from '../types/index.ts';
import { selectMajorIncidents, wildfireSeverity } from './wildfire-dossier.ts';
```

`FranceRawData` est déjà importé depuis `./france-country-intel.ts` en tête du fichier (l.20) —
ne pas le réimporter.

- [ ] **Step 4: Adapter `RULES` aux règles multi-situations**

Retirer `detectWildfireEscalation` de `RULES` (l.568) et appeler la nouvelle règle à part dans
`detectSituations` (l.585). **Ne pas réécrire la fonction** : elle porte trois propriétés à
préserver, vérifiées dans le code réel.

1. Un `try/catch` **par règle** — « une règle ne doit jamais faire crasher l'engine » (l.589-595).
2. Un tri à **deux critères** : sévérité, puis confiance (l.599-603).
3. Un `.slice(0, 10)` final (l.604).

Insertion minimale, après la boucle `for (const rule of RULES)` et avant le `return results` :

```ts
  // Règle multi-situations : une alerte par incident majeur (§5.3).
  // Même isolation que les autres règles — un incident mal formé ne doit pas
  // emporter tout le moteur.
  try {
    results.push(...detectWildfireIncidents(raw));
  } catch (err) {
    console.warn('[SituationEngine] Wildfire rule error:', err);
  }
```

**Le plafond de 10 demande une décision explicite.** `detectSituations` tronque à 10 situations.
Une règle qui en émet désormais plusieurs peut faire dépasser ce plafond, et le `.slice()` est
**silencieux** : un second front d'incendie en `medium` disparaîtrait sans trace, ce que le §7
interdit (« une donnée manquante s'affiche comme manquante »).

Ne pas relever le plafond — hors périmètre. Rendre la troncature **visible** :

```ts
  const ranked = results.sort(/* tri existant, inchangé */);
  if (ranked.length > 10) {
    console.warn(
      `[SituationEngine] ${ranked.length - 10} situation(s) tronquée(s) par le plafond de 10`,
    );
  }
  return ranked.slice(0, 10);
```

- [ ] **Step 4b: Test du plafond**

```ts
it('ne tronque jamais un incendie critical en silence', () => {
  const incidents = Array.from({ length: 14 }, (_, i) =>
    incident({ id: `front-${i}`, detectionsCount: 650, frpTotal: 7178 }));
  const situations = detectWildfireIncidents(raw(incidents));
  // La règle elle-même n'applique aucun plafond : le tri de detectSituations
  // place les critical en tête, et toute troncature est journalisée.
  expect(situations).toHaveLength(14);
  expect(situations.every(s => s.severity === 'critical')).toBe(true);
});
```

- [ ] **Step 5: Migrer le test existant qui va casser (identifié, pas hypothétique)**

`src/services/situation-engine.test.ts:247` contient :

```ts
  it('wildfire fixture emits WILDFIRE_ESCALATION', () => {
    assertHasSituation(wildfireFixture(), 'WILDFIRE_ESCALATION');
  });
```

Sa fixture (`:108-129`) alimente **6 `activeFires`** et une vigilance météo orange. Le nouveau
détecteur lit `raw.fireIncidents`, donc **ce test échouera** — c'est attendu : le déclenchement
sur un compte national d'`activeFires` *était* le défaut (§1.3).

Migrer `wildfireFixture()` pour qu'elle fournisse un `fireIncidents` franchissant la porte, en
gardant la vigilance météo (inutilisée par la nouvelle règle mais inoffensive) :

```ts
function wildfireFixture(): FranceRawData {
  return baseRawData({
    // La règle ne compte plus les détections au national : elle lit les
    // incidents clusterisés. Un incident au-dessus de la porte 40/300.
    fireIncidents: [
      typed<NonNullable<FranceRawData['fireIncidents']>[number]>({
        id: 'incident-paca',
        centroidLat: 43.5,
        centroidLon: 5.1,
        bboxMinLat: 43.4, bboxMaxLat: 43.6, bboxMinLon: 5.0, bboxMaxLon: 5.2,
        detectionsCount: 120,
        frpMean: 12, frpMax: 90, frpTotal: 1600,
        confidenceMax: 'high',
        startDatetime: '2026-07-26T01:00:00Z',
        endDatetime: '2026-07-26T13:00:00Z',
        durationMinutes: 720,
        satellites: ['SNPP'],
        hasNightDetection: true,
        nearUrban: true,
        clusterMethod: 'dbscan', epsKm: 3, minPoints: 2,
        score: { severityScore: 70, impactScore: 60, labels: [] },
        detectionIds: [],
        deptCodes: ['13'],
        communes: ['Aix-en-Provence'],
      }),
    ],
    meteoAlerts: [ /* bloc existant conservé tel quel */ ],
  });
}
```

Ces valeurs (120 détections / 1 600 MW) donnent `high`, donc la situation est bien émise et
`assertHasSituation` passe sans modification.

- [ ] **Step 5b: Run tests**

Run: `npx vitest run src/services/situation-engine.wildfire.test.ts src/services/situation-engine.test.ts`
puis `npm test` en entier.

Baseline avant ta modification : **313 tests passants sur 38 fichiers**. Tout écart à la baisse
autre que celui que tu as délibérément migré est une régression à corriger, pas à accepter.

- [ ] **Step 6: Typecheck et commit**

```bash
npm run typecheck && npm test
git add src/services/situation-engine.ts src/services/situation-engine.wildfire.test.ts
git commit -m "fix: alerte incendie par incident localisé au lieu du compteur national saturé"
```

---

### Task 8: Modal du dossier et hook AlertMonitor

**Files:**
- Create: `src/components/WildfireDossierModal.ts`
- Modify: `src/components/AlertMonitor.ts` (l.82 `update`, l.165 `openDetail`)
- Test: `src/components/WildfireDossierModal.test.ts`

**Interfaces:**
- Consumes: `WildfireDossier`, `ImpactFact` (Task 5), `buildDossier` (Task 6),
  et le champ `App.currentFireIncidents` alimenté par la **Task 10**.
  **La Task 10 doit donc être exécutée AVANT celle-ci** — sans quoi le champ n'existe pas.
- Produces:
  - `class WildfireDossierModal { constructor(container: HTMLElement); show(dossier: WildfireDossier): void; hide(): void; destroy(): void }`
  - `renderFactRow(fact: ImpactFact): string` — export pur pour test
  - `AlertMonitor` accepte `onOpenDossier?: (s: DetectedSituation) => boolean`

- [ ] **Step 1: Write the failing test**

```ts
// src/components/WildfireDossierModal.test.ts
import { describe, expect, it } from 'vitest';
import type { ImpactFact } from '../types/index.ts';
import { renderFactRow } from './WildfireDossierModal.ts';

function fact(over: Partial<ImpactFact> = {}): ImpactFact {
  return {
    id: 1, kind: 'area_ha', value: 42000, unit: 'ha',
    quote: '42 000 hectares de forêt ont été détruits',
    sourceUrl: 'https://www.sudouest.fr/a/1', sourceName: 'Sud Ouest',
    sourceLevel: 'secondary', reliability: 'D', hedged: false, provisional: true,
    observedAt: '2026-07-26T08:00:00Z', communes: [],
    credibility: 4, corroboration: ['Sud Ouest'],
    ...over,
  };
}

describe('renderFactRow', () => {
  it('affiche la valeur, la source, le niveau et les deux notes', () => {
    const html = renderFactRow(fact());
    expect(html).toContain('42 000');
    expect(html).toContain('Sud Ouest');
    expect(html).toMatch(/secondaire/i);
    expect(html).toContain('D4');
  });

  it('signale un chiffre provisoire et une formulation approximative', () => {
    const html = renderFactRow(fact({ hedged: true, provisional: true }));
    expect(html).toMatch(/provisoire/i);
    expect(html).toMatch(/approximat/i);
  });

  it('rend un fait qualitatif sans inventer de valeur', () => {
    const html = renderFactRow(fact({ kind: 'evacuation_order', value: null, unit: null }));
    expect(html).toMatch(/évacuation/i);
    expect(html).not.toContain('null');
    expect(html).not.toMatch(/\b0\b/);
  });

  it('échappe le texte tiers — surface XSS la plus directe du projet', () => {
    const html = renderFactRow(fact({
      quote: '<script>alert(1)</script>',
      sourceName: '<img src=x onerror=alert(1)>',
    }));
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('onerror=');
    expect(html).toContain('&lt;script&gt;');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/WildfireDossierModal.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Write `renderFactRow` et la coquille du modal**

```ts
// src/components/WildfireDossierModal.ts
/**
 * WildfireDossierModal.ts — Dossier d'incident « grand feu ».
 *
 * Suit la forme de SentinelModal : overlay, clic extérieur, Escape, destroy().
 *
 * Règles de rendu non négociables (§6.2) :
 *   1. aucun chiffre sans provenance
 *   2. aucun chiffre sans niveau de source ni ses deux notes
 *   3. aucune valeur agrégée — on affiche des séries
 *   4. escapeHtml sur TOUT texte tiers
 */

import type { ImpactFact, ImpactFactKind, WildfireDossier } from '../types/index.ts';

function escapeHtml(value: string): string {
  const div = document.createElement('div');
  div.textContent = value;
  return div.innerHTML;
}

const KIND_LABEL: Record<ImpactFactKind, string> = {
  area_ha: 'Surface brûlée',
  evacuated: 'Personnes évacuées',
  dwellings_destroyed: 'Habitations détruites',
  injured: 'Blessés',
  evacuation_order: 'Ordre d\'évacuation',
  road_closed: 'Route coupée',
  rail_disrupted: 'Trafic ferroviaire interrompu',
};

const LEVEL_LABEL: Record<ImpactFact['sourceLevel'], string> = {
  primary: 'source primaire',
  secondary: 'source secondaire',
  tertiary: 'source tertiaire',
};

/** Formate un nombre à la française (espace insécable comme séparateur). */
function formatFr(value: number): string {
  return value.toLocaleString('fr-FR').replace(/ /g, ' ');
}

/**
 * Une ligne de fait déclaré. Export pur pour test.
 * La note combinée `D4` = fiabilité source + crédibilité information (§12.1).
 */
export function renderFactRow(fact: ImpactFact): string {
  const value =
    fact.value === null
      ? ''
      : `<strong>${escapeHtml(formatFr(fact.value))}${fact.unit ? ' ' + escapeHtml(fact.unit) : ''}</strong>`;
  const grade = `${escapeHtml(fact.reliability)}${fact.credibility ?? ''}`;
  const flags = [
    fact.provisional ? '<span class="wf-flag">provisoire</span>' : '',
    fact.hedged ? '<span class="wf-flag">approximatif</span>' : '',
  ].join('');

  return `
    <li class="wf-fact" data-kind="${escapeHtml(fact.kind)}">
      <div class="wf-fact__head">
        <span class="wf-fact__label">${escapeHtml(KIND_LABEL[fact.kind])}</span>
        ${value}
        <span class="wf-fact__grade" title="fiabilité source / crédibilité information">${grade}</span>
        ${flags}
      </div>
      <div class="wf-fact__meta">
        <a href="${escapeHtml(fact.sourceUrl)}" target="_blank" rel="noopener noreferrer"
        >${escapeHtml(fact.sourceName)}</a>
        <span class="wf-fact__level">${escapeHtml(LEVEL_LABEL[fact.sourceLevel])}</span>
        <time datetime="${escapeHtml(fact.observedAt)}">${escapeHtml(
          new Date(fact.observedAt).toLocaleString('fr-FR'),
        )}</time>
      </div>
      <details class="wf-fact__quote">
        <summary>phrase source</summary>
        <blockquote>${escapeHtml(fact.quote)}</blockquote>
      </details>
    </li>`;
}
```

Puis la classe `WildfireDossierModal` : deux blocs distincts `observé` / `déclaré` (§12.5), la chronologie affichant **toutes** les valeurs de `dossier.series.area_ha`, et le bloc consolidé omis si absent. Reprendre la mécanique overlay/Escape/`destroy()` de `SentinelModal.ts:132-210`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/WildfireDossierModal.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Brancher le hook dans `AlertMonitor`**

Modifier la signature (l.82) et le clic (l.165) :

```ts
  private onOpenDossier?: (situation: DetectedSituation) => boolean;

  /** Permet à un consommateur de prendre en charge le détail d'une alerte. */
  setDossierHandler(handler: (situation: DetectedSituation) => boolean): void {
    this.onOpenDossier = handler;
  }
```

Le garde va dans **`showDetail`** (`AlertMonitor.ts:332`), pas dans `openDetail`. Raison
vérifiée : `openDetail` est recréé par item dans une boucle et n'a pas la situation en variable
locale, et surtout **deux chemins** mènent à `showDetail` — le clic (`:164`) et le clavier
Enter/Espace (`:165-170`). Poser le garde dans `openDetail` raterait le chemin clavier, donc
l'accessibilité.

Première ligne de `showDetail(s: DetectedSituation)` :

```ts
  private showDetail(s: DetectedSituation): void {
    // Si un dossier dédié prend en charge cette alerte, on court-circuite le
    // détail intégré plutôt que de le dupliquer. Placé ici et non dans
    // openDetail : les chemins clic ET clavier passent tous deux par showDetail.
    if (this.onOpenDossier?.(s) === true) return;

    document.querySelector('.sit-mon__detail')?.remove();
```

- [ ] **Step 6: Câbler dans `App.ts`**

Instancier `WildfireDossierModal`, puis :

```ts
this.alertMonitor.setDossierHandler(situation => {
  if (situation.type !== 'WILDFIRE_ESCALATION') return false;
  const incidentId = situation.id.replace(/^wildfire-/, '');
  // Champ alimenté par la Task 10 (géo-résolution) — nom exact :
  // currentFireIncidents, à côté de currentActiveFires (App.ts:1346).
  const incident = this.currentFireIncidents.find(i => i.id === incidentId);
  if (!incident) return false;
  void this.openWildfireDossier(incident);
  return true;
});
```

Déclarer le champ avec **ce nom exact** — la Task 9 s'y branche :

```ts
  /** Modal du dossier « grand feu ». Nom référencé par la Task 9. */
  private wildfireModal: WildfireDossierModal | null = null;
```

`openWildfireDossier(incident: LocatedFireIncident)` récupère les faits via
`/api/fires/impacts?dept=<deptCodes joints par des virgules>`, appelle `buildDossier`, puis
`this.wildfireModal?.show(dossier)`. En cas d'échec réseau — ou pendant que Neon est indisponible
— il affiche le dossier avec la **seule détection** et la mention « impacts non renseignés » (§7),
sans jamais lever.

- [ ] **Step 7: Tests, build et commit**

```bash
npm run typecheck && npm test && npm run build
git add src/components/WildfireDossierModal.ts src/components/WildfireDossierModal.test.ts \
        src/components/AlertMonitor.ts src/App.ts
git commit -m "feat: modal du dossier grand feu et hook AlertMonitor"
```

---

### Task 9: Enrichissement Ollama — au bord, à la demande

**Files:**
- Create: `src/services/wildfire-enrich.ts`
- Test: `src/services/wildfire-enrich.test.ts`

**Interfaces:**
- Consumes: `WildfireDossier`, `ImpactFact` (Task 5).
- Produces: `enrichWithLlm(dossier, deps?): Promise<WildfireDossier>` où
  `deps = { fetchImpl?: typeof fetch, endpoint?: string, model?: string }` — **pas** de
  `sourceHint` : la provenance est héritée de la `quote` relue (voir Step 5).
  Les faits ajoutés portent `method: 'llm'`.

- [ ] **Step 0: Durcir `hasFullProvenance` avant d'ajouter un producteur de faits**

`hasFullProvenance` (dans `wildfire-dossier.ts`) ne vérifie aujourd'hui que la **non-vacuité** de
`observedAt`, pas qu'il est parsable. Un horodatage invalide produit un `NaN` dans le comparateur
de `.sort()`, dont la spec ECMAScript ne garantit pas le comportement.

Inoffensif jusqu'ici — le seul producteur, l'extracteur de la Task 1, émet de l'ISO 8601 valide.
Mais cette tâche introduit un **second producteur** dont les faits sortent d'une réponse LLM,
donc potentiellement d'une réponse LLM. C'est le moment de fermer la porte, avant qu'elle serve.

Un horodatage illisible n'est de toute façon pas une provenance : c'est `observedAt` qui porte la
chronologie des révisions (§12.4), et une date invalide la casse en silence.

```ts
function hasFullProvenance(fact: ImpactFact): boolean {
  if (!fact.quote || !fact.sourceUrl || !fact.sourceName || !fact.observedAt) return false;
  // Un horodatage illisible n'est pas une provenance : il casserait
  // silencieusement la chronologie des révisions.
  return !Number.isNaN(Date.parse(fact.observedAt));
}
```

Ajouter le test dans `src/services/wildfire-dossier.test.ts` :

```ts
it('rejette un fait dont l\'horodatage est illisible', () => {
  const dossier = buildDossier(INCIDENT, [
    fact({ id: 1 }),
    fact({ id: 2, observedAt: 'hier' }),
    fact({ id: 3, observedAt: '2026-13-45T99:99:99Z' }),
  ], ['33']);
  expect(dossier.facts.map(f => f.id)).toEqual([1]);
});
```

Vérifier que les 15 tests existants de ce fichier restent verts.

- [ ] **Step 1: Write the failing test**

```ts
// src/services/wildfire-enrich.test.ts
import { describe, expect, it, vi } from 'vitest';
import type { WildfireDossier } from '../types/index.ts';
import { enrichWithLlm } from './wildfire-enrich.ts';

const DOSSIER = {
  incident: { id: 'a', detectionsCount: 650, frpTotal: 7178 },
  severity: 'critical', deptCodes: ['33'], communes: [], facts: [],
  series: { area_ha: [], evacuated: [], dwellings_destroyed: [], injured: [],
            evacuation_order: [], road_closed: [], rail_disrupted: [] },
} as unknown as WildfireDossier;

describe('enrichWithLlm', () => {
  it('renvoie le dossier inchangé si Ollama est absent — sans lever', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await enrichWithLlm(DOSSIER, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toEqual(DOSSIER);
  });

  it('n\'appelle QUE l\'endpoint local — jamais un LLM cloud (§7)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ response: '[]' }), { status: 200 }),
    );
    await enrichWithLlm(DOSSIER, { fetchImpl: fetchImpl as unknown as typeof fetch });
    const url = String(fetchImpl.mock.calls[0]?.[0] ?? '');
    expect(url).toMatch(/^http:\/\/(localhost|127\.0\.0\.1):11434\//);
    expect(url).not.toMatch(/groq|openai|anthropic/i);
  });

  it('hérite la provenance de la citation relue et marque method: llm', async () => {
    // Le fait source : c'est SA citation que le LLM relit, et c'est SA
    // provenance que le fait produit hérite. Rien n'est fabriqué (§3.3).
    const source = fact({
      id: 1, kind: 'area_ha', value: 42000,
      quote: "L'incendie a détruit 42 000 hectares et contraint 220 000 personnes à évacuer.",
      sourceUrl: 'https://www.sudouest.fr/a/1', sourceName: 'Sud Ouest',
      sourceLevel: 'secondary', reliability: 'D', observedAt: '2026-07-26T08:00:00Z',
    });
    const payload = JSON.stringify({
      response: JSON.stringify([
        { kind: 'evacuated', value: 220000 },   // genre manqué par les patterns
        { kind: 'dwellings_destroyed', value: 175 }, // absent de la citation → à rejeter
      ]),
    });
    const fetchImpl = vi.fn().mockImplementation(
      () => Promise.resolve(new Response(payload, { status: 200 })),
    );
    const result = await enrichWithLlm(
      buildDossier(INCIDENT, [source], ['33']),
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    const llmFacts = result.facts.filter(f => f.method === 'llm');
    expect(llmFacts).toHaveLength(1);
    expect(llmFacts[0].kind).toBe('evacuated');
    expect(llmFacts[0].value).toBe(220000);
    // Provenance héritée à l'identique du fait source, jamais inventée.
    expect(llmFacts[0].sourceUrl).toBe(source.sourceUrl);
    expect(llmFacts[0].sourceName).toBe(source.sourceName);
    expect(llmFacts[0].observedAt).toBe(source.observedAt);
    expect(llmFacts[0].quote).toBe(source.quote);
  });

  it('ne relit rien et n\'appelle pas Ollama sur un dossier sans fait', async () => {
    const fetchImpl = vi.fn();
    const result = await enrichWithLlm(DOSSIER, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.facts).toEqual([]);
  });

  it('ignore une réponse LLM non parsable sans casser le dossier', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ response: 'je pense que...' }), { status: 200 }),
    );
    const result = await enrichWithLlm(DOSSIER, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result.facts).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/wildfire-enrich.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Write the implementation**

Créer `src/services/wildfire-enrich.ts` : un `fetch` POST vers `http://localhost:11434/api/generate`, `stream: false`, timeout `AbortSignal.timeout(20_000)`, prompt demandant un tableau JSON strict. Tout échec — réseau, JSON, schéma — renvoie le dossier **inchangé**. Chaque fait retenu doit porter `quote`, `sourceUrl`, `sourceName`, `observedAt` (§3.3) et reçoit `method: 'llm'`, `credibility` recalculée par `gradeCredibility`. Aucune URL autre que l'hôte local n'est jamais construite.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/wildfire-enrich.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Appeler à l'ouverture du modal uniquement**

Dans `openWildfireDossier` (Task 8), après le premier affichage :

```ts
// Ollama tourne en local et n'est sollicité qu'ici : à l'ouverture d'un
// dossier, pour un seul incident. Jamais dans une boucle de rafraîchissement.
void enrichWithLlm(dossier).then(enriched => this.wildfireModal?.show(enriched));
```

**D'où vient la provenance des faits que le LLM produit — point de conception à ne pas rater.**

Le dossier ne contient **pas** le texte des articles : `/api/fires/impacts` renvoie des faits, et
chaque fait porte sa `quote`, c'est-à-dire la phrase source verbatim. `enrichWithLlm` n'a donc
aucun texte d'article à relire, et **aucune** source à inventer.

Ce qu'il fait réellement : il relit les `quote` **déjà présentes** dans le dossier pour y trouver
les genres de faits que les patterns ont manqués. Une phrase comme « l'incendie a détruit
42 000 hectares et contraint 220 000 personnes à évacuer » peut avoir livré son `area_ha` aux
patterns tout en laissant passer l'`evacuated`.

Conséquence sur la signature : **il n'y a pas de `sourceHint` global.** Chaque fait produit hérite
de la provenance de la `quote` dont il est issu — `sourceUrl`, `sourceName`, `sourceLevel`,
`reliability`, `observedAt`, et `method: 'llm'`. C'est cohérent avec §3.3 : la provenance n'est
jamais fabriquée, elle est **héritée** d'un fait qui l'avait déjà.

Adapter les tests du Step 1 en conséquence : le `deps` porte `fetchImpl`, `endpoint` et `model`,
mais **pas** de `sourceHint`. Le dossier d'entrée du test doit contenir au moins un fait avec sa
`quote`, et le test vérifie que le fait produit par le LLM porte la **même** provenance que le
fait source, plus `method: 'llm'`.

Corollaire : un dossier sans aucun fait n'a rien à relire, donc `enrichWithLlm` le renvoie
inchangé sans appeler Ollama. C'est le cas pendant l'indisponibilité de Neon — aucun appel inutile.

- [ ] **Step 6: Vérification finale et commit**

```bash
npm run typecheck && npm test && npm run build
git add src/services/wildfire-enrich.ts src/services/wildfire-enrich.test.ts src/App.ts
git commit -m "feat: enrichissement Ollama du dossier, à l'ouverture et en local"
```

---

### Task 10: Résolution géographique des incidents

**Files:**
- Create: `src/services/incident-geography.ts`
- Test: `src/services/incident-geography.test.ts`

**Interfaces:**
- Consumes: `FireIncident` (existant), `LocatedFireIncident` (Task 5).
- Produces: `resolveIncidentGeography(incidents, deps?): Promise<LocatedFireIncident[]>` avec
  `deps = { fetchImpl?: typeof fetch, cache?: Map<string, Promise<CellGeo | null>> }`.
  Le cache stocke la **promesse en cours**, pas le résultat résolu : c'est un cache
  « single-flight ». Sans cela, les cinq échantillons d'un incident compact tombant dans la
  même maille partent tous au réseau avant qu'aucun n'ait écrit — mesuré à 4 appels au lieu
  de 1. Un cache de résultats ne dédoublonne que les recherches **séquentielles**.

Sonde `geo.api.gouv.fr/communes?lat=&lon=` en point-dans-polygone. Vérifié le 2026-07-27 : la BAN
(`api-adresse`) renvoie **zéro adresse** sur un foyer en forêt — c'est `geo.api.gouv.fr` qu'il
faut interroger, pas la BAN.

- [ ] **Step 1: Write the failing test**

```ts
// src/services/incident-geography.test.ts
import { describe, expect, it, vi } from 'vitest';
import type { FireIncident } from '../types/index.ts';
import { resolveIncidentGeography, cellKey } from './incident-geography.ts';

function incident(id: string, lat: number, lon: number): FireIncident {
  return {
    id, centroidLat: lat, centroidLon: lon,
    bboxMinLat: lat - 0.1, bboxMaxLat: lat + 0.1,
    bboxMinLon: lon - 0.1, bboxMaxLon: lon + 0.1,
    detectionsCount: 650, frpMean: 11, frpMax: 222, frpTotal: 7178,
    confidenceMax: 'high', startDatetime: '2026-07-26T01:32:00Z',
    endDatetime: '2026-07-26T12:55:00Z', durationMinutes: 683,
    satellites: ['SNPP'], hasNightDetection: true, nearUrban: true,
    clusterMethod: 'dbscan', epsKm: 3, minPoints: 2,
    score: { severityScore: 90, impactScore: 80, labels: [] }, detectionIds: [],
  } as FireIncident;
}

function ok(nom: string, dept: string) {
  return new Response(JSON.stringify([{ nom, codeDepartement: dept }]), { status: 200 });
}

describe('resolveIncidentGeography', () => {
  it('résout département et commune depuis geo.api.gouv.fr', async () => {
    // mockImplementation, pas mockResolvedValue : un vrai fetch renvoie une
    // Response NEUVE par appel, et Response.json() ne se consomme qu'une fois.
    const fetchImpl = vi.fn().mockImplementation(() => ok('Lanton', '33'));
    const [located] = await resolveIncidentGeography(
      [incident('a', 44.7794, -0.9253)],
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(located.deptCodes).toEqual(['33']);
    expect(located.communes).toEqual(['Lanton']);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('geo.api.gouv.fr/communes');
  });

  it('agrège plusieurs départements — un incident peut chevaucher (§3.5)', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(ok('Lanton', '33'))
      .mockResolvedValueOnce(ok('Biscarrosse', '40'))
      .mockResolvedValue(ok('Lanton', '33'));
    const [located] = await resolveIncidentGeography(
      [incident('a', 44.7794, -0.9253)],
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(located.deptCodes.sort()).toEqual(['33', '40']);
  });

  it('renvoie des listes vides sans lever si le service échoue', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const [located] = await resolveIncidentGeography(
      [incident('a', 44.7794, -0.9253)],
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(located.deptCodes).toEqual([]);
    expect(located.communes).toEqual([]);
    expect(located.id).toBe('a');
  });

  it('réutilise le cache : deux incidents de la même maille = un seul appel', async () => {
    // mockImplementation, pas mockResolvedValue : un vrai fetch renvoie une
    // Response NEUVE par appel, et Response.json() ne se consomme qu'une fois.
    const fetchImpl = vi.fn().mockImplementation(() => ok('Lanton', '33'));
    const cache = new Map();
    await resolveIncidentGeography([incident('a', 44.7794, -0.9253)],
      { fetchImpl: fetchImpl as unknown as typeof fetch, cache });
    const before = fetchImpl.mock.calls.length;
    await resolveIncidentGeography([incident('b', 44.7794, -0.9253)],
      { fetchImpl: fetchImpl as unknown as typeof fetch, cache });
    expect(fetchImpl.mock.calls.length).toBe(before);
  });

  it('ne lance qu\'UN appel pour cinq échantillons dans la même maille', async () => {
    // Le test séquentiel ci-dessus ne peut pas voir ce trou : il attend la fin
    // du premier appel. Ici les 5 échantillons d'un bbox compact partent
    // concurremment, et seul un cache single-flight les dédoublonne.
    const fetchImpl = vi.fn().mockImplementation(() => ok('Lanton', '33'));
    const tight = { ...incident('a', 44.7794, -0.9253),
      bboxMinLat: 44.7784, bboxMaxLat: 44.7804,
      bboxMinLon: -0.9263, bboxMaxLon: -0.9243 };
    // Contrôle préalable : sans cela le test ne teste rien.
    expect(new Set([
      cellKey(tight.centroidLat, tight.centroidLon),
      cellKey(tight.bboxMinLat, tight.bboxMinLon),
      cellKey(tight.bboxMaxLat, tight.bboxMaxLon),
    ]).size).toBe(1);
    await resolveIncidentGeography([tight], { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('arrondit la maille de cache à 0,05 degré', () => {
    expect(cellKey(44.7794, -0.9253)).toBe(cellKey(44.7801, -0.9249));
    expect(cellKey(44.7794, -0.9253)).not.toBe(cellKey(44.9, -0.9253));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/incident-geography.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Write the implementation**

Créer `src/services/incident-geography.ts` :

- `cellKey(lat, lon)` — arrondi à 0,05° (`Math.round(v / 0.05) * 0.05`, formaté à 3 décimales),
  pour mutualiser les appels : 734 détections réelles se réduisaient à 35 mailles.
- `resolveIncidentGeography` échantillonne le centroïde **et les quatre coins de la bbox** —
  c'est ce qui a révélé le débordement Gironde → Landes, invisible sur le seul centroïde.
- Concurrence bornée (4 en parallèle), `AbortSignal.timeout(15_000)` par appel.
- **Tout échec réseau est silencieux** : `deptCodes: []`, `communes: []`. Le §7 impose qu'une
  donnée manquante s'affiche comme manquante, jamais comme « France ».

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/incident-geography.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Câbler dans `App.ts`**

**Ne re-clusterise pas.** Le DBSCAN est déjà exécuté dans `src/services/fires.ts:211`, à
l'intérieur de `fetchFiresData()`, et le résultat est renvoyé dans `FiresApiResponse.incidents`.
`App.ts` le reçoit déjà mais n'en utilise aujourd'hui que la **longueur**, pour une ligne de
statut (`App.ts:4632`) — les incidents eux-mêmes sont jetés.

Ajouter le champ manquant, à côté de `currentActiveFires` (`App.ts:1346`) :

```ts
  private currentActiveFires: import('./types/index.ts').ActiveFire[] = [];
  /** Incidents clusterisés ET géo-résolus — consommés par le dossier (Task 8). */
  private currentFireIncidents: import('./types/index.ts').LocatedFireIncident[] = [];
```

Puis, dans la même méthode que `this.currentActiveFires = data.detections;` (vers `App.ts:4623`),
enchaîner la résolution géographique sur les incidents **déjà calculés** :

```ts
    this.currentActiveFires = data.detections;
    // La géo-résolution est best-effort : un échec laisse deptCodes/communes
    // vides et l'alerte retombe sur les coordonnées (§7). Ne jamais bloquer
    // l'affichage des détections pour attendre le découpage administratif.
    void resolveIncidentGeography(data.incidents)
      .then(located => { this.currentFireIncidents = located; })
      .catch(() => { /* deptCodes/communes restent vides */ });
```

Enfin, passer `this.currentFireIncidents` dans `FranceRawData.fireIncidents` là où `FranceRawData`
est assemblé pour le moteur de situations.

**Pourquoi `void` et non `await`** : `resolveIncidentGeography` fait des appels réseau par maille
géographique. Bloquer dessus retarderait l'affichage de la carte pour un enrichissement qui n'est
pas nécessaire au premier rendu.

- [ ] **Step 6: Typecheck et commit**

```bash
npm run typecheck && npm test
git add src/services/incident-geography.ts src/services/incident-geography.test.ts src/App.ts
git commit -m "feat: résolution département/communes des incidents feux"
```

---

### Task 11: Alimenter l'historique des incidents

**Files:**
- Create: `api/fires/incident-history.js`
- Test: `tests/fires-incident-history.test.ts`

**Interfaces:**
- Consumes: table `fire_incident_history` (Task 2), `LocatedFireIncident` (Task 5).
- Produces: `POST /api/fires/incident-history` (instantané) et
  `GET /api/fires/incident-history?since=<ISO>` (série). Exports testables :
  `toHistoryRow(incident, observedAt)`, `validateSnapshot(body)`.

Sans cette tâche, la table de la Task 2 reste du décor et le §9.1 n'est pas satisfait.

- [ ] **Step 1: Write the failing test**

```ts
// tests/fires-incident-history.test.ts
import { describe, expect, it } from 'vitest';
import { toHistoryRow, validateSnapshot } from '../api/fires/incident-history.js';

const INCIDENT = {
  id: 'gironde-front-1', centroidLat: 44.7794, centroidLon: -0.9253,
  detectionsCount: 650, frpTotal: 7178, frpMax: 222.4,
  bboxMinLat: 44.378, bboxMaxLat: 44.972, bboxMinLon: -1.219, bboxMaxLon: -0.611,
  nearUrban: true, deptCodes: ['33', '40'],
};

describe('validateSnapshot', () => {
  it('accepte un lot conforme', () => {
    const parsed = validateSnapshot({ observedAt: '2026-07-26T12:55:00Z', incidents: [INCIDENT] });
    expect(parsed.incidents).toHaveLength(1);
  });

  it('refuse un horodatage absent ou invalide', () => {
    expect(() => validateSnapshot({ incidents: [INCIDENT] })).toThrow(/observedAt/i);
    expect(() => validateSnapshot({ observedAt: 'hier', incidents: [INCIDENT] })).toThrow(/observedAt/i);
  });

  it('refuse un incident aux coordonnées hors métropole', () => {
    expect(() => validateSnapshot({
      observedAt: '2026-07-26T12:55:00Z',
      incidents: [{ ...INCIDENT, centroidLat: 12 }],
    })).toThrow(/coordonn/i);
  });

  it('borne la taille du lot', () => {
    expect(() => validateSnapshot({
      observedAt: '2026-07-26T12:55:00Z',
      incidents: Array.from({ length: 501 }, () => INCIDENT),
    })).toThrow(/trop/i);
  });
});

describe('toHistoryRow', () => {
  it('projette l\'incident sur les colonnes de fire_incident_history', () => {
    const row = toHistoryRow(INCIDENT, '2026-07-26T12:55:00Z');
    expect(row.incident_id).toBe('gironde-front-1');
    expect(row.detections_count).toBe(650);
    expect(row.frp_total).toBeCloseTo(7178);
    expect(row.dept_codes).toEqual(['33', '40']);
    expect(row.observed_at).toBe('2026-07-26T12:55:00.000Z');
  });

  it('tolère un incident sans département résolu', () => {
    expect(toHistoryRow({ ...INCIDENT, deptCodes: undefined }, '2026-07-26T12:55:00Z').dept_codes)
      .toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/fires-incident-history.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Write the implementation**

Créer `api/fires/incident-history.js` sur le modèle de `api/fires/impacts.js` (Task 4) :

- `validateSnapshot(body)` — `observedAt` ISO obligatoire, `incidents` borné à 500, latitude dans
  `[41, 52]` et longitude dans `[-6, 10]` (bornes métropole déjà utilisées par le worker radar).
- `toHistoryRow(incident, observedAt)` — projection `camelCase` → `snake_case`.
- `POST` : `INSERT ... ON CONFLICT (incident_id, observed_at) DO NOTHING` — **append-only**, un
  même instantané renvoyé deux fois ne crée pas de doublon et n'écrase rien.
- `GET ?since=` : renvoie la **série** ordonnée par `observed_at ASC`. Aucun paramètre `latest`,
  aucun agrégat (§12.4).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/fires-incident-history.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Poster l'instantané depuis `App.ts`**

Après la résolution géographique (Task 10), en best-effort — un échec ne doit jamais dégrader
l'affichage :

```ts
void fetch('/api/fires/incident-history', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ observedAt: new Date().toISOString(), incidents: located }),
}).catch(() => { /* historisation best-effort */ });
```

- [ ] **Step 6: Ajouter la route au miroir dev**

Étendre `src/plugins/fires-dossier-proxy.ts` (créé en Task 4) pour monter aussi
`/api/fires/incident-history`, en réutilisant `validateSnapshot` et `toHistoryRow` du handler —
jamais de logique dupliquée entre l'edge et le proxy dev.

En dev sans `DATABASE_URL` : le `POST` répond 200 avec `{ inserted: 0 }` et le `GET` renvoie
`{ snapshots: [] }`. L'historisation est best-effort (§7) : elle ne doit jamais faire échouer
l'affichage, ni en dev ni en production.

Vérifier :

```bash
npm run dev:vite &
sleep 6
curl -s -o /dev/null -w "POST incident-history -> %{http_code}\n" \
  -X POST -H 'Content-Type: application/json' \
  -d '{"observedAt":"2026-07-26T12:55:00Z","incidents":[]}' \
  "http://localhost:3001/api/fires/incident-history"
curl -s -o /dev/null -w "GET  incident-history -> %{http_code}\n" \
  "http://localhost:3001/api/fires/incident-history"
curl -s -o /dev/null -w "GET  /api/fires (non régressé) -> %{http_code}\n" \
  "http://localhost:3001/api/fires"
kill %1
```

- [ ] **Step 7: Vérification finale et commit**

```bash
npm run typecheck && npm test && npm run build
git add api/fires/incident-history.js tests/fires-incident-history.test.ts \
        src/plugins/fires-dossier-proxy.ts src/App.ts
git commit -m "feat: historisation des incidents feux pour reconstituer un épisode"
```

---

## Auto-revue du plan

**Couverture du spec :**

| section du spec | tâche |
|---|---|
| §1.1 décorrélation FRP/dégâts | Tasks 7 (résumé sans chiffres déclarés), 8 (blocs séparés) |
| §1.3 capteur saturé | Task 7 |
| §3.1 `ImpactFact` append-only | Tasks 2, 3 |
| §3.3 provenance obligatoire | Tasks 1, 6, 8, 9 |
| §3.4 fait sans chiffre | Tasks 1, 8 |
| §3.5 multi-départements | Tasks 4, 6, 10 |
| §4 seuils | Task 5 |
| §4.2 fixture-contrat | Task 5 |
| §5.1 extraction serveur | Tasks 1, 3 |
| §5.2 fonctions pures client | Tasks 5, 6 |
| §5.3 détecteur par incident | Task 7 |
| §6.1 hook AlertMonitor | Task 8 |
| §6.2 modal | Task 8 |
| §7 dégradation | Tasks 4, 8, 9 |
| §8 tests | toutes |
| §9.1 historisation | Tasks 2 (schéma) + 11 (alimentation) |
| §12.1 deux axes | Tasks 1, 6 |
| §12.2 niveau de source | Tasks 1, 8 |
| §12.3 corroboration | Task 6 |
| §12.4 non-réconciliation | Tasks 2, 4, 6 |
| §12.5 observé/déclaré | Tasks 7, 8 |

**Deux erreurs corrigées pendant l'auto-revue**, notées ici parce qu'elles auraient fait échouer l'exécution :

1. `FireIncident` **n'a pas** de champ `deptCodes` — le rattachement administratif exige un appel réseau. D'où le type `LocatedFireIncident` (Task 5) et la Task 10 qui le produit. Une première version du plan faisait compiler `incident.deptCodes?.length` sur un type qui n'a pas ce champ.
2. `FranceRawData` est défini dans **`src/services/france-country-intel.ts`**, pas dans `types/index.ts`, et ne connaissait que `activeFires`. D'où l'ajout d'un `fireIncidents?` optionnel (Task 5, Step 3b).

La table `fire_incident_history` créée en Task 2 est désormais alimentée par la Task 11 : sans elle, elle serait restée du décor et le §9.1 n'aurait pas été satisfait.

**Placeholders :** les Tasks 8 (classe modal), 9 (corps `enrichWithLlm`), 10 (corps du résolveur) et 11 (corps du handler) décrivent l'implémentation en prose structurée plutôt qu'en code intégral. Leurs **tests sont entièrement écrits** et font contrat — l'implémenteur code contre eux, et les contraintes non évidentes (bornes, concurrence, silence des échecs, `ON CONFLICT DO NOTHING`) sont explicitées. Les Tasks 1 à 7 ont leur code complet.

**Cohérence des types :** `RawImpactFact` (Task 1) → `ImpactRow` (Task 3) → `ImpactFactDTO` (Task 4) → `ImpactFact` (Task 5) désignent la même donnée à quatre étages, avec `credibility` et `corroboration` ajoutés au seul étage client (Task 6) et `id` apparaissant à la persistance (Task 4). `snake_case` en base, `camelCase` en TypeScript, conversion unique dans `toImpactDto`.
