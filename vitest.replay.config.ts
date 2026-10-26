import { defineConfig } from 'vitest/config';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Rejeu de l'indice (scripts/score-replay) : lancé à la demande par `npm run replay:score`, jamais dans la suite de tests ni en CI.
// Même alias que vitest.config.ts ; seule la liste des fichiers change.
export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['scripts/score-replay/**/*.replay.ts'],
  },
});
