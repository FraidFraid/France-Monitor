/**
 * LayerPanel.ts — Panneau COUCHES dans la sidebar (style WorldMonitor).
 * Header collapsible avec bouton ? + liste scrollable de checkboxes.
 */

import type { MapLayers } from '../types/index.ts';
import { AIS_RELAY_URL } from '../services/ais-connection.ts';

interface LayerDef {
  key: keyof MapLayers;
  label: string;
  icon: string;
  sublayerOf?: keyof MapLayers;
}

const LAYER_DEFS: LayerDef[] = [
  { key: 'newsGroup', label: 'ACTUALITÉS', icon: '&#128240;' },
  { key: 'news', label: 'ACTUALITÉS GÉOLOCALISÉES', icon: '&#128240;', sublayerOf: 'newsGroup' },
  { key: 'stability', label: 'INDICE STABILITÉ', icon: '&#128202;', sublayerOf: 'newsGroup' },
  { key: 'energySystems', label: 'SYSTÈMES ÉNERGÉTIQUES', icon: '&#9889;' },
  { key: 'dromEnergy', label: 'ÉNERGIE DROM / SEI', icon: '&#127965;', sublayerOf: 'energySystems' },
  { key: 'powerGrid', label: 'RÉSEAU ÉLECTRIQUE / ÉCOWATT', icon: '&#9889;', sublayerOf: 'energySystems' },
  { key: 'nuclearFleet', label: 'PARC NUCLÉAIRE', icon: '&#9883;', sublayerOf: 'energySystems' },
  { key: 'gasNetwork', label: 'RÉSEAU GAZ', icon: '&#128293;', sublayerOf: 'energySystems' },
  { key: 'hydroBackbone', label: 'HYDRO – STRESS HYDRO-ÉNERGÉTIQUE', icon: '&#128167;', sublayerOf: 'energySystems' },
  { key: 'oilNetwork', label: 'PÉTROLE – RÉSEAU & STOCKS', icon: '&#128738;', sublayerOf: 'energySystems' },
  { key: 'windMonitor', label: 'VEILLE ÉOLIENNE', icon: '&#127788;', sublayerOf: 'energySystems' },
  { key: 'metroLoad', label: 'CHARGE MÉTROPOLITAINE', icon: '&#127963;', sublayerOf: 'energySystems' },
  { key: 'health', label: 'SANTÉ / ÉPIDÉMIO', icon: '&#127973;' },
  { key: 'healthHantavirus', label: 'HANTAVIRUS', icon: '&#129440;', sublayerOf: 'health' },
  { key: 'healthOscour', label: 'OSCOUR / SOS MÉDECINS', icon: '&#128657;', sublayerOf: 'health' },
  { key: 'healthApl', label: 'APL — DÉSERTS MÉDICAUX', icon: '&#127979;', sublayerOf: 'health' },
  { key: 'hospitals', label: 'HÔPITAUX (FINESS)', icon: '&#9702;', sublayerOf: 'health' },
  { key: 'traffic', label: 'TRAFICS', icon: '&#128663;' },
  { key: 'trafficRoad', label: 'TRAFIC ROUTIER', icon: '&#128663;', sublayerOf: 'traffic' },
  { key: 'trafficMaritime', label: 'TRAFIC MARITIME', icon: '&#128674;', sublayerOf: 'traffic' },
  { key: 'trafficAir', label: 'TRAFIC AÉRIEN', icon: '&#9992;', sublayerOf: 'traffic' },
  { key: 'trafficRail', label: 'RÉSEAU FERROVIAIRE', icon: '&#128641;', sublayerOf: 'traffic' },
  { key: 'environmentGroup', label: 'ENVIRONNEMENT', icon: '&#127793;' },
  { key: 'environmental', label: 'MÉTÉO / CRUES', icon: '&#127793;', sublayerOf: 'environmentGroup' },
  { key: 'weatherRadar', label: 'RADAR MÉTÉO', icon: '&#127782;', sublayerOf: 'environmentGroup' },
  { key: 'fires', label: 'FEUX DE FORÊT (NASA FIRMS)', icon: '&#128293;', sublayerOf: 'environmentGroup' },
  { key: 'dayNight', label: 'JOUR / NUIT', icon: '&#127761;', sublayerOf: 'environmentGroup' },
  { key: 'sovereignty', label: 'SOUVERAINETÉ', icon: '&#128737;' },
  { key: 'military', label: 'DÉFENSE', icon: '&#128737;', sublayerOf: 'sovereignty' },
  { key: 'subseaCables', label: 'CONNECTIVITÉ SOUS-MARINE', icon: '&#127754;', sublayerOf: 'sovereignty' },
  { key: 'cyber', label: 'VIGILANCE CYBER', icon: '&#128274;', sublayerOf: 'sovereignty' },
  { key: 'outages', label: 'PANNES RÉSEAU', icon: '&#128225;' },
  { key: 'outagesElec',     label: 'ÉLECTRICITÉ',   icon: '&#9889;',   sublayerOf: 'outages' },
  { key: 'outagesTelecom',  label: 'TÉLÉCOM 4G·5G', icon: '&#128225;', sublayerOf: 'outages' },
  { key: 'outagesInternet', label: 'INTERNET / BGP', icon: '&#127760;', sublayerOf: 'outages' },
  { key: 'outagesCloud',    label: 'CLOUD / IXP',   icon: '&#9729;',   sublayerOf: 'outages' },
  { key: 'elus', label: 'ÉLUS & REPRÉSENTANTS', icon: '&#127963;' },
];

