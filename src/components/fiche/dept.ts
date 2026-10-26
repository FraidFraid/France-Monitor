// src/components/fiche/dept.ts : fiche d'un département (26/10/2026, vue départementale pour les préfectures). Même grammaire que les
// autres fiches (fiche/parts.ts, fiche/kit.ts) : niveau L1 du département (pression par département, department-pressure.ts),
// signaux qui le fondent (cliquables vers leur fiche), vigilance Météo-France du département et événements de presse localisés dans
// le département sur 24 h. Ouverte depuis le panneau « Pression par département » ou un clic sur le département sur la carte.
import type { MeteoAlert, NewsEvent } from '../../types/index.ts';
import { RISK_LABELS } from '../../types/index.ts';
import type { DepartmentPressure, PressureElement } from '../../services/department-pressure.ts';
import { eventDisplayLevel, levelLabel, LEVEL_RANK, type VigilanceLevel } from '../../services/vigilance.ts';
import { themeLabel } from '../../services/themes.ts';
import { escapeHtml } from '../france-intel-events.ts';
import { renderVigilancePill } from '../shared/vigilancePill.ts';
import { absoluteTime, kvRow } from './kit.ts';
import { t, type FicheModel, type FicheSection, type Lang } from './parts.ts';

const DAY_MS = 24 * 3_600_000;
const MAX_EVENTS = 12;

const METEO_LEVEL: Readonly<Record<MeteoAlert['level'], VigilanceLevel>> = { green: 'vert', yellow: 'jaune', orange: 'orange', red: 'rouge' };

const SOURCE_LABEL: Readonly<Record<PressureElement['source'], readonly [string, string]>> = {
  event: ['presse', 'press'], situation: ['situation', 'situation'], meteo: ['Météo-France', 'Météo-France'], vigicrues: ['Vigicrues', 'Vigicrues'],
};

export interface DeptFicheInput {
  code: string;
  /** Nom du département (index géographique) ; null : le code seul. */
  name: string | null;
  /** Pression du département ; null : aucun signal jaune ou plus (vert). */
  pressure: DepartmentPressure | null;
  meteo: readonly MeteoAlert[];
  /** Événements de presse localisés dans ce département (App filtre par coordonnées). */
  events: readonly NewsEvent[];
  sectionOpen: ReadonlyMap<string, boolean>;
  lang: Lang;
  now: number;
}

function elementRow(e: PressureElement, lang: Lang): string {
  const pill = renderVigilancePill(e.level, lang);
  const meta = `<span class="fiche-meta">${escapeHtml(SOURCE_LABEL[e.source][lang === 'fr' ? 0 : 1])} · ${escapeHtml(themeLabel(e.theme, lang))}</span>`;
  const body = e.key
    ? `<button type="button" class="fiche-link" data-select="${escapeHtml(e.key)}" title="${escapeHtml(e.title)}">${pill}<span class="fmk-sit-title">${escapeHtml(e.title)}</span></button>`
    : `${pill}<span class="fmk-sit-title">${escapeHtml(e.title)}</span>`;
  return `<li class="fiche-situation">${body} ${meta}</li>`;
}

function eventRow(e: NewsEvent, lang: Lang, now: number): string {
  const level = eventDisplayLevel(e.severity, e.peakSeverity);
  return `<li class="fiche-situation"><button type="button" class="fiche-link" data-select="event:${e.id}" title="${escapeHtml(e.title)}">`
    + `${renderVigilancePill(level, lang)}<span class="fmk-sit-title">${escapeHtml(e.title)}</span></button>`
    + ` <span class="fiche-meta">${escapeHtml(absoluteTime(Date.parse(e.lastSeen), now, lang))}</span></li>`;
}

