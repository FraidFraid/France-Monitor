import * as cheerio from 'cheerio';

import { fetchText, setCors } from '../_shared/health-utils.js';

const DGS_URGENT_INDEX_URL = 'https://sante.gouv.fr/ministere/informations-pratiques/site/dgs-urgent';
const SPF_HANTAVIRUS_URL = 'https://www.santepubliquefrance.fr/maladies-et-traumatismes/maladies-et-infections-respiratoires/hantavirus';
const SPF_HANTAVIRUS_DATA_URL = 'https://invs.santepubliquefrance.fr/index.php/hantavirus/donnees';
const PEPPS_HANTAVIRUS_INDEX_URL = 'https://peps.sante.gouv.fr/actu/actualites.html';

const HISTORICAL_REFERENCE = {
  sourceUrl: 'https://www.santepubliquefrance.fr/hantavirus/donnees',
  circulationPeriodStart: '2005-01-01',
  circulationPeriodEnd: '2023-12-31',
  latestCaseDataYear: 2024,
};

const HISTORICAL_DEPARTMENTS = {
  'DEP-08': { name: 'Ardennes', center: [4.72, 49.77], severity: 'surveillance' },
  'DEP-39': { name: 'Jura', center: [5.55, 46.67], severity: 'surveillance' },
  'DEP-54': { name: 'Meurthe-et-Moselle', center: [6.18, 48.69], severity: 'surveillance' },
  'DEP-55': { name: 'Meuse', center: [5.38, 49.16], severity: 'surveillance' },
  'DEP-57': { name: 'Moselle', center: [6.18, 49.12], severity: 'surveillance' },
  'DEP-67': { name: 'Bas-Rhin', center: [7.75, 48.57], severity: 'surveillance' },
  'DEP-68': { name: 'Haut-Rhin', center: [7.34, 47.75], severity: 'surveillance' },
  'DEP-70': { name: 'Haute-Saone', center: [6.15, 47.62], severity: 'surveillance' },
  'DEP-88': { name: 'Vosges', center: [6.45, 48.18], severity: 'surveillance' },
  'DEP-69': { name: 'Rhone', center: [4.84, 45.76], severity: 'info' },
};

const STATIC_POINTS = {
  FR: [2.2, 46.6],
  'REG-11': [2.6, 48.7],
  'SHIP-MV-HONDIUS': [-23.5, 16.9],
  'HOP-BICHAT': [2.3317, 48.8984],
  'HOP-PITIE-SALPETRIERE': [2.365, 48.838],
  'HOP-IHU-MARSEILLE': [5.3938, 43.2895],
};

