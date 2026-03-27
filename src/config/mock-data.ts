/**
 * mock-data.ts — Données fictives pour le développement.
 * 60 événements répartis sur la France avec catégories variées.
 */

import type { NewsItem } from '../types/index.ts';

/** Auto-assign IDs to mock items */
function withIds(items: Omit<NewsItem, 'id'>[]): NewsItem[] {
  return items.map((item, i) => ({ ...item, id: `mock-${i}` }));
}

export const MOCK_NEWS_ITEMS: NewsItem[] = withIds([
  // ═══ Social ═══
  { source: 'Le Monde', title: 'Greve des transports en commun a Paris : perturbations majeures', link: '#', pubDate: new Date(Date.now() - 3600000), isAlert: true, tier: 2, threat: { level: 'high', category: 'social', confidence: 0.9, source: 'keyword' }, lat: 48.8566, lon: 2.3522, locationName: 'Paris' },
  { source: 'Ouest-France', title: 'Manifestation contre la reforme des retraites a Nantes', link: '#', pubDate: new Date(Date.now() - 7200000), isAlert: false, tier: 3, threat: { level: 'medium', category: 'social', confidence: 0.85, source: 'keyword' }, lat: 47.2184, lon: -1.5536, locationName: 'Nantes' },
  { source: 'La Voix du Nord', title: 'Blocage du depot de carburant a Dunkerque', link: '#', pubDate: new Date(Date.now() - 5400000), isAlert: true, tier: 3, threat: { level: 'high', category: 'social', confidence: 0.8, source: 'keyword' }, lat: 51.0343, lon: 2.3768, locationName: 'Dunkerque' },
  { source: 'France Info', title: 'Rassemblement pacifique place de la Republique', link: '#', pubDate: new Date(Date.now() - 14400000), isAlert: false, tier: 2, threat: { level: 'low', category: 'social', confidence: 0.7, source: 'keyword' }, lat: 48.8674, lon: 2.3641, locationName: 'Paris' },
  { source: 'La Depeche', title: 'Greve des enseignants : ecoles fermees a Toulouse', link: '#', pubDate: new Date(Date.now() - 10800000), isAlert: false, tier: 3, threat: { level: 'medium', category: 'social', confidence: 0.82, source: 'keyword' }, lat: 43.6047, lon: 1.4442, locationName: 'Toulouse' },
  { source: 'Sud Ouest', title: 'Manifestation des agriculteurs sur l\'A10 a Bordeaux', link: '#', pubDate: new Date(Date.now() - 9000000), isAlert: true, tier: 3, threat: { level: 'high', category: 'social', confidence: 0.88, source: 'keyword' }, lat: 44.8378, lon: -0.5792, locationName: 'Bordeaux' },

  // ═══ Security ═══
  { source: 'Le Parisien', title: 'Accident mortel sur l\'A6 : 3 voies coupees', link: '#', pubDate: new Date(Date.now() - 1800000), isAlert: true, tier: 2, threat: { level: 'high', category: 'security', confidence: 0.92, source: 'keyword' }, lat: 48.7500, lon: 2.4000, locationName: 'A6 - Ile-de-France' },
  { source: 'Nice Matin', title: 'Agression au couteau dans le centre-ville de Nice', link: '#', pubDate: new Date(Date.now() - 2700000), isAlert: true, tier: 3, threat: { level: 'critical', category: 'security', confidence: 0.95, source: 'keyword' }, lat: 43.7102, lon: 7.2620, locationName: 'Nice' },
  { source: 'France Bleu', title: 'Serie de cambriolages dans le 15e arrondissement', link: '#', pubDate: new Date(Date.now() - 21600000), isAlert: false, tier: 4, threat: { level: 'medium', category: 'security', confidence: 0.75, source: 'keyword' }, lat: 48.8422, lon: 2.2945, locationName: 'Paris 15e' },
  { source: 'Le Progres', title: 'Fusillade dans le quartier de la Guillotiere a Lyon', link: '#', pubDate: new Date(Date.now() - 4200000), isAlert: true, tier: 3, threat: { level: 'critical', category: 'security', confidence: 0.95, source: 'keyword' }, lat: 45.7530, lon: 4.8420, locationName: 'Lyon' },
  { source: '20 Minutes', title: 'Accident de la route a Rennes : 2 blesses graves', link: '#', pubDate: new Date(Date.now() - 16200000), isAlert: false, tier: 4, threat: { level: 'medium', category: 'security', confidence: 0.7, source: 'keyword' }, lat: 48.1173, lon: -1.6778, locationName: 'Rennes' },

  // ═══ Weather ═══
  { source: 'Meteo-France', title: 'Vigilance rouge tempete sur les Hauts-de-France', link: '#', pubDate: new Date(Date.now() - 900000), isAlert: true, tier: 1, threat: { level: 'critical', category: 'weather', confidence: 1.0, source: 'keyword' }, lat: 49.9, lon: 2.8, locationName: 'Hauts-de-France' },
  { source: 'France Info', title: 'Alerte canicule : 15 departements en vigilance orange', link: '#', pubDate: new Date(Date.now() - 5400000), isAlert: true, tier: 2, threat: { level: 'high', category: 'weather', confidence: 0.95, source: 'keyword' }, lat: 46.6, lon: 2.2, locationName: 'Centre France' },
  { source: 'La Montagne', title: 'Orages violents attendus en Auvergne ce soir', link: '#', pubDate: new Date(Date.now() - 7200000), isAlert: false, tier: 3, threat: { level: 'medium', category: 'weather', confidence: 0.8, source: 'keyword' }, lat: 45.7772, lon: 3.0870, locationName: 'Clermont-Ferrand' },
  { source: 'Sud Ouest', title: 'Inondation : la Garonne deborde a Agen', link: '#', pubDate: new Date(Date.now() - 3600000), isAlert: true, tier: 3, threat: { level: 'high', category: 'weather', confidence: 0.9, source: 'keyword' }, lat: 44.2033, lon: 0.6166, locationName: 'Agen' },
  { source: 'France 3', title: 'Neige en Bretagne : routes verglacees ce matin', link: '#', pubDate: new Date(Date.now() - 18000000), isAlert: false, tier: 2, threat: { level: 'medium', category: 'weather', confidence: 0.78, source: 'keyword' }, lat: 48.2, lon: -3.0, locationName: 'Bretagne' },
  { source: 'Meteo-France', title: 'Vigilance orange pluie-inondation dans le Gard', link: '#', pubDate: new Date(Date.now() - 6000000), isAlert: true, tier: 1, threat: { level: 'high', category: 'weather', confidence: 0.95, source: 'keyword' }, lat: 43.8367, lon: 4.3601, locationName: 'Nimes' },

  // ═══ Energy ═══
  { source: 'RTE', title: 'Signal Ecowatt rouge pour demain en Ile-de-France', link: '#', pubDate: new Date(Date.now() - 1200000), isAlert: true, tier: 1, threat: { level: 'critical', category: 'energy', confidence: 1.0, source: 'keyword' }, lat: 48.86, lon: 2.35, locationName: 'Ile-de-France' },
  { source: 'France Info', title: 'Coupure d\'electricite dans le quartier des Batignolles', link: '#', pubDate: new Date(Date.now() - 5400000), isAlert: true, tier: 2, threat: { level: 'high', category: 'energy', confidence: 0.85, source: 'keyword' }, lat: 48.8862, lon: 2.3200, locationName: 'Paris 17e' },
  { source: 'Le Figaro', title: 'Maintenance programmee a la centrale de Gravelines', link: '#', pubDate: new Date(Date.now() - 43200000), isAlert: false, tier: 2, threat: { level: 'low', category: 'energy', confidence: 0.7, source: 'keyword' }, lat: 50.9869, lon: 2.1044, locationName: 'Gravelines' },
  { source: 'France Bleu', title: 'Production solaire record en PACA', link: '#', pubDate: new Date(Date.now() - 28800000), isAlert: false, tier: 4, threat: { level: 'info', category: 'energy', confidence: 0.6, source: 'keyword' }, lat: 43.9, lon: 5.9, locationName: 'PACA' },

  // ═══ Transport ═══
  { source: 'SNCF', title: 'Perturbation TGV axe Paris-Lyon : retards de 45 min', link: '#', pubDate: new Date(Date.now() - 2400000), isAlert: true, tier: 1, threat: { level: 'medium', category: 'transport', confidence: 0.9, source: 'keyword' }, lat: 47.3, lon: 3.5, locationName: 'Axe Paris-Lyon' },
  { source: 'France Info', title: 'Annulation de 30% des trains en gare de Montparnasse', link: '#', pubDate: new Date(Date.now() - 3600000), isAlert: true, tier: 2, threat: { level: 'high', category: 'transport', confidence: 0.88, source: 'keyword' }, lat: 48.8421, lon: 2.3219, locationName: 'Paris Montparnasse' },
  { source: 'Le Parisien', title: 'Metro ligne 13 : trafic interrompu suite a un incident', link: '#', pubDate: new Date(Date.now() - 1500000), isAlert: true, tier: 2, threat: { level: 'medium', category: 'transport', confidence: 0.85, source: 'keyword' }, lat: 48.8922, lon: 2.3210, locationName: 'Paris' },
  { source: 'La Voix du Nord', title: 'Eurostar : retards importants a Lille Europe', link: '#', pubDate: new Date(Date.now() - 9000000), isAlert: false, tier: 3, threat: { level: 'medium', category: 'transport', confidence: 0.75, source: 'keyword' }, lat: 50.6392, lon: 3.0758, locationName: 'Lille' },
  { source: '20 Minutes', title: 'Trafic routier dense sur l\'A7 direction sud', link: '#', pubDate: new Date(Date.now() - 14400000), isAlert: false, tier: 4, threat: { level: 'low', category: 'transport', confidence: 0.65, source: 'keyword' }, lat: 44.5, lon: 4.8, locationName: 'Vallee du Rhone' },

  // ═══ Infrastructure ═══
  { source: 'France Info', title: 'Panne geante du reseau Orange dans le Grand Est', link: '#', pubDate: new Date(Date.now() - 4800000), isAlert: true, tier: 2, threat: { level: 'high', category: 'infrastructure', confidence: 0.88, source: 'keyword' }, lat: 48.6, lon: 6.2, locationName: 'Grand Est' },
  { source: 'Le Monde', title: 'Fuite d\'eau majeure : coupure dans le 12e arrondissement', link: '#', pubDate: new Date(Date.now() - 7200000), isAlert: false, tier: 2, threat: { level: 'medium', category: 'infrastructure', confidence: 0.72, source: 'keyword' }, lat: 48.8410, lon: 2.3880, locationName: 'Paris 12e' },
  { source: 'Le Figaro', title: 'Effondrement partiel d\'un immeuble a Marseille', link: '#', pubDate: new Date(Date.now() - 3000000), isAlert: true, tier: 2, threat: { level: 'critical', category: 'infrastructure', confidence: 0.95, source: 'keyword' }, lat: 43.2965, lon: 5.3698, locationName: 'Marseille' },

  // ═══ Health ═══
  { source: 'France Info', title: 'Epidemie de gastro-enterite : pic atteint en Normandie', link: '#', pubDate: new Date(Date.now() - 21600000), isAlert: false, tier: 2, threat: { level: 'medium', category: 'health', confidence: 0.7, source: 'keyword' }, lat: 49.1, lon: -0.4, locationName: 'Normandie' },
  { source: 'Le Parisien', title: 'Urgences saturees dans plusieurs hopitaux d\'Ile-de-France', link: '#', pubDate: new Date(Date.now() - 10800000), isAlert: true, tier: 2, threat: { level: 'high', category: 'health', confidence: 0.82, source: 'keyword' }, lat: 48.86, lon: 2.35, locationName: 'Ile-de-France' },

  // ═══ General / Divers ═══
  { source: 'Le Monde', title: 'Elections legislatives partielles dans le Doubs', link: '#', pubDate: new Date(Date.now() - 43200000), isAlert: false, tier: 2, threat: { level: 'info', category: 'general', confidence: 0.5, source: 'keyword' }, lat: 47.2378, lon: 6.0240, locationName: 'Besancon' },
  { source: 'Ouest-France', title: 'Festival des Vieilles Charrues : 80 000 festivaliers attendus', link: '#', pubDate: new Date(Date.now() - 86400000), isAlert: false, tier: 3, threat: { level: 'info', category: 'general', confidence: 0.4, source: 'keyword' }, lat: 48.2773, lon: -3.5617, locationName: 'Carhaix' },

  // ═══ Extra — couverture géographique ═══
  { source: 'France Bleu', title: 'Feux de foret dans les Landes : 500 hectares brules', link: '#', pubDate: new Date(Date.now() - 2000000), isAlert: true, tier: 4, threat: { level: 'critical', category: 'security', confidence: 0.92, source: 'keyword' }, lat: 44.0, lon: -1.0, locationName: 'Landes' },
  { source: 'Le Progres', title: 'Seisme de magnitude 3.2 ressenti pres de Strasbourg', link: '#', pubDate: new Date(Date.now() - 6000000), isAlert: true, tier: 3, threat: { level: 'high', category: 'weather', confidence: 0.9, source: 'keyword' }, lat: 48.5734, lon: 7.7521, locationName: 'Strasbourg' },
  { source: 'La Depeche', title: 'Eboulement sur la RN116 dans les Pyrenees-Orientales', link: '#', pubDate: new Date(Date.now() - 8000000), isAlert: true, tier: 3, threat: { level: 'high', category: 'infrastructure', confidence: 0.85, source: 'keyword' }, lat: 42.5, lon: 2.2, locationName: 'Pyrenees-Orientales' },
  { source: 'Nice Matin', title: 'Pollution de l\'air : alerte dans la vallee de l\'Arve', link: '#', pubDate: new Date(Date.now() - 12000000), isAlert: false, tier: 3, threat: { level: 'medium', category: 'health', confidence: 0.75, source: 'keyword' }, lat: 45.9237, lon: 6.8694, locationName: 'Chamonix' },
  { source: 'France 3', title: 'Maree noire : boulettes de fioul sur les plages du Finistere', link: '#', pubDate: new Date(Date.now() - 15000000), isAlert: true, tier: 2, threat: { level: 'high', category: 'weather', confidence: 0.85, source: 'keyword' }, lat: 48.39, lon: -4.49, locationName: 'Brest' },
  { source: 'La Montagne', title: 'Avalanche dans le massif du Mont-Blanc : 2 alpinistes secourus', link: '#', pubDate: new Date(Date.now() - 4000000), isAlert: true, tier: 3, threat: { level: 'high', category: 'weather', confidence: 0.9, source: 'keyword' }, lat: 45.8326, lon: 6.8652, locationName: 'Mont-Blanc' },
  { source: 'Sud Ouest', title: 'Penurie d\'eau : restrictions dans le Lot-et-Garonne', link: '#', pubDate: new Date(Date.now() - 36000000), isAlert: false, tier: 3, threat: { level: 'medium', category: 'weather', confidence: 0.7, source: 'keyword' }, lat: 44.35, lon: 0.63, locationName: 'Lot-et-Garonne' },
  { source: 'France Bleu', title: 'Accident chimique a Feyzin : perimetre de securite', link: '#', pubDate: new Date(Date.now() - 1800000), isAlert: true, tier: 4, threat: { level: 'critical', category: 'infrastructure', confidence: 0.95, source: 'keyword' }, lat: 45.6714, lon: 4.8594, locationName: 'Feyzin' },
  { source: 'Le Telegramme', title: 'Echouage de dauphins sur les cotes atlantiques', link: '#', pubDate: new Date(Date.now() - 50000000), isAlert: false, tier: 3, threat: { level: 'low', category: 'general', confidence: 0.5, source: 'keyword' }, lat: 46.16, lon: -1.15, locationName: 'La Rochelle' },
  { source: 'Corse Matin', title: 'Incendie maitrise dans le maquis pres d\'Ajaccio', link: '#', pubDate: new Date(Date.now() - 20000000), isAlert: false, tier: 3, threat: { level: 'medium', category: 'security', confidence: 0.78, source: 'keyword' }, lat: 41.9192, lon: 8.7369, locationName: 'Ajaccio' },
  { source: 'Le Parisien', title: 'Alerte a la bombe : gare du Nord evacuee', link: '#', pubDate: new Date(Date.now() - 600000), isAlert: true, tier: 2, threat: { level: 'critical', category: 'security', confidence: 0.98, source: 'keyword' }, lat: 48.8809, lon: 2.3553, locationName: 'Paris Gare du Nord' },
  { source: 'France Info', title: 'Mouvement social : raffineries de Fos-sur-Mer a l\'arret', link: '#', pubDate: new Date(Date.now() - 7000000), isAlert: true, tier: 2, threat: { level: 'high', category: 'social', confidence: 0.88, source: 'keyword' }, lat: 43.4278, lon: 4.9444, locationName: 'Fos-sur-Mer' },
  { source: 'France Bleu', title: 'Exercice militaire : survol de Mourmelon-le-Grand', link: '#', pubDate: new Date(Date.now() - 30000000), isAlert: false, tier: 4, threat: { level: 'info', category: 'general', confidence: 0.4, source: 'keyword' }, lat: 49.13, lon: 4.36, locationName: 'Mourmelon' },
  { source: '20 Minutes', title: 'Pollution sonore : plaintes autour de l\'aeroport de Toulouse-Blagnac', link: '#', pubDate: new Date(Date.now() - 40000000), isAlert: false, tier: 4, threat: { level: 'low', category: 'general', confidence: 0.45, source: 'keyword' }, lat: 43.6293, lon: 1.3640, locationName: 'Blagnac' },
]);

