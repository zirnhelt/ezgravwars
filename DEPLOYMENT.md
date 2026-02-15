# Deployment Guide

This project uses a **split deployment** architecture:
- **Frontend**: GitHub Pages (static React app)
- **Backend**: Cloudflare Workers (Durable Objects)

## Prerequisites

1. GitHub account with Pages enabled
2. Cloudflare account (free tier works)
3. Wrangler CLI installed: `npm install -g wrangler`

## Step 1: Deploy Cloudflare Worker (Backend)

### 1.1 Login to Cloudflare
```bash
wrangler login
```

### 1.2 Update wrangler.toml

Edit `wrangler.toml` and update:
```toml
name = "gravity-wars-api"  # Your worker name
```

### 1.3 Deploy the Worker
```bash
npm run worker:deploy
```

This will output a URL like: `https://gravity-wars-api.YOUR_SUBDOMAIN.workers.dev`

**Save this URL!** You'll need it for the frontend.

### 1.4 (Optional) Add Custom Domain

In Cloudflare Dashboard:
1. Go to Workers & Pages → gravity-wars-api
2. Click "Triggers" → "Add Custom Domain"
3. Add your custom domain (e.g., `api.gravitywars.com`)

## Step 2: Configure GitHub Pages (Frontend)

### 2.1 Enable GitHub Pages

1. Go to your GitHub repository
2. Settings → Pages
3. Source: **GitHub Actions**

### 2.2 Add Worker URL as Secret

1. Go to Settings → Secrets and variables → Actions
2. Click "New repository secret"
3. Name: `VITE_API_URL`
4. Value: Your worker URL (e.g., `https://gravity-wars-api.YOUR_SUBDOMAIN.workers.dev`)

### 2.3 Update config.js

Edit `src/config.js` and replace the placeholder:
```javascript
export const API_URL = import.meta.env.VITE_API_URL ||
  (import.meta.env.DEV ? 'http://localhost:8787' : 'https://gravity-wars-api.YOUR_SUBDOMAIN.workers.dev');
```

### 2.4 Push to Main Branch

```bash
git add .
git commit -m "Configure production deployment"
git push origin main
```

GitHub Actions will automatically:
1. Install dependencies
2. Build the React app
3. Deploy to GitHub Pages

## Step 3: Access Your Game

Your game will be available at:
```
https://YOUR_USERNAME.github.io/ezgravwars/
```

## Local Development

Both servers must run simultaneously:

```bash
# Terminal 1: Frontend dev server
npm run dev

# Terminal 2: Worker dev server (with local Durable Objects)
npm run worker:dev
```

Then open `http://localhost:5173`

## Troubleshooting

### CORS Issues
If you get CORS errors, the worker needs CORS headers. They're already added in `worker/index.js`.

### WebSocket Connection Failed
1. Check that `VITE_API_URL` secret is set correctly
2. Verify the worker URL is accessible
3. Make sure you're using `https://` not `http://`

### GitHub Pages 404
1. Wait 2-3 minutes after deployment
2. Check Actions tab for build errors
3. Verify Pages is enabled in Settings

### Worker Not Updating
```bash
# Clear cache and redeploy
wrangler deploy --no-bundle
```

## Cost Estimate

- **GitHub Pages**: Free
- **Cloudflare Workers**: Free tier includes:
  - 100,000 requests/day
  - 10ms CPU time per request
  - Sufficient for ~1000 concurrent games

## Custom Domain (Optional)

### Frontend
1. In GitHub repo settings → Pages
2. Add custom domain (e.g., `gravitywars.com`)
3. Configure DNS with CNAME to `YOUR_USERNAME.github.io`

### Backend
1. In Cloudflare Workers dashboard
2. Triggers → Custom Domain
3. Add subdomain (e.g., `api.gravitywars.com`)
