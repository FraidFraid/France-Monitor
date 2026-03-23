/**
 * MapLegend.ts — Légende de la carte avec icônes et labels
 *
 * Légende contextuelle, horizontale en bas de la carte.
 * Affiche uniquement les catégories de données visibles.
 */

export interface LegendItem {
    id: string;
    label: string;
    color: string;
    icon?: string;      // Emoji ou caractère
    iconSize?: number;
    shape?: 'circle' | 'square' | 'triangle' | 'triangle-up' | 'triangle-down' | 'diamond' | 'zone' | 'vessel' | 'ring';
    borderColor?: string;
    borderWidth?: number;
    gradient?: string;  // CSS gradient override (ex: radial-gradient pour "rond dans le rond")
    visible?: boolean;
    isHeader?: boolean; // Rend l'item comme un titre de section (pas de shape/couleur)
}

export type LegendType = 'gradient' | 'categorical' | 'icon';

export interface LegendCategory {
    id: string;
    title: string;
    type?: LegendType;
    items: LegendItem[];
    columns?: number;           // Number of columns for items (default: 1)
    splitIndex?: number;
    splitIndices?: number[];    // Pour 3+ colonnes explicites, ex: [3, 6]
    gradientColors?: string[];
    gradientMin?: string;
    gradientMax?: string;
    collapsed?: boolean;
    visible?: boolean;
    source?: {
        label: string;
        url?: string;
        year?: number | string;
    };
    refresh?: {
        label: string;
    };
    notes?: string[];
}

// ─── Définition des éléments de légende ───────────────────────────────────────

export class MapLegend {
    private container: HTMLElement;
    private element: HTMLElement | null = null;
    private categories: LegendCategory[] = [];
    private onHoverCallback: ((categoryId: string | null) => void) | null = null;

    constructor(container: HTMLElement) {
        this.container = container;
    }

    init(): void {
        this.element = document.createElement('div');
        this.element.className = 'legend-banner-container';
        this.element.innerHTML = this.render();
        this.container.appendChild(this.element);
        this.bindEvents();
    }

    setOnHover(callback: (categoryId: string | null) => void): void {
        this.onHoverCallback = callback;
    }

    private render(): string {
        const activeCategories = this.categories.filter(cat => cat.visible !== false);

        if (activeCategories.length === 0) {
            return '';
        }

        const cardsHtml = activeCategories.map(cat => this.renderCategoryCard(cat)).join('');

        return `
            <div class="legend-scroll-area">
                ${cardsHtml}
            </div>
        `;
    }

    private renderCategoryCard(category: LegendCategory): string {
        let contentHtml = '';

        if (category.type === 'gradient' && category.gradientColors) {
            contentHtml = `
                <div class="legend-gradient">
                    <div class="color-bar" style="background: linear-gradient(to right, ${category.gradientColors.join(', ')});"></div>
                    <div class="labels">
                        <span>${category.gradientMin || ''}</span>
                        <span>${category.gradientMax || ''}</span>
                    </div>
                </div>
            `;
        } else {
            const visibleItems = category.items.filter(item => item.visible !== false);

            if (category.splitIndices && category.splitIndices.length >= 1) {
                // N+1 explicit columns split at each index
                const indices = [0, ...category.splitIndices, visibleItems.length];
                const colCount = indices.length - 1;
                const cols = indices.slice(0, -1).map((start, i) => {
                    const end = indices[i + 1];
                    const colItems = visibleItems.slice(start, end).map(item => this.renderItem(item)).join('');
                    return `<div class="legend-items">${colItems}</div>`;
                }).join('');
                contentHtml = `<div class="legend-items legend-items-split" style="grid-template-columns: repeat(${colCount}, 1fr);">${cols}</div>`;
            } else if (category.columns === 2 && category.splitIndex != null) {
                const leftItems = visibleItems.slice(0, category.splitIndex).map(item => this.renderItem(item)).join('');
                const rightItems = visibleItems.slice(category.splitIndex).map(item => this.renderItem(item)).join('');
                contentHtml = `
                    <div class="legend-items legend-items-split">
                        <div class="legend-items">${leftItems}</div>
                        <div class="legend-items">${rightItems}</div>
                    </div>
                `;
            } else {
                const itemsHtml = visibleItems
                    .map(item => this.renderItem(item))
                    .join('');

                const columnsClass = category.columns && category.columns > 1
                    ? `legend-items legend-cols-${category.columns}`
                    : 'legend-items';

                contentHtml = `
                    <div class="${columnsClass}">
                        ${itemsHtml}
                    </div>
                `;
            }
        }

        let footerHtml = '';
        if (category.source || category.refresh) {
            let innerHtml = '';
            if (category.source) {
                const { label, url, year } = category.source;
                const yearStr = year ? ` (${year})` : '';
                const linkStart = url ? `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline;">` : '';
                const linkEnd = url ? `</a>` : '';
                innerHtml += `<div>${linkStart}Source : ${label}${yearStr}${linkEnd}</div>`;
            }
            if (category.refresh) {
                innerHtml += `<div class="legend-refresh" style="margin-top: 2px; font-size: 11px; color: #7f8c8d;">Fréquence : ${category.refresh.label}</div>`;
            }
            if (category.notes && category.notes.length > 0) {
                const notesHtml = category.notes
                    .map((note) => `<div class="legend-note" style="margin-top: 4px;">${note}</div>`)
                    .join('');
                innerHtml += `<div class="legend-notes" style="margin-top: 6px;">${notesHtml}</div>`;
            }
            footerHtml = `<div class="legend-footer" style="font-size: 10px; color: #9898a8; margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.05); line-height: 1.4;">${innerHtml}</div>`;
        }

        return `
            <div class="legend-card" data-category="${category.id}">
                <h4>${category.title}</h4>
                ${contentHtml}
                ${footerHtml}
            </div>
        `;
    }

