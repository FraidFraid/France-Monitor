// api/_lib/anticipation/public-errors.js : erreurs publiées par /api/anticipation/now et la note de 7 h (revue finale, 04/11/2026).
// Le détail (chemins du serveur, messages du système) reste dans le journal du service ; le public lit un libellé français sans chemin.

/** Libellés publics des erreurs connues du registre et de la note. */
const LABELS = /** @type {Array<[RegExp, string]>} */ ([
  [/non inscriptible/, 'Registre en mémoire seulement (dossier non inscriptible)'],
  [/^journal\/\S+ : lecture impossible/, 'Journal des scénarios illisible'],
  [/compaction impossible/, "Compaction de l'archive des signaux impossible"],
  [/^Note de 7 h non écrite/, 'Note de 7 h non écrite (dossier non inscriptible)'],
]);

/** Libellé de l'échec d'un tick, servi tant que le nouvel essai n'a pas eu lieu. */
export const TICK_FAILED_LABEL = 'Anticipation momentanément indisponible : nouvel essai dans une minute';

/**
 * Libellé public d'une erreur interne : libellé connu, sinon le message dont les chemins absolus sont remplacés.
 * @param {string} msg
 * @returns {string}
 */
export function publicError(msg) {
  for (const [re, label] of LABELS) if (re.test(msg)) return label;
  return msg.replace(/(^|[^\w./-])\/[^\s'"`:,;)]+/g, '$1(dossier du serveur)');
}

/**
 * Liste publique, sans doublon, dans l'ordre d'arrivée.
 * @param {unknown[]} list
 * @returns {string[]}
 */
export function publicErrors(list) {
  return [...new Set((Array.isArray(list) ? list : []).filter((e) => typeof e === 'string' && e).map((e) => publicError(/** @type {string} */ (e))))];
}
