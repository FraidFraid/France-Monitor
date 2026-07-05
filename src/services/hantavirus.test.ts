import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { parseDgsUrgentTextToEvent } from './hantavirus.ts';

describe('hantavirus · parseDgsUrgentTextToEvent', () => {
  it('détecte l’alerte Andes du navire MV Hondius', () => {
    const text = 'Alerte hantavirus Andes liée au navire MV Hondius. Prise en charge Bichat.';
    const event = parseDgsUrgentTextToEvent(text, 'https://sante.gouv.fr/test.pdf');
    assert.ok(event);
    assert.equal(event.souche, 'Andes');
    assert.equal(event.territoire_code, 'SHIP-MV-HONDIUS');
    assert.equal(event.severite, 'crise');
    assert.equal(event.kind, 'ship_cluster');
  });

  it('ignore une alerte DGS non hantavirus', () => {
    const event = parseDgsUrgentTextToEvent('Alerte grippe saisonnière', 'https://sante.gouv.fr/x.pdf');
    assert.equal(event, null);
  });
});
