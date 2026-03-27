---
name: Right Sidebar + Élus OSINT
description: Architecture d'une colonne droite dockée + refonte du bloc élus avec données OSINT maximales
type: spec
date: 2026-03-24
---

# Spec — Right Sidebar + Élus OSINT

## Contexte

Le layout actuel est : sidebar gauche (380px) + carte (flex:1). Les panels OSINT (Élus, Maritime, Ministres) sont des flottants `position:fixed` non intégrés au layout. Cette spec introduit une colonne droite dockée et refond le bloc élus avec un niveau de données OSINT maximal.

---

## 1. Architecture — Right Sidebar

### Layout

Le `main-container` passe de 2 colonnes à 3 :

```
[left-sidebar 380px] [map flex:1] [right-sidebar 360px]
```

- Nouvelle CSS variable `--right-sidebar-width: 360px`
- `.right-sidebar` : miroir de `.sidebar` (même structure, `border-left` au lieu de `border-right`)
- La carte se comprime entre les deux colonnes — conserver `min-width: 400px` sur le map container pour éviter l'écrasement sur petits écrans
- Sur mobile (< 768px) : right-sidebar s'affiche en drawer bottom-sheet (toggle bouton fixe en bas à droite)

### Fichiers touchés

| Fichier | Modification |
|---------|-------------|
| `src/styles/main.css` | Ajouter `.right-sidebar`, `--right-sidebar-width`, media queries |
| `src/App.ts` | Créer l'élément `right-sidebar`, y monter les panels OSINT |
| `src/components/ElusPanel.ts` | Migrer de `position:fixed` flottant → montage dans `right-sidebar` |
| `src/components/RightSidebar.ts` | Nouveau composant orchestrateur (tabs ou stack de panels) |

### Comportement

- La right sidebar est **toujours visible** sur desktop mais **vide par défaut** (placeholder "Cliquez sur la carte ou activez un layer")
- Trois sections empilables : Élus · Ministres · Maritime (chacune collapsible)
- Un seul scroll vertical pour toute la colonne
- `z-index` identique à la sidebar gauche

---

## 2. Élus — Améliorations

### 2.1 Président de Département

Ajouter dans `elus.ts` une static map `PRESIDENTS_DEPARTEMENT` (99 entrées — métropole + DROM/COM) :

```
codeDept → { nom, prenom, parti, mandatDepuis }
```

Sources : Wikipedia (résultats élections départementales 2021, réactualisés). Ajouter dans `ElusInfo` :

```typescript
presidentDepartement: EluData | null;
```

Affichage : nouvelle section "DÉPARTEMENT" dans `ElusPanel` (couleur accent `#f59e0b`, entre Sénat et Région).

### 2.2 Performance Maire

Problème : `tabular-api.data.gouv.fr` peut dépasser 8s. Fix :

- Réduire timeout `fetchMaire` de 8s → **4s**
- Affichage **par section** (skeleton loading par bloc, pas un spinner global) : commune s'affiche en premier (rapide), puis maire, puis parlementaires en parallèle
- Ajouter un fichier statique `src/config/maires-grandes-villes.ts` (~50 grandes communes) comme cache instantané avant la requête réseau — couvre 80% des clics urbains sans latence

### 2.3 DROM

Bug : les codes région DROM dans `geo.api.gouv.fr` sont `01`–`06` (chaînes à 2 chiffres). La map `PRESIDENTS_REGION` les a déjà corrects. Vérifier que `normalizeDept` ne supprime pas le zéro initial pour les codes Outre-Mer (01 Guadeloupe, 02 Martinique, 03 Guyane, 04 Réunion, 06 Mayotte). Fix : ne `replace(/^0+/, '')` que pour les codes purement numériques > 2 chiffres.

### 2.4 Photo Maire

RNE ne fournit pas de photo. Fallback : avatar généré avec **initiales + couleur déterministe** (hash du nom → teinte HSL). SVG inline, pas de dépendance externe.

---

