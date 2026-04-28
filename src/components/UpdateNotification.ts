export class UpdateNotification {
  private readonly element: HTMLElement;

  constructor(parent: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'update-notification';
    this.element.setAttribute('role', 'status');
    this.element.setAttribute('aria-live', 'polite');
    this.element.hidden = true;
    this.element.innerHTML = `
      <span class="update-notification__text">Nouvelle version disponible</span>
      <button class="update-notification__refresh" type="button">Rafraîchir</button>
      <button class="update-notification__dismiss" type="button" aria-label="Masquer">×</button>
    `;

    this.element
      .querySelector<HTMLButtonElement>('.update-notification__refresh')
      ?.addEventListener('click', () => window.location.reload());
    this.element
      .querySelector<HTMLButtonElement>('.update-notification__dismiss')
      ?.addEventListener('click', () => this.hide());

    parent.appendChild(this.element);
  }

  show(): void {
    this.element.hidden = false;
  }

  hide(): void {
    this.element.hidden = true;
  }

  destroy(): void {
    this.element.remove();
  }
}
