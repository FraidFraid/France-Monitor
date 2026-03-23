# Scrapling RSS Proxy

Micro-service Python qui contourne Cloudflare pour fetcher les flux RSS protégés.

## Flux ciblés

| Source | URL | Raison |
|--------|-----|--------|
| Les Échos | `services.lesechos.fr/rss/*` | Cloudflare 403 |
| La Voix du Nord | `www.lavoixdunord.fr/rss` | Cloudflare 403 |
| Paris Normandie | `www.paris-normandie.fr/rss` | Cloudflare 403 |

## Déploiement

### Option 1: Docker local

```bash
cd services/scrapling-proxy
docker build -t scrapling-proxy .
docker run -p 8080:8080 scrapling-proxy
```

### Option 2: Google Cloud Run

```bash
# Build et push
gcloud builds submit --tag gcr.io/PROJECT_ID/scrapling-proxy

# Deploy
gcloud run deploy scrapling-proxy \
  --image gcr.io/PROJECT_ID/scrapling-proxy \
  --platform managed \
  --region europe-west1 \
  --allow-unauthenticated \
  --memory 512Mi \
  --timeout 30s
```

### Option 3: AWS Lambda (via Container)

```bash
# ECR
aws ecr create-repository --repository-name scrapling-proxy
docker tag scrapling-proxy:latest AWS_ACCOUNT.dkr.ecr.REGION.amazonaws.com/scrapling-proxy
docker push AWS_ACCOUNT.dkr.ecr.REGION.amazonaws.com/scrapling-proxy

# Lambda function avec container image
```

## Usage

```bash
# Fetch Les Échos
curl "http://localhost:8080/rss?url=https://services.lesechos.fr/rss/les-echos-une.xml"

# Health check
curl "http://localhost:8080/health"
```

## Intégration FranceMonitor

Dans `src/services/rss.ts`, ajouter le fallback :

```typescript
const SCRAPLING_PROXY = process.env.SCRAPLING_PROXY_URL;

async function fetchWithScrapling(url: string): Promise<string> {
    const proxyUrl = `${SCRAPLING_PROXY}/rss?url=${encodeURIComponent(url)}`;
    const resp = await fetch(proxyUrl);
    if (!resp.ok) throw new Error(`Scrapling proxy error: ${resp.status}`);
    return resp.text();
}
```

## Sécurité

- **Whitelist** : Seuls les domaines autorisés peuvent être fetchés
- **Cache** : 5 minutes pour éviter l'abus
- **Rate limit** : Ajouter un rate limiter en production (nginx, Cloud Armor, etc.)
