export interface PremiumModalStyleOptions {
  width: string;
  maxHeight: string;
  backgroundStart: string;
  backgroundEnd: string;
  borderColor: string;
  position?: 'absolute' | 'fixed';
  top?: string;
  right?: string;
  zIndex?: number;
  extra?: string;
}

export interface PremiumHeaderBaseOptions {
  title: string;
  subtitle: string;
  gradientStart: string;
  gradientEnd: string;
  textColor?: string;
  mutedColor?: string;
  titlePrefix?: string;
  badgeId?: string;
  extraTopRowHtml?: string;
}

export interface PremiumRingHeaderOptions extends PremiumHeaderBaseOptions {
  ringId: string;
  centerId: string;
  centerText: string;
  centerFontSize?: string;
  ringStroke: string;
  statusId: string;
  updateId?: string;
}

export interface PremiumIconHeaderOptions extends PremiumHeaderBaseOptions {
  icon: string;
  iconGradientStart: string;
  iconGradientEnd: string;
  statusId?: string;
  updateId?: string;
}

export function getPremiumModalStyle(options: PremiumModalStyleOptions): string {
  const position = options.position ?? 'absolute';
  const top = options.top ?? 'var(--right-panel-top)';
  const right = options.right ?? '20px';
  const zIndex = options.zIndex ?? 1000;

  return `
    position: ${position};
    top: ${top};
    right: ${right};
    width: ${options.width};
    max-height: ${options.maxHeight};
    background: linear-gradient(180deg, ${options.backgroundStart}, ${options.backgroundEnd});
    border: 1px solid ${options.borderColor};
    border-radius: 14px;
    box-shadow: 0 12px 34px rgba(2, 6, 23, 0.52);
    z-index: ${zIndex};
    display: none;
    flex-direction: column;
    backdrop-filter: blur(12px);
    overflow: hidden;
    ${options.extra ?? ''}
  `;
}

export function getPremiumCloseButtonStyle(mutedColor = 'var(--text-muted)'): string {
  return `
    position: absolute;
    top: 12px;
    right: 12px;
    background: rgba(255,255,255,0.08);
    border: none;
    color: ${mutedColor};
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
}

export function applyPremiumCloseButtonHover(button: HTMLElement, mutedColor = 'var(--text-muted)', activeColor = 'var(--text-primary)'): void {
  button.onmouseover = () => {
    button.style.background = 'rgba(255,255,255,0.16)';
    button.style.color = activeColor;
  };
  button.onmouseout = () => {
    button.style.background = 'rgba(255,255,255,0.08)';
    button.style.color = mutedColor;
  };
}

export function createPremiumRingHeader(options: PremiumRingHeaderOptions): HTMLElement {
  const header = document.createElement('div');
  const textColor = options.textColor ?? 'var(--text-primary)';
  const mutedColor = options.mutedColor ?? 'var(--text-muted)';

  header.style.cssText = `
    padding: 18px 16px 14px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    display: flex;
    align-items: center;
    gap: 14px;
    background: linear-gradient(135deg, ${options.gradientStart}, ${options.gradientEnd});
  `;

  header.innerHTML = `
    <div style="position: relative; width: 68px; height: 68px; flex-shrink: 0;">
      <svg viewBox="0 0 36 36" style="width:68px;height:68px;transform:rotate(-90deg);">
        <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="3"></circle>
        <circle id="${options.ringId}" cx="18" cy="18" r="15.9" fill="none" stroke="${options.ringStroke}" stroke-width="3"
          stroke-dasharray="0 100" stroke-linecap="round" style="transition: stroke-dasharray 0.5s ease, stroke 0.3s ease;"></circle>
      </svg>
      <div id="${options.centerId}" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:${options.centerFontSize ?? '14px'};font-weight:700;color:${textColor};">${options.centerText}</div>
    </div>
    <div style="flex:1;min-width:0;">
      ${options.titlePrefix ? `<div style="font-size:10px;color:${mutedColor};text-transform:uppercase;letter-spacing:0.06em;margin-bottom:2px;">${options.titlePrefix}</div>` : ''}
      <div style="font-size:14px;font-weight:700;color:${textColor};">${options.title}</div>
      <div id="${options.statusId}" style="margin-top:2px;font-size:11px;color:${options.ringStroke};">${options.subtitle}</div>
      ${options.updateId ? `<div id="${options.updateId}" style="margin-top:5px;font-size:10px;color:${mutedColor};"></div>` : ''}
      ${options.badgeId ? `<div id="${options.badgeId}" style="margin-top:4px;"></div>` : ''}
      ${options.extraTopRowHtml ?? ''}
    </div>
  `;

  return header;
}

export function createPremiumIconHeader(options: PremiumIconHeaderOptions): HTMLElement {
  const header = document.createElement('div');
  const textColor = options.textColor ?? 'var(--text-primary)';
  const mutedColor = options.mutedColor ?? 'var(--text-muted)';

  header.style.cssText = `
    padding: 18px 16px 14px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    display: flex;
    align-items: center;
    gap: 14px;
    background: linear-gradient(135deg, ${options.gradientStart}, ${options.gradientEnd});
  `;

  header.innerHTML = `
    <div style="width:68px;height:68px;flex-shrink:0;border-radius:18px;
      display:flex;align-items:center;justify-content:center;font-size:30px;color:${textColor};
      background:linear-gradient(135deg, ${options.iconGradientStart}, ${options.iconGradientEnd});
      border:1px solid rgba(255,255,255,0.08);box-shadow: inset 0 1px 0 rgba(255,255,255,0.08);">
      ${options.icon}
    </div>
    <div style="flex:1;min-width:0;">
      ${options.titlePrefix ? `<div style="font-size:10px;color:${mutedColor};text-transform:uppercase;letter-spacing:0.06em;margin-bottom:2px;">${options.titlePrefix}</div>` : ''}
      <div style="font-size:14px;font-weight:700;color:${textColor};">${options.title}</div>
      ${options.statusId ? `<div id="${options.statusId}" style="margin-top:2px;font-size:11px;color:${textColor};">${options.subtitle}</div>` : `<div style="margin-top:2px;font-size:11px;color:${mutedColor};">${options.subtitle}</div>`}
      ${options.updateId ? `<div id="${options.updateId}" style="margin-top:5px;font-size:10px;color:${mutedColor};"></div>` : ''}
      ${options.badgeId ? `<div id="${options.badgeId}" style="margin-top:4px;"></div>` : ''}
      ${options.extraTopRowHtml ?? ''}
    </div>
  `;

  return header;
}
