/**
 * military-ships.ts — Navires militaires français (Marine Nationale)
 *
 * Sources:
 *  1. aisstream.io WebSocket (gratuit avec clé API) → AIS live
 *  2. Données statiques enrichies (navires connus de la Marine Nationale)
 *     avec positions mock réalistes (ports d'attache)
 *
 * L'AIS des navires militaires est souvent coupé. On affiche :
 *  - Les navires détectés en AIS live
 *  - La base statique (navigation simulée depuis le port d'attache)
 */

import { getMmsiCountry } from '../utils/mmsi-country.ts';

export interface MilitaryShip {
    id: string;
    name: string;
    type: string;          // Classe / type (Frégate, porte-avions, patrouilleur...)
    role: string;          // Rôle opérationnel
    mmsi?: string;         // MMSI AIS si connu
    lat: number;
    lon: number;
    speed?: number;        // nœuds
    heading?: number;      // degrés
    cog?: number;          // Course over ground (deg)
    navStatus?: number;    // AIS navigational status
    callSign?: string;     // Indicatif radio
    imoNumber?: number;    // IMO
    draught?: number;      // Tirant d'eau (m)
    dimensions?: {         // Dimensions (m)
        a?: number;
        b?: number;
        c?: number;
        d?: number;
        length?: number;
        width?: number;
    };
    eta?: {                // ETA déclarée (UTC)
        month?: number;
        day?: number;
        hour?: number;
        minute?: number;
    };
    port?: string;         // Port d'attache
    lastSeen?: number;     // timestamp
    isLive?: boolean;      // true si données AIS en temps réel
    shipType?: number;     // Code AIS type (70-79=cargo, 80-89=tanker, etc.)
    destination?: string;  // Destination déclarée
    country?: string;      // Flag emoji + country name from MMSI MID (e.g. "🇫🇷 France")
    trail?: Array<[number, number]>; // Dernières positions [lon, lat] (max 80 points)
}

