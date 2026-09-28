/**
 * classification-guards.ts — Qualification du titre pour le classifieur kw-2 (fonctions pures).
 * Spec : docs/superpowers/specs/2026-09-28-classification-evenements-design.md § 4.2.
 *
 * - neutralizeMetaphors : « séisme au Sénat », « tempête médiatique » ne déclenchent rien ;
 * - titleQualification : temporalité (procès/rétrospectif → passé, hypothèse → à venir),
 *   zone (étranger sans ancre française / France / indéterminée) et plafond de gravité retenue
 *   (passé et hypothèse → low, étranger → medium). Réutilisée par la passe LLM
 *   (api/_lib/llm-pass.js) via la copie serveur générée (api/_lib/server-classifier.js).
 */

import type { EventTemporality, EventZone, ThreatLevel } from '../types/index.ts';
import { CITIES, REGIONS } from '../config/geo.ts';
import { DEPARTEMENT_NAMES } from '../config/departements.ts';
import { FOREIGN_CITIES, FOREIGN_COUNTRIES, FOREIGN_DEMONYM_PATTERNS } from '../config/foreign-places.ts';

export function normalizeForMatch(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/['’`]/g, ' ')
        .replace(/[^a-z0-9]+/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

const LEVELS: readonly ThreatLevel[] = ['info', 'low', 'medium', 'high', 'critical'];

export function levelRank(level: ThreatLevel): number {
    return LEVELS.indexOf(level);
}

export function minLevel(a: ThreatLevel, b: ThreatLevel): ThreatLevel {
    return levelRank(a) <= levelRank(b) ? a : b;
}

// ─── Métaphores ───

const FIGURATIVE_TERMS: readonly string[] = [
    'seisme', 'seismes', 'tsunami', 'tsunamis', 'tremblement de terre', 'tempete', 'tempetes',
    'ouragan', 'ouragans', 'bombe', 'bombes', 'explosion', 'explosions', 'deflagration',
];
const NON_PHYSICAL_MARKERS: readonly string[] = [
    'politique', 'politiques', 'mediatique', 'mediatiques', 'electoral', 'electorale', 'senat', 'assemblee',
    'gouvernement', 'parti', 'bourse', 'boursier', 'boursiere', 'wall street', 'cac 40', 'mercato',
    'box office', 'audiences', 'reseaux sociaux',
];
const WINDOW_BEFORE = 2;
const WINDOW_AFTER = 3;

/**
 * Remplace par « _ » un terme figuré dont le voisinage (2 mots avant, 3 après) contient un
 * marqueur non physique. Entrée et sortie normalisées (normalizeForMatch).
 */
export function neutralizeMetaphors(normalizedText: string): string {
    const words = normalizedText.split(' ').filter((w) => w.length > 0);
    for (const term of FIGURATIVE_TERMS) {
        const termWords = term.split(' ');
        for (let i = 0; i + termWords.length <= words.length; i++) {
            if (!termWords.every((w, k) => words[i + k] === w)) continue;
            const end = i + termWords.length;
            const context = ` ${[...words.slice(Math.max(0, i - WINDOW_BEFORE), i), ...words.slice(end, end + WINDOW_AFTER)].join(' ')} `;
            if (NON_PHYSICAL_MARKERS.some((m) => context.includes(` ${m} `))) {
                for (let k = i; k < end; k++) words[k] = '_';
            }
        }
    }
    return words.join(' ');
}

// ─── Judiciaire, rétrospectif, hypothétique (titre) ───

const JUDICIAL_RETROSPECTIVE_RE = new RegExp(
    [
        'proces', '(?:sera|seront) jugee?s?', 'jugee?s? pour', 'condamnee?s?', 'condamnation',
        'mise?s? en examen', 'requiert', 'requisitions?', 'requis contre', 'verdict', 'en appel',
        'cour d appel', 'fait appel', 'apologie', 'hommage', 'commemorations?', 'anniversaire',
        'il y a \\d+ ans', '\\d+ ans apres',
    ].map((p) => `\\b${p}\\b`).join('|'),
);
const HYPOTHETICAL_RE = /\bpas a l abri\b|\bet si\b|\b(?:faut il|doit on|peut on) (?:craindre|s inquieter|avoir peur)\b|\bscenarios?\b/;

export function isJudicialOrRetrospective(title: string): boolean {
    return JUDICIAL_RETROSPECTIVE_RE.test(normalizeForMatch(title));
}

export function isHypothetical(title: string): boolean {
    return HYPOTHETICAL_RE.test(normalizeForMatch(title));
}

// ─── Terrorisme sans victime (titre) ───

const TERROR_RE = /\b(?:attentats?|terrorisme|terroristes?|antiterroristes?|antiterrorisme)\b/;
const VICTIM_RE = /\b(?:morts?|mortes?|tuee?s?|victimes?|blessee?s?|otages?|deces|decedee?s?)\b/;

/**
 * Vrai si le titre parle de terrorisme sans faire état de victimes : attentat déjoué, dégâts
 * matériels, enquête. La gravité se juge aux conséquences — high au plus, pas critical
 * (annotation de l'analyste du 28/09 : maison détruite en Corse, projet déjoué au Royaume-Uni).
 */
export function isTerrorWithoutVictims(title: string): boolean {
    const text = normalizeForMatch(title);
    return TERROR_RE.test(text) && !VICTIM_RE.test(text);
}

// ─── Zone (titre) ───

/** Mots courants homonymes de lieux français : jamais une ancre (« Corée du Nord », « à l'aube »). */
const AMBIGUOUS_ANCHORS = new Set([
    'nord', 'cher', 'somme', 'lot', 'ain', 'aube', 'orne', 'allier', 'creuse', 'tours', 'sens', 'orange',
    'nice', 'lens', 'vienne', 'gap',
]);
/** Institutions propres à la France (président, ministre, Sénat, police désignent aussi l'étranger). */
const FRENCH_ANCHOR_WORDS: readonly string[] = [
    'France', 'français', 'française', 'françaises', 'Hexagone', 'outre-mer', 'Élysée', 'Matignon',
    'Assemblée nationale', 'Beauvau', 'Quai d’Orsay', 'Bercy', 'préfecture', 'préfet', 'préfète', 'préfets',
    'gendarmerie', 'gendarmes', 'SNCF', 'EDF', 'RTE', 'Enedis', 'GRDF', 'RATP', 'Corse', 'Nouvelle-Calédonie',
    'Polynésie', 'Saint-Pierre-et-Miquelon', 'Wallis', 'Futuna', 'Saint-Martin', 'Saint-Barthélemy',
];

const byLengthDesc = (forms: readonly string[]): string[] => [...new Set(forms)].sort((a, b) => b.length - a.length);

export const FOREIGN_FORMS: readonly string[] = byLengthDesc(
    [...FOREIGN_COUNTRIES, ...FOREIGN_CITIES].map(normalizeForMatch),
);
export const FRENCH_ANCHOR_FORMS: readonly string[] = byLengthDesc(
    [...FRENCH_ANCHOR_WORDS, ...Object.keys(CITIES), ...Object.values(REGIONS).map((r) => r.name), ...DEPARTEMENT_NAMES]
        .map(normalizeForMatch)
        .filter((f) => f.length > 0 && !AMBIGUOUS_ANCHORS.has(f)),
);

const FOREIGN_RE = new RegExp(`\\b(?:${[...FOREIGN_FORMS, ...FOREIGN_DEMONYM_PATTERNS].join('|')})\\b`, 'g');
const FRENCH_ANCHOR_RE = new RegExp(`\\b(?:${FRENCH_ANCHOR_FORMS.join('|')})\\b`);

/**
 * Zone du titre. Les noms étrangers sont masqués AVANT la recherche d'ancre : « Grande-Bretagne »
 * ne compte pas comme « Bretagne », ni « La Nouvelle-Orléans » comme « Orléans ».
 */
export function titleZone(title: string): EventZone {
    const text = normalizeForMatch(title);
    const masked = text.replace(FOREIGN_RE, '_');
    if (FRENCH_ANCHOR_RE.test(masked)) return 'france';
    return masked === text ? 'indeterminee' : 'etranger';
}

// ─── Qualification du titre ───

export type TitleReason = 'passe' | 'hypothetique' | 'etranger';

/** Plafond de gravité retenue attaché à chaque motif du titre. */
export const TITLE_REASON_CAP: Record<TitleReason, ThreatLevel> = { passe: 'low', hypothetique: 'low', etranger: 'medium' };

export interface TitleQualification {
    maxSeverity: ThreatLevel;
    temporality: EventTemporality;
    zone: EventZone;
    reasons: TitleReason[];
}

export function titleQualification(title: string): TitleQualification {
    const reasons: TitleReason[] = [];
    let temporality: EventTemporality = 'en_cours';
    if (isJudicialOrRetrospective(title)) {
        reasons.push('passe');
        temporality = 'passe';
    }
    if (isHypothetical(title)) {
        reasons.push('hypothetique');
        if (temporality === 'en_cours') temporality = 'a_venir';
    }
    const zone = titleZone(title);
    if (zone === 'etranger') reasons.push('etranger');
    const maxSeverity = reasons.reduce<ThreatLevel>((cap, r) => minLevel(cap, TITLE_REASON_CAP[r]), 'critical');
    return { maxSeverity, temporality, zone, reasons };
}
