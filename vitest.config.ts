import { defineConfig } from 'vitest/config';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Configuration Vitest — alignée sur tsconfig.json (alias @/* → ./src/*).
// Les tests s'exécutent en environnement Node (aucun DOM requis pour la logique métier).
export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    // Tests co-localisés dans src/ + tests d'intégration des modules .js (api/, src/utils/) dans tests/.
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    // Le build tsc ne doit jamais voir ce fichier ni le dossier tests/ (voir tsconfig include).
  },
});
