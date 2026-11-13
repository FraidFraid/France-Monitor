// src/AnticipationRejeuPage.ts : rejeu public de l'épisode méditerranéen du 4 au 6 novembre 2026 (/anticipation/rejeu, 13/11/2026).
// Une seule chronologie : ce que la règle « crue et inondation » ouvre quand on la fait tourner sur les relevés archivés de l'époque, et
// ce que la presse a rapporté. La règle n'existait pas pendant l'épisode : la page le dit en tête. Données dans
// src/config/anticipation-rejeu-corse.ts (générées, réelles), aucun texte produit par une IA.
import './styles/anticipation-pages.css';
import { REJEU_EPISODES, REJEU_PRESS, REJEU_SNAPSHOTS, type RejeuEpisode, type RejeuPressItem } from './config/anticipation-rejeu-corse.ts';
import { WORD_LABEL } from './services/anticipation-words.ts';
import { escapeHtml } from './components/france-intel-events.ts';
import { httpLink } from './services/rss.ts';

const PARIS = 'Europe/Paris';
const NB = ' ';
const count = (n: number): string => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NB);
/** « mer. 4 nov. 16:00 » à l'heure de Paris. */
export function when(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return 'n.d.';
  const day = d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: PARIS });
  const hour = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: PARIS });
  return `${day} ${hour}`;
}
const wordName = (w: string): string => (w in WORD_LABEL ? WORD_LABEL[w as keyof typeof WORD_LABEL] : w);

interface Row { at: string; kind: 'outil' | 'presse'; html: string }

function episodeRow(group: readonly RejeuEpisode[]): Row {
  const names = group.map((e) => e.name).join(', ');
  const first = group[0];
  return {
    at: first.publishedAt,
    kind: 'outil',
    html: `<b>Hypothèse ouverte : ${escapeHtml(names)}</b> · ${escapeHtml(wordName(first.word))}`
      + `<small>Vigilance orange pluie-inondation publiée par Météo-France. Fenêtre annoncée : du ${escapeHtml(when(first.windowFrom))} au ${escapeHtml(when(group.reduce((m, e) => (e.windowTo > m ? e.windowTo : m), first.windowTo)))}. `
      + 'Conséquences attendues : routes coupées, évacuations de riverains, coupures de courant.</small>',
  };
}