## 3. Élus — OSINT Modal (détail elu)

Clic sur une carte elu → modal plein-panel dans la right sidebar (overlay sur la liste).

### Données affichées

| Section | Source | Données |
|---------|--------|---------|
| Identité | nosdeputes/nossenateurs | Grande photo, nom, prénom, né(e) le, sexe, profession |
| Mandat | nosdeputes/nossenateurs | Groupe, parti, circonscription, mandat depuis, commission(s) |
| Votes récents | `nosdeputes.fr/depute/{slug}/votes` | 5 derniers votes avec résultat (pour/contre/absent) |
| Amendements | `nosdeputes.fr/depute/{slug}/amendements` | Nb amendements déposés / adoptés |
| Déclarations d'intérêts | HATVP `declarations.hatvp.fr` | Lien direct vers la fiche HATVP (nom normalisé) |
| Contact | nosdeputes/nossenateurs | Email officiel, site web |
| Réseaux sociaux | nosdeputes (champ `adresses`) | Twitter/X, Facebook si disponibles |
| Liens externes | — | Boutons : nosdeputes.fr · Wikipedia · HATVP · Regards Citoyens |

### Structure UI

```
[← Retour]  [Nom Prénom]
──────────────────────────
[Photo 80px] [Identité rapide]
──────────────────────────
[Tabs: Mandat | Votes | Intérêts | Contact]
──────────────────────────
[Contenu tab actif]
──────────────────────────
[Liens externes  ↗ ↗ ↗ ↗]
```

### Implementation notes

- Les votes/amendements sont chargés **à la demande** (clic sur tab "Votes") — pas au premier affichage
- HATVP : URL `https://declarations.hatvp.fr/fiche/{prenom}-{nom}` (slug normalisé minuscules, accents supprimés, tirets)
- Données HATVP non parsées — lien direct uniquement (évite de casser si leur structure change)
- Cache des détails par slug : TTL 1h

---

## 4. ElusInfo — Interface mise à jour

```typescript
export interface ElusInfo {
  commune: CommuneInfo;
  maire: EluData | null;
  deputes: EluData[];
  senateurs: EluData[];
  presidentRegion: EluData | null;
  presidentDepartement: EluData | null;  // NOUVEAU
  fetchedAt: Date;
}

export interface EluData {
  prenom: string;
  nom: string;
  sexe?: 'M' | 'F';
  dateNaissance?: string;
  parti?: string;
  groupeParlementaire?: string;
  mandatDepuis?: string;
  profession?: string;
  email?: string;
  siteWeb?: string;
  photoUrl?: string;
  circonscription?: string;
  slug?: string;            // NOUVEAU — pour votes/amendements
  hatvpUrl?: string;        // NOUVEAU — URL déclaration
  socialMedia?: {           // NOUVEAU
    twitter?: string;
    facebook?: string;
  };
}
```

---

## 5. Gestion des erreurs

- Chaque section du panel a son propre état d'erreur (`"Données indisponibles"`) — une API en timeout n'empêche pas les autres de s'afficher
- Retry automatique sur les votes/amendements (1 retry après 3s)
- Pas de données pour une commune en mer / hors France → message explicite "Zone hors couverture"

---

## 6. Fichiers créés/modifiés (résumé)

| Fichier | Action |
|---------|--------|
| `src/styles/main.css` | + `.right-sidebar`, `--right-sidebar-width`, media queries mobile |
| `src/components/RightSidebar.ts` | CRÉÉ — orchestrateur de la colonne droite |
| `src/components/ElusPanel.ts` | Migré dans right-sidebar + section presidentDepartement + tabs OSINT |
| `src/services/elus.ts` | + `PRESIDENTS_DEPARTEMENT`, `presidentDepartement` dans `ElusInfo`, fix DROM, timeout 4s |
| `src/config/maires-grandes-villes.ts` | CRÉÉ — cache statique ~50 grandes communes |
| `src/App.ts` | Mount `RightSidebar`, rerouter `ElusPanel` dedans |
