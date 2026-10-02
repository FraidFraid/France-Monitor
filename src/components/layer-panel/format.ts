// src/components/layer-panel/format.ts : formateurs des panneaux de couches (spec 2026-10-02 lot 2 § 1, R1).
// Une valeur tient sur une ligne : espace insécable (U+00A0) entre le nombre et l'unité et avant « % ».
// Valeur absente : « n.d. », jamais 0. Signe moins typographique (U+2212).

export const NBSP = '\u00A0';
const MINUS = '−';
const ND = 'n.d.';

function ok(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Nombre fr-FR à `digits` décimales ; `signed` ajoute « + » aux positifs (zéro sans signe). */
export function frNumber(v: number, digits: number, signed = false): string {
  const factor = 10 ** digits;
  const rounded = Math.round(v * factor) / factor;
  const n = Object.is(rounded, -0) || rounded === 0 ? 0 : rounded;
  return n.toLocaleString('fr-FR', {
    minimumFractionDigits: digits, maximumFractionDigits: digits, signDisplay: signed ? 'exceptZero' : 'auto',
  }).replace('-', MINUS);
}

function withUnit(v: number | null | undefined, digits: number, unit: string, signed = false): string {
  return ok(v) ? `${frNumber(v, digits, signed)}${NBSP}${unit}` : ND;
}

export function formatGw(mw: number | null | undefined): string {
  return ok(mw) ? withUnit(mw / 1000, 1, 'GW') : ND;
}
export function formatMw(mw: number | null | undefined, digits = 0): string { return withUnit(mw, digits, 'MW'); }
export function formatPct(v: number | null | undefined, digits = 0): string { return withUnit(v, digits, '%'); }
export function formatSignedPct(v: number | null | undefined, digits = 0): string { return withUnit(v, digits, '%', true); }
export function formatGwhDay(v: number | null | undefined, opts: { signed?: boolean; digits?: number } = {}): string {
  return withUnit(v, opts.digits ?? 0, 'GWh/j', opts.signed === true);
}
export function formatTwh(v: number | null | undefined, digits = 1): string { return withUnit(v, digits, 'TWh'); }
export function formatEuro(v: number | null | undefined): string { return withUnit(v, 3, '€'); }
export function formatCents(v: number | null | undefined): string { return withUnit(v, 1, 'c', true); }
export function formatDays(v: number | null | undefined): string { return withUnit(v, 0, 'j'); }
export function formatMtYear(v: number | null | undefined): string { return withUnit(v, 1, 'Mt/an'); }
export function formatTons(t: number | null | undefined): string {
  if (!ok(t)) return ND;
  if (Math.abs(t) >= 1_000_000) return withUnit(t / 1_000_000, 1, 'Mt');
  if (Math.abs(t) >= 1_000) return withUnit(t / 1_000, 0, 'kt');
  return withUnit(t, 0, 't');
}

/** Jour de la semaine d'une date « AAAA-MM-JJ » (calendrier, sans fuseau). */
export function weekdayOf(date: string, style: 'long' | 'short'): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('fr-FR', { weekday: style, timeZone: 'UTC' });
}
/** « AAAA-MM-JJ » → « JJ/MM ». */
export function dayMonth(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

/** Heure « hh:mm » dans un fuseau IANA (heure locale des DROM). */
export function localClock(ms: number, timeZone: string): string {
  return new Date(ms).toLocaleTimeString('fr-FR', { timeZone, hour: '2-digit', minute: '2-digit' });
}

function zoneOffsetMs(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms));
  const n = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second')) - Math.floor(ms / 1000) * 1000;
}

/** Minuit (instant UTC) du jour local de `ms` dans `timeZone` ; juste aux changements d'heure. */
export function zoneMidnight(ms: number, timeZone: string): number {
  const day = new Intl.DateTimeFormat('sv-SE', { timeZone }).format(new Date(ms));
  const guess = Date.parse(`${day}T00:00:00Z`);
  const first = guess - zoneOffsetMs(guess, timeZone);
  return guess - zoneOffsetMs(first, timeZone);
}

const BREAKABLE = /\d(?:[,.]\d+)? (?:%|€|GW|MW|kW|TWh|GWh|MWh|g CO₂|Mt|kt|kV|hm3|t\b|j\b|h\b|min\b|c\b)/;

/** Premier « nombre, espace sécable, unité » du texte, ou null (contrôle R1 des tests de rendu). */
export function breakableValue(text: string): string | null {
  return BREAKABLE.exec(text)?.[0] ?? null;
}

/** Texte visible d'un HTML de panneau : balises retirées, entités de base décodées (tests R1 et R4). */
export function visibleText(html: string): string {
  return html.replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, NBSP).replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}
