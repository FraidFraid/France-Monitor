/**
 * MinistresPanel.ts — Section "Gouvernement" dans la right sidebar.
 * Affiche le PM + ministres compétents selon le contexte (categories).
 * Clic → modal OSINT complet avec tabs.
 */

import { GOUVERNEMENT, getMinistersForCategories, type Minister } from '../config/government.ts';
import { fetchMinisterAgenda, getFullMinisterProfile, getMinistersForCategoriesLive } from '../services/ministers.ts';
import type { EventCategory } from '../types/index.ts';

export class MinistresPanel {
  private containerEl!: HTMLElement;
  private bodyEl!: HTMLElement;
  private currentCategories: EventCategory[] = [];
  private liveMinisters: Minister[] | null = null;
  private liveRequestId = 0;
  private readonly parentEl: HTMLElement;

  constructor(parentEl: HTMLElement) {
    this.parentEl = parentEl;
  }

  mount(): void {
    this.containerEl = document.createElement('div');
    this.containerEl.className = 'panel';
    this.containerEl.innerHTML = `
      <div class="panel-header" style="cursor:pointer;user-select:none;">
        <span class="panel-title">GOUVERNEMENT</span>
        <span class="panel-badge" id="ministers-badge" style="display:none;"></span>
      </div>`;
    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'panel-body';
    this.containerEl.appendChild(this.bodyEl);
    this.parentEl.appendChild(this.containerEl);

    // Toggle collapse
    const header = this.containerEl.querySelector('.panel-header') as HTMLElement;
    let collapsed = false;
    header.addEventListener('click', () => {
      collapsed = !collapsed;
      this.bodyEl.style.display = collapsed ? 'none' : '';
    });

    // Afficher PM par défaut
    this.setContext([]);
  }

  setContext(categories: EventCategory[]): void {
    this.currentCategories = categories;
    this.liveMinisters = null;
    this._render();
    void this._refreshLiveMinisters();
  }

  private _formatPersonName(prenom: string, nom: string): string {
    return `${prenom} ${nom.toUpperCase()}`.trim();
  }

  private _render(): void {
    const ministers =
      this.liveMinisters && this.liveMinisters.length > 0
        ? this.liveMinisters
        : this.currentCategories.length > 0
          ? getMinistersForCategories(this.currentCategories)
          : GOUVERNEMENT;
    this.bodyEl.innerHTML = '';

    // Chips contexte
    if (this.currentCategories.length > 0) {
      const chips = document.createElement('div');
      chips.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px;';
      this.currentCategories.forEach(cat => {
        const chip = document.createElement('span');
        chip.style.cssText = 'background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:3px;padding:2px 7px;font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;';
        chip.textContent = cat;
        chips.appendChild(chip);
      });
      this.bodyEl.appendChild(chips);
    }

    ministers.slice(0, 4).forEach(m => this.bodyEl.appendChild(this._ministerCard(m)));

    if (ministers.length > 4) {
      const more = document.createElement('div');
      more.style.cssText = 'color:var(--text-muted);font-size:11px;text-align:center;padding:6px;cursor:pointer;';
      more.textContent = `+ ${ministers.length - 4} autre(s) ministre(s)`;
      more.addEventListener('click', () => {
        const fragment = document.createDocumentFragment();
        ministers.slice(4).forEach(m => fragment.appendChild(this._ministerCard(m)));
        more.replaceWith(fragment);
      });
      this.bodyEl.appendChild(more);
    }

    // Bouton voir tout
    const seeAll = document.createElement('div');
    seeAll.style.cssText = 'margin-top:8px;text-align:center;font-size:10px;color:var(--text-muted);cursor:pointer;padding:4px;border:1px solid var(--border-color);border-radius:4px;';
    seeAll.textContent = 'Voir tout le gouvernement';
    seeAll.addEventListener('click', () => this._showFullGovt());
    this.bodyEl.appendChild(seeAll);
  }

  private async _refreshLiveMinisters(): Promise<void> {
    const requestId = ++this.liveRequestId;
    try {
      const ministers = await getMinistersForCategoriesLive(this.currentCategories);
      if (requestId !== this.liveRequestId) return;
      this.liveMinisters = ministers;
      this._render();
    } catch {
      if (requestId !== this.liveRequestId) return;
      this.liveMinisters = null;
    }
  }

