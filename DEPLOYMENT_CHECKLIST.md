# Maigun Hosted Backend - Implementation Checklist

## Phase 1: Backend Setup ✅ (Completed)

### Backend Structure
- ✅ Express.js server with Socket.io
- ✅ PostgreSQL + Prisma ORM
- ✅ RESTful API endpoints
- ✅ Mailgun mailer service
- ✅ Email renderer service  
- ✅ Webhook receiver with signature verification
- ✅ Token-based API authentication

### Files Created
```
backend/
├── package.json           # Backend dependencies
├── tsconfig.json          # TypeScript config
├── .env.example           # Configuration template
├── .gitignore             # Git exclusions
├── prisma/
│   └── schema.prisma      # Database models (Campaign, Recipient, Event, Token)
└── src/
    ├── index.ts           # Express + Socket.io server
    ├── middleware/
    │   └── auth.ts        # Token authentication
    ├── api/
    │   ├── campaigns.ts    # Campaign CRUD + send
    │   ├── webhooks.ts     # Mailgun webhook receiver
    │   └── tokens.ts       # API token management
    └── services/
        ├── mailer.ts      # Mailgun integration
        └── render.ts      # Email HTML building
```

## Phase 2: Electron App Integration ✅ (Completed)

### API Client
- ✅ `src/renderer/src/api-client.ts` - HTTP API wrapper
- ✅ `src/renderer/src/ws-client.ts` - WebSocket realtime client

### Features Enabled
- Create/list/get campaigns
- Add recipients from CSV
- Send test emails
- Send to all recipients
- Realtime webhook event updates
- API token management

## Phase 3: Deployment Configuration ✅ (Completed)

### Files Created
- ✅ `render.yaml` - Render.com deployment config
- ✅ `SETUP_RENDER.md` - Step-by-step deployment guide
- ✅ `.github/workflows/deploy.yml` - CI/CD pipeline
- ✅ Updated `README.md` with new architecture
- ✅ Updated `package.json` with setup scripts

## Phase 4: Manual Steps (For User)

### Step 1: Prepare GitHub Repository
```bash
cd /home/sunny/maigun_from_scratch

# Initialize git
git init
git add .
git commit -m "Initial commit: Maigun with hosted backend"

# Add remote and push
git remote add origin https://github.com/YOUR_USERNAME/maigun.git
git branch -M main
git push -u origin main
```

### Step 2: Create Render Account
- [ ] Go to render.com
- [ ] Sign up with GitHub
- [ ] Authorize Render to access your repositories

### Step 3: Deploy PostgreSQL Database
- [ ] Dashboard → New+ → PostgreSQL
- [ ] Name: `maigun-postgres`
- [ ] Plan: Free
- [ ] Copy Internal Database URL

### Step 4: Deploy Backend Service
- [ ] Dashboard → New+ → Web Service
- [ ] Select your GitHub repository
- [ ] Configure:
  - Name: `maigun-backend`
  - Runtime: Node
  - Build: `cd backend && npm install && npm run build && npm run db:push`
  - Start: `cd backend && npm start`
  - Plan: Free
- [ ] Add Environment Variables:
  - `NODE_ENV` = `production`
  - `DATABASE_URL` = (from PostgreSQL service)
  - `MAILGUN_API_KEY` = (your Mailgun API key)
  - `MAILGUN_DOMAIN` = (your Mailgun domain)
  - `API_TOKEN` = (generate: `crypto.randomBytes(32).toString('hex')`)
  - `WEBHOOK_URL` = (note service URL after deploy)
  - `ELECTRON_ORIGIN` = `*`

### Step 5: Configure Mailgun Webhooks
- [ ] Mailgun Dashboard → Sending → Webhooks
- [ ] Add Webhook:
  - Event: All events
  - URL: `https://maigun-backend-xxxxx.onrender.com/api/webhooks`

### Step 6: Update Electron App Environment
Create `.env.local` in root:
```
REACT_APP_API_URL=https://maigun-backend-xxxxx.onrender.com/api
REACT_APP_API_TOKEN=same-as-backend-API_TOKEN
REACT_APP_WS_URL=https://maigun-backend-xxxxx.onrender.com
```

