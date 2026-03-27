---
name: Ministres par Portefeuille
description: Feature ministre par portefeuille — mapping catégorie événement → ministre, section dans right sidebar, modal OSINT complet
type: spec
date: 2026-03-24
---

# Spec — Ministres par Portefeuille

## Contexte

Lorsqu'un utilisateur consulte un événement (grève transport, alerte énergie, crue...) ou clique sur une zone géographique, il doit pouvoir identifier instantanément quel ministre est compétent. Cette feature s'intègre dans la right sidebar sous forme d'une section "Gouvernement" dédiée, avec modal OSINT complet au clic.

---

## 1. Source de données

### Données statiques (source principale)

Fichier `src/config/government.ts` — liste du gouvernement actuel (Premier Ministre + ministres). Mis à jour manuellement après chaque remaniement.

Structure par ministre :

```typescript
interface Minister {
  id: string;                    // slug unique ex: "ministre-energie"
  prenom: string;
  nom: string;
  titre: string;                 // "Ministre délégué chargé de l'Énergie"
  titreShort: string;            // "Énergie"
  photoUrl: string;              // URL photo officielle (france.gouv.fr ou Wikidata)
  wikidataId?: string;           // Q-code Wikidata pour enrichissement async
  parti?: string;
  dateNomination?: string;       // ISO date
  email?: string;                // Contact cabinet (public)
  siteWeb?: string;              // Ministère
  twitter?: string;
  categories: EventCategory[];   // Catégories d'événements liées
  portefeuilles: string[];       // Mots-clés domaines ex: ["énergie", "nucléaire", "réseau électrique"]
}

type EventCategory = 'energy' | 'transport' | 'weather' | 'social' | 'security' |
                     'health' | 'finance' | 'floods' | 'fires' | 'cyber';
```

### Premier Ministre (entrée spéciale)

Toujours affiché en tête de la section Gouvernement, indépendamment du contexte.

### Enrichissement async (Wikidata)

Pour chaque ministre, fetch async `https://www.wikidata.org/wiki/Special:EntityData/{wikidataId}.json` → extraire : date de naissance, biographie courte (P569, description FR), image officielle (P18). Mis en cache TTL 24h (IndexedDB).

---

## 2. Mapping catégorie → ministre(s)

Table de routage dans `src/config/government.ts` :

| Catégorie événement | Ministre(s) affiché(s) |
|--------------------|----------------------|
| `energy` | Ministre de l'Énergie |
| `transport` | Ministre des Transports |
| `social` (grève) | Ministre du Travail |
| `health` | Ministre de la Santé |
| `security` | Ministre de l'Intérieur |
| `floods` | Ministre de la Transition écologique |
| `fires` | Ministre de l'Intérieur + Transition écologique |
| `cyber` | Ministre délégué Numérique |
| `finance` | Ministre de l'Économie |
| `weather` | PM + Transition écologique |

Logique : `getMinistersForContext(categories: EventCategory[]): Minister[]` — déduplique si plusieurs catégories pointent vers le même ministre.

---

## 3. UX — Section "Gouvernement" dans la right sidebar

### Déclenchement

Deux modes d'affichage :

1. **Mode contextuel** (par défaut) : quand un article RSS est sélectionné ou qu'un layer est actif, afficher les ministres compétents pour les catégories détectées
2. **Mode liste** : bouton "Voir tout le gouvernement" → liste complète scrollable

### Affichage section (mode contextuel)

```
GOUVERNEMENT — MINISTRES CONCERNÉS
────────────────────────────────
[Photo] Prénom NOM          [›]
         Titre court
         Depuis: JJ/MM/AAAA

[Photo] Prénom NOM          [›]
         Titre court
         ...
────────────────────────────────
[Voir tout le gouvernement ↓]
```

- Chips de contexte en haut : "Énergie" "Transport" (les catégories qui ont déclenché l'affichage)
- Maximum 3 ministres affichés directement, rest collapsé

---

## 4. Modal OSINT — Détail ministre

Clic sur une carte ministre → modal overlay dans la right sidebar.

### Données affichées

| Section | Source | Données |
|---------|--------|---------|
| Identité | `government.ts` + Wikidata | Grande photo, nom, titre complet, parti, date nomination |
| Biographie | Wikidata (description FR) | 2-3 phrases |
| Portefeuille | `government.ts` | Liste des domaines de compétence |
| Agenda récent | `france.gouv.fr` RSS du ministère | 3 derniers communiqués/agenda |
| Déclaration intérêts | HATVP | Lien direct vers fiche |
| Contact | `government.ts` | Site ministère, cabinet |
| Réseaux | `government.ts` | Twitter/X si disponible |
| Liens | — | france.gouv.fr · Wikidata · HATVP · Wikipedia |

### Structure UI

```
[← Retour]  [Titre court du portefeuille]
──────────────────────────────────────
[Photo 80px ronde]  [Nom complet]
                    [Titre officiel]
                    [Parti · Depuis JJ/MM/AAAA]
──────────────────────────────────────
[Tabs: Portefeuille | Agenda | Contact]
──────────────────────────────────────
[Contenu tab actif]
──────────────────────────────────────
[france.gouv ↗]  [HATVP ↗]  [Wikipedia ↗]
```

### RSS agenda ministère

Chaque ministère a un flux RSS officiel. Mapping `minister.id → rss_url` dans `government.ts`. Fetch via `/api/rss-proxy` existant. Cache 30 min.

---

## 5. Intégration avec événements RSS

Dans `NewsPanel.ts`, lors du clic sur un article, émettre un événement `onArticleSelected(article)` → `App.ts` notifie la right sidebar → section Gouvernement se met à jour avec les ministres pertinents selon `article.category`.

Ce couplage est **unidirectionnel** (news → sidebar) et **optionnel** (la sidebar fonctionne sans news sélectionnée).

---

## 6. Fichiers créés/modifiés (résumé)

| Fichier | Action |
|---------|--------|
| `src/config/government.ts` | CRÉÉ — liste ministres, mapping catégories, portefeuilles |
| `src/services/ministers.ts` | CRÉÉ — `getMinistersForContext()`, enrichissement Wikidata async, cache |
| `src/components/MinistresPanel.ts` | CRÉÉ — section right sidebar + modal détail |
| `src/plugins/ministers-proxy.ts` | CRÉÉ — proxy Vite pour RSS ministères (via `/api/rss-proxy` existant) |
| `src/components/RightSidebar.ts` | Monter `MinistresPanel` |
| `src/App.ts` | Écouter `onArticleSelected`, notifier `MinistresPanel.setContext(categories)` |
| `src/types/index.ts` | + interface `Minister` |
