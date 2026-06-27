import type { ActiveFire, FireIncident } from '../types/index.ts';
import {
    applyPremiumCloseButtonHover,
    createPremiumIconHeader,
    getPremiumCloseButtonStyle,
    getPremiumModalStyle,
} from './panelHeader.ts';
import { applyFiresFilter, DEFAULT_FIRES_FILTER } from '../services/fires.ts';
import type { FiresFilterState } from '../services/fires.ts';
import { clusterFireDetections } from '../services/fire-clustering.ts';
import { fetchNearbyCommuneLabel } from '../services/elus.ts';
import { fmLoaderHTML } from './shared/loader.ts';

function renderTruthBadge(label: string, color: string): string {
    return `<span style="display:inline-flex;align-items:center;justify-content:center;padding:2px 8px;border-radius:999px;background:${color}22;border:1px solid ${color}33;color:${color};font-size:9px;font-weight:700;letter-spacing:0.06em;">${label}</span>`;
}

export class FiresPanel {
    private modalEl!: HTMLElement;
    private contentEl!: HTMLElement;
    private headerSubEl?: HTMLElement;
    private _badgeEl?: HTMLElement;
    private rawFires: ActiveFire[] = [];
    private filterState: FiresFilterState = { ...DEFAULT_FIRES_FILTER };
    private onFilteredFiresCb: ((fires: ActiveFire[]) => void) | null = null;
    private onHoverFireCb: ((lat: number | null, lon: number | null) => void) | null = null;
    private onHoverIncidentCb: ((points: { lat: number; lon: number }[] | null) => void) | null = null;
    private onModisToggleCb: ((enabled: boolean) => void) | null = null;
    private onCloseCb: (() => void) | null = null;
    private modisEnabled = false;
    private isDragging = false;
    private dragOffsetX = 0;
    private dragOffsetY = 0;
    private readonly VISIBLE_BATCH_SIZE = 6;
    private visibleCountByIncident: Map<string, number> = new Map();
    private firePlaceLabels = new Map<string, string>();
    private firePlacePending = new Set<string>();
    /** Geocoding des centroïdes d'incidents : incidentId → commune */
    private incidentPlaceLabels = new Map<string, string>();
    private incidentPlacePending = new Set<string>();
    /** Métadonnées issues de fetchFiresData() */
    private sourcesInfo: string[] = [];
    private apiKeyUsed = false;

    constructor(_container: HTMLElement) {
        // container unused — panel mounts to document.body
    }

    setOnFilteredFires(cb: (fires: ActiveFire[]) => void): void {
        this.onFilteredFiresCb = cb;
    }

    setOnHoverFire(cb: (lat: number | null, lon: number | null) => void): void {
        this.onHoverFireCb = cb;
    }

    /**
     * Appelé quand on survole/quitte une carte d'incident.
     * `points` = toutes les détections du cluster, ou null au mouseleave.
     */
    setOnHoverIncident(cb: (points: { lat: number; lon: number }[] | null) => void): void {
        this.onHoverIncidentCb = cb;
    }

    setOnModisToggle(cb: (enabled: boolean) => void): void {
        this.onModisToggleCb = cb;
    }

    setOnClose(cb: () => void): void {
        this.onCloseCb = cb;
    }

    /** Permet à App.ts de transmettre les métadonnées de la réponse API */
    setSourcesInfo(sources: string[], apiKeyUsed: boolean): void {
        this.sourcesInfo = sources;
        this.apiKeyUsed = apiKeyUsed;
        this._updateHeader();
    }

    mount(): void {
        this.modalEl = document.createElement('div');
        this.modalEl.className = 'fires-panel-modal';
        this.modalEl.style.cssText = [
            getPremiumModalStyle({
                width: '400px',
                maxHeight: 'calc(100vh - 88px)',
                backgroundStart: 'rgba(24, 12, 10, 0.97)',
                backgroundEnd: 'rgba(20, 11, 10, 0.96)',
                borderColor: 'rgba(239, 68, 68, 0.18)',
                position: 'fixed',
                top: '68px',
                zIndex: 9999,
            }),
        ].join(';');

        // Close button
        const closeBtn = document.createElement('button');
        closeBtn.innerHTML = '✕';
        closeBtn.style.cssText = getPremiumCloseButtonStyle();
        applyPremiumCloseButtonHover(closeBtn);
        closeBtn.onclick = () => this.hide();
        this.modalEl.appendChild(closeBtn);

        // Header
        const header = createPremiumIconHeader({
            icon: '🔥',
            title: 'Feux de forêt actifs',
            subtitle: 'NASA FIRMS · VIIRS SNPP · latence ~3h',
            statusId: 'fires-status-label',
            badgeId: 'fires-truth-badge',
            gradientStart: 'rgba(239, 68, 68, 0.18)',
            gradientEnd: 'rgba(245, 158, 11, 0.10)',
            iconGradientStart: 'rgba(239, 68, 68, 0.22)',
            iconGradientEnd: 'rgba(249, 115, 22, 0.14)',
            titlePrefix: 'Veille feux & chaleur',
        });
        header.style.flexShrink = '0';
        this.headerSubEl = header.querySelector('#fires-status-label') as HTMLElement | null ?? undefined;
        this._badgeEl = header.querySelector('#fires-truth-badge') as HTMLElement | null ?? undefined;
        if (this._badgeEl) this._badgeEl.innerHTML = renderTruthBadge('INDISPONIBLE', '#EF4444');
        this.modalEl.appendChild(header);

        // Content
        this.contentEl = document.createElement('div');
        this.contentEl.className = 'fires-panel-content';
        this.contentEl.style.cssText = 'padding:16px;overflow-y:auto;flex:1;';
        this.modalEl.appendChild(this.contentEl);

        document.body.appendChild(this.modalEl);
        this._setupDrag();
    }

