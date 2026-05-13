import {
  HANTAVIRUS_HISTORICAL_DEPARTMENTS,
  HANTAVIRUS_HISTORICAL_REFERENCE,
  HANTAVIRUS_HISTORICAL_REGIONS,
  HANTAVIRUS_NAVIRES,
  HANTAVIRUS_REFERENCE_FACILITIES,
  resolveHantavirusTerritoryCenter,
} from '../config/hantavirus.ts';
import type { HantavirusEvent, HeatmapPoint } from '../types/index.ts';

export const DGS_URGENT_INDEX_URL =
  'https://sante.gouv.fr/ministere/informations-pratiques/site/dgs-urgent';

const PDF_LINK_RE = /href="([^"]+\.pdf[^"]*)"/gi;

const SEVERITY_WEIGHTS: Record<HantavirusEvent['severite'], number> = {
  info: 0.8,
  surveillance: 1.8,
  alerte: 4,
  crise: 8,
};

function stableIdFragment(input: string): string {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

export function buildSeedHondiusClusterEvents(): HantavirusEvent[] {
  return [
    {
      id: 'hanta-cluster-hondius',
      source: 'MediaValidated',
      type: 'cluster',
      souche: 'Andes',
      territoire_niveau: 'navire',
      territoire_code: 'SHIP-MV-HONDIUS',
      label: 'Cluster MV Hondius - cas importes Andes',
      date_debut: '2026-05-03',
      severite: 'crise',
      commentaires: 'Seed event for manual validation while DGS-Urgent parsing is being hardened.',
      url_sources: [
        'https://www.who.int/docs/default-source/coronaviruse/situation-reports/who-technical-note-for-the-disembarkation-and-onward-management-of-passengers-and-crew-in-the-context-of-an-andes-virus-associated-cluster-mv-hondius-cruise-ship.pdf?download=true&sfvrsn=56272a28_3',
      ],
    },
    {
      id: 'hanta-ref-bichat',
      source: 'MediaValidated',
      type: 'cluster',
      souche: 'Andes',
      territoire_niveau: 'etablissement',
      territoire_code: 'HOP-BICHAT',
      label: 'Hôpital de référence — Bichat',
      date_debut: '2026-05-10',
      severite: 'surveillance',
      commentaires: 'Hôpital de référence en veille pour cas rapatriés ou suspects. Aucun cas confirmé à ce stade.',
      url_sources: ['https://fr.euronews.com/sante/2026/05/11/hantavirus-une-passagere-francaise-du-paquebot-mv-hondius-testee-positive'],
    },
    {
      id: 'hanta-ref-pitie',
      source: 'MediaValidated',
      type: 'cluster',
      souche: 'Andes',
      territoire_niveau: 'etablissement',
      territoire_code: 'HOP-PITIE-SALPETRIERE',
      label: 'Hôpital de référence — Pitié-Salpêtrière',
      date_debut: '2026-05-10',
      severite: 'surveillance',
      commentaires: 'Hôpital de repli en Île-de-France. Aucun cas confirmé, mise en veille préventive.',
      url_sources: ['https://fr.euronews.com/sante/2026/05/11/hantavirus-une-passagere-francaise-du-paquebot-mv-hondius-testee-positive'],
    },
    {
      id: 'hanta-marseille-juan-les-pins',
      source: 'MediaValidated',
      type: 'cluster',
      souche: 'Andes',
      territoire_niveau: 'etablissement',
      territoire_code: 'HOP-IHU-MARSEILLE',
      label: 'Cas pris en charge a Marseille - origine Juan-les-Pins',
      date_debut: '2026-05-12',
      severite: 'crise',
      commentaires:
        "Premier cas importé confirmé en France. Passagère de Juan-les-Pins liée au cluster MV Hondius, prise en charge à l'IHU Méditerranée Infection. Confirmation institutionnelle disponible.",
      url_sources: [
        'https://www.cespharm.fr/prevention-sante/actualites/2026/alerte-internationale-cluster-de-cas-d-hantavirus',
        'https://www.nicemag.fr/article/7189/hantavirus-une-habitante-de-juan-les-pins-evacuee-vers-marseille-les-autorites-renforcent-les-quarantaines',
      ],
    },
  ];
}

export function buildHistoricalHantavirusRiskEvents(referenceDate: string): HantavirusEvent[] {
  void referenceDate;
  const date_debut = HANTAVIRUS_HISTORICAL_REFERENCE.circulationPeriodStart;
  const date_fin = HANTAVIRUS_HISTORICAL_REFERENCE.circulationPeriodEnd;
  const commentaires =
    `Zone historique de circulation documentee sur la periode ${HANTAVIRUS_HISTORICAL_REFERENCE.circulationPeriodStart.slice(0, 4)}-${HANTAVIRUS_HISTORICAL_REFERENCE.circulationPeriodEnd.slice(0, 4)}; derniere synthese de cas ${HANTAVIRUS_HISTORICAL_REFERENCE.latestCaseDataYear}.`;

  const departmentEvents = Object.values(HANTAVIRUS_HISTORICAL_DEPARTMENTS).map((department) => ({
    id: `hanta-zone-${department.code.toLowerCase()}`,
    source: 'SPF' as const,
    type: 'zone_historique' as const,
    souche: 'autre' as const,
    territoire_niveau: 'departement' as const,
    territoire_code: department.code,
    label: `Zone historique hantavirus - ${department.name}`,
    date_debut,
    date_fin,
    severite: department.risk === 'historic' ? 'surveillance' as const : 'info' as const,
    commentaires,
    url_sources: [HANTAVIRUS_HISTORICAL_REFERENCE.sourceUrl],
  }));

  const regionEvents = Object.values(HANTAVIRUS_HISTORICAL_REGIONS).map((region) => ({
    id: `hanta-zone-${region.code.toLowerCase()}`,
    source: 'SPF' as const,
    type: 'zone_historique' as const,
    souche: 'autre' as const,
    territoire_niveau: 'region' as const,
    territoire_code: region.code,
    label: `Zone historique elargie - ${region.name}`,
    date_debut,
    date_fin,
    severite: 'info' as const,
    commentaires: 'Regional overlay for low-resolution heatmap rendering.',
    url_sources: [HANTAVIRUS_HISTORICAL_REFERENCE.sourceUrl],
  }));

  return [...departmentEvents, ...regionEvents];
}

export function computeHantavirusWeight(event: HantavirusEvent): number {
  const severityWeight = SEVERITY_WEIGHTS[event.severite];
  if (event.type === 'cluster') return severityWeight * 2.5;
  return severityWeight * 0.9;
}

export function buildHantavirusHeatmapPoints(events: HantavirusEvent[]): HeatmapPoint[] {
  const points: HeatmapPoint[] = [];

  for (const event of events) {
    const center = resolveHantavirusTerritoryCenter(event.territoire_code);
    if (!center) continue;

    points.push({
      lon: center[0],
      lat: center[1],
      weight: computeHantavirusWeight(event),
      type: event.type,
      label: event.label,
    });
  }

  return points;
}

export function extractPdfLinksFromDgsUrgentIndex(html: string): string[] {
  const links = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = PDF_LINK_RE.exec(html)) !== null) {
    const href = match[1];
    if (!href) continue;
    const absoluteUrl = href.startsWith('http') ? href : `https://sante.gouv.fr${href.startsWith('/') ? '' : '/'}${href}`;
    links.add(absoluteUrl);
  }

  return [...links];
}

