import { Panel } from './Panel.ts';
import type { MarketData } from '../types/index.ts';
import { buildMarketSparkline } from '../utils/market-sparkline.ts';

/**
 * FinancePanel affiche les cours de la Bourse en temps réel (CAC40, etc.)
 */
export class FinancePanel extends Panel {
    private contentContainer: HTMLElement;

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
            this.bodyEl.appendChild(this.contentContainer);
        }
    }

    show(data: MarketData[]): void {
        if (!data || data.length === 0) {
            this.contentContainer.innerHTML = `
        <div style="font-size: 11px; color: var(--text-muted); padding: 8px;">
          Données financières non disponibles.
        </div>`;
            this.setBadge(0);
            return;
        }

        this.contentContainer.innerHTML = '';
        let hasCrash = false;

        for (const item of data) {
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

        this.setBadge(data.length, hasCrash);
    }
}
