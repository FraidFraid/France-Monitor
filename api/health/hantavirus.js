import { fetchText, setCors } from '../_shared/health-utils.js';

const DGS_URGENT_INDEX_URL = 'https://sante.gouv.fr/ministere/informations-pratiques/site/dgs-urgent';
const SPF_HANTAVIRUS_URL = 'https://www.santepubliquefrance.fr/maladies-et-traumatismes/maladies-et-infections-respiratoires/hantavirus';

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
  'SHIP-MV-HONDIUS': [-23.5, 16.9],
  'HOP-BICHAT': [2.3317, 48.8984],
  'HOP-PITIE-SALPETRIERE': [2.365, 48.838],
  'HOP-IHU-MARSEILLE': [5.3938, 43.2895],
};

// ─── Keyword classifier ───────────────────────────────────────────────────────
// Returns the derived severity level based on DGS/SPF text content.
// null = no hantavirus signal found.
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
  };

  // Escalade de sévérité basée sur les signaux
  if (mentions.deces || (mentions.cas_confirme && mentions.andes && mentions.france)) return 'crise';
  if (mentions.urgence || (mentions.andes && mentions.hondius)) return 'crise';
  if (mentions.cas_confirme || mentions.cas_importe) return 'alerte';
  if (mentions.andes || mentions.hondius || mentions.navire) return 'alerte';
  if (mentions.france) return 'surveillance';
  return 'info';
}

// Détermine la sévérité d'un hôpital de référence selon les signaux DGS.
// Les hôpitaux de référence sont au mieux en "alerte" s'il y a un cas confirmé
// France, sinon en "surveillance".
function referenceHospitalSeverity(signalLevel, hospitalCode, mentions) {
  if (!signalLevel) return 'surveillance';
  if (signalLevel === 'crise') {
    // Bichat est nommément cité dans la presse → alerte, pas crise (pas de cas traité confirmé)
    if (hospitalCode === 'HOP-BICHAT' && mentions?.bichat) return 'alerte';
    return 'surveillance';
  }
  if (signalLevel === 'alerte') return 'surveillance';
  return 'surveillance';
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
  return event.type === 'cluster' ? severityBase * 2.5 : severityBase * 0.9;
}

function pointForEvent(event) {
  const coords = STATIC_POINTS[event.territoire_code] || HISTORICAL_DEPARTMENTS[event.territoire_code]?.center || null;
  if (!coords) return null;
  return { lon: coords[0], lat: coords[1], weight: weightForEvent(event), type: event.type, label: event.label };
}

// ─── Seed events (fallback — sévérités remplacées par la classification live) ─
function buildActiveClusterTemplates() {
  return [
    {
      id: 'hanta-cluster-hondius',
      source: 'MediaValidated',
      type: 'cluster',
      souche: 'Andes',
      territoire_niveau: 'navire',
      territoire_code: 'SHIP-MV-HONDIUS',
      label: 'Cluster MV Hondius — Hantavirus Andes',
      date_debut: '2026-05-03',
      severite: 'crise', // fallback
      commentaires: 'Cluster confirmé par l\'OMS. Navire de croisière, transmission interhumaine documentée (souche Andes).',
      url_sources: [
        'https://www.who.int/docs/default-source/coronaviruse/situation-reports/who-technical-note-for-the-disembarkation-and-onward-management-of-passengers-and-crew-in-the-context-of-an-andes-virus-associated-cluster-mv-hondius-cruise-ship.pdf?download=true&sfvrsn=56272a28_3',
      ],
    },
    {
      id: 'hanta-hop-bichat',
      source: 'MediaValidated',
      type: 'cluster',
      souche: 'Andes',
      territoire_niveau: 'etablissement',
      territoire_code: 'HOP-BICHAT',
      label: 'Hôpital de référence — Bichat',
      date_debut: '2026-05-10',
      severite: 'surveillance', // fallback — upgradé si signal live
      commentaires: 'Hôpital de référence en veille pour cas rapatriés ou suspects. Aucun cas confirmé à ce stade.',
      url_sources: ['https://fr.euronews.com/sante/2026/05/11/hantavirus-une-passagere-francaise-du-paquebot-mv-hondius-testee-positive'],
    },
    {
      id: 'hanta-hop-pitie',
      source: 'MediaValidated',
      type: 'cluster',
      souche: 'Andes',
      territoire_niveau: 'etablissement',
      territoire_code: 'HOP-PITIE-SALPETRIERE',
      label: 'Hôpital de référence — Pitié-Salpêtrière',
      date_debut: '2026-05-10',
      severite: 'surveillance', // toujours surveillance — hôpital de repli
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
      label: 'Cas confirmé — IHU Marseille (Juan-les-Pins)',
      date_debut: '2026-05-12',
      severite: 'crise', // fallback — premier cas confirmé en France
      commentaires: 'Premier cas importé confirmé en France. Passagère de Juan-les-Pins liée au cluster MV Hondius, prise en charge à l\'IHU Méditerranée Infection.',
      url_sources: [
        'https://www.cespharm.fr/prevention-sante/actualites/2026/alerte-internationale-cluster-de-cas-d-hantavirus',
        'https://www.nicemag.fr/article/7189/hantavirus-une-habitante-de-juan-les-pins-evacuee-vers-marseille-les-autorites-renforcent-les-quarantaines',
      ],
    },
  ];
}

