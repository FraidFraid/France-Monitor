/**
 * LayerPanel.ts — Panneau COUCHES dans la sidebar (style WorldMonitor).
 * Header collapsible avec bouton ? + liste scrollable de checkboxes.
 */

import type { MapLayers } from '../types/index.ts';
import { AIS_RELAY_URL } from '../services/ais-connection.ts';
import { fmIcon } from './shared/icons.ts';

interface LayerDef {
  key: keyof MapLayers;
  label: string;
  icon: string;
  sublayerOf?: keyof MapLayers;
}

const LAYER_DEFS: LayerDef[] = [
  { key: 'newsGroup', label: 'ACTUALITÉS', icon: fmIcon('newspaper') },
  { key: 'news', label: 'ACTUALITÉS GÉOLOCALISÉES', icon: fmIcon('newspaper'), sublayerOf: 'newsGroup' },
  { key: 'stability', label: 'INDICE STABILITÉ', icon: fmIcon('bar-chart-3'), sublayerOf: 'newsGroup' },
  { key: 'energySystems', label: 'SYSTÈMES ÉNERGÉTIQUES', icon: fmIcon('zap') },
  { key: 'dromEnergy', label: 'ÉNERGIE DROM / SEI', icon: fmIcon('palmtree'), sublayerOf: 'energySystems' },
  { key: 'powerGrid', label: 'RÉSEAU ÉLECTRIQUE / ÉCOWATT', icon: fmIcon('zap'), sublayerOf: 'energySystems' },
  { key: 'nuclearFleet', label: 'PARC NUCLÉAIRE', icon: fmIcon('atom'), sublayerOf: 'energySystems' },
  { key: 'gasNetwork', label: 'RÉSEAU GAZ', icon: fmIcon('flame'), sublayerOf: 'energySystems' },
  { key: 'hydroBackbone', label: 'HYDRO – STRESS HYDRO-ÉNERGÉTIQUE', icon: fmIcon('droplet'), sublayerOf: 'energySystems' },
  { key: 'oilNetwork', label: 'PÉTROLE – RÉSEAU & STOCKS', icon: fmIcon('fuel'), sublayerOf: 'energySystems' },
  { key: 'windMonitor', label: 'VEILLE ÉOLIENNE', icon: fmIcon('wind'), sublayerOf: 'energySystems' },
  { key: 'metroLoad', label: 'CHARGE MÉTROPOLITAINE', icon: fmIcon('building-2'), sublayerOf: 'energySystems' },
  { key: 'health', label: 'SANTÉ / ÉPIDÉMIO', icon: `<span style="color:#22c55e;">${fmIcon('stethoscope')}</span>` },
  { key: 'healthOscour', label: 'OSCOUR / SOS MÉDECINS', icon: fmIcon('siren'), sublayerOf: 'health' },
  { key: 'healthApl', label: 'APL — DÉSERTS MÉDICAUX', icon: fmIcon('map-pin'), sublayerOf: 'health' },
  { key: 'hospitals', label: 'HÔPITAUX (FINESS)', icon: `<span style="color:#e53935;">${fmIcon('hospital')}</span>`, sublayerOf: 'health' },
  { key: 'traffic', label: 'TRAFICS', icon: fmIcon('car-front') },
  { key: 'trafficRoad', label: 'TRAFIC ROUTIER', icon: fmIcon('car-front'), sublayerOf: 'traffic' },
  { key: 'trafficMaritime', label: 'TRAFIC MARITIME', icon: fmIcon('ship'), sublayerOf: 'traffic' },
  { key: 'trafficAir', label: 'TRAFIC AÉRIEN', icon: fmIcon('plane'), sublayerOf: 'traffic' },
  { key: 'trafficRail', label: 'RÉSEAU FERROVIAIRE', icon: fmIcon('train-front'), sublayerOf: 'traffic' },
  { key: 'environmentGroup', label: 'ENVIRONNEMENT', icon: fmIcon('leaf') },
  { key: 'environmental', label: 'MÉTÉO / CRUES', icon: fmIcon('leaf'), sublayerOf: 'environmentGroup' },
  { key: 'weatherRadar', label: 'RADAR MÉTÉO', icon: fmIcon('cloud-rain'), sublayerOf: 'environmentGroup' },
  { key: 'fires', label: 'FEUX DE FORÊT (NASA FIRMS)', icon: fmIcon('flame'), sublayerOf: 'environmentGroup' },
  { key: 'dayNight', label: 'JOUR / NUIT', icon: fmIcon('moon'), sublayerOf: 'environmentGroup' },
  { key: 'sovereignty', label: 'SOUVERAINETÉ', icon: fmIcon('shield') },
  { key: 'military', label: 'DÉFENSE', icon: fmIcon('shield'), sublayerOf: 'sovereignty' },
  { key: 'subseaCables', label: 'CONNECTIVITÉ SOUS-MARINE', icon: fmIcon('waves'), sublayerOf: 'sovereignty' },
  { key: 'cyber', label: 'VIGILANCE CYBER', icon: fmIcon('lock-keyhole'), sublayerOf: 'sovereignty' },
  { key: 'outages', label: 'PANNES RÉSEAU', icon: fmIcon('satellite-dish') },
  { key: 'outagesElec',     label: 'ÉLECTRICITÉ',   icon: fmIcon('zap'),   sublayerOf: 'outages' },
  { key: 'outagesTelecom',  label: 'TÉLÉCOM 4G·5G', icon: fmIcon('satellite-dish'), sublayerOf: 'outages' },
  { key: 'outagesInternet', label: 'INTERNET / BGP', icon: fmIcon('globe'), sublayerOf: 'outages' },
  { key: 'outagesCloud',    label: 'CLOUD / IXP',   icon: fmIcon('cloud'),   sublayerOf: 'outages' },
  { key: 'elus', label: 'ÉLUS & REPRÉSENTANTS', icon: fmIcon('landmark') },
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
            <div class="layer-panel-accordion-header" id="news-accordion-toggle" aria-expanded="${this.newsExpanded}" style="display:flex; align-items:center; padding: 8px 12px; cursor: pointer; background: rgba(255,255,255,0.05); margin-bottom: 2px; border-radius: 4px; transition: background 0.2s;">
              <span class="layer-panel-icon" style="margin-right: 8px;">${fmIcon('newspaper')}</span>
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
            <div class="layer-panel-accordion-header" id="energy-accordion-toggle" aria-expanded="${this.energyExpanded}" style="display:flex; align-items:center; padding: 8px 12px; cursor: pointer; background: rgba(255,255,255,0.05); margin-bottom: 2px; border-radius: 4px; transition: background 0.2s;">
              <span class="layer-panel-icon" style="margin-right: 8px;">${fmIcon('zap')}</span>
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
            <div class="layer-panel-accordion-header" id="health-accordion-toggle" aria-expanded="${this.healthExpanded}" style="display:flex; align-items:center; padding: 8px 12px; cursor: pointer; background: rgba(255,255,255,0.05); margin-bottom: 2px; border-radius: 4px; transition: background 0.2s;">
              <span class="layer-panel-icon" style="margin-right: 8px;">${fmIcon('stethoscope')}</span>
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
            <div class="layer-panel-accordion-header" id="traffic-accordion-toggle" aria-expanded="${this.trafficExpanded}" style="display:flex; align-items:center; padding: 8px 12px; cursor: pointer; background: rgba(255,255,255,0.05); margin-bottom: 2px; border-radius: 4px; transition: background 0.2s;">
              <span class="layer-panel-icon" style="margin-right: 8px;">${fmIcon('car-front')}</span>
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
            <div class="layer-panel-accordion-header" id="sovereignty-accordion-toggle" aria-expanded="${this.sovereigntyExpanded}" style="display:flex; align-items:center; padding: 8px 12px; cursor: pointer; background: rgba(255,255,255,0.05); margin-bottom: 2px; border-radius: 4px; transition: background 0.2s;">
              <span class="layer-panel-icon" style="margin-right: 8px;">${fmIcon('shield')}</span>
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
            <div class="layer-panel-accordion-header" id="outages-accordion-toggle" aria-expanded="${this.outagesExpanded}" style="display:flex; align-items:center; padding: 8px 12px; cursor: pointer; background: rgba(255,255,255,0.05); margin-bottom: 2px; border-radius: 4px; transition: background 0.2s;">
              <span class="layer-panel-icon" style="margin-right: 8px;">${fmIcon('satellite-dish')}</span>
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
            <div class="layer-panel-accordion-header" id="environment-accordion-toggle" aria-expanded="${this.environmentExpanded}" style="display:flex; align-items:center; padding: 8px 12px; cursor: pointer; background: rgba(255,255,255,0.05); margin-bottom: 2px; border-radius: 4px; transition: background 0.2s;">
              <span class="layer-panel-icon" style="margin-right: 8px;">${fmIcon('leaf')}</span>
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

    // Opérabilité clavier des en-têtes d'accordéon (RGAA 7.1/7.3) :
    // on enrichit chaque <div> en bouton focusable ; Entrée/Espace rejouent
    // exactement le click souris déjà câblé plus bas (état géré par render()).
    this.element.querySelectorAll<HTMLElement>('.layer-panel-accordion-header').forEach((header) => {
      header.setAttribute('role', 'button');
      header.setAttribute('tabindex', '0');
      header.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault(); // Espace : évite le scroll de page
          header.click();
        }
      });
    });

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
        <span class="layer-help-header-icon">${fmIcon('map')}</span>
        <div class="layer-help-header-text">
          <div class="layer-help-header-title">Guide des couches</div>
          <div class="layer-help-header-subtitle">Description et fraîcheur de chaque couche cartographique</div>
        </div>
        <button class="layer-help-close" aria-label="Fermer">${fmIcon('x')}</button>
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
      this.helpSection(fmIcon('newspaper'), 'Actualités', [
        this.helpItem(fmIcon('newspaper'), 'Actualités géolocalisées', 'Articles PQR localisés sur la carte par département ou commune.', 'live'),
        this.helpItem(fmIcon('bar-chart-3'), 'Indice de stabilité', 'Score composite ISNR par département : social, sécurité/cyber, infrastructure et vélocité. Escalade visible si une dimension domine.', 'live'),
      ]),
      this.helpSection(fmIcon('zap'), 'Énergie', [
        this.helpItem(fmIcon('zap'), 'Réseau électrique / Écowatt', 'Signal national Écowatt (RTE) : vert / orange / rouge.', 'live'),
        this.helpItem(fmIcon('atom'), 'Parc nucléaire', 'Disponibilité des réacteurs (RTE) et signaux REMIT — arrêts planifiés et fortuits.', 'live'),
        this.helpItem(fmIcon('flame'), 'Réseau gaz', 'Stockages gaz, terminaux GNL et flux PIR en temps réel.', 'live'),
        this.helpItem(fmIcon('droplet'), 'Hydro – stress hydro-énergétique', 'Score de stress dérivé des mesures Hub’Eau. Indicateur de tension hydraulique.', 'derived'),
        this.helpItem(fmIcon('fuel'), 'Pétrole – réseau & stocks', 'Raffineries, dépôts, oléoducs + indicateurs SDES. Tension carburants quasi-live.', 'monthly'),
        this.helpItem(fmIcon('wind'), 'Veille éolienne', 'Production éolienne live France — parcs terrestres et offshore.', 'live'),
        this.helpItem(fmIcon('building-2'), 'Charge métropolitaine', 'Consommation électrique temps réel des grandes métropoles françaises.', 'live'),
      ]),
      this.helpSection(fmIcon('stethoscope'), 'Santé', [
        this.helpItem(fmIcon('stethoscope'), 'Santé / Épidémio', 'Indicateurs épidémiologiques régionaux (SPF / data.gouv.fr).', 'live'),
        this.helpItem(fmIcon('siren'), 'OSCOUR / SOS Médecins', 'Motifs pathologiques en hausse — passages urgences et actes SOS Médecins.', 'live'),
        this.helpItem(fmIcon('map-pin'), 'APL — Déserts médicaux', 'Accessibilité Potentielle Localisée aux médecins généralistes (DREES 2023).', 'monthly'),
        this.helpItem('&#9702;', 'Hôpitaux (FINESS)', 'Établissements de soins géolocalisés — base FINESS nationale.', 'monthly'),
      ]),
      this.helpSection(fmIcon('car-front'), 'Trafics', [
        this.helpItem(fmIcon('car-front'), 'Trafic routier', 'Incidents routiers temps réel (TomTom Traffic API).', 'live'),
        this.helpItem(fmIcon('ship'), 'Trafic maritime', 'Navires civils AIS — militaires dans la couche Défense.', 'live'),
        this.helpItem(fmIcon('plane'), 'Trafic aérien', 'Vols civils airplanes.live — militaires dans la couche Défense.', 'live'),
        this.helpItem(fmIcon('train-front'), 'Réseau ferroviaire', 'Perturbations SNCF actives : arrêts impactés par sévérité, tracés uniquement quand la géométrie est fiable.', 'live'),
      ]),
      this.helpSection(fmIcon('leaf'), 'Environnement', [
        this.helpItem(fmIcon('leaf'), 'Météo / Crues', 'Alertes Vigilance Météo-France et niveaux Vigicrues (stations hydrométriques).', 'live'),
        this.helpItem(fmIcon('cloud-rain'), 'Radar météo', 'Overlay raster précipitations temps réel (Météo-France / RainViewer).', 'live'),
        this.helpItem(fmIcon('flame'), 'Feux de forêt (NASA FIRMS)', 'Détections actives VIIRS satellite NASA. Latence ~3h.', 'derived'),
        this.helpItem(fmIcon('moon'), 'Jour / Nuit', 'Terminateur jour/nuit calculé en temps réel (zone d’ombre).', 'live'),
      ]),
      this.helpSection(fmIcon('shield'), 'Souveraineté', [
        this.helpItem(fmIcon('shield'), 'Défense', 'Bases militaires (▲), vols militaires et navires de la Marine nationale.', 'live'),
        this.helpItem(fmIcon('waves'), 'Connectivité sous-marine', 'Câbles télécom sous-marins et points d’atterrage en France.', 'monthly'),
        this.helpItem(fmIcon('lock-keyhole'), 'Vigilance cyber', 'Baromètre multi-signaux : leaks FR, ransomware 30j, CERT/NVD critiques, exposition passive Shodan/Censys et incidents géolocalisés. Chaque famille est plafonnée pour éviter la saturation.', 'live'),
      ]),
      this.helpSection(fmIcon('satellite-dish'), 'Pannes réseau', [
        this.helpItem(fmIcon('zap'), 'Électricité', 'Pannes Enedis (DataFair + zones citoyennes) et signal Ecowatt.', 'live'),
        this.helpItem(fmIcon('satellite-dish'), 'Télécom 4G·5G', 'Antennes dégradées ou hors service (données ARCEP).', 'live'),
        this.helpItem(fmIcon('globe'), 'Internet / BGP', 'Anomalies IODA et état des opérateurs (BGPView).', 'live'),
        this.helpItem(fmIcon('cloud'), 'Cloud / IXP', 'Pannes datacenters et points d\'échange Internet (IXP) en France.', 'live'),
      ]),
    ].join('');
  }
}
