import type { BiomethaneSite } from '../types/index.ts';
import { Watchdog } from './watchdog.ts';

Watchdog.register('biogas-sites', {
    label: 'Sites Biométhane',
    staleAfterMs: 24 * 60 * 60_000,
    detail: 'opendata.grdf.fr · 833 sites injection biométhane',
});

let cache: { data: BiomethaneSite[]; fetchedAt: number } | null = null;
const CACHE_TTL = 60 * 60_000; // 1h — static data updated monthly

const API_URL = import.meta.env.PROD
    ? '/api/energy/biogas-sites'
    : 'http://localhost:3001/api/energy/biogas-sites';

export async function fetchBiomethaneSites(): Promise<BiomethaneSite[]> {
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL) return cache.data;

    Watchdog.report('biogas-sites', { type: 'loading' });
    const t0 = Date.now();

    try {
        const resp = await fetch(API_URL, { signal: AbortSignal.timeout(12_000) });
        if (!resp.ok) {
            Watchdog.report('biogas-sites', { type: 'failure', error: `HTTP ${resp.status}` });
            return cache?.data ?? [];
        }

        const json = await resp.json() as {
            sites: Array<{
                nom_du_projet?: string;
                commune?: string;
                coordonnees?: { lon: number; lat: number };
                capacite_de_production_gwh_an?: number;
                grx_demandeur?: string;
                gestionnaire_de_registre?: string;
                type_de_reseau?: string;
                site_ouvert?: string;
                procede?: string;
                region?: string;
                departement?: string;
                code_dep?: string;
            }>;
        };

        const sites: BiomethaneSite[] = [];
        for (const rec of json.sites) {
            if (!rec.coordonnees) continue;
            sites.push({
                id: `biom-${rec.commune ?? ''}-${sites.length}`,
                name: rec.nom_du_projet ?? rec.commune ?? 'Inconnu',
                operator: rec.grx_demandeur,
                commune: rec.commune,
                department: rec.departement,
                region: rec.region,
                latitude: rec.coordonnees.lat,
                longitude: rec.coordonnees.lon,
                capacityGwhYear: rec.capacite_de_production_gwh_an,
                status: rec.site_ouvert === 'True' ? 'active' : 'unknown',
                sourceName: 'GRDF OpenData',
                raw: rec,
            });
        }

        cache = { data: sites, fetchedAt: Date.now() };
        Watchdog.report('biogas-sites', { type: 'success', responseTimeMs: Date.now() - t0 });
        return sites;
    } catch (err) {
        Watchdog.report('biogas-sites', { type: 'failure', error: (err as Error).message });
        return cache?.data ?? [];
    }
}
