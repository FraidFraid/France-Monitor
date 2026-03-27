/**
 * ElusPanel.ts — Panel flottant des élus & représentants.
 * Affiche maire, député(s), sénateur(s), président de département, président de région
 * pour la coordonnée cliquée sur la carte.
 */

import { fetchElusByCoords } from '../services/elus.ts';
import type { ElusInfo, EluData, CommuneInfo } from '../services/elus.ts';
import { getPartyColor, getPartyLabel } from '../config/party-colors.ts';
import { GOUVERNEMENT, getMinistersForCategories, type Minister } from '../config/government.ts';
import { fetchMinisterAgenda, getFullMinisterProfile, getMinistersForCategoriesLive } from '../services/ministers.ts';
import type { EventCategory } from '../types/index.ts';

export class ElusPanel {
    private containerEl!: HTMLElement;
    private headerEl!: HTMLElement;
    private headerSubtitleEl!: HTMLElement;
    private contentEl!: HTMLElement;
    private isDragging = false;
    private dragOffsetX = 0;
    private dragOffsetY = 0;
    private currentGovernmentCategories: EventCategory[] = [];
    private lastData: ElusInfo | null = null;
    private governmentMinisters: Minister[] | null = null;
    private governmentRequestId = 0;

    constructor(_parentEl: HTMLElement) {}

    mount(): void {
        if (this.containerEl) return; // idempotent

        this.containerEl = document.createElement('div');
        this.containerEl.style.cssText = [
            'position:fixed',
            'top:68px',
            'right:20px',
            'width:360px',
            'max-height:calc(100vh - 88px)',
            'height:auto',
            'background:var(--bg-surface)',
            'border:1px solid var(--border-color)',
            'border-radius:12px',
            'box-shadow:0 8px 32px rgba(0,0,0,0.6)',
            'z-index:9999',
            'display:none',
            'flex-direction:column',
            'backdrop-filter:blur(10px)',
            'overflow:hidden',
            'cursor:grab',
        ].join(';');

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
            'z-index:10',
        ].join(';');
        closeBtn.onclick = () => this.hide();
        this.containerEl.appendChild(closeBtn);

        // Header
        this.headerEl = document.createElement('div');
        this.headerEl.style.cssText = 'padding:16px;border-bottom:1px solid var(--border-color);display:flex;align-items:center;gap:12px;flex-shrink:0;';
        const headerIcon = document.createElement('div');
        headerIcon.style.cssText = 'font-size:24px;flex-shrink:0;';
        headerIcon.textContent = '🏛️';
        const headerText = document.createElement('div');
        headerText.style.cssText = 'min-width:0;flex:1;';
        const headerTitle = document.createElement('div');
        headerTitle.style.cssText = 'color:var(--text-primary);font-weight:600;font-size:14px;';
        headerTitle.textContent = 'Élus & Représentants';
        this.headerSubtitleEl = document.createElement('div');
        this.headerSubtitleEl.style.cssText = 'color:var(--text-muted);font-size:11px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
        this.headerSubtitleEl.textContent = 'Cliquez sur la carte';
        headerText.appendChild(headerTitle);
        headerText.appendChild(this.headerSubtitleEl);
        this.headerEl.appendChild(headerIcon);
        this.headerEl.appendChild(headerText);
        this.containerEl.appendChild(this.headerEl);

        // Content
        this.contentEl = document.createElement('div');
        this.contentEl.className = 'elus-panel-content';
        this.contentEl.style.cssText = 'padding:16px;overflow-y:auto;overflow-x:hidden;flex:0 1 auto;min-height:0;scrollbar-width:none;';
        this.containerEl.appendChild(this.contentEl);

        document.body.appendChild(this.containerEl);

        // Inject spin keyframes once
        if (!document.getElementById('elus-spin-style')) {
            const style = document.createElement('style');
            style.id = 'elus-spin-style';
            style.textContent = '@keyframes elus-spin{to{transform:rotate(360deg)}}';
            document.head.appendChild(style);
        }

