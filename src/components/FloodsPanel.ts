import { Panel } from './Panel.ts';
import {
    applyPremiumCloseButtonHover,
    createPremiumIconHeader,
    getPremiumCloseButtonStyle,
    getPremiumModalStyle,
} from './panelHeader.ts';
import type { FloodSegment } from '../types/index.ts';
import { fmLoaderHTML } from './shared/loader.ts';

const FLOOD_COLORS: Record<string, string> = {
    red: 'var(--threat-critical)',
    orange: 'var(--threat-high)',
    yellow: 'var(--threat-medium)',
    green: 'var(--threat-low)',
};

function describeTrace(item: FloodSegment): string {
    if (item.dataSource === 'mock') return 'RECONSTRUIT / ESTIMÉ';
    if (item.geometryFidelity === 'matched') return 'Tracé hydrographique recalé';
    if (item.geometryFidelity === 'fallback') return 'RECONSTRUIT / ESTIMÉ';
    return 'Tracé brut Vigicrues';
}

export class FloodsPanel extends Panel {
    private contentEl: HTMLElement | null = null;
    private closeBtn: HTMLElement | null = null;
    private onClose?: () => void;
    private onHoverSegment?: (id: string | null) => void;

    constructor(container: HTMLElement) {
        super(container, { title: 'Vigicrues', icon: '🌊', collapsible: false });
    }

    setOnHoverSegment(handler: (id: string | null) => void): void {
        this.onHoverSegment = handler;
    }

    setOnClose(handler: () => void): void {
        this.onClose = handler;
    }

    mount(): void {
        this.modalEl = document.createElement('div');
        this.modalEl.className = 'floods-panel-modal';
        this.modalEl.style.cssText = `
      ${getPremiumModalStyle({
            width: '400px',
            maxHeight: 'calc(100vh - var(--right-panel-top) - 20px)',
            backgroundStart: 'rgba(8, 18, 31, 0.97)',
            backgroundEnd: 'rgba(9, 16, 28, 0.96)',
            borderColor: 'rgba(59, 130, 246, 0.18)',
        })}
    `;

        this.closeBtn = document.createElement('button');
        this.closeBtn.innerHTML = '✕';
        this.closeBtn.style.cssText = getPremiumCloseButtonStyle();
        applyPremiumCloseButtonHover(this.closeBtn);
        this.closeBtn.onclick = () => this.hide();

        this.modalEl.appendChild(this.closeBtn);

        const header = createPremiumIconHeader({
            icon: '🌊',
            title: 'Vigicrues',
            subtitle: "Surveillance des cours d'eau",
            gradientStart: 'rgba(14, 116, 144, 0.18)',
            gradientEnd: 'rgba(59, 130, 246, 0.10)',
            iconGradientStart: 'rgba(14, 165, 233, 0.22)',
            iconGradientEnd: 'rgba(59, 130, 246, 0.14)',
            titlePrefix: 'Hydrologie opérationnelle',
        });
        this.modalEl.appendChild(header);

        this.contentEl = document.createElement('div');
        this.contentEl.style.cssText = `
      padding: 16px;
      overflow-y: auto;
      flex: 1;
    `;
        this.modalEl.appendChild(this.contentEl);
        this.container.appendChild(this.modalEl);
        this.render();
    }

    showLoading(): void {
        if (!this.contentEl) return;
        this.contentEl.innerHTML = fmLoaderHTML({ text: 'Chargement des tronçons en crue…' });
    }

    private modalEl!: HTMLElement;

    protected render(): void { }

    // onClose removed

