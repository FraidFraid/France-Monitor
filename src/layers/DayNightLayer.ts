/**
 * DayNightLayer.ts — Deck.gl v9 CompositeLayer pour l'ombre jour/nuit
 *
 * Sub-layers :
 *  1. PolygonLayer  — nuit      (<−18° : obscurité totale)
 *  2. PolygonLayer  — crépuscule astronomique (−12° à −18°)
 *  3. PolygonLayer  — crépuscule nautique     (−6° à −12°)
 *  4. PolygonLayer  — crépuscule civil        ( 0° à  −6°)
 *  5. ScatterplotLayer — position du Soleil
 *
 * Props :
 *  timestamp    : number   — ms UTC (default: Date.now())
 *  showTwilight : boolean  — active les 3 couches de crépuscule (default: true)
 *  showSunIcon  : boolean  — affiche le point subsolaire (default: true)
 *  resolution   : number   — pas en degrés de longitude (default: 1)
 */

import {
    CompositeLayer,
    type CompositeLayerProps,
    type LayersList,
    type DefaultProps,
} from '@deck.gl/core';
import { PolygonLayer, ScatterplotLayer } from '@deck.gl/layers';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface DayNightLayerProps extends CompositeLayerProps {
    /** Timestamp UTC en millisecondes (default: Date.now()) */
    timestamp?: number;
    /** Afficher la zone de nuit totale < −18° (default: true) */
    showNight?: boolean;
    /** Afficher les 3 zones de crépuscule (default: true) */
    showTwilight?: boolean;
    /** Afficher le point subsolaire (Soleil) (default: true) */
    showSunIcon?: boolean;
    /** Résolution : pas en degrés de longitude, 1 = max, 2 = rapide (default: 1) */
    resolution?: number;
}

// ── Constantes ─────────────────────────────────────────────────────────────────

const DEG = Math.PI / 180;

// RGBA pour chaque zone (alpha canal 0–255)
const NIGHT_COLOR:  [number, number, number, number] = [10,  14,  42,  140]; // bleu très sombre
const ASTRO_COLOR:  [number, number, number, number] = [18,  24,  60,  100];
const NAUT_COLOR:   [number, number, number, number] = [30,  40,  80,   80];
const CIVIL_COLOR:  [number, number, number, number] = [50,  60, 100,   55];
const SUN_COLOR:    [number, number, number, number] = [255, 220,  50,  230];

// ── Astronomie ─────────────────────────────────────────────────────────────────

/** Point subsolaire (précision ~0.01°) pour un timestamp en ms */
function subsolarPoint(tsMs: number): { lat: number; lon: number } {
    const JD     = tsMs / 86_400_000 + 2_440_587.5;
    const n      = JD - 2_451_545.0;

    const L      = (280.46 + 0.9856474 * n) % 360;
    const g      = ((357.528 + 0.9856003 * n) % 360) * DEG;
    const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;

    const epsilon = 23.439 * DEG;
    const lat     = Math.asin(Math.sin(epsilon) * Math.sin(lambda)) / DEG;

    const GMST    = (18.697375 + 24.065709824279 * n) % 24;
    const RA_deg  = Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda)) / DEG;
    const lon     = ((RA_deg - GMST * 15 + 540) % 360) - 180;

    return { lat, lon };
}

/**
 * Calcule la latitude du terminateur pour une élévation solaire donnée.
 *
 * Formule : sin(elev) = sin(φ)·sin(δ) + cos(φ)·cos(δ)·cos(H)
 * → a·sin(φ) + b·cos(φ) = c  avec  a = sin(δ), b = cos(δ)·cos(H), c = sin(elev)
 * → φ = arcsin(c / R) − atan2(b, a)  où  R = √(a²+b²)
 * Retourne NaN si pas de solution (soleil toujours au-dessus/dessous).
 */
function terminatorLat(
    lonDeg: number,
    sunLonDeg: number,
    sunLatDeg: number,
    elevDeg: number,
): number {
    const H    = (lonDeg - sunLonDeg) * DEG;
    const dec  = sunLatDeg * DEG;
    const elev = elevDeg  * DEG;

    const a    = Math.sin(dec);
    const b    = Math.cos(dec) * Math.cos(H);
    const c    = Math.sin(elev);
    const R    = Math.sqrt(a * a + b * b);

    if (Math.abs(c) > R) return NaN; // pas de solution
    return (Math.asin(c / R) - Math.atan2(b, a)) / DEG;
}

/**
 * Construit le ring [lon, lat][] du terminateur pour une élévation donnée.
 * Résolution : step en degrés de longitude.
 */
function buildTerminatorRing(
    sunLat: number,
    sunLon: number,
    elevDeg: number,
    step: number,
): [number, number][] {
    const pts: [number, number][] = [];
    for (let lon = -180; lon <= 180; lon += step) {
        const lat = terminatorLat(lon, sunLon, sunLat, elevDeg);
        if (Number.isFinite(lat)) {
            pts.push([lon, Math.max(-89.9, Math.min(89.9, lat))]);
        }
    }
    // Toujours inclure le dernier point à 180 pour fermer correctement
    if (pts.length > 0 && pts[pts.length - 1][0] < 180) {
        const lat = terminatorLat(180, sunLon, sunLat, elevDeg);
        if (Number.isFinite(lat)) {
            pts.push([180, Math.max(-89.9, Math.min(89.9, lat))]);
        }
    }
    return pts;
}

