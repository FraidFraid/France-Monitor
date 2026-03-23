/**
 * ElusPanel.ts — Panneau flottant des élus & représentants.
 * Affiche maire, député(s), sénateur(s), président de région
 * pour la coordonnée cliquée sur la carte.
 * Suit le pattern exact de FiresPanel (position:fixed, drag, close button).
 */

import { fetchElusByCoords } from '../services/elus.ts';
import type { ElusInfo, EluData, CommuneInfo } from '../services/elus.ts';

export class ElusPanel {
    private modalEl!: HTMLElement;
    private headerSubtitleEl!: HTMLElement;
    private contentEl!: HTMLElement;
    private isDragging = false;
    private dragOffsetX = 0;
    private dragOffsetY = 0;

    constructor(_container: HTMLElement) {
        // container unused — panel mounts to document.body
    }

    mount(): void {
        this.modalEl = document.createElement('div');
        this.modalEl.style.cssText = [
            'position:fixed',
            'top:68px',
            'right:390px',
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
        header.style.cssText = 'padding:16px;border-bottom:1px solid var(--border-color);display:flex;align-items:center;gap:12px;flex-shrink:0;cursor:grab;';
        const headerIcon = document.createElement('div');
        headerIcon.style.cssText = 'font-size:24px;flex-shrink:0;';
        headerIcon.textContent = '🏛️';
        const headerText = document.createElement('div');
        headerText.style.cssText = 'min-width:0;';
        const headerTitle = document.createElement('div');
        headerTitle.style.cssText = 'color:var(--text-primary);font-weight:600;font-size:14px;';
        headerTitle.textContent = 'Élus & Représentants';
        this.headerSubtitleEl = document.createElement('div');
        this.headerSubtitleEl.style.cssText = 'color:var(--text-muted);font-size:11px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
        this.headerSubtitleEl.textContent = '—';
        headerText.appendChild(headerTitle);
        headerText.appendChild(this.headerSubtitleEl);
        header.appendChild(headerIcon);
        header.appendChild(headerText);
        this.modalEl.appendChild(header);

        // Content
        this.contentEl = document.createElement('div');
        this.contentEl.className = 'elus-panel-content';
        this.contentEl.style.cssText = 'padding:16px;overflow-y:auto;flex:1;';
        this.modalEl.appendChild(this.contentEl);

        document.body.appendChild(this.modalEl);
        this._setupDrag();
    }

    private _setupDrag(): void {
        const header = this.modalEl.querySelector('div') as HTMLElement;
        this.modalEl.style.cursor = 'default';

        this.modalEl.addEventListener('mousedown', (e) => {
            if ((e.target as HTMLElement).closest('button')) return;
            if ((e.target as HTMLElement).closest('.elus-panel-content')) return;
            this.isDragging = true;
            const rect = this.modalEl.getBoundingClientRect();
            this.dragOffsetX = e.clientX - rect.left;
            this.dragOffsetY = e.clientY - rect.top;
            if (header) header.style.cursor = 'grabbing';
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
                if (header) header.style.cursor = 'grab';
            }
        });
    }

    async show(lat: number, lon: number): Promise<void> {
        if (!this.modalEl) return;
        this.modalEl.style.display = 'flex';
        this._renderLoading();

        try {
            const data = await fetchElusByCoords(lat, lon);
            this._renderContent(data);
        } catch {
            this._renderError();
        }
    }

