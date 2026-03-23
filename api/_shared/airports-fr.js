export const FRANCE_AIRPORTS = [
  { iata: 'CDG', icao: 'LFPG', name: 'Paris Charles de Gaulle', city: 'Paris', lat: 49.0097, lon: 2.5479, expectedNearby: 12, expectedTerminal: 6 },
  { iata: 'ORY', icao: 'LFPO', name: 'Paris Orly', city: 'Paris', lat: 48.7262, lon: 2.3652, expectedNearby: 9, expectedTerminal: 5 },
  { iata: 'BVA', icao: 'LFOB', name: 'Paris Beauvais', city: 'Beauvais', lat: 49.4544, lon: 2.1128, expectedNearby: 4, expectedTerminal: 2 },
  { iata: 'LBG', icao: 'LFPB', name: 'Paris Le Bourget', city: 'Paris', lat: 48.9694, lon: 2.4414, expectedNearby: 2, expectedTerminal: 1 },
  { iata: 'LYS', icao: 'LFLL', name: 'Lyon Saint-Exupery', city: 'Lyon', lat: 45.7256, lon: 5.0811, expectedNearby: 5, expectedTerminal: 2 },
  { iata: 'MRS', icao: 'LFML', name: 'Marseille Provence', city: 'Marseille', lat: 43.4393, lon: 5.2214, expectedNearby: 5, expectedTerminal: 2 },
  { iata: 'NCE', icao: 'LFMN', name: "Nice Cote d'Azur", city: 'Nice', lat: 43.6653, lon: 7.215, expectedNearby: 6, expectedTerminal: 3 },
  { iata: 'TLS', icao: 'LFBO', name: 'Toulouse Blagnac', city: 'Toulouse', lat: 43.6293, lon: 1.3638, expectedNearby: 5, expectedTerminal: 2 },
  { iata: 'BOD', icao: 'LFBD', name: 'Bordeaux Merignac', city: 'Bordeaux', lat: 44.8283, lon: -0.7156, expectedNearby: 4, expectedTerminal: 2 },
  { iata: 'NTE', icao: 'LFRS', name: 'Nantes Atlantique', city: 'Nantes', lat: 47.1532, lon: -1.6107, expectedNearby: 4, expectedTerminal: 2 },
  { iata: 'MPL', icao: 'LFMT', name: 'Montpellier Mediterranee', city: 'Montpellier', lat: 43.5762, lon: 3.963, expectedNearby: 3, expectedTerminal: 1 },
  { iata: 'LIL', icao: 'LFQQ', name: 'Lille Lesquin', city: 'Lille', lat: 50.5633, lon: 3.0869, expectedNearby: 3, expectedTerminal: 1 },
  { iata: 'SXB', icao: 'LFST', name: 'Strasbourg Entzheim', city: 'Strasbourg', lat: 48.5383, lon: 7.6282, expectedNearby: 3, expectedTerminal: 1 },
  { iata: 'BES', icao: 'LFRB', name: 'Brest Bretagne', city: 'Brest', lat: 48.4479, lon: -4.4185, expectedNearby: 2, expectedTerminal: 1 },
  { iata: 'RNS', icao: 'LFRN', name: 'Rennes Saint-Jacques', city: 'Rennes', lat: 48.0695, lon: -1.7348, expectedNearby: 2, expectedTerminal: 1 },
  { iata: 'AJA', icao: 'LFKJ', name: 'Ajaccio Napoleon Bonaparte', city: 'Ajaccio', lat: 41.9236, lon: 8.8029, expectedNearby: 2, expectedTerminal: 1 },
];

function normalizeAirportToken(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

const AIRPORT_LOOKUP = new Map();
for (const airport of FRANCE_AIRPORTS) {
  AIRPORT_LOOKUP.set(normalizeAirportToken(airport.iata), airport);
  AIRPORT_LOOKUP.set(normalizeAirportToken(airport.icao), airport);
  AIRPORT_LOOKUP.set(normalizeAirportToken(airport.city), airport);
  AIRPORT_LOOKUP.set(normalizeAirportToken(airport.name), airport);
}

export function matchFranceAirport(value) {
  const normalized = normalizeAirportToken(value);
  if (!normalized) return null;
  if (AIRPORT_LOOKUP.has(normalized)) return AIRPORT_LOOKUP.get(normalized);

  for (const airport of FRANCE_AIRPORTS) {
    if (
      normalized.includes(normalizeAirportToken(airport.iata)) ||
      normalized.includes(normalizeAirportToken(airport.icao)) ||
      normalized.includes(normalizeAirportToken(airport.city))
    ) {
      return airport;
    }
  }

  return null;
}
