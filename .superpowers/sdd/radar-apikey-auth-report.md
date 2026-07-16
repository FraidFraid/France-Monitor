# DPRadar API-key authentication fix

Date: 2026-07-16

## Scope

The Météo-France DPRadar worker keeps reading `METEO_FRANCE_RADAR_API_KEY`, but now sends that value through the provider's `apikey` HTTP header. The provider requests no longer send an `Authorization` header. The separate `RADAR_WORKER_TOKEN` Bearer authentication protecting `POST /refresh` is unchanged.

No `.env` or `.env.local` file was read or displayed during this work.

## Root cause

`RadarApiClient` built a shared header dictionary containing `Authorization: Bearer <key>` and reused it for both catalogue discovery and BUFR product downloads. Live evidence supplied with the task showed that DPRadar rejects that shape with HTTP 401 and accepts the same key through `apikey` with HTTP 200.

## TDD evidence

1. Added `test_dpradar_requests_use_apikey_without_authorization`, covering both JSON discovery and binary download requests.
2. RED: the focused test failed because the captured headers were `Authorization: Bearer dpradar-key` rather than `apikey: dpradar-key`.
3. GREEN: after the one-line client change, the focused test passed (`1 passed`).

## Files changed

- `services/radar-worker/radar_api.py`: replace DPRadar Bearer authentication with the `apikey` header.
- `services/radar-worker/tests/test_worker.py`: require `apikey` and explicitly prohibit `Authorization` for both outbound request paths.
- `.env.example`: clarify the provider header without renaming the environment variable.
- `docs/superpowers/specs/2026-07-16-fire-live-mtg-radar-design.md`: align the design contract and state that DPRadar does not use OAuth/Bearer.

## Verification

- `npm run radar:test`: 24 passed, 1 upstream deprecation warning.
- `services/radar-worker/venv/bin/python -m compileall -q services/radar-worker`: exit 0.
- `npm run typecheck`: exit 0.

The warning is Starlette's existing `httpx`/`TestClient` deprecation notice and is unrelated to this authentication change.
