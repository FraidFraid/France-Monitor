# Fiches de la colonne dans le kit, et aucun tiret cadratin : plan de mise en œuvre

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** mettre les fiches événement, situation (et alerte), thème, alerte officielle et marché de la colonne v2 dans le kit de l'État, hiérarchisées et au niveau d'un outil OSINT professionnel, et supprimer tout tiret cadratin de l'application.

**Architecture:** le gabarit commun (`src/components/fiche/parts.ts`) gagne un en-tête kit (sur-titre, titre, ligne de niveau, synthèse) pour toutes les fiches sans score ; chaque constructeur (`src/components/fiche/items.ts`) produit des sections kit (`id`, `summary`, `collapsible`, `open`, `tone`) ; le contenu de l'ancien volet « Pourquoi ce niveau ? » devient la section « Indicateurs », ouverte. Briques pures nouvelles dans `kit.ts` (heure absolue, intensité, courbe en escalier). Mémoire des sections par type de fiche. Tirets cadratins : nettoyage des littéraux du code, nettoyage des textes externes à leur arrivée, test garde-fou.

**Tech Stack:** TypeScript strict, DOM natif, Vite, Vitest (happy-dom pour le DOM), CSS `src/styles/main.css`, compilateur TypeScript (déjà en dépendance de développement) pour le garde-fou.

**Spec:** `docs/superpowers/specs/2026-10-01-fiches-kit-design.md` (référence de style : `docs/design/panneau-v2.md`).

## Global Constraints

- v2 seulement pour les fiches (`?ui=v2`) ; la règle « aucun tiret cadratin » vaut pour toute l'application (v1 comprise).
- Aucune donnée ajoutée côté serveur ; aucune fonctionnalité retirée.
- Français avec « » et ’ ; anglais quand `lang === 'en'`. **Jamais de tiret cadratin « — » dans un littéral de chaîne** (séparateur « · » ou « : », valeur absente « n.d. », plage « à ») ; les commentaires peuvent en garder.
- TypeScript strict : aucun `any`, aucun `!` non justifié ; DOM natif ; aucune dépendance ajoutée.
- Tout texte tiers échappé (`escapeHtml`) ; seuls les paramètres et champs nommés `*Html`, `summary` et `html` des sections passent tels quels (déjà échappés par le constructeur).
- Couleurs : seuls les niveaux sont colorés ; barres d'indicateurs d'une situation à la couleur de leur propre intensité (≥ 85 % rouge, ≥ 70 % orange, ≥ 55 % jaune, sinon vert) ; confiance en gris ; courbe de corroboration neutre ; vert de marque seulement pour l'interactif.
- Heures : absolues, heure de Paris ; `hh:mm` le jour même, `jj/mm hh:mm` sinon ; le relatif jamais seul.
- `localStorage` et presse-papiers toujours sous `try/catch`.
- Avant chaque commit : `npm run typecheck`, `npx vitest run` (suite complète), `npm run build`. Commits en français (`feat(v2): …`, `refactor(v2): …`, `fix: …`), terminés par :
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_016CCTVuVKLioWAncSRysDPG
  ```
- Branche `feat/ui-disposition-a1` ; ne jamais créer de branche « ui2 » ; rien n'est poussé.

## Review Focus

1. **Événement sans journal ni articles chargés** (`detail` undefined, `'loading'`, `'error'`) : pas de courbe, messages « Chargement du journal… » / « Journal indisponible pour le moment. » / « Chargement des articles… » / « Articles indisponibles pour le moment. », jamais d'erreur (tâche 3).
2. **Lignes chiffrées du moteur atypiques** (« Vigilance stocks pétroliers : sous tension (score 49/100) », phrase sans « : », fraction décimale « 3,5/10 ») : soit une barre correcte, soit une note texte, jamais une barre fausse (tâche 4).
3. **Re-rendus et mémoire par type** : ouvrir « Articles » sur un événement le garde ouvert sur un autre événement et après vingt mises à jour (tâche 7).
4. **Presse-papiers refusé** (API absente ou rejet) : aucune exception, message « Copie impossible » (tâche 7).
5. **Titres de presse avec tiret cadratin** (« Grève — la SNCF… ») : affichés « Grève : la SNCF… » partout (tâche 9).

---

## Fichiers

| Fichier | Rôle |
|---|---|
| `src/components/fiche/kit.ts` | + `absoluteTime`, `intensityLevel`, `stepCurve`, `CurvePoint`, option `neutral` de `meterRow` |
| `src/services/situation-text.ts` | + `parseScoreLine` |
| `src/components/fiche/parts.ts` | en-tête kit pour toutes les fiches sans score, `lead`, `context`, `reference`, `tone`, `renderChangeRows(changes, lang, now)` ; retrait des parties génériques (tâche 6) |
| `src/components/fiche/items.ts` | constructeurs réécrits (événement, situation, thème, alerte officielle, marché) |
| `src/components/fiche/france.ts` | appels mis à jour (`renderChangeRows`, champs retirés) |
| `src/services/fiche-sections-store.ts` | + `sectionMemoryKey` |
| `src/components/poste/FichePanel.ts` | message de copie (`announce`), retrait du volet « Pourquoi » |
| `src/components/poste/PosteSituation.ts` | mémoire par type, entrées des constructeurs, action `copy-ref`, retrait `whyOpen` |
| `src/styles/main.css` | en-tête kit, courbe, ton « référence », lignes d'articles, « À faire », message de copie |
| `src/services/typography.ts` (nouveau) | `noEmDash` |
| `src/services/news-events.ts`, `src/services/rss.ts`, `src/services/france-intel-brief.ts`, `api/_handlers/intelligence/v1/france-intel-brief.js` | nettoyage des textes externes ; consigne du brief |
| ~70 fichiers de `src/` et `api/` | littéraux sans tiret cadratin (tâches 10 et 11) |
| `tests/no-em-dash.test.ts` (nouveau) | garde-fou |

---

### Task 1: Briques du kit : heure absolue, intensité, courbe en escalier, analyse des lignes chiffrées

**Files:**
- Modify: `src/components/fiche/kit.ts`
- Test: `src/components/fiche/kit.test.ts`
- Modify: `src/services/situation-text.ts`
- Test: `src/services/situation-text.test.ts` (créer s'il n'existe pas, sinon ajouter)
- Modify: `src/components/fiche/france-indicators.ts` (seulement ses littéraux « — », voir étape 7)

**Interfaces:**
- Produces: `absoluteTime(ms: number, now: number, lang: 'fr' | 'en', opts?: { withDate?: boolean }): string` ; `intensityLevel(value: number, max: number): VigilanceLevel | null` ; `interface CurvePoint { at: number; value: number }` ; `stepCurve(points: readonly CurvePoint[], opts: { label: string; timeLabel: (ms: number) => string }): string` ; `MeterRow.neutral?: boolean` ; `meterRow` affiche « n.d. » (et non plus « — ») pour une valeur absente ; `parseScoreLine(line: string): { label: string; value: number; max: number; display: string; note: string | null } | null`.

- [ ] **Step 1: Tests du kit (échouent)**

Ajouter à `src/components/fiche/kit.test.ts` (et `absoluteTime, intensityLevel, stepCurve` à l'import) ; remplacer dans le test existant « ligne de mesure indisponible » l'attendu `'>—</span>'` par `'>n.d.</span>'` :

```ts
describe('heure absolue (spec 2026-10-01 fiches § 3)', () => {
  const NOW = Date.parse('2026-10-01T08:30:00Z'); // 10:30 à Paris
  it('le jour même : hh:mm, heure de Paris', () => {
    expect(absoluteTime(Date.parse('2026-10-01T06:05:00Z'), NOW, 'fr')).toBe('08:05');
  });
  it('un autre jour : jj/mm hh:mm', () => {
    expect(absoluteTime(Date.parse('2026-09-30T17:11:00Z'), NOW, 'fr')).toBe('30/09 19:11');
  });
  it('juste avant minuit à Paris, la veille : date affichée', () => {
    expect(absoluteTime(Date.parse('2026-09-30T21:59:00Z'), NOW, 'fr')).toBe('30/09 23:59');
  });
  it('date forcée et anglais', () => {
    expect(absoluteTime(Date.parse('2026-10-01T06:05:00Z'), NOW, 'fr', { withDate: true })).toBe('01/10 08:05');
    expect(absoluteTime(Date.parse('2026-09-30T17:11:00Z'), NOW, 'en')).toBe('30/09 19:11');
  });
});

describe('intensité d’un sous-score', () => {
  it('seuils 85, 70, 55 % de la valeur maximale', () => {
    expect(intensityLevel(25, 25)).toBe('rouge');
    expect(intensityLevel(14, 20)).toBe('orange');
    expect(intensityLevel(65, 100)).toBe('jaune');
    expect(intensityLevel(54, 100)).toBe('vert');
  });
  it('maximum nul ou valeur non finie : aucun niveau', () => {
    expect(intensityLevel(3, 0)).toBeNull();
    expect(intensityLevel(Number.NaN, 10)).toBeNull();
  });
});

describe('courbe en escalier', () => {
  const label = (ms: number): string => `t${ms}`;
  it('moins de deux points : rien', () => {
    expect(stepCurve([], { label: 'x', timeLabel: label })).toBe('');
    expect(stepCurve([{ at: 0, value: 1 }], { label: 'x', timeLabel: label })).toBe('');
  });
  it('marches, libellé accessible, axes hors de la zone tracée', () => {
    const svg = stepCurve([{ at: 0, value: 1 }, { at: 100, value: 3 }, { at: 200, value: 5 }], { label: 'Groupes <indép>', timeLabel: label });
    expect(svg).toContain('role="img" aria-label="Groupes &lt;indép&gt;"');
    expect(svg).toContain('class="fmk-curve-line"');
    // Les libellés d'axe sont sous la ligne de base (y 78 > 60) ou à gauche du tracé (x 12 < 18).
    expect(svg).toContain('<text x="18" y="78">t0</text>');
    expect(svg).toContain('<text x="384" y="78" text-anchor="end">t200</text>');
    expect(svg).toContain('<text x="12" y="12" text-anchor="end">5</text>');
    expect(svg).toContain('<text x="12" y="63" text-anchor="end">1</text>');
    // Escalier : deux sommets par changement.
    expect(svg).toMatch(/points="18\.0,60\.0 201\.0,60\.0 201\.0,34\.0 384\.0,34\.0 384\.0,8\.0"/);
  });
});

describe('barre neutre', () => {
  it('niveau absent mais neutre : barre grise', () => {
    expect(meterRow({ label: 'Confiance', value: 80, level: null, neutral: true, display: '80 %' }))
      .toContain('width:80%;background:var(--text-secondary)');
  });
});
```

Run: `npx vitest run src/components/fiche/kit.test.ts` → FAIL (exports manquants).

- [ ] **Step 2: Écrire les briques**

Dans `src/components/fiche/kit.ts` :
- `MeterRow` : ajouter `/** Barre grise quand aucun niveau ne s'applique (confiance). */ neutral?: boolean;` et changer le commentaire de `value`/`display` (« n.d. » au lieu de « — ») ;
- dans `meterRow`, remplacer le calcul de `fill` et de `display` par :

```ts
  const background = row.level !== null ? levelColorVar(row.level) : row.neutral ? 'var(--text-secondary)' : null;
  const fill = row.value === null || background === null
    ? ''
    : `<i style="width:${width}%;background:${background}"></i>`;
  const display = escapeHtml(row.display ?? (row.value === null ? 'n.d.' : String(row.value)));
```

- ajouter à la fin du fichier :

```ts
const PARIS = 'Europe/Paris';

/** Heure de Paris : « hh:mm » le jour même, « jj/mm hh:mm » sinon ; withDate force la date. */
export function absoluteTime(ms: number, now: number, lang: 'fr' | 'en', opts: { withDate?: boolean } = {}): string {
  const locale = lang === 'fr' ? 'fr-FR' : 'en-GB';
  const day = (v: number): string => new Date(v).toLocaleDateString('fr-FR', { timeZone: PARIS });
  const clock = new Date(ms).toLocaleTimeString(locale, { timeZone: PARIS, hour: '2-digit', minute: '2-digit' });
  if (opts.withDate !== true && day(ms) === day(now)) return clock;
  const date = new Date(ms).toLocaleDateString(locale, { timeZone: PARIS, day: '2-digit', month: '2-digit' });
  return `${date} ${clock}`;
}