/**
 * Construit un polygone fermé représentant la zone où l'élévation solaire
 * est inférieure à elevDeg.
 *
 * Note sur le cap : pour obtenir l'intérieur "nuit", on doit fermer le
 * polygone par le pôle opposé au point subsolaire. Sinon, le fill englobe
 * la zone éclairée et l'overlay jour/nuit apparaît inversé.
 *   sunLat >= 0 (soleil en NH) → cap sud
 *   sunLat  < 0 (soleil en SH) → cap nord
 */
function buildNightPolygon(
    sunLat: number,
    sunLon: number,
    elevDeg: number,
    step: number,
): [number, number][] {
    const ring = buildTerminatorRing(sunLat, sunLon, elevDeg, step);
    if (ring.length < 2) {
        // Pas de terminateur visible → hémisphère entier dans la même zone
        return [[-180, -90], [180, -90], [180, 90], [-180, 90], [-180, -90]];
    }
    const cap: [number, number][] = sunLat >= 0
        ? [[180, -90], [-180, -90]]  // soleil en NH → cap sud
        : [[180, 90], [-180, 90]];   // soleil en SH → cap nord
    return [...ring, ...cap, ring[0]];
}

// ── CompositeLayer ─────────────────────────────────────────────────────────────

const defaultProps: DefaultProps<DayNightLayerProps> = {
    timestamp:    { type: 'number',  value: 0 },
    showNight:    { type: 'boolean', value: true },
    showTwilight: { type: 'boolean', value: true },
    showSunIcon:  { type: 'boolean', value: true },
    resolution:   { type: 'number',  value: 1 },
};

export class DayNightLayer extends CompositeLayer<DayNightLayerProps> {
    static layerName = 'DayNightLayer';
    static defaultProps = defaultProps;

    renderLayers(): LayersList {
        const {
            timestamp    = Date.now(),
            showNight    = true,
            showTwilight = true,
            showSunIcon  = true,
            resolution   = 1,
            visible      = true,
            opacity      = 1,
        } = this.props;

        const ts   = timestamp || Date.now();
        const step = Math.max(0.5, resolution);
        const id   = this.props.id ?? 'day-night';

        const { lat: sunLat, lon: sunLon } = subsolarPoint(ts);

        const baseProps = { visible, opacity, filled: true, stroked: false, pickable: false, getLineColor: [0, 0, 0, 0] as [number,number,number,number] };

        /**
         * Approche empilement (sans trous) :
         * On dessine du plus grand (zone la moins sombre) au plus petit (nuit totale).
         * Chaque polygone PLUS SOMBRE écrase le précédent → bandes propres sans artefact.
         *
         *  civil  (0°)  ← le plus grand
         *  nautique (−6°)
         *  astro   (−12°)
         *  nuit    (−18°) ← le plus petit / le plus sombre
         */

        const layers: LayersList = [];

        if (showTwilight) {
            // Crépuscule civil  : toute la zone où soleil < 0°
            const civilPoly = buildNightPolygon(sunLat, sunLon, 0, step);
            layers.push(new PolygonLayer({
                ...baseProps,
                id: `${id}-civil`,
                data: [civilPoly],
                getPolygon: (d: [number,number][]) => d,
                getFillColor: CIVIL_COLOR,
            }));

            // Crépuscule nautique : toute la zone où soleil < −6° (écrase civil)
            const nautPoly = buildNightPolygon(sunLat, sunLon, -6, step);
            layers.push(new PolygonLayer({
                ...baseProps,
                id: `${id}-nautical`,
                data: [nautPoly],
                getPolygon: (d: [number,number][]) => d,
                getFillColor: NAUT_COLOR,
            }));

            // Crépuscule astronomique : toute la zone où soleil < −12° (écrase nautique)
            const astroPoly = buildNightPolygon(sunLat, sunLon, -12, step);
            layers.push(new PolygonLayer({
                ...baseProps,
                id: `${id}-astro`,
                data: [astroPoly],
                getPolygon: (d: [number,number][]) => d,
                getFillColor: ASTRO_COLOR,
            }));
        }

        if (showNight) {
            // Nuit totale : zone où soleil < −18° (écrase tout le reste)
            const nightPoly = buildNightPolygon(sunLat, sunLon, -18, step);
            layers.push(new PolygonLayer({
                ...baseProps,
                id: `${id}-night`,
                data: [nightPoly],
                getPolygon: (d: [number,number][]) => d,
                getFillColor: NIGHT_COLOR,
            }));
        }

        if (showSunIcon) {
            layers.push(new ScatterplotLayer({
                visible,
                opacity,
                id: `${id}-sun`,
                data: [{ position: [sunLon, sunLat] as [number, number] }],
                getPosition: (d: { position: [number, number] }) => d.position,
                getRadius: 18,
                radiusUnits: 'pixels',
                getFillColor: SUN_COLOR,
                getLineColor: [255, 200, 0, 200] as [number,number,number,number],
                stroked: true,
                lineWidthMinPixels: 2,
                pickable: false,
            }));
        }

        return layers;
    }
}

/*
 * ── Exemple d'intégration dans DeckGLMap.ts ──────────────────────────────────
 *
 * import { DayNightLayer } from '../layers/DayNightLayer.ts';
 *
 * // Dans buildAisLayers(), ajouter en tête du tableau :
 * new DayNightLayer({
 *   id: 'day-night',
 *   timestamp: Date.now(),
 *   showTwilight: true,
 *   showSunIcon: true,
 *   resolution: 1,
 *   visible: this.layers.dayNight ?? false,
 *   opacity: 1,
 * }),
 *
 * // Rafraîchir toutes les minutes :
 * setInterval(() => this.refreshAisLayers(), 60_000);
 */
