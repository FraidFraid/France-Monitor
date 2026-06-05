export function normalizeOperationalState(value) {
    return String(value ?? '').trim().toLowerCase();
}

export function getDatacenterStatusMeta(status) {
    switch (status) {
        case 'operational': return { color: '#60A5FA', popupColor: '#38BDF8', label: 'Opérationnel' };
        case 'degraded': return { color: '#3B82F6', popupColor: '#0EA5E9', label: 'Dégradé' };
        case 'partial': return { color: '#2563EB', popupColor: '#0284C7', label: 'Partiel' };
        case 'outage': return { color: '#1D4ED8', popupColor: '#1D4ED8', label: 'En panne' };
        case 'maintenance': return { color: '#93C5FD', popupColor: '#2563EB', label: 'Maintenance' };
        default: return { color: '#60A5FA', popupColor: '#94A3B8', label: 'Inconnu' };
    }
}

export function getDatacenterVisualMeta(input = {}) {
    const operationalState = normalizeOperationalState(input.operationalState);
    if (operationalState === 'en construction') {
        return {
            color: '#F97316',
            popupColor: '#F97316',
            label: 'En construction',
            kind: 'construction',
        };
    }
    if (operationalState === 'en projet') {
        return {
            color: '#EAB308',
            popupColor: '#EAB308',
            label: 'En projet',
            kind: 'project',
        };
    }

    return {
        ...getDatacenterStatusMeta(input.status),
        kind: 'status',
    };
}
