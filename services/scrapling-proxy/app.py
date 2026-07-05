"""
Scrapling RSS Proxy — Contourne Cloudflare pour les flux RSS protégés.
Déployer sur Cloud Run, AWS Lambda, ou serveur dédié.

Usage:
    GET /rss?url=https://services.lesechos.fr/rss/les-echos-une.xml

Flux ciblés (Cloudflare 403):
    - Les Échos: services.lesechos.fr/rss/*
    - La Voix du Nord: www.lavoixdunord.fr/rss
    - Paris Normandie: www.paris-normandie.fr/rss
"""

import os
import re
import time
import hmac
import hashlib
from itertools import islice
from flask import Flask, request, Response, jsonify
from scrapling import Fetcher, StealthyFetcher
from urllib.parse import urlparse

app = Flask(__name__)

# ═══ Enedis Incidents Scraping ═══
# Cache spécifique pour les incidents (TTL court pour temps réel)
_incident_cache: dict[str, tuple[list, float]] = {}
INCIDENT_CACHE_TTL = 120  # 2 minutes

# Mapping département nom → code INSEE
DEPT_NAME_TO_CODE: dict[str, str] = {
    'ain': '01', 'aisne': '02', 'allier': '03', 'alpes-de-haute-provence': '04',
    'hautes-alpes': '05', 'alpes-maritimes': '06', 'ardeche': '07', 'ardennes': '08',
    'ariege': '09', 'aube': '10', 'aude': '11', 'aveyron': '12',
    'bouches-du-rhone': '13', 'calvados': '14', 'cantal': '15', 'charente': '16',
    'charente-maritime': '17', 'cher': '18', 'correze': '19', 'corse-du-sud': '2A',
    'haute-corse': '2B', "cote-d'or": '21', "cotes-d'armor": '22', 'creuse': '23',
    'dordogne': '24', 'doubs': '25', 'drome': '26', 'eure': '27', 'eure-et-loir': '28',
    'finistere': '29', 'gard': '30', 'haute-garonne': '31', 'gers': '32',
    'gironde': '33', 'herault': '34', 'ille-et-vilaine': '35', 'indre': '36',
    'indre-et-loire': '37', 'isere': '38', 'jura': '39', 'landes': '40',
    'loir-et-cher': '41', 'loire': '42', 'haute-loire': '43', 'loire-atlantique': '44',
    'loiret': '45', 'lot': '46', 'lot-et-garonne': '47', 'lozere': '48',
    'maine-et-loire': '49', 'manche': '50', 'marne': '51', 'haute-marne': '52',
    'mayenne': '53', 'meurthe-et-moselle': '54', 'meuse': '55', 'morbihan': '56',
    'moselle': '57', 'nievre': '58', 'nord': '59', 'oise': '60', 'orne': '61',
    'pas-de-calais': '62', 'puy-de-dome': '63', 'pyrenees-atlantiques': '64',
    'hautes-pyrenees': '65', 'pyrenees-orientales': '66', 'bas-rhin': '67',
    'haut-rhin': '68', 'rhone': '69', 'haute-saone': '70', 'saone-et-loire': '71',
    'sarthe': '72', 'savoie': '73', 'haute-savoie': '74', 'paris': '75',
    'seine-maritime': '76', 'seine-et-marne': '77', 'yvelines': '78', 'deux-sevres': '79',
    'somme': '80', 'tarn': '81', 'tarn-et-garonne': '82', 'var': '83', 'vaucluse': '84',
    'vendee': '85', 'vienne': '86', 'haute-vienne': '87', 'vosges': '88', 'yonne': '89',
    'territoire de belfort': '90', 'essonne': '91', 'hauts-de-seine': '92',
    'seine-saint-denis': '93', 'val-de-marne': '94', "val-d'oise": '95',
    'guadeloupe': '971', 'martinique': '972', 'guyane': '973', 'reunion': '974', 'mayotte': '976',
}

def normalize_dept_name(name: str) -> str | None:
    """Normalise un nom de département vers son code INSEE."""
    if not name:
        return None
    # Nettoyage: minuscules, accents simplifiés
    normalized = name.lower().strip()
    normalized = normalized.replace('é', 'e').replace('è', 'e').replace('ê', 'e')
    normalized = normalized.replace('à', 'a').replace('â', 'a')
    normalized = normalized.replace('ô', 'o').replace('î', 'i').replace('û', 'u')
    normalized = normalized.replace('ç', 'c')

    # Recherche directe
    if normalized in DEPT_NAME_TO_CODE:
        return DEPT_NAME_TO_CODE[normalized]

    # Recherche partielle
    for dept_name, code in DEPT_NAME_TO_CODE.items():
        if normalized in dept_name or dept_name in normalized:
            return code

    # Si c'est déjà un code (01, 2A, 971...)
    if re.match(r'^(\d{2,3}|2[AB])$', name.strip().upper()):
        return name.strip().upper().zfill(2) if len(name.strip()) < 3 else name.strip()

    return None

