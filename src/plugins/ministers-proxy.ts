import type { Plugin } from 'vite';
import { GOUVERNEMENT } from '../config/government.ts';

function tryParseArray<T>(value: unknown): T[] {
  if (!value) return [];
  if (Array.isArray(value)) return value as T[];
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function slugifyId(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&rsquo;|&#8217;/g, '\'')
    .replace(/&eacute;/g, 'é')
    .replace(/&egrave;/g, 'è')
    .replace(/&ecirc;/g, 'ê')
    .replace(/&agrave;/g, 'à')
    .replace(/&ccedil;/g, 'ç')
    .replace(/&uuml;/g, 'ü');
}

function toTitleCaseName(value: string): string {
  return value
    .toLowerCase()
    .split(/([\s-]+)/)
    .map((part) => {
      if (!/[a-zà-ÿ]/i.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join('');
}

function inferShortTitle(title: string): string {
  const normalized = title.toLowerCase();
  if (normalized.includes('premier ministre')) return 'Premier Ministre';
  if (normalized.includes('président')) return 'Président de la République';
  if (normalized.includes('intelligence artificielle') || normalized.includes('numérique')) return 'Numérique & IA';
  if (normalized.includes('transports')) return 'Transports';
  if (normalized.includes('armées')) return 'Armées';
  if (normalized.includes('santé')) return 'Santé';
  if (normalized.includes('travail')) return 'Travail';
  if (normalized.includes('transition écologique') || normalized.includes('biodiversité')) return 'Écologie';
  if (normalized.includes('affaires étrangères') || normalized.includes('europe')) return 'Affaires étrangères';
  if (normalized.includes('économie') || normalized.includes('finances')) return 'Économie';
  if (normalized.includes('intérieur')) return 'Intérieur';
  return title;
}

function slugifyPerson(prenom: string, nom: string): string {
  return slugifyId(`${prenom} ${nom}`);
}

function absolutizeUrl(url: string, origin: string): string {
  if (!url) return url;
  if (url.startsWith('http')) return url;
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('/')) return `${origin}${url}`;
  return `${origin}/${url.replace(/^\.?\//, '')}`;
}

function isBlockedHtml(html: string): boolean {
  const normalized = html.toLowerCase();
  return normalized.includes('just a moment...')
    || normalized.includes('attention required! | cloudflare')
    || normalized.includes('sorry, you have been blocked')
    || normalized.includes('enable javascript and cookies to continue')
    || normalized.includes('vérification de sécurité')
    || normalized.includes('please enable cookies')
    || normalized.includes('/cdn-cgi/challenge-platform/')
    || normalized.includes('/tspd/');
}

const SCRAPLING_PROXY_URL = process.env['VITE_SCRAPLING_PROXY_URL'] || 'http://localhost:8080';

async function fetchViaScrapling(targetUrl: string): Promise<string | undefined> {
  if (!SCRAPLING_PROXY_URL) return undefined;
  try {
    const proxyUrl = `${SCRAPLING_PROXY_URL}/scrape?url=${encodeURIComponent(targetUrl)}`;
    const response = await fetch(proxyUrl, {
      headers: { 'Accept': 'text/html' },
      signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(20000) : undefined,
    });
    if (!response.ok) return undefined;
    return await response.text();
  } catch {
    return undefined;
  }
}

async function fetchPageHtml(url: string, timeoutMs = 6000): Promise<string | undefined> {
  const signal = typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined;

  // For specific Cloudflare-heavy domains, try Scrapling first in dev/proxy mode
  if (url.includes('elysee.fr') || url.includes('info.gouv.fr')) {
    const scraped = await fetchViaScrapling(url);
    if (scraped && !isBlockedHtml(scraped)) return scraped;
  }

  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml',
        'User-Agent': 'Mozilla/5.0 (compatible; FranceMonitor/2.0; +https://france-monitor.vercel.app)',
      },
      signal,
    });
    if (!response.ok) {
      // Fallback to Scrapling if direct fetch fails (e.g. 403 Forbidden)
      return await fetchViaScrapling(url);
    }
    const html = await response.text();
    if (!html || isBlockedHtml(html)) {
      return await fetchViaScrapling(url);
    }
    return html;
  } catch {
    return await fetchViaScrapling(url);
  }
}

function extractProfilePhoto(html: string, pageUrl: string): string | undefined {
  const pageOrigin = new URL(pageUrl).origin;
  const ogMatch = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i);
  if (ogMatch?.[1]) return absolutizeUrl(ogMatch[1].trim(), pageOrigin);
  const srcSetMatch = html.match(/<source[^>]+srcset="([^"]+)"/i);
  if (srcSetMatch?.[1]) {
    const firstCandidate = srcSetMatch[1].split(',')[0]?.trim().split(/\s+/)[0];
    if (firstCandidate && !firstCandidate.startsWith('data:')) {
      return absolutizeUrl(firstCandidate, pageOrigin);
    }
  }
  const linkedImageMatch = html.match(/<a[^>]+href="([^"]+\.(?:jpg|jpeg|png|webp))"[^>]*>[\s\S]*?<img[^>]+alt="[^"]*Image/i);
  if (linkedImageMatch?.[1]) return absolutizeUrl(linkedImageMatch[1].trim(), pageOrigin);
  const imagePatterns = [
    /<img[^>]+src="([^"]+)"[^>]+alt="[^"]*Portrait officiel/i,
    /<img[^>]+src="([^"]+)"[^>]+alt="[^"]*Image d'illustration/i,
    /<div[^>]+class="[^"]*fr-content-media__img[^"]*"[\s\S]*?<img[^>]+src="([^"]+)"/i,
    /<main[\s\S]*?<img[^>]+src="([^"]+)"[^>]*>/i,
    /<h1[^>]*>[\s\S]*?<\/h1>[\s\S]*?<img[^>]+src="([^"]+)"[^>]*>/i,
    /Image d'illustration[\s\S]*?<img[^>]+src="([^"]+)"[^>]*>/i,
    /<img[^>]+src="([^"]+)"[^>]*alt="[^"]*Image/i,
  ];

  for (const pattern of imagePatterns) {
    const match = html.match(pattern);
    const src = match?.[1]?.trim();
    if (!src) continue;
    if (src.includes('data:image')) continue;
    return absolutizeUrl(src, pageOrigin);
  }
  return undefined;
}

