// src/components/CyberPanel.ts : panneau de couche « Vigilance cyber » (spec 2026-10-04 souveraineté § 2.3 ; contrats § 4.2), réécrit
// dans le cadre commun : plus d'anneau de score, de familles plafonnées, d'onglets ni de carte des incidents (aucun lieu publié, V5).
// Coquille DOM : contenu de buildCyberView (pur : alertes CERT-FR en cours avec leur statut officiel, vulnérabilités exploitées du
// catalogue KEV, revendications agrégées, fuites en compte et lien, alertes Cybermalveillance) ; liens externes seulement.
import type { SovCyberState } from '../services/sovereignty-cyber.ts';
import { loadSectionState } from '../services/fiche-sections-store.ts';
import { buildCyberView } from './layer-panel/cyber.ts';
import { createLayerPanelShell, isLayerPanelOpen, safeStorage, sectionOpenOf, type LayerPanelShell } from './layer-panel/frame.ts';

const PANEL_ID = 'cyber';

export class CyberPanel {
  private shell: LayerPanelShell | null = null;
  private onClose?: () => void;
  private state: SovCyberState | null = null;
  private readonly storage = safeStorage();
  private readonly container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  mount(): void {
    this.shell = createLayerPanelShell({
      container: this.container, className: 'cyber-panel-modal', panelId: PANEL_ID, storage: this.storage, onClose: () => this.hide(),
    });
  }

  setOnClose(handler: () => void): void { this.onClose = handler; }

  show(state: SovCyberState | null): void {
    this.shell?.root.classList.add('is-open');
    this.update(state);
  }

  /** Nouvel état ; un panneau fermé ne se rouvre pas ; null garde le dernier état reçu. */
  update(state: SovCyberState | null): void {
    if (state) this.state = state;
    if (this.isVisible()) this.render();
  }

  hide(opts: { silent?: boolean } = {}): void {
    this.shell?.root.classList.remove('is-open');
    // Masquage « silencieux » (bascule entre panneaux) : ne désactive pas la couche.
    if (!opts.silent) this.onClose?.();
  }

  isVisible(): boolean {
    return this.shell ? isLayerPanelOpen(this.shell.root) : false;
  }

  destroy(): void {
    this.shell?.destroy();
    this.shell = null;
  }

  private render(): void {
    if (!this.shell) return;
    const slot = this.state?.cyber ?? null;
    const open = sectionOpenOf(loadSectionState(this.storage), PANEL_ID);
    this.shell.render(buildCyberView({ cyber: slot?.data ?? null, cyberError: slot?.error ?? null, now: Date.now(), open }));
  }
}
