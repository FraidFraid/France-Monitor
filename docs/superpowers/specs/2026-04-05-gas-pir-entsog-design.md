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
| `src/types/index.ts` | `GasInterconnection` : ajout `entsogKey?: string` (optionnel pour compatibilité future) |
| `src/config/gas-infrastructure.ts` | Les 5 `GasInterconnection` reçoivent leur `entsogKey` |
| `src/services/gas.ts` | `fetchPirFlows()` : remplace l'URL ODRE par `/api/energy/gas-pir` ; `sourceStatus.odre` calculé sur `storageResult.status` seul |
| `vite.config.ts` | Import et enregistrement de `gasPirProxyPlugin()` |

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

Headers de réponse : Access-Control-Allow-Origin: *, Content-Type: application/json
Méthode OPTIONS → 200 immédiat (CORS preflight)

1. Si cache in-process < 30 min → retourner cache

2. Construire la fenêtre : from = J-3, to = J0 (ISO date YYYY-MM-DD, heure locale CET)

3. Appel ENTSOG :
   GET https://transparency.entsog.eu/api/v1/operationaldata
     ?indicator=Physical+Flow
     &periodType=day
     &points=ITP-00033,ITP-00018,ITP-00137,ITP-00115,ITP-00039
     &from={J-3}
     &to={J0}
     &limit=100
     timeout: 15s

4. Pour chaque pointKey parmi les 5 PIR :
   a. Filtrer les items de ce pointKey
   b. Grouper par directionKey ('entry' | 'exit')
   c. Pour chaque direction, trier par periodFrom DESC et prendre le premier
      avec value !== null && value !== '' → c'est la valeur la plus récente
   d. Convertir kWh/d → GWh/d (÷ 1 000 000)
   e. Calculer flowGWhDay NET :
      flowNet = entryGWh - exitGWh
      (positif = import net vers FR, négatif = export net depuis FR)
      Si seulement entry disponible : flowNet = +entryGWh
      Si seulement exit disponible  : flowNet = -exitGWh
      Si aucune valeur              : le point est absent du tableau de résultat
   f. periodFrom = max lexicographique des dates ISO disponibles entre les deux directions
      (comparaison de chaînes ISO YYYY-MM-DD est lexicographiquement correcte)

5. Retourner :
   {
     points: [{ pointKey, pointLabel, flowGWhDay, periodFrom }],
     fetchedAt: ISO string,
     status: 'ok' | 'partial' | 'error'
   }
   status 'ok'      = 5 points avec valeur non-nulle
   status 'partial' = 1–4 points avec valeur non-nulle
   status 'error'   = 0 points ou exception

6. En cas d'erreur ENTSOG → { points: [], status: 'error', error: message }
   Utiliser res.status(200).json(...) dans tous les cas (l'appelant inspecte json.status)
```

---

## Modification `fetchPirFlows()` dans `gas.ts`

```typescript
// Avant : appel ODRE (URL inexistante)
const url = `${ODRE_BASE}/evolution-de-lactivite-aux-points-dechange-de-gaz-peg-sur-le-reseau-natran/records?...`

// Après : appel proxy ENTSOG
const resp = await fetch('/api/energy/gas-pir', { signal: AbortSignal.timeout(20_000) });
if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
const json = await resp.json();

// Mapping pointKey → GasInterconnection via entsogKey
const enriched = GAS_INTERCONNECTIONS.map(ic => {
  const pirData = json.points.find((p: { pointKey: string; flowGWhDay: number }) => p.pointKey === ic.entsogKey);
  return { ...ic, flowGWhDay: pirData?.flowGWhDay ?? 0 };
});

// 'ok' ou 'partial' = données live (même partielles) ; 'error' = stale
const status = (json.status === 'ok' || json.status === 'partial') ? 'ok' : 'stale';
return { interconnections: enriched, status };
```

### Mise à jour `sourceStatus.odre`

Après ce changement, `sourceStatus.odre` ne doit plus dépendre du résultat PIR (qui passe par ENTSOG, pas ODRE). Il est recalculé sur `storageResult.status` seul :

```typescript
// Avant
odre: storageResult.status === 'ok' && pirResult.status === 'ok' ? 'ok' : 'stale'

// Après
odre: storageResult.status  // directement
```

---

## Vite plugin dev (`src/plugins/gas-pir-proxy.ts`)

Miroir exact de la Vercel function côté logique, même endpoint `/api/energy/gas-pir`.
**Le cache in-process 30 min s'applique uniquement à la Vercel function** (amortissement des cold starts). Le Vite plugin est un passthrough stateless, cohérent avec tous les plugins existants du projet (pattern `ecowatt-proxy.ts`, etc.).

**Signature** : factory sans argument (ENTSOG est public, aucun credential requis) :
```typescript
export function gasPirProxyPlugin(): Plugin { ... }
```

**Enregistrement dans `vite.config.ts`** :
```typescript
import { gasPirProxyPlugin } from './src/plugins/gas-pir-proxy';
// Dans plugins[] :
gasPirProxyPlugin(),
```

---

## Gestion d'erreur & fallback

- ENTSOG KO ou timeout → proxy retourne `{ status: 'error', points: [] }` → `fetchPirFlows` attrape l'exception → `buildFallbackInterconnections()` avec `status: 'stale'` (comportement identique à aujourd'hui)
- 0 valeurs non-nulles sur J-3→J0 → même fallback via `status: 'error'`
- `sourceStatus.odre` dans `GasNetworkState` non renommé (évite les changements en cascade dans `GasPanel`), mais sa valeur est désormais calculée sur `storageResult.status` seul

---

## Ce qui ne change pas

- `GasInterconnection.flowGWhDay` (type inchangé)
- `GasNetworkState.sourceStatus` (champs inchangés, seul le calcul de `odre` change)
- `GasPanel.ts` (aucun changement UI)
- `buildFallbackInterconnections()` reste en place comme dernier recours