function extractOfficialBio(html: string): string | undefined {
  const bioMatch = html.match(/<h2[^>]*>\s*Biographie(?:&nbsp;|\s)*<\/h2>([\s\S]*?)(?:<h2[^>]*>|<h3[^>]*>\s*Mission\s*<\/h3>|##\s*Mission|$)/i);
  if (!bioMatch?.[1]) return undefined;
  const text = normalizeAgendaText(bioMatch[1]);
  return text.length > 280 ? `${text.slice(0, 277)}...` : text;
}

function buildProfileCandidates(minister: { prenom: string; nom: string; siteMinistere?: string; sourceUrl?: string; isPresident?: boolean }): Array<{ url: string; label: string }> {
  const personSlug = slugifyPerson(minister.prenom, minister.nom);
  const candidates: Array<{ url: string; label: string }> = [];

  if (minister.isPresident) {
    candidates.push({ url: 'https://www.elysee.fr/emmanuel-macron', label: 'Élysée' });
  }

  candidates.push({ url: `https://www.info.gouv.fr/personnalite/${personSlug}`, label: 'info.gouv.fr' });

  if (minister.siteMinistere) {
    try {
      const siteUrl = new URL(minister.siteMinistere);
      const trimmedPath = siteUrl.pathname.replace(/\/$/, '');
      const base = `${siteUrl.origin}${trimmedPath}`;
      if (siteUrl.hostname.includes('transports.gouv.fr')) {
        candidates.push({ url: `https://www.ecologie.gouv.fr/${personSlug}`, label: 'www.ecologie.gouv.fr' });
      } else {
        candidates.push({ url: `${base}/${personSlug}`.replace(/([^:]\/)\/+/g, '$1'), label: siteUrl.hostname });
        candidates.push({ url: base, label: siteUrl.hostname });
      }
    } catch {
      // ignore malformed URL
    }
  }

  if (minister.sourceUrl) {
    candidates.push({ url: minister.sourceUrl, label: 'Source officielle' });
  }

  return candidates.filter((candidate, index, array) =>
    array.findIndex((item) => item.url === candidate.url) === index
  );
}

async function fetchOfficialProfileMeta(minister: { prenom: string; nom: string; siteMinistere?: string; sourceUrl?: string; isPresident?: boolean }): Promise<{ photoUrl?: string; bioShort?: string; agendaUrl?: string; profileUrl: string; sourceLabel: string }> {
  const candidates = buildProfileCandidates(minister);

  for (const candidate of candidates) {
    try {
      const html = await fetchPageHtml(candidate.url);
      if (!html) continue;
      const directAgenda = parseAgendaSectionFromHtml(html, candidate.url, candidate.label);
      return {
        profileUrl: candidate.url,
        sourceLabel: candidate.label,
        photoUrl: extractProfilePhoto(html, candidate.url),
        bioShort: extractOfficialBio(html),
        agendaUrl: extractAgendaLink(html) ?? (directAgenda.length > 0 ? candidate.url : undefined),
      };
    } catch {
      // try next source
    }
  }

  const fallback = candidates[0] ?? { url: '', label: 'Source officielle' };
  return {
    profileUrl: fallback.url,
    sourceLabel: fallback.label,
  };
}

function extractAgendaLink(html: string): string | undefined {
  const match = html.match(/<a[^>]+href="([^"]+)"[^>]*>\s*Consulter l[’'`]agenda de/i);
  if (!match?.[1]) return undefined;
  if (match[1].startsWith('http')) return match[1];
  if (match[1].startsWith('/')) return `https://www.info.gouv.fr${match[1]}`;
  return undefined;
}

function extractDownloadLink(html: string, extension: 'csv' | 'pdf', pageUrl: string): string | undefined {
  const escaped = extension.replace('.', '\\.');
  const patterns = [
    new RegExp(`<a[^>]+href="([^"]+\\.${escaped}[^"]*)"[^>]*>\\s*T[ée]l[ée]charger l'agenda en \\.${escaped}`, 'i'),
    new RegExp(`<a[^>]+href="([^"]+\\.${escaped}[^"]*)"[^>]*>`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    const href = match?.[1]?.trim();
    if (!href) continue;
    return absolutizeUrl(href, new URL(pageUrl).origin);
  }
  return undefined;
}

function normalizeAgendaText(value: string): string {
  return decodeHtmlEntities(stripTags(value))
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i] ?? '';
    const next = line[i + 1] ?? '';
    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === delimiter && !inQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }

  values.push(current.trim());
  return values.map((value) => value.replace(/^\uFEFF/, '').trim());
}