function buildZoneHistoriqueEvents() {
  return Object.entries(HISTORICAL_DEPARTMENTS).map(([code, zone]) => ({
    id: `hanta-zone-${code.toLowerCase()}`,
    source: 'SPF',
    type: 'zone_historique',
    souche: 'autre',
    territoire_niveau: 'departement',
    territoire_code: code,
    label: `Zone historique hantavirus - ${zone.name}`,
    date_debut: HISTORICAL_REFERENCE.circulationPeriodStart,
    date_fin: HISTORICAL_REFERENCE.circulationPeriodEnd,
    severite: zone.severity,
    commentaires: `Zone historique de circulation documentée 2005-2023. Dernière synthèse de cas ${HISTORICAL_REFERENCE.latestCaseDataYear}.`,
    url_sources: [HISTORICAL_REFERENCE.sourceUrl],
  }));
}

// ─── Apply live signal to cluster templates ───────────────────────────────────
function applySignalToCluster(cluster, signalLevel, mentions) {
  if (!signalLevel) return cluster; // DGS unreachable — garde le fallback

  const updated = { ...cluster };

  if (cluster.territoire_code === 'SHIP-MV-HONDIUS') {
    // Hondius est toujours crise si signal Andes/navire détecté
    updated.severite = (mentions?.andes || mentions?.hondius) ? 'crise' : signalLevel;
    updated.source = 'DGS-AUTO';
  } else if (cluster.territoire_code === 'HOP-IHU-MARSEILLE') {
    // Marseille : cas confirmé en France → crise si signal >= alerte
    updated.severite = (signalLevel === 'crise' || signalLevel === 'alerte') ? 'crise' : 'alerte';
    updated.source = 'DGS-AUTO';
  } else if (cluster.territoire_code === 'HOP-BICHAT') {
    updated.severite = referenceHospitalSeverity(signalLevel, 'HOP-BICHAT', mentions);
    updated.source = 'DGS-AUTO';
  } else if (cluster.territoire_code === 'HOP-PITIE-SALPETRIERE') {
    // Pitié reste toujours en surveillance (hôpital de repli)
    updated.severite = 'surveillance';
    updated.source = 'DGS-AUTO';
  }

  return updated;
}

export default async function handler(req, res) {
  if (setCors(req, res)) return;

  let signalLevel = null;
  let mentions = null;
  let dgsCandidatePdfs = [];
  let signalSources = [];

  // ── Scan DGS-Urgent index ──
  try {
    const html = await fetchText(DGS_URGENT_INDEX_URL, { timeoutMs: 10000 });
    dgsCandidatePdfs = extractPdfLinks(html).filter((url) => /hanta|zoono|fievre|virus/i.test(url));

    const derived = classifyDgsSignal(html);
    if (derived) {
      signalLevel = derived;
      signalSources.push('DGS-Urgent index');
      // Extraire les mentions pour les décisions fine-grained
      const t = html.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      mentions = {
        andes: /\bandes\b/.test(t),
        hondius: /hondius/.test(t),
        bichat: /bichat/.test(t),
        marseille: /marseille/.test(t),
        cas_confirme: /cas\s+confirm/.test(t),
      };
    }
  } catch (err) {
    console.warn('[api/health/hantavirus] DGS scan failed:', err instanceof Error ? err.message : String(err));
  }

  // ── Scan SPF hantavirus page (fallback/renforcement) ──
  if (!signalLevel) {
    try {
      const spfHtml = await fetchText(SPF_HANTAVIRUS_URL, { timeoutMs: 8000 });
      const derived = classifyDgsSignal(spfHtml);
      if (derived) {
        signalLevel = derived;
        signalSources.push('SPF hantavirus page');
      }
    } catch (err) {
      console.warn('[api/health/hantavirus] SPF scan failed:', err instanceof Error ? err.message : String(err));
    }
  }

  // ── Construire les événements avec sévérités dérivées ──
  const clusterTemplates = buildActiveClusterTemplates();
  const activeClusters = clusterTemplates.map((c) => applySignalToCluster(c, signalLevel, mentions));
  const zoneEvents = buildZoneHistoriqueEvents();
  const allEvents = [...activeClusters, ...zoneEvents];

  const heatmap = allEvents.map((event) => pointForEvent(event)).filter(Boolean);

  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=900');
  res.status(200).json({
    generated_at: new Date().toISOString(),
    classification: {
      signal_level: signalLevel,
      signal_sources: signalSources,
      fallback_used: signalLevel === null,
      note: signalLevel
        ? `Sévérités dérivées automatiquement depuis : ${signalSources.join(', ')}`
        : 'Sources DGS/SPF inaccessibles — sévérités fallback utilisées.',
    },
    scan: {
      dgs_urgent_index_url: DGS_URGENT_INDEX_URL,
      candidate_pdf_urls: dgsCandidatePdfs,
    },
    events: allEvents,
    heatmap,
  });
}
