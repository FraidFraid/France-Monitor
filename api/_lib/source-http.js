// api/_lib/source-http.js : lecture stricte des sources tierces sous un nom neutre (lots Trafics et suivants).
// Simple réexportation de api/_lib/health-http.js (lot Santé) : mêmes règles S3 (non 2xx, page HTML inattendue,
// page de défi anti-robot ou corps vide = erreur ; délai borné ; User-Agent identifiant le projet ; mémoire de
// panne de 5 min ; cache CDN court quand une partie a échoué). Aucune logique propre ici.
export {
  HEALTH_USER_AGENT as SOURCE_USER_AGENT,
  DEFAULT_TIMEOUT_MS,
  FAILURE_MEMO_SEC,
  PARTIAL_CACHE_CONTROL,
  HealthFetchError as SourceFetchError,
  isChallengePage,
  looksLikeHtml,
  fetchStrictResponse,
  fetchStrictText,
  fetchStrictJson,
  fetchStrictXml,
  fetchStrictHtml,
  sourceError,
  cachedSource,
  cachedSourceReport,
  decodeEntities,
  cleanText,
  handlePreflight,
  sendHealthJson as sendSourceJson,
} from './health-http.js';