function normalizeHeader(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function detectDelimiter(sample: string): string {
  const firstLine = sample.split(/\r?\n/).find((line) => line.trim()) ?? '';
  const counts = [
    { delimiter: ';', count: (firstLine.match(/;/g) ?? []).length },
    { delimiter: '\t', count: (firstLine.match(/\t/g) ?? []).length },
    { delimiter: ',', count: (firstLine.match(/,/g) ?? []).length },
  ];
  return counts.sort((a, b) => b.count - a.count)[0]?.delimiter ?? ';';
}

function toIsoDate(dateValue?: string, timeValue?: string): string | undefined {
  const rawDate = (dateValue ?? '').trim();
  const rawTime = (timeValue ?? '').trim();
  if (!rawDate) return undefined;

  const numeric = rawDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (numeric) {
    const [, day, month, year] = numeric;
    const safeTime = rawTime.match(/^(\d{1,2})[:h](\d{2})$/i);
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${safeTime?.[1]?.padStart(2, '0') ?? '00'}:${safeTime?.[2] ?? '00'}:00+01:00`;
  }

  const parsed = new Date(rawTime ? `${rawDate} ${rawTime}` : rawDate);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

function formatDateDisplay(dateValue?: string, timeValue?: string): string {
  const rawDate = (dateValue ?? '').trim();
  const rawTime = (timeValue ?? '').trim();
  if (rawDate && rawTime) return `${rawDate} ${rawTime}`;
  return rawDate || rawTime || 'Agenda officiel';
}

function parseAgendaCsv(csv: string, sourceUrl: string, sourceLabel: string): Array<{ title: string; date: string; location?: string; sourceLabel: string; url: string; _isoDate?: string }> {
  const lines = csv
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const delimiter = detectDelimiter(lines.join('\n'));
  const rows = lines.map((line) => parseCsvLine(line, delimiter));
  const header = rows[0]?.map(normalizeHeader) ?? [];
  const dataRows = rows.slice(1);

  const headerIndex = (patterns: RegExp[]): number =>
    header.findIndex((value) => patterns.some((pattern) => pattern.test(value)));

  const titleIndex = headerIndex([/\btitre\b/, /\bobjet\b/, /\bsummary\b/, /\bevenement\b/, /\bintitule\b/, /\bsubject\b/]);
  const dateIndex = headerIndex([/\bdate\b/, /\bjour\b/, /\bstart date\b/, /\bdate debut\b/]);
  const timeIndex = headerIndex([/\bheure\b/, /\bhoraire\b/, /\btime\b/, /\bstart time\b/, /\bheure debut\b/]);
  const locationIndex = headerIndex([/\blieu\b/, /\badresse\b/, /\blocation\b/, /\bplace\b/]);
  const descriptionIndex = headerIndex([/\bdescription\b/, /\bdetails\b/, /\bdetail\b/, /\bcontenu\b/]);
  const startIndex = headerIndex([/\bstart\b/, /\bdebut\b/, /\bdateheure debut\b/]);

  const items = dataRows.map((row) => {
    const rawStart = startIndex !== -1 ? row[startIndex] : undefined;
    const isoDate = toIsoDate(dateIndex !== -1 ? row[dateIndex] : rawStart, timeIndex !== -1 ? row[timeIndex] : undefined);
    const title = row[titleIndex] || row[descriptionIndex] || row.find((value) => value && value !== row[dateIndex] && value !== row[timeIndex]) || 'Événement';
    const location = locationIndex !== -1 ? row[locationIndex] : undefined;
    return {
      title: normalizeAgendaText(title),
      date: formatDateDisplay(dateIndex !== -1 ? row[dateIndex] : rawStart, timeIndex !== -1 ? row[timeIndex] : undefined),
      location: location ? normalizeAgendaText(location) : undefined,
      sourceLabel,
      url: sourceUrl,
      _isoDate: isoDate,
    };
  }).filter((item) => item.title && item.title !== 'Événement');

  return items;
}

async function fetchAgendaPageItems(agendaUrl: string): Promise<Array<{ title: string; date: string; location?: string; sourceLabel: string; url?: string; _isoDate?: string }>> {
  const agendaHtml = await fetchPageHtml(agendaUrl);
  if (!agendaHtml) {
    return [{
      title: `Consulter l'agenda officiel`,
      date: 'Agenda officiel',
      sourceLabel: new URL(agendaUrl).hostname,
      url: agendaUrl,
    }];
  }

  const parsedHtmlItems = parseAgendaSectionFromHtml(agendaHtml, agendaUrl, new URL(agendaUrl).hostname);
  if (parsedHtmlItems.length > 0) return sortAgendaByDateDesc(parsedHtmlItems);

  const csvUrl = extractDownloadLink(agendaHtml, 'csv', agendaUrl);
  if (csvUrl) {
    try {
      const csvResponse = await fetch(csvUrl, {
        headers: { 'Accept': 'text/csv,text/plain,*/*' },
        signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(10000) : undefined,
      });
      if (csvResponse.ok) {
        const csvText = await csvResponse.text();
        const parsedCsvItems = parseAgendaCsv(csvText, csvUrl, 'info.gouv.fr (CSV)');
        if (parsedCsvItems.length > 0) return sortAgendaByDateDesc(parsedCsvItems);
      }
    } catch {
      // fall back to download link
    }
    return [{
      title: `Télécharger l'agenda officiel`,
      date: 'Agenda officiel',
      sourceLabel: 'info.gouv.fr (CSV)',
      url: csvUrl,
    }];
  }

  const pdfUrl = extractDownloadLink(agendaHtml, 'pdf', agendaUrl);
  if (pdfUrl) {
    return [{
      title: `Télécharger l'agenda officiel`,
      date: 'Agenda officiel',
      sourceLabel: 'info.gouv.fr (PDF)',
      url: pdfUrl,
    }];
  }

  return [{
    title: `Consulter l'agenda officiel`,
    date: 'Agenda officiel',
    sourceLabel: new URL(agendaUrl).hostname,
    url: agendaUrl,
  }];
}