### Step 7: Test End-to-End
- [ ] Start Electron app: `npm run dev`
- [ ] Create a campaign
- [ ] Add test recipients
- [ ] Send test email
- [ ] Check email received
- [ ] Verify webhook event in Events tab

## Expected Architecture After Deployment

```
┌──────────────────┐
│  Electron App    │ (Desktop client)
│  (Your computer) │
└────────┬─────────┘
         │ HTTP + WebSocket
         │ (api-client.ts, ws-client.ts)
         ▼
┌──────────────────────────────────┐
│  maigun-backend.onrender.com     │ (Hosted on Render)
│  ┌──────────────────────────┐    │
│  │ Express + Socket.io      │    │
│  │ REST API Endpoints       │    │
│  │ - POST /api/campaigns    │    │
│  │ - POST /api/webhooks     │    │
│  │ - POST /api/tokens       │    │
│  └──────────┬───────────────┘    │
└─────────────┼────────────────────┘
              │
              ├─────────► Mailgun API
              │           (sendEmail)
              │
              └─────────► PostgreSQL DB
                          (campaigns,
                           recipients,
                           events)
```

## Configuration URLs

### Development (Local)
```
Backend API:  http://localhost:3000/api
WebSocket:    http://localhost:3000
Frontend:     http://localhost:5173
```

### Production (Render)
```
Backend API:  https://maigun-backend-xxxxx.onrender.com/api
WebSocket:    https://maigun-backend-xxxxx.onrender.com
Frontend:     Your Electron app (any machine)
```

## API Authentication

All API requests require:
```
Authorization: Bearer YOUR_API_TOKEN
Content-Type: application/json
```

Webhooks from Mailgun use signature verification instead (HMAC-SHA256).

## Database Models

### Campaign
- id, name, subject, template
- sourceType ('cid' or 'url')
- imageUrl, imageCid
- webhookUrl
- recipients, events (relations)

### CampaignRecipient
- email, name
- data (JSON for template vars)
- campaign (relation)

### WebhookEvent
- campaignId, email
- event (delivered, clicked, opened, failed, etc.)
- timestamp, data (JSON)

### ApiToken
- name, token (unique)
- createdAt, lastUsedAt

## Environment Variables Summary

### Backend (.env)
```
DATABASE_URL=postgresql://...
MAILGUN_API_KEY=...
MAILGUN_DOMAIN=...
API_TOKEN=...
NODE_ENV=production
PORT=3000
WEBHOOK_URL=https://...
ELECTRON_ORIGIN=*
```

### Frontend (.env.local)
```
REACT_APP_API_URL=https://...
REACT_APP_API_TOKEN=...
REACT_APP_WS_URL=https://...
```

## Common Issues & Solutions

| Issue | Solution |
|-------|----------|
| "cannot find module @prisma/client" | `cd backend && npm install && npm run db:generate` |
| Database connection failed | Check DATABASE_URL in Render env vars |
| Webhooks not received | Verify webhook URL in Mailgun matches Render service URL |
| WebSocket not connecting | Check CORS origin, use `wss://` not `ws://` for https |
| API returns 401 | Verify API_TOKEN matches in backend and .env.local |

## Next: Scaling Tips

### Free Tier Limitations
- Render spins down after 15 min inactivity
- First request after spin-down = 30 sec cold start
- PostgreSQL auto-deletes after 90 days if unused

### For Production
- Upgrade to paid Render plans
- Use custom domain
- Enable auto-scaling
- Set up monitoring/alerts
- Add backup database replica

## Maintenance

### Regular Tasks
- Monitor Database: Render → Services → maigun-postgres → Metrics
- Check Logs: Render → Services → maigun-backend → Logs
- Review Webhooks: Mailgun → Sending → Webhooks
- Audit API Tokens: Backend API → /api/tokens

### Updating Code
1. Make changes locally
2. Commit and push to GitHub: `git push origin main`
3. Render auto-deploys (4-5 min)
4. Check Render logs to confirm deployment

---

**Implementation Status:** ✅ Backend infrastructure complete, ready for Render deployment

**Next Action:** Follow **Phase 4: Manual Steps** to deploy to Render.com