function pressRow(p: RejeuPressItem): Row {
  const href = httpLink(p.link);
  const title = escapeHtml(p.title);
  return { at: p.at, kind: 'presse', html: `${href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${title}</a>` : title}<small>${escapeHtml(p.source)}</small>` };
}

/** Épisodes regroupés par heure de publication de la vigilance (la Corse d'abord, puis le Gard et l'Hérault). */
export function groupEpisodes(episodes: readonly RejeuEpisode[]): RejeuEpisode[][] {
  const by = new Map<string, RejeuEpisode[]>();
  for (const e of episodes) by.set(e.publishedAt, [...(by.get(e.publishedAt) ?? []), e]);
  return [...by.values()].sort((a, b) => a[0].publishedAt.localeCompare(b[0].publishedAt));
}

/** Heures entre la première hypothèse et le premier dégât rapporté par la presse ; null si l'un des deux manque. */
export function leadHours(episodes: readonly RejeuEpisode[], press: readonly RejeuPressItem[]): number | null {
  const opened = Math.min(...episodes.map((e) => Date.parse(e.publishedAt)));
  const reported = Math.min(...press.map((p) => Date.parse(p.at)));
  return Number.isFinite(opened) && Number.isFinite(reported) && reported > opened ? Math.round((reported - opened) / 3_600_000) : null;
}

function exposureRow(e: RejeuEpisode): string {
  const x = e.exposure;
  return `<tr><td><b>${escapeHtml(e.name)}</b></td><td>${count(x.urgences)}</td><td>${count(x.passages)}</td><td>${count(x.ehpad)}</td><td>${count(x.ehpadPlaces)}</td><td>${count(x.sevesoHaut)}</td><td>${count(x.sevesoBas)}</td></tr>`;
}

/** Corps de la page (HTML, texte échappé). */
export function rejeuHtml(episodes: readonly RejeuEpisode[] = REJEU_EPISODES, press: readonly RejeuPressItem[] = REJEU_PRESS): string {
  const rows = [...groupEpisodes(episodes).map(episodeRow), ...press.map(pressRow)].sort((a, b) => a.at.localeCompare(b.at));
  const lead = leadHours(episodes, press);
  const timeline = rows.map((r) => `<tr class="anj-${r.kind}"><td class="anj-at">${escapeHtml(when(r.at))}</td><td class="anj-who">${r.kind === 'outil' ? 'France Monitor' : 'Presse'}</td><td>${r.html}</td></tr>`).join('');
  return `<h2>Rejeu · épisode méditerranéen du 4 au 6 novembre 2026</h2>
    <p class="anb-hint"><b>Ce que cette page montre.</b> La règle « crue et inondation » a été écrite le 13 novembre 2026, après l’épisode. Nous l’avons fait tourner sur les relevés que le site avait archivés à l’époque (${REJEU_SNAPSHOTS} relevés, du 4 au 7 novembre) pour voir ce qu’elle aurait affiché, et à quelle heure. Ce n’est pas une prévision réussie : c’est un essai a posteriori, publié avec ses limites.</p>
    <div class="anb-kpis">
      <div class="anb-kpi"><div class="anb-v">${episodes.length}</div><div class="anb-c">départements ouverts par la règle</div></div>
      <div class="anb-kpi"><div class="anb-v">${lead === null ? 'n.d.' : `${lead}${NB}h`}</div><div class="anb-c">entre la première hypothèse et le premier dégât rapporté</div></div>
      <div class="anb-kpi"><div class="anb-v">${press.length}</div><div class="anb-c">articles de dégâts relevés ensuite</div></div>
    </div>
    <section class="anb-box"><h3>Chronologie (heure de Paris)</h3>
      <table class="anb-tbl anj-tl"><tbody>${timeline}</tbody></table>
      <p class="anb-hint">L’heure des hypothèses est celle de la publication de la vigilance par Météo-France : le moteur lit ce relevé chaque minute. L’heure des articles est celle de leur publication.</p></section>
    <section class="anb-box"><h3>Enjeux que la fiche aurait affichés</h3>
      <table class="anb-tbl"><thead><tr><th>Département</th><th>Urgences</th><th>Passages par an</th><th>EHPAD</th><th>Places</th><th>Seveso haut</th><th>Seveso bas</th></tr></thead><tbody>${episodes.map(exposureRow).join('')}</tbody></table>
      <p class="anb-hint">Comptes du département entier, pas de la seule zone touchée. Sources : FINESS, SAE, Géorisques (dates dans chaque fiche).</p></section>
    <section class="anb-box"><h3>Ce que ce rejeu ne prouve pas</h3>
      <ul class="anb-scs">
        <li>La vigilance orange était publique : la règle n’apprend à personne qu’il allait pleuvoir. Elle réunit au même endroit l’échéance, les conséquences attendues, les enjeux du département et les vérifications à faire.</li>
        <li>La règle ouvre un département entier. Elle ne dit pas que Porto-Vecchio serait la commune la plus touchée.</li>
        <li>Un seul épisode : une règle se juge sur son bilan, publié chaque mois, pas sur un cas choisi.</li>
        <li>Les articles sont retenus par mots-clés dans leur titre : un dégât rapporté sans ces mots n’apparaît pas ici.</li>
      </ul>
      <p class="anb-hint"><a href="/anticipation/bilan">Bilan public</a> · <a href="/methodology.html#anticipation">Méthode complète</a></p></section>`;
}

export function renderAnticipationRejeuPage(container: HTMLElement): void {
  document.documentElement.classList.remove('fm-landing-mode');
  document.body.classList.remove('fm-landing-mode');
  document.title = 'Rejeu de l’anticipation · France Monitor';
  container.innerHTML = '';
  const page = document.createElement('div');
  page.className = 'anb-page';
  page.innerHTML = `<header class="anb-top"><a href="/?view=app#live">France Monitor</a><span class="anb-beta">BÊTA · hypothèses à vérifier, pas des prévisions</span></header>
    <main class="anb-wrap"><nav class="anb-nav"><a href="/anticipation/note">Note du jour</a><a href="/anticipation/bilan">Bilan public</a><a href="/methodology.html#anticipation">Méthode</a></nav>
    <div class="anb-main">${rejeuHtml()}</div></main>`;
  container.appendChild(page);
}