export type LayerToggleHandler = (key: keyof MapLayers, enabled: boolean) => void;

export class LayerPanel {
  private container: HTMLElement;
  private layers: MapLayers;
  private onChange: LayerToggleHandler | null = null;
  private collapsed = false;
  private newsExpanded = true;
  private healthExpanded = true;
  private trafficExpanded = true;
  private energyExpanded = true;
  private sovereigntyExpanded = true;
  private outagesExpanded = true;
  private environmentExpanded = true;
  private element: HTMLElement | null = null;

  constructor(container: HTMLElement, initialLayers: MapLayers) {
    this.container = container;
    this.layers = { ...initialLayers };
  }

  setOnChange(handler: LayerToggleHandler): void {
    this.onChange = handler;
  }

  updateLayers(layers: MapLayers): void {
    this.layers = { ...layers };
    this.render();
  }

  mount(): void {
    this.element = document.createElement('div');
    this.element.className = 'layer-panel';
    this.container.appendChild(this.element);
    this.render();
  }

  private renderItem(def: LayerDef): string {
    const hidden = def.key === 'elus' || (def.key === 'trafficMaritime' && !AIS_RELAY_URL);
    return `
      <label class="layer-panel-item ${this.layers[def.key] ? 'active' : ''}" data-layer="${def.key}" style="${hidden ? 'display:none;' : ''}">
        <input type="checkbox" ${this.layers[def.key] ? 'checked' : ''} />
        <span class="layer-panel-icon">${def.icon}</span>
        <span class="layer-panel-label">${def.label}</span>
      </label>
    `;
  }