    showLoading(): void {
        if (!this.modalEl || !this.contentEl) return;
        this.modalEl.style.display = 'flex';
        this.contentEl.innerHTML = fmLoaderHTML({ text: 'Chargement des foyers actifs…' });
    }

    private _updateHeader(): void {
        if (!this.headerSubEl) return;
        if (this.apiKeyUsed && this.sourcesInfo.length >= 2) {
            this.headerSubEl.textContent = `NASA FIRMS · ${this.sourcesInfo.join(' · ')} · latence ~1h`;
        } else if (this.sourcesInfo.length > 0) {
            this.headerSubEl.textContent = `NASA FIRMS · ${this.sourcesInfo[0]} · latence ~3h`;
        }
        if (this._badgeEl) {
            if (this.sourcesInfo.length === 0) {
                this._badgeEl.innerHTML = renderTruthBadge('INDISPONIBLE', '#EF4444');
            } else if (this.apiKeyUsed) {
                this._badgeEl.innerHTML = renderTruthBadge('TEMPS RÉEL', '#10B981');
            } else {
                this._badgeEl.innerHTML = renderTruthBadge('HISTORIQUE', '#60A5FA');
            }
        }
    }

    private _setupDrag(): void {
        this.modalEl.style.cursor = 'grab';

        this.modalEl.addEventListener('mousedown', (e) => {
            if ((e.target as HTMLElement).closest('button')) return;
            if ((e.target as HTMLElement).closest('.fires-panel-content')) return;
            this.isDragging = true;
            const rect = this.modalEl.getBoundingClientRect();
            this.dragOffsetX = e.clientX - rect.left;
            this.dragOffsetY = e.clientY - rect.top;
            this.modalEl.style.cursor = 'grabbing';
        });

        document.addEventListener('mousemove', (e) => {
            if (!this.isDragging) return;
            const x = e.clientX - this.dragOffsetX;
            const y = e.clientY - this.dragOffsetY;
            const maxX = window.innerWidth - this.modalEl.offsetWidth;
            const maxY = window.innerHeight - this.modalEl.offsetHeight;
            this.modalEl.style.left = Math.max(0, Math.min(x, maxX)) + 'px';
            this.modalEl.style.top = Math.max(0, Math.min(y, maxY)) + 'px';
            this.modalEl.style.right = 'auto';
        });

        document.addEventListener('mouseup', () => {
            if (this.isDragging) {
                this.isDragging = false;
                this.modalEl.style.cursor = 'grab';
            }
        });
    }

    setRawFires(fires: ActiveFire[]): void {
        this.rawFires = fires;
        const filtered = applyFiresFilter(fires, this.filterState);
        this.onFilteredFiresCb?.(filtered);
        if (this.modalEl && this.modalEl.style.display !== 'none') {
            this._renderContent();
        }
    }

    show(fires: ActiveFire[]): void {
        if (!this.modalEl) return;
        this.rawFires = fires;
        this.modalEl.style.display = 'flex';
        this._applyAndNotify();
    }

    hide(): void {
        if (this.modalEl) this.modalEl.style.display = 'none';
        this.onCloseCb?.();
    }

    isVisible(): boolean {
        return this.modalEl?.style.display === 'flex';
    }

    update(fires: ActiveFire[]): void {
        this.rawFires = fires;
        this._applyAndNotify();
    }

    private _applyAndNotify(): void {
        const filtered = applyFiresFilter(this.rawFires, this.filterState);
        this.visibleCountByIncident.clear();
        this.onFilteredFiresCb?.(filtered);
        this._renderContent();
    }

    /**
     * Retourne le lieu d'une détection individuelle.
     * Format : "Commune (lat°N, lon°E)" si géocodée, sinon juste les coords.
     */
    private _getFirePlaceLabel(fire: ActiveFire): string {
        const gps = `${fire.latitude.toFixed(3)}°N, ${fire.longitude.toFixed(3)}°E`;
        const commune = this.firePlaceLabels.get(fire.id);
        if (commune && commune.length > 0) return `${commune} (${gps})`;
        return gps;
    }

    /**
     * Retourne le lieu du centroïde d'un incident.
     * Format : "Commune (lat°N, lon°E)" si géocodé, sinon juste les coords.
     */
    private _getIncidentPlaceLabel(incident: FireIncident): string {
        const gps = `${incident.centroidLat.toFixed(3)}°N, ${incident.centroidLon.toFixed(3)}°E`;
        const commune = this.incidentPlaceLabels.get(incident.id);
        if (commune && commune.length > 0) return `${commune} (${gps})`;
        return gps;
    }

