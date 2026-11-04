// src/services/prefecture-arretes-pages.ts : pages officielles où paraissent les arrêtés préfectoraux, par département (04/11/2026).
// Lien de consultation dans la fiche Anticipation tant que la bascule « Arrêté préfectoral publié » est surveillée. Seules des pages
// ouvertes à la main sont listées : Préfecture de police (Paris et petite couronne, ordre public), recueils du Loiret, de la Gironde,
// de la Loire-Atlantique et des Bouches-du-Rhône.

export interface PrefectureArretesPage {
  label: string;
  url: string;
}

const PP: PrefectureArretesPage = {
  label: 'Arrêtés de la Préfecture de police',
  url: 'https://www.prefecturedepolice.interieur.gouv.fr/actualites-et-presse/arretes/accueil-arretes',
};

export const PREFECTURE_ARRETES_PAGES: Readonly<Record<string, PrefectureArretesPage>> = {
  '75': PP, '92': PP, '93': PP, '94': PP,
  '45': { label: 'Recueils des actes de la préfecture du Loiret', url: 'https://www.loiret.gouv.fr/Publications/Recueil-des-actes-administratifs/Recueil-des-actes-administratifs-departementaux' },
  '33': { label: 'Recueils des actes de la préfecture de la Gironde', url: 'https://www.gironde.gouv.fr/Publications/Recueil-des-Actes-Administratifs' },
  '44': { label: 'Recueils des actes de la préfecture de la Loire-Atlantique', url: 'https://www.loire-atlantique.gouv.fr/Publications/Recueil-des-actes-administratifs-RAA-en-Loire-Atlantique' },
  '13': { label: 'Recueils des actes de la préfecture des Bouches-du-Rhône', url: 'https://www.bouches-du-rhone.gouv.fr/Publications/RAA-et-Archives' },
};

/** Page des arrêtés du premier département de la zone, ou null si aucune page n'est connue. */
export function arretesPageOf(depts: readonly string[]): PrefectureArretesPage | null {
  for (const d of depts) if (PREFECTURE_ARRETES_PAGES[d]) return PREFECTURE_ARRETES_PAGES[d] ?? null;
  return null;
}