// ─── Base statique de la Marine Nationale ───
// Navires avec MMSI connus et port d'attache
const FRENCH_NAVY_SHIPS: Array<Omit<MilitaryShip, 'lat' | 'lon'> & { homeLat: number; homeLon: number }> = [
    // ─── Porte-avions ───
    { id: 'r91', name: 'Charles de Gaulle', type: 'Porte-avions', role: 'Aviation', mmsi: '227334000', port: 'Toulon', homeLat: 43.122, homeLon: 5.928 },

    // ─── Frégates de défense aérienne (FDA) ───
    { id: 'd620', name: 'Chevalier Paul', type: 'Frégate DA', role: 'Défense aérienne', mmsi: '227731000', port: 'Toulon', homeLat: 43.120, homeLon: 5.925 },
    { id: 'd621', name: 'Forbin', type: 'Frégate DA', role: 'Défense aérienne', mmsi: '227732000', port: 'Toulon', homeLat: 43.119, homeLon: 5.926 },

    // ─── Frégates multi-missions (FREMM) ───
    { id: 'd650', name: 'Aquitaine', type: 'FREMM', role: 'Frégate multi-missions', mmsi: '227801000', port: 'Toulon', homeLat: 43.121, homeLon: 5.924 },
    { id: 'd651', name: 'Provence', type: 'FREMM', role: 'Frégate multi-missions', mmsi: '227802000', port: 'Toulon', homeLat: 43.118, homeLon: 5.927 },
    { id: 'd652', name: 'Languedoc', type: 'FREMM', role: 'Frégate multi-missions', mmsi: '227803000', port: 'Toulon', homeLat: 43.117, homeLon: 5.923 },
    { id: 'd653', name: 'Auvergne', type: 'FREMM', role: 'Frégate multi-missions', mmsi: '227804000', port: 'Toulon', homeLat: 43.123, homeLon: 5.929 },
    { id: 'd654', name: 'Bretagne', type: 'FREMM', role: 'Frégate multi-missions', mmsi: '227805000', port: 'Brest', homeLat: 48.375, homeLon: -4.495 },
    { id: 'd655', name: 'Normandie', type: 'FREMM', role: 'Frégate multi-missions', mmsi: '227806000', port: 'Brest', homeLat: 48.377, homeLon: -4.497 },

    // ─── Bâtiments de projection et de commandement (BPC) ───
    { id: 'l9011', name: 'Mistral', type: 'BPC', role: 'Projection amphibie', mmsi: '227301000', port: 'Toulon', homeLat: 43.116, homeLon: 5.921 },
    { id: 'l9012', name: 'Tonnerre', type: 'BPC', role: 'Projection amphibie', mmsi: '227302000', port: 'Toulon', homeLat: 43.115, homeLon: 5.920 },
    { id: 'l9013', name: 'Dixmude', type: 'BPC', role: 'Projection amphibie', mmsi: '227303000', port: 'Toulon', homeLat: 43.114, homeLon: 5.919 },

    // ─── Sous-marins nucléaires lanceurs d'engins (SNLE) ─ jamais en AIS ───
    // On les affiche au port comme "stationnés"
    { id: 's616', name: 'Le Triomphant', type: 'SNLE', role: 'Dissuasion nucléaire', port: 'Île Longue', homeLat: 48.309, homeLon: -4.411 },
    { id: 's617', name: 'Le Téméraire', type: 'SNLE', role: 'Dissuasion nucléaire', port: 'Île Longue', homeLat: 48.308, homeLon: -4.412 },
    { id: 's618', name: 'Le Vigilant', type: 'SNLE', role: 'Dissuasion nucléaire', port: 'Île Longue', homeLat: 48.307, homeLon: -4.413 },
    { id: 's619', name: 'Le Terrible', type: 'SNLE', role: 'Dissuasion nucléaire', port: 'Île Longue', homeLat: 48.306, homeLon: -4.414 },

    // ─── Sous-marins nucléaires d'attaque (SNA) ───
    { id: 's602', name: 'Perle', type: 'SNA', role: 'Attaque sous-marine', port: 'Toulon', homeLat: 43.112, homeLon: 5.917 },
    { id: 's603', name: 'Casabianca', type: 'SNA', role: 'Attaque sous-marine', port: 'Toulon', homeLat: 43.111, homeLon: 5.916 },
    { id: 's604', name: 'Émeraude', type: 'SNA', role: 'Attaque sous-marine', port: 'Toulon', homeLat: 43.110, homeLon: 5.915 },
    { id: 's605', name: 'Améthyste', type: 'SNA', role: 'Attaque sous-marine', port: 'Toulon', homeLat: 43.109, homeLon: 5.914 },

    // ─── Patrouilleurs / OPV ───
    { id: 'p680', name: 'Leopard', type: 'Patrouilleur', role: 'Surveillance maritime', mmsi: '227501000', port: 'Cherbourg', homeLat: 49.646, homeLon: -1.624 },
    { id: 'p689', name: 'Géranium', type: 'Patrouilleur outre-mer', role: 'Surveillance ZEE', mmsi: '227509000', port: 'Fort-de-France', homeLat: 14.598, homeLon: -61.079 },

    // ─── Bâtiment de soutien et d'assistance ───
    { id: 'a607', name: 'Marne', type: 'Ravitailleur', role: 'Soutien logistique', mmsi: '227201000', port: 'Toulon', homeLat: 43.126, homeLon: 5.932 },
    { id: 'a608', name: 'Somme', type: 'Ravitailleur', role: 'Soutien logistique', mmsi: '227202000', port: 'Brest', homeLat: 48.380, homeLon: -4.500 },
];

// Clé API aisstream.io (optionnelle — en .env)
const AISSTREAM_KEY = import.meta.env.VITE_AISSTREAM_KEY ?? '';
export const AIS_RELAY_URL = 'ws://localhost:8090';

// Cache des positions live AIS - stocke TOUS les navires reçus (pas seulement Marine Nationale)
interface LivePosition {
    lat: number;
    lon: number;
    speed: number;
    heading: number;
    cog?: number;
    navStatus?: number;
    ts: number;
    name?: string;       // Nom du navire si disponible
    shipType?: number;   // Type AIS (cargo, tanker, etc.)
    destination?: string; // Destination du navire (port)
    isMilitary?: boolean; // Marqué true si MMSI dans FRENCH_NAVY_SHIPS
    country?: string;     // "🇫🇷 France" format
}
const livePositions = new Map<string, LivePosition>();
// Historique de positions par navire (max MAX_TRAIL_POINTS points)
const MAX_TRAIL_POINTS = 80;
const shipTrails = new Map<string, Array<[number, number]>>(); // MMSI → [[lon, lat], ...]
interface StaticAisData {
    name?: string;
    shipType?: number;
    destination?: string;
    callSign?: string;
    imoNumber?: number;
    draught?: number;
    dimensions?: {
        a?: number;
        b?: number;
        c?: number;
        d?: number;
        length?: number;
        width?: number;
    };
    eta?: {
        month?: number;
        day?: number;
        hour?: number;
        minute?: number;
    };
}
const staticByMmsi = new Map<string, StaticAisData>();
let lastStaticSample: { mmsi: string; staticReport: unknown } | null = null;
let wsConnected = false;
// Set de MMSI de la Marine Nationale pour marquage rapide
// Exported for sovereign whitelist filtering in App.ts
export const NAVY_MMSI_SET = new Set(
    FRENCH_NAVY_SHIPS.filter(s => s.mmsi).map(s => s.mmsi!)
);