def parse_affected_count(text: str) -> int:
    """Extrait un nombre depuis un texte comme '12 500 clients' → 12500."""
    if not text:
        return 0
    # Supprime espaces et extrait chiffres
    numbers = re.findall(r'\d+', text.replace(' ', '').replace('\u00a0', ''))
    return int(''.join(numbers)) if numbers else 0


def truncate_hash(digest: str, length: int = 12) -> str:
    """Truncate a hash digest to specified length."""
    return ''.join(islice(digest, length))


def first_n(items: list, n: int = 5) -> list:
    """Return first N items from a list."""
    return list(islice(items, n))

# Domaines autorisés (whitelist pour sécurité)
ALLOWED_DOMAINS = {
    'services.lesechos.fr',
    'www.lesechos.fr',
    'www.lavoixdunord.fr',
    'www.paris-normandie.fr',
    'www.leparisien.fr',
    'www.enedis.fr',  # Info-coupure
    'www.elysee.fr',
    'www.info.gouv.fr',
    'frenchbreaches.com',
    'www.frenchbreaches.com',
    'map.frenchbreaches.com',
}

# Cache simple en mémoire (TTL 5 min)
_cache: dict[str, tuple[str, float]] = {}
CACHE_TTL = 300  # 5 minutes

def is_allowed(url: str) -> bool:
    """Vérifie que le domaine est dans la whitelist."""
    try:
        parsed = urlparse(url)
        return parsed.netloc in ALLOWED_DOMAINS
    except Exception:
        return False

def get_cached(url: str) -> str | None:
    """Retourne le contenu caché si encore valide."""
    import time
    if url in _cache:
        content, ts = _cache[url]
        if time.time() - ts < CACHE_TTL:
            return content
        del _cache[url]
    return None

def set_cache(url: str, content: str) -> None:
    """Met en cache le contenu."""
    import time
    _cache[url] = (content, time.time())

@app.route('/health')
def health():
    """Health check pour les load balancers."""
    return jsonify({'status': 'ok', 'service': 'scrapling-proxy'})

@app.route('/scrape')
def scrape_page():
    """
    Scrape une page HTML avec bypass Cloudflare via Scrapling.
    """
    url = request.args.get('url')

    if not url:
        return jsonify({'error': 'Missing ?url= parameter'}), 400

    if not is_allowed(url):
        return jsonify({'error': 'Domain not in whitelist', 'allowed': list(ALLOWED_DOMAINS)}), 403

    # Check cache
    cached = get_cached(url)
    if cached:
        return Response(cached, mimetype='text/html', headers={
            'X-Cache': 'HIT',
            'Cache-Control': 'public, max-age=300',
            'Access-Control-Allow-Origin': '*',
        })

    try:
        # Scrapling avec Camoufox (stealth browser)
        fetcher = Fetcher(auto_match=True)
        page = fetcher.get(url, timeout=15)

        if not page.status == 200:
            return jsonify({'error': f'Upstream returned {page.status}'}), page.status

        content = page.text

        # Cache le résultat
        set_cache(url, content)

        return Response(content, mimetype='text/html', headers={
            'X-Cache': 'MISS',
            'Cache-Control': 'public, max-age=300',
            'Access-Control-Allow-Origin': '*',
        })

    except Exception as e:
        return jsonify({'error': 'Scrape failed', 'message': str(e)}), 502

@app.route('/rss')
def fetch_rss():
    """
    Proxy RSS avec bypass Cloudflare via Scrapling.

    Query params:
        url: URL du flux RSS à fetcher
    """
    url = request.args.get('url')

    if not url:
        return jsonify({'error': 'Missing ?url= parameter'}), 400

    if not is_allowed(url):
        return jsonify({'error': 'Domain not in whitelist', 'allowed': list(ALLOWED_DOMAINS)}), 403

    # Check cache
    cached = get_cached(url)
    if cached:
        return Response(cached, mimetype='application/xml', headers={
            'X-Cache': 'HIT',
            'Cache-Control': 'public, max-age=300',
        })

    try:
        # Scrapling avec Camoufox (stealth browser)
        fetcher = Fetcher(auto_match=True)
        page = fetcher.get(url, timeout=15)

        if not page.status == 200:
            return jsonify({'error': f'Upstream returned {page.status}'}), page.status

        content = page.text

        # Vérifier que c'est du XML/RSS
        if not content.strip().startswith('<?xml') and '<rss' not in content[:500]:
            return jsonify({'error': 'Response is not RSS/XML'}), 502

        # Cache le résultat
        set_cache(url, content)

        return Response(content, mimetype='application/xml', headers={
            'X-Cache': 'MISS',
            'Cache-Control': 'public, max-age=300',
            'Access-Control-Allow-Origin': '*',
        })

    except Exception as e:
        return jsonify({'error': 'Fetch failed', 'message': str(e)}), 502

