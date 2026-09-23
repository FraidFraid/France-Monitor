# Task 6 — Cache volume + endpoint `GET /volume/column`

## Périmètre livré

- `services/radar-worker/pam_volume.py` (nouveau) : `OutOfRangeError`, `_CachedVolume`, `PamVolumeStore` avec `.column(lat, lon) -> dict`.
- `services/radar-worker/app.py` : import `OutOfRangeError, PamVolumeStore` ; nouveau paramètre `volume_store_factory` sur `create_app` ; route `GET /volume/column`.
- `services/radar-worker/tests/test_volume_column.py` (nouveau) : 4 tests.

## Déviations par rapport au brief (documentées, toutes légitimes)

### 1. Injection du store — paramètre `create_app`, pas de global module

Conformément à la note du Step 1 et après lecture de `tests/test_worker.py` (qui injecte tous les collaborateurs — `api_factory`, `decoder`, `renderer`, `echo_renderer`, `archiver`, `manifest_writer` — comme paramètres de `create_app`), j'ai ajouté :

```python
volume_store_factory: Callable[[str], Any] = PamVolumeStore,
```

et, dans le corps de `create_app` :

```python
volume_store = volume_store_factory(configured.api_key)
```

Le brief proposait un attribut module-level `app_module.VOLUME_STORE` monkeypatché depuis le test — incohérent avec le pattern déjà en place. J'ai donc réécrit `test_endpoint_column_and_404` pour injecter un `FakeStore` via `volume_store_factory=lambda _api_key: FakeStore()` plutôt que de monkeypatcher un global, et utilisé la fixture `tmp_path` (comme le reste de `test_worker.py`) au lieu du chemin relatif codé en dur `Path("./data/test-volume")` du brief, pour éviter de polluer le repo avec un répertoire de test.

### 2. Catalogue réel : station la plus proche de (45.5, −5.5)

Le brief devinait `(41, 54)` (Bordeaux ou Treillières) avant que le catalogue réel (27 stations, Task 5) n'existe. Vérifié avec `station_catalog.STATIONS` et `great_circle_distance_m` : la station métropole la plus proche de (45.5, −5.5) — un point en pleine mer, à l'ouest de la Bretagne — est **Plabennec (id 56)**, à **339,1 km**. `nearest_station(45.5, -5.5)` renvoie bien `None` (hors `MAX_RANGE_M` = 160 km), ce qui déclenche la branche `OutOfRangeError` de `column()`. J'ai ajusté l'assertion :

```python
assert excinfo.value.nearest_station_id == 56
assert excinfo.value.nearest_km == pytest.approx(339.1, abs=0.5)
```

Aucune assertion structurelle affaiblie : le test vérifie toujours qu'une `OutOfRangeError` porteuse de la station la plus proche est bien levée.

### 3. Calibration dBZ verrouillée par la Task 3 (nouvelle déviation, pas seulement le catalogue)

Le brief attendait `dbz == pytest.approx(9.5)` pour un code ZH uniforme 40. Or `pam_bitstream.py` verrouille (Task 3, commentaire "calibration verrouillée... ne modifier qu'avec une nouvelle calibration croisée") :

```python
ZH_DBZ_GAIN = 1.0
ZH_DBZ_OFFSET = -10.5
```

soit `dbz = 40 * 1.0 - 10.5 = 29.5`, vérifié en exécutant `column_sample` directement sur le scan synthétique du test (`ColumnSample(elevation_deg=8.0, altitude_m=1542.95, dbz=29.5)` et `ColumnSample(elevation_deg=0.4, altitude_m=129.30, dbz=29.5)`). `9.5` correspondrait à un ancien offset (`-30.5`) antérieur à la calibration finale de la Task 3. Le brief de la Task 6 a manifestement été écrit avant que cette constante ne soit figée — comme pour le catalogue de stations, ce n'est pas une assertion structurelle (le test vérifie toujours que `dbz` est bien calculé et identique pour les deux niveaux) mais une valeur numérique dépendant d'une dépendance verrouillée après coup. J'ai corrigé le littéral à `29.5` avec un commentaire expliquant le calcul. Je n'ai pas touché à `ZH_DBZ_GAIN`/`ZH_DBZ_OFFSET` dans `pam_bitstream.py` (verrouillés, hors périmètre de cette tâche).

### 4. Cache "un seul fetch catalogue par cycle" — TTL ajouté (déviation d'implémentation, pas de test)

Le code de référence du brief appelait `_fetch_catalog` à *chaque* appel de `_volume()`, y compris quand le cycle n'avait pas changé — ce qui aurait fait échouer `test_volume_downloaded_once_per_cycle` (deux appels rapprochés de `column()` doivent produire *un seul* appel catalogue). J'ai ajouté une revalidation bornée dans le temps :

```python
CATALOG_TTL_SECONDS = 30.0
```