  private _ministerCard(minister: Minister): HTMLElement {
    const card = document.createElement('div');
    card.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px;background:rgba(255,255,255,0.03);border:1px solid var(--border-color);border-radius:6px;margin-bottom:6px;cursor:pointer;transition:background 0.15s;';
    card.addEventListener('mouseenter', () => { card.style.background = 'rgba(255,255,255,0.07)'; });
    card.addEventListener('mouseleave', () => { card.style.background = 'rgba(255,255,255,0.03)'; });
    card.addEventListener('click', () => this._openModal(minister));

    const avatar = document.createElement('div');
    avatar.style.cssText = 'width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,0.1);flex-shrink:0;overflow:hidden;display:flex;align-items:center;justify-content:center;';
    const cardPhotoUrl = (minister as Minister & { photoHd?: string }).photoHd ?? minister.photoUrl;
    if (cardPhotoUrl) {
      const img = document.createElement('img');
      img.src = cardPhotoUrl;
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
      img.onerror = () => { img.style.display = 'none'; avatar.textContent = minister.prenom[0] + minister.nom[0]; };
      avatar.appendChild(img);
    } else {
      avatar.style.cssText += 'font-size:12px;color:var(--text-muted);font-weight:700;';
      avatar.textContent = minister.prenom[0] + minister.nom[0];
    }

    const info = document.createElement('div');
    info.style.cssText = 'flex:1;min-width:0;';
    info.innerHTML = `
      <div style="color:var(--text-primary);font-weight:600;font-size:12px;line-height:1.35;white-space:normal;overflow:visible;text-overflow:clip;">
        ${this._formatPersonName(minister.prenom, minister.nom)}${minister.isPM ? ' \u{1F3DB}' : ''}
      </div>
      <div style="color:var(--text-muted);font-size:10px;margin-top:1px;line-height:1.35;white-space:normal;overflow:visible;text-overflow:clip;">
        ${minister.titreShort}${minister.parti ? ` \u00B7 ${minister.parti}` : ''}
      </div>`;

    const chevron = document.createElement('span');
    chevron.style.cssText = 'color:var(--text-muted);font-size:10px;flex-shrink:0;';
    chevron.textContent = '\u203A';

    card.appendChild(avatar);
    card.appendChild(info);
    card.appendChild(chevron);
    return card;
  }

  private async _openModal(minister: Minister): Promise<void> {
    // Overlay plein panel
    const existing = this.containerEl.parentElement?.querySelector('.minister-modal');
    if (existing) { existing.remove(); return; }

    const profile = await getFullMinisterProfile(minister);

    const modal = document.createElement('div');
    modal.className = 'minister-modal';
    modal.style.cssText = 'position:absolute;inset:0;background:var(--bg-surface);border-radius:8px;z-index:20;display:flex;flex-direction:column;overflow:hidden;';

    // Header
    const hdr = document.createElement('div');
    hdr.style.cssText = 'display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--border-color);flex-shrink:0;';
    const backBtn = document.createElement('button');
    backBtn.textContent = '\u2190';
    backBtn.style.cssText = 'background:rgba(255,255,255,0.1);border:none;color:var(--text-muted);cursor:pointer;width:28px;height:28px;border-radius:14px;font-size:14px;flex-shrink:0;';
    backBtn.onclick = () => modal.remove();
    const hdrTitle = document.createElement('div');
    hdrTitle.style.cssText = 'color:var(--text-primary);font-weight:600;font-size:12px;flex:1;';
    hdrTitle.textContent = profile.titreShort;
    hdr.appendChild(backBtn);
    hdr.appendChild(hdrTitle);
    modal.appendChild(hdr);

    // Body scrollable
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
          ${profile.dateNomination ? `<div style="color:var(--text-muted);font-size:10px;margin-top:4px;">Nommé(e) le ${new Date(profile.dateNomination).toLocaleDateString('fr-FR')}</div>` : ''}
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

    // Mount modal
    const rightSidebarContent = this.containerEl.closest('.right-sidebar-content');
    if (rightSidebarContent) {
      (rightSidebarContent as HTMLElement).style.position = 'relative';
      rightSidebarContent.appendChild(modal);
    }

    // Tab switching
    this._setupTabs(modal, profile);
    this._renderLinks(modal, profile);
  }

