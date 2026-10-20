// src/components/layer-panel/seveso.ts : vue pure du panneau « Sites Seveso » de l'onglet Environnement (20/10/2026). Aucun accès
// réseau ni DOM. Recensement Géorisques des établissements Seveso en exploitation (seuil haut et seuil bas, public/data/seveso.json,
// régénéré chaque trimestre) croisé avec les phénomènes en cours (environment-exposure.ts) : ce qui est menacé maintenant d'abord,
// puis la répartition par département. Niveau de la pastille : celui du phénomène le plus grave qui touche un site.
import type { ExposureAsset, Exposure } from '../../services/environment-exposure.ts';
import type { SevesoDataset } from '../../services/exposure-assets.ts';
import { isSeveso, sevesoHeadLevel } from './seveso-level.ts';
import type { FicheSection } from '../fiche/parts.ts';
import { kvRow } from '../fiche/kit.ts';
import { emptyLine, listRow, loadingBody, sourceLinkHtml, type LayerView } from './frame.ts';
import { NBSP, frNumber } from './format.ts';
import { ENVIRONMENT_THEME, note } from './environment-format.ts';
import { departementName } from './health-format.ts';

export { sevesoExposures, sevesoHeadLevel } from './seveso-level.ts';

export const SEVESO_TITLE = 'Sites Seveso';
type OpenFn = (sectionId: string, byDefault: boolean) => boolean;

export interface SevesoViewInput {
  data: SevesoDataset | null;
  error: string | null;
  /** Sites Seveso à portée d'un phénomène en cours (croisement de l'onglet) ; null : phénomènes pas encore lus. */
  exposed: readonly Exposure[] | null;
  canFocus: boolean;
  now: number;
  open: OpenFn;
}

const MAX_EXPOSED = 20;
const MAX_DEPTS = 15;
const GEORISQUES_URL = 'https://www.georisques.gouv.fr/risques/installations/donnees';

const km = (d: number | null): string => (d === null ? 'dans le département' : d === 0 ? 'dans la zone' : `à ${frNumber(d, d < 10 ? 1 : 0)}${NBSP}km`);

/** Sites par département (seuil haut, seuil bas), le plus de seuil haut d'abord. */
export function sevesoByDept(sites: readonly ExposureAsset[]): Array<{ dept: string; haut: number; bas: number }> {
  const m = new Map<string, { dept: string; haut: number; bas: number }>();
  for (const s of sites) {
    const row = m.get(s.dept) ?? { dept: s.dept, haut: 0, bas: 0 };
    if (s.kind === 'seveso-haut') row.haut += 1;
    else if (s.kind === 'seveso-bas') row.bas += 1;
    m.set(s.dept, row);
  }
  return [...m.values()].sort((a, b) => b.haut - a.haut || b.bas - a.bas || a.dept.localeCompare(b.dept));
}

function exposedSection(input: SevesoViewInput): FicheSection {
  const list = (input.exposed ?? []).filter((e) => isSeveso(e.asset));
  const html = input.exposed === null ? emptyLine('Phénomènes en cours pas encore lus : croisement en attente.')
    : list.length === 0 ? emptyLine('Aucun site Seveso à portée d’un phénomène en cours (crue, feu, séisme, zone Copernicus, vigilance orange ou rouge).')
    : list.slice(0, MAX_EXPOSED).map((e) => listRow({
      text: e.asset.name, value: e.inFloodZone ? 'en zone inondable' : km(e.distanceKm), level: e.hazard.level,
      note: [e.asset.kind === 'seveso-haut' ? 'seuil haut' : 'seuil bas', e.asset.commune, departementName(e.asset.dept), e.hazard.label]
        .filter((s): s is string => s !== null && s !== '').join(' · '),
      data: { lon: String(e.asset.lon), lat: String(e.asset.lat) }, link: input.canFocus,
    })).join('') + (list.length > MAX_EXPOSED ? note(`Et ${list.length - MAX_EXPOSED} autres sur la carte.`) : '');
  return { id: 'exposed', title: 'Exposés à un phénomène en cours', collapsible: true, open: input.open('exposed', true), summary: String(list.length), html };
}

function deptSection(input: SevesoViewInput, sites: readonly ExposureAsset[]): FicheSection {
  const rows = sevesoByDept(sites);
  const html = rows.slice(0, MAX_DEPTS).map((r) => listRow({
    text: departementName(r.dept), value: `${frNumber(r.haut, 0)}${NBSP}haut`, note: `${frNumber(r.bas, 0)}${NBSP}seuil bas`,
  })).join('') + (rows.length > MAX_DEPTS ? note(`${rows.length} départements en comptent au moins un.`) : '');
  return { id: 'depts', title: 'Départements les plus équipés', collapsible: true, open: input.open('depts', false), summary: String(rows.length), html };
}

function methodSection(input: SevesoViewInput): FicheSection {
  const d = input.data;
  const when = d?.readAt ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'Europe/Paris' }).format(new Date(d.readAt)) : 'n.d.';
  const html = kvRow('Source', `${sourceLinkHtml('Géorisques', GEORISQUES_URL)} · recensement du ${when}`)
    + note('Établissements Seveso en exploitation (seuil haut, seuil bas), base des installations classées de l’État, Licence Ouverte. Recensement relu chaque trimestre.')
    + note('Exposés : à moins de 2 km d’un tronçon de crue orange ou rouge, à moins de 5 km d’un feu confirmé, de 10 à 50 km d’un séisme selon sa magnitude, dans une zone Copernicus, ou dans un département en vigilance orange ou rouge (seuil haut seulement).');
  return { id: 'methode', title: 'Méthode et sources', collapsible: true, open: input.open('methode', false), tone: 'reference', summary: 'Géorisques', html };
}

export function buildSevesoView(input: SevesoViewInput): LayerView {
  if (input.data === null) {
    return {
      head: { theme: ENVIRONMENT_THEME, title: SEVESO_TITLE, level: input.error ? 'nd' : null, status: [input.error ? 'fichier illisible' : 'chargement…'] },
      sections: [], bodyHtml: input.error ? emptyLine(`Recensement Seveso indisponible (${input.error}).`) : loadingBody(),
    };
  }
  const sites = input.data.sites.filter(isSeveso);
  const haut = sites.filter((s) => s.kind === 'seveso-haut').length;
  const exposed = (input.exposed ?? []).filter((e) => isSeveso(e.asset));
  const exposedHaut = exposed.filter((e) => e.asset.kind === 'seveso-haut').length;
  const level = sevesoHeadLevel(input.data, input.exposed);
  return {
    head: {
      theme: ENVIRONMENT_THEME, title: SEVESO_TITLE, level,
      figure: exposed.length > 0
        ? { value: frNumber(exposed.length, 0), caption: `${exposed.length > 1 ? 'sites exposés' : 'site exposé'} à un phénomène en cours, dont ${frNumber(exposedHaut, 0)}${NBSP}seuil haut`, level: level === 'nd' ? null : level }
        : { value: frNumber(sites.length, 0), caption: `sites en exploitation, dont ${frNumber(haut, 0)}${NBSP}seuil haut`, level: null },
      status: [],
      lead: exposed.length > 0 ? `${exposed[0].asset.name} (${departementName(exposed[0].asset.dept)}) : ${exposed[0].hazard.label}.`
        : input.exposed === null ? null : 'Aucun site exposé à un phénomène en cours.',
    },
    sections: [exposedSection(input), deptSection(input, sites), methodSection(input)],
  };
}