function extractAgendaSectionHtml(html: string): string | undefined {
  return html.match(/<div id="block-customer-specifics-latest-agenda-minister">([\s\S]*?)(?:<div class="paragraph paragraph--type--text paragraph--view-mode--default">|$)/i)?.[1]
    ?? html.match(/<h2[^>]*>\s*Agenda\s*<\/h2>([\s\S]*?)(?:<h2[^>]*>|$)/i)?.[1]
    ?? html.match(/##\s*Agenda([\s\S]*?)(?:##|$)/i)?.[1];
}

function parseAgendaSectionFromHtml(html: string, sourceUrl: string, sourceLabel: string): Array<{ title: string; date: string; location?: string; sourceLabel: string; url: string }> {
  const sectionHtml = extractAgendaSectionHtml(html);
  if (!sectionHtml) return [];

  const paragraphs = Array.from(sectionHtml.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi))
    .map((match) => normalizeAgendaText(match[1] ?? ''))
    .filter(Boolean);

  if (paragraphs.length > 0) {
    const items: Array<{ title: string; date: string; location?: string; sourceLabel: string; url: string }> = [];
    let currentDate = '';

    for (let i = 0; i < paragraphs.length; i++) {
      const line = paragraphs[i] ?? '';
      if (/^(Lundi|Mardi|Mercredi|Jeudi|Vendredi|Samedi|Dimanche)\b/i.test(line)) {
        currentDate = line;
        continue;
      }
      if (!/^(\d{1,2}h\d{0,2}|Journée|Matinée|Après-midi|Soirée)\b/i.test(line)) {
        continue;
      }

      let location: string | undefined;
      const next = paragraphs[i + 1] ?? '';
      if (next && !/^(Lundi|Mardi|Mercredi|Jeudi|Vendredi|Samedi|Dimanche|\d{1,2}h\d{0,2}|Journée|Matinée|Après-midi|Soirée)\b/i.test(next)) {
        location = next;
        i += 1;
      }

      items.push({
        title: line,
        date: currentDate || 'Agenda officiel',
        location,
        sourceLabel,
        url: sourceUrl,
      });
    }

    if (items.length > 0) return items.slice(0, 12);
  }

  const text = normalizeAgendaText(sectionHtml)
    .replace(/(Lundi|Mardi|Mercredi|Jeudi|Vendredi|Samedi|Dimanche)/g, '\n$1')
    .replace(/(\d{1,2}h\d{0,2}\s*:)/gi, '\n$1')
    .replace(/(Journée|Matinée|Après-midi|Soirée)\s*:/gi, '\n$1:');

  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const items: Array<{ title: string; date: string; location?: string; sourceLabel: string; url: string }> = [];
  let currentDate = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/^(Lundi|Mardi|Mercredi|Jeudi|Vendredi|Samedi|Dimanche)\b/i.test(line)) {
      currentDate = line;
      continue;
    }
    if (!/^(\d{1,2}h\d{0,2}|Journée|Matinée|Après-midi|Soirée)\b/i.test(line)) continue;

    let location: string | undefined;
    const next = lines[i + 1] ?? '';
    const nextNext = lines[i + 2] ?? '';
    if (next && !/^(Lundi|Mardi|Mercredi|Jeudi|Vendredi|Samedi|Dimanche|\d{1,2}h\d{0,2}|Journée|Matinée|Après-midi|Soirée)\b/i.test(next)) {
      location = next;
      if (nextNext && !/^(Lundi|Mardi|Mercredi|Jeudi|Vendredi|Samedi|Dimanche|\d{1,2}h\d{0,2}|Journée|Matinée|Après-midi|Soirée)\b/i.test(nextNext)) {
        location = `${location} · ${nextNext}`;
      }
    }

    items.push({
      title: line,
      date: currentDate || 'Agenda officiel',
      location,
      sourceLabel,
      url: sourceUrl,
    });
  }

  return items.slice(0, 12);
}

// ─── Date/sort utilities ──────────────────────────────────────────────────────

function parseRfc2822DateFR(raw: string): { iso: string; display: string } | null {
  try {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return null;
    const display = d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
    return { iso: d.toISOString(), display };
  } catch {
    return null;
  }
}

