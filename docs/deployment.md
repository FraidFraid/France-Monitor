# Deployment

France Monitor can run locally with Vite and can be deployed on Vercel using serverless functions under `api/`.

## Local Development

```bash
npm install
cp .env.example .env.local
npm run dev
```

The Vite server runs on `http://localhost:3001`.

For Cloudflare-protected RSS feeds, install and run the Python sidecar:

```bash
npm run scrapling:install
npm run dev:full
```

## Production Deployment

The reference deployment uses Vercel:

```bash
vercel
```

Configure production environment variables in Vercel project settings. Required values for full production behavior are listed in `.env.example`.

## Required Services

| Service | Purpose |
|---------|---------|
| Vercel Functions | API proxy and source normalization |
| Upstash Redis | Optional cross-user cache |
| RTE Open Data | Energy and nuclear data |
| Météo-France | Weather vigilance |

Most optional sources degrade gracefully when credentials are absent.

## Self-hosting Direction

The current codebase is Vercel-first. The planned commons roadmap includes a self-hostable alternative for the API proxy layer so civic-tech teams can deploy the same ingestion model outside Vercel.

Target future options:

- Docker Compose for API proxy + cache
- documented environment variable matrix
- source-by-source enablement flags
- country connector examples