  private _setupTabs(modal: HTMLElement, minister: Minister): void {
    const tabs = modal.querySelectorAll('.mtab');
    const contentEl = modal.querySelector('#minister-tab-content') as HTMLElement;
    const renderTab = (tabName: string) => {
      tabs.forEach(t => {
        const btn = t as HTMLButtonElement;
        const isActive = btn.dataset['tab'] === tabName;
        btn.style.background = isActive ? 'rgba(255,255,255,0.08)' : 'transparent';
        btn.style.color = isActive ? 'var(--text-primary)' : 'var(--text-muted)';
      });
      if (tabName === 'portefeuille') {
        contentEl.innerHTML = `
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px;">Domaines de comp\u00E9tence</div>
          <div style="display:flex;flex-wrap:wrap;gap:5px;">
            ${minister.portefeuilles.map(p => `<span style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:3px;padding:3px 8px;font-size:11px;color:var(--text-primary);">${p}</span>`).join('')}
          </div>`;
      } else if (tabName === 'agenda') {
        contentEl.innerHTML = '<div style="color:var(--text-muted);font-size:11px;">Chargement agenda...</div>';
        this._loadAgenda(contentEl, minister);
      } else if (tabName === 'contact') {
        const contactRows = [
          minister.officeEmail || minister.emailCabinet ? `<div style="margin-bottom:8px;"><span style="color:var(--text-muted);font-size:10px;">Email : </span><a href="mailto:${minister.officeEmail ?? minister.emailCabinet}" target="_blank" rel="noopener" style="color:var(--text-primary);font-size:11px;">${minister.officeEmail ?? minister.emailCabinet}</a></div>` : '',
          minister.officePhone ? `<div style="margin-bottom:8px;"><span style="color:var(--text-muted);font-size:10px;">Téléphone : </span><span style="color:var(--text-primary);font-size:11px;">${minister.officePhone}</span></div>` : '',
          minister.siteMinistere ? `<div style="margin-bottom:8px;"><span style="color:var(--text-muted);font-size:10px;">Site : </span><a href="${minister.siteMinistere}" target="_blank" rel="noopener" style="color:var(--text-primary);font-size:11px;">${minister.siteMinistere}</a></div>` : '',
          minister.agendaUrl ? `<div style="margin-bottom:8px;"><span style="color:var(--text-muted);font-size:10px;">Agenda : </span><a href="${minister.agendaUrl}" target="_blank" rel="noopener" style="color:var(--text-primary);font-size:11px;">Agenda officiel</a></div>` : '',
          minister.servicePublicUrl ? `<div style="margin-bottom:8px;"><span style="color:var(--text-muted);font-size:10px;">Annuaire : </span><a href="${minister.servicePublicUrl}" target="_blank" rel="noopener" style="color:var(--text-primary);font-size:11px;">Service-Public</a></div>` : '',
          ((minister as { sourceLabel?: string; sourceUrl?: string; sourceUpdatedAt?: string }).sourceLabel || (minister as { sourceUrl?: string }).sourceUrl) ? `<div style="margin-bottom:8px;"><span style="color:var(--text-muted);font-size:10px;">Source : </span>${(minister as { sourceUrl?: string }).sourceUrl ? `<a href="${(minister as { sourceUrl?: string }).sourceUrl}" target="_blank" rel="noopener" style="color:var(--text-primary);font-size:11px;">${(minister as { sourceLabel?: string }).sourceLabel ?? 'Source officielle'}</a>` : `<span style="color:var(--text-primary);font-size:11px;">${(minister as { sourceLabel?: string }).sourceLabel}</span>`}${(minister as { sourceUpdatedAt?: string }).sourceUpdatedAt ? `<span style="color:var(--text-muted);font-size:10px;"> · MAJ ${new Date((minister as { sourceUpdatedAt: string }).sourceUpdatedAt).toLocaleDateString('fr-FR')}</span>` : ''}</div>` : '',
          minister.twitter ? `<div><span style="color:var(--text-muted);font-size:10px;">Twitter/X : </span><a href="https://twitter.com/${minister.twitter}" target="_blank" rel="noopener" style="color:var(--text-primary);font-size:11px;">@${minister.twitter}</a></div>` : '',
        ].filter(Boolean);
        contentEl.innerHTML = contactRows.length > 0
          ? contactRows.join('')
          : '<div style="color:var(--text-muted);font-size:11px;">Pas d\'info de contact disponible</div>';
      } else if (tabName === 'osint') {
        const datasets = (minister as { osintDatasets?: Array<{ title?: string; url?: string; description?: string; organization?: string; lastUpdate?: string; resourceCount?: number; resources?: Array<{ url?: string; format?: string; type?: string }> }> }).osintDatasets ?? [];
        contentEl.innerHTML = datasets.length === 0
          ? '<div style="color:var(--text-muted);font-size:11px;">Aucun dataset open data pertinent trouvé</div>'
          : datasets.map(dataset => `
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
                ${(dataset.resources ?? []).map(resource => resource.url ? `<a href="${resource.url}" target="_blank" rel="noopener" style="color:var(--text-primary);font-size:10px;">${resource.format ?? resource.type ?? 'Ressource'} ↗</a>` : '').join('')}
              </div>
            </div>`).join('');
      }
    };
    tabs.forEach(t => {
      t.addEventListener('click', () => renderTab((t as HTMLButtonElement).dataset['tab'] ?? ''));
    });
    renderTab('portefeuille');
  }

  private async _loadAgenda(el: HTMLElement, minister: Minister): Promise<void> {
    const items = await fetchMinisterAgenda(minister);
    if (items.length === 0) { el.innerHTML = '<div style="color:var(--text-muted);font-size:11px;">Aucun agenda disponible</div>'; return; }
    el.innerHTML = items.map(item => `
      <div style="padding:8px 0;border-bottom:1px solid var(--border-color);">
        <div style="color:var(--text-primary);font-size:11px;line-height:1.5;">${item.title}</div>
        <div style="color:var(--text-muted);font-size:10px;margin-top:3px;">${item.date}${item.location ? ` · ${item.location}` : ''}</div>
        ${item.sourceLabel ? `<div style="color:var(--text-muted);font-size:10px;margin-top:2px;">${item.sourceLabel}</div>` : ''}
        ${item.url ? `<a href="${item.url}" target="_blank" style="color:var(--text-muted);font-size:10px;">Voir \u2197</a>` : ''}
      </div>`).join('');
  }

  private _renderLinks(modal: HTMLElement, minister: Minister): void {
    const linksEl = modal.querySelector('#minister-links') as HTMLElement | null;
    if (!linksEl) return;

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

    addLinkButton('Site officiel', minister.siteMinistere);
    addLinkButton('Fiche officielle', (minister as { sourceLabel?: string; sourceUrl?: string }).sourceLabel === 'info.gouv.fr' ? (minister as { sourceUrl?: string }).sourceUrl : undefined);
    addLinkButton('Service-Public', minister.servicePublicUrl);
    addLinkButton((minister as { appointmentLabel?: string }).appointmentLabel ?? 'JORF', minister.appointmentUrl);
    addLinkButton('Wikipedia', (minister as { wikipediaUrl?: string }).wikipediaUrl);
    addLinkButton('Wikidata', minister.wikidataId ? `https://www.wikidata.org/wiki/${minister.wikidataId}` : undefined);
    addLinkButton('X/Twitter', minister.twitter ? `https://twitter.com/${minister.twitter}` : undefined);
    minister.openDataLinks?.forEach((link) => addLinkButton(link.label, link.url));

    const photoUrl = (minister as { photoHd?: string }).photoHd ?? minister.photoUrl;
    if (photoUrl) {
      const photoEl = modal.querySelector('#minister-photo') as HTMLElement | null;
      if (photoEl) {
        const img = document.createElement('img');
        img.src = photoUrl;
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
        img.onerror = () => {
          img.remove();
          photoEl.textContent = `${minister.prenom[0]}${minister.nom[0]}`;
        };
        photoEl.innerHTML = '';
        photoEl.appendChild(img);
      }
    }
  }

  private _showFullGovt(): void {
    this.setContext([]);
  }

  destroy(): void {
    this.containerEl.remove();
  }
}