    showPlaceholder(): void {
        if (!this.modalEl) return;
        this.modalEl.style.display = 'flex';
        this.headerSubtitleEl.textContent = 'Cliquez sur la carte';
        this.contentEl.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px 16px;gap:12px;text-align:center;">
                <div style="font-size:36px;opacity:0.5;">🏛️</div>
                <div style="color:var(--text-primary);font-size:13px;font-weight:500;">Cliquez n'importe où sur la carte</div>
                <div style="color:var(--text-muted);font-size:11px;line-height:1.6;">Les élus (maire, député, sénateur, président de région) de la commune s'afficheront ici.</div>
            </div>`;
    }

    hide(): void {
        if (this.modalEl) this.modalEl.style.display = 'none';
    }

    destroy(): void {
        if (this.modalEl && this.modalEl.parentNode) {
            this.modalEl.parentNode.removeChild(this.modalEl);
        }
    }

    // ─── Render helpers ───────────────────────────────────────────────────────

    private _renderLoading(): void {
        this.headerSubtitleEl.textContent = 'Chargement…';
        this.contentEl.innerHTML = '';
        const spinner = document.createElement('div');
        spinner.style.cssText = 'display:flex;align-items:center;justify-content:center;padding:40px;';
        spinner.innerHTML = `
            <div style="text-align:center;">
                <div style="
                    width:32px;height:32px;border:3px solid rgba(255,255,255,0.1);
                    border-top-color:var(--text-muted);border-radius:50%;
                    animation:elus-spin 0.8s linear infinite;margin:0 auto 12px;
                "></div>
                <div style="color:var(--text-muted);font-size:12px;">Recherche des élus…</div>
            </div>
        `;
        // Inject keyframes once
        if (!document.getElementById('elus-spin-style')) {
            const style = document.createElement('style');
            style.id = 'elus-spin-style';
            style.textContent = '@keyframes elus-spin{to{transform:rotate(360deg)}}';
            document.head.appendChild(style);
        }
        this.contentEl.appendChild(spinner);
    }

    private _renderError(): void {
        this.headerSubtitleEl.textContent = 'Erreur';
        this.contentEl.innerHTML = `
            <div style="color:var(--text-muted);font-size:13px;text-align:center;padding:24px 8px;">
                Impossible de récupérer les données. Vérifiez votre connexion.
            </div>
        `;
    }

    private _renderContent(data: ElusInfo): void {
        const { commune } = data;

        // Update subtitle
        this.headerSubtitleEl.textContent = `${commune.nom} · ${commune.nomDepartement}`;

        this.contentEl.innerHTML = '';

        // ── Localisation ──
        this.contentEl.appendChild(
            this._section('📍 LOCALISATION', '#6366f1', this._renderCommune(commune))
        );

        // ── Mairie ──
        this.contentEl.appendChild(
            this._section('🏛️ MAIRIE', '#3B82F6', this._renderMaire(data.maire))
        );

        // ── Assemblée nationale ──
        this.contentEl.appendChild(
            this._section('👤 ASSEMBLÉE NATIONALE', '#8B5CF6', this._renderDeputes(data.deputes))
        );

        // ── Sénat ──
        this.contentEl.appendChild(
            this._section('🏛️ SÉNAT', '#EF4444', this._renderSenateurs(data.senateurs))
        );

        // ── Région ──
        this.contentEl.appendChild(
            this._section('🌍 RÉGION', '#10B981', this._renderRegion(data.presidentRegion, commune))
        );

        // Timestamp
        const ts = document.createElement('div');
        ts.style.cssText = 'color:var(--text-muted);font-size:10px;text-align:right;margin-top:12px;';
        ts.textContent = `Données au ${data.fetchedAt.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
        this.contentEl.appendChild(ts);
    }

    private _section(title: string, accentColor: string, innerEl: HTMLElement): HTMLElement {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = [
            'background:rgba(255,255,255,0.03)',
            'border:1px solid var(--border-color)',
            `border-left:3px solid ${accentColor}`,
            'border-radius:8px',
            'padding:12px',
            'margin-bottom:10px',
        ].join(';');

        const label = document.createElement('div');
        label.style.cssText = `color:${accentColor};font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:8px;`;
        label.textContent = title;
        wrapper.appendChild(label);
        wrapper.appendChild(innerEl);
        return wrapper;
    }

    private _renderCommune(c: CommuneInfo): HTMLElement {
        const el = document.createElement('div');
        el.style.cssText = 'display:grid;grid-template-columns:auto 1fr;gap:3px 10px;font-size:12px;';
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
            el.style.cssText = 'color:var(--text-muted);font-size:12px;';
            el.textContent = 'Données indisponibles';
            return el;
        }
        el.appendChild(this._eluCard(maire, 'Maire'));
        return el;
    }

    private _renderDeputes(deputes: EluData[]): HTMLElement {
        const el = document.createElement('div');
        if (deputes.length === 0) {
            el.style.cssText = 'color:var(--text-muted);font-size:12px;';
            el.textContent = 'Données indisponibles';
            return el;
        }
        deputes.forEach((d) => el.appendChild(this._eluCard(d, d.groupeParlementaire)));
        return el;
    }

    private _renderSenateurs(senateurs: EluData[]): HTMLElement {
        const el = document.createElement('div');
        if (senateurs.length === 0) {
            el.style.cssText = 'color:var(--text-muted);font-size:12px;';
            el.textContent = 'Données indisponibles';
            return el;
        }
        senateurs.forEach((s) => el.appendChild(this._eluCard(s, s.groupeParlementaire)));
        return el;
    }

    private _renderRegion(president: EluData | null, commune: CommuneInfo): HTMLElement {
        const el = document.createElement('div');
        if (!president) {
            const noData = document.createElement('div');
            noData.style.cssText = 'color:var(--text-muted);font-size:12px;';
            noData.textContent = 'Données indisponibles';
            el.appendChild(noData);
        } else {
            el.appendChild(this._eluCard(president, 'Président de région'));
        }
        const regionInfo = document.createElement('div');
        regionInfo.style.cssText = 'color:var(--text-muted);font-size:11px;margin-top:6px;';
        regionInfo.textContent = `Région : ${commune.nomRegion}`;
        el.appendChild(regionInfo);
        return el;
    }