// Debug counters
let wsMessageCount = 0;

// Callback for first data arrival (allows App.ts to trigger immediate refresh)
let onFirstDataCallback: (() => void) | null = null;
let firstDataReceived = false;

/**
 * Register a callback to be called when the first AIS data arrives.
 * This allows App.ts to refresh the map immediately instead of waiting 60s.
 */
export function onFirstAisData(callback: () => void): void {
    onFirstDataCallback = callback;
    // If we already have data, call immediately
    if (firstDataReceived && livePositions.size > 0) {
        callback();
    }
}

const toNumber = (value: unknown): number | undefined => {
    if (value == null) return undefined;
    const num = Number(value);
    return Number.isFinite(num) ? num : undefined;
};

const toInt = (value: unknown): number | undefined => {
    const num = toNumber(value);
    return num == null ? undefined : Math.trunc(num);
};

const buildDimensions = (dimension: unknown): StaticAisData['dimensions'] | undefined => {
    const dim = dimension as { A?: unknown; B?: unknown; C?: unknown; D?: unknown } | undefined;
    const a = toNumber(dim?.A);
    const b = toNumber(dim?.B);
    const c = toNumber(dim?.C);
    const d = toNumber(dim?.D);
    if (a == null && b == null && c == null && d == null) return undefined;
    const length = a != null && b != null ? a + b : undefined;
    const width = c != null && d != null ? c + d : undefined;
    return { a, b, c, d, length, width };
};

const buildEta = (eta: unknown): StaticAisData['eta'] | undefined => {
    const e = eta as { Month?: unknown; Day?: unknown; Hour?: unknown; Minute?: unknown } | undefined;
    const month = toInt(e?.Month);
    const day = toInt(e?.Day);
    const hour = toInt(e?.Hour);
    const minute = toInt(e?.Minute);
    if (month == null && day == null && hour == null && minute == null) return undefined;
    return { month, day, hour, minute };
};