    /** Géocode les centroïdes d'incidents pas encore résolus */
    private async _prefetchIncidentPlaceLabels(incidents: FireIncident[]): Promise<void> {
        const toFetch = incidents.filter(
            i => !this.incidentPlaceLabels.has(i.id) && !this.incidentPlacePending.has(i.id)
        );
        if (toFetch.length === 0) return;

        for (const inc of toFetch) this.incidentPlacePending.add(inc.id);

        const results = await Promise.all(
            toFetch.map(async (inc) => {
                const label = await fetchNearbyCommuneLabel(inc.centroidLat, inc.centroidLon);
                return { id: inc.id, label };
            })
        );

        let changed = false;
        for (const r of results) {
            this.incidentPlacePending.delete(r.id);
            this.incidentPlaceLabels.set(r.id, r.label ?? '');
            changed = true;
        }

        if (changed && this.isVisible()) {
            const scrollTop = this.contentEl.scrollTop;
            this._renderContent();
            requestAnimationFrame(() => { this.contentEl.scrollTop = scrollTop; });
        }
    }

    private async _prefetchFirePlaceLabels(fires: ActiveFire[]): Promise<void> {
        const toFetch = fires.filter((fire) => !this.firePlaceLabels.has(fire.id) && !this.firePlacePending.has(fire.id));
        if (toFetch.length === 0) return;

        for (const fire of toFetch) {
            this.firePlacePending.add(fire.id);
        }

        const results = await Promise.all(
            toFetch.map(async (fire) => {
                const label = await fetchNearbyCommuneLabel(fire.latitude, fire.longitude);
                return { id: fire.id, label };
            })
        );

        let changed = false;
        for (const result of results) {
            this.firePlacePending.delete(result.id);
            this.firePlaceLabels.set(result.id, result.label ?? '');
            changed = true;
        }

        if (changed && this.isVisible()) {
            const scrollTop = this.contentEl.scrollTop;
            this._renderContent();
            requestAnimationFrame(() => {
                this.contentEl.scrollTop = scrollTop;
            });
        }
    }

    // ─── Helpers de rendu ────────────────────────────────────────────────────

    private _severityMeta(score: number): { color: string; bg: string; label: string; dot: string } {
        if (score >= 60) return { color: '#ff3b30', bg: 'rgba(255,59,48,0.12)', label: 'CRITIQUE', dot: '🔴' };
        if (score >= 30) return { color: '#ff9500', bg: 'rgba(255,149,0,0.10)', label: 'MODÉRÉ',   dot: '🟠' };
        return              { color: '#ffd60a', bg: 'rgba(255,214,10,0.08)',  label: 'FAIBLE',   dot: '🟡' };
    }

    private _confidenceColor(conf: string): string {
        if (conf === 'high')    return '#ffd60a';
        if (conf === 'nominal') return '#ff9500';
        return '#ff3b30';
    }

    private _confLabel(conf: string): string {
        if (conf === 'high')    return 'HAUTE';
        if (conf === 'nominal') return 'NOMINALE';
        return 'BASSE';
    }

    private _formatDuration(minutes: number): string {
        if (minutes < 60)  return `${minutes} min`;
        if (minutes < 1440) return `${Math.round(minutes / 60)} h`;
        return `${Math.round(minutes / 1440)} j`;
    }

    // ─── Rendu principal ─────────────────────────────────────────────────────

    private _renderContent(): void {
        this.contentEl.innerHTML = '';

        const filtered = applyFiresFilter(this.rawFires, this.filterState);
        const incidents = clusterFireDetections(filtered, { epsKm: 3, minPoints: 2 });

        // Fires appartenant à un incident vs. détections isolées (bruit DBSCAN)
        const incidentFireIds = new Set(incidents.flatMap(i => i.detectionIds));
        const orphanFires = filtered.filter(f => !incidentFireIds.has(f.id));

        const totalFrp = filtered.reduce((s, f) => s + (f.frp || 0), 0);

        const latestDate = filtered.reduce((latest, f) => {
            const raw = String(f.acq_time).padStart(4, '0');
            const d = `${f.acq_date}T${raw.slice(0, 2)}:${raw.slice(2)}Z`;
            return d > latest ? d : latest;
        }, '');
        const latestLabel = latestDate
            ? new Date(latestDate).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
            : '—';

        // ── 1. À savoir FIRMS ────────────────────────────────────────────────
        this._renderInfoBlock();

        // ── 2. Imagerie VIIRS (NASA GIBS) ────────────────────────────────────
        this._renderModisSection();

        // ── 3. Filtres ────────────────────────────────────────────────────────
        this._renderFilters();

        // ── 4. Stats globales ─────────────────────────────────────────────────
        if (filtered.length === 0) {
            const empty = document.createElement('div');
            empty.style.cssText = 'text-align:center;color:var(--text-muted);padding:24px 0;';
            empty.innerHTML = `<div style="font-size:36px;margin-bottom:12px;opacity:0.5;">✅</div><div style="font-size:13px;">Aucune détection avec ces filtres.</div><div style="font-size:11px;margin-top:8px;opacity:0.7;">${this.rawFires.length} brutes · 0 filtrées</div>`;
            this.contentEl.appendChild(empty);
        } else {
            this._renderStats(filtered, incidents, totalFrp);
            this._renderIncidentList(incidents, orphanFires, filtered);
        }

        // ── 5. Footer ─────────────────────────────────────────────────────────
        this._renderFooter(filtered, incidents, latestLabel);
    }

    // ─── Bloc "À savoir" ─────────────────────────────────────────────────────

