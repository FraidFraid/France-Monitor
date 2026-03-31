# Spec — Cloud / IXP Layer Redesign

**Date**: 2026-03-31
**Scope**: `src/components/DeckGLMap.ts`, `src/App.ts`
**Status**: Approved

---

## Problème

Deux défauts visuels sur le layer Cloud / IXP (`outagesCloud`) :

1. **Superposition à Paris** : `icon-allow-overlap: true` + `icon-ignore-placement: true` sur `LYR_DC_CORE` et `LYR_IXP_CIRCLE` empilent tous les triangles/carrés au même pixel. Paris concentre ~6 datacenters (AWS, GCP, OVH, Cloudflare, Equinix, Scaleway) + 2 IXP (France-IX, Equinix Paris) à des coordonnées quasi identiques.

2. **Légende absente** : `OUTAGES_CLOUD_LEGEND` est définie et enregistrée mais la visibilité dynamique ne l'affiche pas quand `outagesCloud` est actif (probablement un bug dans la logique `groupMaster`).

---

## Design

### A — Clustering DC et IXP (résout la superposition)

Suivre le pattern existant `LYR_NET_IODA_CLUSTER` / `LYR_NET_ISP_CLUSTER`.

#### Sources

Modifier `SRC_DC` et `SRC_IXP` pour activer le clustering MapLibre :

```ts
this.map.addSource(SRC_DC, {
  type: 'geojson', data: emptyFC(),
  cluster: true, clusterRadius: 50, clusterMaxZoom: 8,
});
this.map.addSource(SRC_IXP, {
  type: 'geojson', data: emptyFC(),
  cluster: true, clusterRadius: 50, clusterMaxZoom: 8,
});
```

#### Nouveaux layers cluster (ajoutés avant `LYR_DC_CORE` / `LYR_IXP_CIRCLE`)

**`LYR_DC_CLUSTER`** (`infra-dc-cluster`) — cercle violet translucide avec badge count :
- `filter: ['has', 'point_count']`
- `circle-radius`: interpolate zoom 4→18, 10→24
- `circle-color`: `rgba(167,139,250,0.25)`, `circle-stroke`: violet-400 2px
- Badge count (`LYR_DC_CLUSTER_COUNT`) : TextLayer violet clair, taille 11

**`LYR_IXP_CLUSTER`** (`infra-ixp-cluster`) — même logique, couleur violet-300 :
- `circle-color`: `rgba(196,181,253,0.20)`
- Badge count (`LYR_IXP_CLUSTER_COUNT`) : TextLayer violet-200, taille 10

#### Layers individuels (inchangés sauf filtre)

Ajouter `filter: ['!', ['has', 'point_count']]` sur `LYR_DC_CORE`, `LYR_DC_GLOW`, `LYR_IXP_CIRCLE`.
Supprimer `icon-allow-overlap: true` et `icon-ignore-placement: true` — MapLibre gère maintenant le placement.

#### Visibilité dans `setLayerVisibility`

Ajouter :
```ts
this.setVis(LYR_DC_CLUSTER,       vis(layers.outagesCloud));
this.setVis(LYR_DC_CLUSTER_COUNT, vis(layers.outagesCloud));
this.setVis(LYR_IXP_CLUSTER,      vis(layers.outagesCloud));
this.setVis(LYR_IXP_CLUSTER_COUNT, vis(layers.outagesCloud));
```

#### Interactions cluster

Au clic sur un cluster : `map.easeTo()` vers le centroïde, zoom + 2 (pour éclater le cluster).
Pattern identique à `LYR_NET_IODA_CLUSTER` déjà implémenté.

---

### B — Fix légende (résout l'absence d'affichage)

Investiguer la logique de visibilité dynamique dans `App.ts` (autour de la ligne 1972) :

```ts
const groupsOn = new Set(
  LAYER_CONFIGS
    .filter(l => l.role === "groupMaster" && this.activeLayers[l.id])
    ...
```

La légende d'un `child` n'est visible que si son `groupMaster` parent est actif. Vérifier que :
1. `outagesCloud` est bien inclus dans le calcul de `outages` (déjà fait ligne 1959-1964)
2. La légende `OUTAGES_CLOUD_LEGEND` est correctement affichée/masquée lors du toggle du layer

Fix minimal : s'assurer que la condition de visibilité de la légende inclut explicitement `outagesCloud` comme déclencheur, indépendamment du `groupMaster` logic si nécessaire.

---

## Périmètre

| Fichier | Changement |
|---------|-----------|
| `src/components/DeckGLMap.ts` | Modifier sources SRC_DC/SRC_IXP, ajouter 4 layers cluster, filtres individuels, interactions clic cluster, setLayerVisibility |
| `src/App.ts` | Fix visibilité légende outagesCloud |

Aucun autre fichier touché. Pas de changement au service `infra-network.ts`, au type `InfraNetworkState`, ni à `OutagesPanel.ts`.

---

## Critères de succès

- À zoom < 8 sur Paris : un seul badge "4 DC" + "2 IXP" (ou fusionné selon clustering) à la place de 6 triangles empilés
- Au zoom > 8 : icônes individuelles triangles/carrés visibles séparément
- Clic sur cluster → zoom + 2 pour éclater
- Légende Cloud/IXP visible dans le panel légende quand le layer est actif