// ═══ Mock Ecowatt Signals (par code région) ═══

import type { EcowattSignal, MeteoAlert } from '../types/index.ts';

/** Signal Ecowatt par code région — pour colorer les régions sur la carte */
export const MOCK_ECOWATT_REGIONS: Record<string, EcowattSignal> = {
  '11': 'red',      // Île-de-France
  '24': 'green',    // Centre-Val de Loire
  '27': 'green',    // Bourgogne-Franche-Comté
  '28': 'green',    // Normandie
  '32': 'orange',   // Hauts-de-France
  '44': 'green',    // Grand Est
  '52': 'green',    // Pays de la Loire
  '53': 'green',    // Bretagne
  '75': 'green',    // Nouvelle-Aquitaine
  '76': 'orange',   // Occitanie
  '84': 'green',    // Auvergne-Rhône-Alpes
  '93': 'green',    // PACA
  '94': 'green',    // Corse
};

// ═══ Mock Météo-France Alerts ═══

export const MOCK_METEO_ALERTS: MeteoAlert[] = [
  { department: 'Nord', departmentCode: '59', level: 'orange', risks: ['wind'] },
  { department: 'Pas-de-Calais', departmentCode: '62', level: 'orange', risks: ['wind'] },
  { department: 'Somme', departmentCode: '80', level: 'yellow', risks: ['wind'] },
  { department: 'Gard', departmentCode: '30', level: 'red', risks: ['rain-flood', 'thunderstorm'] },
  { department: 'Hérault', departmentCode: '34', level: 'orange', risks: ['rain-flood'] },
  { department: 'Bouches-du-Rhône', departmentCode: '13', level: 'yellow', risks: ['thunderstorm'] },
  { department: 'Var', departmentCode: '83', level: 'yellow', risks: ['thunderstorm'] },
  { department: 'Alpes-Maritimes', departmentCode: '06', level: 'yellow', risks: ['thunderstorm'] },
  { department: 'Pyrénées-Atlantiques', departmentCode: '64', level: 'yellow', risks: ['snow-ice'] },
  { department: 'Hautes-Pyrénées', departmentCode: '65', level: 'orange', risks: ['avalanche', 'snow-ice'] },
  { department: 'Haute-Savoie', departmentCode: '74', level: 'yellow', risks: ['avalanche'] },
  { department: 'Savoie', departmentCode: '73', level: 'yellow', risks: ['avalanche'] },
  { department: 'Landes', departmentCode: '40', level: 'yellow', risks: ['heat'] },
  { department: 'Finistère', departmentCode: '29', level: 'yellow', risks: ['wave-surge'] },
];