    private _renderInfoBlock(): void {
        const multiSource = this.apiKeyUsed && this.sourcesInfo.length >= 2;
        const satellites  = multiSource ? this.sourcesInfo.join(', ') : 'SNPP';
        const revisit     = multiSource ? '~1 h (3 orbites combinées)' : '~3 h (orbite unique)';

        const info = document.createElement('details');
        info.style.cssText = 'background:rgba(255,149,0,0.07);border:1px solid rgba(255,149,0,0.22);border-radius:8px;padding:10px 12px;margin-bottom:14px;cursor:pointer;';
        info.innerHTML = `
            <summary style="color:#ff9500;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;list-style:none;display:flex;align-items:center;gap:6px;user-select:none;">
                <span>ℹ️</span> À savoir sur FIRMS <span style="margin-left:auto;font-size:10px;opacity:0.7;">▸</span>
            </summary>
            <div style="margin-top:10px;color:var(--text-muted);font-size:11px;line-height:1.8;display:flex;flex-direction:column;gap:4px;">
                <div>🛰️ <b style="color:var(--text-primary);">${satellites}</b> — revisite France toutes les <b style="color:var(--text-primary);">${revisit}</b>.</div>
                ${multiSource ? '<div>🔗 Détections proches (&lt; 3 km) regroupées en <b style="color:var(--text-primary);">incidents DBSCAN</b> avec score de sévérité.</div>' : ''}
                ${multiSource ? '<div>✅ Un incident vu par 2+ satellites reçoit le label <b style="color:#ff9500;">multi-satellite</b> (score impact ↑).</div>' : ''}
                <div>⚠️ <b style="color:var(--text-primary);">Faux positifs</b> : torchères industrielles, aciéries, champs brûlés, réflexions solaires.</div>
                <div>💡 Activez <b style="color:var(--text-primary);">Masquer zones urbaines</b> pour filtrer les sources industrielles permanentes.</div>
            </div>`;
        this.contentEl.appendChild(info);
    }

    // ─── Section imagerie VIIRS ───────────────────────────────────────────────

    private _renderModisSection(): void {
        const section = document.createElement('div');
        section.style.cssText = 'background:rgba(255,255,255,0.04);border:1px solid var(--border-color);border-radius:8px;padding:12px;margin-bottom:14px;';
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;';
        const left = document.createElement('div');
        left.innerHTML = '<div style="color:var(--text-primary);font-size:12px;font-weight:500;">Imagerie satellite (fumée / feux)</div><div style="color:var(--text-muted);font-size:10px;margin-top:2px;">NASA GIBS · VIIRS SNPP Corrected Reflectance · latence ~2 jours</div>';
        row.appendChild(left);

        const sw = document.createElement('div');
        sw.style.cssText = `width:36px;height:20px;border-radius:10px;background:${this.modisEnabled ? '#ff9500' : 'rgba(255,255,255,0.15)'};position:relative;cursor:pointer;transition:background 0.2s;flex-shrink:0;`;
        const knob = document.createElement('div');
        knob.style.cssText = `width:16px;height:16px;border-radius:8px;background:white;position:absolute;top:2px;left:${this.modisEnabled ? '18px' : '2px'};transition:left 0.2s;box-shadow:0 1px 3px rgba(0,0,0,0.3);`;
        sw.appendChild(knob);
        sw.onclick = () => {
            this.modisEnabled = !this.modisEnabled;
            this.onModisToggleCb?.(this.modisEnabled);
            sw.style.background = this.modisEnabled ? '#ff9500' : 'rgba(255,255,255,0.15)';
            knob.style.left = this.modisEnabled ? '18px' : '2px';
        };
        row.appendChild(sw);
        section.appendChild(row);
        this.contentEl.appendChild(section);
    }

    // ─── Filtres ────────────────────────────────────────────────────────────

