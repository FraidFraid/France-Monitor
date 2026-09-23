/**
 * api/_lib/jev-questions.js — Questions Jev (TypeSafe System One) pour le scoring
 * des articles ingérés, et construction de l'état associé.
 *
 * Voir docs/audit-2026-09-chargement-jev-ui.md §4.3 pour la justification de
 * chaque question. Contrat HTTP vérifié auprès de https://docs.typesafe.ai/api.md
 * (22/09/2026) : Score → `criteria` est un tableau de 2 à 10 libellés de niveaux ;
 * Choice → `criteria` est une map option → description (255 options max) ;
 * Noul → `criteria` est `{ true, false }`. Les clés de `QUESTIONS` sont des
 * identifiants internes, jamais transmis au modèle.
 *
 * Instructions/critères en anglais (le modèle est calibré en priorité sur
 * l'anglais, cf. skill typesafe-ai) ; l'état (titre/résumé) reste en français,
 * tel quel — Jev lit le texte source, il ne le traduit pas.
 *
 * NE PAS changer les libellés de niveaux sans relancer scripts/eval-jev.mjs :
 * ils sont ce sur quoi le modèle a été calibré pour ce déploiement.
 */

/** Nombre de niveaux de la question `relevance` (index 0..RELEVANCE_LEVELS-1). */
export const RELEVANCE_LEVELS = 4;

/** Nombre de niveaux de la question `severity` (index 0..SEVERITY_LEVELS-1). */
export const SEVERITY_LEVELS = 5;

export const QUESTIONS = {
  relevance: {
    type: 'score',
    instructions:
      "How useful is `article` for a national situational-awareness dashboard that monitors France's critical infrastructure, public safety, public health and social stability?",
    criteria: [
      'Not useful: entertainment, sport, culture, recipes, celebrity, lifestyle, consumer tips, local trivia, opinion pieces',
      'Minor local event with no wider consequences: isolated crime, small accident, minor road incident, court case about a past event',
      'Notable event affecting a public service, an infrastructure, an institution or many people in a territory',
      'Major event with national impact or a direct threat to critical infrastructure, public order, health or security',
    ],
  },
  category: {
    type: 'choice',
    instructions: 'Which domain does `article` primarily belong to?',
    criteria: {
      security: 'Crime, terrorism, policing, public order, riots, attacks',
      social: 'Strikes, demonstrations, social movements, labour conflicts',
      energy: 'Electricity, gas, oil, fuel supply, nuclear plants, grid, renewables',
      transport: 'Rail, road, air, maritime traffic and disruptions',
      weather: 'Storms, floods, heatwaves, wildfires, weather warnings',
      health: 'Epidemics, hospitals, drug shortages, public health alerts',
      cyber: 'Cyberattacks, data breaches, telecom or internet outages',
      infrastructure: 'Water, telecom networks, bridges, dams, industrial sites, other critical infrastructure',
      defense: 'Armed forces, military activity, geopolitical threats to France',
      finance: 'Markets, prices, economic shocks, major company failures',
      other: 'None of the above',
    },
  },
  severity: {
    type: 'score',
    instructions: 'How severe is the situation described in `article` for people, services or infrastructure in France?',
    criteria: [
      'No operational impact: information, announcement, analysis, statistics',
      'Localised and contained: a few people or one site affected, resolved or being resolved',
      'Significant ongoing disruption of a service, a network or a territory (a département or a city)',
      'Serious threat to life, to a critical infrastructure or to public order at regional scale',
      'National-scale crisis, major attack, disaster or outage in progress',
    ],
  },
  in_france: {
    type: 'noul',
    instructions:
      'Does the event in `article` take place in France (metropolitan or overseas) or directly affect French territory, population, institutions or infrastructure?',
    criteria: {
      true: 'The event is located in France or has a stated direct effect on France',
      false: 'The event is abroad and only mentioned as international news',
    },
  },
  ongoing: {
    type: 'noul',
    instructions:
      'Is the event in `article` happening now or still unfolding, as opposed to a retrospective, an anniversary, an analysis, a trial or an investigation about a past event?',
    criteria: {
      true: 'The situation is current and may still evolve',
      false: 'The article looks back at a past event or gives background',
    },
  },
  institution_involved: {
    type: 'noul',
    instructions:
      'Does `article` explicitly mention the involvement of a public institution, an operator or an emergency service (préfecture, police, gendarmerie, SAMU, pompiers, ARS, hospital, SNCF, RTE, Enedis, EDF, Météo-France, mairie, ministry)?',
    criteria: {
      true: 'At least one such organisation is named as acting or affected',
      false: 'No such organisation is mentioned',
    },
  },
  isolated_fait_divers: {
    type: 'noul',
    instructions:
      'Is `article` an isolated crime or accident story (fait divers) with no consequence beyond the people directly involved?',
    criteria: {
      true: 'A single incident with no effect on a service, a network or a territory',
      false: 'The event affects a service, a network, an institution or a whole area',
    },
  },
  scope: {
    type: 'choice',
    instructions: 'What is the geographic scope of the event in `article`?',
    criteria: {
      commune: 'One town or neighbourhood',
      departement: 'One département or several towns',
      region: 'One region or several départements',
      national: 'The whole country',
      international: 'Outside France or several countries',
      unknown: 'Cannot be determined',
    },
  },
  // Spéculatif (cf. docs/audit-2026-09-chargement-jev-ui.md §4.3) : posée pour
  // tous les articles (le fan-out parallèle ne coûte quasiment rien de plus),
  // mais n'est consommée par jev-policy.js que si category ∈ {energy,
  // transport, infrastructure, cyber}. Stockée telle quelle dans jev_answers
  // pour les futurs consommateurs (couches carto par type d'infra, etc.).
  infrastructure_type: {
    type: 'choice',
    instructions: 'If `article` concerns an infrastructure, which one? Answer `none` when no infrastructure is concerned.',
    criteria: {
      electricity: null,
      gas: null,
      fuel: null,
      nuclear: null,
      water: null,
      telecom_internet: null,
      rail: null,
      road: null,
      air: null,
      port_maritime: null,
      hospital: null,
      none: 'No infrastructure is concerned',
    },
  },
};

