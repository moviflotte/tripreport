# Trip Report - Cloudflare Pages

A vehicle trip reporting application built with Cloudflare Pages Functions.

## Structure

```
/
├── functions/              # Cloudflare Pages Functions
│   ├── _lib/              # Shared utilities
│   │   └── utils.js       # Helper functions
│   ├── api/
│   │   └── [[path]].js    # API proxy (catch-all)
│   └── export/
│       └── vehicles-xlsx.js # Excel export
├── public/                # Static files
│   └── index.html
└── wrangler.toml         # Cloudflare configuration
```

## API Endpoints

- `ANY /api/*` - Proxies requests to PinMe API
- `GET /export/vehicles-xlsx` - Generates Excel report
  - Query params: `fromDate`, `toDate`, `fromTime`, `toTime`, or `date` (YYYY-MM-DD)

## Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy environment variables:
   ```bash
   # Edit .dev.vars with your credentials
   PINME_BASE=https://api.pinme.io/api
   ```

3. Run locally:
   ```bash
   npm run dev
   ```

4. Open http://localhost:8788

## Deployment

### First Time Setup

1. Login to Cloudflare:
   ```bash
   npx wrangler login
   ```

2. Create a Pages project:
   ```bash
   npx wrangler pages project create trip-report
   ```

3. Set environment variables in Cloudflare dashboard:
   - Go to your Pages project > Settings > Environment variables
   - Add: `PINME_BASE`, `PINME_USER`, `PINME_PASS`

### Deploy

```bash
npm run deploy
```

Or connect your GitHub repository in the Cloudflare dashboard for automatic deployments.

## Environment Variables

Required environment variables:
- `PINME_BASE` - PinMe API base URL (default: https://api.pinme.io/api)

For local development, set these in `.dev.vars`.
For production, set them in the Cloudflare dashboard.