    private renderItem(item: LegendItem): string {
        // Section header — titre de colonne sans shape ni couleur
        if (item.isHeader) {
            return `
            <div class="legend-section-header" style="
                font-size: 10px; font-weight: 700; text-transform: uppercase;
                letter-spacing: .05em; color: ${item.color || '#9898a8'};
                margin: 0 0 5px; padding-bottom: 4px;
                border-bottom: 1px solid rgba(255,255,255,0.08);
                line-height: 1.3;
            ">${item.label}</div>`;
        }

        const shapeClass = item.shape || 'circle';

        // If item has an icon, render it as colored icon (no background)
        if (item.icon) {
            return `
            <div class="item" data-item="${item.id}">
                <span class="shape-icon" style="color: ${item.color}; font-size: ${item.iconSize ?? 14}px;">${item.icon}</span>
                <span>${item.label}</span>
            </div>
            `;
        }

        // For triangles, use border-bottom-color
        // For zones, use semi-transparent fill + dashed border
        // For others, use background-color
        let style: string;
        if (item.gradient) {
            style = `background: ${item.gradient}`;
        } else if (shapeClass === 'triangle-up') {
            const shadow = item.borderColor ? ` drop-shadow(0 0 ${item.borderWidth ?? 2}px ${item.borderColor})` : '';
            style = `background-color: ${item.color}; clip-path: polygon(50% 0%, 0% 100%, 100% 100%); filter:${shadow || 'none'};`;
        } else if (shapeClass === 'triangle-down') {
            const shadow = item.borderColor ? ` drop-shadow(0 0 ${item.borderWidth ?? 2}px ${item.borderColor})` : '';
            style = `background-color: ${item.color}; clip-path: polygon(0% 0%, 100% 0%, 50% 100%); filter:${shadow || 'none'};`;
        } else if (shapeClass === 'triangle') {
            style = `border-bottom-color: ${item.color}`;
        } else if (shapeClass === 'ring') {
            style = `border: 3px solid ${item.color}; background-color: transparent;`;
        } else if (shapeClass === 'vessel') {
            style = `background-color: ${item.color}`;
        } else if (shapeClass === 'zone') {
            // Zone: semi-transparent fill + dashed border — color data-driven
            const borderCol = item.borderColor ?? item.color;
            style = `background-color: ${item.color}; border: 2px dashed ${borderCol};`;
        } else {
            style = `background-color: ${item.color}`;
        }

        const isTriangle = shapeClass === 'triangle-up' || shapeClass === 'triangle-down';
        if (item.borderColor && !item.gradient && !isTriangle) {
            const borderWidth = item.borderWidth ?? 2;
            style += `; border: ${borderWidth}px solid ${item.borderColor}`;
        } else if (item.borderColor && item.gradient) {
            const borderWidth = item.borderWidth ?? 2;
            style += `; outline: ${borderWidth}px solid ${item.borderColor}`;
        }

        return `
            <div class="item" data-item="${item.id}">
                <div class="shape ${shapeClass}" style="${style}"></div>
                <span>${item.label}</span>
            </div>
        `;
    }

    private bindEvents(): void {
        if (!this.element) return;

        const cards = this.element.querySelectorAll('.legend-card');
        cards.forEach(card => {
            card.addEventListener('mouseenter', () => {
                if (this.onHoverCallback) {
                    const categoryId = card.getAttribute('data-category');
                    this.onHoverCallback(categoryId);
                }
            });
            card.addEventListener('mouseleave', () => {
                if (this.onHoverCallback) {
                    this.onHoverCallback(null);
                }
            });
        });
    }

    update(): void {
        if (this.element) {
            const activeCategories = this.categories.filter(cat => cat.visible !== false);
            if (activeCategories.length === 0) {
                this.element.style.display = 'none';
            } else {
                this.element.style.display = 'flex';
            }
            this.element.innerHTML = this.render();
            this.bindEvents();
        }
    }

    /** Ajoute une catégorie de légende */
    addCategory(category: LegendCategory): void {
        const existing = this.categories.findIndex(c => c.id === category.id);
        if (existing >= 0) {
            const previous = this.categories[existing];
            this.categories[existing] = {
                ...category,
                visible: category.visible ?? previous.visible ?? false,
            };
        } else {
            this.categories.push({ ...category, visible: category.visible ?? false });
        }
        this.update();
    }

    /** Met à jour la visibilité d'un item */
    setItemVisibility(categoryId: string, itemId: string, visible: boolean): void {
        const category = this.categories.find(c => c.id === categoryId);
        if (category) {
            const item = category.items.find(i => i.id === itemId);
            if (item) {
                item.visible = visible;
                this.update();
            }
        }
    }

    /** Cache/Affiche toute une catégorie */
    setCategoryVisibility(categoryId: string, visible: boolean): void {
        let changed = false;

        // Ensure parent maps to correct category or vice versa if needed
        const category = this.categories.find(c => c.id === categoryId);
        if (category && category.visible !== visible) {
            category.visible = visible;
            changed = true;
        }

        if (changed) this.update();
    }

    destroy(): void {
        this.element?.remove();
        this.element = null;
    }
}