function connectAisStream(): void {
    if (wsConnected) return;

    try {
        // 🚨 MAGIE : On se connecte à notre propre relais Node.js !
        const ws = new WebSocket(AIS_RELAY_URL);

        ws.onopen = () => {
            wsConnected = true;
            wsMessageCount = 0;
            console.log('[AIS] ✅ Connecté au relais local', AIS_RELAY_URL);
        };

        ws.onmessage = (evt) => {
            wsMessageCount++;
            if (wsMessageCount === 1) {
                console.log('[AIS] 📡 Premier message reçu du relais');
            } else if (wsMessageCount === 50) {
                console.log(`[AIS] 📡 50 messages reçus — ${livePositions.size} navires en cache`);
            }

            try {
                const msg = JSON.parse(evt.data);

                if (msg.MessageType === 'Error' || msg.error || msg.Error) {
                    console.error('[AIS] ❌ Erreur relais:', msg.Error ?? msg.error ?? msg.message);
                    return;
                }

                const posReport = msg?.Message?.PositionReport ?? msg?.Message?.StandardClassBPositionReport;
                const metaData = msg?.MetaData;
                const staticReport = msg?.Message?.ShipStaticData ?? msg?.Message?.StaticData;
                const mmsiRaw =
                    metaData?.MMSI ??
                    posReport?.UserID ??
                    posReport?.MMSI ??
                    staticReport?.UserID ??
                    staticReport?.MMSI ??
                    staticReport?.Mmsi ??
                    staticReport?.MetaData?.MMSI ??
                    '';
                const mmsi = String(mmsiRaw).trim();

                if (!mmsi) return;

                const isMilitary = NAVY_MMSI_SET.has(mmsi);
                const existing = livePositions.get(mmsi);
                const cachedStatic = staticByMmsi.get(mmsi);

                const shipNameRaw = metaData?.ShipName ?? staticReport?.Name ?? cachedStatic?.name ?? existing?.name;
                const shipName = shipNameRaw != null ? String(shipNameRaw).trim() : undefined;
                const shipTypeRaw =
                    metaData?.ShipType ??
                    staticReport?.ShipType ??
                    staticReport?.TypeOfShipAndCargoType ??
                    staticReport?.Type ??
                    cachedStatic?.shipType ??
                    existing?.shipType;
                const shipTypeText = shipTypeRaw == null ? '' : String(shipTypeRaw).trim();
                const shipTypeParsed = shipTypeText ? Number.parseInt(shipTypeText.match(/\d+/)?.[0] ?? '', 10) : NaN;
                const shipType = Number.isFinite(shipTypeParsed) ? shipTypeParsed : undefined;
                const rawDest = metaData?.Destination ?? staticReport?.Destination ?? cachedStatic?.destination ?? existing?.destination;
                const destination = rawDest != null ? String(rawDest).replace(/@/g, '').trim() || undefined : undefined;
                const callSign = staticReport?.CallSign ?? cachedStatic?.callSign;
                const imoNumberRaw = staticReport?.ImoNumber ?? cachedStatic?.imoNumber;
                const imoNumber = toInt(imoNumberRaw);
                const draught = toNumber(staticReport?.MaximumStaticDraught ?? cachedStatic?.draught);
                const dimensions = staticReport?.Dimension ? buildDimensions(staticReport.Dimension) : cachedStatic?.dimensions;
                const eta = staticReport?.Eta ? buildEta(staticReport.Eta) : cachedStatic?.eta;

                if (staticReport) {
                    lastStaticSample = { mmsi, staticReport };
                    staticByMmsi.set(mmsi, {
                        name: shipName ?? cachedStatic?.name,
                        shipType,
                        destination,
                        callSign: callSign != null ? String(callSign).trim() : cachedStatic?.callSign,
                        imoNumber,
                        draught,
                        dimensions,
                        eta,
                    });
                }

                if (posReport) {
                    const lat = toNumber(
                        posReport.Latitude ??
                        (posReport as { latitude?: unknown }).latitude ??
                        metaData?.latitude ??
                        metaData?.Latitude
                    );
                    const lon = toNumber(
                        posReport.Longitude ??
                        (posReport as { longitude?: unknown }).longitude ??
                        metaData?.longitude ??
                        metaData?.Longitude
                    );
                    const navStatus = toInt(
                        posReport.NavigationalStatus ??
                        (posReport as { navigationStatus?: unknown }).navigationStatus ??
                        metaData?.NavigationalStatus ??
                        existing?.navStatus
                    );
                    const cog = toNumber(
                        posReport.Cog ??
                        posReport.CourseOverGround ??
                        metaData?.Cog ??
                        metaData?.CourseOverGround ??
                        existing?.cog
                    );
                    const speed = toNumber(
                        posReport.Sog ??
                        posReport.SpeedOverGround ??
                        metaData?.Sog ??
                        metaData?.SpeedOverGround ??
                        existing?.speed
                    ) ?? 0;
                    const heading = toNumber(
                        posReport.TrueHeading ??
                        posReport.CourseOverGround ??
                        metaData?.TrueHeading ??
                        metaData?.CourseOverGround ??
                        existing?.heading
                    ) ?? 0;

                    if (lat == null || lon == null || lat > 90 || lat < -90 || lon > 180 || lon < -180) return;

                    const isFirstShip = livePositions.size === 0;

                    livePositions.set(mmsi, {
                        lat,
                        lon,
                        speed,
                        heading,
                        cog,
                        navStatus,
                        ts: Date.now(),
                        name: shipName,
                        shipType,
                        destination,
                        isMilitary,
                        country: (() => { const c = getMmsiCountry(mmsi); return c ? `${c.iso2}|${c.name}` : undefined; })(),
                    });

                    // Historique de route
                    const trail = shipTrails.get(mmsi) ?? [];
                    const lastPt = trail[trail.length - 1];
                    // N'ajoute un point que si le navire a bougé (évite points dupliqués)
                    if (!lastPt || Math.abs(lastPt[0] - lon!) > 0.0001 || Math.abs(lastPt[1] - lat!) > 0.0001) {
                        trail.push([lon!, lat!]);
                        if (trail.length > MAX_TRAIL_POINTS) trail.shift();
                        shipTrails.set(mmsi, trail);
                    }

                    // Trigger callback on first data arrival
                    if (isFirstShip && !firstDataReceived) {
                        firstDataReceived = true;
                        if (onFirstDataCallback) {
                            // Small delay to let a few more ships arrive
                            setTimeout(() => {
                                onFirstDataCallback?.();
                            }, 500);
                        }
                    }
                } else if (staticReport) {
                    // Static data can arrive without position; merge into cache if possible
                    if (!existing) return;
                    livePositions.set(mmsi, {
                        ...existing,
                        name: shipName,
                        shipType,
                        destination,
                        isMilitary,
                    });
                } else {
                    return;
                }

            } catch (err) {
                // Silencieux
            }
        };

        ws.onerror = (err) => {
            console.error('[AIS WebSocket] ❌ Erreur avec le relais local :', err);
            wsConnected = false;
        };

        ws.onclose = (_evt) => {
            wsConnected = false;
            setTimeout(() => connectAisStream(), 5000);
        };

    } catch (err) {
        console.error('[AIS WebSocket] ❌ Échec critique de connexion au relais:', err);
    }
}

