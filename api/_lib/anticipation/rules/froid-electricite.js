// api/_lib/anticipation/rules/froid-electricite.js : règle 10 (v1, 13/11/2026), vigilance grand froid orange/rouge × tension électrique
// (Écowatt orange ou rouge, ou panne). Le froid porte la pointe de consommation : c'est le cas pour lequel Écowatt a été créé.
// Logique dans thermal-electricite.js (partagée avec la canicule). Jamais déclenchée avant sa mise en service (pas de grand froid
// depuis le 04/11/2026) : vérifiée par tests seulement.
import { makeThermalRule } from './thermal-electricite.js';

export const RULE_ID = 'froid-electricite';

const rule = makeThermalRule({
  id: RULE_ID,
  phenomenon: 'grand_froid',
  label: 'grand froid',
  title: "Grand froid et tension sur l'électricité",
  arrivalTest: "Un signal Écowatt rouge est publié, ou une panne d'électricité de niveau orange ou rouge est relevée dans le département, pendant la fenêtre de la vigilance grand froid.",
  hypothesis: "Hypothèse : coupures ou délestages pendant la pointe de froid, avec un risque pour les personnes fragiles, sans abri ou chauffées à l'électricité",
  healthUnknown: "Places d'hébergement d'urgence ouvertes : aucune donnée publique en continu",
  disconfirmers: ['Vigilance grand froid abaissée ou levée par Météo-France', 'Écowatt repassé au vert'],
  verifyHealth: (name) => `Ouverture du plan grand froid et places d'hébergement auprès de la préfecture pour le ${name}`,
});

export default rule;