/** Couleur d'intensité d'un sous-score, part du maximum : ≥ 85 % rouge, ≥ 70 % orange, ≥ 55 % jaune, sinon vert. */
export function intensityLevel(value: number, max: number): VigilanceLevel | null {
  if (!(max > 0) || !Number.isFinite(value)) return null;
  const ratio = value / max;
  if (ratio >= 0.85) return 'rouge';
  if (ratio >= 0.7) return 'orange';
  if (ratio >= 0.55) return 'jaune';
  return 'vert';
}

export interface CurvePoint {
  at: number;
  value: number;
}

const CURVE = { width: 384, height: 84, left: 18, top: 8, base: 60 } as const;

/** Courbe en escalier (corroboration) : tracé neutre, valeurs et heures hors de la zone tracée ; '' sous deux points. */
export function stepCurve(points: readonly CurvePoint[], opts: { label: string; timeLabel: (ms: number) => string }): string {
  if (points.length < 2) return '';
  const first = points[0];
  const last = points[points.length - 1];
  const values = points.map((p) => p.value);
  const vMin = Math.min(...values);
  const vMax = Math.max(...values);
  const tSpan = last.at - first.at || 1;
  const vSpan = vMax - vMin || 1;
  const x = (at: number): string => (CURVE.left + ((at - first.at) / tSpan) * (CURVE.width - CURVE.left)).toFixed(1);
  const y = (v: number): string => (CURVE.base - ((v - vMin) / vSpan) * (CURVE.base - CURVE.top)).toFixed(1);
  const coords: string[] = [`${x(first.at)},${y(first.value)}`];
  for (let i = 1; i < points.length; i += 1) {
    coords.push(`${x(points[i].at)},${y(points[i - 1].value)}`, `${x(points[i].at)},${y(points[i].value)}`);
  }
  const line = coords.join(' ');
  const area = `${line} ${x(last.at)},${CURVE.base.toFixed(1)} ${x(first.at)},${CURVE.base.toFixed(1)}`;
  return `<svg class="fmk-curve" viewBox="0 0 ${CURVE.width} ${CURVE.height}" role="img" aria-label="${escapeHtml(opts.label)}">`
    + `<line class="fmk-curve-grid" x1="${CURVE.left}" y1="${CURVE.base}" x2="${CURVE.width}" y2="${CURVE.base}"/>`
    + `<line class="fmk-curve-grid fmk-curve-grid--top" x1="${CURVE.left}" y1="${CURVE.top}" x2="${CURVE.width}" y2="${CURVE.top}"/>`
    + `<polygon class="fmk-curve-area" points="${area}"/>`
    + `<polyline class="fmk-curve-line" points="${line}"/>`
    + `<g class="fmk-curve-axis" aria-hidden="true">`
    + `<text x="12" y="12" text-anchor="end">${vMax}</text><text x="12" y="63" text-anchor="end">${vMin}</text>`
    + `<text x="${CURVE.left}" y="78">${escapeHtml(opts.timeLabel(first.at))}</text>`
    + `<text x="${CURVE.width}" y="78" text-anchor="end">${escapeHtml(opts.timeLabel(last.at))}</text>`
    + `</g></svg>`;
}
```

Run: `npx vitest run src/components/fiche/kit.test.ts` → PASS. Si `toLocaleDateString('en-GB', { day, month })` ne donne pas `30/09`, adapter l'attendu anglais à la sortie réelle (pas la fonction) et le dire dans le rapport.

- [ ] **Step 3: Tests de `parseScoreLine` (échouent)**

Dans `src/services/situation-text.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { parseScoreLine } from './situation-text.ts';

describe('lignes chiffrées du moteur (spec 2026-10-01 fiches § 4.2)', () => {
  it('« libellé : n/m »', () => {
    expect(parseScoreLine('Ransomware : 25/25')).toEqual({ label: 'Ransomware', value: 25, max: 25, display: '25/25', note: null });
  });
  it('note entre parenthèses conservée', () => {
    expect(parseScoreLine('Score cyber consolidé : 65/100 (tendance stable)'))
      .toEqual({ label: 'Score cyber consolidé', value: 65, max: 100, display: '65/100', note: 'tendance stable' });
    expect(parseScoreLine('Vigilance stocks pétroliers : sous tension (score 49/100)'))
      .toEqual({ label: 'Vigilance stocks pétroliers', value: 49, max: 100, display: '49/100', note: 'sous tension' });
  });
  it('fraction décimale à la française', () => {
    expect(parseScoreLine('Indice : 3,5/10')).toEqual({ label: 'Indice', value: 3.5, max: 10, display: '3,5/10', note: null });
  });
  it('phrase sans « libellé : » ou sans fraction : null', () => {
    expect(parseScoreLine('Baromètre cyber consolidé à 65/100, dominé par ransomware.')).toBeNull();
    expect(parseScoreLine('Tension carburant : critique')).toBeNull();
  });
});
```

Run: `npx vitest run src/services/situation-text.test.ts` → FAIL.

- [ ] **Step 4: Écrire `parseScoreLine`**

Ajouter à `src/services/situation-text.ts` :

```ts
const FRACTION = /(\d+(?:[.,]\d+)?)\s*\/\s*(\d+)/;

/**
 * « Libellé : n/m (note) » → barre d'indicateur (fiche situation, spec 2026-10-01 fiches § 4.2) ;
 * null pour une phrase sans « libellé : » ni fraction, qui reste une note texte.
 */
