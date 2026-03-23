/**
 * Map.ts — Fallback D3/SVG pour mobile (sans WebGL).
 * Pattern identique worldMonitor : projection Mercator centrée France,
 * SVG avec contours départements + points homogènes colorés par niveau.
 */

import * as d3 from 'd3';
import type { NewsItem } from '../types/index.ts';
import type { GeoPermissibleObjects } from 'd3';

// Couleurs par niveau de menace (identiques à DeckGLMap)
const LEVEL_COLORS: Record<string, string> = {
    critical: '#ff2d55',
    high: '#ff6b35',
    medium: '#ffcc00',
    low: '#34c759',
    info: '#5ac8fa',
};

export class Map {
    private container: HTMLElement;
    private svg: d3.Selection<SVGSVGElement, unknown, null, undefined> | null = null;
    private projection: d3.GeoProjection | null = null;
    private newsItems: NewsItem[] = [];
    private selectedId: string | null = null;
    private onItemClick: ((item: NewsItem) => void) | null = null;
    private onItemHover: ((item: NewsItem | null, x: number, y: number) => void) | null = null;

    constructor(container: HTMLElement) {
        this.container = container;
    }

    async init(): Promise<void> {
        this.container.innerHTML = '';

        const width = this.container.clientWidth || 400;
        const height = this.container.clientHeight || 600;

        // ─── Projection centrée France ───
        this.projection = d3
            .geoMercator()
            .center([2.2, 46.6])
            .scale(Math.min(width, height) * 2.8)
            .translate([width / 2, height / 2]);

        const pathGen = d3.geoPath().projection(this.projection);

        // ─── SVG ───
        this.svg = d3
            .select(this.container)
            .append('svg')
            .attr('width', width)
            .attr('height', height)
            .style('background', '#0a0a0f')
            .style('display', 'block');

        // Groupe pour les départements
        const gMap = this.svg.append('g').attr('class', 'map-geo');

        // Essayer de charger le GeoJSON des départements
        try {
            const resp = await fetch('/data/departements.geojson');
            if (resp.ok) {
                const geojson = await resp.json();
                gMap
                    .selectAll('.dept')
                    .data((geojson as GeoJSON.FeatureCollection).features)
                    .enter()
                    .append('path')
                    .attr('class', 'dept')
                    .attr('d', (d) => pathGen(d as GeoPermissibleObjects) ?? '')
                    .attr('fill', '#1a1a2e')
                    .attr('stroke', '#2a2a3e')
                    .attr('stroke-width', '0.8');
            } else {
                this.drawFrancePlaceholder(gMap, pathGen, width, height);
            }
        } catch {
            this.drawFrancePlaceholder(gMap, pathGen, width, height);
        }

        // Groupe pour les points (news)
        this.svg.append('g').attr('class', 'map-points');

        // Titre mobile
        this.svg
            .append('text')
            .attr('x', 10)
            .attr('y', 20)
            .attr('fill', '#606070')
            .attr('font-size', '10px')
            .attr('font-family', 'monospace')
            .text('France Monitor — vue mobile');

        console.log('[Map] D3/SVG fallback initialized');
    }

    // ─── Public API (identique à DeckGLMap) ───

    updateNews(items: NewsItem[]): void {
        this.newsItems = items.filter((i) => i.lat != null && i.lon != null);
        this.renderPoints();
    }

    selectItem(item: NewsItem | null): void {
        this.selectedId = item?.id ?? null;
        this.renderPoints();
    }

    setOnItemClick(h: (item: NewsItem) => void): void {
        this.onItemClick = h;
    }

    setOnItemHover(h: (item: NewsItem | null, x: number, y: number) => void): void {
        this.onItemHover = h;
    }

    flyTo(_longitude: number, _latitude: number, _zoom?: number): void {
        // No-op on mobile SVG — could animate projection center in future
    }

    destroy(): void {
        if (this.svg) {
            this.svg.remove();
            this.svg = null;
        }
    }

    // ─── Private ───

    private renderPoints(): void {
        if (!this.svg || !this.projection) return;

        const g = this.svg.select<SVGGElement>('.map-points');
        const proj = this.projection;

        // Bind data
        const circles = g
            .selectAll<SVGCircleElement, NewsItem>('circle')
            .data(this.newsItems, (d) => d.id);

        // Enter
        const enter = circles
            .enter()
            .append('circle')
            .attr('r', 0)
            .attr('opacity', 0);

        // Enter + Update
        const all = enter.merge(circles);

        all
            .attr('cx', (d) => {
                const [x] = proj([d.lon!, d.lat!]) ?? [0, 0];
                return x;
            })
            .attr('cy', (d) => {
                const [, y] = proj([d.lon!, d.lat!]) ?? [0, 0];
                return y;
            })
            .attr('r', (d) => {
                const level = d.threat?.level ?? 'info';
                const sizes: Record<string, number> = { critical: 9, high: 7, medium: 6, low: 5 };
                return sizes[level] ?? 5;
            })
            .attr('fill', (d) => LEVEL_COLORS[d.threat?.level ?? 'info'] ?? '#5ac8fa')
            .attr('fill-opacity', 0.8)
            .attr('stroke', (d) => (d.id === this.selectedId ? '#ffffff' : 'rgba(10,10,15,0.85)'))
            .attr('stroke-width', (d) => (d.id === this.selectedId ? 3 : 1.5))
            .attr('opacity', 1)
            .style('cursor', 'pointer')
            .on('click', (_event: MouseEvent, d: NewsItem) => {
                this.selectedId = d.id;
                this.renderPoints();
                this.onItemClick?.(d);
            })
            .on('mouseover', (event: MouseEvent, d: NewsItem) => {
                this.onItemHover?.(d, event.clientX, event.clientY);
            })
            .on('mouseout', () => {
                this.onItemHover?.(null, 0, 0);
            });

        // Pulse animation for critical/high
        all.filter((d) => d.threat?.level === 'critical' || d.threat?.level === 'high')
            .each(function (this: SVGCircleElement) {
                d3.select(this).raise();
            });

        // Exit
        circles.exit().remove();
    }

    /** Placeholder quand GeoJSON absent — rectangle bleu pour la France */
    private drawFrancePlaceholder(
        g: d3.Selection<SVGGElement, unknown, null, undefined>,
        _pathGen: d3.GeoPath,
        width: number,
        height: number,
    ): void {
        g.append('rect')
            .attr('x', width * 0.1)
            .attr('y', height * 0.1)
            .attr('width', width * 0.8)
            .attr('height', height * 0.8)
            .attr('rx', 4)
            .attr('fill', '#12121a')
            .attr('stroke', '#2a2a3e')
            .attr('stroke-width', 1);

        g.append('text')
            .attr('x', width / 2)
            .attr('y', height / 2)
            .attr('text-anchor', 'middle')
            .attr('fill', '#606070')
            .attr('font-size', '12px')
            .text('Carte simplifiée (GeoJSON non chargé)');
    }
}
