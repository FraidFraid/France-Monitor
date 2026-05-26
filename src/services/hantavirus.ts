import {
  HANTAVIRUS_HISTORICAL_DEPARTMENTS,
  HANTAVIRUS_HISTORICAL_REFERENCE,
  HANTAVIRUS_HISTORICAL_REGIONS,
  HANTAVIRUS_NAVIRES,
  HANTAVIRUS_REFERENCE_FACILITIES,
  resolveHantavirusTerritoryCenter,
} from '../config/hantavirus.ts';
import type {
  HantavirusContactGeo,
  HantavirusEvent,
  HantavirusSituationSnapshot,
  HantavirusSource,
  HeatmapPoint,
} from '../types/index.ts';

export const DGS_URGENT_INDEX_URL =
  'https://sante.gouv.fr/ministere/informations-pratiques/site/dgs-urgent';

const PDF_LINK_RE = /href="([^"]+\.pdf[^"]*)"/gi;

const SEVERITY_WEIGHTS: Record<HantavirusEvent['severite'], number> = {
  info: 0.8,
  surveillance: 1.8,
  alerte: 4,
  crise: 8,
};

const SOURCE_RANK: Record<HantavirusSource, number> = {
  WHO: 100,
  ECDC: 95,
  INFO_GOUV: 95,
  'DGS-URGENT': 90,
  'DGS-AUTO': 90,
  SPF: 90,
  ANRS: 85,
  ARS: 85,
  Reuters: 75,
  AFP: 75,
  MediaValidated: 65,
  LocalMedia: 55,
};

const OFFICIAL_SOURCE_LABELS: Partial<Record<HantavirusSource, string>> = {
  WHO: 'OMS',
  ECDC: 'ECDC',
  INFO_GOUV: 'info.gouv.fr',
  'DGS-URGENT': 'DGS-Urgent',
  'DGS-AUTO': 'DGS-Urgent',
  SPF: 'Santé publique France',
  ANRS: 'ANRS MIE',
  ARS: 'ARS',
  Reuters: 'Reuters',
  AFP: 'AFP',
  MediaValidated: 'Veille OSINT validée',
  LocalMedia: 'Presse locale',
};

const HONDIUS_SNAPSHOT_URLS = [
  'https://www.info.gouv.fr/actualite/hantavirus-le-point-sur-les-mesures-sanitaires-en-france',
  'https://www.who.int/emergencies/disease-outbreak-news/item/2026-DON601',
  'https://www.ecdc.europa.eu/en/infectious-disease-topics/hantavirus-infection/surveillance-and-updates/andes-hantavirus-outbreak',
];

function stableIdFragment(input: string): string {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function nowIso(): string {
  return new Date().toISOString();
}

function createContactGeo(overrides: Partial<HantavirusContactGeo> = {}): HantavirusContactGeo {
  return {
    locationType: 'unknown',
    precision: 'country',
    publicationStatus: 'not_public',
    privacyMode: 'hide',
    ...overrides,
  };
}

export function shouldDisplayContactCity(signal: HantavirusContactGeo | undefined): boolean {
  if (!signal?.publicLocationLabel) return false;
  return signal.publicationStatus === 'official'
    || (signal.publicationStatus === 'media'
      && signal.locationType !== 'residence'
      && signal.privacyMode === 'show_city');
}

export function getHantavirusPublicLocationLabel(event: HantavirusEvent): string | null {
  if (event.kind !== 'contact_case' && event.kind !== 'confirmed_case' && event.kind !== 'probable_case') {
    return null;
  }

  if (!event.contactGeo) return null;
  if (shouldDisplayContactCity(event.contactGeo)) {
    return event.contactGeo.publicLocationLabel ?? null;
  }

  if (event.contactGeo.precision === 'department') return event.contactGeo.publicLocationLabel ?? null;
  if (event.contactGeo.precision === 'region') return event.contactGeo.publicLocationLabel ?? null;
  return null;
}

export function getSourceRank(source: HantavirusSource): number {
  return SOURCE_RANK[source] ?? 20;
}

function getSourceLabel(source: HantavirusSource): string {
  return OFFICIAL_SOURCE_LABELS[source] ?? source;
}

export function buildHantavirusSituationSnapshot(): HantavirusSituationSnapshot {
  return {
    asOf: '2026-05-21T00:00:00.000Z',
    activeCluster: 'MV_HONDIUS',
    franceConfirmedCases: 1,
    franceContactsMonitored: 25,
    globalConfirmed: 11,
    globalProbable: 2,
    globalInconclusive: 1,
    deaths: 3,
    riskGeneralPopulation: 'low',
    sourceUrls: [
      'https://invs.santepubliquefrance.fr/index.php/hantavirus/donnees',
      ...HONDIUS_SNAPSHOT_URLS,
    ],
    narrative: [
      'Cluster actif : MV Hondius, souche Andes.',
      'France : 1 cas confirmé et 25 cas contacts suivis.',
      'Population générale : risque faible selon l’OMS et l’ECDC.',
      'Transmission interhumaine documentée uniquement dans des contextes de contact étroit et prolongé.',
      'Les zones historiques SPF relèvent d’un contexte métropolitain distinct et ne sont pas liées au cluster Andes.',
    ],
  };
}

export function buildSeedHondiusClusterEvents(): HantavirusEvent[] {
  const lastCheckedAt = nowIso();

  return [
    {
      id: 'hanta-cluster-hondius',
      source: 'WHO',
      sourceLabel: getSourceLabel('WHO'),
      sourceRank: getSourceRank('WHO'),
      type: 'cluster',
      kind: 'ship_cluster',
      evidenceLevel: 'official_confirmed',
      validationStatus: 'validated',
      activeContext: 'andes_active_cluster',
      clusterId: 'MV_HONDIUS',
      souche: 'Andes',
      territoire_niveau: 'navire',
      territoire_code: 'SHIP-MV-HONDIUS',
      label: 'Cluster actif MV Hondius — Andes',
      date_debut: '2026-05-03',
      severite: 'crise',
      commentaires: 'Cluster confirmé par l’OMS. À distinguer des zones historiques françaises.',
      reportedCounts: { confirmed: 11, probable: 2, deaths: 3 },
      lastCheckedAt,
      url_sources: [
        'https://www.who.int/emergencies/disease-outbreak-news/item/2026-DON601',
      ],
    },
    {
      id: 'hanta-ref-bichat',
      source: 'MediaValidated',
      sourceLabel: getSourceLabel('MediaValidated'),
      sourceRank: getSourceRank('MediaValidated'),
      type: 'cluster',
      kind: 'hospital_monitoring',
      evidenceLevel: 'media_unverified',
      validationStatus: 'needs_review',
      activeContext: 'andes_active_cluster',
      clusterId: 'MV_HONDIUS',
      souche: 'Andes',
      territoire_niveau: 'etablissement',
      territoire_code: 'HOP-BICHAT',
      label: 'Hôpital de référence — Bichat',
      date_debut: '2026-05-10',
      severite: 'surveillance',
      commentaires: 'Veille hospitalière pour cas suspects ou rapatriés. Ne représente pas un cas confirmé.',
      contactGeo: createContactGeo({
        publicLocationLabel: 'Paris',
        locationType: 'hospital',
        precision: 'city',
        publicationStatus: 'media',
        privacyMode: 'show_city',
      }),
      lastCheckedAt,
      url_sources: ['https://fr.euronews.com/sante/2026/05/11/hantavirus-une-passagere-francaise-du-paquebot-mv-hondius-testee-positive'],
    },
    {
      id: 'hanta-ref-pitie',
      source: 'MediaValidated',
      sourceLabel: getSourceLabel('MediaValidated'),
      sourceRank: getSourceRank('MediaValidated'),
      type: 'cluster',
      kind: 'hospital_monitoring',
      evidenceLevel: 'media_unverified',
      validationStatus: 'needs_review',
      activeContext: 'andes_active_cluster',
      clusterId: 'MV_HONDIUS',
      souche: 'Andes',
      territoire_niveau: 'etablissement',
      territoire_code: 'HOP-PITIE-SALPETRIERE',
      label: 'Hôpital de référence — Pitié-Salpêtrière',
      date_debut: '2026-05-10',
      severite: 'surveillance',
      commentaires: 'Hôpital de repli cité dans la veille. Ne représente pas un cas confirmé.',
      contactGeo: createContactGeo({
        publicLocationLabel: 'Paris',
        locationType: 'hospital',
        precision: 'city',
        publicationStatus: 'media',
        privacyMode: 'show_city',
      }),
      lastCheckedAt,
      url_sources: ['https://fr.euronews.com/sante/2026/05/11/hantavirus-une-passagere-francaise-du-paquebot-mv-hondius-testee-positive'],
    },
    {
      id: 'hanta-idf-confirmed-case',
      source: 'DGS-URGENT',
      sourceLabel: getSourceLabel('DGS-URGENT'),
      sourceRank: getSourceRank('DGS-URGENT'),
      type: 'cluster',
      kind: 'confirmed_case',
      evidenceLevel: 'official_confirmed',
      validationStatus: 'validated',
      activeContext: 'andes_active_cluster',
      clusterId: 'MV_HONDIUS',
      souche: 'Andes',
      territoire_niveau: 'region',
      territoire_code: 'REG-11',
      label: 'Cas confirmé pris en charge en Île-de-France',
      date_debut: '2026-05-11',
      severite: 'crise',
      commentaires: 'Premier cas confirmé en France lié au cluster MV Hondius. La source officielle publie une prise en charge en établissement de référence en Île-de-France, sans nommer l’hôpital.',
      contactGeo: createContactGeo({
        publicLocationLabel: 'Île-de-France',
        locationType: 'hospital',
        precision: 'region',
        publicationStatus: 'official',
        privacyMode: 'aggregate_department',
      }),
      reportedCounts: { confirmed: 1, contacts: 25 },
      lastCheckedAt,
      url_sources: [
        'https://peps.sante.gouv.fr/actu/2026/26_point-hantavirus-n08_11052026.pdf',
      ],
    },
    {
      id: 'hanta-france-contact-monitoring',
      source: 'INFO_GOUV',
      sourceLabel: getSourceLabel('INFO_GOUV'),
      sourceRank: getSourceRank('INFO_GOUV'),
      type: 'cluster',
      kind: 'contact_case',
      evidenceLevel: 'official_monitoring',
      validationStatus: 'validated',
      activeContext: 'andes_active_cluster',
      clusterId: 'MV_HONDIUS',
      souche: 'Andes',
      territoire_niveau: 'pays',
      territoire_code: 'FR',
      label: 'Contacts suivis — France',
      date_debut: '2026-05-12',
      severite: 'surveillance',
      commentaires: 'Suivi sanitaire national des cas contacts. Granularité volontairement agrégée pour préserver la confidentialité.',
      contactGeo: createContactGeo({
        publicLocationLabel: 'France',
        locationType: 'unknown',
        precision: 'country',
        publicationStatus: 'official',
        privacyMode: 'hide',
      }),
      reportedCounts: { contacts: 25 },
      lastCheckedAt,
      url_sources: [
        'https://www.info.gouv.fr/actualite/hantavirus-le-point-sur-les-mesures-sanitaires-en-france',
      ],
    },
  ];
}

export function buildHistoricalHantavirusRiskEvents(referenceDate: string): HantavirusEvent[] {
  void referenceDate;
  const date_debut = HANTAVIRUS_HISTORICAL_REFERENCE.circulationPeriodStart;
  const date_fin = HANTAVIRUS_HISTORICAL_REFERENCE.circulationPeriodEnd;
  const lastCheckedAt = nowIso();
  const commentaires =
    `Contexte historique SPF ${HANTAVIRUS_HISTORICAL_REFERENCE.circulationPeriodStart.slice(0, 4)}-${HANTAVIRUS_HISTORICAL_REFERENCE.circulationPeriodEnd.slice(0, 4)}. Non lié au cluster Andes 2026.`;

  const departmentEvents: HantavirusEvent[] = Object.values(HANTAVIRUS_HISTORICAL_DEPARTMENTS).map((department) => ({
    id: `hanta-zone-${department.code.toLowerCase()}`,
    source: 'SPF',
    sourceLabel: getSourceLabel('SPF'),
    sourceRank: getSourceRank('SPF'),
    type: 'zone_historique',
    kind: 'historical_risk_zone',
    evidenceLevel: 'official_historical',
    validationStatus: 'validated',
    activeContext: 'historical_france_context',
    clusterId: 'none',
    souche: 'autre',
    territoire_niveau: 'departement',
    territoire_code: department.code,
    label: `Zone historique hantavirus - ${department.name}`,
    date_debut,
    date_fin,
    severite: department.risk === 'historic' ? 'surveillance' : 'info',
    commentaires,
    lastCheckedAt,
    url_sources: [HANTAVIRUS_HISTORICAL_REFERENCE.sourceUrl],
  }));

  const regionEvents: HantavirusEvent[] = Object.values(HANTAVIRUS_HISTORICAL_REGIONS).map((region) => ({
    id: `hanta-zone-${region.code.toLowerCase()}`,
    source: 'SPF',
    sourceLabel: getSourceLabel('SPF'),
    sourceRank: getSourceRank('SPF'),
    type: 'zone_historique',
    kind: 'historical_risk_zone',
    evidenceLevel: 'official_historical',
    validationStatus: 'validated',
    activeContext: 'historical_france_context',
    clusterId: 'none',
    souche: 'autre',
    territoire_niveau: 'region',
    territoire_code: region.code,
    label: `Zone historique elargie - ${region.name}`,
    date_debut,
    date_fin,
    severite: 'info',
    commentaires: 'Couche régionale d’appoint pour le contexte historique SPF. Non liée au cluster Andes.',
    lastCheckedAt,
    url_sources: [HANTAVIRUS_HISTORICAL_REFERENCE.sourceUrl],
  }));

  return [...departmentEvents, ...regionEvents];
}

export function computeHantavirusWeight(event: HantavirusEvent): number {
  const severityWeight = SEVERITY_WEIGHTS[event.severite];
  if (event.kind === 'ship_cluster' || event.kind === 'confirmed_case' || event.kind === 'probable_case') {
    return severityWeight * 2.8;
  }
  if (event.kind === 'contact_case' || event.kind === 'hospital_monitoring') {
    return severityWeight * 1.35;
  }
  return severityWeight * 0.9;
}

export function buildHantavirusHeatmapPoints(events: HantavirusEvent[]): HeatmapPoint[] {
  const points: HeatmapPoint[] = [];

  for (const event of events) {
    if (event.kind === 'contact_case' && event.territoire_niveau === 'pays') continue;
    if (event.territoire_code === 'HOP-IHU-MARSEILLE') continue;
    if (/marseille/i.test(event.label)) continue;
    const center = resolveHantavirusTerritoryCenter(event.territoire_code);
    if (!center) continue;

    points.push({
      eventId: event.id,
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
  const mentionsShip = normalized.includes('navire') || normalized.includes('paquebot') || mentionsHondius;
  const mentionsBichat = normalized.includes('bichat');
  const mentionsContact = normalized.includes('cas contact') || normalized.includes('contact');

  return {
    id: `dgs-hantavirus-${stableIdFragment(sourceUrl)}`,
    source: 'DGS-URGENT',
    sourceLabel: getSourceLabel('DGS-URGENT'),
    sourceRank: getSourceRank('DGS-URGENT'),
    type: 'cluster',
    kind: mentionsContact ? 'contact_case' : (mentionsShip ? 'ship_cluster' : (mentionsBichat ? 'hospital_monitoring' : 'probable_case')),
    evidenceLevel: 'official_monitoring',
    validationStatus: 'needs_review',
    activeContext: mentionsAndes || mentionsShip ? 'andes_active_cluster' : 'historical_france_context',
    clusterId: mentionsAndes || mentionsShip ? 'MV_HONDIUS' : 'none',
    souche: mentionsAndes ? 'Andes' : 'autre',
    territoire_niveau: mentionsShip ? 'navire' : (mentionsBichat ? 'etablissement' : 'pays'),
    territoire_code: mentionsShip ? 'SHIP-MV-HONDIUS' : (mentionsBichat ? 'HOP-BICHAT' : 'FR'),
    label: mentionsShip
      ? 'DGS-Urgent - cluster hantavirus associe a un navire'
      : (mentionsContact ? 'DGS-Urgent - suivi de contacts hantavirus' : 'DGS-Urgent - signal hantavirus'),
    date_debut: new Date().toISOString().slice(0, 10),
    severite: mentionsAndes ? 'crise' : 'alerte',
    commentaires: 'Signal auto-extrait de DGS-Urgent. Validation manuelle requise.',
    lastCheckedAt: nowIso(),
    url_sources: [sourceUrl],
  };
}

export function buildHantavirusDedupKey(event: HantavirusEvent): string {
  return [
    event.kind,
    event.souche ?? 'na',
    event.territoire_code,
    event.date_debut?.slice(0, 10) ?? 'na',
  ].join('|').toLowerCase();
}

export function mergeHantavirusEvents(primary: HantavirusEvent, duplicate: HantavirusEvent): HantavirusEvent {
  const mergedUrls = [...new Set([...primary.url_sources, ...duplicate.url_sources])];
  const primaryCounts = primary.reportedCounts ?? {};
  const duplicateCounts = duplicate.reportedCounts ?? {};
  return {
    ...primary,
    sourceRank: Math.max(primary.sourceRank, duplicate.sourceRank),
    source: primary.sourceRank >= duplicate.sourceRank ? primary.source : duplicate.source,
    sourceLabel: primary.sourceRank >= duplicate.sourceRank ? primary.sourceLabel : duplicate.sourceLabel,
    evidenceLevel: primary.evidenceLevel === 'official_confirmed' || duplicate.evidenceLevel !== 'official_confirmed'
      ? primary.evidenceLevel
      : duplicate.evidenceLevel,
    validationStatus: primary.validationStatus === 'validated' || duplicate.validationStatus !== 'validated'
      ? primary.validationStatus
      : duplicate.validationStatus,
    severite: computeMergedSeverity(primary.severite, duplicate.severite),
    reportedCounts: {
      confirmed: Math.max(primaryCounts.confirmed ?? 0, duplicateCounts.confirmed ?? 0) || undefined,
      probable: Math.max(primaryCounts.probable ?? 0, duplicateCounts.probable ?? 0) || undefined,
      contacts: Math.max(primaryCounts.contacts ?? 0, duplicateCounts.contacts ?? 0) || undefined,
      deaths: Math.max(primaryCounts.deaths ?? 0, duplicateCounts.deaths ?? 0) || undefined,
    },
    lastCheckedAt: nowIso(),
    url_sources: mergedUrls,
  };
}

function computeMergedSeverity(a: HantavirusEvent['severite'], b: HantavirusEvent['severite']): HantavirusEvent['severite'] {
  const rank: Record<HantavirusEvent['severite'], number> = {
    info: 1,
    surveillance: 2,
    alerte: 3,
    crise: 4,
  };
  return rank[a] >= rank[b] ? a : b;
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
