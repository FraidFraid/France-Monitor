import type { ActiveFire } from '../types/index.ts';
import { applyFiresFilter, DEFAULT_FIRES_FILTER } from '../services/fires.ts';
import type { FiresFilterState } from '../services/fires.ts';

export class FiresPanel {
    private modalEl!: HTMLElement;
    private contentEl!: HTMLElement;
    private rawFires: ActiveFire[] = [];
    private filterState: FiresFilterState = { ...DEFAULT_FIRES_FILTER };
    private onFilteredFiresCb: ((fires: ActiveFire[]) => void) | null = null;
    private onHoverFireCb: ((lat: number | null, lon: number | null) => void) | null = null;
    private onModisToggleCb: ((enabled: boolean) => void) | null = null;
    private modisEnabled = false;
    private isDragging = false;
    private dragOffsetX = 0;
    private dragOffsetY = 0;

    constructor(_container: HTMLElement) {
        // container unused — panel mounts to document.body
    }

    setOnFilteredFires(cb: (fires: ActiveFire[]) => void): void {
        this.onFilteredFiresCb = cb;
    }

    setOnHoverFire(cb: (lat: number | null, lon: number | null) => void): void {
        this.onHoverFireCb = cb;
    }

    setOnModisToggle(cb: (enabled: boolean) => void): void {
        this.onModisToggleCb = cb;
    }

    mount(): void {
        this.modalEl = document.createElement('div');
        this.modalEl.style.cssText = [
            'position:fixed',
            'top:68px',
            'right:20px',
            'width:360px',
            'max-height:calc(100vh - 88px)',
            'background:var(--bg-surface)',
            'border:1px solid var(--border-color)',
            'border-radius:12px',
            'box-shadow:0 8px 32px rgba(0,0,0,0.6)',
            'z-index:9999',
            'display:none',
            'flex-direction:column',
            'backdrop-filter:blur(10px)',
            'overflow:hidden',
        ].join(';');

        // Close button
        const closeBtn = document.createElement('button');
        closeBtn.innerHTML = '✕';
        closeBtn.style.cssText = [
            'position:absolute',
            'top:12px',
            'right:12px',
            'background:rgba(255,255,255,0.1)',
            'border:none',
            'color:var(--text-muted)',
            'cursor:pointer',
            'font-size:14px',
            'width:28px',
            'height:28px',
            'border-radius:14px',
            'display:flex',
            'align-items:center',
            'justify-content:center',
        ].join(';');
        closeBtn.onclick = () => this.hide();
        this.modalEl.appendChild(closeBtn);

        // Header
        const header = document.createElement('div');
        header.style.cssText = 'padding:16px;border-bottom:1px solid var(--border-color);display:flex;align-items:center;gap:12px;flex-shrink:0;';
        header.innerHTML = '<div style="font-size:24px">🔥</div><div><div style="color:var(--text-primary);font-weight:600;font-size:14px;">Feux de forêt actifs</div><div style="color:var(--text-muted);font-size:11px;">NASA FIRMS · VIIRS SNPP · latence ~3h</div></div>';
        this.modalEl.appendChild(header);

        // Content
        this.contentEl = document.createElement('div');
        this.contentEl.className = 'fires-panel-content';
        this.contentEl.style.cssText = 'padding:16px;overflow-y:auto;flex:1;';
        this.modalEl.appendChild(this.contentEl);

        document.body.appendChild(this.modalEl);
        this._setupDrag();
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
        this._applyAndNotify(); // sync carte + re-render panel
    }

    hide(): void {
        if (this.modalEl) this.modalEl.style.display = 'none';
    }

    update(fires: ActiveFire[]): void {
        this.rawFires = fires;
        this._applyAndNotify();
    }

    private _applyAndNotify(): void {
        const filtered = applyFiresFilter(this.rawFires, this.filterState);
        this.onFilteredFiresCb?.(filtered);
        this._renderContent();
    }