// Démarrer la connexion AIS si clé disponible
if (typeof window !== 'undefined') {
    // Délai pour laisser l'app s'initialiser
    setTimeout(() => {
        connectAisStream();
    }, 2000);

    // Nettoyage périodique des entrées périmées (> 30 min) pour éviter la croissance mémoire
    const AIS_CACHE_TTL = 30 * 60 * 1000; // 30 minutes
    setInterval(() => {
        const cutoff = Date.now() - AIS_CACHE_TTL;
        for (const [mmsi, pos] of livePositions) {
            if (pos.ts < cutoff) {
                livePositions.delete(mmsi);
                staticByMmsi.delete(mmsi);
                shipTrails.delete(mmsi);
            }
        }
    }, 5 * 60 * 1000); // toutes les 5 minutes
}

/**
 * Retourne l'état de connexion du WebSocket AIS.
 * Utile pour le debugging dans la console.
 */
export function getAisStatus(): { connected: boolean; shipCount: number; messageCount: number; hasApiKey: boolean } {
    return {
        connected: wsConnected,
        shipCount: livePositions.size,
        messageCount: wsMessageCount,
        hasApiKey: Boolean(AISSTREAM_KEY),
    };
}

/**
 * Force une reconnexion du WebSocket AIS.
 * Utile pour le debugging dans la console: `import { reconnectAis } from './services/military-ships'; reconnectAis()`
 */
export function reconnectAis(): void {
    wsConnected = false;
    connectAisStream();
}

// Exposer pour debug dans la console du navigateur
if (typeof window !== 'undefined') {
    (window as unknown as Record<string, unknown>).aisDebug = {
        status: () => getAisStatus(),
        reconnect: () => reconnectAis(),
        // Return array of {mmsi, lat, lon, name, ...} objects
        ships: () => {
            const ships: Array<{ mmsi: string; lat: number; lon: number; name?: string; speed: number }> = [];
            for (const [mmsi, pos] of livePositions) {
                ships.push({ mmsi, lat: pos.lat, lon: pos.lon, name: pos.name, speed: pos.speed });
            }
            return ships.slice(0, 10);
        },
        allShips: () => {
            const ships: Array<{ mmsi: string; lat: number; lon: number; name?: string; speed: number }> = [];
            for (const [mmsi, pos] of livePositions) {
                ships.push({ mmsi, lat: pos.lat, lon: pos.lon, name: pos.name, speed: pos.speed });
            }
            return ships;
        },
        // Raw livePositions map for debugging
        rawCache: () => livePositions,
        cacheSize: () => livePositions.size,
        navySet: () => Array.from(NAVY_MMSI_SET),
        traffic: () => getAllLiveTraffic(),
        staticSample: () => lastStaticSample,
        staticFor: (mmsi: string) => staticByMmsi.get(mmsi),
        // Check first data callback state
        firstDataState: () => ({ firstDataReceived, hasCallback: !!onFirstDataCallback }),
    };
}