// ═══ Mock Traffic Segments ═══

export interface TrafficSegment {
  id: string;
  name: string;
  level: 'fluid' | 'dense' | 'congested' | 'blocked';
  geometry: { type: 'LineString'; coordinates: [number, number][] };
}

export const MOCK_TRAFFIC_SEGMENTS: TrafficSegment[] = [
  {
    id: 'traffic-a6-lyon', name: 'A6 — Paris→Lyon',
    level: 'dense',
    geometry: { type: 'LineString', coordinates: [[2.35, 48.80], [2.60, 48.30], [3.00, 47.50], [3.50, 46.80], [4.30, 46.20], [4.80, 45.80]] },
  },
  {
    id: 'traffic-a7-valence', name: 'A7 — Lyon→Valence',
    level: 'congested',
    geometry: { type: 'LineString', coordinates: [[4.83, 45.76], [4.85, 45.50], [4.87, 45.20], [4.88, 44.93]] },
  },
  {
    id: 'traffic-a1-lille', name: 'A1 — Paris→Lille',
    level: 'dense',
    geometry: { type: 'LineString', coordinates: [[2.35, 48.92], [2.50, 49.20], [2.70, 49.50], [2.90, 49.85], [3.06, 50.63]] },
  },
  {
    id: 'traffic-a13-rouen', name: 'A13 — Paris→Rouen',
    level: 'fluid',
    geometry: { type: 'LineString', coordinates: [[2.25, 48.87], [1.80, 49.00], [1.40, 49.20], [1.10, 49.44]] },
  },
  {
    id: 'traffic-a10-bordeaux', name: 'A10 — Paris→Bordeaux',
    level: 'fluid',
    geometry: { type: 'LineString', coordinates: [[2.30, 48.75], [1.50, 47.80], [0.70, 47.00], [0.10, 46.20], [-0.30, 45.50], [-0.58, 44.84]] },
  },
  {
    id: 'traffic-periph-paris', name: 'Périphérique Paris',
    level: 'blocked',
    geometry: { type: 'LineString', coordinates: [[2.28, 48.90], [2.40, 48.90], [2.42, 48.84], [2.35, 48.82], [2.26, 48.83], [2.24, 48.88], [2.28, 48.90]] },
  },
];