    private _renderFilters(): void {
        const section = document.createElement('div');
        section.style.cssText = 'background:rgba(255,255,255,0.04);border:1px solid var(--border-color);border-radius:8px;padding:12px;margin-bottom:14px;display:flex;flex-direction:column;gap:12px;';

        // Confidence
        const confWrap = document.createElement('div');
        confWrap.innerHTML = '<div style="color:var(--text-muted);font-size:10px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Confiance minimum</div>';
        const confPills = document.createElement('div');
        confPills.style.cssText = 'display:flex;gap:6px;';
        (['low', 'nominal', 'high'] as FiresFilterState['minConfidence'][]).forEach((k, i) => {
            const label = ['Basse', 'Nominale', 'Haute'][i];
            const active = this.filterState.minConfidence === k;
            const p = document.createElement('button');
            p.textContent = label;
            p.style.cssText = `flex:1;padding:6px 4px;font-size:11px;border-radius:6px;border:1px solid ${active ? 'rgba(255,149,0,0.6)' : 'var(--border-color)'};background:${active ? 'rgba(255,149,0,0.18)' : 'transparent'};color:${active ? '#ff9500' : 'var(--text-muted)'};cursor:pointer;font-weight:${active ? '600' : '400'};`;
            p.onclick = () => { this.filterState = { ...this.filterState, minConfidence: k }; this._applyAndNotify(); };
            confPills.appendChild(p);
        });
        confWrap.appendChild(confPills);
        section.appendChild(confWrap);

        // Urban
        const withUrban    = applyFiresFilter(this.rawFires, { ...this.filterState, hideUrban: false }).length;
        const withoutUrban = applyFiresFilter(this.rawFires, { ...this.filterState, hideUrban: true  }).length;
        const urbanHidden  = withUrban - withoutUrban;
        const urbanRow = document.createElement('div');
        urbanRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;';
        const urbanLeft = document.createElement('div');
        urbanLeft.innerHTML = `<div style="color:var(--text-primary);font-size:12px;">Masquer zones urbaines/portuaires</div><div style="color:var(--text-muted);font-size:10px;">Filtre torchères, usines, ports · <span style="color:${urbanHidden > 0 ? '#ff9500' : 'var(--text-muted)'};font-weight:600;">${urbanHidden} filtrées</span></div>`;
        urbanRow.appendChild(urbanLeft);
        const sw = document.createElement('div');
        sw.style.cssText = `width:36px;height:20px;border-radius:10px;background:${this.filterState.hideUrban ? '#ff9500' : 'rgba(255,255,255,0.15)'};position:relative;cursor:pointer;transition:background 0.2s;flex-shrink:0;`;
        const swKnob = document.createElement('div');
        swKnob.style.cssText = `width:16px;height:16px;border-radius:8px;background:white;position:absolute;top:2px;left:${this.filterState.hideUrban ? '18px' : '2px'};transition:left 0.2s;box-shadow:0 1px 3px rgba(0,0,0,0.3);`;
        sw.appendChild(swKnob);
        sw.onclick = () => { this.filterState = { ...this.filterState, hideUrban: !this.filterState.hideUrban }; this._applyAndNotify(); };
        urbanRow.appendChild(sw);
        section.appendChild(urbanRow);

        // Persistence
        const persistWrap = document.createElement('div');
        persistWrap.innerHTML = '<div style="color:var(--text-muted);font-size:10px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Persistance minimum</div>';
        const persistPills = document.createElement('div');
        persistPills.style.cssText = 'display:flex;gap:6px;';
        ([1, 2, 3] as number[]).forEach((v, i) => {
            const label = ['Toutes', '2+ passes', '3+ passes'][i];
            const active = this.filterState.minPersistence === v;
            const p = document.createElement('button');
            p.textContent = label;
            p.style.cssText = `flex:1;padding:6px 4px;font-size:11px;border-radius:6px;border:1px solid ${active ? 'rgba(255,149,0,0.6)' : 'var(--border-color)'};background:${active ? 'rgba(255,149,0,0.18)' : 'transparent'};color:${active ? '#ff9500' : 'var(--text-muted)'};cursor:pointer;font-weight:${active ? '600' : '400'};`;
            p.onclick = () => { this.filterState = { ...this.filterState, minPersistence: v }; this._applyAndNotify(); };
            persistPills.appendChild(p);
        });
        persistWrap.appendChild(persistPills);
        section.appendChild(persistWrap);

        this.contentEl.appendChild(section);
    }

    // ─── Stats globales ───────────────────────────────────────────────────────

    private _renderStats(filtered: ActiveFire[], incidents: FireIncident[], totalFrp: number): void {
        const high    = filtered.filter(f => f.confidence === 'high').length;
        const nominal = filtered.filter(f => f.confidence === 'nominal').length;
        const low     = filtered.filter(f => f.confidence === 'low').length;
        const criticalInc = incidents.filter(i => i.score.severityScore >= 60).length;
        const moderateInc = incidents.filter(i => i.score.severityScore >= 30 && i.score.severityScore < 60).length;

        const stats = document.createElement('div');
        stats.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px;';
        stats.innerHTML = `
            <div style="background:rgba(255,59,48,0.10);border:1px solid rgba(255,59,48,0.28);border-radius:8px;padding:10px;text-align:center;">
                <div style="color:#ff3b30;font-size:20px;font-weight:700;">${incidents.length}</div>
                <div style="color:var(--text-muted);font-size:10px;text-transform:uppercase;margin-top:2px;">Incidents</div>
                <div style="color:var(--text-muted);font-size:10px;margin-top:1px;">${criticalInc} critiques</div>
            </div>
            <div style="background:rgba(255,149,0,0.08);border:1px solid rgba(255,149,0,0.25);border-radius:8px;padding:10px;text-align:center;">
                <div style="color:#ff9500;font-size:20px;font-weight:700;">${filtered.length}</div>
                <div style="color:var(--text-muted);font-size:10px;text-transform:uppercase;margin-top:2px;">Détections</div>
                <div style="color:var(--text-muted);font-size:10px;margin-top:1px;">FRP ${totalFrp.toFixed(0)} MW</div>
            </div>
            <div style="background:rgba(255,214,10,0.06);border:1px solid rgba(255,214,10,0.20);border-radius:8px;padding:10px;text-align:center;">
                <div style="color:#ffd60a;font-size:20px;font-weight:700;">${high}</div>
                <div style="color:var(--text-muted);font-size:10px;text-transform:uppercase;margin-top:2px;">Haute conf.</div>
                <div style="color:var(--text-muted);font-size:10px;margin-top:1px;">${nominal} nom. · ${low} basse</div>
            </div>`;
        this.contentEl.appendChild(stats);

        // Résumé incidents
        if (incidents.length > 0) {
            const summary = document.createElement('div');
            summary.style.cssText = 'color:var(--text-muted);font-size:11px;line-height:1.5;margin-bottom:10px;';
            const nearUrbanCount = incidents.filter(i => i.nearUrban).length;
            const multiSatCount  = incidents.filter(i => i.satellites.length >= 2).length;
            const parts: string[] = [];
            if (criticalInc > 0) parts.push(`<span style="color:#ff3b30;font-weight:600;">${criticalInc} critique${criticalInc > 1 ? 's' : ''}</span>`);
            if (moderateInc > 0) parts.push(`<span style="color:#ff9500;font-weight:600;">${moderateInc} modéré${moderateInc > 1 ? 's' : ''}</span>`);
            if (nearUrbanCount > 0) parts.push(`<span style="color:#ff9500;">${nearUrbanCount} près de zones urbaines</span>`);
            if (multiSatCount > 0 && this.apiKeyUsed) parts.push(`<span style="color:#ffd60a;">${multiSatCount} confirmés multi-satellite</span>`);
            if (parts.length > 0) {
                summary.innerHTML = parts.join(' · ');
                this.contentEl.appendChild(summary);
            }
        }
    }

