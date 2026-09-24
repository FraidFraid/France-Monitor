// api/_lib/brief-evidence.js — preuves citables du brief France (fonctions pures).
//
// Le modèle ne cite plus de noms de sources (il en inventait : l'alerte ORSEC de Gironde
// attribuée au Progrès, constaté le 23/09/2026). Il cite des identifiants de preuves fournis
// dans l'invite : E<id> pour un événement, S<n> pour une situation détectée par le moteur.
// Les sources affichées sont DÉDUITES des preuves citées, jamais recopiées du modèle.

const MAX_EVENTS = 10;
const MAX_SOURCES_PER_JUDGMENT = 5;
const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];

/**
 * @param {unknown} raw  body.events envoyé par le client
 * @returns {Array<{ id: string, title: string, category: string, severity: string, sources: string[],
 *   sourceCount: number, independentCount: number, lastSeen: string, status: string }>}
 */
export function sanitizeEvents(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const e of raw.slice(0, MAX_EVENTS)) {
    if (typeof e !== 'object' || e === null) continue;
    const id = String(e.id ?? '');
    if (!/^E\d{1,12}$/.test(id)) continue;
    const title = String(e.title ?? '').replace(/[\r\n]+/g, ' ').slice(0, 140);
    if (!title) continue;
    out.push({
      id,
      title,
      category: String(e.category ?? 'general').slice(0, 20),
      severity: SEVERITIES.includes(e.severity) ? e.severity : 'info',
      sources: Array.isArray(e.sources) ? e.sources.slice(0, 5).map((s) => String(s).slice(0, 60)) : [],
      sourceCount: Number.isFinite(e.sourceCount) ? Math.max(0, Math.trunc(e.sourceCount)) : 0,
      independentCount: Number.isFinite(e.independentCount) ? Math.max(0, Math.trunc(e.independentCount)) : 0,
      lastSeen: String(e.lastSeen ?? '').slice(0, 30),
      status: ['active', 'cooling', 'closed'].includes(e.status) ? e.status : 'active',
    });
  }
  return out;
}

/**
 * Index des preuves citables : événements (E…) puis situations (S1…Sn, dans l'ordre reçu).
 * `corroborated` : une situation (déjà multi-signaux par construction) ou un événement repris
 * par au moins deux groupes de presse indépendants.
 * @param {ReturnType<typeof sanitizeEvents>} events
 * @param {Array<{ title: string, sourceRefs: string[] }>} situations
 * @returns {Map<string, { label: string, sources: string[], corroborated: boolean }>}
 */
export function buildEvidenceIndex(events, situations) {
  const index = new Map();
  for (const e of events) index.set(e.id, { label: e.title, sources: e.sources, corroborated: e.independentCount >= 2 });
  situations.forEach((s, i) => index.set(`S${i + 1}`, { label: s.title, sources: s.sourceRefs, corroborated: true }));
  return index;
}

/**
 * Bloc d'invite listant les événements citables.
 * @param {ReturnType<typeof sanitizeEvents>} events
 * @param {'fr' | 'en'} lang
 */
export function formatEventsBlock(events, lang) {
  if (events.length === 0) return lang === 'fr' ? '(aucun événement consolidé)' : '(no consolidated event)';
  return events.map((e) => {
    const corroboration = lang === 'fr'
      ? `${e.sourceCount} source(s), ${e.independentCount} indépendante(s)`
      : `${e.sourceCount} source(s), ${e.independentCount} independent`;
    return `${e.id} [${e.category}/${e.severity}, ${corroboration}, ${e.status}] ${e.title}`;
  }).join('\n');
}

/**
 * Applique les preuves à un jugement brut du modèle : garde les identifiants connus, déduit
 * les sources, et marque « non étayé » (confiance ramenée à faible) sans preuve valide.
 * Une confiance « high » exige au moins une preuve corroborée, sinon elle devient « moderate ».
 * @param {{ evidence?: unknown, confidence: 'high' | 'moderate' | 'low' }} judgment
 * @param {Map<string, { label: string, sources: string[], corroborated: boolean }>} index
 * @returns {{ evidence: string[], sources: string[], unsupported: boolean, confidence: 'high' | 'moderate' | 'low' }}
 */
export function applyEvidence(judgment, index) {
  const cited = Array.isArray(judgment.evidence) ? judgment.evidence.map((x) => String(x).trim().toUpperCase()) : [];
  const evidence = [...new Set(cited.filter((id) => index.has(id)))].slice(0, 4);
  const sources = [...new Set(evidence.flatMap((id) => index.get(id)?.sources ?? []))].slice(0, MAX_SOURCES_PER_JUDGMENT);
  const unsupported = evidence.length === 0;
  if (unsupported) return { evidence, sources, unsupported, confidence: 'low' };
  const corroborated = evidence.some((id) => index.get(id)?.corroborated === true);
  const confidence = judgment.confidence === 'high' && !corroborated ? 'moderate' : judgment.confidence;
  return { evidence, sources, unsupported, confidence };
}