const SOURCE_RANK = {
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

const SOURCE_LABEL = {
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

function nowIso() {
  return new Date().toISOString();
}

function stableIdFragment(input) {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function classifyDgsSignal(rawText) {
  const t = String(rawText || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

  if (!t.includes('hantavirus') && !t.includes('hanta')) return null;

  const mentions = {
    andes: /\bandes\b/.test(t),
    hondius: /hondius/.test(t),
    cas_confirme: /cas\s+confirm[e]/.test(t) || /confirm[e]\s+en\s+france/.test(t),
    cas_importe: /cas\s+import[e]/.test(t) || /import[e]\s+en\s+france/.test(t),
    urgence: /urgence|urgente|alerte\s+nationale|alerte\s+sanitaire/.test(t),
    deces: /d[e]c[e]s|mort[e]?\s+hanta/.test(t),
    france: /france|francai/.test(t),
    marseille: /marseille/.test(t),
    bichat: /bichat/.test(t),
    navire: /navire|paquebot|croisiere/.test(t),
    contact: /cas\s+contact|contact/.test(t),
  };

  if (mentions.deces || (mentions.cas_confirme && mentions.andes && mentions.france)) return { severity: 'crise', mentions };
  if (mentions.urgence || (mentions.andes && mentions.hondius)) return { severity: 'crise', mentions };
  if (mentions.cas_confirme || mentions.cas_importe) return { severity: 'alerte', mentions };
  if (mentions.andes || mentions.hondius || mentions.navire) return { severity: 'alerte', mentions };
  if (mentions.france) return { severity: 'surveillance', mentions };
  return { severity: 'info', mentions };
}

function extractPdfLinks(html) {
  const links = new Set();
  for (const match of String(html || '').matchAll(/href="([^"]+\.pdf[^"]*)"/gi)) {
    const href = match[1];
    const absoluteUrl = href.startsWith('http') ? href : `https://sante.gouv.fr${href.startsWith('/') ? '' : '/'}${href}`;
    links.add(absoluteUrl);
  }
  return [...links];
}

function weightForEvent(event) {
  const severityBase = { info: 0.8, surveillance: 1.8, alerte: 4, crise: 8 }[event.severite] || 1;
  if (event.kind === 'ship_cluster' || event.kind === 'confirmed_case' || event.kind === 'probable_case') return severityBase * 2.8;
  if (event.kind === 'contact_case' || event.kind === 'hospital_monitoring') return severityBase * 1.35;
  return severityBase * 0.9;
}

function pointForEvent(event) {
  if (event.kind === 'contact_case' && event.territoire_niveau === 'pays') return null;
  if (event.territoire_code === 'HOP-IHU-MARSEILLE') return null;
  if (/marseille/i.test(String(event.label || ''))) return null;
  const coords = STATIC_POINTS[event.territoire_code] || HISTORICAL_DEPARTMENTS[event.territoire_code]?.center || null;
  if (!coords) return null;
  return {
    eventId: event.id,
    lon: coords[0],
    lat: coords[1],
    weight: weightForEvent(event),
    type: event.type,
    label: event.label,
  };
}

function sourceRank(source) {
  return SOURCE_RANK[source] || 20;
}

function sourceLabel(source) {
  return SOURCE_LABEL[source] || source;
}

function normalizeDateCandidate(raw) {
  const match = String(raw || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!match) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function toIsoTimestamp(dateOnly) {
  return dateOnly ? `${dateOnly}T00:00:00.000Z` : null;
}

function maxDate(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return a >= b ? a : b;
}

function normalizeFrenchDate(raw) {
  const months = {
    janvier: '01',
    fevrier: '02',
    février: '02',
    mars: '03',
    avril: '04',
    mai: '05',
    juin: '06',
    juillet: '07',
    aout: '08',
    août: '08',
    septembre: '09',
    octobre: '10',
    novembre: '11',
    decembre: '12',
    décembre: '12',
  };

  const normalized = String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  const match = normalized.match(/(\d{1,2})\s+([a-z]+)\s+(\d{4})/);
  if (!match) return null;

  const month = months[match[2]];
  if (!month) return null;
  return `${match[3]}-${month}-${String(match[1]).padStart(2, '0')}`;
}

function inferFrenchDateWithFallbackYear(raw, fallbackYear) {
  const full = normalizeFrenchDate(raw);
  if (full) return full;

  const normalized = String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  const match = normalized.match(/(\d{1,2})\s+([a-z]+)/);
  if (!match || !fallbackYear) return null;

  return normalizeFrenchDate(`${match[1]} ${match[2]} ${fallbackYear}`);
}

function normalizePlainText(input) {
  return String(input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function absolutizePeppsUrl(href) {
  return new URL(href, 'https://peps.sante.gouv.fr/actu/').toString();
}

export function extractPeppsHantavirusSources(html) {
  const $ = cheerio.load(String(html || ''));
  const anchors = [];
  let capture = false;

  for (const node of $('body').find('h3, h4, p, blockquote').toArray()) {
    const tagName = node.tagName?.toLowerCase() || '';
    const text = $(node).text().replace(/\s+/g, ' ').trim();

    if (tagName === 'h3') {
      if (/^hantavirus$/i.test(text)) {
        capture = true;
        continue;
      }
      if (capture) break;
    }

    if (!capture) continue;

    $(node).find('a[href]').each((_idx, anchor) => {
      const href = $(anchor).attr('href');
      if (!href) return;

      const label = $(anchor).text().replace(/\s+/g, ' ').trim();
      if (!/hantavirus|minsante|mars|dgs-urgent|point de situation/i.test(label)) return;

      anchors.push({
        url: absolutizePeppsUrl(href),
        label,
        date: normalizeDateCandidate(label),
      });
    });
  }

  const uniqueEntries = [];
  const seen = new Set();
  for (const entry of anchors) {
    if (seen.has(entry.url)) continue;
    seen.add(entry.url);
    uniqueEntries.push(entry);
  }

  const latestDate = uniqueEntries.reduce((latest, entry) => maxDate(latest, entry.date), null);
  const pdfUrls = uniqueEntries
    .filter((entry) => /\.pdf(?:$|[?#])/i.test(entry.url))
    .map((entry) => entry.url);

  return {
    entries: uniqueEntries,
    latestDate,
    pdfUrls,
    sectionText: uniqueEntries.map((entry) => entry.label).join(' '),
  };
}

export function extractSpfSituationFromHtml(html) {
  const $ = cheerio.load(String(html || ''));
  const fullText = $('body').text().replace(/\s+/g, ' ').trim();

  const updatedRaw = $('time').filter((_idx, el) => {
    const text = $(el).text()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    return /mis a jour le|updated on/.test(text);
  }).first().text();
  const updatedDate = normalizeFrenchDate(updatedRaw) || normalizeDateCandidate(updatedRaw);

  const clusterHeading = $('h2').filter((_idx, el) => /cas d['’]hantavirus andes|cases of andes hantavirus/i.test($(el).text())).first();
  const clusterBlock = clusterHeading.length ? clusterHeading.parent().text().replace(/\s+/g, ' ').trim() : fullText;
  const normalizedClusterBlock = normalizePlainText(clusterBlock);

  const snapshotDateMatch = normalizedClusterBlock.match(/au\s+(\d{1,2}\s+[a-z]+)/i);
  const snapshotDate = inferFrenchDateWithFallbackYear(snapshotDateMatch?.[1] || '', updatedDate?.slice(0, 4)) || null;

  const globalConfirmedMatch = normalizedClusterBlock.match(/au\s+\d{1,2}\s+[a-z]+,?\s*(\d+)\s+cas d(?:e |')infection/i);
  const franceConfirmedMatch = normalizedClusterBlock.match(/dont\s+(\d+)\s+cas\s+chez\s+une?\s+ressortissant/i);
  const franceContactsMatch = normalizedClusterBlock.match(/en france,\s*(\d+)\s+personnes?\s+contacts/i);

  return {
    updatedDate,
    snapshotDate,
    globalConfirmed: globalConfirmedMatch ? Number.parseInt(globalConfirmedMatch[1], 10) : null,
    franceConfirmedCases: franceConfirmedMatch ? Number.parseInt(franceConfirmedMatch[1], 10) : null,
    franceContactsMonitored: franceContactsMatch ? Number.parseInt(franceContactsMatch[1], 10) : null,
    sourceUrl: HISTORICAL_REFERENCE.sourceUrl,
    text: clusterBlock,
  };
}

export function buildSnapshot({ latestSourceDate = null, spfSituation = null } = {}) {
  const asOf = toIsoTimestamp(maxDate('2026-05-18', latestSourceDate)) || '2026-05-18T00:00:00.000Z';
  const franceConfirmedCases = spfSituation?.franceConfirmedCases ?? 1;
  const franceContactsMonitored = spfSituation?.franceContactsMonitored ?? 22;
  const globalConfirmed = spfSituation?.globalConfirmed ?? 8;
  return {
    asOf,
    activeCluster: 'MV_HONDIUS',
    franceConfirmedCases,
    franceContactsMonitored,
    globalConfirmed,
    globalProbable: 2,
    globalInconclusive: 1,
    deaths: 3,
    riskGeneralPopulation: 'low',
    sourceUrls: [
      'https://invs.santepubliquefrance.fr/index.php/hantavirus/donnees',
      'https://www.info.gouv.fr/actualite/hantavirus-le-point-sur-les-mesures-sanitaires-en-france',
      'https://www.who.int/emergencies/disease-outbreak-news/item/2026-DON601',
      'https://www.ecdc.europa.eu/en/infectious-disease-topics/hantavirus-infection/surveillance-and-updates/andes-hantavirus-outbreak'
    ],
    narrative: [
      'Cluster actif : MV Hondius, souche Andes.',
      `France : ${franceConfirmedCases} cas confirmé${franceConfirmedCases > 1 ? 's' : ''} et ${franceContactsMonitored} cas contacts suivis.`,
      'Population générale : risque faible selon l’OMS et l’ECDC.',
      'Transmission interhumaine limitée à des contacts étroits et prolongés.',
      'Les zones historiques SPF relèvent d’un contexte distinct, non lié au cluster Andes.',
    ],
  };
}

export function buildActiveClusterTemplates({ spfSituation = null } = {}) {
  const lastCheckedAt = nowIso();
  const globalConfirmed = spfSituation?.globalConfirmed ?? 8;
  const franceConfirmed = spfSituation?.franceConfirmedCases ?? 1;
  const franceContacts = spfSituation?.franceContactsMonitored ?? 22;

  return [
    {
      id: 'hanta-cluster-hondius',
      source: 'WHO',
      sourceLabel: sourceLabel('WHO'),
      sourceRank: sourceRank('WHO'),
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
      reportedCounts: { confirmed: globalConfirmed, probable: 2, deaths: 3 },
      lastCheckedAt,
      url_sources: ['https://www.who.int/emergencies/disease-outbreak-news/item/2026-DON601'],
    },
    {
      id: 'hanta-ref-bichat',
      source: 'MediaValidated',
      sourceLabel: sourceLabel('MediaValidated'),
      sourceRank: sourceRank('MediaValidated'),
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
      commentaires: 'Veille hospitalière. Ne représente pas un cas confirmé.',
      contactGeo: {
        publicLocationLabel: 'Paris',
        locationType: 'hospital',
        precision: 'city',
        publicationStatus: 'media',
        privacyMode: 'show_city',
      },
      lastCheckedAt,
      url_sources: ['https://fr.euronews.com/sante/2026/05/11/hantavirus-une-passagere-francaise-du-paquebot-mv-hondius-testee-positive'],
    },
    {
      id: 'hanta-ref-pitie',
      source: 'MediaValidated',
      sourceLabel: sourceLabel('MediaValidated'),
      sourceRank: sourceRank('MediaValidated'),
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
      contactGeo: {
        publicLocationLabel: 'Paris',
        locationType: 'hospital',
        precision: 'city',
        publicationStatus: 'media',
        privacyMode: 'show_city',
      },
      lastCheckedAt,
      url_sources: ['https://fr.euronews.com/sante/2026/05/11/hantavirus-une-passagere-francaise-du-paquebot-mv-hondius-testee-positive'],
    },
    {
      id: 'hanta-idf-confirmed-case',
      source: 'DGS-URGENT',
      sourceLabel: sourceLabel('DGS-URGENT'),
      sourceRank: sourceRank('DGS-URGENT'),
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
      contactGeo: {
        publicLocationLabel: 'Île-de-France',
        locationType: 'hospital',
        precision: 'region',
        publicationStatus: 'official',
        privacyMode: 'aggregate_department',
      },
      reportedCounts: { confirmed: franceConfirmed, contacts: franceContacts },
      lastCheckedAt,
      url_sources: ['https://peps.sante.gouv.fr/actu/2026/26_point-hantavirus-n08_11052026.pdf'],
    },
    {
      id: 'hanta-france-contact-monitoring',
      source: 'INFO_GOUV',
      sourceLabel: sourceLabel('INFO_GOUV'),
      sourceRank: sourceRank('INFO_GOUV'),
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
      commentaires: 'Suivi sanitaire agrégé. Les villes de résidence ne sont pas affichées.',
      contactGeo: {
        publicLocationLabel: 'France',
        locationType: 'unknown',
        precision: 'country',
        publicationStatus: 'official',
        privacyMode: 'hide',
      },
      reportedCounts: { contacts: franceContacts },
      lastCheckedAt,
      url_sources: ['https://www.info.gouv.fr/actualite/hantavirus-le-point-sur-les-mesures-sanitaires-en-france'],
    },
  ];
}

function buildZoneHistoriqueEvents() {
  const lastCheckedAt = nowIso();
  return Object.entries(HISTORICAL_DEPARTMENTS).map(([code, zone]) => ({
    id: `hanta-zone-${code.toLowerCase()}`,
    source: 'SPF',
    sourceLabel: sourceLabel('SPF'),
    sourceRank: sourceRank('SPF'),
    type: 'zone_historique',
    kind: 'historical_risk_zone',
    evidenceLevel: 'official_historical',
    validationStatus: 'validated',
    activeContext: 'historical_france_context',
    clusterId: 'none',
    souche: 'autre',
    territoire_niveau: 'departement',
    territoire_code: code,
    label: `Zone historique hantavirus - ${zone.name}`,
    date_debut: HISTORICAL_REFERENCE.circulationPeriodStart,
    date_fin: HISTORICAL_REFERENCE.circulationPeriodEnd,
    severite: zone.severity,
    commentaires: `Contexte historique SPF 2005-2023. Non lié au cluster Andes 2026.`,
    lastCheckedAt,
    url_sources: [HISTORICAL_REFERENCE.sourceUrl],
  }));
}

const SEVERITY_RANK = { info: 1, surveillance: 2, alerte: 3, crise: 4 };
function maxSeverity(a, b) {
  return (SEVERITY_RANK[a] || 1) >= (SEVERITY_RANK[b] || 1) ? a : b;
}

function applySignalToCluster(cluster, signalLevel, mentions) {
  if (!signalLevel) return cluster;

  const updated = { ...cluster, source: 'DGS-AUTO', sourceLabel: sourceLabel('DGS-AUTO'), sourceRank: sourceRank('DGS-AUTO') };

  if (cluster.kind === 'ship_cluster') {
    updated.severite = maxSeverity(cluster.severite, 'crise');
    updated.validationStatus = 'needs_review';
  } else if (cluster.kind === 'confirmed_case') {
    const derived = (signalLevel === 'crise' || signalLevel === 'alerte') ? 'crise' : 'alerte';
    updated.severite = maxSeverity(cluster.severite, derived);
  } else if (cluster.kind === 'hospital_monitoring') {
    updated.severite = mentions?.bichat ? maxSeverity(cluster.severite, 'alerte') : cluster.severite;
    updated.validationStatus = 'needs_review';
  } else if (cluster.kind === 'contact_case') {
    updated.severite = mentions?.contact ? maxSeverity(cluster.severite, 'surveillance') : cluster.severite;
  }

  return updated;
}

function buildDgsAutoEvent(derivedSignal, pdfUrl) {
  if (!derivedSignal) return null;
  const { severity, mentions } = derivedSignal;
  if (!(mentions.andes || mentions.hondius || mentions.contact || mentions.bichat)) return null;
  return {
    id: `dgs-hantavirus-${stableIdFragment(pdfUrl)}`,
    source: 'DGS-URGENT',
    sourceLabel: sourceLabel('DGS-URGENT'),
    sourceRank: sourceRank('DGS-URGENT'),
    type: 'cluster',
    kind: mentions.contact ? 'contact_case' : (mentions.bichat ? 'hospital_monitoring' : 'ship_cluster'),
    evidenceLevel: 'official_monitoring',
    validationStatus: 'needs_review',
    activeContext: 'andes_active_cluster',
    clusterId: 'MV_HONDIUS',
    souche: mentions.andes ? 'Andes' : 'autre',
    territoire_niveau: mentions.bichat ? 'etablissement' : (mentions.hondius || mentions.navire ? 'navire' : 'pays'),
    territoire_code: mentions.bichat ? 'HOP-BICHAT' : (mentions.hondius || mentions.navire ? 'SHIP-MV-HONDIUS' : 'FR'),
    label: mentions.contact ? 'DGS-Urgent - suivi de contacts hantavirus' : 'DGS-Urgent - signal hantavirus Andes',
    date_debut: new Date().toISOString().slice(0, 10),
    severite: severity,
    commentaires: 'Signal auto-extrait de DGS-Urgent. Validation manuelle requise.',
    lastCheckedAt: nowIso(),
    url_sources: [pdfUrl],
  };
}

function buildDedupKey(event) {
  return [
    event.kind,
    event.souche || 'na',
    event.territoire_code,
    String(event.date_debut || '').slice(0, 10),
  ].join('|').toLowerCase();
}

function mergeEvents(primary, duplicate) {
  return {
    ...primary,
    sourceRank: Math.max(primary.sourceRank, duplicate.sourceRank),
    source: primary.sourceRank >= duplicate.sourceRank ? primary.source : duplicate.source,
    sourceLabel: primary.sourceRank >= duplicate.sourceRank ? primary.sourceLabel : duplicate.sourceLabel,
    severite: maxSeverity(primary.severite, duplicate.severite),
    validationStatus: primary.validationStatus === 'validated' ? primary.validationStatus : duplicate.validationStatus,
    url_sources: [...new Set([...(primary.url_sources || []), ...(duplicate.url_sources || [])])],
    lastCheckedAt: nowIso(),
  };
}

export default async function handler(req, res) {
  if (setCors(req, res)) return;

  let signalLevel = null;
  let mentions = null;
  let dgsCandidatePdfs = [];
  let signalSources = [];
  const dgsAutoEvents = [];
  let latestSourceDate = null;
  let spfSituation = null;

  try {
    const html = await fetchText(DGS_URGENT_INDEX_URL, { timeoutMs: 10000 });
    dgsCandidatePdfs = extractPdfLinks(html).filter((url) => /hanta|zoono|fievre|virus/i.test(url));

    const derived = classifyDgsSignal(html);
    if (derived) {
      signalLevel = derived.severity;
      mentions = derived.mentions;
      signalSources.push('DGS-Urgent index');
    }

    for (const pdfUrl of dgsCandidatePdfs.slice(0, 8)) {
      const autoEvent = buildDgsAutoEvent(derived, pdfUrl);
      if (autoEvent) dgsAutoEvents.push(autoEvent);
    }
  } catch (err) {
    console.warn('[api/health/hantavirus] DGS scan failed:', err instanceof Error ? err.message : String(err));
  }

  if (dgsCandidatePdfs.length === 0) {
    try {
      const peppsHtml = await fetchText(PEPPS_HANTAVIRUS_INDEX_URL, { timeoutMs: 10000 });
      const peppsSources = extractPeppsHantavirusSources(peppsHtml);
      latestSourceDate = maxDate(latestSourceDate, peppsSources.latestDate);

      if (peppsSources.pdfUrls.length > 0) {
        dgsCandidatePdfs = peppsSources.pdfUrls;
        signalSources.push('PEPPS hantavirus index');
      }

      if (!signalLevel) {
        const derived = classifyDgsSignal(peppsSources.sectionText);
        if (derived) {
          signalLevel = derived.severity;
          mentions = derived.mentions;
        }
      }
    } catch (err) {
      console.warn('[api/health/hantavirus] PEPPS scan failed:', err instanceof Error ? err.message : String(err));
    }
  }

  try {
    const spfHtml = await fetchText(SPF_HANTAVIRUS_DATA_URL, { timeoutMs: 10000 });
    spfSituation = extractSpfSituationFromHtml(spfHtml);
    latestSourceDate = maxDate(latestSourceDate, spfSituation?.updatedDate);

    if (!signalLevel) {
      const derived = classifyDgsSignal(`${spfHtml}\n${spfSituation?.text || ''}`);
      if (derived) {
        signalLevel = derived.severity;
        mentions = derived.mentions;
        signalSources.push('SPF hantavirus page');
      }
    }
  } catch (err) {
    console.warn('[api/health/hantavirus] SPF scan failed:', err instanceof Error ? err.message : String(err));
  }

  const activeClusters = buildActiveClusterTemplates({ spfSituation }).map((cluster) => applySignalToCluster(cluster, signalLevel, mentions));
  const zoneEvents = buildZoneHistoriqueEvents();

  const deduped = new Map();
  for (const event of [...dgsAutoEvents, ...activeClusters, ...zoneEvents]) {
    const key = buildDedupKey(event);
    deduped.set(key, deduped.has(key) ? mergeEvents(deduped.get(key), event) : event);
  }

  const allEvents = [...deduped.values()];
  const heatmap = allEvents.map((event) => pointForEvent(event)).filter(Boolean);

  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=900');
  res.status(200).json({
    generated_at: new Date().toISOString(),
    classification: {
      signal_level: signalLevel,
      signal_sources: signalSources,
      fallback_used: signalLevel === null,
      note: signalLevel
        ? `Signal détecté automatiquement via : ${signalSources.join(', ')}`
        : 'Sources DGS/SPF inaccessibles — fallback éditorial appliqué.',
    },
    scan: {
      dgs_urgent_index_url: DGS_URGENT_INDEX_URL,
      spf_hantavirus_data_url: SPF_HANTAVIRUS_DATA_URL,
      pepps_hantavirus_index_url: PEPPS_HANTAVIRUS_INDEX_URL,
      candidate_pdf_urls: dgsCandidatePdfs,
    },
    snapshot: buildSnapshot({ latestSourceDate, spfSituation }),
    events: allEvents,
    heatmap,
  });
}
