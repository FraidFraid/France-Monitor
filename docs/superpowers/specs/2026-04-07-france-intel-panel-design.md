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

### Fichiers modifiés
| Fichier | Modification |
|---------|-------------|
| `src/App.ts` | Instanciation panel, binding clic carte + bouton navbar, dispatch event |
| `src/types/index.ts` | Ajout interface `FranceIntelData` |
| `index.html` | Ajout bouton 🇫🇷 dans la navbar |
| `src/plugins/intelligence-proxy.ts` | Ajout route proxy dev `/api/intelligence/v1/france-intel-brief` |

---

## 4. Interface de données

```typescript
interface FranceIntelData {
  stability: ISNRData;          // score national + composantes (social/security/infra/velocity)
  cyber: CyberState;            // globalScore + alerts + ransomware + CVE
  meteo: MeteoAlert[];          // vigilances actives par département
  topNews: NewsItem[];          // 6 items triés par sévérité décroissante
  brief?: string;               // généré à la volée, null pendant chargement
  briefLang: 'fr' | 'en';
  briefFreshness?: 'fresh' | 'cached';
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
│  Social    ████░░░░  48             │  4 barres ISNR
│  Sécurité  ██████░░  80             │  (social / security / infra / cyber)
│  Infra     ███░░░░░  35             │
│  Cyber     ████░░░░  51             │
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
- **Sécurité** : POST only, JSON parse wrappé try/catch, validation des champs avant prompt injection

---

## 9. Score d'instabilité composite (CII France)

Calculé côté client depuis les données déjà disponibles :

```
CII = (isnr.social × 0.25) + (isnr.security × 0.30) + (isnr.infra × 0.20) + (cyber.globalScore × 0.25)
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
- `npm run build && npm run typecheck` doit passer avant merge