    show(segments: FloodSegment[]): void {
        if (!this.contentEl) return;
        this.modalEl.style.display = 'flex';

        // Filter out green if too many, or just sort
        const activeSegments = segments.filter(s => s.level !== 'green');

        if (activeSegments.length === 0) {
            this.onHoverSegment?.(null);
            this.contentEl.innerHTML = `
        <div style="text-align:center; color: var(--text-muted); padding: 20px 0;">
          <div style="font-size: 32px; margin-bottom: 12px; opacity: 0.5;">✅</div>
          <div>Aucun tronçon en crue significative.</div>
        </div>
      `;
            return;
        }

        const sorted = [...activeSegments].sort((a, b) => {
            const levels = { red: 3, orange: 2, yellow: 1, green: 0 };
            return (levels[b.level as keyof typeof levels] || 0) - (levels[a.level as keyof typeof levels] || 0);
        });

        const liveCount = activeSegments.filter((segment) => segment.dataSource === 'live').length;
        const matchedCount = activeSegments.filter((segment) => segment.geometryFidelity === 'matched').length;
        const corridorCount = activeSegments.filter((segment) => segment.geometryFidelity === 'fallback').length;
        const renderableCount = matchedCount + corridorCount;

        const byLevel: Record<string, FloodSegment[]> = { red: [], orange: [], yellow: [] };
        for (const s of sorted) {
            if (byLevel[s.level]) byLevel[s.level].push(s);
        }

        let html = `
      <div style="margin-bottom: 16px; padding: 10px 12px; border: 1px solid var(--border-color); border-radius: 8px; background: rgba(255,255,255,0.03);">
        <div style="color: var(--text-primary); font-size: 12px; font-weight: 600; margin-bottom: 4px;">Qualité du tracé</div>
        <div style="color: var(--text-muted); font-size: 11px;">
          TEMPS RÉEL: ${liveCount}
        </div>
        <div style="color: var(--text-muted); font-size: 11px; margin-top: 4px;">
          Affichés sur carte: ${renderableCount}/${activeSegments.length} · recalés: ${matchedCount} · corridors: ${corridorCount}
        </div>
      </div>
    `;

        for (const [level, items] of Object.entries(byLevel)) {
            if (items.length === 0) continue;

            const color = FLOOD_COLORS[level];
            const name = level === 'red' ? 'Rouge' : level === 'orange' ? 'Orange' : 'Jaune';

            html += `
        <div style="margin-bottom: 20px;">
          <div style="display:flex; align-items:center; gap: 8px; margin-bottom: 10px;">
            <div style="width: 12px; height: 12px; border-radius: 6px; background: ${color};"></div>
            <div style="color: ${color}; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">
              Vigilance ${name}
            </div>
          </div>
          <div style="display: flex; flex-direction: column; gap: 8px;">
      `;

            for (const item of items) {
                html += `
          <div class="flood-segment-item" data-id="${item.id}" style="background: rgba(0,0,0,0.2); border-left: 3px solid ${color}; padding: 10px 12px; border-radius: 0 4px 4px 0;">
            <div style="color: var(--text-primary); font-size: 13px; font-weight: 500;">
              ${item.name}
            </div>
            <div style="color: var(--text-muted); font-size: 11px; margin-top: 4px;">
              ${describeTrace(item)} · source ${item.dataSource === 'live' ? 'TEMPS RÉEL' : 'RECONSTRUIT / ESTIMÉ'} · confiance ${Math.round(item.matchConfidence * 100)}%
            </div>
          </div>
        `;
            }

            html += `</div></div>`;
        }

        this.contentEl.innerHTML = html;

        for (const card of this.contentEl.querySelectorAll<HTMLElement>('.flood-segment-item')) {
            card.onmouseenter = () => {
                card.style.background = 'var(--bg-surface-hover)';
                this.onHoverSegment?.(card.dataset.id ?? null);
            };
            card.onmouseleave = () => {
                card.style.background = 'rgba(0,0,0,0.2)';
                this.onHoverSegment?.(null);
            };
        }
    }

    hide(): void {
        this.onHoverSegment?.(null);
        if (this.modalEl) this.modalEl.style.display = 'none';
        this.onClose?.();
    }

    isVisible(): boolean {
        return this.modalEl?.style.display === 'flex';
    }
}
