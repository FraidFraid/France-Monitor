import type { EolienLayerFeatureProperties, EolienLayerGeoJSON, EolienLive, EolienParkSummary } from './types.ts';

const EOLIEN_KIND_COLORS = {
  onshore: '#38BDF8',
  offshore: '#14B8A6',
  unknown: '#7DD3FC',
} as const;

const EOLIEN_INACTIVE_COLOR = '#EF4444'; // rouge si défaillant / inactif

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function fmtNumber(value: number, digits = 1): string {
  return value.toLocaleString('fr-FR', {
    minimumFractionDigits: value < 10 ? digits : 0,
    maximumFractionDigits: value < 10 ? digits : 0,
  });
}

function kindLabel(kind: EolienParkSummary['kind']): string {
  switch (kind) {
    case 'offshore':
      return 'Parc en mer';
    case 'onshore':
      return 'Éolienne terrestre';
    default:
      return 'Parc éolien';
  }
}

function statusLabel(status: EolienParkSummary['status']): string {
  switch (status) {
    case 'operating':
      return 'En service';
    case 'construction':
      return 'En construction';
    case 'authorized':
      return 'Autorisé';
    case 'project':
      return 'Projet';
    case 'inactive':
      return 'Inactif';
    default:
      return 'Statut non documenté';
  }
}

export function buildEolienLayerFeatureCollection(
  live: EolienLive | null,
  parks: EolienParkSummary[],
): EolienLayerGeoJSON {
  void live; // live no longer drives ring color — status drives point color

  return {
    type: 'FeatureCollection',
    features: parks.map((park) => {
      const capacityMw = park.capacityMw ?? 0;
      const estimatedProductionMw = park.estimatedProductionMw ?? 0;
      const radius = park.sourceType === 'turbine'
        ? clamp(2.4 + capacityMw * 0.4, 2.8, 5.4)
        : park.kind === 'offshore'
          ? clamp(5 + capacityMw * 0.018, 5.5, 18)
          : clamp(2.8 + Math.sqrt(Math.max(capacityMw, 0)) * 0.18, 3.2, 6.2);
      // Rouge si inactif/défaillant, sinon couleur par type
      const color = park.status === 'inactive'
        ? EOLIEN_INACTIVE_COLOR
        : EOLIEN_KIND_COLORS[park.kind];
      const opacity = park.status === 'operating'
        ? (park.sourceType === 'turbine' ? 0.88 : (park.kind === 'offshore' ? 0.94 : 0.46))
        : park.status === 'construction'
          ? (park.sourceType === 'park' && park.kind !== 'offshore' ? 0.42 : 0.86)
          : (park.sourceType === 'park' && park.kind !== 'offshore' ? 0.36 : 0.74);

      return {
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: park.coordinates,
        },
        properties: {
          id: park.id,
          name: park.name,
          status: park.status,
          kind: park.kind,
          capacityMw,
          turbineCount: park.turbineCount,
          commissioningYear: park.commissioningYear,
          operator: park.operator,
          commune: park.commune,
          department: park.department,
          region: park.region,
          sourceType: park.sourceType,
          estimatedProductionMw,
          radius,
          color,
          ringColor: 'rgba(0,0,0,0)',  // ring désactivé — le statut est porté par la couleur du point
          glowColor: `${color}55`,
          opacity,
        } satisfies EolienLayerFeatureProperties,
      };
    }),
  };
}

export function buildEolienPopupHtml(properties: Partial<EolienLayerFeatureProperties>, live: EolienLive | null = null): string {
  const capacityMw = typeof properties.capacityMw === 'number' ? properties.capacityMw : 0;
  const estimatedProductionMw = typeof properties.estimatedProductionMw === 'number' ? properties.estimatedProductionMw : 0;
  const factorCharge = capacityMw > 0 ? clamp(estimatedProductionMw / capacityMw, 0, 1) : live?.facteur_charge ?? 0;

  return `
    <div style="color:#e8eef5;font-family:sans-serif;min-width:235px;">
      <h4 style="margin:0 0 4px;font-weight:700;font-size:14px;color:#fff;">${properties.name ?? 'Parc éolien'}</h4>
      <div style="font-size:11px;color:${properties.color ?? '#7DD3FC'};margin-bottom:10px;">
        ${kindLabel((properties.kind as EolienParkSummary['kind']) ?? 'unknown')} · ${statusLabel((properties.status as EolienParkSummary['status']) ?? 'unknown')}
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:13px;">
        <span style="color:#94a3b8">Puissance installée :</span>
        <span style="font-weight:700;">${capacityMw > 0 ? `${fmtNumber(capacityMw)} MW` : 'n/d'}</span>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:13px;">
        <span style="color:#94a3b8">Prod. estimée :</span>
        <span style="font-weight:700;color:#38BDF8;">${estimatedProductionMw > 0 ? `${fmtNumber(estimatedProductionMw)} MW` : 'n/d'}</span>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:13px;">
        <span style="color:#94a3b8">Facteur de charge :</span>
        <span style="font-weight:600;">${Math.round(factorCharge * 100)}%</span>
      </div>
      ${properties.turbineCount ? `
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:13px;">
          <span style="color:#94a3b8">Éoliennes :</span>
          <span style="font-weight:600;">${properties.turbineCount}</span>
        </div>
      ` : ''}
      <div style="margin-top:8px;font-size:11px;color:#cbd5e1;">
        ${(properties.region ?? '').toString()}${properties.commune ? ` · ${properties.commune}` : ''}
      </div>
      ${properties.operator ? `<div style="margin-top:4px;font-size:11px;color:#94a3b8;">Exploitant : ${properties.operator}</div>` : ''}
      <div style="margin-top:8px;font-size:10px;color:#6b7280;border-top:1px solid rgba(255,255,255,0.06);padding-top:6px;">
        Source : Géorisques / référentiel éolien · live ${live ? `${live.production_gw.toFixed(1)} GW` : 'n/d'}
      </div>
    </div>
  `;
}
