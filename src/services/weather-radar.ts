// src/services/weather-radar.ts — libellés du panneau « Radar météo » (pur).
import { dataDateLabel, freshnessOf } from './freshness.ts';

export interface WeatherRadarFrame {
  /** Instant de la trame (ms). */
  time: number;
  /** past = observation ; nowcast = prévision à court terme. */
  kind: 'past' | 'nowcast';
}

export type WeatherRadarStatus = 'loading' | 'ready' | 'error';

export interface WeatherRadarSummary {
  state: 'loading' | 'ready' | 'error';
  /** Message pour les états loading / error, sinon null. */
  message: string | null;
  /** « Image du 29/09 à 19:40 » (heure de Paris). */
  imageLabel: string | null;
  natureLabel: string | null;
  stale: boolean;
  /** « données du 29/09 à 19:40 » quand l'image est périmée. */
  staleLabel: string | null;
}

function paris(time: number, lang: 'fr' | 'en'): { date: string; time: string } {
  const locale = lang === 'fr' ? 'fr-FR' : 'en-GB';
  const d = new Date(time);
  return {
    date: d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', timeZone: 'Europe/Paris' }),
    time: d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }),
  };
}

export function weatherRadarSummary(
  frame: WeatherRadarFrame | null,
  status: WeatherRadarStatus,
  now: number,
  lang: 'fr' | 'en',
): WeatherRadarSummary {
  if (!frame) {
    const error = status === 'error';
    return {
      state: error ? 'error' : 'loading',
      message: error
        ? (lang === 'fr' ? 'Image radar indisponible pour le moment' : 'Radar image currently unavailable')
        : (lang === 'fr' ? 'Chargement de l’image radar…' : 'Loading radar image…'),
      imageLabel: null,
      natureLabel: null,
      stale: false,
      staleLabel: null,
    };
  }
  const p = paris(frame.time, lang);
  const stale = freshnessOf(frame.time, 'weatherRadar', now) === 'stale';
  const forecast = frame.kind === 'nowcast';
  return {
    state: 'ready',
    message: null,
    imageLabel: lang === 'fr' ? `Image du ${p.date} à ${p.time}` : `Image from ${p.date} at ${p.time}`,
    natureLabel: forecast
      ? (lang === 'fr' ? 'prévision à court terme' : 'short-term forecast')
      : (lang === 'fr' ? 'observation' : 'observation'),
    stale,
    staleLabel: stale ? dataDateLabel(frame.time, lang) : null,
  };
}
