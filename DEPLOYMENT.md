# Deployment Guide

This app uses **Cloudflare Pages** (frontend) + **Cloudflare Workers** (backend with Durable Objects).

## Initial Setup

### 1. Get Cloudflare Credentials

You'll need:
- **Cloudflare API Token**: https://dash.cloudflare.com/profile/api-tokens
  - Click "Create Token"
  - Use "Edit Cloudflare Workers" template
  - Or create custom with permissions: `Workers Scripts:Edit`, `Workers Durable Objects:Edit`

- **Cloudflare Account ID**: https://dash.cloudflare.com
  - Select your domain/account
  - Find "Account ID" on the right sidebar

### 2. Add GitHub Secrets

Go to: `https://github.com/YOUR_USERNAME/ezgravwars/settings/secrets/actions`

Add these secrets:
- `CLOUDFLARE_API_TOKEN` - Your Cloudflare API token
- `CLOUDFLARE_ACCOUNT_ID` - Your Cloudflare account ID
- `VITE_API_URL` - Will be set after first Worker deployment (Step 4)

### 3. Deploy Worker (First Time)

From your local machine:

```bash
# Log in to Cloudflare
npx wrangler login

# Deploy the Worker
npm run worker:deploy
```

You'll see output like:
```
Published gravity-wars-worker
  https://gravity-wars-worker.YOUR-SUBDOMAIN.workers.dev
```

**Copy this URL!** ☝️

### 4. Set VITE_API_URL Secret

Go to: `https://github.com/YOUR_USERNAME/ezgravwars/settings/secrets/actions`

Add or update:
- Name: `VITE_API_URL`
- Value: The Worker URL from Step 3 (e.g., `https://gravity-wars-worker.YOUR-SUBDOMAIN.workers.dev`)

### 5. Trigger Cloudflare Pages Redeploy

After setting the `VITE_API_URL` secret:

1. Go to Cloudflare Dashboard → Pages → ezgravwars
2. Click "Deployments" tab
3. Click "Retry deployment" on the latest deployment

OR push a commit to `main` branch to trigger auto-deploy.

### 6. Turn notifications (optional, one-time)

Play-by-mail "your move" notifications use Web Push, which needs a VAPID key
pair on the worker. Without it everything else works; the bell button just
hides and players use Nudge.

```bash
npm run vapid          # prints a key pair and the exact commands below
echo "<public key>"  | npx wrangler secret put VAPID_PUBLIC_KEY
echo "<private key>" | npx wrangler secret put VAPID_PRIVATE_KEY
echo "mailto:you@example.com" | npx wrangler secret put VAPID_SUBJECT
```

- Keep the private key secret. If you ever rotate the keys, existing
  subscriptions stop working until players tap the bell again (the client
  re-subscribes automatically when it notices the key changed).
- For local dev, put the same three `KEY=value` lines in `.dev.vars`
  (gitignored).
- iPhone/iPad: Safari only delivers web push to sites added to the Home
  Screen (iOS 16.4+). The app ships a manifest and icons so "Add to Home
  Screen" works; the bell explains this when tapped in plain Safari.

---

## Automatic Deployments

Once set up, deployments are automatic:

- **Worker**: Auto-deploys on every push to `main` (if `worker/` files changed)
- **Pages**: Auto-deploys on every push to `main` (configured in Cloudflare)

---

## Local Development

```bash
# Terminal 1: Run Worker locally
npm run worker:dev

# Terminal 2: Run frontend
npm run dev
```

Frontend will use `http://localhost:8787` for the Worker in dev mode.

---

## Testing the Deployment

1. Open your Cloudflare Pages URL (e.g., `https://ezgravwars.pages.dev`)
2. Click "CREATE GAME"
3. Copy the room link
4. Open in another browser/tab
5. Both players should see the game start! 🎮

---

## Troubleshooting

### "Failed to create room" error
- Check browser console for the actual error
- Verify `VITE_API_URL` is set correctly in GitHub Secrets
- Verify Worker is deployed and accessible

### Pages shows waiting forever
- Check if the Worker URL in config.js is correct
- Open browser DevTools → Network tab
- Look for failed requests to the Worker

### CORS errors
- Make sure Worker code has CORS headers (already included in `worker/index.js`)
- If you set the `ALLOWED_ORIGIN` secret, it must exactly match the site's origin
  (e.g. `https://ezgravwars.pages.dev`, no trailing slash). It applies to
  WebSocket upgrades too, so a mismatch shows up as "Reconnecting…" forever.

### Shots resolve differently on the two screens
- The worker referees shots with the shared modules in `src/game/`. If the
  frontend and worker were deployed from different commits, redeploy both.