    private _renderContent(): void {
        this.contentEl.innerHTML = '';

        const filtered = applyFiresFilter(this.rawFires, this.filterState);
        const high = filtered.filter(f => f.confidence === 'high');
        const totalFrp = filtered.reduce((s, f) => s + (f.frp || 0), 0);
        const sorted = [...filtered].sort((a, b) => (b.frp || 0) - (a.frp || 0));

        const latestDate = filtered.reduce((latest, f) => {
            const raw = String(f.acq_time).padStart(4, '0');
            const d = `${f.acq_date}T${raw.slice(0, 2)}:${raw.slice(2)}Z`;
            return d > latest ? d : latest;
        }, '');
        const latestLabel = latestDate
            ? new Date(latestDate).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
            : '—';

        // ── À savoir FIRMS ──
        const info = document.createElement('details');
        info.style.cssText = 'background:rgba(255,149,0,0.08);border:1px solid rgba(255,149,0,0.25);border-radius:8px;padding:10px 12px;margin-bottom:14px;cursor:pointer;';
        info.innerHTML = '<summary style="color:#ff9500;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;list-style:none;display:flex;align-items:center;gap:6px;user-select:none;"><span>ℹ️</span> À savoir sur FIRMS <span style="margin-left:auto;font-size:10px;opacity:0.7;">▸</span></summary><div style="margin-top:10px;color:var(--text-muted);font-size:11px;line-height:1.6;">🛰️ VIIRS détecte les anomalies thermiques toutes les ~3h.<br>⚠️ Faux positifs : torchères industrielles, aciéries, champs brûlés, réflexions solaires.<br>✅ Utilisez les filtres pour réduire le bruit.</div>';
        this.contentEl.appendChild(info);

        // ── Imagerie VIIRS (NASA GIBS) ──
        const modisSection = document.createElement('div');
        modisSection.style.cssText = 'background:rgba(255,255,255,0.04);border:1px solid var(--border-color);border-radius:8px;padding:12px;margin-bottom:14px;';
        const modisRow = document.createElement('div');
        modisRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;';
        const modisLeft = document.createElement('div');
        modisLeft.innerHTML = '<div style="color:var(--text-primary);font-size:12px;font-weight:500;">Imagerie VIIRS (fumée / feux)</div><div style="color:var(--text-muted);font-size:10px;margin-top:2px;">Fond satellite NASA GIBS · VIIRS SNPP Corrected Reflectance · latence ~2 jours</div>';
        modisRow.appendChild(modisLeft);
        const modisSw = document.createElement('div');
        modisSw.style.cssText = `width:36px;height:20px;border-radius:10px;background:${this.modisEnabled ? '#ff9500' : 'rgba(255,255,255,0.15)'};position:relative;cursor:pointer;transition:background 0.2s;flex-shrink:0;`;
        const modisKnob = document.createElement('div');
        modisKnob.style.cssText = `width:16px;height:16px;border-radius:8px;background:white;position:absolute;top:2px;left:${this.modisEnabled ? '18px' : '2px'};transition:left 0.2s;box-shadow:0 1px 3px rgba(0,0,0,0.3);`;
        modisSw.appendChild(modisKnob);
        modisSw.onclick = () => {
            this.modisEnabled = !this.modisEnabled;
            this.onModisToggleCb?.(this.modisEnabled);
            modisSw.style.background = this.modisEnabled ? '#ff9500' : 'rgba(255,255,255,0.15)';
            modisKnob.style.left = this.modisEnabled ? '18px' : '2px';
        };
        modisRow.appendChild(modisSw);
        modisSection.appendChild(modisRow);
        this.contentEl.appendChild(modisSection);

        // ── Filtres ──
        const filtersSection = document.createElement('div');
        filtersSection.style.cssText = 'background:rgba(255,255,255,0.04);border:1px solid var(--border-color);border-radius:8px;padding:12px;margin-bottom:14px;display:flex;flex-direction:column;gap:12px;';

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
        filtersSection.appendChild(confWrap);

        // Urban toggle — count how many raw fires are in urban zones
        const withUrban    = applyFiresFilter(this.rawFires, { ...this.filterState, hideUrban: false }).length;
        const withoutUrban = applyFiresFilter(this.rawFires, { ...this.filterState, hideUrban: true  }).length;
        const urbanHidden  = withUrban - withoutUrban;
        const urbanRow = document.createElement('div');
        urbanRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;';
        const urbanLeft = document.createElement('div');
        urbanLeft.innerHTML = `<div style="color:var(--text-primary);font-size:12px;">Masquer zones urbaines/portuaires</div><div style="color:var(--text-muted);font-size:10px;">Filtre torchères, usines, ports · <span style="color:${urbanHidden > 0 ? '#ff9500' : 'var(--text-muted)'};font-weight:600;">${urbanHidden} détections concernées</span></div>`;
        urbanRow.appendChild(urbanLeft);
        const sw = document.createElement('div');
        sw.style.cssText = `width:36px;height:20px;border-radius:10px;background:${this.filterState.hideUrban ? '#ff9500' : 'rgba(255,255,255,0.15)'};position:relative;cursor:pointer;transition:background 0.2s;flex-shrink:0;`;
        const knob = document.createElement('div');
        knob.style.cssText = `width:16px;height:16px;border-radius:8px;background:white;position:absolute;top:2px;left:${this.filterState.hideUrban ? '18px' : '2px'};transition:left 0.2s;box-shadow:0 1px 3px rgba(0,0,0,0.3);`;
        sw.appendChild(knob);
        sw.onclick = () => { this.filterState = { ...this.filterState, hideUrban: !this.filterState.hideUrban }; this._applyAndNotify(); };
        urbanRow.appendChild(sw);
        filtersSection.appendChild(urbanRow);

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
        filtersSection.appendChild(persistWrap);

        this.contentEl.appendChild(filtersSection);

        // ── Légende ──
        const legend = document.createElement('div');
        legend.style.cssText = 'display:flex;gap:10px;align-items:center;margin-bottom:14px;padding:8px 12px;background:rgba(255,255,255,0.03);border-radius:8px;border:1px solid var(--border-color);';
        legend.innerHTML = '<span style="color:var(--text-muted);font-size:10px;text-transform:uppercase;letter-spacing:0.5px;flex-shrink:0;">Confiance</span><div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;"><div style="display:flex;align-items:center;gap:5px;"><div style="width:10px;height:10px;border-radius:50%;background:#ffd60a;"></div><span style="color:var(--text-muted);font-size:10px;">Haute</span></div><div style="display:flex;align-items:center;gap:5px;"><div style="width:10px;height:10px;border-radius:50%;background:#ff9500;"></div><span style="color:var(--text-muted);font-size:10px;">Nominale</span></div><div style="display:flex;align-items:center;gap:5px;"><div style="width:10px;height:10px;border-radius:50%;background:#ff3b30;"></div><span style="color:var(--text-muted);font-size:10px;">Basse</span></div></div>';
        this.contentEl.appendChild(legend);

        // ── Stats ──
        if (filtered.length === 0) {
            const empty = document.createElement('div');
            empty.style.cssText = 'text-align:center;color:var(--text-muted);padding:20px 0;';
            empty.innerHTML = `<div style="font-size:32px;margin-bottom:12px;opacity:0.5;">✅</div><div>Aucune détection avec ces filtres.</div><div style="font-size:11px;margin-top:8px;opacity:0.7;">${this.rawFires.length} brutes · ${filtered.length} filtrées</div>`;
            this.contentEl.appendChild(empty);
        } else {
            const stats = document.createElement('div');
            stats.style.cssText = 'display:flex;gap:8px;margin-bottom:14px;';
            stats.innerHTML = `<div style="flex:1;background:rgba(255,59,48,0.12);border:1px solid rgba(255,59,48,0.3);border-radius:8px;padding:12px;text-align:center;"><div style="color:#ff3b30;font-size:22px;font-weight:700;">${filtered.length}</div><div style="color:var(--text-muted);font-size:10px;text-transform:uppercase;margin-top:2px;">Feux filtrés</div></div><div style="flex:1;background:rgba(255,149,0,0.12);border:1px solid rgba(255,149,0,0.3);border-radius:8px;padding:12px;text-align:center;"><div style="color:#ff9500;font-size:22px;font-weight:700;">${totalFrp.toFixed(0)}</div><div style="color:var(--text-muted);font-size:10px;text-transform:uppercase;margin-top:2px;">FRP MW</div></div><div style="flex:1;background:rgba(255,214,10,0.08);border:1px solid rgba(255,214,10,0.25);border-radius:8px;padding:12px;text-align:center;"><div style="color:#ffd60a;font-size:22px;font-weight:700;">${high.length}</div><div style="color:var(--text-muted);font-size:10px;text-transform:uppercase;margin-top:2px;">Haute conf.</div></div>`;
            this.contentEl.appendChild(stats);

            // List
            const listTitle = document.createElement('div');
            listTitle.style.cssText = 'color:var(--text-muted);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;';
            listTitle.textContent = 'Détections (par intensité)';
            this.contentEl.appendChild(listTitle);

            const list = document.createElement('div');
            list.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
            for (const f of sorted.slice(0, 20)) {
                const cc = f.confidence === 'high' ? '#ffd60a' : f.confidence === 'nominal' ? '#ff9500' : '#ff3b30';
                const raw = String(f.acq_time).padStart(4, '0');
                const period = f.daynight === 'D' ? '☀️' : '🌙';
                const item = document.createElement('div');
                item.style.cssText = `background:rgba(0,0,0,0.2);border-left:3px solid ${cc};padding:10px 12px;border-radius:0 4px 4px 0;cursor:pointer;transition:background 0.15s;`;
                item.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;"><span style="color:var(--text-primary);font-size:13px;font-weight:500;">${f.latitude.toFixed(3)}°N, ${f.longitude.toFixed(3)}°E ${period}</span><span style="color:#ff9500;font-size:12px;font-weight:700;">${(f.frp || 0).toFixed(1)} MW</span></div><div style="color:var(--text-muted);font-size:11px;margin-top:3px;display:flex;justify-content:space-between;"><span>${f.acq_date} · ${raw.slice(0, 2)}:${raw.slice(2)} UTC</span><span style="color:${cc};text-transform:uppercase;font-size:10px;">${f.confidence}</span></div>`;
                item.addEventListener('mouseenter', () => { item.style.background = 'rgba(255,149,0,0.12)'; this.onHoverFireCb?.(f.latitude, f.longitude); });
                item.addEventListener('mouseleave', () => { item.style.background = 'rgba(0,0,0,0.2)'; this.onHoverFireCb?.(null, null); });
                list.appendChild(item);
            }
            if (sorted.length > 20) {
                const more = document.createElement('div');
                more.style.cssText = 'color:var(--text-muted);font-size:11px;text-align:center;padding:4px 0;';
                more.textContent = `+${sorted.length - 20} autres détections`;
                list.appendChild(more);
            }
            this.contentEl.appendChild(list);
        }

        // Footer
        const footer = document.createElement('div');
        footer.style.cssText = 'margin-top:16px;padding-top:12px;border-top:1px solid var(--border-color);color:var(--text-muted);font-size:10px;text-align:center;line-height:1.5;';
        footer.innerHTML = `Sources : NASA FIRMS (MODIS/VIIRS) · Mise à jour toutes les ~3h<br>Brutes : ${this.rawFires.length} · Filtrées : ${filtered.length} · Dernière : ${latestLabel}`;
        this.contentEl.appendChild(footer);
    }
}
