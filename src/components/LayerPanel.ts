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
  { key: 'energyGroup', label: 'ÉNERGIE', icon: '&#9889;' },
  { key: 'energy', label: 'ÉLECTRICITÉ / ÉCOWATT', icon: '&#9889;', sublayerOf: 'energyGroup' },
  { key: 'gas', label: 'RÉSEAU GAZ', icon: '&#128293;', sublayerOf: 'energyGroup' },
  { key: 'oil', label: 'RÉSEAU PÉTROLE', icon: '&#128738;', sublayerOf: 'energyGroup' },
  { key: 'infrastructure', label: 'INFRAS VITALES', icon: '&#9881;', sublayerOf: 'energyGroup' },
  { key: 'metropoles', label: 'MÉTROPOLES ÉLECTRIQUES', icon: '&#127963;', sublayerOf: 'energyGroup' },
  { key: 'health', label: 'SANTÉ / ÉPIDÉMIO', icon: '&#127973;' },
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
  private newsExpanded = false;
  private healthExpanded = false;
  private trafficExpanded = false;
  private energyExpanded = false;
  private sovereigntyExpanded = false;
  private outagesExpanded = false;
  private environmentExpanded = false;
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

    const nonToggleKeys = new Set<keyof MapLayers>(['newsGroup', 'energyGroup', 'traffic', 'sovereignty', 'outages', 'environmentGroup']);
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
      } else if (def.key === 'energyGroup') {
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
      } else if (inEnergyGroup && def.sublayerOf === 'energyGroup') {
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
        <span class="layer-panel-count">${enabledCount}/${LAYER_DEFS.length} actifs</span>
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
    // Create help popup
    const existing = document.querySelector('.layer-help-popup');
    if (existing) {
      existing.remove();
      return;
    }

    const popup = document.createElement('div');
    popup.className = 'layer-help-popup';
    popup.innerHTML = `
      <div class="layer-help-header">
        <span>Guide des couches</span>
        <button class="layer-help-close">&times;</button>
      </div>
      <div class="layer-help-content">
        <div class="layer-help-section">
          <div class="layer-help-title">Données TEMPS RÉEL</div>
          ${LAYER_DEFS.map(def => `
            <div class="layer-help-item">
              <span>${def.icon} ${def.label}</span>
              <span class="layer-help-desc">${this.getLayerDescription(def.key)}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    document.body.appendChild(popup);

    popup.querySelector('.layer-help-close')?.addEventListener('click', () => {
      popup.remove();
    });

    // Close on outside click
    setTimeout(() => {
      document.addEventListener('click', function handler(e) {
        if (!popup.contains(e.target as Node)) {
          popup.remove();
          document.removeEventListener('click', handler);
        }
      });
    }, 100);
  }

  private getLayerDescription(key: keyof MapLayers): string {
    const descriptions: Record<keyof MapLayers, string> = {
      newsGroup: 'Groupe actualités : actus géolocalisées et indice de stabilité',
      news: 'Articles PQR géolocalisés',
      alerts: 'Alertes critiques en cours',
      energyGroup: 'Groupe énergie: électricité, gaz et métropoles électriques',
      energy: 'État du réseau électrique (Écowatt)',
      health: 'Indicateurs épidémiologiques régionaux (SPF/data.gouv)',
      healthOscour: 'Motifs pathologiques en hausse — OSCOUR / SOS Médecins (SPF)',
      healthApl: 'Accessibilité Potentielle Localisée aux médecins (DREES 2023)',
      hospitals: 'Carte des établissements de soins (base FINESS)',
      infrastructure: 'Nœuds énergétiques vitaux: électricité, gaz et pétrole',
      traffic: 'Groupe TRAFICS (routier, maritime, aérien civils)',
      trafficRoad: 'Incidents routiers TEMPS RÉEL (TomTom)',
      trafficMaritime: 'Trafic maritime AIS (civils) — militaires dans DÉFENSE',
      trafficAir: 'Trafic aérien civil (airplanes.live) — militaires dans DÉFENSE',
      trafficRail: 'Réseau ferroviaire SNCF — perturbations actives (arcs + gares)',
      environmentGroup: 'Groupe environnement: météo/crues, feux de forêt et terminateur jour/nuit',
      environmental: 'Alertes météo et crues',
      fires: 'Feux de forêt actifs — données satellite NASA FIRMS (VIIRS, latence ~3h)',
      metropoles: 'Consommation électrique TEMPS RÉEL des grandes métropoles',
      sovereignty: 'Groupe souveraineté: défense, connectivité sous-marine et vigilance cyber',
      military: 'Bases (▲), vols (avion) et navires militaires France + DROM',
      subseaCables: 'Câbles de télécommunications sous-marins et points d’atterrage en France',
      outages: 'Groupe pannes réseau : électricité, télécom, internet et cloud',
      outagesElec: 'Pannes électricité : Enedis DataFair, zones citoyennes et signal Ecowatt',
      outagesTelecom: 'Pannes télécom 4G·5G : antennes HS et dégradées (ARCEP)',
      outagesInternet: 'Pannes Internet/BGP : anomalies IODA et état des opérateurs (BGPView)',
      outagesCloud: 'Pannes datacenters et points d\'échange Internet (IXP) en France',
      stability: 'Indice de stabilité par département',
      cyber: 'Alertes CERT-FR, ransomware et CVE critiques',
      gas: 'Stockages gaz, terminaux GNL et flux PIR',
      oil: 'Raffineries, stocks pétroliers et vigilance approvisionnement',
      nuclear: 'Disponibilité des réacteurs nucléaires (RTE) et signaux REMIT',
      dayNight: 'Terminateur jour/nuit (zone d\'ombre calculée en temps réel)',
      elus: 'Élus & Représentants — en cours de configuration, non livré dans cette version',
    };
    return descriptions[key] || '';
  }
}
