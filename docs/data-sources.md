# Data Sources

France Monitor uses public APIs, official open data, RSS feeds, and technical OSINT sources. Data is treated as monitoring signals, not final verified reporting.

## Source Principles

- Prefer official or primary public sources.
- Keep source attribution visible in services and UI.
- Cache and retry rather than over-polling public infrastructure.
- Degrade gracefully when keys or upstream services are unavailable.
- Avoid personal-data enrichment.

## Main Source Families

| Domain | Examples | Notes |
|--------|----------|-------|
| News | French national and regional RSS feeds | Classified and geocoded as weak signals |
| Energy | RTE Ecowatt, Eco2mix, REMIT/IIP, GRTgaz/Teréga | Requires credentials for full production use |
| Weather | Météo-France vigilance | Official alert source |
| Floods | Vigicrues, Hub'Eau, OSM geometry | Matched or reconstructed segments |
| Transport | SNCF, OpenSky, AIS relay, TomTom/Bison Futé | Optional keys for richer coverage |
| Health | SPF/ISS, SOS Médecins, OSCOUR, FINESS | Public health stress indicators |
| Cyber | Ransomware/breach feeds, Shodan/Censys, Cloudflare Radar/IODA | Technical exposure and incident signals |
| Finance | Market and commodity proxies | Contextual economic indicators |

## Radar & Observation

| Source | Product | Coverage | Update Cadence | Notes |
|--------|---------|----------|----------------|-------|
| **Radar 2D (IMFR27)** | Composite reflectivity mosaic | Métropole | 5 min | Worker (Railway) decodes BUFR, posts `/api/fire-observations/radar-2d`; mirrors IMFR27 reflectivity Z for fire detection context |
| **Radar Column (PAM DPRadar)** | Vertical profile (tours A–H) | 27 metropolitan radar stations (closest-pick, 160 km range) | 5 min | Demonstration use: vertical profile at FIRMS fire locations; raw ZH uncorrected for fixed echoes; dBZ scale (gain 1.0, offset −10.5) locked by embedded LUT; endpoint `/api/fire-observations/radar-column`; Licence Ouverte 2.0; **no automated volumetric analysis** |

## Reproducibility

Each production source should document:

- upstream URL or API
- authentication requirement
- update cadence
- cache TTL
- fallback behavior
- output fields consumed by the UI

This file is the public index. Source-specific notes can be added as dedicated docs as the project matures.