export function parseScoreLine(line: string): { label: string; value: number; max: number; display: string; note: string | null } | null {
  const sep = line.indexOf(' : ');
  if (sep <= 0) return null;
  const label = line.slice(0, sep).trim();
  const rest = line.slice(sep + 3);
  const match = FRACTION.exec(rest);
  if (!match) return null;
  const value = Number(match[1].replace(',', '.'));
  const max = Number(match[2]);
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return null;
  const note = rest.replace(match[0], '').replace(/\bscore\b/i, '').replace(/[()]/g, '').replace(/\s+/g, ' ').trim();
  return { label, value, max, display: `${match[1]}/${match[2]}`, note: note === '' ? null : note };
}
```

Run → PASS. Mettre à jour le commentaire d'en-tête du fichier : les sous-scores alimentent la section « Indicateurs » (plus le volet « Pourquoi ce niveau ? »).

- [ ] **Step 5: Littéraux « — » de `france-indicators.ts`**

Dans `src/components/fiche/france-indicators.ts`, remplacer chaque littéral « — » de valeur absente par « n.d. » ; adapter dans `france-indicators.test.ts` les attendus qui contenaient « — » (ex. éolien sans données). `grep -n "—" src/components/fiche/france-indicators.ts` ne doit plus montrer de littéral (les commentaires peuvent rester).

- [ ] **Step 6: Vérifications et commit**

Run: `npm run typecheck && npx vitest run && npm run build`

```bash
git add src/components/fiche/kit.ts src/components/fiche/kit.test.ts src/services/situation-text.ts src/services/situation-text.test.ts src/components/fiche/france-indicators.ts src/components/fiche/france-indicators.test.ts
git commit -m "feat(v2): kit : heure absolue, intensité, courbe en escalier, lignes chiffrées du moteur

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016CCTVuVKLioWAncSRysDPG"
```

---

### Task 2: En-tête kit pour toutes les fiches, sections au ton « référence », changements datés

**Files:**
- Modify: `src/components/fiche/parts.ts`
- Test: `src/components/fiche/parts.test.ts`
- Modify: `src/components/fiche/france.ts` (appel de `renderChangeRows`)

**Interfaces:**
- Consumes: tâche 1 (`absoluteTime`).
- Produces: `FicheModel.lead?: string` (synthèse, texte brut) ; `FicheModel.context?: string[]` (éléments de la ligne de niveau, texte brut) ; `FicheModel.reference?: string` (texte à copier) ; `FicheSection.tone?: 'reference'` (classe `fmk-sec--ref`) ; en-tête kit `<header class="fiche-head fmk-head">` avec `fmk-eyebrow` (type), `<h2 class="fiche-name fmk-title" tabindex="-1">` (nom), `fmk-level` (pastille + contexte séparés par `<span class="fmk-sep" aria-hidden="true">•</span>`), `<p class="fmk-lead">` ; toutes les fiches ont la classe `fiche fmk` ; `renderChangeRows(changes, lang, now)` : heures absolues, « n.d. » pour une heure inconnue, première ligne `fiche-change is-latest`.

- [ ] **Step 1: Tests (échouent)**

Dans `src/components/fiche/parts.test.ts`, ajouter :

```ts
describe('en-tête kit des fiches sans score (spec 2026-10-01 fiches § 2)', () => {
  it('sur-titre, titre, pastille et contexte séparés, synthèse', () => {
    const html = renderFiche(model({ kind: 'Événement · Sécurité', name: 'Titre <b>', level: 'orange', context: ['Haut-Rhin (68)', 'depuis 30/09 19:11'], lead: 'Repris par 8 sources.' }), 'fr');
    expect(html).toContain('<article class="fiche fmk" data-fiche="event:42">');
    expect(html).toContain('<div class="fmk-eyebrow">Événement · Sécurité</div>');
    expect(html).toContain('<h2 class="fiche-name fmk-title" tabindex="-1">Titre &lt;b&gt;</h2>');
    expect(html).toContain('fm-vig--orange');
    expect(html).toContain('<span>Haut-Rhin (68)</span><span class="fmk-sep" aria-hidden="true">•</span><span>depuis 30/09 19:11</span>');
    expect(html).toContain('<p class="fmk-lead">Repris par 8 sources.</p>');
  });

  it('section au ton « référence »', () => {
    const html = renderFiche(model({ sections: [{ id: 'articles', title: 'Articles', html: '', collapsible: true, tone: 'reference' }] }), 'fr');
    expect(html).toContain('<details class="fiche-part fmk-sec fmk-sec--ref" data-section="event:42:articles">');
  });

  it('changements : heures absolues, « n.d. », dernier mis en avant', () => {
    const now = Date.parse('2026-10-01T08:30:00Z');
    const rows = renderChangeRows([
      { at: Date.parse('2026-10-01T08:00:00Z'), text: 'corroboré 4 → 5', select: null },
      { at: Date.parse('2026-09-30T21:00:00Z'), text: 'corroboré 1 → 2', select: null },
      { at: null, text: 'créé', select: null },
    ], 'fr', now);
    expect(rows).toContain('<li class="fiche-change is-latest"><span class="fiche-time">10:00</span>');
    expect(rows).toContain('<span class="fiche-time">30/09 23:00</span>');
    expect(rows).toContain('<span class="fiche-time">n.d.</span>');
  });
});
```

Ajouter `renderChangeRows` à l'import de `./parts.ts`. Dans les tests existants qui attendaient `<article class="fiche" ` ou l'ancien en-tête (`fiche-kind`, `<h2 class="fiche-name" tabindex="-1">`), aligner sur le nouvel en-tête.

Run: `npx vitest run src/components/fiche/parts.test.ts` → FAIL.

- [ ] **Step 2: Implémenter**

Dans `src/components/fiche/parts.ts` :
1. Importer `absoluteTime` depuis `./kit.ts` (avec `CHEVRON_SVG`, `meterRow`).
2. `FicheSection` : ajouter `/** Ton discret des sections de référence (articles, sources). */ tone?: 'reference';`.
3. `FicheModel` : ajouter
   ```ts
   /** Synthèse en tête de fiche, texte brut (en-tête kit). */
   lead?: string;
   /** Éléments de la ligne de niveau (lieu, depuis, statut…), texte brut. */
   context?: string[];
   /** Texte copié par l'action « Copier la référence ». */
   reference?: string;
   ```
4. Remplacer `renderChangeRows` par :
   ```ts
   /** Lignes de changements (heure absolue, texte, lien), la plus récente mise en avant ; '' si aucune. */
   export function renderChangeRows(changes: readonly FicheChange[], lang: Lang, now: number): string {
     const rows = changes.map((c, index) => {
       const time = `<span class="fiche-time">${c.at === null ? 'n.d.' : absoluteTime(c.at, now, lang)}</span>`;
       const text = escapeHtml(c.text);
       const body = c.select
         ? `<button type="button" class="fiche-link" data-select="${escapeHtml(c.select)}">${text}</button>`
         : `<span>${text}</span>`;
       return `<li class="fiche-change${index === 0 ? ' is-latest' : ''}">${time} ${body}</li>`;
     }).join('');
     return rows ? `<ul class="fiche-list">${rows}</ul>` : '';
   }
   ```
   et dans `renderChanges(model, lang)` l'appel devient `renderChangeRows(model.changes, lang, Date.now())` (partie générique en sursis, retirée en tâche 6).
5. Ajouter :
   ```ts
   /** En-tête kit des fiches sans score : sur-titre, titre, pastille et contexte, synthèse. */
   function renderKitHead(model: FicheModel, lang: Lang): string {
     const pill = model.level ? renderVigilancePill(model.level, lang) : '';
     const context = (model.context ?? []).map((c) => `<span>${escapeHtml(c)}</span>`).join('<span class="fmk-sep" aria-hidden="true">•</span>');
     return `<header class="fiche-head fmk-head">`
       + `<div class="fmk-eyebrow">${escapeHtml(model.kind)}</div>`
       + `<h2 class="fiche-name fmk-title" tabindex="-1">${escapeHtml(model.name)}</h2>`
       + (pill || context ? `<div class="fmk-level">${pill}${context}</div>` : '')
       + (model.lead ? `<p class="fmk-lead">${escapeHtml(model.lead)}</p>` : '')
       + `</header>`;
   }
   ```
6. Dans `renderFiche` : `const head = model.score !== undefined ? renderScoreHead(model, model.score, lang) : renderKitHead(model, lang);` (supprimer l'ancien en-tête simple et les variables `pill`/`driver` devenues inutiles) ; l'`<article>` porte toujours `class="fiche fmk"`.
7. Dans `renderSection`, la classe devient `fiche-part fmk-sec${s.tone === 'reference' ? ' fmk-sec--ref' : ''}` (pour `<details>` et `<section>`).
8. Dans `src/components/fiche/france.ts`, `changesHtml` appelle `renderChangeRows(rows, input.lang, input.now)`.

Les champs `driver` et `freshness` restent (en-tête « Instrument » de la France). Les fiches pas encore migrées gardent leurs parties génériques jusqu'à la tâche 6 ; leur ancienne ligne `driver`/`freshness` n'est plus affichée par l'en-tête kit : c'est attendu (les tâches 3 à 5 la remplacent par `context`).

Run: `npx vitest run src/components/fiche/ src/components/poste/` → corriger les attendus des tests existants qui lisaient l'ancien en-tête des fiches (`fiche-kind`, `fiche-driver`, `fiche-fresh`) en les alignant sur l'en-tête kit, sans changer le comportement testé ; ne pas toucher aux tests de l'en-tête « Instrument ».

- [ ] **Step 3: Vérifications et commit**

Run: `npm run typecheck && npx vitest run && npm run build`

```bash
git add src/components/fiche/parts.ts src/components/fiche/parts.test.ts src/components/fiche/france.ts src/components/fiche/*.test.ts src/components/poste/*.test.ts
git commit -m "feat(v2): en-tête kit pour toutes les fiches, ton référence, changements datés

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016CCTVuVKLioWAncSRysDPG"
```

---

### Task 3: Fiche événement

**Files:**
- Modify: `src/components/fiche/items.ts` (`EventFicheInput`, `buildEventFiche` et ses aides)
- Test: `src/components/fiche/items.test.ts` (tests de la fiche événement)
- Modify: `src/components/poste/PosteSituation.ts` (appel de `buildEventFiche` : `place`, `sectionOpen: new Map()`, `now`)

**Interfaces:**
- Consumes: tâches 1 et 2 (`absoluteTime`, `stepCurve`, `CurvePoint`, `kvRow`, `renderChangeRows(…, now)`, `lead`, `context`, `reference`, `tone`).
- Produces: `EventFicheInput { event; detail; place: { code: string; nom: string } | null; sectionOpen: ReadonlyMap<string, boolean>; lang; now }` (plus de `whyOpen`) ; sections `indicators` (ouverte), `evolution` (ouverte), `articles` (repliée, ton référence) ; actions `map` (si coordonnées) et `copy-ref` ; `reference` rempli.

- [ ] **Step 1: Tests (échouent)**

Dans `src/components/fiche/items.test.ts`, remplacer les tests de la fiche événement par :

```ts
describe('fiche événement (spec 2026-10-01 fiches § 4.1)', () => {
  const NOW = Date.parse('2026-10-01T08:30:00Z');
  const ev = (over: Partial<NewsEvent> = {}): NewsEvent => ({
    id: 13516, evidenceId: 'E13516', title: 'Haut-Rhin : menace d’attentat contre un lycée', category: 'security', severity: 'medium',
    status: 'cooling', firstSeen: '2026-09-30T17:11:00Z', lastSeen: '2026-10-01T06:44:00Z', articleCount: 11, sourceCount: 8,
    independentCount: 5, sourceNames: ['Le Dauphiné', 'Le Progrès', 'DNA'], lat: 47.6, lon: 7.5, peakSeverity: 'medium',
    zone: 'france', temporality: 'en_cours', reasons: [], ...over,
  });
  const detail: NewsEventDetail = {
    event: ev(),
    articles: [
      { id: 1, title: 'Article ancien', link: 'https://exemple.fr/a', feedName: 'DNA', publishedAt: '2026-09-30T17:11:00Z' },
      { id: 2, title: 'Article récent <b>', link: 'https://exemple.fr/b', feedName: 'Le Figaro', publishedAt: '2026-10-01T04:44:00Z' },
    ],
    log: [
      { at: '2026-10-01T06:30:00Z', kind: 'cooling', from: null, to: null },
      { at: '2026-09-30T21:00:00Z', kind: 'corroborated', from: '1', to: '2' },
      { at: '2026-10-01T08:30:00Z', kind: 'corroborated', from: '4', to: '5' },
      { at: '2026-10-01T05:00:00Z', kind: 'corroborated', from: '2', to: '3' },
      { at: '2026-10-01T07:00:00Z', kind: 'corroborated', from: '3', to: '4' },
    ],
  };
  const build = (over: Partial<EventFicheInput> = {}): FicheModel => buildEventFiche({
    event: ev(), detail, place: { code: '68', nom: 'Haut-Rhin' }, sectionOpen: new Map(), lang: 'fr', now: NOW, ...over,
  });
  const byId = (m: FicheModel) => new Map(m.sections.map((s) => [s.id, s]));

  it('en-tête : lieu avec numéro, depuis en heure absolue, statut daté, synthèse', () => {
    const m = build();
    expect(m.kind).toBe('Événement · Sécurité et défense');
    expect(m.context).toEqual(['Haut-Rhin (68)', 'depuis 30/09 19:11', 'en refroidissement depuis 08:30']);
    expect(m.lead).toBe('Repris par 8 sources (Le Dauphiné, Le Progrès, DNA). Dernier article à 08:44.');
  });

  it('sections : indicateurs et évolution ouverts, articles repliés au ton référence', () => {
    const s = byId(build());
    expect(s.get('indicators')).toMatchObject({ collapsible: true, open: true, summary: '5 groupes indépendants · 11 articles' });
    expect(s.get('evolution')).toMatchObject({ collapsible: true, open: true, summary: '5 changements' });
    expect(s.get('articles')).toMatchObject({ collapsible: true, open: false, tone: 'reference', summary: '11 articles · 8 flux' });
    expect(byId(build({ sectionOpen: new Map([['articles', true], ['indicators', false]]) })).get('articles')?.open).toBe(true);
  });

  it('indicateurs : courbe de corroboration 1 → 5, confirmation, gravité, volume, lieu, preuve', () => {
    const html = byId(build()).get('indicators')?.html ?? '';
    expect(html).toContain('class="fmk-curve"');
    expect(html).toContain('<text x="12" y="12" text-anchor="end">5</text>');
    expect(html).toContain('confirmé par 5 groupes de presse indépendants');
    expect(html).toContain('fm-vig--jaune');
    expect(html).toContain('11 articles · 8 flux');
    expect(html).toContain('Haut-Rhin (68)');
    expect(html).toContain('E13516');
  });

  it('à confirmer : contexte et gravité signalée au-dessus de la retenue ; motifs en mots', () => {
    const m = build({ event: ev({ severity: 'medium', peakSeverity: 'high', independentCount: 1, sourceCount: 1, reasons: ['non_confirme'] }) });
    expect(m.context).toContain('à confirmer, signalé orange');
    const html = byId(m).get('indicators')?.html ?? '';
    expect(html).toContain('source unique');
    expect(html).toContain('niveau le plus grave signalé par une seule source indépendante');
  });

  it('évolution : heures absolues, la plus récente en tête', () => {
    const html = byId(build()).get('evolution')?.html ?? '';
    expect(html.indexOf('10:30')).toBeLessThan(html.indexOf('09:00'));
    expect(html).toContain('<li class="fiche-change is-latest"><span class="fiche-time">10:30</span>');
    expect(html).toContain('30/09 23:00');
  });

  it('articles : lignes simples, du plus récent au plus ancien, échappés, date absolue', () => {
    const html = byId(build()).get('articles')?.html ?? '';
    expect(html.indexOf('Article récent')).toBeLessThan(html.indexOf('Article ancien'));
    expect(html).toContain('Article récent &lt;b&gt;');
    expect(html).toContain('<small>Le Figaro · 06:44</small>');
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
    expect(html).not.toContain('fiche-source');
  });

  it('détail absent, en cours ou en erreur : messages, pas de courbe, jamais d’exception', () => {
    for (const d of [undefined, 'loading', 'error'] as const) {
      const s = byId(build({ detail: d }));
      expect(s.get('indicators')?.html).not.toContain('fmk-curve');
      expect(s.get('evolution')?.html).toContain(d === 'error' ? 'Journal indisponible pour le moment.' : 'Chargement du journal…');
      expect(s.get('articles')?.html).toContain(d === 'error' ? 'Articles indisponibles pour le moment.' : 'Chargement des articles…');
    }
  });

  it('référence copiable et actions', () => {
    const m = build();
    expect(m.reference).toBe('E13516 · Haut-Rhin : menace d’attentat contre un lycée · Jaune · première apparition 30/09 19:11');
    expect(m.actions.map((a) => a.id)).toEqual(['map', 'copy-ref']);
    expect(build({ event: ev({ lat: null, lon: null }) }).actions.map((a) => a.id)).toEqual(['copy-ref']);
  });

  it('étranger : lieu « à l’étranger » ; aucun tiret cadratin nulle part', () => {
    const m = build({ event: ev({ zone: 'etranger' }), place: null });
    expect(m.context?.[0]).toBe('à l’étranger');
    expect(JSON.stringify(m)).not.toContain('—');
  });
});
```

(Adapter les imports : `buildEventFiche`, `type EventFicheInput`, `type NewsEvent`, `type NewsEventDetail`, `type FicheModel`.) Le niveau retenu de l'exemple : `severity: 'medium'` → jaune ; si `eventDisplayLevel` en décide autrement, aligner les attendus « Jaune » / `fm-vig--jaune` sur la valeur réelle.

Run: `npx vitest run src/components/fiche/items.test.ts` → FAIL.

- [ ] **Step 2: Implémenter**

Dans `src/components/fiche/items.ts` :
1. Imports : ajouter `absoluteTime, kvRow, stepCurve, type CurvePoint` depuis `./kit.ts` ; `renderChangeRows` depuis `./parts.ts`.
2. Remplacer `EventFicheInput` par :
   ```ts
   export interface EventFicheInput {
     event: NewsEvent;
     /** Articles et journal, chargés à la demande (undefined tant que la demande n'est pas partie). */
     detail: EventDetailState | undefined;
     /** Département sous le point de l'événement (null si inconnu). */
     place: { code: string; nom: string } | null;
     /** Ouverture retenue par id de section pour les fiches événement. */
     sectionOpen: ReadonlyMap<string, boolean>;
     lang: Lang;
     now: number;
   }
   ```
3. Ajouter les aides :
   ```ts
   function confirmationText(e: NewsEvent, lang: Lang): string {
     const n = e.independentCount;
     if (n >= 2) return t(lang, `confirmé par ${n} groupes de presse indépendants`, `confirmed by ${n} independent press groups`);
     if (e.sourceCount > 1) return t(lang, `un seul groupe de presse (${e.sourceCount} titres)`, `a single press group (${e.sourceCount} outlets)`);
     return t(lang, 'source unique', 'single source');
   }

   type EventLog = NewsEventDetail['log'];

   /** Journal du plus récent au plus ancien (heure inconnue en dernier). */
   function sortedLog(log: EventLog): EventLog {
     return [...log].sort((a, b) => (parseTime(b.at) ?? 0) - (parseTime(a.at) ?? 0));
   }

   function statusText(e: NewsEvent, log: EventLog | null, now: number, lang: Lang): string {
     if (e.status === 'active') return t(lang, 'actif', 'active');
     if (e.status === 'closed') return t(lang, 'clos', 'closed');
     const cooling = log?.find((entry) => entry.kind === 'cooling');
     const at = cooling ? parseTime(cooling.at) : null;
     return at === null
       ? t(lang, 'en refroidissement', 'cooling')
       : t(lang, `en refroidissement depuis ${absoluteTime(at, now, lang)}`, `cooling since ${absoluteTime(at, now, lang)}`);
   }

   /** Groupes indépendants dans le temps, depuis les changements « corroboré » du journal. */
   function corroborationPoints(e: NewsEvent, log: EventLog | null): CurvePoint[] {
     if (!log) return [];
     const steps = log
       .filter((entry) => entry.kind === 'corroborated' && entry.to !== null)
       .map((entry) => ({ at: parseTime(entry.at), from: Number(entry.from), to: Number(entry.to) }))
       .filter((s): s is { at: number; from: number; to: number } => s.at !== null && Number.isFinite(s.to))
       .sort((a, b) => a.at - b.at);
     if (steps.length === 0) return [];
     const start = parseTime(e.firstSeen) ?? steps[0].at;
     const points: CurvePoint[] = [{ at: Math.min(start, steps[0].at), value: Number.isFinite(steps[0].from) ? steps[0].from : 1 }];
     for (const s of steps) points.push({ at: s.at, value: s.to });
     const end = parseTime(e.lastSeen);
     if (end !== null && end > steps[steps.length - 1].at) points.push({ at: end, value: steps[steps.length - 1].to });
     return points;
   }

   function eventPlaceText(e: NewsEvent, place: EventFicheInput['place'], lang: Lang): string | null {
     if (e.zone === 'etranger') return t(lang, 'à l’étranger', 'abroad');
     if (place) return `${place.nom} (${place.code})`;
     return e.zone === 'france' ? 'France' : null;
   }
   ```
4. Remplacer `buildEventFiche` par :
   ```ts
   export function buildEventFiche(input: EventFicheInput): FicheModel {
     const { event: e, detail, lang, now } = input;
     const i = lang === 'fr' ? 0 : 1;
     const level = eventDisplayLevel(e.severity, e.peakSeverity);
     const unconfirmed = unconfirmedPeakLevel(e.severity, e.peakSeverity);
     const loaded = detail !== undefined && detail !== 'loading' && detail !== 'error' ? detail : null;
     const log = loaded ? sortedLog(loaded.log) : null;
     const firstSeen = parseTime(e.firstSeen) ?? now;
     const lastSeen = parseTime(e.lastSeen);
     const open = (id: string, byDefault: boolean): boolean => input.sectionOpen.get(id) ?? byDefault;
     const theme = themeLabel(categoryTheme(e.category), lang);
     const placeText = eventPlaceText(e, input.place, lang);

     const context = [
       placeText,
       t(lang, `depuis ${absoluteTime(firstSeen, now, lang)}`, `since ${absoluteTime(firstSeen, now, lang)}`),
       statusText(e, log, now, lang),
       unconfirmed ? t(lang, `à confirmer, signalé ${levelLabel(unconfirmed, lang).toLowerCase()}`, `unconfirmed, reported ${levelLabel(unconfirmed, lang).toLowerCase()}`) : null,
     ].filter((c): c is string => c !== null);

     const names = e.sourceNames.slice(0, 4).join(', ');
     const last = lastSeen !== null ? t(lang, ` Dernier article à ${absoluteTime(lastSeen, now, lang)}.`, ` Last article at ${absoluteTime(lastSeen, now, lang)}.`) : '';
     const lead = t(lang,
       `Repris par ${e.sourceCount} source${plural(e.sourceCount)}${names ? ` (${names})` : ''}.${last}`,
       `Reported by ${e.sourceCount} source${plural(e.sourceCount)}${names ? ` (${names})` : ''}.${last}`);

     const points = corroborationPoints(e, log);
     const curve = stepCurve(points, {
       label: t(lang, `Groupes de presse indépendants, de ${points[0]?.value ?? 1} à ${e.independentCount}`, `Independent press groups, from ${points[0]?.value ?? 1} to ${e.independentCount}`),
       timeLabel: (ms) => absoluteTime(ms, now, lang),
     });
     const reasons = (e.reasons ?? []).map((r) => REASON_LABEL[r][i]);
     const reported = eventLevel(e.peakSeverity ?? e.severity);
     const rows = [
       kvRow(t(lang, 'Confirmation', 'Confirmation'), escapeHtml(confirmationText(e, lang))),
       kvRow(t(lang, 'Gravité', 'Severity'), `${renderVigilancePill(reported, lang)} ${t(lang, 'signalée', 'reported')} → ${renderVigilancePill(level, lang)} ${t(lang, 'retenue', 'kept')}`),
       reasons.length > 0 ? kvRow(t(lang, 'Motifs', 'Reasons'), escapeHtml(reasons.join(' ; '))) : '',
       kvRow(t(lang, 'Volume', 'Volume'), escapeHtml(t(lang, `${e.articleCount} articles · ${e.sourceCount} flux`, `${e.articleCount} articles · ${e.sourceCount} feeds`))),
       placeText ? kvRow(t(lang, 'Lieu', 'Location'), escapeHtml(placeText)) : '',
       e.temporality ? kvRow(t(lang, 'Temporalité', 'Timing'), escapeHtml(TEMPORALITY_LABEL[e.temporality][i])) : '',
       kvRow(t(lang, 'Classement', 'Classification'), escapeHtml(theme)),
       kvRow(t(lang, 'Preuve', 'Evidence'), escapeHtml(e.evidenceId)),
     ].join('');
     const indicators = (curve ? `<div class="fmk-sub">${t(lang, 'Corroboration : groupes de presse indépendants', 'Corroboration: independent press groups')}</div>${curve}` : '')
       + `<div class="fmk-kvs">${rows}</div>`;

     const pending = (fr: string, en: string): string => `<p class="fmk-muted">${t(lang, fr, en)}</p>`;
     const evolution = log
       ? (log.length > 0
         ? renderChangeRows(log.slice(0, 8).map((entry) => ({ at: parseTime(entry.at), text: logText(entry, lang), select: null })), lang, now)
         : pending('Aucun changement.', 'No change.'))
       : detail === 'error'
         ? pending('Journal indisponible pour le moment.', 'Log unavailable right now.')
         : pending('Chargement du journal…', 'Loading log…');

     const articles = loaded
       ? [...loaded.articles].sort((a, b) => (parseTime(b.publishedAt ?? '') ?? 0) - (parseTime(a.publishedAt ?? '') ?? 0))
       : null;
     const articleRows = (articles ?? []).map((a) => {
       const at = a.publishedAt ? parseTime(a.publishedAt) : null;
       const meta = [a.feedName, at !== null ? absoluteTime(at, now, lang) : null].filter((x): x is string => x !== null && x !== '').join(' · ');
       const href = safeHref(a.link);
       const title = escapeHtml(a.title);
       return `<li class="fmk-row">${href ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${title}</a>` : `<span>${title}</span>`}`
         + `${meta ? `<small>${escapeHtml(meta)}</small>` : ''}</li>`;
     }).join('');
     const articlesHtml = articles
       ? `<ul class="fmk-rows">${articleRows}</ul>`
       : detail === 'error'
         ? pending('Articles indisponibles pour le moment.', 'Articles unavailable right now.')
         : pending('Chargement des articles…', 'Loading articles…');

     const n = e.independentCount;
     const actions: FicheAction[] = e.lat !== null && e.lon !== null ? [{ id: 'map', label: t(lang, 'Voir sur la carte', 'Show on map') }] : [];
     actions.push({ id: 'copy-ref', label: t(lang, 'Copier la référence', 'Copy reference') });
     return {
       key: `event:${e.id}`,
       kind: `${t(lang, 'Événement', 'Event')} · ${theme}`,
       name: e.title,
       level,
       driver: '',
       freshness: '',
       context,
       lead,
       // Parties génériques retirées en tâche 6.
       essentiel: [], changesMeta: '', changes: [], figures: [], watch: [], sourcesTitle: '', sources: [], why: '', whyOpen: false,
       sections: [
         {
           id: 'indicators', title: t(lang, 'Indicateurs', 'Indicators'), collapsible: true, open: open('indicators', true), html: indicators,
           summary: escapeHtml(t(lang, `${n} groupe${plural(n)} indépendant${plural(n)} · ${e.articleCount} articles`, `${n} independent group${plural(n)} · ${e.articleCount} articles`)),
         },
         {
           id: 'evolution', title: t(lang, 'Évolution', 'Evolution'), collapsible: true, open: open('evolution', true), html: evolution,
           summary: log ? escapeHtml(t(lang, `${log.length} changement${plural(log.length)}`, `${log.length} change${plural(log.length)}`)) : '',
         },
         {
           id: 'articles', title: t(lang, 'Articles', 'Articles'), collapsible: true, open: open('articles', false), tone: 'reference', html: articlesHtml,
           summary: escapeHtml(t(lang, `${e.articleCount} articles · ${e.sourceCount} flux`, `${e.articleCount} articles · ${e.sourceCount} feeds`)),
         },
       ],
       reference: `${e.evidenceId} · ${e.title} · ${levelLabel(level, lang)} · ${t(lang, 'première apparition', 'first seen')} ${absoluteTime(firstSeen, now, lang, { withDate: true })}`,
       actions,
     };
   }
   ```
   Supprimer `STATUS_LABEL` s'il n'est plus utilisé, et l'import de `formatAge` s'il devient inutile.
5. Dans `src/components/poste/PosteSituation.ts`, `ficheFor` (branche `event:`) : remplacer l'appel par
   ```ts
   const place = event.lat !== null && event.lon !== null ? this.departements?.at(event.lon, event.lat) ?? null : null;
   return buildEventFiche({ event, detail: this.eventDetails.get(event.id), place, sectionOpen: new Map(), lang, now });
   ```
   (la mémoire par type est câblée en tâche 7).

Run: `npx vitest run src/components/fiche/ src/components/poste/` → PASS ; corriger les tests de `PosteSituation.test.ts` qui lisaient l'ancienne fiche événement (`Pourquoi ce niveau ?`, `Chiffres clés`) en les alignant sur les sections nouvelles.

- [ ] **Step 3: Vérifications et commit**

Run: `npm run typecheck && npx vitest run && npm run build`

```bash
git add src/components/fiche/items.ts src/components/fiche/items.test.ts src/components/poste/PosteSituation.ts src/components/poste/PosteSituation.test.ts
git commit -m "feat(v2): fiche événement hiérarchisée : courbe de corroboration, heures absolues, référence copiable

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016CCTVuVKLioWAncSRysDPG"
```

---

### Task 4: Fiche situation (et alerte)

**Files:**
- Modify: `src/components/fiche/items.ts` (`SituationFicheInput`, `buildSituationFiche`)
- Test: `src/components/fiche/items.test.ts` (tests situation, dont l'ancien test A7)
- Modify: `src/components/poste/PosteSituation.ts` (deux appels : `sectionOpen: new Map()`, `now`, plus de `whyOpen`)
- Test: `src/components/poste/PosteSituation.test.ts` (test « le volet Pourquoi ce niveau ? d'une fiche situation… » supprimé : la fiche situation n'a plus de volet ; la persistance par type est testée en tâche 7)

**Interfaces:**
- Consumes: tâches 1 et 2 (`parseScoreLine`, `intensityLevel`, `meterRow` neutre, `absoluteTime`, `renderSourceChips`, `lead`, `context`, `reference`, `tone`).
- Produces: `SituationFicheInput { situation; kind; badge; changeAt; hasDossier; sectionOpen: ReadonlyMap<string, boolean>; lang; now }` ; sections `indicators`, `todo`, `factors`, `zones` (ouvertes), `sources` (repliée, référence) ; actions existantes + `copy-ref`.

- [ ] **Step 1: Tests (échouent)**

Remplacer les tests de la fiche situation par (fixture : reprendre celle du fichier pour `DetectedSituation`, en l'adaptant) :

```ts
describe('fiche situation (spec 2026-10-01 fiches § 4.2)', () => {
  const NOW = Date.parse('2026-10-01T08:30:00Z');
  const sit = (over: Partial<DetectedSituation> = {}): DetectedSituation => ({
    id: 'cyber-pressure', type: 'CYBER_PRESSURE', severity: 'high', confidence: 0.8, title: 'Pression cyber multi-source',
    summary: 'Pression cyber soutenue. Baromètre cyber consolidé à 65/100, dominé par ransomware.',
    affectedZones: ['France'],
    drivers: ['Score cyber consolidé : 65/100 (tendance stable)', 'Ransomware : 25/25', 'CERT/NVD : 14/20', 'Ransomwares actifs en hausse'],
    recommendedActions: [{ label: 'Surveiller les revendications', ownerHint: 'Analyste cyber', actionType: 'monitor', automatable: true }],
    sourceRefs: ['CERT-FR', 'RansomwareLive'], updatedAt: new Date('2026-10-01T06:57:00Z'), ...over,
  });
  const build = (over: Partial<SituationFicheInput> = {}): FicheModel => buildSituationFiche({
    situation: sit(), kind: 'situation', badge: null, changeAt: null, hasDossier: false, sectionOpen: new Map(), lang: 'fr', now: NOW, ...over,
  });
  const byId = (m: FicheModel) => new Map(m.sections.map((s) => [s.id, s]));

  it('en-tête : sur-titre avec thème, phrase du niveau, zones, mise à jour absolue ; synthèse non chiffrée', () => {
    const m = build();
    expect(m.kind).toMatch(/^Situation · /);
    expect(m.context).toEqual(['soyez très vigilant', 'France', 'mise à jour 08:57']);
    expect(m.lead).toBe('Pression cyber soutenue.');
  });

  it('indicateurs ouverts : une barre par sous-score à sa propre intensité, confiance grise, phrase chiffrée en note, provenance', () => {
    const s = byId(build());
    const ind = s.get('indicators');
    expect(ind).toMatchObject({ collapsible: true, open: true, summary: 'confiance élevée' });
    const html = ind?.html ?? '';
    expect(html).toContain('Score cyber consolidé');
    expect(html).toContain('width:65%;background:var(--sev-yellow)');
    expect(html).toContain('width:100%;background:var(--sev-red)');
    expect(html).toContain('width:70%;background:var(--sev-orange)');
    expect(html).toContain('tendance stable');
    expect(html).toContain('width:80%;background:var(--text-secondary)');
    expect(html).toContain('Baromètre cyber consolidé à 65/100, dominé par ransomware.');
    expect(html).toContain('Sources : CERT-FR, RansomwareLive · mise à jour 08:57');
  });

  it('à faire, facteurs non chiffrés, zones en étiquettes avec scores de zone en barres', () => {
    const m = build({ situation: sit({ affectedZones: ['Seine-Saint-Denis (72/100)', 'Paris'] }) });
    const s = byId(m);
    expect(s.get('todo')).toMatchObject({ open: true, summary: '1 action' });
    expect(s.get('todo')?.html).toContain('<ol class="fmk-todo">');
    expect(s.get('todo')?.html).toContain('<small>Analyste cyber · Surveillance · IA possible</small>');
    expect(s.get('factors')?.html).toContain('Ransomwares actifs en hausse');
    expect(s.get('factors')?.html).not.toContain('25/25');
    expect(s.get('zones')?.html).toContain('<span class="fmk-tag">Seine-Saint-Denis</span>');
    expect(s.get('indicators')?.html).toContain('width:72%');
    expect(m.context).toContain('Seine-Saint-Denis, Paris');
  });

  it('sources repliées au ton référence, lien d’origine en tête', () => {
    const s = byId(build({ situation: sit({ linkUrl: 'https://exemple.fr/x', linkLabel: 'Article' }) }));
    expect(s.get('sources')).toMatchObject({ collapsible: true, open: false, tone: 'reference', summary: '3 sources' });
    expect(s.get('sources')?.html.indexOf('Article')).toBeLessThan(s.get('sources')?.html.indexOf('CERT-FR') ?? 0);
  });

  it('nouveau depuis la visite dans le contexte ; référence copiable ; aucun tiret cadratin', () => {
    const m = build({ badge: 'nouveau' });
    expect(m.context).toContain('nouveau depuis votre visite');
    expect(m.reference).toBe('cyber-pressure · Pression cyber multi-source · Orange · mise à jour 01/10 08:57');
    expect(m.actions.map((a) => a.id)).toContain('copy-ref');
    expect(JSON.stringify(m)).not.toContain('—');
  });
});
```

Supprimer l'ancien test « les sous-scores du moteur ne sont visibles que dans « Pourquoi ce niveau ? » (A7) » (règle levée par la spec). Aligner « Orange » et `soyez très vigilant` sur `situationLevel('high')` / `levelPhrase` réels si différents.

Run → FAIL.

- [ ] **Step 2: Implémenter**

Remplacer `SituationFicheInput` (retirer `whyOpen`, ajouter `sectionOpen: ReadonlyMap<string, boolean>` et `now: number`) et `buildSituationFiche` par :

```ts
export function buildSituationFiche(input: SituationFicheInput): FicheModel {
  const { situation: s, lang, now } = input;
  const level = situationLevel(s.severity);
  const summary = splitScoreSentences(s.summary);
  const drivers = splitScoreLines(s.drivers);
  const zones = s.affectedZones.map(splitZoneScore);
  const updated = s.updatedAt.getTime();
  const open = (id: string, byDefault: boolean): boolean => input.sectionOpen.get(id) ?? byDefault;
  const names = zones.map((z) => z.name);
  const zoneText = names.length > 3 ? `${names.slice(0, 3).join(', ')} + ${names.length - 3}` : names.join(', ');
  const badgeText = input.badge === 'nouveau'
    ? t(lang, 'nouveau depuis votre visite', 'new since your visit')
    : input.badge === 'aggrave' ? t(lang, 'aggravé depuis votre visite', 'escalated since your visit') : null;
  const context = [
    levelPhrase(level, lang),
    zoneText || null,
    t(lang, `mise à jour ${absoluteTime(updated, now, lang)}`, `updated ${absoluteTime(updated, now, lang)}`),
    badgeText,
  ].filter((c): c is string => c !== null);
  const lead = summary.plain.length > 0
    ? summary.plain.slice(0, 3).join(' ')
    : t(lang, `${s.title} : ${levelVigilanceWord(level)}.`, `${s.title}: ${levelVigilanceWord(level, 'en')}.`);

  // Indicateurs (ex-« Pourquoi ce niveau ? », spec 2026-10-01 fiches § 2.3) : une barre par sous-score.
  const meters: string[] = [];
  const notes: string[] = [];
  const pushScore = (line: string): void => {
    const p = parseScoreLine(line);
    if (!p) {
      notes.push(line);
      return;
    }
    meters.push(meterRow({
      label: p.label, value: (p.value / p.max) * 100, level: intensityLevel(p.value, p.max), display: p.display,
      noteHtml: p.note ? `<span class="fmk-muted">${escapeHtml(p.note)}</span>` : undefined,
    }));
  };
  for (const line of [...drivers.scored, ...summary.scored]) pushScore(line);
  for (const z of zones) if (z.score !== null) pushScore(`${z.name} : ${z.score}`);
  const confidence = Math.round(s.confidence * 100);
  meters.push(meterRow({ label: t(lang, 'Confiance', 'Confidence'), value: confidence, level: null, neutral: true, display: `${confidence} %` }));
  const provenance = [
    s.sourceRefs.length > 0 ? `${t(lang, 'Sources', 'Sources')} : ${s.sourceRefs.join(', ')}` : null,
    t(lang, `mise à jour ${absoluteTime(updated, now, lang)}`, `updated ${absoluteTime(updated, now, lang)}`),
  ].filter((c): c is string => c !== null).join(' · ');
  const indicators = `<div class="fmk-meters fmk-meters--score">${meters.join('')}</div>`
    + notes.map((n) => `<p class="fmk-note">${escapeHtml(n)}</p>`).join('')
    + `<p class="fmk-note">${escapeHtml(provenance)}</p>`;

  const sections: FicheSection[] = [{
    id: 'indicators', title: t(lang, 'Indicateurs', 'Indicators'), collapsible: true, open: open('indicators', true),
    summary: escapeHtml(t(lang, `confiance ${confidenceLabel(s.confidence, lang)}`, `${confidenceLabel(s.confidence, lang)} confidence`)), html: indicators,
  }];
  if (s.recommendedActions.length > 0) {
    const items = s.recommendedActions.map((a) => {
      const meta = [a.ownerHint, ACTION_TYPE[a.actionType][lang === 'fr' ? 0 : 1], a.automatable ? t(lang, 'IA possible', 'AI possible') : null]
        .filter((x): x is string => x !== null && x !== '').join(' · ');
      return `<li>${escapeHtml(a.label)}<small>${escapeHtml(meta)}</small></li>`;
    }).join('');
    const n = s.recommendedActions.length;
    sections.push({ id: 'todo', title: t(lang, 'À faire', 'To do'), collapsible: true, open: open('todo', true),
      summary: escapeHtml(t(lang, `${n} action${plural(n)}`, `${n} action${plural(n)}`)), html: `<ol class="fmk-todo">${items}</ol>` });
  }
  if (drivers.plain.length > 0) {
    sections.push({ id: 'factors', title: t(lang, 'Facteurs', 'Drivers'), collapsible: true, open: open('factors', true),
      summary: String(drivers.plain.length), html: `<ul class="fiche-list">${drivers.plain.map((d) => `<li>${escapeHtml(d)}</li>`).join('')}</ul>` });
  }
  if (names.length > 0) {
    sections.push({ id: 'zones', title: t(lang, 'Zones', 'Areas'), collapsible: true, open: open('zones', true),
      summary: escapeHtml(t(lang, `${names.length} zone${plural(names.length)}`, `${names.length} area${plural(names.length)}`)),
      html: `<div class="fmk-tags">${names.map((z) => `<span class="fmk-tag">${escapeHtml(z)}</span>`).join('')}</div>` });
  }
  const sources: FicheSource[] = s.sourceRefs.map((label) => ({ label, href: null, select: null }));
  if (s.linkUrl && safeHref(s.linkUrl) !== null) {
    sources.unshift({ label: s.linkLabel ?? t(lang, 'Ouvrir la source', 'Open source'), href: s.linkUrl, select: null });
  }
  if (sources.length > 0) {
    sections.push({ id: 'sources', title: t(lang, 'Sources', 'Sources'), collapsible: true, open: open('sources', false), tone: 'reference',
      summary: escapeHtml(t(lang, `${sources.length} source${plural(sources.length)}`, `${sources.length} source${plural(sources.length)}`)), html: renderSourceChips(sources) });
  }

  const actions: FicheAction[] = [];
  if ((s.activateLayers?.length ?? 0) > 0 || (s.lon != null && s.lat != null)) {
    actions.push({ id: 'map', label: t(lang, 'Voir sur la carte', 'Show on map') });
  }
  if (input.hasDossier) {
    actions.push({
      id: 'dossier',
      label: s.type === 'WILDFIRE_ESCALATION' ? t(lang, 'Ouvrir le dossier d’incident', 'Open incident file') : t(lang, 'Voir l’aéronef', 'Show aircraft'),
    });
  }
  actions.push({ id: 'copy-ref', label: t(lang, 'Copier la référence', 'Copy reference') });

  const kindWord = input.kind === 'alert' ? t(lang, 'Alerte', 'Alert') : t(lang, 'Situation', 'Situation');
  return {
    key: `${input.kind}:${s.id}`,
    kind: `${kindWord} · ${themeLabel(situationTheme(s.type, s.category), lang)}`,
    name: s.title,
    level,
    driver: '',
    freshness: '',
    context,
    lead,
    essentiel: [], changesMeta: '', changes: [], figures: [], watch: [], sourcesTitle: '', sources: [], why: '', whyOpen: false,
    sections,
    reference: `${s.id} · ${s.title} · ${levelLabel(level, lang)} · ${t(lang, 'mise à jour', 'updated')} ${absoluteTime(updated, now, lang, { withDate: true })}`,
    actions,
  };
}
```

Imports à ajouter : `parseScoreLine` (situation-text), `intensityLevel`, `meterRow` (kit), `renderSourceChips` (parts), `situationTheme` (themes) ; retirer `capitalize` s'il devient inutile.

Dans `PosteSituation.ts`, les deux appels de `buildSituationFiche` passent `sectionOpen: new Map(), lang, now` (sans `whyOpen`).

Dans `PosteSituation.test.ts`, supprimer le test « le volet « Pourquoi ce niveau ? » d’une fiche situation ouvert le reste après vingt mises à jour » (plus de volet ; la persistance par type est testée en tâche 7).

Run → PASS.

- [ ] **Step 3: Vérifications et commit**

Run: `npm run typecheck && npx vitest run && npm run build`

```bash
git add src/components/fiche/items.ts src/components/fiche/items.test.ts src/components/poste/PosteSituation.ts src/components/poste/PosteSituation.test.ts
git commit -m "feat(v2): fiche situation hiérarchisée : indicateurs à leur intensité, à faire, provenance

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016CCTVuVKLioWAncSRysDPG"
```

---

### Task 5: Fiches thème, alerte officielle et marché

**Files:**
- Modify: `src/components/fiche/items.ts` (`ThemeFicheInput`, `buildThemeFiche`, `buildOfficialFiche`, `buildMarketFiche`)
- Test: `src/components/fiche/items.test.ts`
- Modify: `src/components/poste/PosteSituation.ts` (appels : `sectionOpen: new Map()`, `now`, plus de `whyOpen`)

**Interfaces:**
- Consumes: tâches 1, 2 (`kvRow`, `renderChangeRows(…, now)`, `renderSourceChips`) ; `energySection` (`./france-indicators.ts`).
- Produces: `ThemeFicheInput` sans `whyOpen`, avec `sectionOpen` et `now` ; `buildOfficialFiche(group, { freshness, sectionOpen, lang })` ; `buildMarketFiche(line, { sectionOpen, lang })`.

- [ ] **Step 1: Tests (échouent)**

Remplacer les tests de ces trois fiches par des tests qui vérifient :
- **thème** (fixture existante du fichier) : `kind` « Thème » ; `context` = [élément le plus grave ou signal officiel ou « rien à traiter », fraîcheur] ; `lead` = phrases de l'essentiel jointes par une espace ; sections dans l'ordre `indicators` (ouverte ; `kvRow` des chiffres du thème ; listes « Signaux officiels » et « Éléments à traiter » avec pastilles ; pour le thème énergie, le HTML de `energySection(snapshot.energy, lang).html` ; la phrase « Le niveau du thème est le plus élevé… » en `fmk-note`), `evolution` (ouverte si des changements existent ; résumé « n changements » ; heures absolues), `sources` (repliée, ton référence) ; aucune trace de `fiche-why` ni de `frintel-card` ; avant les couches critiques, `lead` « Chargement des données… » ;
- **alerte officielle** : `kind` « Alerte officielle · <émetteur> » ; `context` = [émetteur, fraîcheur] ; `lead` = essentiel ; `indicators` (ouverte) contient « Lieux concernés » et « Niveau publié par <émetteur>, repris tel quel. » (et la mention violet pour Météo-France) ; `places` (« Détail par lieu », ouverte, résumé n) ; `sources` repliée ;
- **marché** : `kind` « Marché » ; `context` = [« mouvement exceptionnel »] ; `lead` = essentiel ; `indicators` (ouverte) : « Cours », « Variation » et la phrase de seuil ; aucune section `sources`.
Pour chacune : `JSON.stringify(model)` ne contient pas « — » ; `sectionOpen` remplace l'ouverture par défaut.

Code de départ (adapter les fixtures `queue`, `group`, `line` à celles déjà présentes dans le fichier) :

```ts
describe('fiches thème, alerte officielle et marché (spec 2026-10-01 fiches § 4.3 à 4.5)', () => {
  const NOW = Date.parse('2026-10-01T08:30:00Z');
  const ids = (m: FicheModel): Array<string | undefined> => m.sections.map((s) => s.id);

  it('thème énergie : contexte, synthèse, indicateurs avec énergie, évolution, sources repliées', () => {
    const m = buildThemeFiche({ ...themeInput('energy'), sectionOpen: new Map(), now: NOW });
    expect(m.kind).toBe('Thème');
    expect(m.context?.length).toBeGreaterThan(0);
    expect(m.lead).toBeTruthy();
    expect(ids(m)[0]).toBe('indicators');
    const ind = m.sections[0];
    expect(ind).toMatchObject({ collapsible: true, open: true });
    expect(ind.html).toContain('Le niveau du thème est le plus élevé');
    expect(ind.html).not.toContain('frintel-card');
    const sources = m.sections.find((s) => s.id === 'sources');
    if (sources) expect(sources).toMatchObject({ open: false, tone: 'reference' });
    expect(JSON.stringify(m)).not.toContain('—');
  });

  it('thème avant les couches critiques : « Chargement des données… »', () => {
    expect(buildThemeFiche({ ...themeInput('security'), ready: false, sectionOpen: new Map(), now: NOW }).lead).toContain('Chargement des données…');
  });

  it('alerte officielle : émetteur, lieux, niveau repris tel quel, détail par lieu, sources repliées', () => {
    const m = buildOfficialFiche(officialGroup(), { freshness: '30 sources sur 39 à jour', sectionOpen: new Map(), lang: 'fr' });
    expect(m.kind).toMatch(/^Alerte officielle · /);
    expect(ids(m)).toEqual(['indicators', 'places', 'sources']);
    expect(m.sections[0].html).toContain('Lieux concernés');
    expect(m.sections[0].html).toContain('repris tel quel');
    expect(m.sections[2]).toMatchObject({ open: false, tone: 'reference' });
    expect(buildOfficialFiche(officialGroup(), { freshness: '', sectionOpen: new Map([['places', false]]), lang: 'fr' }).sections[1].open).toBe(false);
  });

  it('marché : cours, variation, seuil ; aucune section sources', () => {
    const m = buildMarketFiche(marketLine(), { sectionOpen: new Map(), lang: 'fr' });
    expect(m.context).toEqual(['mouvement exceptionnel']);
    expect(ids(m)).toEqual(['indicators']);
    expect(m.sections[0].html).toContain('Cours');
    expect(m.sections[0].html).toContain('Variation');
    expect(m.sections[0].html).toContain('Seuil d’alerte');
  });
});
```

`themeInput(theme)`, `officialGroup()` et `marketLine()` sont des fabriques à écrire à partir des fixtures existantes du fichier (thème : `queue`, `snapshot`, `events: null`, `changeTimes: new Map()`, `freshness`, `ready: true`, `lang: 'fr'`).

Run → FAIL.

- [ ] **Step 2: Implémenter**

- `ThemeFicheInput` : remplacer `whyOpen: boolean;` par `sectionOpen: ReadonlyMap<string, boolean>;` et ajouter `now: number;`.
- `buildThemeFiche` : garder le calcul de `items`, `official`, `raised`, `reds`, `n`, `essentiel`, `changes`, `labels`, `signalRows`, `itemRows` ; construire :
  ```ts
  const open = (id: string, byDefault: boolean): boolean => input.sectionOpen.get(id) ?? byDefault;
  const figures = themeFigures(theme, input.snapshot, lang).map((f) => kvRow(f.label, escapeHtml(f.value))).join('');
  const indicators = (figures ? `<div class="fmk-kvs">${figures}</div>` : '')
    + (signalRows ? `<div class="fmk-sub">${t(lang, 'Signaux officiels', 'Official signals')}</div><ul class="fiche-list">${signalRows}</ul>` : '')
    + (itemRows ? `<div class="fmk-sub">${t(lang, 'Éléments à traiter', 'Items to handle')}</div><ul class="fiche-list">${itemRows}</ul>` : '')
    + (theme === 'energy' ? energySection(input.snapshot.energy, lang).html : '')
    + `<p class="fmk-note">${t(lang, 'Le niveau du thème est le plus élevé de ses signaux officiels et de ses éléments à traiter.', 'The theme level is the highest of its official signals and items to handle.')}</p>`;
  const sorted = changes.sort(byTimeDesc);
  const sections: FicheSection[] = [{ id: 'indicators', title: t(lang, 'Indicateurs', 'Indicators'), collapsible: true, open: open('indicators', true), html: indicators }];
  if (sorted.length > 0) {
    sections.push({ id: 'evolution', title: t(lang, 'Évolution', 'Evolution'), collapsible: true, open: open('evolution', true),
      summary: escapeHtml(t(lang, `${sorted.length} changement${plural(sorted.length)}`, `${sorted.length} change${plural(sorted.length)}`)),
      html: renderChangeRows(sorted, lang, input.now) });
  }
  const sources = [...labels].slice(0, 8).map((label) => ({ label, href: null, select: null }));
  if (sources.length > 0) {
    sections.push({ id: 'sources', title: t(lang, 'Sources', 'Sources'), collapsible: true, open: open('sources', false), tone: 'reference',
      summary: escapeHtml(t(lang, `${sources.length} source${plural(sources.length)}`, `${sources.length} source${plural(sources.length)}`)), html: renderSourceChips(sources) });
  }
  ```
  et retourner `{ key, kind: t(lang, 'Thème', 'Theme'), name, level, driver: '', freshness: '', context: [driverText, input.freshness].filter(Boolean), lead: essentiel.slice(0, 3).join(' '), essentiel: [], changesMeta: '', changes: [], figures: [], watch: [], sourcesTitle: '', sources: [], why: '', whyOpen: false, sections, actions }` où `driverText` est l'ancien calcul de `driver`. Retirer l'import de `renderEnergyBlock` s'il n'est plus utilisé ; importer `energySection`.
- `buildOfficialFiche(group, input: { freshness: string; sectionOpen: ReadonlyMap<string, boolean>; lang: Lang })` : `kind` `${t(lang, 'Alerte officielle', 'Official alert')} · ${source}` ; `context` [source, freshness] ; `lead` = l'ancienne phrase de l'essentiel ; sections `indicators` (ouverte : `kvRow('Lieux concernés', String(n))` puis `<p class="fmk-note">` avec la phrase « Niveau publié par … » et la mention violet), `places` (titre « Détail par lieu », ouverte, résumé `String(n)`, liste existante), `sources` (repliée, référence, `renderSourceChips([{ label: source, href: null, select: null }])`) ; action `show-layer` inchangée.
- `buildMarketFiche(line, input: { sectionOpen: ReadonlyMap<string, boolean>; lang: Lang })` : `context` [« mouvement exceptionnel »] ; `lead` = l'ancienne phrase ; section `indicators` (ouverte : `kvRow('Cours', …)`, `kvRow('Variation', …)`, `<p class="fmk-note">` avec la phrase de seuil) ; aucune action.
- Les champs génériques sont mis à vide comme en tâches 3 et 4 (`essentiel: [], …, why: '', whyOpen: false`).
- `PosteSituation.ts` : `themeFiche` passe `sectionOpen: new Map(), now: data.now` (sans `whyOpen`) ; `buildOfficialFiche(…, { freshness, sectionOpen: new Map(), lang })` ; `buildMarketFiche(…, { sectionOpen: new Map(), lang })`.

Run → PASS.

- [ ] **Step 3: Vérifications et commit**

```bash
git add src/components/fiche/items.ts src/components/fiche/items.test.ts src/components/poste/PosteSituation.ts src/components/poste/PosteSituation.test.ts
git commit -m "feat(v2): fiches thème, alerte officielle et marché dans le kit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016CCTVuVKLioWAncSRysDPG"
```

---

### Task 6: Retrait des parties génériques du gabarit

**Files:**
- Modify: `src/components/fiche/parts.ts`, `src/components/fiche/france.ts`, `src/components/fiche/items.ts`
- Test: `src/components/fiche/parts.test.ts`, `src/components/poste/FichePanel.test.ts`, autres tests qui construisent un `FicheModel`

**Interfaces:**
- Produces: `FicheModel` sans `essentiel`, `changesMeta`, `changes`, `figures`, `watch`, `sourcesTitle`, `sources`, `why`, `whyOpen`, `whyFirst` ; `renderFiche` = en-tête + sections + actions ; `FicheFigure` et `FicheWatch` supprimés s'ils ne servent plus ; `themeFigures` peut garder un type local.

- [ ] **Step 1: Retirer**

1. Dans `FicheModel`, supprimer les dix champs ci-dessus ; supprimer `renderChanges`, `renderSources` et les parties « essentiel », « chiffres », « à surveiller », « volet » de `renderFiche`, qui devient :
   ```ts
   export function renderFiche(model: FicheModel, lang: Lang): string {
     const head = model.score !== undefined ? renderScoreHead(model, model.score, lang) : renderKitHead(model, lang);
     const sections = model.sections.map((s) => renderSection(model, s)).join('');
     const actions = model.actions.length > 0
       ? `<div class="fiche-actions">${model.actions
         .map((a) => `<button type="button" class="fiche-action" data-action="${escapeHtml(a.id)}">${escapeHtml(a.label)}</button>`).join('')}</div>`
       : '';
     return `<article class="fiche fmk" data-fiche="${escapeHtml(model.key)}">${head}${sections}${actions}</article>`;
   }
   ```
   `renderSection` : une section sans `id` reste rendue par `part('fiche-extra', …)` (aucun constructeur n'en produit plus, mais la branche reste sûre).
2. Dans `france.ts` et `items.ts`, supprimer les lignes de champs génériques vides (`essentiel: [], …, why: '', whyOpen: false`, `sourcesTitle`, `sources: []`, `whyFirst`).
3. Mettre à jour le commentaire d'en-tête de `parts.ts` (modèle : en-tête « Instrument » ou kit, sections, actions ; plus de parties génériques ni de volet « Pourquoi ce niveau ? »).
4. Tests : la fabrique `model()` de `parts.test.ts` et de `FichePanel.test.ts` perd les champs retirés ; supprimer les tests qui portaient sur les parties retirées (ordre des parties génériques, omission des parties vides, volet `fiche-why` au rendu) en gardant ceux qui restent valables (échappement, liens http(s) seulement, sections, en-têtes) ; le test d'échappement des sources passe par une section dont le `html` vient de `renderSourceChips`.

- [ ] **Step 2: Vérifications et commit**

Run: `npm run typecheck && npx vitest run && npm run build` (le typecheck désigne tous les lecteurs restants des champs retirés ; les corriger).

```bash
git add -A src/components/fiche src/components/poste
git commit -m "refactor(v2): gabarit de fiche réduit à l’en-tête, aux sections et aux actions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016CCTVuVKLioWAncSRysDPG"
```

---

### Task 7: Mémoire des sections par type, « Copier la référence », retrait du volet

**Files:**
- Modify: `src/services/fiche-sections-store.ts` ; Test: `src/services/fiche-sections-store.test.ts`
- Modify: `src/components/poste/FichePanel.ts` ; Test: `src/components/poste/FichePanel.test.ts`
- Modify: `src/components/poste/PosteSituation.ts` ; Test: `src/components/poste/PosteSituation.test.ts`

**Interfaces:**
- Consumes: tâches 3 à 6 (`sectionOpen` des constructeurs, `FicheModel.reference`, action `copy-ref`).
- Produces: `sectionMemoryKey(sectionKey: string): string` (« event:42:articles » → « event:articles », « france:note » → « france:note », « official:meteo:orange:places » → « official:places ») ; `FichePanel.announce(text: string): void` (zone `p.fiche-toast[role=status][aria-live=polite]` dans le cadre de la fiche, vidée après 2,5 s) ; `PosteOptions.clipboard?: { writeText(text: string): Promise<void> } | null` (défaut : `navigator.clipboard` s'il existe).

- [ ] **Step 1: Tests (échouent)**

- `fiche-sections-store.test.ts` :
  ```ts
  it('clé de mémoire par type de fiche', () => {
    expect(sectionMemoryKey('event:42:articles')).toBe('event:articles');
    expect(sectionMemoryKey('france:note')).toBe('france:note');
    expect(sectionMemoryKey('official:meteo:orange:places')).toBe('official:places');
    expect(sectionMemoryKey('situation:cyber-pressure:todo')).toBe('situation:todo');
  });
  ```
- `FichePanel.test.ts` :
  ```ts
  it('annonce brève hors du corps de fiche, effacée après 2,5 s', () => {
    vi.useFakeTimers();
    const { root, panel } = mount();
    panel.render(model(), 'fr', false);
    panel.announce('Référence copiée');
    expect(root.querySelector('.fiche-toast')?.textContent).toBe('Référence copiée');
    panel.render(model({ name: 'Autre' }), 'fr', false);
    expect(root.querySelector('.fiche-toast')?.textContent).toBe('Référence copiée');
    vi.advanceTimersByTime(2500);
    expect(root.querySelector('.fiche-toast')?.textContent).toBe('');
    vi.useRealTimers();
  });
  ```
- `PosteSituation.test.ts` (harnais existant, stockage mémoire de la tâche 6 de l'étape État) :
  1. ouvrir `details[data-section="event:<id>:articles"]` sur un premier événement (en simulant l'ouverture comme les tests existants), sélectionner un autre événement : sa section `articles` est ouverte ; `storage.saved()` vaut `{ 'event:articles': true }` ;
  2. la même section reste ouverte après vingt `poste.update(data({ now: NOW + i * 60_000 }))` ;
  3. `copy-ref` : avec `clipboard: { writeText: vi.fn(async () => {}) }`, cliquer `[data-action="copy-ref"]` sur une fiche événement appelle `writeText` avec `model.reference` et affiche « Référence copiée » ; avec `writeText` qui rejette, ou `clipboard: null`, aucune exception et « Copie impossible » s'affiche.
  4. plus aucune référence à `fiche-why` dans les tests.

Run → FAIL.

- [ ] **Step 2: Implémenter**

1. `fiche-sections-store.ts` :
   ```ts
   /** « <type>:<…>:<section> » → « <type>:<section> » : une section ouverte l'est pour toutes les fiches du même type. */
   export function sectionMemoryKey(sectionKey: string): string {
     const first = sectionKey.indexOf(':');
     const last = sectionKey.lastIndexOf(':');
     if (first < 0) return sectionKey;
     return `${sectionKey.slice(0, first)}:${sectionKey.slice(last + 1)}`;
   }
   ```
2. `FichePanel.ts` : dans le constructeur, créer `const toast = document.createElement('p'); toast.className = 'fiche-toast'; toast.setAttribute('role', 'status'); toast.setAttribute('aria-live', 'polite');` ajouté au cadre (`chrome`) ; méthode
   ```ts
   announce(text: string): void {
     this.toast.textContent = text;
     if (this.toastTimer !== null) clearTimeout(this.toastTimer);
     this.toastTimer = setTimeout(() => { this.toast.textContent = ''; this.toastTimer = null; }, 2500);
   }
   ```
   (champs `private readonly toast: HTMLElement; private toastTimer: ReturnType<typeof setTimeout> | null = null;`). Supprimer `onWhyToggle`, `setOnWhyToggle`, la branche `details.fiche-why` de l'écouteur `toggle` et celle de `focusTarget`.
3. `PosteSituation.ts` :
   - supprimer `whyOpen` (champ, `setOnWhyToggle`, toutes les lectures) ;
   - dans `setOnSectionToggle`, enregistrer sous `sectionMemoryKey(sectionKey)` ;
   - passer `sectionOpen: sectionsOf(this.sectionOpen, '<type>')` aux constructeurs : `'event'`, `'situation'` (aussi pour les alertes : type `'alert'` ; utiliser le préfixe de la clé de fiche), `'theme'`, `'official'`, `'market'` (la France garde `'france'`) ;
   - garder le dernier modèle rendu (`private lastModel: FicheModel | null`) ; dans `runAction`, en tête :
     ```ts
     if (action === 'copy-ref') {
       const reference = this.lastModel?.reference;
       if (!reference) return;
       const lang = data.lang;
       const done = (ok: boolean): void => this.fichePanel.announce(ok ? (lang === 'fr' ? 'Référence copiée' : 'Reference copied') : (lang === 'fr' ? 'Copie impossible' : 'Copy failed'));
       try {
         const clip = this.clipboard;
         if (!clip) { done(false); return; }
         void clip.writeText(reference).then(() => done(true), () => done(false));
       } catch {
         done(false);
       }
       return;
     }
     ```
     avec `this.clipboard = options.clipboard !== undefined ? options.clipboard : defaultClipboard();` et
     ```ts
     function defaultClipboard(): { writeText(text: string): Promise<void> } | null {
       try {
         return typeof navigator !== 'undefined' && navigator.clipboard ? navigator.clipboard : null;
       } catch {
         return null;
       }
     }
     ```
4. Retirer du CSS (`main.css`) les règles `.fiche-why*` devenues mortes seulement si aucun autre composant ne les utilise (`grep -rn "fiche-why" src`).

Run: `npx vitest run src/components/poste/ src/services/fiche-sections-store.test.ts` → PASS.

- [ ] **Step 3: Vérifications et commit**

```bash
git add src/services/fiche-sections-store.ts src/services/fiche-sections-store.test.ts src/components/poste src/styles/main.css
git commit -m "feat(v2): sections mémorisées par type de fiche, copie de la référence

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016CCTVuVKLioWAncSRysDPG"
```

---

### Task 8: Style des fiches kit et contrôle visuel

**Files:**
- Modify: `src/styles/main.css` (bloc du kit `fmk`)
- Modify: `docs/design/panneau-v2.md` (en-tête kit sans score, courbe, ton référence, « À faire », règle « aucun tiret cadratin »)

- [ ] **Step 1: CSS**

Ajouter dans le bloc du kit, sous `#app.ui-v2` :

```css
/* Fiches kit sans score (spec 2026-10-01 fiches) : seul l'en-tête est en grand */
#app.ui-v2 .fmk .fmk-title { margin: 4px 0 10px; font-size: 19px; font-weight: 700; line-height: 1.28; color: var(--text-primary); }
#app.ui-v2 .fmk .fmk-level { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 10px; font-size: 12.5px; color: var(--fmk-muted); }
#app.ui-v2 .fmk .fmk-sep { color: var(--border-color-light); }
#app.ui-v2 .fmk .fmk-lead { margin: 12px 0 0; font-size: 14.5px; line-height: 1.5; color: var(--text-primary); }
#app.ui-v2 .fmk .fmk-sec--ref > .fmk-sec-h .fmk-eyebrow,
#app.ui-v2 .fmk .fmk-sec--ref > .fmk-sec-h .fmk-sum { color: #6e6e80; }
#app.ui-v2 .fmk .fmk-kvs .fmk-kv { grid-template-columns: 7rem minmax(0, 1fr); }
#app.ui-v2 .fmk .fmk-kvs .fmk-kv-v { overflow-wrap: anywhere; }
#app.ui-v2 .fmk .fmk-curve { display: block; width: 100%; height: auto; margin: 4px 0 6px; }
#app.ui-v2 .fmk .fmk-curve-grid { stroke: var(--bg-surface-hover); stroke-width: 1; }
#app.ui-v2 .fmk .fmk-curve-grid--top { stroke-dasharray: 2 4; }
#app.ui-v2 .fmk .fmk-curve-area { fill: rgba(200, 200, 212, 0.1); }
#app.ui-v2 .fmk .fmk-curve-line { fill: none; stroke: #c8c8d4; stroke-width: 2; }
#app.ui-v2 .fmk .fmk-curve-axis { fill: var(--fmk-faint); font-size: 10px; }
#app.ui-v2 .fmk .fmk-meters--score .fmk-meter { grid-template-columns: 9.5rem minmax(0, 1fr) 4rem; }
#app.ui-v2 .fmk .fmk-rows { margin: 0; padding: 0; list-style: none; }
#app.ui-v2 .fmk .fmk-row { padding: 6px 0; border-bottom: 1px solid var(--fmk-rule); }
#app.ui-v2 .fmk .fmk-row:last-child { border-bottom: 0; }
#app.ui-v2 .fmk .fmk-row a { color: var(--text-primary); text-decoration: none; }
#app.ui-v2 .fmk .fmk-row a:hover { color: var(--v2-brand); }
#app.ui-v2 .fmk .fmk-row a:focus-visible { outline: 2px solid var(--v2-brand); outline-offset: 2px; }
#app.ui-v2 .fmk .fmk-row small, #app.ui-v2 .fmk .fmk-todo small { display: block; font-size: 11.5px; color: var(--fmk-faint); }
#app.ui-v2 .fmk .fmk-todo { margin: 0; padding-left: 18px; }
#app.ui-v2 .fmk .fmk-todo li { margin: 0 0 8px; }
#app.ui-v2 .fmk .fiche-change { color: var(--fmk-muted); }
#app.ui-v2 .fmk .fiche-change.is-latest { color: var(--text-primary); }
#app.ui-v2 .fmk .fiche-change.is-latest .fiche-time { color: var(--text-primary); font-weight: 600; }
#app.ui-v2 .fmk .fmk-tag { color: #c8c8d4; }
#app.ui-v2 .fiche-toast { position: absolute; top: 8px; left: 14px; margin: 0; font-size: 12px; color: var(--v2-brand); }
#app.ui-v2 .fiche-toast:empty { display: none; }
```

(Vérifier que `.fiche-chrome` est en `position: relative` ; sinon l'y mettre, sous `#app.ui-v2`.)

- [ ] **Step 2: Contrôle visuel**

Serveur de dev en arrière-plan (`npm run dev`, http://localhost:3001), script jetable `.superpowers/sdd/fiches-kit/shots.mjs` (Playwright `<PLAYWRIGHT_MODULE>`, Chrome sans interface, attente 25 s), à 1600 × 1000, 1280 × 900 et 390 × 844 (onglet « Fiche » au téléphone) : ouvrir un événement, une situation, un thème (second clic sur un thème), et une alerte officielle si la liste en contient ; capturer `.fm-v2-fiche` ; vérifier `scrollWidth <= clientWidth` de `.fiche-body`, l'absence de « — » dans `document.body.innerText`, les titres de sections tous de même taille (mesurer `getComputedStyle` de `.fmk-sec-h .fmk-eyebrow` : même `font-size` partout), « Copier la référence » qui affiche « Référence copiée » (autoriser le presse-papiers dans le contexte Playwright : `permissions: ['clipboard-read', 'clipboard-write']`). Regarder les captures (outil Read) et corriger le CSS jusqu'à un rendu propre. Arrêter le serveur.

- [ ] **Step 3: Référence écrite**

Compléter `docs/design/panneau-v2.md` (dépôt public : aucun chemin personnel) : en-tête kit des fiches sans score (sur-titre, titre 19 px, ligne de niveau, synthèse), section « Indicateurs » ouverte sous l'en-tête, ton « référence », courbe en escalier neutre, barres à leur intensité, heures absolues, règle « aucun tiret cadratin » (séparateur « · » ou « : », valeur absente « n.d. »).

- [ ] **Step 4: Vérifications et commit**

```bash
git add src/styles/main.css docs/design/panneau-v2.md
git commit -m "feat(v2): style des fiches kit et référence complétée

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016CCTVuVKLioWAncSRysDPG"
```

---

### Task 9: Aucun tiret cadratin dans les textes externes

**Files:**
- Create: `src/services/typography.ts` ; Test: `src/services/typography.test.ts`
- Modify: `src/services/news-events.ts` (`parseNewsEvent`, `fetchEventDetail`), `src/services/rss.ts` (normalisation `/api/news` et `parseRSSItems`), `src/services/france-intel-brief.ts` (`parseStructuredBrief`)
- Modify: `api/_handlers/intelligence/v1/france-intel-brief.js` (consigne de l'invite)
- Tests : ajouts dans les tests existants de ces services

**Interfaces:**
- Produces: `noEmDash(text: string): string`.

- [ ] **Step 1: Tests (échouent)**

`src/services/typography.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { noEmDash } from './typography.ts';

const DASH = '—';

describe('aucun tiret cadratin (spec 2026-10-01 fiches § 7)', () => {
  it('incise entre espaces → deux-points', () => {
    expect(noEmDash(`Grève ${DASH} la SNCF annonce un trafic perturbé`)).toBe('Grève : la SNCF annonce un trafic perturbé');
  });
  it('en tête de texte : retiré', () => {
    expect(noEmDash(`${DASH} Mise à jour`)).toBe('Mise à jour');
  });
  it('collé entre deux mots : trait d’union', () => {
    expect(noEmDash(`2025${DASH}2026`)).toBe('2025-2026');
  });
  it('texte sans tiret inchangé', () => {
    expect(noEmDash('Rien à signaler')).toBe('Rien à signaler');
  });
});
```

(Le test écrit le caractère par son code `—` : le garde-fou de la tâche 11 lit la valeur des littéraux, il faudra donc l'exclure : voir tâche 11, les fichiers de test sont hors périmètre du garde-fou.)

Ajouter dans les tests de `news-events`, `rss` et `france-intel-brief` un cas avec un titre (ou un `bluf`, un jugement, un point « à surveiller ») contenant « — » : la valeur analysée n'en contient plus.

Run → FAIL.

- [ ] **Step 2: Implémenter**

`src/services/typography.ts` :

```ts
// src/services/typography.ts — règle typographique de l'application (spec 2026-10-01 fiches § 7) :
// aucun tiret cadratin affiché. Appliquée aux textes externes à leur arrivée (presse, événements,
// brief IA) ; les textes du code n'en contiennent pas (garde-fou tests/no-em-dash.test.ts).

/** Incise « X — Y » → « X : Y » ; en tête, retiré ; collé entre deux mots, trait d'union. */
export function noEmDash(text: string): string {
  return text
    .replace(/^\s*—\s*/, '')
    .replace(/\s+—\s+/g, ' : ')
    .replace(/\s*—\s*/g, '-');
}
```

Appliquer `noEmDash` :
- `news-events.ts` : au `title` dans `parseNewsEvent`, au `title` de chaque article dans `fetchEventDetail`, et aux `sourceNames` ;
- `rss.ts` : au `title` et à la `description` des articles de `/api/news` (là où l'élément est normalisé) et de `parseRSSItems` ;
- `france-intel-brief.ts` : dans `parseStructuredBrief`, au `bluf`, au `text` de chaque jugement et au `text` de chaque point « à surveiller » ;
- `api/_handlers/intelligence/v1/france-intel-brief.js` : ajouter à l'invite système la consigne « N'utilise jamais de tiret long (cadratin) : préfère les deux-points ou une virgule. » (formulée sans le caractère).

Run → PASS.

- [ ] **Step 3: Vérifications et commit**

```bash
git add src/services/typography.ts src/services/typography.test.ts src/services/news-events.ts src/services/rss.ts src/services/france-intel-brief.ts api/_handlers/intelligence/v1/france-intel-brief.js src/services/*.test.ts tests/*.test.ts
git commit -m "fix: aucun tiret cadratin dans les textes de presse, d’événements et du brief

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016CCTVuVKLioWAncSRysDPG"
```

---

### Task 10: Aucun tiret cadratin dans les textes de l'interface (composants)

**Files:**
- Modify: littéraux de `src/components/**`, `src/App.ts`, `src/locales/**`, `src/plugins/**`, `src/utils/**` (hors tests)
- Tests : attendus des tests de ces fichiers

- [ ] **Step 1: Inventaire**

Écrire le scanner jetable `.superpowers/sdd/fiches-kit/scan-dash.mjs` (non commité) qui parcourt `src/` et `api/` (hors `node_modules`, `__snapshots__`, `*.test.ts`, `*.d.ts`) avec le compilateur TypeScript (`import ts from '<racine>/node_modules/typescript/lib/typescript.js'`) et liste chaque littéral (`StringLiteral`, `NoSubstitutionTemplateLiteral`, `TemplateHead`, `TemplateMiddle`, `TemplateTail`) dont `node.text` contient « — », avec fichier et ligne (`sourceFile.getLineAndCharacterOfPosition(node.getStart())`). Le lancer : au 01/10, 293 littéraux dans 72 fichiers ; les fichiers de cette tâche en portent environ 135 (dont `src/components/DeckGLMap.ts` 20, `src/App.ts` 14, `MaritimePanel.ts` 10, `WildfireDossierModal.ts` 10, `OutagesPanel.ts` 9, `LayerPanel.ts` 8, `MapPopup.ts` 8).

- [ ] **Step 2: Remplacer, fichier par fichier**

Règles, à appliquer selon le sens de chaque littéral :
- valeur absente (« — » seul, ou `?? '—'`) → « n.d. » ;
- séparateur entre éléments d'une ligne (« A — B ») → « A · B » ;
- incise ou explication (« Titre — précision ») → « Titre : précision » ;
- plage (« 10 — 20 ») → « 10 à 20 » ;
- message de journal (`console.*`) → « : ».
Mettre à jour les tests dont les attendus contenaient « — » (y compris `formatDelta` de `france-intel-score.ts` : `'—'` → `'n.d.'`, et les tests de l'en-tête « Instrument » qui attendaient « 24 h : — »). Relancer le scanner : plus aucun littéral dans les fichiers de cette tâche.

- [ ] **Step 3: Vérifications et commit**

```bash
git add -A src/components src/App.ts src/locales src/plugins src/utils
git commit -m "fix: aucun tiret cadratin dans les textes de l’interface

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016CCTVuVKLioWAncSRysDPG"
```

---

### Task 11: Aucun tiret cadratin dans les données, services et API ; garde-fou

**Files:**
- Modify: littéraux de `src/config/**`, `src/services/**`, `api/**` (hors tests) ; régénérer `api/_lib` (`npm run generate:server-libs`) si une source de `src/` générée est touchée
- Create: `tests/no-em-dash.test.ts`

- [ ] **Step 1: Remplacer**

Même scanner et mêmes règles qu'en tâche 10, pour les fichiers restants (environ 158 littéraux : `src/config/military-bases-db.ts` 62, `src/config/military.ts` 12, `src/services/oil.ts` 10, `api/_handlers/intelligence/v1/france-intel-brief.js` 7, `src/services/situation-report.ts` 6, etc.). Dans les données (`military-bases-db.ts`, `military.ts`), « Nom — précision » → « Nom : précision » ou « Nom · précision » selon le cas. Puis `npm run generate:server-libs` et `node scripts/check-generated.mjs`.

- [ ] **Step 2: Garde-fou**

`tests/no-em-dash.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DASH = '—';

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== 'node_modules' && name !== '__snapshots__') sourceFiles(full, out);
    } else if (/\.(ts|js|mjs)$/.test(name) && !/\.test\.|\.d\.ts$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

function dashedLiterals(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const kind = file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node))
      && node.text.includes(DASH)) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart());
      found.push(`${path.relative(ROOT, file)}:${line + 1}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe('aucun tiret cadratin affiché (spec 2026-10-01 fiches § 7)', () => {
  it('aucun littéral de chaîne de src/ ni d’api/ n’en contient', () => {
    const offenders = [...sourceFiles(path.join(ROOT, 'src')), ...sourceFiles(path.join(ROOT, 'api'))].flatMap(dashedLiterals);
    expect(offenders).toEqual([]);
  });
});
```

Run: `npx vitest run tests/no-em-dash.test.ts` → PASS (s'il échoue, la liste désigne les littéraux restants : les corriger, ne jamais exclure de fichier).

- [ ] **Step 3: Vérifications et commit**

```bash
git add -A src/config src/services api tests/no-em-dash.test.ts
git commit -m "fix: aucun tiret cadratin dans les données, les services et l’API ; garde-fou

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016CCTVuVKLioWAncSRysDPG"
```