`_volume()` ne réinterroge le catalogue que si aucun volume n'est en cache pour la station **ou** si plus de `CATALOG_TTL_SECONDS` se sont écoulées depuis la dernière vérification catalogue de cette station. Cela satisfait l'assertion "pas de re-fetch" du test (deux appels synchrones, quasi instantanés) tout en respectant la sémantique documentée dans le docstring d'origine ("invalidé dès que le catalogue expose un cycle plus récent") : passé le TTL, un nouvel appel `column()` revérifie le catalogue et adopte un nouveau cycle si le tuple `validity_time` a changé. Le verrou par station (`_station_lock`) protège toujours l'ensemble lecture-cache/fetch-catalogue/téléchargement contre les accès concurrents. Aucun test ne couvre explicitement l'expiration du TTL (au-delà de 30 s) — comportement raisonnable mais non démontré par un test automatisé ; à surveiller si un futur ticket a besoin d'un contrat plus strict sur la fraîcheur du cache.

## TDD — preuve

**RED** (`pam_volume.py` absent) :
```
$ venv/bin/python3 -m pytest tests/test_volume_column.py -v
ModuleNotFoundError: No module named 'pam_volume'
Interrupted: 1 error during collection
```

**GREEN** (après implémentation) :
```
$ venv/bin/python3 -m pytest tests/test_volume_column.py -v
tests/test_volume_column.py::test_column_near_bordeaux_sorted_by_altitude PASSED
tests/test_volume_column.py::test_out_of_range_raises_with_nearest PASSED
tests/test_volume_column.py::test_volume_downloaded_once_per_cycle PASSED
tests/test_volume_column.py::test_endpoint_column_and_404 PASSED
4 passed, 9 warnings in 0.39s
```

**Suite complète, aucune régression :**
```
$ venv/bin/python3 -m pytest tests/ -v
... (tous les tests test_worker.py, test_manifest.py, test_pam_*, test_polar_geometry.py, test_station_catalog.py, test_publish_job.py inchangés PASSED)
63 passed, 5 skipped, 81 warnings in 1.24s
```
(baseline avant Task 6 : 59 passed, 5 skipped ; +4 nouveaux tests verts, 0 régression, mêmes 5 skips différentiels/calibration liés aux fixtures eccodes absentes de l'environnement — inchangés.)

## Vérifications manuelles complémentaires

- `Cache-Control: public, max-age=120` et `Access-Control-Allow-Origin: *` bien présents sur une réponse 200 réelle (vérifié via un script ad hoc avec `TestClient`).
- 422 « lat/lon outside métropole bounds » déclenché par les bornes explicites (`lat=60.0`) — distinct du 422 automatique FastAPI pour un type invalide (`lat="abc"`), les deux chemins testés.
- 503 « radar API key is not configured » déclenché quand `Settings.api_key == ""`.
- `py_compile` OK sur `pam_volume.py` et `app.py` ; pas d'import circulaire (`pam_volume` ne dépend que de `models`, `pam_bitstream`, `polar_geometry`, `station_catalog`).

## Fichiers modifiés

- `services/radar-worker/pam_volume.py` (nouveau)
- `services/radar-worker/app.py` (import + paramètre `volume_store_factory` + route `/volume/column`)
- `services/radar-worker/tests/test_volume_column.py` (nouveau)

## Auto-revue

- Sémantique de refus stricte respectée : `RadarMetadataError` → 502, `OutOfRangeError` → 404 avec forme exacte `{"error": "hors_couverture", "nearestStationId", "nearestStationKm"}`, toute autre exception (httpx, décodage) → 502 générique.
- `levels` toujours triés par `altitudeM` croissant ; `dbz: null` pour code manquant/pas d'écho (chemin `column_sample is None` skip le niveau — pas testé explicitement ici mais couvert par `test_polar_geometry.py` en amont pour `column_sample`).
- Aucun secret/clé API dans les réponses ; `api_key` n'apparaît jamais dans le payload JSON.
- Verrou par station : `column()` acquiert `_station_lock(station.station_id)` avant tout accès au cache/catalogue/téléchargement — un seul téléchargement concurrent par station, comme spécifié.
- Le paramètre `catalog_ttl_seconds` de `PamVolumeStore.__init__` a une valeur par défaut (`30.0`) et n'est surchargé par aucun test — changement rétrocompatible.

## Concerns

- Le TTL de revalidation catalogue (30 s) est un choix d'ingénierie raisonnable mais arbitraire, non couvert par un test dédié (aucun test ne simule l'écoulement du temps pour vérifier qu'un nouveau cycle est bien détecté après expiration). Si un contrat plus strict sur la fraîcheur est nécessaire, prévoir un test avec horloge injectée/monkeypatchée sur `time.monotonic`.
- Le fichier `services/radar-worker/data/` restait déjà non suivi par git avant cette tâche (fixtures d'autres tâches) ; je n'y ai rien ajouté et ne l'ai pas inclus dans le commit.
- `.superpowers/sdd/task-3-report.md` et `task-5-report.md` apparaissaient déjà modifiés (non stagés) au démarrage de cette session, sans lien avec ce Task 6 ; je ne les ai pas touchés et ne les inclus pas dans le commit de cette tâche.