/**
 * Retourne la liste des navires militaires français avec positions.
 * Cherche dans TOUTES les données AIS reçues globalement (pas de restriction géographique).
 * Priorité : position AIS live → position port d'attache (statique après 10 min sans données).
 */
export function getMilitaryShips(): MilitaryShip[] {
    const now = Date.now();
    const AIS_MAX_AGE = 10 * 60 * 1000; // 10 minutes - repli vers port d'attache si pas de données

    return FRENCH_NAVY_SHIPS.map(ship => {
        const live = ship.mmsi ? livePositions.get(ship.mmsi) : undefined;
        const isLive = live != null && (now - live.ts) < AIS_MAX_AGE;

        return {
            id: ship.id,
            name: ship.name,
            type: ship.type,
            role: ship.role,
            mmsi: ship.mmsi,
            lat: isLive ? live!.lat : ship.homeLat,
            lon: isLive ? live!.lon : ship.homeLon,
            speed: isLive ? live!.speed : 0,
            heading: isLive ? live!.heading : 0,
            port: ship.port,
            lastSeen: isLive ? live!.ts : undefined,
            isLive,
        };
    });
}

/**
 * Retourne l'intégralité du trafic AIS reçu (tous navires, pas seulement Marine Nationale).
 * Utilisé pour la détection de menaces sur les câbles sous-marins.
 *
 * @param maxAgeMs - Age max des données en ms (défaut: 10 min). Les données plus anciennes sont exclues.
 * @returns Liste de tous les navires avec positions récentes
 */
export function getAllLiveTraffic(maxAgeMs: number = 10 * 60 * 1000): MilitaryShip[] {
    const now = Date.now();
    const ships: MilitaryShip[] = [];

    for (const [mmsi, pos] of livePositions) {
        // Exclure les données périmées
        if ((now - pos.ts) > maxAgeMs) continue;

        const staticData = staticByMmsi.get(mmsi);
        // Vérifier si c'est un navire Marine Nationale connu
        const navyShip = FRENCH_NAVY_SHIPS.find(s => s.mmsi === mmsi);
        const resolvedShipType = pos.shipType ?? staticData?.shipType;
        const resolvedName = pos.name ?? staticData?.name;
        const resolvedDestination = pos.destination ?? staticData?.destination;
        const resolvedCallSign = staticData?.callSign;
        const resolvedImoNumber = staticData?.imoNumber;
        const resolvedDraught = staticData?.draught;
        const resolvedDimensions = staticData?.dimensions;
        const resolvedEta = staticData?.eta;

        ships.push({
            id: navyShip?.id ?? `ais-${mmsi}`,
            name: navyShip?.name ?? resolvedName ?? `Unknown (${mmsi})`,
            type: navyShip?.type ?? getShipTypeLabel(resolvedShipType),
            role: navyShip?.role ?? 'Civil/Inconnu',
            mmsi,
            lat: pos.lat,
            lon: pos.lon,
            speed: pos.speed,
            heading: pos.heading,
            cog: pos.cog,
            navStatus: pos.navStatus,
            callSign: resolvedCallSign,
            imoNumber: resolvedImoNumber,
            draught: resolvedDraught,
            dimensions: resolvedDimensions,
            eta: resolvedEta,
            port: navyShip?.port,
            lastSeen: pos.ts,
            isLive: true,
            shipType: resolvedShipType,
            destination: resolvedDestination,
            country: pos.country,
            trail: shipTrails.get(mmsi) ? [...shipTrails.get(mmsi)!] : undefined,
        });
    }

    return ships;
}

/**
 * Convertit le code type AIS en label lisible
 */
function getShipTypeLabel(shipType?: number): string {
    if (shipType == null) return 'Inconnu';

    // Codes AIS standards (simplifié)
    if (shipType >= 70 && shipType <= 79) return 'Cargo';
    if (shipType >= 80 && shipType <= 89) return 'Tanker';
    if (shipType >= 60 && shipType <= 69) return 'Passagers';
    if (shipType >= 40 && shipType <= 49) return 'Pêche';
    if (shipType >= 50 && shipType <= 59) return 'Plaisance';
    if (shipType >= 30 && shipType <= 39) return 'Remorqueur/Spécial';
    if (shipType >= 20 && shipType <= 29) return 'Wing in Ground';
    if (shipType === 35) return 'Militaire';
    if (shipType === 55) return 'Police/SAR';

    return `Type ${shipType}`;
}
