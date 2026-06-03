# Roadmap

This roadmap is aligned with the goal of turning France Monitor from a France-focused prototype into a reusable European open-source geospatial monitoring commons.

## M1 — Open-source Release and Documentation

Deliverables:

- public GitHub repository
- MIT license
- CI quality gates
- contribution guide and issue/PR templates
- public architecture, deployment, data-source, privacy, and roadmap docs
- clear project page on `francemonitor.com`

Status: in progress.

## M2 — Stable Data Model and API Contracts

Deliverables:

- documented event and source schemas
- stable `/api/*` response contracts
- source attribution metadata
- cache and freshness metadata
- typed examples for news, weather, energy, transport, and cyber signals

## M3 — Reproducible Ingestion Pipelines

Deliverables:

- source-by-source ingestion documentation
- test fixtures for critical sources
- failure and fallback behavior documentation
- scheduled refresh guidance
- reproducible France reference dataset where legally possible

## M4 — European Reusability

Deliverables:

- country connector pattern
- one non-France example connector
- multi-country administrative geography abstraction
- self-hosting guide for the API proxy layer
- deployment checklist for civic-tech/research reuse

## Longer-term Work

- Playwright end-to-end tests for critical UI flows
- stronger API contract tests
- optional PostGIS-backed storage model
- public source registry
- exportable situation snapshots
- accessibility and mobile map parity improvements