    // ─── Liste incidents ──────────────────────────────────────────────────────

    private _renderIncidentList(incidents: FireIncident[], orphanFires: ActiveFire[], _filtered: ActiveFire[]): void {
        const listTitle = document.createElement('div');
        listTitle.style.cssText = 'color:var(--text-muted);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;';
        listTitle.textContent = incidents.length > 0 ? `Incidents détectés (${incidents.length})` : 'Détections brutes';
        this.contentEl.appendChild(listTitle);

        const list = document.createElement('div');
        list.style.cssText = 'display:flex;flex-direction:column;gap:8px;';

        // ── Incidents DBSCAN ─────────────────────────────────────────────────
        // Lancer le géocodage de tous les centroïdes d'incidents visibles
        void this._prefetchIncidentPlaceLabels(incidents);

        for (const incident of incidents) {
            const meta = this._severityMeta(incident.score.severityScore);
            const fires = incident.detectionIds
                .map(id => this.rawFires.find(f => f.id === id))
                .filter((f): f is ActiveFire => f !== undefined);

            // Calcul du label d'impact
            const impactLabels = incident.score.labels
                .filter(l => ['near_urban', 'night', 'multi_satellite', 'high_confidence'].includes(l))
                .map(l => ({
                    near_urban:       '🏙️ Zone urbaine',
                    night:            '🌙 Détection nocturne',
                    multi_satellite:  '🛰️ Multi-satellite',
                    high_confidence:  '✅ Haute confiance',
                }[l] ?? l));

            const section = document.createElement('details');
            section.style.cssText = `background:${meta.bg};border:1px solid ${meta.color}33;border-radius:10px;overflow:hidden;`;

            // En-tête incident
            const hdr = document.createElement('summary');
            hdr.style.cssText = 'list-style:none;display:flex;flex-direction:column;gap:4px;padding:12px 14px;cursor:pointer;';
            hdr.innerHTML = `
                <div style="display:flex;align-items:center;gap:8px;">
                    <div style="width:8px;height:8px;border-radius:50%;background:${meta.color};flex-shrink:0;"></div>
                    <div style="color:${meta.color};font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;">${meta.label}</div>
                    <div style="margin-left:auto;display:flex;gap:8px;align-items:center;">
                        <span style="color:${meta.color};font-size:13px;font-weight:700;">${incident.frpTotal.toFixed(0)} MW</span>
                        <span style="color:var(--text-muted);font-size:11px;">${incident.detectionsCount} det.</span>
                    </div>
                </div>
                <div style="display:flex;gap:10px;align-items:center;padding-left:16px;">
                    <span style="color:var(--text-muted);font-size:10px;">
                        📍 ${this._getIncidentPlaceLabel(incident)}
                    </span>
                    <span style="color:var(--text-muted);font-size:10px;">·</span>
                    <span style="color:var(--text-muted);font-size:10px;">⏱ ${this._formatDuration(incident.durationMinutes)}</span>
                    ${incident.satellites.length >= 2
                        ? `<span style="color:var(--text-muted);font-size:10px;">·</span><span style="color:#ffd60a;font-size:10px;">🛰️ ${incident.satellites.join('+')}</span>`
                        : `<span style="color:var(--text-muted);font-size:10px;">·</span><span style="color:var(--text-muted);font-size:10px;">${incident.satellites[0] ?? 'SNPP'}</span>`}
                </div>
                ${impactLabels.length > 0
                    ? `<div style="display:flex;flex-wrap:wrap;gap:4px;padding-left:16px;">${impactLabels.map(l => `<span style="background:rgba(255,255,255,0.08);border-radius:4px;padding:2px 6px;font-size:9px;color:var(--text-muted);">${l}</span>`).join('')}</div>`
                    : ''}
                <div style="display:flex;gap:6px;padding-left:16px;">
                    <div style="flex:1;background:rgba(255,255,255,0.05);border-radius:4px;padding:4px 8px;font-size:10px;color:var(--text-muted);">
                        Sévérité <span style="color:${meta.color};font-weight:700;">${incident.score.severityScore}/100</span>
                    </div>
                    <div style="flex:1;background:rgba(255,255,255,0.05);border-radius:4px;padding:4px 8px;font-size:10px;color:var(--text-muted);">
                        Impact <span style="color:${incident.nearUrban ? '#ff3b30' : meta.color};font-weight:700;">${incident.score.impactScore}/100</span>
                    </div>
                </div>`;
            section.appendChild(hdr);

            // Hover sur la section incident → highlight du cluster complet sur la carte
            const clusterPoints = fires.map(f => ({ lat: f.latitude, lon: f.longitude }));
            section.addEventListener('mouseenter', () => {
                this.onHoverIncidentCb?.(clusterPoints);
            });
            section.addEventListener('mouseleave', () => {
                this.onHoverIncidentCb?.(null);
            });
            // Corps : liste des détections
            const body = document.createElement('div');
            body.style.cssText = 'border-top:1px solid rgba(255,255,255,0.06);';

            const visibleKey = incident.id;
            const visibleCount = this.visibleCountByIncident.get(visibleKey) ?? this.VISIBLE_BATCH_SIZE;
            const visibleFires = fires.slice(0, visibleCount);

            void this._prefetchFirePlaceLabels(visibleFires);

            for (const f of visibleFires) {
                const confColor = this._confidenceColor(f.confidence);
                const raw = String(f.acq_time).padStart(4, '0');
                const period = f.daynight === 'D' ? '☀️' : '🌙';
                const item = document.createElement('div');
                item.style.cssText = `display:flex;justify-content:space-between;align-items:center;padding:8px 14px;border-bottom:1px solid rgba(255,255,255,0.04);cursor:pointer;transition:background 0.15s;gap:8px;`;
                item.innerHTML = `
                    <div style="flex:1;min-width:0;">
                        <div style="color:var(--text-primary);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${this._getFirePlaceLabel(f)} ${period}</div>
                        <div style="color:var(--text-muted);font-size:10px;margin-top:1px;">${f.acq_date} · ${raw.slice(0,2)}:${raw.slice(2)} UTC · <span style="color:${confColor};">${this._confLabel(f.confidence)}</span></div>
                    </div>
                    <div style="color:${meta.color};font-size:12px;font-weight:700;white-space:nowrap;">${(f.frp || 0).toFixed(1)} MW</div>`;
                item.addEventListener('mouseenter', (e) => {
                    e.stopPropagation();
                    item.style.background = 'rgba(255,149,0,0.08)'; 
                    this.onHoverFireCb?.(f.latitude, f.longitude); 
                });
                item.addEventListener('mouseleave', (e) => {
                    e.stopPropagation();
                    item.style.background = 'transparent'; 
                    // Au lieu d'effacer, on restaure le halo du cluster complet (puisqu'on est toujours dedans)
                    this.onHoverIncidentCb?.(clusterPoints); 
                });
                body.appendChild(item);
            }

            if (fires.length > visibleCount) {
                const moreWrap = document.createElement('div');
                moreWrap.style.cssText = 'display:flex;justify-content:center;padding:8px;';
                const moreBtn = document.createElement('button');
                moreBtn.textContent = `+ ${Math.min(this.VISIBLE_BATCH_SIZE, fires.length - visibleCount)} détections`;
                moreBtn.style.cssText = 'padding:6px 12px;border-radius:6px;border:1px solid var(--border-color);background:rgba(255,255,255,0.04);color:var(--text-muted);font-size:10px;cursor:pointer;';
                moreBtn.onclick = (e) => {
                    e.stopPropagation();
                    this.visibleCountByIncident.set(visibleKey, visibleCount + this.VISIBLE_BATCH_SIZE);
                    const scrollTop = this.contentEl.scrollTop;
                    this._renderContent();
                    requestAnimationFrame(() => { this.contentEl.scrollTop = scrollTop; });
                };
                moreWrap.appendChild(moreBtn);
                body.appendChild(moreWrap);
            }

            section.appendChild(body);
            list.appendChild(section);
        }

        // ── Détections isolées (bruit DBSCAN) ────────────────────────────────
        if (orphanFires.length > 0) {
            const orphanSorted = [...orphanFires].sort((a, b) => (b.frp || 0) - (a.frp || 0));
            const orphanSection = document.createElement('details');
            orphanSection.style.cssText = 'background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.07);border-radius:10px;overflow:hidden;';

            const orphanHdr = document.createElement('summary');
            orphanHdr.style.cssText = 'list-style:none;display:flex;align-items:center;gap:8px;padding:10px 14px;cursor:pointer;';
            orphanHdr.innerHTML = `
                <div style="width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,0.3);flex-shrink:0;"></div>
                <div style="color:var(--text-muted);font-size:11px;font-weight:600;">Détections isolées</div>
                <div style="color:var(--text-muted);font-size:10px;margin-left:auto;">${orphanFires.length} point${orphanFires.length > 1 ? 's' : ''} · hors cluster</div>`;
            orphanSection.appendChild(orphanHdr);

            // Hover sur la section orphans → highlight du point individuel au mouseleave = clear
            orphanSection.addEventListener('mouseleave', () => {
                this.onHoverIncidentCb?.(null);
                this.onHoverFireCb?.(null, null);
            });

            const orphanBody = document.createElement('div');
            orphanBody.style.cssText = 'border-top:1px solid rgba(255,255,255,0.06);';

            const visibleKey = '__orphans__';
            const visibleCount = this.visibleCountByIncident.get(visibleKey) ?? this.VISIBLE_BATCH_SIZE;
            const visibleOrphans = orphanSorted.slice(0, visibleCount);

            void this._prefetchFirePlaceLabels(visibleOrphans);

            for (const f of visibleOrphans) {
                const confColor = this._confidenceColor(f.confidence);
                const raw = String(f.acq_time).padStart(4, '0');
                const period = f.daynight === 'D' ? '☀️' : '🌙';
                const item = document.createElement('div');
                item.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:8px 14px;border-bottom:1px solid rgba(255,255,255,0.04);cursor:pointer;transition:background 0.15s;gap:8px;';
                item.innerHTML = `
                    <div style="flex:1;min-width:0;">
                        <div style="color:var(--text-primary);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${this._getFirePlaceLabel(f)} ${period}</div>
                        <div style="color:var(--text-muted);font-size:10px;margin-top:1px;">${f.acq_date} · ${raw.slice(0,2)}:${raw.slice(2)} UTC · <span style="color:${confColor};">${this._confLabel(f.confidence)}</span></div>
                    </div>
                    <div style="color:var(--text-muted);font-size:12px;font-weight:600;white-space:nowrap;">${(f.frp || 0).toFixed(1)} MW</div>`;
                item.addEventListener('mouseenter', (e) => {
                    e.stopPropagation();
                    item.style.background = 'rgba(255,255,255,0.04)'; 
                    this.onHoverFireCb?.(f.latitude, f.longitude); 
                });
                item.addEventListener('mouseleave', (e) => {
                    e.stopPropagation();
                    item.style.background = 'transparent'; 
                    // Restaurer l'état vide vu qu'il n'y a pas de parent cluster ici
                    this.onHoverFireCb?.(null, null); 
                });
                orphanBody.appendChild(item);
            }

            if (orphanFires.length > visibleCount) {
                const moreWrap = document.createElement('div');
                moreWrap.style.cssText = 'display:flex;justify-content:center;padding:8px;';
                const moreBtn = document.createElement('button');
                moreBtn.textContent = `+ ${Math.min(this.VISIBLE_BATCH_SIZE, orphanFires.length - visibleCount)} de plus`;
                moreBtn.style.cssText = 'padding:6px 12px;border-radius:6px;border:1px solid var(--border-color);background:rgba(255,255,255,0.04);color:var(--text-muted);font-size:10px;cursor:pointer;';
                moreBtn.onclick = (e) => {
                    e.stopPropagation();
                    this.visibleCountByIncident.set(visibleKey, visibleCount + this.VISIBLE_BATCH_SIZE);
                    const scrollTop = this.contentEl.scrollTop;
                    this._renderContent();
                    requestAnimationFrame(() => { this.contentEl.scrollTop = scrollTop; });
                };
                moreWrap.appendChild(moreBtn);
                orphanBody.appendChild(moreWrap);
            }

            orphanSection.appendChild(orphanBody);
            list.appendChild(orphanSection);
        }

        this.contentEl.appendChild(list);
    }