        this._showPlaceholderContent();
        void this._refreshGovernmentMinisters();
        this._setupDrag();
    }

    async show(lat: number, lon: number): Promise<void> {
        if (!this.containerEl) return;
        this.containerEl.style.display = '';
        this._renderLoading();

        try {
            const data = await fetchElusByCoords(lat, lon);
            this.lastData = data;
            this._renderContent(data);
        } catch {
            this._renderError();
        }
    }

    showPlaceholder(): void {
        if (!this.containerEl) return;
        this.containerEl.style.display = '';
        this._showPlaceholderContent();
    }

    setGovernmentContext(categories: EventCategory[]): void {
        this.currentGovernmentCategories = categories;
        this.governmentMinisters = null;
        void this._refreshGovernmentMinisters();
        if (!this.containerEl || this.containerEl.style.display === 'none') return;
        if (this.lastData) this._renderContent(this.lastData);
        else this._showPlaceholderContent();
    }

    hide(): void {
        if (this.containerEl) this.containerEl.style.display = 'none';
    }

    destroy(): void {
        if (this.containerEl?.parentNode) {
            this.containerEl.parentNode.removeChild(this.containerEl);
        }
    }

    private _formatPersonName(prenom: string, nom: string): string {
        return `${prenom} ${nom.toUpperCase()}`.trim();
    }

    private _getMaxPanelHeight(): number {
        return Math.max(360, window.innerHeight - 88);
    }

    private _syncPanelHeight(minHeight = 420): void {
        if (!this.containerEl || !this.headerEl || !this.contentEl) return;
        const target = Math.min(
            this._getMaxPanelHeight(),
            Math.max(minHeight, this.headerEl.offsetHeight + this.contentEl.scrollHeight + 20)
        );
        this.containerEl.style.height = `${target}px`;
    }

    private _expandPanelForOverlay(minHeight = 620): void {
        if (!this.containerEl) return;
        const target = Math.min(this._getMaxPanelHeight(), Math.max(minHeight, this.containerEl.offsetHeight));
        this.containerEl.style.height = `${target}px`;
    }

    private _setupDrag(): void {
        this.containerEl.addEventListener('mousedown', (e) => {
            if ((e.target as HTMLElement).closest('button')) return;
            if ((e.target as HTMLElement).closest('.elus-panel-content')) return;
            this.isDragging = true;
            const rect = this.containerEl.getBoundingClientRect();
            this.dragOffsetX = e.clientX - rect.left;
            this.dragOffsetY = e.clientY - rect.top;
            this.containerEl.style.cursor = 'grabbing';
        });

        document.addEventListener('mousemove', (e) => {
            if (!this.isDragging) return;
            const x = e.clientX - this.dragOffsetX;
            const y = e.clientY - this.dragOffsetY;
            const maxX = window.innerWidth - this.containerEl.offsetWidth;
            const maxY = window.innerHeight - this.containerEl.offsetHeight;
            this.containerEl.style.left = `${Math.max(0, Math.min(x, maxX))}px`;
            this.containerEl.style.top = `${Math.max(0, Math.min(y, maxY))}px`;
            this.containerEl.style.right = 'auto';
        });

        document.addEventListener('mouseup', () => {
            if (!this.isDragging) return;
            this.isDragging = false;
            this.containerEl.style.cursor = 'grab';
        });
    }

    // ─── Render helpers ───────────────────────────────────────────────────────

    private _getDisplayedGovernmentMinisters(): Minister[] {
        if (this.governmentMinisters && this.governmentMinisters.length > 0) return this.governmentMinisters;
        if (this.currentGovernmentCategories.length > 0) {
            const contextual = getMinistersForCategories(this.currentGovernmentCategories);
            if (contextual.length > 0) return contextual;
        }
        return GOUVERNEMENT;
    }

    private _showPlaceholderContent(): void {
        this.headerSubtitleEl.textContent = 'Cliquez sur la carte';
        this.contentEl.innerHTML = '';
        this.contentEl.appendChild(this._governmentSection(this._getDisplayedGovernmentMinisters()));
        this._syncPanelHeight();
    }

    private _renderLoading(): void {
        this.headerSubtitleEl.textContent = 'Chargement…';
        this.contentEl.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:center;padding:32px;">
                <div style="text-align:center;">
                    <div style="width:28px;height:28px;border:3px solid rgba(255,255,255,0.1);border-top-color:var(--text-muted);border-radius:50%;animation:elus-spin 0.8s linear infinite;margin:0 auto 10px;"></div>
                    <div style="color:var(--text-muted);font-size:11px;">Recherche des élus…</div>
                </div>
            </div>`;
        this._syncPanelHeight();
    }

    private _renderError(): void {
        this.headerSubtitleEl.textContent = 'Erreur';
        this.contentEl.innerHTML = `<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:20px 8px;">Impossible de récupérer les données.</div>`;
        this._syncPanelHeight();
    }

    private _renderContent(data: ElusInfo): void {
        const { commune } = data;
        this.headerSubtitleEl.textContent = `${commune.nom} · ${commune.nomDepartement}`;
        this.contentEl.innerHTML = '';

        this.contentEl.appendChild(this._section('📍 LOCALISATION', '#6366f1', this._renderCommune(commune)));
        this.contentEl.appendChild(this._section('🏛️ MAIRIE', '#3B82F6', this._renderMaire(data.maire)));
        this.contentEl.appendChild(this._section('👤 ASSEMBLÉE NATIONALE', '#8B5CF6', this._renderDeputes(data.deputes)));
        this.contentEl.appendChild(this._section('🏛️ SÉNAT', '#EF4444', this._renderSenateurs(data.senateurs)));
        this.contentEl.appendChild(this._section('🏛 DÉPARTEMENT', '#f59e0b', this._renderPresidentDept(data.presidentDepartement, commune)));
        this.contentEl.appendChild(this._section('🌍 RÉGION', '#10B981', this._renderRegion(data.presidentRegion, commune)));
        this.contentEl.appendChild(this._governmentSection());

        const ts = document.createElement('div');
        ts.style.cssText = 'color:var(--text-muted);font-size:10px;text-align:right;margin-top:8px;';
        ts.textContent = `Données au ${data.fetchedAt.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
        this.contentEl.appendChild(ts);
        this._syncPanelHeight();
    }

    private _section(title: string, accentColor: string, innerEl: HTMLElement): HTMLElement {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = `background:rgba(255,255,255,0.03);border:1px solid var(--border-color);border-left:3px solid ${accentColor};border-radius:6px;padding:10px;margin-bottom:8px;`;
        const label = document.createElement('div');
        label.style.cssText = `color:${accentColor};font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:6px;`;
        label.textContent = title;
        wrapper.appendChild(label);
        wrapper.appendChild(innerEl);
        return wrapper;
    }

    private _renderCommune(c: CommuneInfo): HTMLElement {
        const el = document.createElement('div');
        el.style.cssText = 'display:grid;grid-template-columns:auto 1fr;gap:3px 8px;font-size:11px;';
        const rows: [string, string][] = [
            ['Commune', `${c.nom}${c.codePostal ? ' (' + c.codePostal + ')' : ''}`],
            ['Département', `${c.nomDepartement} (${c.codeDepartement})`],
            ['Région', c.nomRegion],
            ['Population', c.population > 0 ? c.population.toLocaleString('fr-FR') + ' hab.' : '—'],
        ];
        for (const [label, value] of rows) {
            const lEl = document.createElement('div');
            lEl.style.cssText = 'color:var(--text-muted);white-space:nowrap;';
            lEl.textContent = label;
            const vEl = document.createElement('div');
            vEl.style.cssText = 'color:var(--text-primary);';
            vEl.textContent = value;
            el.appendChild(lEl);
            el.appendChild(vEl);
        }
        return el;
    }

    private _renderMaire(maire: EluData | null): HTMLElement {
        const el = document.createElement('div');
        if (!maire) {
            el.style.cssText = 'color:var(--text-muted);font-size:11px;';
            el.textContent = 'Données indisponibles';
            return el;
        }
        el.appendChild(this._eluCard(maire, 'Maire', maire.nuanceCode));
        return el;
    }

    private _renderDeputes(deputes: EluData[]): HTMLElement {
        const el = document.createElement('div');
        if (deputes.length === 0) {
            el.style.cssText = 'color:var(--text-muted);font-size:11px;';
            el.textContent = 'Données indisponibles';
            return el;
        }
        deputes.forEach(d => el.appendChild(this._eluCard(d, d.groupeParlementaire)));
        return el;
    }

    private _renderSenateurs(senateurs: EluData[]): HTMLElement {
        const el = document.createElement('div');
        if (senateurs.length === 0) {
            el.style.cssText = 'color:var(--text-muted);font-size:11px;';
            el.textContent = 'Données indisponibles';
            return el;
        }
        senateurs.forEach(s => el.appendChild(this._eluCard(s, s.groupeParlementaire)));
        return el;
    }

    private _renderPresidentDept(president: EluData | null, commune: CommuneInfo): HTMLElement {
        const el = document.createElement('div');
        if (!president) {
            const noData = document.createElement('div');
            noData.style.cssText = 'color:var(--text-muted);font-size:11px;';
            noData.textContent = 'Données indisponibles';
            el.appendChild(noData);
        } else {
            el.appendChild(this._eluCard(president, 'Président du Conseil Départemental', president.nuanceCode));
        }
        const info = document.createElement('div');
        info.style.cssText = 'color:var(--text-muted);font-size:10px;margin-top:4px;';
        info.textContent = `Département : ${commune.nomDepartement} (${commune.codeDepartement})`;
        el.appendChild(info);
        return el;
    }

    private _renderRegion(president: EluData | null, commune: CommuneInfo): HTMLElement {
        const el = document.createElement('div');
        if (!president) {
            const noData = document.createElement('div');
            noData.style.cssText = 'color:var(--text-muted);font-size:11px;';
            noData.textContent = 'Données indisponibles';
            el.appendChild(noData);
        } else {
            el.appendChild(this._eluCard(president, 'Président de région'));
        }
        const regionInfo = document.createElement('div');
        regionInfo.style.cssText = 'color:var(--text-muted);font-size:10px;margin-top:4px;';
        regionInfo.textContent = `Région : ${commune.nomRegion}`;
        el.appendChild(regionInfo);
        return el;
    }

    private _governmentSection(forcedMinisters?: Minister[]): HTMLElement {
        const ministers = forcedMinisters ?? this._getDisplayedGovernmentMinisters();
        const wrap = document.createElement('div');
        wrap.style.cssText = 'background:rgba(255,255,255,0.03);border:1px solid var(--border-color);border-left:3px solid #60a5fa;border-radius:6px;padding:10px;margin-bottom:8px;';

        const label = document.createElement('div');
        label.style.cssText = 'color:#60a5fa;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:6px;';
        label.textContent = `Gouvernement · ${ministers.length}`;
        wrap.appendChild(label);

        if (this.currentGovernmentCategories.length > 0) {
            const chips = document.createElement('div');
            chips.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;';
            this.currentGovernmentCategories.forEach((cat) => {
                const chip = document.createElement('span');
                chip.style.cssText = 'background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:3px;padding:2px 6px;font-size:10px;color:var(--text-muted);text-transform:uppercase;';
                chip.textContent = cat;
                chips.appendChild(chip);
            });
            wrap.appendChild(chips);
        }

        ministers.forEach((minister) => wrap.appendChild(this._ministerCard(minister)));
        if (!forcedMinisters && ministers.length > 4) {
            const more = document.createElement('div');
            more.style.cssText = 'color:var(--text-muted);font-size:10px;text-align:center;padding-top:4px;';
            more.textContent = `+ ${ministers.length - 4} autre(s) ministre(s)`;
            wrap.appendChild(more);
        }

        return wrap;
    }

    private async _refreshGovernmentMinisters(): Promise<void> {
        const requestId = ++this.governmentRequestId;
        try {
            const ministers = await getMinistersForCategoriesLive(this.currentGovernmentCategories);
            if (requestId !== this.governmentRequestId) return;
            this.governmentMinisters = ministers;
            if (!this.containerEl || this.containerEl.style.display === 'none') return;
            if (this.lastData) this._renderContent(this.lastData);
            else this._showPlaceholderContent();
        } catch {
            if (requestId !== this.governmentRequestId) return;
            this.governmentMinisters = null;
        }
    }

    private _ministerCard(minister: Minister): HTMLElement {
        const card = document.createElement('div');
        card.style.cssText = 'margin-bottom:6px;padding:7px;background:rgba(255,255,255,0.04);border-radius:5px;cursor:pointer;transition:background 0.15s;display:flex;align-items:center;gap:8px;';
        card.addEventListener('mouseenter', () => { card.style.background = 'rgba(255,255,255,0.08)'; });
        card.addEventListener('mouseleave', () => { card.style.background = 'rgba(255,255,255,0.04)'; });
        card.addEventListener('click', () => { void this._showMinisterDetail(minister); });

        const avatar = document.createElement('div');
        avatar.style.cssText = 'width:32px;height:32px;border-radius:50%;background:rgba(255,255,255,0.1);flex-shrink:0;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:11px;font-weight:700;overflow:hidden;';
        const cardPhotoUrl = (minister as Minister & { photoHd?: string }).photoHd ?? minister.photoUrl;
        if (cardPhotoUrl) {
            const img = document.createElement('img');
            img.src = cardPhotoUrl;
            img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
            img.onerror = () => { img.style.display = 'none'; avatar.textContent = `${minister.prenom[0]}${minister.nom[0]}`; };
            avatar.appendChild(img);
        } else {
            avatar.textContent = `${minister.prenom[0]}${minister.nom[0]}`;
        }

        const info = document.createElement('div');
        info.style.cssText = 'flex:1;min-width:0;';
        info.innerHTML = `
            <div style="color:var(--text-primary);font-weight:600;font-size:12px;line-height:1.35;white-space:normal;overflow:visible;text-overflow:clip;">${this._formatPersonName(minister.prenom, minister.nom)}${minister.isPM ? ' 🏛' : ''}</div>
            <div style="color:var(--text-muted);font-size:10px;margin-top:1px;line-height:1.35;white-space:normal;overflow:visible;text-overflow:clip;">${minister.titreShort}${minister.parti ? ` · ${minister.parti}` : ''}</div>`;

        const chevron = document.createElement('span');
        chevron.style.cssText = 'color:var(--text-muted);font-size:10px;flex-shrink:0;';
        chevron.textContent = '›';

        card.appendChild(avatar);
        card.appendChild(info);
        card.appendChild(chevron);
        return card;
    }

    private _eluCard(elu: EluData, roleLabel: string | undefined, nuanceCode?: string): HTMLElement {
        const card = document.createElement('div');
        card.style.cssText = 'margin-bottom:6px;padding:7px;background:rgba(255,255,255,0.04);border-radius:5px;cursor:pointer;transition:background 0.15s;';
        card.addEventListener('mouseenter', () => { card.style.background = 'rgba(255,255,255,0.08)'; });
        card.addEventListener('mouseleave', () => { card.style.background = 'rgba(255,255,255,0.04)'; });
        card.addEventListener('click', (e) => { e.stopPropagation(); this._showEluDetail(elu, roleLabel); });

        const topRow = document.createElement('div');
        topRow.style.cssText = 'display:flex;align-items:center;gap:8px;';

        if (elu.photoUrl) {
            const img = document.createElement('img');
            img.src = elu.photoUrl;
            img.style.cssText = 'width:32px;height:32px;border-radius:50%;object-fit:cover;flex-shrink:0;background:rgba(255,255,255,0.1);';
            img.onerror = () => { img.style.display = 'none'; };
            topRow.appendChild(img);
        }

        const nameGroup = document.createElement('div');
        nameGroup.style.cssText = 'min-width:0;flex:1;';

        const nameRow = document.createElement('div');
        nameRow.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;';

        const nameEl = document.createElement('div');
        nameEl.style.cssText = 'color:var(--text-primary);font-weight:600;font-size:12px;';
        nameEl.textContent = this._formatPersonName(elu.prenom, elu.nom);
        nameRow.appendChild(nameEl);

        const effectiveNuance = nuanceCode ?? elu.nuanceCode;
        if (effectiveNuance) {
            const badge = document.createElement('span');
            const color = getPartyColor(effectiveNuance);
            badge.style.cssText = `display:inline-block;background:${color}22;border:1px solid ${color}66;color:${color};font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px;`;
            badge.textContent = getPartyLabel(effectiveNuance);
            nameRow.appendChild(badge);
        }
        nameGroup.appendChild(nameRow);

        if (roleLabel) {
            const roleEl = document.createElement('div');
            roleEl.style.cssText = 'color:var(--text-muted);font-size:10px;margin-top:1px;';
            roleEl.textContent = roleLabel;
            nameGroup.appendChild(roleEl);
        }

        topRow.appendChild(nameGroup);

        const chevron = document.createElement('span');
        chevron.style.cssText = 'color:var(--text-muted);font-size:10px;flex-shrink:0;';
        chevron.textContent = '›';
        topRow.appendChild(chevron);

        card.appendChild(topRow);

        const details: string[] = [];
        if (elu.parti && !effectiveNuance) details.push(elu.parti);
        if (elu.circonscription) details.push(elu.circonscription);
        if (details.length > 0) {
            const detailsEl = document.createElement('div');
            detailsEl.style.cssText = 'color:var(--text-muted);font-size:10px;margin-top:3px;line-height:1.6;' + (elu.photoUrl ? 'padding-left:40px;' : '');
            detailsEl.textContent = details.join(' · ');
            card.appendChild(detailsEl);
        }

        return card;
    }

    private _showEluDetail(elu: EluData, roleLabel: string | undefined): void {
        // Toggle: close if already open
        const existing = this.contentEl.querySelector('.elu-detail-popup');
        if (existing) { existing.remove(); this._syncPanelHeight(); return; }

        const popup = document.createElement('div');
        popup.className = 'elu-detail-popup';
        popup.style.cssText = 'position:absolute;inset:0;background:var(--bg-surface);z-index:10;display:flex;flex-direction:column;overflow:hidden;border-radius:8px;';
        // Position popup relative to the container
        this.containerEl.style.position = 'relative';
        this._expandPanelForOverlay();

        // Header with back button
        const header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--border-color);flex-shrink:0;';
        const backBtn = document.createElement('button');
        backBtn.textContent = '←';
        backBtn.style.cssText = 'background:rgba(255,255,255,0.1);border:none;color:var(--text-muted);cursor:pointer;font-size:13px;width:26px;height:26px;border-radius:13px;flex-shrink:0;';
        backBtn.onclick = () => { popup.remove(); this._syncPanelHeight(); };
        const title = document.createElement('div');
        title.style.cssText = 'color:var(--text-primary);font-weight:600;font-size:12px;flex:1;min-width:0;line-height:1.35;';
        title.textContent = this._formatPersonName(elu.prenom, elu.nom);
        header.appendChild(backBtn);
        header.appendChild(title);
        popup.appendChild(header);

        // Tabs
        type TabKey = 'mandat' | 'votes' | 'interets' | 'contact';
        const tabs: Array<{ key: TabKey; label: string }> = [
            { key: 'mandat',   label: 'Mandat' },
            { key: 'votes',    label: 'Votes' },
            { key: 'interets', label: 'Intérêts' },
            { key: 'contact',  label: 'Contact' },
        ];

        const tabBar = document.createElement('div');
        tabBar.style.cssText = 'display:flex;gap:2px;padding:6px 10px;border-bottom:1px solid var(--border-color);flex-shrink:0;';

        const tabContent = document.createElement('div');
        tabContent.style.cssText = 'flex:1;overflow-y:auto;overflow-x:hidden;padding:12px;scrollbar-width:none;';

        const renderTab = (key: TabKey) => {
            // Update tab button styles
            tabBar.querySelectorAll('button').forEach((btn) => {
                const isActive = btn.dataset['tab'] === key;
                btn.style.cssText = `background:${isActive ? 'rgba(255,255,255,0.1)' : 'transparent'};border:none;color:${isActive ? 'var(--text-primary)' : 'var(--text-muted)'};cursor:pointer;padding:4px 8px;border-radius:4px;font-size:10px;`;
            });

            tabContent.innerHTML = '';

            if (key === 'mandat') {
                // Photo + identity
                if (elu.photoUrl) {
                    const img = document.createElement('img');
                    img.src = elu.photoUrl;
                    img.style.cssText = 'width:70px;height:70px;border-radius:50%;object-fit:cover;border:2px solid var(--border-color);display:block;margin:0 auto 12px;background:rgba(255,255,255,0.1);';
                    img.onerror = () => { img.style.display = 'none'; };
                    tabContent.appendChild(img);
                }

                const grid = document.createElement('div');
                grid.style.cssText = 'display:grid;grid-template-columns:auto 1fr;gap:5px 10px;font-size:11px;';

                const rows: [string, string | undefined][] = [
                    ['Rôle', roleLabel],
                    ['Parti', elu.parti],
                    ['Groupe', elu.groupeParlementaire],
                    ['Circonscription', elu.circonscription],
                    ['Profession', elu.profession],
                ];
                if (elu.mandatDepuis) {
                    try {
                        rows.push(['Mandat depuis', new Date(elu.mandatDepuis).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })]);
                    } catch {
                        rows.push(['Mandat depuis', elu.mandatDepuis]);
                    }
                }
                if (elu.dateNaissance) {
                    try {
                        rows.push(['Né(e) le', new Date(elu.dateNaissance).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })]);
                    } catch {
                        rows.push(['Né(e) le', elu.dateNaissance]);
                    }
                }
                for (const [label, value] of rows) {
                    if (!value) continue;
                    const lEl = document.createElement('div');
                    lEl.style.cssText = 'color:var(--text-muted);white-space:nowrap;';
                    lEl.textContent = label;
                    const vEl = document.createElement('div');
                    vEl.style.cssText = 'color:var(--text-primary);';
                    vEl.textContent = value;
                    grid.appendChild(lEl);
                    grid.appendChild(vEl);
                }
                tabContent.appendChild(grid);

            } else if (key === 'votes') {
                if (!elu.slug) {
                    tabContent.innerHTML = '<div style="color:var(--text-muted);font-size:11px;">Données non disponibles pour cet élu.</div>';
                    return;
                }
                tabContent.innerHTML = '<div style="color:var(--text-muted);font-size:11px;">Chargement…</div>';
                this._fetchVotes(elu.slug).then(votes => {
                    tabContent.innerHTML = '';
                    if (votes.length === 0) {
                        tabContent.innerHTML = '<div style="color:var(--text-muted);font-size:11px;">Aucun vote récent disponible.</div>';
                        return;
                    }
                    const table = document.createElement('div');
                    table.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
                    for (const v of votes) {
                        const row = document.createElement('div');
                        row.style.cssText = 'font-size:11px;border-bottom:1px solid var(--border-color);padding-bottom:5px;';
                        const posIcon = v.position === 'pour' ? '✓' : v.position === 'contre' ? '✗' : '○';
                        const posColor = v.position === 'pour' ? '#34c759' : v.position === 'contre' ? '#ff3b30' : '#8e8e93';
                        row.innerHTML = `
                            <div style="display:flex;align-items:center;gap:6px;">
                                <span style="color:${posColor};font-weight:700;font-size:13px;">${posIcon}</span>
                                <span style="color:var(--text-primary);flex:1;">${v.texte}</span>
                            </div>
                            <div style="color:var(--text-muted);margin-top:2px;">${v.date}</div>`;
                        table.appendChild(row);
                    }
                    tabContent.appendChild(table);
                });

            } else if (key === 'interets') {
                const wrap = document.createElement('div');
                wrap.style.cssText = 'font-size:11px;line-height:1.6;';
                if (elu.hatvpSlug) {
                    const link = document.createElement('a');
                    link.href = `https://declarations.hatvp.fr/fiche/${elu.hatvpSlug}`;
                    link.target = '_blank';
                    link.rel = 'noopener';
                    link.style.cssText = 'color:#6366f1;text-decoration:none;display:block;margin-bottom:8px;';
                    link.textContent = 'Voir la déclaration d\'intérêts sur HATVP ↗';
                    wrap.appendChild(link);
                }
                const note = document.createElement('p');
                note.style.cssText = 'color:var(--text-muted);margin:0;font-size:10px;';
                note.textContent = 'Déclarations obligatoires pour les élus depuis la loi Sapin II (2016).';
                wrap.appendChild(note);
                tabContent.appendChild(wrap);

            } else if (key === 'contact') {
                const wrap = document.createElement('div');
                wrap.style.cssText = 'font-size:11px;display:flex;flex-direction:column;gap:8px;';
                if (!elu.email && !elu.siteWeb && !elu.socialMedia?.twitter && !elu.socialMedia?.facebook) {
                    wrap.innerHTML = '<div style="color:var(--text-muted);">Aucune coordonnée disponible.</div>';
                } else {
                    const addLink = (label: string, href: string, display?: string) => {
                        const row = document.createElement('div');
                        row.style.cssText = 'display:flex;align-items:center;gap:6px;';
                        const lbl = document.createElement('span');
                        lbl.style.cssText = 'color:var(--text-muted);min-width:60px;';
                        lbl.textContent = label;
                        const a = document.createElement('a');
                        a.href = href;
                        a.target = '_blank';
                        a.rel = 'noopener';
                        a.style.cssText = 'color:#6366f1;text-decoration:none;word-break:break-all;';
                        a.textContent = display ?? href;
                        row.appendChild(lbl);
                        row.appendChild(a);
                        wrap.appendChild(row);
                    };
                    if (elu.email) addLink('Email', `mailto:${elu.email}`, elu.email);
                    if (elu.siteWeb) addLink('Site web', elu.siteWeb);
                    if (elu.socialMedia?.twitter) addLink('Twitter', `https://twitter.com/${elu.socialMedia.twitter}`, `@${elu.socialMedia.twitter}`);
                    if (elu.socialMedia?.facebook) addLink('Facebook', elu.socialMedia.facebook);
                }
                tabContent.appendChild(wrap);
            }
        };

        tabs.forEach(({ key, label }) => {
            const btn = document.createElement('button');
            btn.dataset['tab'] = key;
            btn.textContent = label;
            btn.addEventListener('click', () => renderTab(key));
            tabBar.appendChild(btn);
        });

        popup.appendChild(tabBar);
        popup.appendChild(tabContent);
        this.contentEl.appendChild(popup);
        renderTab('mandat');
    }

    private async _showMinisterDetail(minister: Minister): Promise<void> {
        const existing = this.containerEl.querySelector('.minister-modal');
        if (existing) { existing.remove(); this._syncPanelHeight(); return; }

        const profile = await getFullMinisterProfile(minister);

        const modal = document.createElement('div');
        modal.className = 'minister-modal';
        modal.style.cssText = 'position:absolute;inset:0;background:var(--bg-surface);z-index:20;display:flex;flex-direction:column;overflow:hidden;border-radius:8px;';
        this._expandPanelForOverlay();

        const hdr = document.createElement('div');
        hdr.style.cssText = 'display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--border-color);flex-shrink:0;';
        const backBtn = document.createElement('button');
        backBtn.textContent = '←';
        backBtn.style.cssText = 'background:rgba(255,255,255,0.1);border:none;color:var(--text-muted);cursor:pointer;width:28px;height:28px;border-radius:14px;font-size:14px;flex-shrink:0;';
        backBtn.onclick = () => { modal.remove(); this._syncPanelHeight(); };
        const hdrTitle = document.createElement('div');
        hdrTitle.style.cssText = 'color:var(--text-primary);font-weight:600;font-size:12px;flex:1;';
        hdrTitle.textContent = profile.titreShort;
        hdr.appendChild(backBtn);
        hdr.appendChild(hdrTitle);
        modal.appendChild(hdr);

        const body = document.createElement('div');
        body.style.cssText = 'flex:1;overflow-y:auto;overflow-x:hidden;padding:16px;scrollbar-width:none;';
        body.innerHTML = `
          <div style="display:flex;gap:14px;align-items:flex-start;margin-bottom:16px;">
            <div id="minister-photo" style="width:72px;height:72px;border-radius:50%;background:rgba(255,255,255,0.1);flex-shrink:0;overflow:hidden;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;color:var(--text-muted);">
              ${profile.prenom[0]}${profile.nom[0]}
            </div>
            <div style="flex:1;min-width:0;">
              <div style="color:var(--text-primary);font-weight:700;font-size:14px;">${this._formatPersonName(profile.prenom, profile.nom)}</div>
              <div style="color:var(--text-muted);font-size:11px;margin-top:3px;line-height:1.5;">${profile.titre}</div>
              ${profile.parti ? `<div style="margin-top:5px;"><span style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:3px;padding:2px 6px;font-size:10px;color:var(--text-muted);">${profile.parti}</span></div>` : ''}
            </div>
          </div>
          <div id="minister-bio" style="color:var(--text-muted);font-size:11px;font-style:${profile.bioShort ? 'italic' : 'normal'};margin-bottom:14px;line-height:1.6;">${profile.bioShort ?? ''}</div>
          <div style="display:flex;gap:2px;margin-bottom:12px;border-bottom:1px solid var(--border-color);padding-bottom:8px;" id="minister-tabs">
            <button data-tab="portefeuille" class="mtab active" style="background:rgba(255,255,255,0.08);border:none;color:var(--text-primary);cursor:pointer;padding:5px 10px;border-radius:4px;font-size:11px;">Portefeuille</button>
            <button data-tab="agenda" class="mtab" style="background:transparent;border:none;color:var(--text-muted);cursor:pointer;padding:5px 10px;border-radius:4px;font-size:11px;">Agenda</button>
            <button data-tab="contact" class="mtab" style="background:transparent;border:none;color:var(--text-muted);cursor:pointer;padding:5px 10px;border-radius:4px;font-size:11px;">Contact</button>
            <button data-tab="osint" class="mtab" style="background:transparent;border:none;color:var(--text-muted);cursor:pointer;padding:5px 10px;border-radius:4px;font-size:11px;">OSINT</button>
          </div>
          <div id="minister-tab-content"></div>
          <div id="minister-links" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:16px;padding-top:12px;border-top:1px solid var(--border-color);"></div>`;
        modal.appendChild(body);
        this.containerEl.appendChild(modal);

        const tabs = modal.querySelectorAll('.mtab');
        const contentEl = modal.querySelector('#minister-tab-content') as HTMLElement;
        const renderTab = (tabName: string) => {
            tabs.forEach((t) => {
                const btn = t as HTMLButtonElement;
                const isActive = btn.dataset['tab'] === tabName;
                btn.style.background = isActive ? 'rgba(255,255,255,0.08)' : 'transparent';
                btn.style.color = isActive ? 'var(--text-primary)' : 'var(--text-muted)';
            });
            if (tabName === 'portefeuille') {
                contentEl.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:5px;">${profile.portefeuilles.map((p) => `<span style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:3px;padding:3px 8px;font-size:11px;color:var(--text-primary);">${p}</span>`).join('')}</div>`;
            } else if (tabName === 'agenda') {
                contentEl.innerHTML = '<div style="color:var(--text-muted);font-size:11px;">Chargement agenda...</div>';
                void (async () => {
                    const items = await fetchMinisterAgenda(profile);
                    contentEl.innerHTML = items.length === 0
                        ? '<div style="color:var(--text-muted);font-size:11px;">Aucun agenda disponible</div>'
                        : items.map((item) => `<div style="padding:8px 0;border-bottom:1px solid var(--border-color);"><div style="color:var(--text-primary);font-size:11px;line-height:1.5;">${item.title}</div><div style="color:var(--text-muted);font-size:10px;margin-top:3px;">${item.date}${item.location ? ` · ${item.location}` : ''}</div>${item.sourceLabel ? `<div style="color:var(--text-muted);font-size:10px;margin-top:2px;">${item.sourceLabel}</div>` : ''}${item.url ? `<a href="${item.url}" target="_blank" style="color:var(--text-muted);font-size:10px;">Voir ↗</a>` : ''}</div>`).join('');
                })();
            } else if (tabName === 'contact') {
                const contactRows = [
                    profile.officeEmail || profile.emailCabinet ? `<div style="margin-bottom:8px;"><span style="color:var(--text-muted);font-size:10px;">Email : </span><a href="mailto:${profile.officeEmail ?? profile.emailCabinet}" target="_blank" rel="noopener" style="color:var(--text-primary);font-size:11px;">${profile.officeEmail ?? profile.emailCabinet}</a></div>` : '',
                    profile.officePhone ? `<div style="margin-bottom:8px;"><span style="color:var(--text-muted);font-size:10px;">Téléphone : </span><span style="color:var(--text-primary);font-size:11px;">${profile.officePhone}</span></div>` : '',
                    profile.siteMinistere ? `<div style="margin-bottom:8px;"><span style="color:var(--text-muted);font-size:10px;">Site : </span><a href="${profile.siteMinistere}" target="_blank" rel="noopener" style="color:var(--text-primary);font-size:11px;">${profile.siteMinistere}</a></div>` : '',
                    profile.agendaUrl ? `<div style="margin-bottom:8px;"><span style="color:var(--text-muted);font-size:10px;">Agenda : </span><a href="${profile.agendaUrl}" target="_blank" rel="noopener" style="color:var(--text-primary);font-size:11px;">Agenda officiel</a></div>` : '',
                    profile.servicePublicUrl ? `<div style="margin-bottom:8px;"><span style="color:var(--text-muted);font-size:10px;">Annuaire : </span><a href="${profile.servicePublicUrl}" target="_blank" rel="noopener" style="color:var(--text-primary);font-size:11px;">Service-Public</a></div>` : '',
                    profile.sourceLabel || profile.sourceUrl ? `<div style="margin-bottom:8px;"><span style="color:var(--text-muted);font-size:10px;">Source : </span>${profile.sourceUrl ? `<a href="${profile.sourceUrl}" target="_blank" rel="noopener" style="color:var(--text-primary);font-size:11px;">${profile.sourceLabel ?? 'Source officielle'}</a>` : `<span style="color:var(--text-primary);font-size:11px;">${profile.sourceLabel}</span>`}${profile.sourceUpdatedAt ? `<span style="color:var(--text-muted);font-size:10px;"> · MAJ ${new Date(profile.sourceUpdatedAt).toLocaleDateString('fr-FR')}</span>` : ''}</div>` : '',
                    profile.twitter ? `<div><span style="color:var(--text-muted);font-size:10px;">Twitter/X : </span><a href="https://twitter.com/${profile.twitter}" target="_blank" rel="noopener" style="color:var(--text-primary);font-size:11px;">@${profile.twitter}</a></div>` : '',
                ].filter(Boolean);
                contentEl.innerHTML = contactRows.length > 0
                    ? contactRows.join('')
                    : '<div style="color:var(--text-muted);font-size:11px;">Pas d\'info de contact disponible</div>';
            } else if (tabName === 'osint') {
                const datasets = profile.osintDatasets ?? [];
                contentEl.innerHTML = datasets.length === 0
                    ? '<div style="color:var(--text-muted);font-size:11px;">Aucun dataset open data pertinent trouvé</div>'
                    : datasets.map((dataset) => `
                        <div style="padding:9px 0;border-bottom:1px solid var(--border-color);">
                          <div style="color:var(--text-primary);font-size:11px;line-height:1.5;font-weight:600;">${dataset.title ?? 'Dataset'}</div>
                          <div style="color:var(--text-muted);font-size:10px;margin-top:4px;line-height:1.5;">
                            ${dataset.organization ? `Source: ${dataset.organization}` : 'Source: data.gouv.fr'}
                            ${dataset.lastUpdate ? ` · MAJ ${new Date(dataset.lastUpdate).toLocaleDateString('fr-FR')}` : ''}
                            ${typeof dataset.resourceCount === 'number' ? ` · ${dataset.resourceCount} ressource(s)` : ''}
                          </div>
                          ${dataset.description ? `<div style="color:var(--text-muted);font-size:10px;margin-top:4px;line-height:1.5;">${dataset.description}</div>` : ''}
                          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;">
                            ${dataset.url ? `<a href="${dataset.url}" target="_blank" rel="noopener" style="color:var(--text-primary);font-size:10px;">Fiche dataset ↗</a>` : ''}
                            ${(dataset.resources ?? []).map((resource) => resource.url ? `<a href="${resource.url}" target="_blank" rel="noopener" style="color:var(--text-primary);font-size:10px;">${resource.format ?? resource.type ?? 'Ressource'} ↗</a>` : '').join('')}
                          </div>
                        </div>`).join('');
            }
        };
        tabs.forEach((t) => t.addEventListener('click', () => renderTab((t as HTMLButtonElement).dataset['tab'] ?? '')));
        renderTab('portefeuille');

        const linksEl = modal.querySelector('#minister-links') as HTMLElement;
        const addLinkButton = (label: string, url?: string) => {
            if (!url) return;
            const link = document.createElement('a');
            link.href = url;
            link.target = '_blank';
            link.rel = 'noopener';
            link.style.cssText = 'display:inline-flex;align-items:center;gap:4px;background:rgba(255,255,255,0.06);border:1px solid var(--border-color);border-radius:4px;padding:4px 8px;font-size:10px;color:var(--text-muted);text-decoration:none;';
            link.textContent = `${label} ↗`;
            linksEl.appendChild(link);
        };

        addLinkButton('Site officiel', profile.siteMinistere);
        addLinkButton('Fiche officielle', profile.sourceLabel === 'info.gouv.fr' ? profile.sourceUrl : undefined);
        addLinkButton('Service-Public', profile.servicePublicUrl);
        addLinkButton(profile.appointmentLabel ?? 'JORF', profile.appointmentUrl);
        addLinkButton('Wikipedia', (profile as Minister & { wikipediaUrl?: string }).wikipediaUrl);
        addLinkButton('Wikidata', profile.wikidataId ? `https://www.wikidata.org/wiki/${profile.wikidataId}` : undefined);
        addLinkButton('X/Twitter', profile.twitter ? `https://twitter.com/${profile.twitter}` : undefined);
        profile.openDataLinks?.forEach((link) => addLinkButton(link.label, link.url));

        const photoUrl = profile.photoHd ?? profile.photoUrl;
        if (photoUrl) {
            const photoEl = modal.querySelector('#minister-photo') as HTMLElement;
            photoEl.innerHTML = `<img src="${photoUrl}" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none'">`;
        }
    }

    private async _fetchVotes(slug: string): Promise<Array<{date:string;texte:string;position:string}>> {
        try {
            const res = await fetch(`/api/elus/votes?slug=${encodeURIComponent(slug)}&limit=5`);
            if (!res.ok) return [];
            const data = await res.json() as { scrutins?: Array<{ scrutin?: { date_seance?: string; titre?: string; position_groupe?: { position?: string } } }> };
            const scrutins = data.scrutins ?? [];
            return scrutins.map(s => ({
                date: s.scrutin?.date_seance ?? '',
                texte: s.scrutin?.titre ?? '',
                position: s.scrutin?.position_groupe?.position ?? 'absent',
            }));
        } catch {
            return [];
        }
    }
}