@app.route('/incidents/enedis')
def fetch_enedis_incidents():
    """
    Récupère les incidents Enedis en temps réel via l'API AJAX interne.

    Stratégie:
    1. On crée une session Scrapling sur la page info-coupure pour obtenir les cookies
    2. On appelle panne-interruption-ajax pour chaque commune majeure
    3. On parse les coupures en cours

    Retourne: liste d'incidents avec id, city, department, severity, affectedCount.
    Cache: 5 minutes.
    """
    cache_key = 'enedis_incidents_v2'

    # Check cache
    if cache_key in _incident_cache:
        data, ts = _incident_cache[cache_key]
        if time.time() - ts < INCIDENT_CACHE_TTL:
            return jsonify({
                'incidents': data,
                'cached': True,
                'ttlRemaining': int(INCIDENT_CACHE_TTL - (time.time() - ts))
            }), 200, {'Access-Control-Allow-Origin': '*', 'X-Cache': 'HIT'}

    # Top communes avec code INSEE et coordonnées
    COMMUNES = [
        {'insee': '75056', 'city': 'Paris',           'dept': '75', 'lat': 48.8566, 'lon': 2.3522},
        {'insee': '13055', 'city': 'Marseille',        'dept': '13', 'lat': 43.2965, 'lon': 5.3698},
        {'insee': '69123', 'city': 'Lyon',             'dept': '69', 'lat': 45.7640, 'lon': 4.8357},
        {'insee': '31555', 'city': 'Toulouse',         'dept': '31', 'lat': 43.6047, 'lon': 1.4442},
        {'insee': '06088', 'city': 'Nice',             'dept': '06', 'lat': 43.7102, 'lon': 7.2620},
        {'insee': '44109', 'city': 'Nantes',           'dept': '44', 'lat': 47.2184, 'lon': -1.5536},
        {'insee': '67482', 'city': 'Strasbourg',       'dept': '67', 'lat': 48.5734, 'lon': 7.7521},
        {'insee': '34172', 'city': 'Montpellier',      'dept': '34', 'lat': 43.6108, 'lon': 3.8767},
        {'insee': '33063', 'city': 'Bordeaux',         'dept': '33', 'lat': 44.8378, 'lon': -0.5792},
        {'insee': '59350', 'city': 'Lille',            'dept': '59', 'lat': 50.6292, 'lon': 3.0573},
        {'insee': '35238', 'city': 'Rennes',           'dept': '35', 'lat': 48.1173, 'lon': -1.6778},
        {'insee': '76540', 'city': 'Rouen',            'dept': '76', 'lat': 49.4432, 'lon': 1.0993},
        {'insee': '38185', 'city': 'Grenoble',         'dept': '38', 'lat': 45.1885, 'lon': 5.7245},
        {'insee': '63113', 'city': 'Clermont-Ferrand', 'dept': '63', 'lat': 45.7772, 'lon': 3.0870},
        {'insee': '83137', 'city': 'Toulon',           'dept': '83', 'lat': 43.1242, 'lon': 5.9280},
        {'insee': '49007', 'city': 'Angers',           'dept': '49', 'lat': 47.4784, 'lon': -0.5632},
        {'insee': '51454', 'city': 'Reims',            'dept': '51', 'lat': 49.2583, 'lon': 4.0317},
        {'insee': '54395', 'city': 'Nancy',            'dept': '54', 'lat': 48.6921, 'lon': 6.1844},
        {'insee': '42218', 'city': 'Saint-Étienne',    'dept': '42', 'lat': 45.4397, 'lon': 4.3872},
        {'insee': '76351', 'city': 'Le Havre',         'dept': '76', 'lat': 49.4944, 'lon': 0.1079},
    ]

    try:
        # StealthyFetcher : vrai navigateur Camoufox qui contourne Cloudfront
        fetcher = StealthyFetcher(headless=True)

        # Étape 1 : visiter la page principale pour obtenir les cookies de session (30s)
        seed = fetcher.fetch('https://www.enedis.fr/panne-et-interruption', timeout=30000)
        if seed.status != 200:
            raise Exception(f'Seed page returned {seed.status}')

        incidents = []
        seen_ids = set()

        # Étape 2 : appeler l'AJAX pour chaque commune (les cookies sont portés par le Fetcher)
        for commune in COMMUNES:
            try:
                ajax_url = (
                    f"https://www.enedis.fr/panne-interruption-ajax"
                    f"?insee={commune['insee']}"
                    f"&type=municipality"
                    f"&adresse={commune['city']}"
                )
                resp = fetcher.fetch(
                    ajax_url,
                    timeout=15000,
                    extra_headers={
                        'Referer': 'https://www.enedis.fr/panne-et-interruption',
                        'X-Requested-With': 'XMLHttpRequest',
                        'Accept': 'application/json, text/javascript, */*',
                    }
                )

                if resp.status != 200:
                    continue

                # Extraire le JSON de la réponse
                try:
                    import json
                    data = json.loads(resp.text)
                except Exception:
                    continue

                coupures = (data.get('resultMegacache') or {}).get('listeCoupuresInfoReseau') or []

                for c in coupures:
                    etat = (c.get('etatCoupure') or '').lower()
                    if 'cours' not in etat and 'actif' not in etat:
                        continue

                    incident_id = f"enedis-{c.get('idCoupure', '')}"
                    if incident_id in seen_ids:
                        continue
                    seen_ids.add(incident_id)

                    nb = c.get('nbFoyersCoupes') or 0
                    if nb >= 10000:
                        severity = 'critical'
                    elif nb >= 2000:
                        severity = 'high'
                    elif nb >= 500:
                        severity = 'medium'
                    else:
                        severity = 'low'

                    adresses = c.get('listeAdresses') or []
                    rues = ', '.join(a.get('localisation', '') for a in adresses[:3])
                    nature = c.get('incidentCoupure') or 'Incident réseau'
                    if rues:
                        nature = f"{nature} — {rues}"

                    incidents.append({
                        'id': incident_id,
                        'type': 'electricity',
                        'nature': nature[:100],
                        'city': commune['city'],
                        'department': commune['dept'],
                        'affectedCount': nb,
                        'severity': severity,
                        'startDate': c.get('dateCoupure'),
                        'estimatedEnd': c.get('dateRealimentation'),
                        'lat': commune['lat'],
                        'lon': commune['lon'],
                        'scrapedAt': int(time.time()),
                    })

            except Exception:
                continue  # On passe à la commune suivante si timeout

        # Tri par gravité
        severity_order = {'critical': 4, 'high': 3, 'medium': 2, 'low': 1}
        incidents.sort(key=lambda x: severity_order.get(x['severity'], 0), reverse=True)

        _incident_cache[cache_key] = (incidents, time.time())

        print(f"[Enedis] {len(incidents)} incident(s) en cours sur {len(COMMUNES)} communes")

        return jsonify({
            'incidents': incidents,
            'cached': False,
            'scrapedAt': int(time.time()),
            'source': 'panne-interruption-ajax'
        }), 200, {'Access-Control-Allow-Origin': '*', 'X-Cache': 'MISS'}

    except Exception as e:
        if cache_key in _incident_cache:
            stale_data, stale_ts = _incident_cache[cache_key]
            return jsonify({
                'incidents': stale_data,
                'cached': True,
                'stale': True,
                'error': str(e)
            }), 200, {'Access-Control-Allow-Origin': '*', 'X-Cache': 'STALE'}

        return jsonify({
            'error': 'Scraping failed',
            'message': str(e),
            'incidents': []
        }), 502, {'Access-Control-Allow-Origin': '*'}





@app.route('/clear-cache', methods=['POST'])
def clear_cache():
    """Vide le cache (admin — protégé par X-Admin-Token)."""
    admin_token = os.environ.get('SCRAPLING_ADMIN_TOKEN')
    # Fermé par défaut : sans token configuré, l'endpoint est désactivé (403).
    if not admin_token:
        return jsonify({'error': 'Admin endpoint disabled'}), 403
    provided = request.headers.get('X-Admin-Token', '')
    # Comparaison à temps constant pour éviter les attaques temporelles.
    if not hmac.compare_digest(provided, admin_token):
        return jsonify({'error': 'Forbidden'}), 403
    _cache.clear()
    _incident_cache.clear()
    return jsonify({'status': 'ok', 'message': 'All caches cleared'})

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    # debug forcé à False : le débogueur Werkzeug exposé en prod = RCE.
    app.run(host='0.0.0.0', port=port, debug=False)
