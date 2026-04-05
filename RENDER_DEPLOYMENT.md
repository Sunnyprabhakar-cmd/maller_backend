# Render Deployment Guide - Maigun Backend

This guide reflects the current project behavior:

- the Electron app prefers hosted sync and hosted send
- the desktop app still keeps local fallback behavior
- Render deploys the backend with Prisma schema generation and `db:push`

## Render Services

The repo already includes [render.yaml](/home/sunny/maigun_from_scratch/render.yaml) with:

```yaml
buildCommand: "cd backend && npm install --include=dev && npm run db:generate && npm run db:push && npm run build"
startCommand: "cd backend && npm start"
```

## 1. Create PostgreSQL On Render

1. Sign in to Render.
2. Create a new PostgreSQL service.
3. Use a name such as `maigun-postgres`.
4. Copy the connection string after provisioning finishes.

## 2. Create The Web Service

1. Create a new Web Service from your GitHub repo.
2. Use the settings from [render.yaml](/home/sunny/maigun_from_scratch/render.yaml), or configure them manually:

```text
Runtime: Node
Build Command: cd backend && npm install --include=dev && npm run db:generate && npm run db:push && npm run build
Start Command: cd backend && npm start
```

3. Set these environment variables:

```text
NODE_ENV=production
PORT=3000
DATABASE_URL=<render postgres connection string>
MAILGUN_API_KEY=<mailgun api key>
MAILGUN_WEBHOOK_SIGNING_KEY=<mailgun signing key>
MAILGUN_DOMAIN=<your mailgun domain>
API_TOKEN=<strong bootstrap token>
WEBHOOK_URL=https://your-service.onrender.com/api/webhooks
ELECTRON_ORIGIN=*
```

Auth rules for Render production:

- there is no fallback `dev-token-12345` acceptance in production
- authentication works through DB-issued API tokens or an explicit bootstrap token set with `API_TOKEN` or `API_AUTH_TOKEN`
- keep the bootstrap token only if you intentionally want break-glass access

## 3. Configure Mailgun Webhooks

Point Mailgun to:

```text
https://your-service.onrender.com/api/webhooks
```

The backend also exposes:

- `GET /api/webhooks/track/open`
- `GET /api/webhooks/track/click`

for open and click tracking pixels/redirects.

## 4. Configure The Electron App

Create `.env.local` in the repo root:

```bash
REACT_APP_API_URL=https://your-service.onrender.com/api
REACT_APP_API_TOKEN=<api token>
REACT_APP_WS_URL=https://your-service.onrender.com
```

Notes:

- `API_TOKEN` can be your explicit bootstrap token initially
- the backend also supports generated hashed API tokens
- once you generate a DB token, prefer `REACT_APP_API_TOKEN=<db token>` for the desktop app
- campaign create/save/import/send now try hosted sync first and fall back locally if needed

## 5. Validate The Deployment

### Health
```bash
curl https://your-service.onrender.com/health
```

### Backend Tests
```bash
cd backend
npm test
```

### Desktop Build
```bash
npm run build
```

### End-To-End Smoke Test

1. Start the Electron app.
2. Create a campaign.
3. Save it.
4. Import recipients from CSV.
5. Send a test email.
6. Send the campaign.
7. Confirm events appear in the app.

## Current Hosted-First Behavior

When the backend is reachable:

- campaign create/save sync to hosted backend
- CSV recipients sync to hosted backend
- test sends go through hosted backend first
- full sends go through hosted backend first

If hosted sync/send fails:

- local campaign state is preserved
- local fallback send path still works
- the UI shows whether the action succeeded locally or via hosted backend

## Troubleshooting

### Prisma schema mismatch on Render
Make sure the build command includes:

```bash
npm install --include=dev && npm run db:generate && npm run db:push
```

Render builds this service with `NODE_ENV=production`, so `--include=dev` is important here. Without it, build-time tools like `prisma` and `tsc` may be missing and the deploy can fail with exit status `127`.

### Mailgun webhooks rejected
Check:

- `MAILGUN_WEBHOOK_SIGNING_KEY`
- `WEBHOOK_URL`
- Mailgun dashboard webhook URL

### Electron cannot reach backend
Check:

- `REACT_APP_API_URL`
- `REACT_APP_API_TOKEN`
- `REACT_APP_WS_URL`
- `ELECTRON_ORIGIN`

### Hosted sync fails but local app still works
That is expected fallback behavior. The app is designed to preserve local operation when the hosted backend is unavailable.

### Backend starts with a fallback auth warning
That warning is expected only in non-production when:

- `NODE_ENV` is not `production`
- no explicit `API_TOKEN` or `API_AUTH_TOKEN` is configured

On Render production, you should not see that warning.

## Recommended Next Checks

- Rotate bootstrap tokens after initial deployment
- Restrict `ELECTRON_ORIGIN` if you know your final client origin policy
- Monitor Render logs during first send and first webhook delivery