/** Événements des 24 dernières heures, du plus grave au plus récent. */
export function recentDeptEvents(events: readonly NewsEvent[], now: number): NewsEvent[] {
  return events
    .filter((e) => now - Date.parse(e.lastSeen) <= DAY_MS)
    .sort((a, b) => LEVEL_RANK[eventDisplayLevel(b.severity, b.peakSeverity)] - LEVEL_RANK[eventDisplayLevel(a.severity, a.peakSeverity)]
      || Date.parse(b.lastSeen) - Date.parse(a.lastSeen));
}

export function buildDeptFiche(input: DeptFicheInput): FicheModel {
  const { code, pressure, lang, now } = input;
  const open = (id: string, byDefault: boolean): boolean => input.sectionOpen.get(id) ?? byDefault;
  const name = pressure?.name ?? input.name ?? code;
  const level: VigilanceLevel = pressure?.level ?? 'vert';
  const elements = pressure?.elements ?? [];
  const meteo = input.meteo.filter((m) => m.departmentCode === code);
  const worstMeteo = meteo.reduce<VigilanceLevel>((w, m) => (LEVEL_RANK[METEO_LEVEL[m.level]] > LEVEL_RANK[w] ? METEO_LEVEL[m.level] : w), 'vert');
  const risks = [...new Set(meteo.flatMap((m) => m.risks.map((r) => RISK_LABELS[r] ?? r)))];
  const events = recentDeptEvents(input.events, now);
  const n = elements.length;

  const lead = pressure
    ? t(lang,
      `Niveau ${levelLabel(level, lang).toLowerCase()}, tiré par le thème ${themeLabel(pressure.driver, lang).toLowerCase()} : ${n} ${n > 1 ? 'signaux' : 'signal'} jaune ou plus.`,
      `${levelLabel(level, lang)} level, driven by ${themeLabel(pressure.driver, lang).toLowerCase()}: ${n} signal${n > 1 ? 's' : ''} yellow or above.`)
    : t(lang, 'Aucun signal jaune ou plus dans ce département.', 'No yellow or higher signal in this department.');

  const sections: FicheSection[] = [
    {
      id: 'signals', title: t(lang, 'Signaux du département', 'Department signals'), summary: String(n), collapsible: false,
      html: n > 0
        ? `<ul class="fiche-list">${elements.map((e) => elementRow(e, lang)).join('')}</ul>`
        : `<p class="fmk-muted">${t(lang, 'Aucun signal jaune ou plus.', 'No yellow or higher signal.')}</p>`,
    },
    {
      id: 'meteo', title: t(lang, 'Vigilance météo', 'Weather warnings'), collapsible: true, open: open('meteo', true),
      summary: levelLabel(worstMeteo, lang),
      html: `<div class="fmk-kvs">${kvRow(t(lang, 'Niveau Météo-France', 'Météo-France level'), renderVigilancePill(worstMeteo, lang))}`
        + `${risks.length > 0 ? kvRow(t(lang, 'Phénomènes', 'Hazards'), escapeHtml(risks.join(', '))) : ''}</div>`,
    },
    {
      id: 'events', title: t(lang, 'Presse : événements des dernières 24 h', 'Press: events of the last 24 h'), collapsible: true,
      open: open('events', true), summary: String(events.length),
      html: events.length > 0
        ? `<ul class="fiche-list">${events.slice(0, MAX_EVENTS).map((e) => eventRow(e, lang, now)).join('')}</ul>`
          + (events.length > MAX_EVENTS ? `<p class="fmk-note">${escapeHtml(t(lang, `Et ${events.length - MAX_EVENTS} autres.`, `And ${events.length - MAX_EVENTS} more.`))}</p>` : '')
        : `<p class="fmk-muted">${t(lang, 'Aucun événement localisé dans le département depuis 24 h.', 'No event located in the department in the last 24 h.')}</p>`,
    },
  ];

  return {
    key: `dept:${code}`,
    kind: t(lang, 'Département', 'Department'),
    name: `${name} (${code})`,
    level,
    driver: '',
    freshness: '',
    lead,
    sections,
    actions: [{ id: 'show-dept', label: t(lang, 'Voir sur la carte', 'Show on map') }],
  };
}
