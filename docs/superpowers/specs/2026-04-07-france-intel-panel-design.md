# France Intel Panel — Design Spec (V1)
_Date: 2026-04-07_

## 1. Objectif

Créer une fiche de synthèse nationale "France Intelligence Card" calquée sur le CountryDeepDivePanel de WorldMonitor. Le panel présente un score d'instabilité composite, les signaux actifs, un brief IA bilingue et les actualités principales.

---

## 2. Approche

**Option A — Wrapper léger sur l'existant.**
Aucun nouveau service data. Le panel agrège les états déjà en mémoire dans App.ts (ISNR, CyberState, MeteoAlert[], NewsItem[]) et les présente dans un layout WorldMonitor. Un seul nouveau fichier backend minimal pour le brief IA bilingue.

---

## 3. Fichiers à créer / modifier

### Nouveaux fichiers
| Fichier | Rôle |
|---------|------|
| `src/components/FranceIntelPanel.ts` | Panel UI floating modal draggable |
| `src/services/france-intel-brief.ts` | Appel au backend brief + cache mémoire 2h |
| `api/intelligence/v1/france-intel-brief.js` | Vercel Edge Function — brief Groq bilingue |
| `src/plugins/france-intel-proxy.ts` | Vite dev proxy pour `/api/intelligence/v1/france-intel-brief` |

### Fichiers modifiés
| Fichier | Modification |
|---------|-------------|
| `src/App.ts` | Instanciation panel, binding clic carte + bouton navbar, dispatch event |
| `src/types/index.ts` | Ajout interface `FranceIntelData` |
| `index.html` | Ajout bouton 🇫🇷 dans la navbar |
| `vite.config.ts` | Import + enregistrement de `franceIntelProxyPlugin()` dans `plugins: []` |

---

## 4. Interface de données

```typescript
interface FranceIntelData {
  stability: ISNRData;          // score national + scores[] par département
  // Note: ISNRData n'expose PAS de dimensions nationales agrégées.
  // Les composantes social/security/infra sont calculées côté client en
  // faisant la moyenne de scores[].dimensions sur tous les départements.
  // Voir section 9 pour le calcul exact.
  cyber: CyberState;            // cyber.meta.globalScore + alerts + ransomware + CVE
  meteo: MeteoAlert[];          // vigilances actives par département
  topNews: NewsItem[];          // 6 items triés par sévérité décroissante
  brief?: string;               // généré à la volée, null pendant chargement
  briefLang: 'fr' | 'en';      // défaut: 'fr'
  briefFreshness?: 'fresh' | 'cached'; // mappé depuis fromCache (boolean) de l'API
}
```

---

## 5. Layout du panel

Floating modal draggable, ~380px, scrollable. Pattern identique à `CyberPanel.ts`.

```
┌─────────────────────────────────────┐
│ 🇫🇷 France          [FR/EN] [×]     │  header + toggle langue + close
│ Country Intelligence                 │
├─────────────────────────────────────┤
│ INDICE D'INSTABILITÉ    Updated...  │
│  [42/100] → stable                  │
│  Social    ████░░░░  48             │  source: moyenne ISNRScore.dimensions.social
│  Sécurité  ██████░░  80             │  source: moyenne ISNRScore.dimensions.security
│  Infra     ███░░░░░  35             │  source: moyenne ISNRScore.dimensions.infra
│  Cyber     ████░░░░  51             │  source: cyber.meta.globalScore (pas ISNR)
├─────────────────────────────────────┤
│ SIGNAUX ACTIFS                      │
│  [⛈ Orages x3] [🔴 Crue x1] ...   │  chips MeteoAlert + news critiques
├─────────────────────────────────────┤
│ BRIEF RENSEIGNEMENT          Fresh  │
│  ░░░░░░░░░ (spinner pendant load)   │  texte Groq 3-4§, bilingue FR/EN
├─────────────────────────────────────┤
│ ACTUALITÉS PRINCIPALES              │
│  [CRITIQUE] Train TGV…  il y a 3h  │  top 6 NewsItem triés sévérité
│  [HIGH]     Grève SNCF… il y a 5h  │
└─────────────────────────────────────┘
```

---

## 6. Triggers d'ouverture

- **Clic carte France** (si aucun layer sélectionné) → `document.dispatchEvent(new CustomEvent('open-france-intel'))`
- **Bouton navbar** 🇫🇷 fixe → même event

