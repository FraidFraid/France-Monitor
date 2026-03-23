# France Monitor — Kit de Ressources

**Dossier de planification complet pour le projet France Monitor.**
**Basé sur l'analyse approfondie du code source réel de [WorldMonitor](https://github.com/koala73/worldmonitor).**

---

## ⚠️ Points clés issus de l'analyse de WorldMonitor

L'analyse du repo source a révélé que WorldMonitor n'est **pas** une app React classique :

| Ce qu'on pourrait croire | La réalité dans WorldMonitor |
|---|---|
| React + composants JSX | **Vanilla TypeScript** — manipulation DOM directe |
| Backend Express/NestJS | **Vercel Serverless Functions** (dossier `api/`) |
| Monorepo npm workspaces | **Projet Vite unique** avec tout dedans |
| REST API classique | **Protobuf (sebuf)** — contrats typés auto-générés |
| SQLite pour le cache | **Upstash Redis** (cloud) + **IndexedDB** (client) |
| Socket.io pour le temps réel | **Polling avec setInterval** + circuit breakers |
| Un composant carte | **Deux** : Deck.gl/MapLibre (desktop) + D3/SVG (mobile) |
| IA côté serveur uniquement | **Fallback chain** : Ollama → Groq → Browser T5 (WASM) |

**Tous les documents de ce dossier ont été réécrits pour respecter ces patterns réels.**

---

## Contenu du dossier

| Fichier | Description |
|---------|-------------|
| **`CLAUDE.md`** | Configuration Claude Code — architecture Vanilla TS, skills, stratégie agents (Explore/Plan/general-purpose/Bash), workflow, conventions. **À copier à la racine du repo.** |
| **`PLAN_IMPLEMENTATION.md`** | Plan en 7 phases (0→6) calqué sur les patterns WorldMonitor, avec checklists, validations, et tableau des risques |
| **`API_SOURCES.md`** | Référentiel exhaustif : 9 API françaises avec URLs exactes, auth, rate limits, priorités |
| **`STACK_DEPENDENCIES.md`** | `package.json` complet calqué sur WorldMonitor, configs (tsconfig, vite, vercel, prettier), `.env.example` |
| **`AI_SKILLS_PROMPTS.md`** | 5 skills adaptés à l'architecture Vanilla TS + patterns de délégation par agents parallèles |
| **`ARCHITECTURE.md`** | Architecture système avec diagrammes ASCII, types TypeScript complets, circuit breaker, fallback chain IA, presets régionaux |

---

## Comment utiliser ces ressources

### Étape 1 — Prérequis (avant de coder)

**Inscriptions API (gratuites) :**
- [ ] **Vercel** : https://vercel.com → compte + CLI (`npm i -g vercel`)
- [ ] **Upstash Redis** : https://upstash.com → créer une DB Redis → obtenir URL + token
- [ ] **RTE (Ecowatt)** : https://data.rte-france.com → créer app → client_id + client_secret
- [ ] **Météo-France** : https://portail-api.meteofrance.fr → obtenir API key
- [ ] **SNCF** (Phase 2+) : https://data.sncf.com → obtenir API key

**Outils locaux :**
- [ ] Node.js 20 LTS (`nvm install 20`)
- [ ] Ollama (`curl -fsSL https://ollama.com/install.sh | sh`)
- [ ] Modèle Mistral (`ollama pull mistral:instruct`)
- [ ] ~8GB RAM libre (pour Ollama)
- [ ] Git

**Optionnel :**
- [ ] Groq API key (https://console.groq.com) — fallback IA cloud
- [ ] buf CLI (`npm i -g @bufbuild/buf`) — génération Protobuf

### Étape 2 — Initialiser le projet

```bash
# Créer le repo
npm create vite@latest france-monitor -- --template vanilla-ts
cd france-monitor
git init

# Copier le CLAUDE.md
cp /chemin/vers/FranceMonitor-Plan/CLAUDE.md .

# Installer les dépendances (voir STACK_DEPENDENCIES.md)
npm install

# Configurer l'environnement
cp .env.example .env
# → Remplir les clés API

# Premier lancement
npm run dev
```

### Étape 3 — Développement avec Claude Code

1. Ouvrir Claude Code dans le repo (`claude` dans le terminal)
2. Le `CLAUDE.md` est lu automatiquement → Claude connaît l'architecture
3. Mentionner le **skill approprié** selon la partie du code :
   - "Skill 1 — travaille sur les composants UI"
   - "Skill 2 — travaille sur la carte Deck.gl"
   - "Skill 3 — travaille sur les serverless functions"
   - "Skill 4 — travaille sur la classification IA"
   - "Skill 5 — travaille sur les services de données"
4. Suivre les phases du `PLAN_IMPLEMENTATION.md` dans l'ordre
5. Utiliser la **stratégie agents** décrite dans CLAUDE.md pour paralléliser

### Étape 4 — Déploiement

```bash
# Build de production
npm run build

# Déployer sur Vercel
vercel

# Les serverless functions (api/) sont déployées automatiquement
# Redis Upstash est accessible via les env vars Vercel
```

---

## Ordre de lecture recommandé

1. **`ARCHITECTURE.md`** — comprendre comment WorldMonitor fonctionne vraiment
2. **`PLAN_IMPLEMENTATION.md`** — comprendre les phases de développement
3. **`STACK_DEPENDENCIES.md`** — préparer l'environnement et les dépendances
4. **`API_SOURCES.md`** — s'inscrire aux API et comprendre les limites
5. **`AI_SKILLS_PROMPTS.md`** — comprendre les skills et la délégation par agents
6. **`CLAUDE.md`** — copier dans le projet et commencer à coder

---

## Résumé de l'architecture cible

```
          RSS PQR + API Gouv (Ecowatt, Météo, Vigicrues, SNCF)
                              │
                   Vercel Serverless + Redis
                              │
               Vanilla TypeScript + Vite (SPA)
                              │
                 ┌─────────────┴──────────────┐
                 │                             │
          Deck.gl + MapLibre            D3 + SVG
            (Desktop 3D)              (Mobile fallback)
                 │                             │
                 └─────────────┬──────────────┘
                               │
                     Carte de France 🇫🇷
                   mode sombre, temps réel
```