function sortAgendaByDateDesc<T extends { _isoDate?: string; date: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const aTs = a._isoDate ? new Date(a._isoDate).getTime() : (a.date.match(/^\d{4}-\d{2}-\d{2}/) ? new Date(a.date).getTime() : 0);
    const bTs = b._isoDate ? new Date(b._isoDate).getTime() : (b.date.match(/^\d{4}-\d{2}-\d{2}/) ? new Date(b.date).getTime() : 0);
    if (!aTs) return 1;
    if (!bTs) return -1;
    return bTs - aTs;
  });
}

// ─── Elysée agenda (robust: RSS first, HTML fallback, never empty) ─────────────

async function fetchElyseeAgenda(): Promise<Array<{ title: string; date: string; location?: string; sourceLabel: string; url?: string }>> {
  // 1. Try Elysée RSS (less Cloudflare-protected)
  try {
    const signal = typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(5000) : undefined;
    const r = await fetch('https://www.elysee.fr/rss/actualites.xml', {
      headers: { 'Accept': 'application/rss+xml, text/xml', 'User-Agent': 'FranceMonitor/2.0' },
      signal,
    });
    if (r.ok) {
      const xml = await r.text();
      if (!isBlockedHtml(xml) && xml.includes('<item>')) {
        const rssItems: Array<{ title: string; date: string; _isoDate?: string; sourceLabel: string; url?: string }> = [];
        const itemRegex = /<item>([\s\S]*?)<\/item>/g;
        let m: RegExpExecArray | null;
        while ((m = itemRegex.exec(xml)) !== null && rssItems.length < 10) {
          const titleMatch = m[1].match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>([^<]*)<\/title>/);
          const dateMatch = m[1].match(/<pubDate>([^<]*)<\/pubDate>/);
          const linkMatch = m[1].match(/<link>([^<]*)<\/link>|<link[^>]+href="([^"]+)"/);
          if (!titleMatch) continue;
          const rawDate = dateMatch?.[1]?.trim() ?? '';
          const parsed = rawDate ? parseRfc2822DateFR(rawDate) : null;
          rssItems.push({
            title: (titleMatch[1] ?? titleMatch[2] ?? '').trim(),
            date: parsed?.display ?? rawDate,
            _isoDate: parsed?.iso,
            sourceLabel: 'Élysée',
            url: (linkMatch?.[1] ?? linkMatch?.[2] ?? '').trim() || 'https://www.elysee.fr/toutes-les-actualites',
          });
        }
        if (rssItems.length > 0) {
          return sortAgendaByDateDesc(rssItems).slice(0, 8).map(({ _isoDate: _d, ...rest }) => rest);
        }
      }
    }
  } catch { /* RSS failed, fall through */ }

  // 2. HTML fallback
  const html = await fetchPageHtml('https://www.elysee.fr/toutes-les-actualites', 5000);
  if (html) {
    const items: Array<{ title: string; date: string; _isoDate?: string; sourceLabel: string; url?: string }> = [];
    const articleRegex = /<a[^>]+href="([^"]+)"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>[\s\S]*?<time[^>]*datetime="([^"]*)"[^>]*>([\s\S]*?)<\/time>/g;
    let match: RegExpExecArray | null;
    while ((match = articleRegex.exec(html)) !== null && items.length < 10) {
      const href = match[1]?.trim();
      const title = normalizeAgendaText(match[2] ?? '');
      const isoDate = match[3]?.trim();
      const dateDisplay = normalizeAgendaText(match[4] ?? '');
      if (!href || !title) continue;
      items.push({
        title,
        date: dateDisplay || isoDate || 'Élysée',
        _isoDate: isoDate || undefined,
        sourceLabel: 'Élysée',
        url: href.startsWith('http') ? href : `https://www.elysee.fr${href}`,
      });
    }
    if (items.length > 0) {
      return sortAgendaByDateDesc(items).slice(0, 8).map(({ _isoDate: _d, ...rest }) => rest);
    }
  }

  // 3. Guaranteed non-empty fallback link
  return [{
    title: 'Actualités et agenda du Président de la République',
    date: 'Agenda officiel',
    sourceLabel: 'Élysée',
    url: 'https://www.elysee.fr/toutes-les-actualites',
  }];
}

// ─── Official agenda (ministers) ─────────────────────────────────────────────