---

## 7. Data flow (séquence d'ouverture)

1. Event `open-france-intel` déclenché
2. Panel s'ouvre **immédiatement** avec données déjà en mémoire dans App.ts
3. En parallèle : `fetchFranceIntelBrief(snapshot, lang)` appelé
   - POST → `/api/intelligence/v1/france-intel-brief`
   - Contexte : score ISNR + composantes + nb alertes météo + cyber score + 6 titres news
   - Cache mémoire 2h côté client (clé = hash contexte + lang)
4. Brief s'affiche dès réception, remplace le spinner
5. Toggle FR/EN → re-fetch avec lang opposé (cache séparé)

---

## 8. Backend — `api/intelligence/v1/france-intel-brief.js`

- **Runtime** : Vercel Edge (identique à `synthesis.js`)
- **Auth** : `GROQ_API_KEY` lu depuis `process.env` — jamais exposé client ✅
- **Cache** : Redis Upstash, TTL 15 min, clé `france-intel:brief:{lang}:v1`
- **Prompt** : WorldMonitor style — 3-4 paragraphes analytiques, 250-350 mots
- **Input** : `{ isnrScore, isnrComponents, cyberScore, meteoAlertCount, topHeadlines: string[], lang: 'fr' | 'en' }`
- **Output** : `{ brief: string, fromCache: boolean, computedAt: string }`
- **Fallback** : `{ brief: null }` si Groq indisponible ou clé manquante
- **Cache Redis** : clé globale `france-intel:brief:{lang}:v1` (non per-snapshot, identique au pattern de `synthesis.js`) — acceptable avec TTL 15 min
- **Sécurité — prompt injection** : avant `buildPrompt()`, le serveur doit :
  - Valider `topHeadlines` est un tableau de max 6 éléments
  - Tronquer chaque headline à 120 caractères max
  - Supprimer les sauts de ligne (`\n`, `\r`) dans chaque headline
  - Valider `lang` est strictement `'fr'` ou `'en'`

---

## 9. Score d'instabilité composite (CII France)

Calculé côté client depuis les données déjà disponibles.

**`ISNRData` n'expose pas de dimensions nationales agrégées.** Les dimensions
`social`, `security`, `infra` sont obtenues en faisant la moyenne des scores
par département (`ISNRData.scores[].dimensions`).

```typescript
// Calcul des composantes nationales depuis les scores départementaux
const depts = isnrData.scores; // ISNRScore[]
const avgDim = (key: keyof ISNRDimensionScores) =>
  depts.length > 0
    ? depts.reduce((sum, d) => sum + (d.dimensions?.[key] ?? 0), 0) / depts.length
    : 0;

const socialScore    = avgDim('social');
const securityScore  = avgDim('security');
const infraScore     = avgDim('infra');
// Note: ISNRDimensionScores a aussi une 4ème dimension `velocity` (densité temporelle
// des articles récents). Elle est intentionnellement exclue du CII — le cyber score
// remplit ce rôle de signal de réactivité.
const cyberScore     = cyberState.meta.globalScore; // NE PAS utiliser isnr.dimensions.cyber

const CII = Math.round(
  socialScore   * 0.25 +
  securityScore * 0.30 +
  infraScore    * 0.20 +
  cyberScore    * 0.25
);
```

Trend : comparé au snapshot précédent (stocké en mémoire).

Couleurs :
- ≥ 70 → rouge (critique)
- ≥ 55 → orange (élevé)
- ≥ 40 → jaune (modéré)
- ≥ 25 → bleu (normal)
- < 25 → vert (bas)

---

## 10. Hors scope V1

- Granularité régionale / départementale
- Timeline 7 jours
- Indicateurs économiques (CAC 40, marchés)
- Military activity détaillée (vols, navires)
- Export / Share button
- Health barometer section
- Prediction markets

---

## 11. Contraintes non négociables

- TypeScript strict, aucun `any`
- Vanilla DOM, pas de framework
- Clé Groq côté serveur uniquement
- Aucune donnée personnelle vers APIs cloud
- Pattern Panel.ts respecté (show/hide/setOnClose/mount)
- `destroy()` doit nettoyer les event listeners drag (`mousemove`/`mouseup` sur `document`)
- `npm run build && npm run typecheck` doit passer avant merge
