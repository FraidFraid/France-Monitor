// api/_lib/anticipation/rules/chaleur-sante.js : règle 3 (v1), vigilance canicule orange/rouge × tension électrique (Écowatt ou panne).
// Logique dans thermal-electricite.js (partagée avec le grand froid). Les passages aux urgences (hebdomadaires) ne sont pas une entrée.
import { makeThermalRule } from './thermal-electricite.js';

export const RULE_ID = 'chaleur-sante';

const rule = makeThermalRule({
  id: RULE_ID,
  phenomenon: 'canicule',
  label: 'canicule',
  title: "Canicule et tension sur l'électricité",
  arrivalTest: "Un signal Écowatt rouge est publié, ou une panne d'électricité de niveau orange ou rouge est relevée dans le département, pendant la fenêtre de la vigilance canicule.",
  hypothesis: "Hypothèse : tension sur l'électricité pendant la chaleur, avec un risque pour les personnes fragiles",
  healthUnknown: 'Passages aux urgences de la semaine non encore publiés',
  disconfirmers: ['Vigilance canicule abaissée ou levée par Météo-France', 'Écowatt repassé au vert'],
  verifyHealth: (name) => `Passages aux urgences auprès de l'ARS pour le ${name}`,
});

export default rule;
