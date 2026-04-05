export interface HydroStationBinding {
  assetId: string;
  distanceKm: number;
  maxStations?: number;
  preferredStationCodes?: string[];
  riverNames?: string[];
  note?: string;
}

/**
 * Mapping maintenable entre les actifs hydro critiques et les stations Hub'Eau
 * les plus pertinentes. Quand les codes exacts ne sont pas figés, on conserve
 * un cadrage explicite par bassin/cours d'eau + rayon de recherche.
 */
export const HYDRO_STATION_BINDINGS: Record<string, HydroStationBinding> = {
  'hyd-grand-maison': {
    assetId: 'hyd-grand-maison',
    distanceKm: 30,
    maxStations: 2,
    riverNames: ["Eau d'Olle", 'Romanche', 'Isère'],
    note: 'Proxy bassin Oisans/Maurienne ; pas de télémesure ouvrage.',
  },
  'hyd-super-bissorte': {
    assetId: 'hyd-super-bissorte',
    distanceKm: 26,
    maxStations: 2,
    riverNames: ['Arc'],
    note: 'Appui hydrométrique par stations de vallée amont/aval.',
  },
  'hyd-la-coche': {
    assetId: 'hyd-la-coche',
    distanceKm: 24,
    maxStations: 2,
    riverNames: ['Isère'],
  },
  'hyd-roselend-la-bathie': {
    assetId: 'hyd-roselend-la-bathie',
    distanceKm: 28,
    maxStations: 2,
    riverNames: ['Doron de Beaufort', 'Isère'],
  },
  'hyd-genissiat': {
    assetId: 'hyd-genissiat',
    distanceKm: 24,
    maxStations: 2,
    preferredStationCodes: ['V100001001', 'V100001002'],
    riverNames: ['Rhône'],
  },
  'hyd-monteynard-avignonet': {
    assetId: 'hyd-monteynard-avignonet',
    distanceKm: 28,
    maxStations: 2,
    riverNames: ['Drac', 'Romanche'],
  },
  'hyd-vouglans': {
    assetId: 'hyd-vouglans',
    distanceKm: 26,
    maxStations: 2,
    riverNames: ['Ain'],
  },
  'hyd-revin': {
    assetId: 'hyd-revin',
    distanceKm: 24,
    maxStations: 2,
    riverNames: ['Meuse'],
  },
  'hyd-serre-poncon': {
    assetId: 'hyd-serre-poncon',
    distanceKm: 36,
    maxStations: 3,
    riverNames: ['Durance', 'Ubaye'],
    note: 'Stations de bassin Durance amont pour appui OSINT.',
  },
  'hyd-bort': {
    assetId: 'hyd-bort',
    distanceKm: 24,
    maxStations: 2,
    riverNames: ['Dordogne'],
  },
  'hyd-aigle': {
    assetId: 'hyd-aigle',
    distanceKm: 24,
    maxStations: 2,
    riverNames: ['Dordogne'],
  },
  'hyd-sarrans': {
    assetId: 'hyd-sarrans',
    distanceKm: 28,
    maxStations: 2,
    riverNames: ['Truyère'],
  },
  'hyd-grandval': {
    assetId: 'hyd-grandval',
    distanceKm: 28,
    maxStations: 2,
    riverNames: ['Truyère'],
  },
  'hyd-montezic': {
    assetId: 'hyd-montezic',
    distanceKm: 30,
    maxStations: 2,
    riverNames: ['Truyère', 'Lot'],
  },
  'hyd-mareges-saint-pierre': {
    assetId: 'hyd-mareges-saint-pierre',
    distanceKm: 24,
    maxStations: 2,
    riverNames: ['Dordogne'],
  },
  'hyd-st-etienne-cantales': {
    assetId: 'hyd-st-etienne-cantales',
    distanceKm: 24,
    maxStations: 2,
    riverNames: ['Cère'],
  },
  'hyd-castillon': {
    assetId: 'hyd-castillon',
    distanceKm: 24,
    maxStations: 2,
    riverNames: ['Verdon'],
  },
  'hyd-le-pouget': {
    assetId: 'hyd-le-pouget',
    distanceKm: 26,
    maxStations: 2,
    riverNames: ['Tarn'],
  },
  'hyd-official-le-cheylas': {
    assetId: 'hyd-official-le-cheylas',
    distanceKm: 18,
    maxStations: 2,
    preferredStationCodes: ['W131001001', 'W131001002'],
    riverNames: ['Isère'],
  },
  'hyd-official-villarodin': {
    assetId: 'hyd-official-villarodin',
    distanceKm: 26,
    maxStations: 2,
    riverNames: ['Arc'],
  },
  'hyd-brommat': {
    assetId: 'hyd-brommat',
    distanceKm: 24,
    maxStations: 2,
    riverNames: ['Truyère'],
  },
  'hyd-petit-saut': {
    assetId: 'hyd-petit-saut',
    distanceKm: 40,
    maxStations: 2,
    riverNames: ['Sinnamary'],
    note: 'Couverture Hub’Eau potentiellement incomplète en Guyane ; fallback dérivé conservé.',
  },
  'hyd-sampolo': {
    assetId: 'hyd-sampolo',
    distanceKm: 24,
    maxStations: 1,
    riverNames: ['Travo'],
  },
  'hyd-tolla': {
    assetId: 'hyd-tolla',
    distanceKm: 24,
    maxStations: 1,
    riverNames: ['Prunelli'],
  },
  'hyd-calacuccia': {
    assetId: 'hyd-calacuccia',
    distanceKm: 24,
    maxStations: 1,
    riverNames: ['Golo'],
  },
};