  private render(): void {
    if (!this.element) return;

    const nonToggleKeys = new Set<keyof MapLayers>(['newsGroup', 'energySystems', 'traffic', 'sovereignty', 'outages', 'environmentGroup', 'health']);
    const enabledCount = LAYER_DEFS.filter((d) => !nonToggleKeys.has(d.key) && this.layers[d.key]).length;

    let listHtml = '';
    let inNewsGroup = false;
    let inHealthGroup = false;
    let inTrafficGroup = false;
    let inEnergyGroup = false;
    let inSovereigntyGroup = false;
    let inOutagesGroup = false;
    let inEnvironmentGroup = false;

    for (const def of LAYER_DEFS) {
      // Close any open groups before starting a new master group
      const closeGroups = () => {
        if (inNewsGroup) { listHtml += `</div></div>`; inNewsGroup = false; }
        if (inHealthGroup) { listHtml += `</div></div>`; inHealthGroup = false; }
        if (inTrafficGroup) { listHtml += `</div></div>`; inTrafficGroup = false; }
        if (inEnergyGroup) { listHtml += `</div></div>`; inEnergyGroup = false; }
        if (inSovereigntyGroup) { listHtml += `</div></div>`; inSovereigntyGroup = false; }
        if (inOutagesGroup) { listHtml += `</div></div>`; inOutagesGroup = false; }
        if (inEnvironmentGroup) { listHtml += `</div></div>`; inEnvironmentGroup = false; }
      };

      if (def.key === 'newsGroup') {
        closeGroups();
        listHtml += `
          <div class="layer-panel-accordion ${this.newsExpanded ? 'expanded' : ''}">
            <div class="layer-panel-accordion-header" id="news-accordion-toggle" style="display:flex; align-items:center; padding: 8px 12px; cursor: pointer; background: rgba(255,255,255,0.05); margin-bottom: 2px; border-radius: 4px; transition: background 0.2s;">
              <span class="layer-panel-icon" style="margin-right: 8px;">&#128240;</span>
              <span class="layer-panel-label" style="flex: 1; font-weight: 600; font-size: 11px; letter-spacing: 0.5px; color: #E0E0E0; text-transform: uppercase;">ACTUALITÉS</span>
              <span class="layer-accordion-icon" style="font-size: 10px; color: #888; transition: transform 0.2s;">${this.newsExpanded ? '&#9650;' : '&#9664;'}</span>
            </div>
            <div class="layer-panel-accordion-content" style="display: ${this.newsExpanded ? 'block' : 'none'}; border-left: 2px solid rgba(255,255,255,0.1); margin-left: 10px; padding-left: 4px; margin-bottom: 8px; margin-top: 4px;">
        `;
        inNewsGroup = true;
      } else if (def.key === 'energySystems') {
        closeGroups();
        listHtml += `
          <div class="layer-panel-accordion ${this.energyExpanded ? 'expanded' : ''}">
            <div class="layer-panel-accordion-header" id="energy-accordion-toggle" style="display:flex; align-items:center; padding: 8px 12px; cursor: pointer; background: rgba(255,255,255,0.05); margin-bottom: 2px; border-radius: 4px; transition: background 0.2s;">
              <span class="layer-panel-icon" style="margin-right: 8px;">&#9889;</span>
              <span class="layer-panel-label" style="flex: 1; font-weight: 600; font-size: 11px; letter-spacing: 0.5px; color: #E0E0E0; text-transform: uppercase;">ÉNERGIE</span>
              <span class="layer-accordion-icon" style="font-size: 10px; color: #888; transition: transform 0.2s;">${this.energyExpanded ? '&#9650;' : '&#9664;'}</span>
            </div>
            <div class="layer-panel-accordion-content" style="display: ${this.energyExpanded ? 'block' : 'none'}; border-left: 2px solid rgba(255,255,255,0.1); margin-left: 10px; padding-left: 4px; margin-bottom: 8px; margin-top: 4px;">
        `;
        inEnergyGroup = true;
      } else if (def.key === 'health') {
        closeGroups();
        listHtml += `
          <div class="layer-panel-accordion ${this.healthExpanded ? 'expanded' : ''}">
            <div class="layer-panel-accordion-header" id="health-accordion-toggle" style="display:flex; align-items:center; padding: 8px 12px; cursor: pointer; background: rgba(255,255,255,0.05); margin-bottom: 2px; border-radius: 4px; transition: background 0.2s;">
              <span class="layer-panel-icon" style="margin-right: 8px;">&#127973;</span>
              <span class="layer-panel-label" style="flex: 1; font-weight: 600; font-size: 11px; letter-spacing: 0.5px; color: #E0E0E0; text-transform: uppercase;">SANTÉ</span>
              <span class="layer-accordion-icon" style="font-size: 10px; color: #888; transition: transform 0.2s;">${this.healthExpanded ? '&#9650;' : '&#9664;'}</span>
            </div>
            <div class="layer-panel-accordion-content" style="display: ${this.healthExpanded ? 'block' : 'none'}; border-left: 2px solid rgba(255,255,255,0.1); margin-left: 10px; padding-left: 4px; margin-bottom: 8px; margin-top: 4px;">
        `;
        listHtml += this.renderItem(def);
        inHealthGroup = true;
      } else if (def.key === 'traffic') {
        closeGroups();
        listHtml += `
          <div class="layer-panel-accordion ${this.trafficExpanded ? 'expanded' : ''}">
            <div class="layer-panel-accordion-header" id="traffic-accordion-toggle" style="display:flex; align-items:center; padding: 8px 12px; cursor: pointer; background: rgba(255,255,255,0.05); margin-bottom: 2px; border-radius: 4px; transition: background 0.2s;">
              <span class="layer-panel-icon" style="margin-right: 8px;">&#128663;</span>
              <span class="layer-panel-label" style="flex: 1; font-weight: 600; font-size: 11px; letter-spacing: 0.5px; color: #E0E0E0; text-transform: uppercase;">TRAFICS</span>
              <span class="layer-accordion-icon" style="font-size: 10px; color: #888; transition: transform 0.2s;">${this.trafficExpanded ? '&#9650;' : '&#9664;'}</span>
            </div>
            <div class="layer-panel-accordion-content" style="display: ${this.trafficExpanded ? 'block' : 'none'}; border-left: 2px solid rgba(255,255,255,0.1); margin-left: 10px; padding-left: 4px; margin-bottom: 8px; margin-top: 4px;">
        `;
        inTrafficGroup = true;
      } else if (def.key === 'sovereignty') {
        closeGroups();
        listHtml += `
          <div class="layer-panel-accordion ${this.sovereigntyExpanded ? 'expanded' : ''}">
            <div class="layer-panel-accordion-header" id="sovereignty-accordion-toggle" style="display:flex; align-items:center; padding: 8px 12px; cursor: pointer; background: rgba(255,255,255,0.05); margin-bottom: 2px; border-radius: 4px; transition: background 0.2s;">
              <span class="layer-panel-icon" style="margin-right: 8px;">&#128737;</span>
              <span class="layer-panel-label" style="flex: 1; font-weight: 600; font-size: 11px; letter-spacing: 0.5px; color: #E0E0E0; text-transform: uppercase;">SOUVERAINETÉ</span>
              <span class="layer-accordion-icon" style="font-size: 10px; color: #888; transition: transform 0.2s;">${this.sovereigntyExpanded ? '&#9650;' : '&#9664;'}</span>
            </div>
            <div class="layer-panel-accordion-content" style="display: ${this.sovereigntyExpanded ? 'block' : 'none'}; border-left: 2px solid rgba(255,255,255,0.1); margin-left: 10px; padding-left: 4px; margin-bottom: 8px; margin-top: 4px;">
        `;
        inSovereigntyGroup = true;
      } else if (inNewsGroup && def.sublayerOf === 'newsGroup') {
        listHtml += this.renderItem(def);
      } else if (inEnergyGroup && def.sublayerOf === 'energySystems') {
        listHtml += this.renderItem(def);
      } else if (inHealthGroup && def.sublayerOf === 'health') {
        listHtml += this.renderItem(def);
      } else if (inTrafficGroup && def.sublayerOf === 'traffic') {
        listHtml += this.renderItem(def);
      } else if (inSovereigntyGroup && def.sublayerOf === 'sovereignty') {
        listHtml += this.renderItem(def);
      } else if (def.key === 'outages') {
        closeGroups();
        listHtml += `
          <div class="layer-panel-accordion ${this.outagesExpanded ? 'expanded' : ''}">
            <div class="layer-panel-accordion-header" id="outages-accordion-toggle" style="display:flex; align-items:center; padding: 8px 12px; cursor: pointer; background: rgba(255,255,255,0.05); margin-bottom: 2px; border-radius: 4px; transition: background 0.2s;">
              <span class="layer-panel-icon" style="margin-right: 8px;">&#128225;</span>
              <span class="layer-panel-label" style="flex: 1; font-weight: 600; font-size: 11px; letter-spacing: 0.5px; color: #E0E0E0; text-transform: uppercase;">PANNES RÉSEAU</span>
              <span class="layer-accordion-icon" style="font-size: 10px; color: #888; transition: transform 0.2s;">${this.outagesExpanded ? '&#9650;' : '&#9664;'}</span>
            </div>
            <div class="layer-panel-accordion-content" style="display: ${this.outagesExpanded ? 'block' : 'none'}; border-left: 2px solid rgba(255,255,255,0.1); margin-left: 10px; padding-left: 4px; margin-bottom: 8px; margin-top: 4px;">
        `;
        inOutagesGroup = true;
      } else if (inOutagesGroup && def.sublayerOf === 'outages') {
        listHtml += this.renderItem(def);
      } else if (def.key === 'environmentGroup') {
        closeGroups();
        listHtml += `
          <div class="layer-panel-accordion ${this.environmentExpanded ? 'expanded' : ''}">
            <div class="layer-panel-accordion-header" id="environment-accordion-toggle" style="display:flex; align-items:center; padding: 8px 12px; cursor: pointer; background: rgba(255,255,255,0.05); margin-bottom: 2px; border-radius: 4px; transition: background 0.2s;">
              <span class="layer-panel-icon" style="margin-right: 8px;">&#127793;</span>
              <span class="layer-panel-label" style="flex: 1; font-weight: 600; font-size: 11px; letter-spacing: 0.5px; color: #E0E0E0; text-transform: uppercase;">ENVIRONNEMENT</span>
              <span class="layer-accordion-icon" style="font-size: 10px; color: #888; transition: transform 0.2s;">${this.environmentExpanded ? '&#9650;' : '&#9664;'}</span>
            </div>
            <div class="layer-panel-accordion-content" style="display: ${this.environmentExpanded ? 'block' : 'none'}; border-left: 2px solid rgba(255,255,255,0.1); margin-left: 10px; padding-left: 4px; margin-bottom: 8px; margin-top: 4px;">
        `;
        inEnvironmentGroup = true;
      } else if (inEnvironmentGroup && def.sublayerOf === 'environmentGroup') {
        listHtml += this.renderItem(def);
      } else {
        closeGroups();
        listHtml += this.renderItem(def);
      }
    }
    // Close any remaining open groups
    if (inNewsGroup) listHtml += `</div></div>`;
    if (inHealthGroup) listHtml += `</div></div>`;
    if (inTrafficGroup) listHtml += `</div></div>`;
    if (inEnergyGroup) listHtml += `</div></div>`;
    if (inSovereigntyGroup) listHtml += `</div></div>`;
    if (inOutagesGroup) listHtml += `</div></div>`;
    if (inEnvironmentGroup) listHtml += `</div></div>`;

    this.element.innerHTML = `
      <div class="layer-panel-header">
        <span class="layer-panel-title">COUCHES</span>
        <button class="layer-panel-help" title="Guide des couches">?</button>
        <button class="layer-panel-collapse" title="${this.collapsed ? 'Afficher' : 'Masquer'}">
          ${this.collapsed ? '&#9654;' : '&#9660;'}
        </button>
      </div>
      <div class="layer-panel-list ${this.collapsed ? 'collapsed' : ''}">
        ${listHtml}
      </div>
      <div class="layer-panel-footer ${this.collapsed ? 'collapsed' : ''}">
        <span class="layer-panel-count" title="${enabledCount} couches affichées / ${LAYER_DEFS.length} disponibles">${enabledCount}/${LAYER_DEFS.length} actifs</span>
      </div>
    `;

    // Collapse toggle
    this.element.querySelector('.layer-panel-collapse')?.addEventListener('click', () => {
      this.collapsed = !this.collapsed;
      this.render();
    });

    // News Accordion toggle
    const newsToggle = this.element.querySelector('#news-accordion-toggle') as HTMLElement | null;
    if (newsToggle) {
      newsToggle.addEventListener('mouseenter', () => {
        newsToggle.style.background = 'rgba(255,255,255,0.1)';
      });
      newsToggle.addEventListener('mouseleave', () => {
        newsToggle.style.background = 'rgba(255,255,255,0.05)';
      });
      newsToggle.addEventListener('click', (e) => {
        e.preventDefault();
        this.newsExpanded = !this.newsExpanded;
        this.render();
      });
    }

    // Health Accordion toggle
    const healthToggle = this.element.querySelector('#health-accordion-toggle') as HTMLElement | null;
    if (healthToggle) {
      // Setup a subtle hover effect
      healthToggle.addEventListener('mouseenter', () => {
        healthToggle.style.background = 'rgba(255,255,255,0.1)';
      });
      healthToggle.addEventListener('mouseleave', () => {
        healthToggle.style.background = 'rgba(255,255,255,0.05)';
      });

      healthToggle.addEventListener('click', (e) => {
        e.preventDefault();
        this.healthExpanded = !this.healthExpanded;
        this.render();
      });
    }

    // Traffic Accordion toggle
    const trafficToggle = this.element.querySelector('#traffic-accordion-toggle') as HTMLElement | null;
    if (trafficToggle) {
      trafficToggle.addEventListener('mouseenter', () => {
        trafficToggle.style.background = 'rgba(255,255,255,0.1)';
      });
      trafficToggle.addEventListener('mouseleave', () => {
        trafficToggle.style.background = 'rgba(255,255,255,0.05)';
      });

      trafficToggle.addEventListener('click', (e) => {
        e.preventDefault();
        this.trafficExpanded = !this.trafficExpanded;
        this.render();
      });
    }

    // Energy Accordion toggle
    const energyToggle = this.element.querySelector('#energy-accordion-toggle') as HTMLElement | null;
    if (energyToggle) {
      energyToggle.addEventListener('mouseenter', () => {
        energyToggle.style.background = 'rgba(255,255,255,0.1)';
      });
      energyToggle.addEventListener('mouseleave', () => {
        energyToggle.style.background = 'rgba(255,255,255,0.05)';
      });

      energyToggle.addEventListener('click', (e) => {
        e.preventDefault();
        this.energyExpanded = !this.energyExpanded;
        this.render();
      });
    }

    // Sovereignty Accordion toggle
    const sovereigntyToggle = this.element.querySelector('#sovereignty-accordion-toggle') as HTMLElement | null;
    if (sovereigntyToggle) {
      sovereigntyToggle.addEventListener('mouseenter', () => {
        sovereigntyToggle.style.background = 'rgba(255,255,255,0.1)';
      });
      sovereigntyToggle.addEventListener('mouseleave', () => {
        sovereigntyToggle.style.background = 'rgba(255,255,255,0.05)';
      });

      sovereigntyToggle.addEventListener('click', (e) => {
        e.preventDefault();
        this.sovereigntyExpanded = !this.sovereigntyExpanded;
        this.render();
      });
    }

    // Environment Accordion toggle
    const environmentToggle = this.element.querySelector('#environment-accordion-toggle') as HTMLElement | null;
    if (environmentToggle) {
      environmentToggle.addEventListener('mouseenter', () => {
        environmentToggle.style.background = 'rgba(255,255,255,0.1)';
      });
      environmentToggle.addEventListener('mouseleave', () => {
        environmentToggle.style.background = 'rgba(255,255,255,0.05)';
      });
      environmentToggle.addEventListener('click', (e) => {
        e.preventDefault();
        this.environmentExpanded = !this.environmentExpanded;
        this.render();
      });
    }

    // Outages Accordion toggle
    const outagesToggle = this.element.querySelector('#outages-accordion-toggle') as HTMLElement | null;
    if (outagesToggle) {
      outagesToggle.addEventListener('mouseenter', () => {
        outagesToggle.style.background = 'rgba(255,255,255,0.1)';
      });
      outagesToggle.addEventListener('mouseleave', () => {
        outagesToggle.style.background = 'rgba(255,255,255,0.05)';
      });
      outagesToggle.addEventListener('click', (e) => {
        e.preventDefault();
        this.outagesExpanded = !this.outagesExpanded;
        this.render();
      });
    }

    // Help button
    this.element.querySelector('.layer-panel-help')?.addEventListener('click', () => {
      this.showHelp();
    });

    // Layer toggles
    this.element.querySelectorAll('.layer-panel-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const key = (item as HTMLElement).dataset.layer as keyof MapLayers;
        if (key) {
          this.layers[key] = !this.layers[key];
          this.onChange?.(key, this.layers[key]);
          this.render();
        }
      });
    });
  }

  private showHelp(): void {
    const existing = document.querySelector('.layer-help-popup');
    if (existing) { existing.remove(); return; }

    const popup = document.createElement('div');
    popup.className = 'layer-help-popup';
    popup.innerHTML = `
      <div class="layer-help-header">
        <span class="layer-help-header-icon">&#128506;</span>
        <div class="layer-help-header-text">
          <div class="layer-help-header-title">Guide des couches</div>
          <div class="layer-help-header-subtitle">Description et fraîcheur de chaque couche cartographique</div>
        </div>
        <button class="layer-help-close">&times;</button>
      </div>
      <div class="layer-help-content">
        ${this.renderHelpSections()}
      </div>
    `;

    document.body.appendChild(popup);
    popup.querySelector('.layer-help-close')?.addEventListener('click', () => popup.remove());

    setTimeout(() => {
      document.addEventListener('click', function handler(e) {
        if (!popup.contains(e.target as Node)) {
          popup.remove();
          document.removeEventListener('click', handler);
        }
      });
    }, 100);
  }

  private badge(type: 'live' | 'derived' | 'monthly'): string {
    const map: Record<string, [string, string]> = {
      live:    ['live',    'LIVE'],
      derived: ['derived', 'DÉRIVÉ'],
      monthly: ['monthly', 'MENSUEL'],
    };
    const [cls, label] = map[type];
    return `<span class="layer-help-item-badge layer-help-item-badge--${cls}">${label}</span>`;
  }

  private helpItem(icon: string, label: string, desc: string, badgeType?: 'live' | 'derived' | 'monthly'): string {
    return `
      <div class="layer-help-item">
        <div class="layer-help-item-name">
          <span class="layer-help-item-name-icon">${icon}</span>
          <span>${label}</span>
          ${badgeType ? this.badge(badgeType) : ''}
        </div>
        <div class="layer-help-desc">${desc}</div>
      </div>`;
  }

  private helpSection(icon: string, title: string, items: string[]): string {
    return `
      <div class="layer-help-section">
        <div class="layer-help-section-header">
          <span class="layer-help-section-icon">${icon}</span>
          <span class="layer-help-section-title">${title}</span>
          <span class="layer-help-section-count">${items.length} couche${items.length > 1 ? 's' : ''}</span>
        </div>
        <div class="layer-help-grid">${items.join('')}</div>
      </div>`;
  }

  private renderHelpSections(): string {
    return [
      this.helpSection('&#128240;', 'Actualités', [
        this.helpItem('&#128240;', 'Actualités géolocalisées', 'Articles PQR localisés sur la carte par département ou commune.', 'live'),
        this.helpItem('&#128202;', 'Indice de stabilité', 'Score composite ISNR par département : social, sécurité/cyber, infrastructure et vélocité. Escalade visible si une dimension domine.', 'live'),
      ]),
      this.helpSection('&#9889;', 'Énergie', [
        this.helpItem('&#9889;', 'Réseau électrique / Écowatt', 'Signal national Écowatt (RTE) : vert / orange / rouge.', 'live'),
        this.helpItem('&#9883;', 'Parc nucléaire', 'Disponibilité des réacteurs (RTE) et signaux REMIT — arrêts planifiés et fortuits.', 'live'),
        this.helpItem('&#128293;', 'Réseau gaz', 'Stockages gaz, terminaux GNL et flux PIR en temps réel.', 'live'),
        this.helpItem('&#128167;', 'Hydro – stress hydro-énergétique', 'Score de stress dérivé des mesures Hub’Eau. Indicateur de tension hydraulique.', 'derived'),
        this.helpItem('&#128738;', 'Pétrole – réseau & stocks', 'Raffineries, dépôts, oléoducs + indicateurs SDES. Tension carburants quasi-live.', 'monthly'),
        this.helpItem('&#127788;', 'Veille éolienne', 'Production éolienne live France — parcs terrestres et offshore.', 'live'),
        this.helpItem('&#127963;', 'Charge métropolitaine', 'Consommation électrique temps réel des grandes métropoles françaises.', 'live'),
      ]),
      this.helpSection('&#127973;', 'Santé', [
        this.helpItem('&#127973;', 'Santé / Épidémio', 'Indicateurs épidémiologiques régionaux (SPF / data.gouv.fr).', 'live'),
        this.helpItem('&#128657;', 'OSCOUR / SOS Médecins', 'Motifs pathologiques en hausse — passages urgences et actes SOS Médecins.', 'live'),
        this.helpItem('&#127979;', 'APL — Déserts médicaux', 'Accessibilité Potentielle Localisée aux médecins généralistes (DREES 2023).', 'monthly'),
        this.helpItem('&#9702;', 'Hôpitaux (FINESS)', 'Établissements de soins géolocalisés — base FINESS nationale.', 'monthly'),
      ]),
      this.helpSection('&#128663;', 'Trafics', [
        this.helpItem('&#128663;', 'Trafic routier', 'Incidents routiers temps réel (TomTom Traffic API).', 'live'),
        this.helpItem('&#128674;', 'Trafic maritime', 'Navires civils AIS — militaires dans la couche Défense.', 'live'),
        this.helpItem('&#9992;', 'Trafic aérien', 'Vols civils airplanes.live — militaires dans la couche Défense.', 'live'),
        this.helpItem('&#128641;', 'Réseau ferroviaire', 'Perturbations SNCF actives : arrêts impactés par sévérité, tracés uniquement quand la géométrie est fiable.', 'live'),
      ]),
      this.helpSection('&#127793;', 'Environnement', [
        this.helpItem('&#127793;', 'Météo / Crues', 'Alertes Vigilance Météo-France et niveaux Vigicrues (stations hydrométriques).', 'live'),
        this.helpItem('&#127782;', 'Radar météo', 'Overlay raster précipitations temps réel (Météo-France / RainViewer).', 'live'),
        this.helpItem('&#128293;', 'Feux de forêt (NASA FIRMS)', 'Détections actives VIIRS satellite NASA. Latence ~3h.', 'derived'),
        this.helpItem('&#127761;', 'Jour / Nuit', 'Terminateur jour/nuit calculé en temps réel (zone d’ombre).', 'live'),
      ]),
      this.helpSection('&#128737;', 'Souveraineté', [
        this.helpItem('&#128737;', 'Défense', 'Bases militaires (▲), vols militaires et navires de la Marine nationale.', 'live'),
        this.helpItem('&#127754;', 'Connectivité sous-marine', 'Câbles télécom sous-marins et points d’atterrage en France.', 'monthly'),
        this.helpItem('&#128274;', 'Vigilance cyber', 'Baromètre multi-signaux : leaks FR, ransomware 30j, CERT/NVD critiques, exposition passive Shodan/Censys et incidents géolocalisés. Chaque famille est plafonnée pour éviter la saturation.', 'live'),
      ]),
      this.helpSection('&#128225;', 'Pannes réseau', [
        this.helpItem('&#9889;', 'Électricité', 'Pannes Enedis (DataFair + zones citoyennes) et signal Ecowatt.', 'live'),
        this.helpItem('&#128225;', 'Télécom 4G·5G', 'Antennes dégradées ou hors service (données ARCEP).', 'live'),
        this.helpItem('&#127760;', 'Internet / BGP', 'Anomalies IODA et état des opérateurs (BGPView).', 'live'),
        this.helpItem('&#9729;', 'Cloud / IXP', 'Pannes datacenters et points d\'échange Internet (IXP) en France.', 'live'),
      ]),
    ].join('');
  }
}
