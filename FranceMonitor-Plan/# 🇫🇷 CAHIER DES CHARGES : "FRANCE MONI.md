# 🇫🇷 CAHIER DES CHARGES : "FRANCE MONITOR"

**Tableau de bord de renseignement et de conscience situationnelle en temps réel pour la France.**

---

## 🎯 1. Vision Globale
Créer un clone français et ultra-localisé du projet open-source *WorldMonitor*. L'objectif est d'avoir une carte 3D interactive regroupant en temps réel : l'actualité locale, les tensions sociales, les faits divers, et l'état des infrastructures critiques. L'outil utilise l'Open Data français et un moteur d'Intelligence Artificielle local (LLM) pour extraire, catégoriser et géolocaliser les flux d'informations textuels.

---

## 📊 2. Angles et Cas d'Usage (Les "Calques" de données)
* **Climat Social & Politique :** Manifestations, grèves, blocages routiers, rassemblements (détectés via l'analyse IA des flux RSS de la presse et des réseaux).
* **Sécurité & Faits Divers :** Violences urbaines, interventions majeures, alertes sécurité. L'IA lit la Presse Quotidienne Régionale (PQR), extrait la ville/rue et géocode l'événement sur la carte.
* **Infrastructures & Énergie :** Tension du réseau électrique (Ecowatt), état du parc nucléaire (Eco2mix), niveaux d'eau (Hub'Eau), alertes météo et crues.
* **Mobilité :** Trafic routier majeur (Bison Futé) et réseau ferroviaire (SNCF).

---

## 📡 3. Sources de Données (Gratuites / Open Data)
* **API Gouvernementales & Publiques :** `api.gouv.fr`, `data.gouv.fr`.
* **Énergie :** API RTE (portail data.rte-france.com) pour Ecowatt et éco2mix.
* **Météo & Environnement :** API Météo-France (données publiques gratuites), API Hub'Eau (nappes phréatiques), Vigicrues.
* **Transports :** API SNCF Open Data, Bison Futé.
* **Actualités :** Flux RSS de la PQR (Le Monde, Ouest-France, La Voix du Nord, France Bleu, etc.).
* **Géocodage :** API Adresse du gouvernement (`api-adresse.data.gouv.fr`) pour convertir les textes en coordonnées GPS.

---

## 🛠️ 4. Stack Technique
* **Frontend :** React + Vite + TypeScript.
* **Cartographie 3D :** MapLibre GL JS (moteur de carte) + Deck.gl (gestion des calques de données volumineuses à 60fps). Tuiles de fond via OpenStreetMap ou IGN.
* **Backend :** Node.js (Express) ou Python (FastAPI).
* **Moteur IA :** Ollama en local (avec un modèle type `mistral:instruct` ou `llama3`) pour un parsing gratuit et respectueux de la vie privée.
* **Base de données :** SQLite ou Redis (pour le cache des données récentes).

---

## 📁 5. Architecture du Monorepo

```text
france-monitor/
├── backend/                  
│   ├── src/
│   │   ├── api/              # Routes API (ex: /api/alerts, /api/energy, /api/weather)
│   │   ├── services/         # Connecteurs externes (RSS, API Météo, RTE)
│   │   ├── ai/               # Scripts d'interaction avec Ollama/LLM local
│   │   ├── utils/            # Fonctions de géocodage, formatage des dates
│   │   └── cron/             # Tâches planifiées (ex: refresh RSS toutes les 15min)
│   ├── .env                  # Clés API (RTE, SNCF, etc.)
│   └── package.json / requirements.txt
│
├── frontend/                 
│   ├── src/
│   │   ├── components/       # UI de l'application (Sidebar, Header, Tooltips)
│   │   ├── layers/           # Calques Deck.gl (NewsLayer, EnergyLayer, AlertLayer)
│   │   ├── hooks/            # Logique React (useMapData, useRealTimeUpdates)
│   │   ├── types/            # Interfaces TypeScript strictes (Crucial pour la data)
│   │   └── App.tsx           # Point d'entrée principal
│   ├── .env                  
│   └── package.json
│
└── README.md


🤖 6. Prompts Système (Les "Skills" pour l'IA lors du code)
Instructions à fournir à l'assistant selon la partie du code travaillée :

Skill 1 - Rôle Backend / Data : "Tu es un ingénieur backend senior. Ta tâche est de créer des scripts d'ingestion robustes pour des flux RSS et des API gouvernementales françaises. Gère le rate limiting, les erreurs (try/catch), et formate toutes les données entrantes vers une interface TypeScript stricte et commune."

Skill 2 - Rôle IA / Parsing : "Tu es un expert en Prompt Engineering et LLMs locaux (Ollama). Ta mission est de traiter des textes bruts d'actualité. Crée des prompts très stricts pour qu'un LLM extraie uniquement un JSON valide contenant : 1. Catégorie, 2. Ville/Adresse exacte, 3. Niveau de gravité (1-10), 4. Résumé (20 mots max). Optimise le code pour gérer les hallucinations."

Skill 3 - Rôle Frontend / 3D : "Tu es un développeur frontend expert en React, TypeScript et cartographie WebGL (Deck.gl, MapLibre). Nous construisons une carte de France interactive en mode sombre. Code des calques performants capables d'afficher des milliers de points. Le code doit être modulaire avec des hooks personnalisés."

🚀 7. Plan d'Action (Ordre de développement)
Phase 1 : Le Socle Visuel (Frontend d'abord)
Initialiser le monorepo (Frontend Vite/React + Backend basique).

Intégrer MapLibre et Deck.gl avec un fond de carte sombre centré sur la France métropolitaine.

Créer des données "mockées" (faux JSON) pour valider l'affichage de points d'intérêts sur la carte.

Phase 2 : L'Usine à Données (Backend)
Coder les scripts de scraping/lecture des flux RSS de la PQR.

Brancher 2 API publiques simples (ex: API Vigicrues et API Ecowatt).

Exposer ces données brutes sur une route /api/feed.

Phase 3 : Le Cerveau IA & Géocodage
Connecter le backend à l'instance locale d'Ollama.

Faire passer les titres/descriptions RSS dans l'IA pour extraction d'entités (Lieu, Gravité).

Envoyer le lieu extrait à l'API Adresse (Gouv) pour récupérer les coordonnées GPS exactes.

Mettre en cache le résultat.

Phase 4 : L'Assemblage en Temps Réel
Relier le frontend au véritable backend.

Séparer les données en différents calques visuels Deck.gl (Icônes pour les actus, Heatmap pour les tensions, Lignes pour le trafic).

Phase 5 : Interface Avancée (Finition)
Créer le panneau latéral (Sidebar) pour lire le flux texte.

Ajouter des filtres (par temps : "Dernière heure", par catégorie : "Météo", "Social").

Optimiser les performances (mise en veille si onglet inactif).