    // ─── Footer ───────────────────────────────────────────────────────────────

    private _renderFooter(filtered: ActiveFire[], incidents: FireIncident[], latestLabel: string): void {
        const multiSource  = this.apiKeyUsed && this.sourcesInfo.length >= 2;
        const satelliteStr = this.sourcesInfo.length > 0 ? this.sourcesInfo.join(' · ') : 'SNPP (public)';
        const revisitStr   = multiSource ? '~1 h de revisite' : '~3 h de revisite';

        const footer = document.createElement('div');
        footer.style.cssText = 'margin-top:16px;padding:12px 0 0;border-top:1px solid var(--border-color);display:flex;flex-direction:column;gap:4px;';

        // Ligne satellites
        const satLine = document.createElement('div');
        satLine.style.cssText = 'display:flex;align-items:center;gap:6px;';
        satLine.innerHTML = `
            <span style="font-size:10px;">🛰️</span>
            <span style="color:var(--text-muted);font-size:10px;">${satelliteStr}</span>
            <span style="color:var(--border-color);font-size:10px;">·</span>
            <span style="color:var(--text-muted);font-size:10px;">${revisitStr}</span>
            ${multiSource ? '<span style="background:rgba(255,214,10,0.15);color:#ffd60a;font-size:9px;padding:1px 6px;border-radius:4px;font-weight:600;margin-left:2px;">API KEY ✓</span>' : ''}`;
        footer.appendChild(satLine);

        // Ligne stats
        const statsLine = document.createElement('div');
        statsLine.style.cssText = 'display:flex;flex-wrap:wrap;gap:x 8px;color:var(--text-muted);font-size:10px;';
        statsLine.innerHTML = `
            <span>Brutes : <b style="color:var(--text-primary);">${this.rawFires.length}</b></span>
            <span style="margin:0 4px;opacity:0.4;">·</span>
            <span>Filtrées : <b style="color:var(--text-primary);">${filtered.length}</b></span>
            <span style="margin:0 4px;opacity:0.4;">·</span>
            <span>Incidents : <b style="color:var(--text-primary);">${incidents.length}</b></span>
            <span style="margin:0 4px;opacity:0.4;">·</span>
            <span>Dernière : <b style="color:var(--text-primary);">${latestLabel}</b></span>`;
        footer.appendChild(statsLine);

        this.contentEl.appendChild(footer);
    }
}
