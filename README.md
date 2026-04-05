# Maigun Campaign Studio

Maigun Campaign Studio is an Electron desktop app for building branded email campaigns, importing CSV recipients, previewing output, and sending through Mailgun. It now supports a hosted backend on Render while still preserving a local desktop fallback flow.

## Architecture

### Current App Behavior
```text
Electron App
  ├─ Local storage + local queue/sending fallback
  └─ Hosted-first sync/send path → Render backend → Mailgun → Webhooks → Render backend
```

### What Syncs
- Campaign create/save tries to sync to the hosted backend first
- CSV recipient imports sync to the hosted backend after local import
- Test sends and full sends prefer the hosted backend, then fall back to local Electron sending if hosted sync/send fails
- Webhook/event data can be merged from both local and hosted sources in the UI

## Features

- Campaign editing with subject, HTML, text, footer, sender, newsletter, CTA, and social fields
- CSV import with validation and custom-field mapping
- Local draft persistence
- Desktop/mobile email preview
- Mailgun test send and campaign send
- Hosted backend with PostgreSQL, Prisma, Socket.io, and Mailgun webhooks
- Local fallback sending queue with retry/throttle behavior
- Token-based API auth
- Shared email render/layout helpers used by both local and hosted send paths
- Backend tests for auth, shared email helpers, and campaign API routes

## Tech Stack

### Desktop App
- Electron
- React
- Vite
- TypeScript

### Hosted Backend
- Express
- Prisma
- PostgreSQL
- Socket.io
- Mailgun

## Local Development

### 1. Install dependencies
```bash
npm install
cd backend && npm install
cd ..
```

### 2. Configure backend
```bash
cd backend
cp .env.example .env
```

Update `.env` with your Mailgun and database settings, then:

```bash
npm run db:generate
npm run db:push
```

### 3. Start backend
```bash
cd backend
npm run dev
```

### 4. Start Electron app
```bash
npm run dev
```

## Environment Variables

### Backend
```bash
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/maigun_dev
MAILGUN_API_KEY=your-mailgun-key
MAILGUN_WEBHOOK_SIGNING_KEY=your-mailgun-webhook-signing-key
MAILGUN_DOMAIN=your-domain.mailgun.org
API_TOKEN=your-bootstrap-token
WEBHOOK_URL=http://localhost:3000/api/webhooks
ELECTRON_ORIGIN=http://localhost:5173
```

Auth behavior:

- In `production`, the backend accepts only DB-issued API tokens or an explicitly configured bootstrap token via `API_TOKEN` or `API_AUTH_TOKEN`
- In non-production, if no explicit bootstrap token is configured, the backend allows the local fallback token for dev convenience
- When that non-production fallback is active, the backend logs a startup warning

### Frontend
Create `.env.local` in the repo root if you want the Electron renderer to target a hosted backend:

```bash
REACT_APP_API_URL=https://your-service.onrender.com/api
REACT_APP_API_TOKEN=your-api-token
REACT_APP_WS_URL=https://your-service.onrender.com
```

## Render Deployment

Use [RENDER_DEPLOYMENT.md](/home/sunny/maigun_from_scratch/RENDER_DEPLOYMENT.md) for the step-by-step guide.

The current Render build command from [render.yaml](/home/sunny/maigun_from_scratch/render.yaml) is:

```bash
cd backend && npm install --include=dev && npm run db:generate && npm run db:push && npm run build
```

That matters because the backend schema now evolves alongside the richer hosted campaign model.

## API Overview

### Campaigns
- `POST /api/campaigns`
- `PUT /api/campaigns/:id`
- `GET /api/campaigns`
- `GET /api/campaigns/:id`
- `POST /api/campaigns/:id/recipients`
- `POST /api/campaigns/:id/send-test`
- `POST /api/campaigns/:id/send`
- `GET /api/campaigns/:id/events`

### Webhooks
- `POST /api/webhooks`
- `GET /api/webhooks/track/open`
- `GET /api/webhooks/track/click`

### Tokens
- `POST /api/tokens/generate`
- `GET /api/tokens`
- `DELETE /api/tokens/:id`

## Test And Build Commands

### Root
```bash
npm run build
npm run test:ui
npm run test:backend
```

### Backend
```bash
cd backend
npm run build
npm test
npm run db:generate
npm run db:push
```

## Project Structure

```text
src/
  main/        Electron main process, local queue, local Mailgun fallback
  preload/     Electron bridge
  renderer/    React UI
  shared/      Shared assets

backend/
  prisma/      Prisma schema
  src/api/     Express route handlers
  src/middleware/
  src/services/
  src/shared/  Shared email render helpers used by backend and desktop app
```

## Notes

- In production, there is no fallback token acceptance; use DB tokens or an explicit bootstrap token
- In non-production, fallback auth is allowed only when no explicit bootstrap token is configured, and startup logs warn when it is active
- Generated API tokens are stored hashed and validated against the backend token table
- Local webhook signature verification now checks the configured webhook secret instead of accepting every payload
- `ELECTRON_ORIGIN="*"` is supported in the backend CORS logic for hosted deployments
- Hosted send is preferred, but local send remains available as fallback so the app still works when the backend is unavailable