export function parseDgsUrgentTextToEvent(pdfText: string, sourceUrl: string): HantavirusEvent | null {
  const normalized = pdfText
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  if (!normalized.includes('hantavirus')) return null;

  const mentionsAndes = normalized.includes('andes');
  const mentionsHondius = normalized.includes('hondius');
  const mentionsShip = normalized.includes('navire') || mentionsHondius;
  const mentionsBichat = normalized.includes('bichat');

  return {
    id: `dgs-hantavirus-${stableIdFragment(sourceUrl)}`,
    source: 'DGS-URGENT',
    type: 'cluster',
    souche: mentionsAndes ? 'Andes' : 'autre',
    territoire_niveau: mentionsShip ? 'navire' : (mentionsBichat ? 'etablissement' : 'pays'),
    territoire_code: mentionsShip ? 'SHIP-MV-HONDIUS' : (mentionsBichat ? 'HOP-BICHAT' : 'FR'),
    label: mentionsShip
      ? 'DGS-Urgent - cluster hantavirus associe a un navire'
      : 'DGS-Urgent - signal hantavirus',
    date_debut: new Date().toISOString().slice(0, 10),
    severite: mentionsAndes ? 'crise' : 'alerte',
    commentaires: 'Auto-extracted from DGS-Urgent text. Manual validation required.',
    url_sources: [sourceUrl],
  };
}

export function buildDeckGlHeatmapLayerSnippet(sourceId = 'hantavirus-heatmap'): string {
  return [
    `new HeatmapLayer({`,
    `  id: '${sourceId}',`,
    `  data: heatmapPoints,`,
    `  getPosition: (d) => [d.lon, d.lat],`,
    `  getWeight: (d) => d.weight,`,
    `  radiusPixels: 40,`,
    `  intensity: 1,`,
    `  threshold: 0.05,`,
    `})`,
  ].join('\n');
}

export function buildMapLibreHeatmapLayerSnippet(sourceId = 'hantavirus'): string {
  return [
    `map.addSource('${sourceId}', {`,
    `  type: 'geojson',`,
    `  data: geojson,`,
    `});`,
    `map.addLayer({`,
    `  id: '${sourceId}-layer',`,
    `  type: 'heatmap',`,
    `  source: '${sourceId}',`,
    `  paint: {`,
    `    'heatmap-weight': ['get', 'weight'],`,
    `    'heatmap-intensity': 1.1,`,
    `    'heatmap-radius': 28,`,
    `    'heatmap-opacity': 0.8,`,
    `  },`,
    `});`,
  ].join('\n');
}

export const HANTAVIRUS_REFERENCE_INDEX = {
  departments: Object.keys(HANTAVIRUS_HISTORICAL_DEPARTMENTS),
  facilities: Object.keys(HANTAVIRUS_REFERENCE_FACILITIES),
  navires: Object.keys(HANTAVIRUS_NAVIRES),
};
