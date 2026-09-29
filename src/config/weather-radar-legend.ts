// Légende des intensités du radar météo : source unique, partagée par la légende de la carte
// (App.ts) et par le panneau « Radar météo ».
import type { LegendItem } from '../components/MapLegend.ts';

export const WEATHER_RADAR_LEGEND_ITEMS: LegendItem[] = [
  { id: 'weather-radar-light', label: 'Précipitations faibles', color: '#4FC3F7', shape: 'square' },
  { id: 'weather-radar-moderate', label: 'Précipitations modérées', color: '#8BC34A', shape: 'square' },
  { id: 'weather-radar-heavy', label: 'Précipitations fortes', color: '#FF9800', shape: 'square' },
  { id: 'weather-radar-intense', label: 'Cellules intenses', color: '#E53935', shape: 'square' },
];
