import { Panel } from './Panel.ts';
import type { MarketData } from '../types/index.ts';
import { buildMarketSparkline } from '../utils/market-sparkline.ts';

function renderTruthBadge(label: string, color: string): string {
  return `<span style="display:inline-flex;align-items:center;justify-content:center;padding:2px 8px;border-radius:999px;background:${color}22;border:1px solid ${color}33;color:${color};font-size:9px;font-weight:700;letter-spacing:0.06em;">${label}</span>`;
}

/**
 * FinancePanel affiche les cours de la Bourse en temps réel (CAC40, etc.)
 */
export class FinancePanel extends Panel {
    private contentContainer: HTMLElement;
    private _badgeEl: HTMLElement | null = null;

    constructor(container: HTMLElement) {
        super(container, {
            title: 'Indicateurs Boursiers',
            icon: '📈',
            collapsible: true,
            defaultCollapsed: false
        });

        this.contentContainer = document.createElement('div');
        this.contentContainer.className = 'finance-content';
        // Style inline global appliqué sur le conteneur pour la vue
        this.contentContainer.style.display = 'grid';
        this.contentContainer.style.gridTemplateColumns = 'repeat(auto-fit, minmax(130px, 1fr))';
        this.contentContainer.style.gap = '8px';
        this.contentContainer.style.padding = '8px';
    }

    protected render(): void {
        if (this.bodyEl) {
            this._badgeEl = document.createElement('div');
            this._badgeEl.style.cssText = 'padding:4px 8px 0;';
            this.bodyEl.appendChild(this._badgeEl);
            this.bodyEl.appendChild(this.contentContainer);
        }
    }

    show(data: MarketData[]): void {
        if (!data || data.length === 0) {
            const now = new Date();
            const dayOfWeek = now.getDay(); // 0=dim, 6=sam
            const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
            const parisHour = parseInt(
                new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: 'numeric', hour12: false }).format(now),
                10
            );
            const isMarketClosed = isWeekend || parisHour < 9 || parisHour >= 18;
            const reason = isMarketClosed ? 'Marché fermé · données indisponibles hors séance.' : 'Source Marketstack inaccessible · réessai au prochain cycle.';
            this.contentContainer.innerHTML = `
        <div style="font-size: 11px; color: var(--text-muted); padding: 8px;">
          ${reason}
        </div>`;
            if (this._badgeEl) this._badgeEl.innerHTML = isMarketClosed
                ? renderTruthBadge('FERMÉ', '#6B7280')
                : renderTruthBadge('INDISPONIBLE', '#EF4444');
            this.setBadge(0);
            return;
        }

        const mostRecentMs = Math.max(...data.map(d => d.lastUpdated.getTime()));
        const ageMin = (Date.now() - mostRecentMs) / 60000;
        if (this._badgeEl) {
            this._badgeEl.innerHTML = ageMin > 15
                ? renderTruthBadge('CACHE FIGÉ', '#F59E0B')
                : renderTruthBadge('TEMPS RÉEL', '#10B981');
        }

        this.contentContainer.innerHTML = '';
        let hasCrash = false;

        const top10 = [...data]
            .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent))
            .slice(0, 10);

        for (const item of top10) {
            const card = document.createElement('div');
            card.style.background = 'rgba(255, 255, 255, 0.05)';
            card.style.borderRadius = '6px';
            card.style.padding = '8px';
            card.style.border = '1px solid rgba(255, 255, 255, 0.1)';
            card.style.display = 'flex';
            card.style.flexDirection = 'column';

            let color = 'var(--text-muted)';
            let arrow = '';
            if (item.trend === 'up') {
                color = '#4ade80'; // Tailwind green-400
                arrow = '↑';
            } else if (item.trend === 'down') {
                color = '#f87171'; // Tailwind red-400
                arrow = '↓';
                if (item.changePercent <= -3) {
                    hasCrash = true;
                }
            } else {
                color = '#9ca3af'; // Flat
                arrow = '→';
            }

            const valStr = (item.changePercent > 0 ? '+' : '') + item.changePercent.toFixed(2) + '%';

            const sparklineSvg = buildMarketSparkline(item.history, item.trend);

            card.innerHTML = `
        <div style="font-size: 10px; color: var(--text-muted); text-transform: uppercase;">
          ${item.name}
        </div>
        <div style="font-size: 14px; font-weight: bold; margin-top: 4px; display: flex; align-items: baseline; gap: 6px;">
          ${item.price.toFixed(2)}€
          <span style="color: ${color}; font-size: 11px; font-weight: normal;">${arrow} ${valStr}</span>
        </div>
        ${sparklineSvg}
      `;

            this.contentContainer.appendChild(card);
        }

        this.setBadge(top10.length, hasCrash);
    }
}