async function fetchOfficialAgenda(minister: { prenom: string; nom: string; isPM?: boolean; isPresident?: boolean; agendaUrl?: string }): Promise<Array<{ title: string; date: string; location?: string; sourceLabel: string; url?: string }>> {
  if (minister.isPresident) {
    return fetchElyseeAgenda();
  }

  const fallbackMinister = GOUVERNEMENT.find((entry) =>
    entry.prenom === minister.prenom && entry.nom === minister.nom
  );

  // Prioritize a known direct agendaUrl (avoids a full profile-page scrape)
  const knownAgendaUrl = minister.agendaUrl ?? fallbackMinister?.agendaUrl;
  if (knownAgendaUrl) {
    try {
      if (knownAgendaUrl.includes('/agenda/ministre/')) {
        return await fetchAgendaPageItems(knownAgendaUrl);
      }
      const profileHtml = await fetchPageHtml(knownAgendaUrl);
      if (profileHtml) {
        const directItems = parseAgendaSectionFromHtml(profileHtml, knownAgendaUrl, new URL(knownAgendaUrl).hostname);
        if (directItems.length > 0) return sortAgendaByDateDesc(directItems);
        const linkedAgendaUrl = extractAgendaLink(profileHtml);
        if (linkedAgendaUrl) {
          return await fetchAgendaPageItems(linkedAgendaUrl);
        }
      }
    } catch { /* fall through */ }
    // URL is known even if page is not reachable
    return [{
      title: `Consulter l'agenda officiel de ${minister.prenom} ${minister.nom}`,
      date: 'Agenda officiel',
      sourceLabel: new URL(knownAgendaUrl).hostname,
      url: knownAgendaUrl,
    }];
  }

  const candidates = buildProfileCandidates({
    ...minister,
    siteMinistere: fallbackMinister?.siteMinistere,
    sourceUrl: fallbackMinister?.sourceUrl,
  });

  for (const candidate of candidates) {
    try {
      const profileHtml = await fetchPageHtml(candidate.url);
      if (!profileHtml) continue;

      const directAgenda = parseAgendaSectionFromHtml(profileHtml, candidate.url, candidate.label);
      if (directAgenda.length > 0) return sortAgendaByDateDesc(directAgenda);

      const agendaUrl = extractAgendaLink(profileHtml);
      if (!agendaUrl) continue;

      if (agendaUrl.includes('/agenda/ministre/')) {
        return await fetchAgendaPageItems(agendaUrl);
      }

      const agendaHtml = await fetchPageHtml(agendaUrl);
      if (!agendaHtml) {
        return [{
          title: `Consulter l'agenda officiel de ${minister.prenom} ${minister.nom}`,
          date: 'Agenda officiel',
          sourceLabel: candidate.label,
          url: agendaUrl,
        }];
      }
      const parsed = parseAgendaSectionFromHtml(agendaHtml, agendaUrl, new URL(agendaUrl).hostname);
      if (parsed.length > 0) return sortAgendaByDateDesc(parsed);

      return [{
        title: `Consulter l'agenda officiel de ${minister.prenom} ${minister.nom}`,
        date: 'Agenda officiel',
        sourceLabel: candidate.label,
        url: agendaUrl,
      }];
    } catch {
      continue;
    }
  }

  // Guaranteed fallback for any minister if no agenda found
  const fallback = buildProfileCandidates(minister)[0] ?? { url: 'https://www.info.gouv.fr/gouvernement/composition-du-gouvernement', label: 'info.gouv.fr' };
  return [{
    title: `Consulter l'actualité et l'agenda de ${minister.prenom} ${minister.nom}`,
    date: 'Agenda officiel',
    sourceLabel: fallback.label,
    url: fallback.url,
  }];
}

function normalizeMinisterFromLine(line: string) {
  const match = line.match(/^(M\.|Mme)\s+(.+?),\s+(.+?);?$/);
  if (!match) return null;

  const rawName = match[2]?.trim() ?? '';
  const title = match[3]?.trim() ?? '';
  if (!rawName || !title) return null;

  const nameParts = rawName.split(/\s+/).filter(Boolean);
  if (nameParts.length < 2) return null;

  const lastNameParts: string[] = [];
  while (nameParts.length > 1) {
    const candidate = nameParts[nameParts.length - 1] ?? '';
    if (candidate === candidate.toUpperCase()) {
      lastNameParts.unshift(nameParts.pop() ?? '');
      continue;
    }
    break;
  }
  if (lastNameParts.length === 0) {
    lastNameParts.unshift(nameParts.pop() ?? '');
  }

  const prenom = toTitleCaseName(nameParts.join(' '));
  const nom = toTitleCaseName(lastNameParts.join(' '));
  const ministerId = title.toLowerCase().includes('premier ministre')
    ? 'pm'
    : slugifyId(title);

  return {
    id: ministerId,
    prenom,
    nom,
    titre: title.charAt(0).toUpperCase() + title.slice(1),
    titreShort: inferShortTitle(title),
    isPM: title.toLowerCase().includes('premier ministre'),
  };
}

async function fetchPrimeMinisterRecord(): Promise<Record<string, unknown> | null> {
  const apiUrl = 'https://api-lannuaire.service-public.gouv.fr/api/explore/v2.1/catalog/datasets/api-lannuaire-administration/records?limit=10&where=nom%20like%20%22Premier%25%22';
  const r = await fetch(apiUrl, { headers: { Accept: 'application/json' } });
  const data = await r.json() as { results?: Array<Record<string, unknown>> };
  return (data.results ?? []).find((item) => item.nom === 'Premier ministre') ?? null;
}

async function fetchGovernmentCompositionFromJORF(): Promise<Array<Record<string, unknown>>> {
  const record = await fetchPrimeMinisterRecord();
  if (!record) return [];

  type Reference = { libelle?: string; valeur?: string };
  const references = tryParseArray<Reference>(record.texte_reference);
  const compositionUrl = references.find((item) =>
    item.libelle?.toLowerCase().includes('composition du gouvernement')
  )?.valeur;
  if (!compositionUrl) return [];

  const page = await fetch(compositionUrl, { headers: { Accept: 'text/html' } });
  const html = await page.text();
  const articleMatch = html.match(/Sont nommés ministres\s*:\s*([\s\S]*?)Versions/);
  if (!articleMatch) return [];

  const text = stripTags(articleMatch[1])
    .replace(/\s*;\s*/g, ';\n')
    .replace(/\s*Mme\s/g, '\nMme ')
    .replace(/\sM\.\s/g, '\nM. ');

  const ministers = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => normalizeMinisterFromLine(line))
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .map((item) => ({
      ...item,
      sourceLabel: 'JORF',
      sourceUrl: compositionUrl,
      sourceUpdatedAt: typeof record.date_modification_datetime === 'string' ? record.date_modification_datetime : undefined,
    }));

  return ministers;
}

