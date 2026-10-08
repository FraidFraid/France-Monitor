// Avions civils sur la carte (retour utilisateur du 03/10 : « trafic aérien flou ») : icônes nettes à tous les zooms, plus de densité ;
// positions animées entre deux relevés seulement à partir du zoom 7 (sous ce zoom, posées à chaque relevé, aucune boucle par image).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AirTrafficFlight, MapViewState } from '../types/index.ts';
import { DeckGLMap } from './DeckGLMap.ts';
import { airFlightTooltipHtml } from './deckgl/traffic-map.ts';
import { NBSP } from './layer-panel/format.ts';
import { TRAFFIC_NEUTRAL_HEX } from './layer-panel/traffic-legend.ts';

interface IconDef { url: string }
interface DeckLayerLike { id: string; props: { visible?: boolean; getIcon?: (d: AirTrafficFlight) => IconDef } }

const flight = (over: Partial<AirTrafficFlight> = {}): AirTrafficFlight => ({
  id: 'f1', callsign: 'EZY123', longitude: 2.35, latitude: 48.85, altitude: 32000, speed: 440, heading: 90, source: 'opensky', ...over,
});

function deckAt(zoom: number, airOn = true): DeckGLMap {
  const deckMap = new DeckGLMap({} as HTMLElement);
  const view = Reflect.get(deckMap, 'viewState') as MapViewState;
  Reflect.set(deckMap, 'viewState', { ...view, zoom });
  Reflect.set(deckMap, 'airTrafficVisible', airOn);
  Reflect.set(deckMap, 'map', { triggerRepaint: vi.fn() });
  return deckMap;
}

function airIconLayer(deckMap: DeckGLMap): DeckLayerLike | undefined {
  const build = Reflect.get(deckMap, 'buildAisLayers') as () => DeckLayerLike[];
  return build.call(deckMap).find((l) => l.id === 'deck-air-traffic');
}

describe('avions civils : icônes à tous les zooms, animation seulement à partir du zoom 7', () => {
  let raf: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    raf = vi.fn(() => 1);
    vi.stubGlobal('requestAnimationFrame', raf);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('couche aérienne active : la couche d’icônes est visible au zoom 5 comme au zoom 9 ; éteinte : masquée', () => {
    for (const zoom of [5, 9]) {
      const deckMap = deckAt(zoom);
      deckMap.updateAirTraffic([flight()]);
      expect(airIconLayer(deckMap)?.props.visible).toBe(true);
    }
    expect(airIconLayer(deckAt(5, false))?.props.visible).toBe(false);
  });

  it('icône d’un avion colorée selon son altitude (tranches d’avant la tâche 15), une icône par couleur ; altitude dans l’infobulle', () => {
    const deckMap = deckAt(9);
    deckMap.updateAirTraffic([flight()]);
    const getIcon = airIconLayer(deckMap)?.props.getIcon;
    if (!getIcon) throw new Error('couche d’icônes des avions sans getIcon');
    const fill = (altitude: number): string => decodeURIComponent(getIcon(flight({ altitude })).url);
    const cases: Array<[number, string]> = [
      [4_999, '#ff7832'], [5_000, '#ffd232'], [15_000, '#82e650'], [25_000, '#32c8ff'], [35_000, '#8264ff'], [0, TRAFFIC_NEUTRAL_HEX],
    ];
    for (const [altitude, hex] of cases) expect(fill(altitude)).toContain(`fill="${hex}"`);
    expect(getIcon(flight({ altitude: 6_000 }))).toBe(getIcon(flight({ altitude: 14_000 })));
    expect(airFlightTooltipHtml(flight({ altitude: 32_000 }))).toContain(`32\u202F000${NBSP}ft`);
  });

  it('zoom 5 : nouveau relevé posé d’un coup, aucune boucle d’animation ; zoom 8 : animation lancée', () => {
    const low = deckAt(5);
    low.updateAirTraffic([flight()]);
    low.updateAirTraffic([flight({ longitude: 2.4 })]);
    expect(raf).not.toHaveBeenCalled();
    expect(Reflect.get(low, 'civilAirTweenProgress')).toBe(1);
    expect(Reflect.get(low, 'civilAirAnimFrame')).toBeNull();

    const high = deckAt(8);
    high.updateAirTraffic([flight()]);
    expect(raf).not.toHaveBeenCalled(); // premier relevé : jamais d'animation
    high.updateAirTraffic([flight({ longitude: 2.4 })]);
    expect(raf).toHaveBeenCalledTimes(1);
    expect(Reflect.get(high, 'civilAirTweenProgress')).toBe(0);
  });
});
