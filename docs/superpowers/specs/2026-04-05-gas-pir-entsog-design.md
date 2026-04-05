# Design : Flux PIR gaz via ENTSOG

**Date :** 2026-04-05  
**Statut :** Approuvé  
**Contexte :** Remplacement du fetch ODRE cassé (`evolution-de-lactivite-aux-points-dechange-de-gaz-peg-sur-le-reseau-natran` — dataset inexistant) par l'API ENTSOG Transparency Platform pour les flux journaliers aux 5 Points d'Interconnexion de Réseau (PIR) frontière France.

---

## Problème

`fetchPirFlows()` dans `src/services/gas.ts` interroge un dataset ODRE qui n'existe pas → retourne toujours 0 résultats → repli systématique sur `buildFallbackInterconnections()` (flows à 0, status `stale`). Les interconnexions gaz ne sont jamais live.

## Solution retenue : Option A — Proxy ENTSOG simple

L'API ENTSOG (`transparency.entsog.eu/api/v1`) est publique, sans authentification, et contient les Physical Flow journaliers pour tous les PIR FR. Les données sont publiées avec un délai J+1 à J+2. On interroge une fenêtre de J-3 à J0 et on prend la valeur la plus récente non-nulle par point.

---

## Fichiers

### Nouveaux

| Fichier | Rôle |
|---------|------|
| `api/energy/gas-pir.js` | Vercel Serverless Function — proxy ENTSOG, cache in-process 30 min |
| `src/plugins/gas-pir-proxy.ts` | Vite plugin dev — miroir exact de la Vercel function |

### Modifiés

| Fichier | Changement |
|---------|-----------|
| `src/types/index.ts` | `GasInterconnection` : ajout `entsogKey?: string` |
| `src/config/gas-infrastructure.ts` | Les 5 `GasInterconnection` reçoivent leur `entsogKey` |
| `src/services/gas.ts` | `fetchPirFlows()` : remplace l'URL ODRE par `/api/energy/gas-pir` |

---

## Mapping PIR → ENTSOG

| name (config) | entsogKey | Label ENTSOG |
|---------------|-----------|--------------|
| Biriatou | `ITP-00033` | Biriatou (FR) / Irun (ES) |
| Larrau | `ITP-00018` | Larrau |
| Obergailbach | `ITP-00137` | Obergailbach (FR) / Medelsheim (DE) |
| Taisnières | `ITP-00115` | Blaregnies L (BE) / Taisnières B (FR) |
| Oltingue | `ITP-00039` | Oltingue (FR) / Rodersdorf (CH) |

Note : Taisnières a deux points ENTSOG (`ITP-00115` et `ITP-00152`). On prend `ITP-00115` (Taisnières B, le plus actif). `ITP-00152` ignoré pour l'instant.

---

## Logique du proxy (`api/energy/gas-pir.js`)

```
GET /api/energy/gas-pir

1. Si cache in-process < 30 min → retourner cache
2. Construire la fenêtre : from = J-3, to = J0 (ISO date, format YYYY-MM-DD)
3. Appel ENTSOG :
   GET https://transparency.entsog.eu/api/v1/operationaldata
     ?indicator=Physical+Flow
     &periodType=day
     &points=ITP-00033,ITP-00018,ITP-00137,ITP-00115,ITP-00039
     &from={J-3}
     &to={J0}
     &limit=50
     timeout: 15s

4. Pour chaque pointKey :
   - Filtrer les items du pointKey
   - Trier par periodFrom DESC
   - Prendre le premier avec value !== null && value !== ''
   - value est en kWh/d → diviser par 1 000 000 → GWh/d
   - Convention signe :
     * directionKey === 'entry' → flowGWhDay positif (import vers FR)
     * directionKey === 'exit'  → flowGWhDay négatif (export depuis FR)
   - Si entry ET exit disponibles → additionner (flux net)

5. Retourner :
   {
     points: [{ pointKey, pointLabel, flowGWhDay, periodFrom, directionKey }],
     fetchedAt: ISO string,
     status: 'ok' | 'partial' | 'error'
   }
   status 'partial' si < 5 points ont une valeur non-nulle

6. En cas d'erreur ENTSOG → { points: [], status: 'error', error: message }
```

---

## Modification `fetchPirFlows()` dans `gas.ts`

```typescript
// Avant : appel ODRE (URL inexistante)
const url = `${ODRE_BASE}/evolution-de-lactivite-aux-points-dechange-de-gaz-peg-sur-le-reseau-natran/records?...`

// Après : appel proxy ENTSOG
const resp = await fetch('/api/energy/gas-pir', { signal: AbortSignal.timeout(20_000) });
const json = await resp.json();

// Mapping pointKey → GasInterconnection via entsogKey
const enriched = GAS_INTERCONNECTIONS.map(ic => {
  const pirData = json.points.find(p => p.pointKey === ic.entsogKey);
  return { ...ic, flowGWhDay: pirData?.flowGWhDay ?? 0 };
});

const matched = enriched.filter(ic => ic.entsogKey && json.points.find(p => p.pointKey === ic.entsogKey)?.flowGWhDay != null).length;
const status = json.status === 'ok' && matched > 0 ? 'ok' : 'stale';
return { interconnections: enriched, status };
```

---

## Gestion d'erreur & fallback

- ENTSOG KO → proxy retourne `status: 'error'` → `fetchPirFlows` retourne `buildFallbackInterconnections()` avec `status: 'stale'` (comportement identique à aujourd'hui)
- 0 valeurs non-nulles pour J-3→J0 → même fallback
- `sourceStatus.odre` dans `GasNetworkState` n'est pas renommé (évite les changements en cascade dans `GasPanel`)

---

## Vite plugin dev (`src/plugins/gas-pir-proxy.ts`)

Miroir exact de la Vercel function, même logique, même endpoint `/api/energy/gas-pir`. Enregistré dans `vite.config.ts` comme les autres plugins énergie.

---

## Ce qui ne change pas

- `GasInterconnection.flowGWhDay` (type inchangé)
- `GasNetworkState.sourceStatus` (champs inchangés)
- `GasPanel.ts` (aucun changement UI)
- `buildFallbackInterconnections()` reste en place comme dernier recours