    private _eluCard(elu: EluData, roleLabel: string | undefined): HTMLElement {
        const card = document.createElement('div');
        card.style.cssText = 'margin-bottom:8px;padding:8px;background:rgba(255,255,255,0.04);border-radius:6px;cursor:pointer;transition:background 0.15s;';
        card.addEventListener('mouseenter', () => { card.style.background = 'rgba(255,255,255,0.08)'; });
        card.addEventListener('mouseleave', () => { card.style.background = 'rgba(255,255,255,0.04)'; });
        card.addEventListener('click', (e) => { e.stopPropagation(); this._showEluDetail(elu, roleLabel); });

        const topRow = document.createElement('div');
        topRow.style.cssText = 'display:flex;align-items:center;gap:10px;';

        // Photo
        if (elu.photoUrl) {
            const img = document.createElement('img');
            img.src = elu.photoUrl;
            img.style.cssText = 'width:36px;height:36px;border-radius:50%;object-fit:cover;flex-shrink:0;background:rgba(255,255,255,0.1);';
            img.onerror = () => { img.style.display = 'none'; };
            topRow.appendChild(img);
        }

        const nameGroup = document.createElement('div');
        nameGroup.style.cssText = 'min-width:0;flex:1;';

        const nameEl = document.createElement('div');
        nameEl.style.cssText = 'color:var(--text-primary);font-weight:600;font-size:13px;';
        nameEl.textContent = `${elu.prenom} ${elu.nom}`;
        nameGroup.appendChild(nameEl);

        if (roleLabel) {
            const roleEl = document.createElement('div');
            roleEl.style.cssText = 'color:var(--text-muted);font-size:11px;margin-top:1px;';
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
        if (elu.parti) details.push(elu.parti);
        if (elu.circonscription) details.push(elu.circonscription);

        if (details.length > 0) {
            const detailsEl = document.createElement('div');
            detailsEl.style.cssText = 'color:var(--text-muted);font-size:11px;margin-top:4px;line-height:1.6;' + (elu.photoUrl ? 'padding-left:46px;' : '');
            detailsEl.textContent = details.join(' · ');
            card.appendChild(detailsEl);
        }

        return card;
    }

    private _showEluDetail(elu: EluData, roleLabel: string | undefined): void {
        // Remove any existing detail popup
        const existing = this.modalEl.querySelector('.elu-detail-popup');
        if (existing) { existing.remove(); return; }

        const popup = document.createElement('div');
        popup.className = 'elu-detail-popup';
        popup.style.cssText = [
            'position:absolute',
            'inset:0',
            'background:var(--bg-surface)',
            'border-radius:12px',
            'z-index:10',
            'display:flex',
            'flex-direction:column',
            'overflow:hidden',
        ].join(';');

        // Header with back button
        const header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--border-color);flex-shrink:0;';
        const backBtn = document.createElement('button');
        backBtn.textContent = '←';
        backBtn.style.cssText = 'background:rgba(255,255,255,0.1);border:none;color:var(--text-muted);cursor:pointer;font-size:14px;width:28px;height:28px;border-radius:14px;flex-shrink:0;';
        backBtn.onclick = () => popup.remove();
        const title = document.createElement('div');
        title.style.cssText = 'color:var(--text-primary);font-weight:600;font-size:13px;';
        title.textContent = `${elu.prenom} ${elu.nom}`;
        header.appendChild(backBtn);
        header.appendChild(title);
        popup.appendChild(header);

        // Body
        const body = document.createElement('div');
        body.style.cssText = 'padding:20px;overflow-y:auto;flex:1;display:flex;flex-direction:column;align-items:center;gap:16px;';

        // Photo (large)
        if (elu.photoUrl) {
            const img = document.createElement('img');
            img.src = elu.photoUrl;
            img.style.cssText = 'width:80px;height:80px;border-radius:50%;object-fit:cover;background:rgba(255,255,255,0.1);border:2px solid var(--border-color);';
            img.onerror = () => { img.style.display = 'none'; };
            body.appendChild(img);
        }

        // Info grid
        const grid = document.createElement('div');
        grid.style.cssText = 'width:100%;display:grid;grid-template-columns:auto 1fr;gap:6px 12px;font-size:12px;';

        const rows: [string, string | undefined][] = [
            ['Rôle', roleLabel],
            ['Parti', elu.parti],
            ['Groupe', elu.groupeParlementaire],
            ['Circonscription', elu.circonscription],
            ['Profession', elu.profession],
        ];
        if (elu.mandatDepuis) {
            try {
                const d = new Date(elu.mandatDepuis);
                rows.push(['Mandat depuis', d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })]);
            } catch {
                rows.push(['Mandat depuis', elu.mandatDepuis]);
            }
        }
        if (elu.dateNaissance) {
            try {
                const d = new Date(elu.dateNaissance);
                rows.push(['Né(e) le', d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })]);
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
        body.appendChild(grid);

        popup.appendChild(body);
        this.modalEl.appendChild(popup);
    }
}
