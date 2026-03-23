import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEST_FILE = path.join(__dirname, '../public/data/hospitals.json');

// Using a slightly faster endpoint or standard one
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

// Query optimized: Only amenity=hospital with emergency=yes or large hospitals
const QUERY = `
[out:json][timeout:180];
area["ISO3166-1"="FR"][admin_level=2]->.searchArea;
(
  node["amenity"="hospital"]["emergency"="yes"](area.searchArea);
  way["amenity"="hospital"]["emergency"="yes"](area.searchArea);
);
out center;
`;

const DROM_QUERY = `
[out:json][timeout:180];
(
  node["amenity"="hospital"](area:3600002030); 
  way["amenity"="hospital"](area:3600002052); 
  node["amenity"="hospital"](area:3600002031); 
  way["amenity"="hospital"](area:3600002032); 
  node["amenity"="hospital"](area:3600002033); 
  way["amenity"="hospital"](area:3600002030); 
  node["amenity"="hospital"](area:3600002052); 
  way["amenity"="hospital"](area:3600002031); 
  node["amenity"="hospital"](area:3600002032); 
  way["amenity"="hospital"](area:3600002033); 
);
out center;
`;

async function fetchFromOverpass(queryName, query) {
    console.log(`Fetching ${queryName} from Overpass...`);
    // Retry logic
    for (let attempts = 0; attempts < 3; attempts++) {
        try {
            const resp = await fetch(OVERPASS_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: 'data=' + encodeURIComponent(query)
            });

            if (!resp.ok) {
                console.warn(`[Attempt ${attempts + 1}] Overpass API error: ${resp.status} ${resp.statusText}`);
                if (attempts === 2) throw new Error('API failed');
                await new Promise(r => setTimeout(r, 2000));
                continue;
            }

            const data = await resp.json();
            return data.elements || [];
        } catch (err) {
            console.error(err.message);
            if (attempts === 2) throw err;
            await new Promise(r => setTimeout(r, 2000));
        }
    }
}

async function main() {
    try {
        const [metroElements, dromElements] = await Promise.all([
            fetchFromOverpass('Metropole', QUERY),
            fetchFromOverpass('DROM', DROM_QUERY)
        ]);

        const allElements = [...metroElements, ...dromElements];
        const seenIds = new Set();
        const hospitals = [];

        for (const el of allElements) {
            if (seenIds.has(el.id)) continue;
            seenIds.add(el.id);

            const tags = el.tags || {};
            // Filter
            if (tags.healthcare === 'veterinary' || tags.amenity === 'veterinary') continue;

            const lat = el.lat || (el.center && el.center.lat);
            const lon = el.lon || (el.center && el.center.lon);

            if (!lat || !lon) continue;

            const name = tags.name || (tags.amenity === 'clinic' ? 'Clinique' : 'Centre Hospitalier');
            let beds = parseInt(tags.capacity || tags.beds, 10);

            // Heuristic for type and beds if missing
            const isEmergency = tags.emergency === 'yes';
            let type = 'Hôpital Général (CH)';

            if (name.toLowerCase().includes('clinique') || tags.healthcare === 'clinic') {
                type = 'Clinique Privée';
            } else if (name.toLowerCase().includes('chu') || name.toLowerCase().includes('universitaire') || name.toLowerCase().includes('chr')) {
                type = 'Centre Hospitalier Universitaire (CHU)';
                beds = beds || 1200;
            } else {
                beds = beds || 400; // Average
            }

            hospitals.push({
                id: el.id,
                name: name,
                type: type,
                isEmergency: isEmergency,
                beds: isNaN(beds) ? null : beds,
                coordinates: [lon, lat]
            });
        }

        console.log(`Found ${hospitals.length} major hospitals.`);

        const dir = path.dirname(DEST_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(DEST_FILE, JSON.stringify(hospitals, null, 2), 'utf-8');
        console.log(`Saved to ${DEST_FILE}`);

    } catch (err) {
        console.error('Failed to fetch hospitals:', err);
        process.exit(1);
    }
}

main();