/** Libellé de type de source par tier de fiabilité (cf. src/config/feeds.ts). */
const TIER_LABELS = {
  1: 'agence de presse ou média national de référence',
  2: 'média national',
  3: 'presse quotidienne régionale',
  4: 'média secondaire régional ou d\'opinion',
};

/** L'état reste petit et nommé (cf. doc TypeSafe state.md) : résumé tronqué. */
const STATE_SUMMARY_MAX_CHARS = 600;

/**
 * Construit l'état envoyé à Jev pour un article.
 *
 * Note : la table `feeds` (et donc `api/_lib/feeds-snapshot.js`) ne persiste
 * pas le `type` déclaratif de src/config/feeds.ts (economy/tech/…) — seul le
 * `tier` est disponible à l'ingestion, d'où le libellé dérivé de TIER_LABELS
 * plutôt qu'un `feed.type` littéral.
 *
 * @param {{ title: string; description?: string | null; published_at?: string | Date | null }} article
 * @param {{ name?: string | null; region?: string | null; tier?: number | null }} feed
 * @returns {{
 *   source: { name: string; type: string; region: string; tier: number | null };
 *   article: { title: string; summary: string; published_at: string | null };
 * }}
 */
export function buildState(article, feed) {
  const tier = typeof feed?.tier === 'number' ? feed.tier : null;
  const publishedAt = article.published_at
    ? article.published_at instanceof Date
      ? article.published_at.toISOString()
      : String(article.published_at)
    : null;
  const summary = String(article.description ?? '').slice(0, STATE_SUMMARY_MAX_CHARS);

  return {
    source: {
      name: feed?.name ?? 'inconnue',
      type: TIER_LABELS[tier] ?? 'média',
      region: feed?.region ?? 'nationale',
      tier,
    },
    article: {
      title: article.title,
      summary,
      published_at: publishedAt,
    },
  };
}
