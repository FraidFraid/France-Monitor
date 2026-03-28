import type { Plugin } from 'vite';
import { handleMinistersRequest } from '../../api/_shared/ministers.js';

export function ministersProxyPlugin(): Plugin {
  return {
    name: 'ministers-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (await handleMinistersRequest(req, res)) return;
        next();
      });
    },
  };
}
