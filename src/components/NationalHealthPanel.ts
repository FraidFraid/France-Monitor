import { Panel } from './Panel.ts';
import type { HealthFeatures } from '../types/index.ts';

export class NationalHealthPanel extends Panel {
  private modalEl!: HTMLElement;
  private contentEl: HTMLElement | null = null;
  private closeBtn: HTMLElement | null = null;
  private onClose?: () => void;

  constructor(container: HTMLElement) {
    super(container, { title: 'Indicateurs Santé', icon: '🇫🇷', collapsible: false });
  }

  setOnClose(handler: () => void): void {
    this.onClose = handler;
  }

  mount(): void {
    this.modalEl = document.createElement('div');
    this.modalEl.style.cssText = `
      position: absolute;
      top: calc(var(--header-height) + 20px);
      right: 20px;
      width: 360px;
      max-height: calc(100vh - var(--header-height) - 40px);
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      z-index: 1000;
      display: none;
      flex-direction: column;
      backdrop-filter: blur(10px);
      overflow: hidden;
    `;

    // Close button
    this.closeBtn = document.createElement('button');
    this.closeBtn.innerHTML = '✕';
    this.closeBtn.style.cssText = `
      position: absolute;
      top: 12px;
      right: 12px;
      background: rgba(255,255,255,0.1);
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      font-size: 14px;
      width: 28px;
      height: 28px;
      border-radius: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
      z-index: 10;
    `;
    this.closeBtn.onmouseover = () => {
      this.closeBtn!.style.background = 'rgba(255,255,255,0.2)';
      this.closeBtn!.style.color = 'var(--text-primary)';
    };
    this.closeBtn.onmouseout = () => {
      this.closeBtn!.style.background = 'rgba(255,255,255,0.1)';
      this.closeBtn!.style.color = 'var(--text-muted)';
    };
    this.closeBtn.onclick = () => this.hide();
    // Create separate header to attach drag events
    const header = document.createElement('div');
    header.style.cssText = `
      padding: 16px; border-bottom: 1px solid var(--border-color); display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; cursor: move;
    `;
    header.innerHTML = `
      <div style="display: flex; align-items: center; gap: 12px;">
        <div style="font-size: 24px;">🇫🇷</div>
        <div>
          <div style="color: var(--text-primary); font-weight: 600; font-size: 14px;">Indicateurs Santé Nationaux</div>
          <div style="color: var(--text-muted); font-size: 11px;">France métropolitaine et outre-mer</div>
        </div>
      </div>
    `;

    // Make it draggable
    let isDragging = false;
    let startX = 0; let startY = 0;
    let initialX = 0; let initialY = 0;

    header.addEventListener('mousedown', (e) => {
      if (e.target === this.closeBtn || this.closeBtn?.contains(e.target as Node)) return;
      e.preventDefault();
      e.stopPropagation();

      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      initialX = this.modalEl.offsetLeft;
      initialY = this.modalEl.offsetTop;

      this.modalEl.style.right = 'auto';
      this.modalEl.style.bottom = 'auto';
      this.modalEl.style.left = `${initialX}px`;
      this.modalEl.style.top = `${initialY}px`;
      this.modalEl.style.transform = 'none';

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      let newX = initialX + (e.clientX - startX);
      let newY = initialY + (e.clientY - startY);

      const maxX = window.innerWidth - this.modalEl.offsetWidth;
      const maxY = window.innerHeight - this.modalEl.offsetHeight;
      newX = Math.max(0, Math.min(newX, maxX));
      newY = Math.max(0, Math.min(newY, maxY + this.modalEl.offsetHeight - 60));

      this.modalEl.style.left = `${newX}px`;
      this.modalEl.style.top = `${newY}px`;
    };

    const onMouseUp = () => {
      isDragging = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    header.appendChild(this.closeBtn);
    this.modalEl.appendChild(header);

    this.contentEl = document.createElement('div');
    this.contentEl.style.cssText = `
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      overflow: hidden;
    `;
    this.modalEl.appendChild(this.contentEl);

    this.container.appendChild(this.modalEl);
    this.render();
  }

  protected render(): void { }

  show(data: HealthFeatures): void {
    if (!this.contentEl) return;
    this.modalEl.style.display = 'flex';

    // Safety bounds check
    const rect = this.modalEl.getBoundingClientRect();
    if (rect.right < 50 || rect.bottom < 50 || rect.left > window.innerWidth - 50 || rect.top > window.innerHeight - 50) {
      this.modalEl.style.right = '20px';
      this.modalEl.style.top = 'calc(var(--header-height) + 20px)';
      this.modalEl.style.left = 'auto';
    }

    const sentIndicatorsHtml = (data.sentinellesIndicators ?? []).length > 0
      ? (data.sentinellesIndicators.map(ind => {
        let trendHtml = '';
        if (ind.trend !== undefined && Math.abs(ind.trend) > 0.1) {
          if (ind.trend > 0) trendHtml = `<span style="color:#ff3b30; font-size:12px; margin-left:6px; font-weight:bold;">↑</span>`;
          else trendHtml = `<span style="color:#34c759; font-size:12px; margin-left:6px; font-weight:bold;">↓</span>`;
        } else if (ind.trend !== undefined) {
          trendHtml = `<span style="color:#9898a8; font-size:12px; margin-left:6px; font-weight:bold;">→</span>`;
        }
        return `
          <div style="display:flex; justify-content:space-between; margin-bottom:4px; align-items: center;">
            <span style="color:#d8d8df;">${ind.label}</span>
            <span><strong style="color:#bf5af2; font-size: 14px;">${ind.nationalIncidence.toFixed(1)}</strong><span style="color:#9898a8; font-size:11px; margin-left: 2px;">/100k</span>${trendHtml}</span>
          </div>`;
      }).join(''))
      : '<div style="color:#9898a8; font-size: 11px;">Aucun indicateur disponible.</div>';

    const ansmUrl = data.drugShortagesUrl ?? 'https://ansm.sante.fr/disponibilites-des-produits-de-sante/medicaments';
    const ansmItems = data.drugShortagesItems ?? [];

    let mixedItems: Array<{ drugName: string, status: string }> = [];
    if (ansmItems.length > 0) {
      const ruptures = ansmItems.filter(i => i.status === 'rupture').slice(0, 5);
      const tensions = ansmItems.filter(i => i.status === 'tension').slice(0, 5);
      const norms = ansmItems.filter(i => i.status === 'normalisation').slice(0, 5);
      mixedItems = [...ruptures, ...tensions, ...norms];
    }

    const badgeColors: Record<string, string> = {
      rupture: '#ff3b30',
      tension: '#ff9500',
      normalisation: '#34c759'
    };

    const ansmListHtml = mixedItems.length > 0
      ? mixedItems.map((it) => `
        <li style="margin:4px 0; display:flex; align-items:flex-start;">
          <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:${badgeColors[it.status] || '#9898a8'}; margin-right:6px; margin-top:5px; flex-shrink:0;"></span>
          <span style="color:#d8d8df; line-height:1.4;">${it.drugName} <span style="color:${badgeColors[it.status] || '#9898a8'}; margin-left:4px;"> (${it.status})</span></span>
        </li>`).join('')
      : '<li style="margin:2px 0; color:#9898a8;">Liste non disponible dans ce cycle.</li>';

    const ansmLastUpdate = data.drugShortagesLastUpdate
      ? new Date(data.drugShortagesLastUpdate).toLocaleDateString('fr-FR')
      : 'n/d';

    let html = `
      <div style="padding: 16px; overflow-y: auto; flex: 1; font-size: 13px;">
        <div style="background: rgba(255,255,255,0.05); border-left: 3px solid #3498db; padding: 10px; border-radius: 4px; margin-bottom: 20px; font-size: 11px; color: #d8d8df;">
          <i>Ces indicateurs sont nationaux (France entière) et ne sont pas disponibles au niveau départemental.</i>
        </div>

        <div style="margin-bottom: 24px;">
          <h5 style="margin: 0 0 10px; color: #bf5af2; font-weight: 600; font-size: 13px;">Réseau Sentinelles <span style="color:#9898a8; font-weight:normal; font-size:11px;">(Incidence)</span></h5>
          ${sentIndicatorsHtml}
        </div>

        <div style="border-top:1px solid rgba(255,255,255,0.08); padding-top:16px;">
          <h5 style="margin: 0 0 12px; color: #ff9f0a; font-weight: 600; font-size: 13px;">ANSM Pharmacovigilance</h5>
          
          <div style="font-size:12px; display:grid; grid-template-columns: 1fr auto; gap:6px 10px; margin-bottom:14px; padding: 10px; background: rgba(0,0,0,0.2); border-radius: 6px;">
            <span style="color:#9898a8;">Total pénuries signalées</span><strong>${data.drugShortagesCount ?? 0}</strong>
            <span style="color:#9898a8;">En rupture</span><strong style="color:#ff3b30;">${data.drugShortagesByStatus?.rupture ?? 0}</strong>
            <span style="color:#9898a8;">En tension</span><strong style="color:#ff9500;">${data.drugShortagesByStatus?.tension ?? 0}</strong>
            <span style="color:#9898a8;">En normalisation</span><strong style="color:#34c759;">${data.drugShortagesByStatus?.normalisation ?? 0}</strong>
            <div style="grid-column: 1 / -1; margin-top:2px; padding-top:6px; border-top:1px solid rgba(255,255,255,0.05); display:flex; justify-content:space-between; font-size: 11px;">
              <span style="color:#9898a8;">Dernière mise à jour :</span><strong style="color:#d8d8df;">${ansmLastUpdate}</strong>
            </div>
          </div>

          <div style="font-size:11px; color:#9898a8; margin-bottom:6px;">Médicaments en tension / rupture (aperçu mixte)</div>
          <ul style="margin:0 0 12px 0; padding-left:0; list-style-type:none; font-size:12px; max-height:160px; overflow:auto;">${ansmListHtml}</ul>
          <a href="${ansmUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block; font-size:11px; color:#64d2ff; text-decoration:none; background:rgba(100,210,255,0.1); padding: 4px 8px; border-radius:4px;">
            Voir la liste complète sur ansm.sante.fr →
          </a>
        </div>

        <div style="margin-top:18px; padding-top:14px; border-top:1px solid rgba(255,255,255,0.08); text-align:center;">
          <button onclick="document.dispatchEvent(new CustomEvent('open-health-barometer'))" style="
            width: 100%;
            background: linear-gradient(135deg, rgba(46,204,113,0.15), rgba(231,76,60,0.15));
            border: 1px solid rgba(255,255,255,0.15);
            color: #fff;
            padding: 10px 16px;
            border-radius: 8px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.2s;
            letter-spacing: 0.3px;
          ">🩺 Voir le Baromètre national Santé</button>
        </div>
      </div>
    `;

    this.contentEl.innerHTML = html;
  }

  hide(): void {
    if (this.modalEl) this.modalEl.style.display = 'none';
    this.onClose?.();
  }

  isVisible(): boolean {
    return this.modalEl?.style.display === 'flex';
  }
}