export function ministersProxyPlugin(): Plugin {
  return {
    name: 'ministers-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/ministers/')) return next();

        const url = new URL(req.url, 'http://localhost');

        if (req.url.startsWith('/api/ministers/profile-meta')) {
          const prenom = url.searchParams.get('prenom')?.trim() ?? '';
          const nom = url.searchParams.get('nom')?.trim() ?? '';
          if (!prenom || !nom) { res.statusCode = 400; res.end('{}'); return; }
          try {
            const fallbackMinister = GOUVERNEMENT.find((entry) => entry.prenom === prenom && entry.nom === nom);
            const meta = await fetchOfficialProfileMeta({
              prenom,
              nom,
              siteMinistere: fallbackMinister?.siteMinistere,
              sourceUrl: fallbackMinister?.sourceUrl,
              isPresident: fallbackMinister?.isPresident,
            });
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(meta));
          } catch {
            res.statusCode = 502;
            res.end('{}');
          }
          return;
        }

        if (req.url.startsWith('/api/ministers/wikidata-search')) {
          const name = url.searchParams.get('name') ?? '';
          if (!name) { res.statusCode = 400; res.end('{}'); return; }
          try {
            const apiUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=fr&format=json&limit=8&type=item`;
            const r = await fetch(apiUrl, { headers: { Accept: 'application/json', 'User-Agent': 'FranceMonitor/2.0' } });
            const data = await r.json() as { search?: Array<Record<string, unknown>> };
            const POLITICAL_KEYWORDS = [
              'politi', 'ministre', 'premier', 'etat', '\u00e9tat', 'fonctionnaire',
              'depute', 'deputy', 'd\u00e9put\u00e9', 'senator', 's\u00e9nateur',
              'pr\u00e9sident', 'president', 'ambassad', 'secretaire', 'secr\u00e9taire',
              'maire', '\u00e9lu', 'elu', 'personnalite', 'governor', 'officier',
              'homme d', 'femme d', 'homme de', 'femme de',
            ];
            const result = (data.search ?? []).find((item) => {
              const description = typeof item.description === 'string' ? item.description.toLowerCase() : '';
              return POLITICAL_KEYWORDS.some(k => description.includes(k));
            }) ?? data.search?.[0];
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(result ?? {}));
          } catch {
            res.statusCode = 502;
            res.end('{}');
          }
          return;
        }

        // ── Wikidata entity ──
        if (req.url.startsWith('/api/ministers/wikidata')) {
          const id = url.searchParams.get('id') ?? '';
          if (!id) { res.statusCode = 400; res.end('{}'); return; }
          try {
            const apiUrl = `https://www.wikidata.org/wiki/Special:EntityData/${id}.json`;
            const r = await fetch(apiUrl, { headers: { 'Accept': 'application/json' } });
            const data = await r.json();
            const entity = data?.entities?.[id] ?? {};
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(entity));
          } catch { res.statusCode = 502; res.end('{}'); }
          return;
        }

        // ── Premier ministre (annuaire officiel DILA) ──
        if (req.url.startsWith('/api/ministers/prime-minister')) {
          try {
            const record = await fetchPrimeMinisterRecord();
            if (!record) {
              res.statusCode = 404;
              res.end('{}');
              return;
            }

            type Assignment = {
              fonction?: string;
              personne?: {
                nom?: string;
                prenom?: string;
                texte_reference?: Array<{ libelle?: string; valeur?: string }>;
                adresse_courriel?: Array<{ valeur?: string }>;
              };
            };
            type Site = { valeur?: string };
            type Phone = { valeur?: string };

            const assignments = tryParseArray<Assignment>(record.affectation_personne);
            const pmAssignment =
              assignments.find((item) => item.fonction?.toLowerCase() === 'premier ministre') ??
              assignments[0];
            const sites = tryParseArray<Site>(record.site_internet);
            const phones = tryParseArray<Phone>(record.telephone);
            const references = pmAssignment?.personne?.texte_reference ?? [];
            const emails = pmAssignment?.personne?.adresse_courriel ?? [];
            const decreeReferences = tryParseArray<{ libelle?: string; valeur?: string }>(record.texte_reference);
            const compositionReference = decreeReferences.find((item) => item.libelle?.toLowerCase().includes('composition du gouvernement'));

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              titre: pmAssignment?.fonction ?? 'Premier ministre',
              prenom: pmAssignment?.personne?.prenom ?? '',
              nom: pmAssignment?.personne?.nom ?? '',
              servicePublicUrl: typeof record.url_service_public === 'string' ? record.url_service_public : undefined,
              siteMinistere: sites[0]?.valeur,
              officePhone: phones[0]?.valeur,
              officeEmail: typeof record.adresse_courriel === 'string' && record.adresse_courriel
                ? record.adresse_courriel
                : emails[0]?.valeur,
              appointmentUrl: references[0]?.valeur,
              appointmentLabel: references[0]?.libelle,
              sourceLabel: 'Service-Public / JORF',
              sourceUrl: compositionReference?.valeur ?? references[0]?.valeur,
              sourceUpdatedAt: typeof record.date_modification_datetime === 'string' ? record.date_modification_datetime : undefined,
              typeOrganisme: typeof record.type_organisme === 'string' ? record.type_organisme : undefined,
            }));
          } catch {
            res.statusCode = 502;
            res.end('{}');
          }
          return;
        }

        if (req.url.startsWith('/api/ministers/composition')) {
          try {
            const composition = await fetchGovernmentCompositionFromJORF();
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(composition));
          } catch {
            res.statusCode = 502;
            res.end('[]');
          }
          return;
        }

        if (req.url.startsWith('/api/ministers/opendata')) {
          const query = url.searchParams.get('query')?.trim() ?? '';
          if (!query) { res.statusCode = 400; res.end('[]'); return; }
          try {
            const apiUrl = `https://www.data.gouv.fr/api/1/datasets/?q=${encodeURIComponent(query)}&page_size=3`;
            const r = await fetch(apiUrl, { headers: { Accept: 'application/json' } });
            const data = await r.json() as { data?: Array<Record<string, unknown>> };
            const datasets = (data.data ?? []).map((dataset) => {
              const resources = Array.isArray(dataset.resources) ? dataset.resources as Array<Record<string, unknown>> : [];
              return {
                id: dataset.id,
                title: dataset.title,
                url: dataset.page ? `https://www.data.gouv.fr${dataset.page}` : undefined,
                description: dataset.description_short ?? dataset.description,
                organization: typeof dataset.organization === 'object' && dataset.organization && 'name' in dataset.organization
                  ? dataset.organization.name
                  : undefined,
                lastUpdate: dataset.last_update,
                createdAt: dataset.created_at,
                license: typeof dataset.license === 'string' ? dataset.license : undefined,
                resourceCount: resources.length,
                resources: resources.slice(0, 6).map((resource) => ({
                  id: resource.id,
                  title: resource.title ?? resource.name,
                  type: resource.type,
                  format: resource.format,
                  url: resource.url,
                  latest: resource.latest,
                  lastModified: resource.last_modified,
                })),
              };
            });
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(datasets));
          } catch {
            res.statusCode = 502;
            res.end('[]');
          }
          return;
        }

        // ── RSS agenda ministère ──
        if (req.url.startsWith('/api/ministers/agenda')) {
          const ministerId = url.searchParams.get('id') ?? '';
          const minister = GOUVERNEMENT.find(m => m.id === ministerId);
          if (minister) {
            try {
              const officialItems = await fetchOfficialAgenda(minister);
              if (officialItems.length > 0) {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(officialItems));
                return;
              }
              const meta = await fetchOfficialProfileMeta({
                prenom: minister.prenom,
                nom: minister.nom,
                siteMinistere: minister.siteMinistere,
                sourceUrl: minister.sourceUrl,
                isPresident: minister.isPresident,
              });
              if (meta.agendaUrl) {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify([{
                  title: `Consulter l'agenda officiel de ${minister.prenom} ${minister.nom}`,
                  date: 'Agenda officiel',
                  sourceLabel: meta.sourceLabel,
                  url: meta.agendaUrl,
                }]));
                return;
              }
            } catch {
              // continue on RSS fallback
            }
          }

          if (!minister?.rssUrl) { res.end('[]'); return; }
          try {
            const signal = typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(6000) : undefined;
            const r = await fetch(minister.rssUrl, {
              headers: { 'Accept': 'application/rss+xml, text/xml', 'User-Agent': 'FranceMonitor/2.0' },
              signal,
            });
            const xml = await r.text();
            if (!r.ok || isBlockedHtml(xml)) { res.end('[]'); return; }
            // Parse RSS items — up to 10 items with date conversion + sort
            const rssItems: Array<{ title: string; date: string; _isoDate?: string; sourceLabel: string; url?: string }> = [];
            const itemRegex = /<item>([\s\S]*?)<\/item>/g;
            let m: RegExpExecArray | null;
            while ((m = itemRegex.exec(xml)) !== null && rssItems.length < 10) {
              const titleMatch = m[1].match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>([^<]*)<\/title>/);
              const dateMatch = m[1].match(/<pubDate>([^<]*)<\/pubDate>/);
              const linkMatch = m[1].match(/<link>([^<]*)<\/link>|<link[^>]+href="([^"]+)"/);
              if (!titleMatch) continue;
              const rawDate = dateMatch?.[1]?.trim() ?? '';
              const parsed = rawDate ? parseRfc2822DateFR(rawDate) : null;
              rssItems.push({
                title: (titleMatch[1] ?? titleMatch[2] ?? '').trim(),
                date: parsed?.display ?? rawDate,
                _isoDate: parsed?.iso,
                sourceLabel: 'RSS officiel',
                url: (linkMatch?.[1] ?? linkMatch?.[2] ?? '').trim() || minister.rssUrl,
              });
            }
            const sorted = sortAgendaByDateDesc(rssItems).slice(0, 8).map(({ _isoDate: _d, ...rest }) => rest);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(sorted));
          } catch { res.end('[]'); }
          return;
        }

        next();
      });
    },
  };
}
