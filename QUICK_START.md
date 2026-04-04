# Maigun Hosted Backend - Quick Reference

## 🚀 Fast Track: Deploy to Render (5 Steps)

### 1️⃣ Push to GitHub
```bash
cd /home/sunny/maigun_from_scratch
git init
git add .
git commit -m "Maigun with hosted backend"
git remote add origin https://github.com/YOUR_USERNAME/maigun.git
git push -u origin main
```

### 2️⃣ Create Render PostgreSQL Database
- Go to render.com → Dashboard → New+ → PostgreSQL
- Name: `maigun-postgres`, Plan: Free
- Copy the "Internal Database URL"

### 3️⃣ Deploy Backend Service to Render
- Dashboard → New+ → Web Service
- Select your `maigun` repository
- Fill in:
  ```
  Name: maigun-backend
  Runtime: Node
  Build Command: cd backend && npm install && npm run build && npm run db:push
  Start Command: cd backend && npm start
  Plan: Free
  ```

### 4️⃣ Add Environment Variables to Backend
In Render Dashboard → mailgun-backend → Environment:
```
NODE_ENV = production
DATABASE_URL = [paste from PostgreSQL]
MAILGUN_API_KEY = [your-key]
MAILGUN_DOMAIN = [your-domain.mailgun.org]
API_TOKEN = [generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"]
WEBHOOK_URL = https://maigun-backend-XXXXX.onrender.com/api/webhooks
ELECTRON_ORIGIN = *
```

### 5️⃣ Configure Mailgun Webhooks
- Mailgun Dashboard → Webhooks
- Add: URL = `https://maigun-backend-XXXXX.onrender.com/api/webhooks`
- Event: All

## 📝 Update Electron App

Create `​.env.local` in root:
```
REACT_APP_API_URL=https://maigun-backend-XXXXX.onrender.com/api
REACT_APP_API_TOKEN=[same API_TOKEN from step 4]
REACT_APP_WS_URL=https://maigun-backend-XXXXX.onrender.com
```

Then: `npm run dev`

---

## 💻 Local Development (Before Pushing)

### Terminal 1: Start Backend
```bash
cd backend

# Setup (first time only)
cp .env.example .env
# Edit .env with Mailgun credentials
npm run db:push

# Run
npm run dev
# Open http://localhost:3000/health to verify
```

### Terminal 2: Start Electron App
```bash
npm run dev
# Opens Electron window at http://localhost:5173
```

---

## 📊 Database Schema

```
Campaign
├── id (string)
├── name, subject, template
├── sourceType ('cid' | 'url')
├── imageUrl, imageCid
├── webhookUrl
└── relations: recipients[], events[]

CampaignRecipient
├── email, name
├── data (JSON for {{vars}})
└── campaign (foreign key)

WebhookEvent
├── campaignId, email
├── event ('delivered'|'clicked'|'opened'|'failed')
├── timestamp
├── data (raw Mailgun JSON)
└── campaign (foreign key)

ApiToken
├── id, name, token (unique)
├── createdAt, lastUsedAt
```

---

## 🔌 API Endpoints

All require: `Authorization: Bearer YOUR_API_TOKEN`

### Campaigns
```
POST   /api/campaigns                    Create campaign
GET    /api/campaigns                    List all
GET    /api/campaigns/{id}               Get with events
POST   /api/campaigns/{id}/recipients    Add from CSV
POST   /api/campaigns/{id}/send-test     Send test email
POST   /api/campaigns/{id}/send          Send to all
GET    /api/campaigns/{id}/events        Get webhook events
```

### Tokens
```
POST   /api/tokens/generate              Create token
GET    /api/tokens                       List tokens
DELETE /api/tokens/{id}                  Revoke token
```

### Webhooks (No auth - Mailgun signed)
```
POST   /api/webhooks                      Mailgun callback
```

---

## 🔔 Realtime Events (WebSocket)

```javascript
// In Electron app
wsClient.connect()

wsClient.on('email:sent', (data) => {
  console.log(`Email sent to ${data.email}`)
})

wsClient.on('webhook:event', (data) => {
  console.log(`${data.event} for ${data.email}`)
})
```

---

## 🌍 File Structure

```
maigun/
├── backend/                      ← Hosted on Render
│   ├── src/
│   │   ├── index.ts             (Express + Socket.io server)
│   │   ├── api/                 (Campaign, Webhook, Token routes)
│   │   ├── services/            (Mailer, Render)
│   │   └── middleware/          (Auth)
│   ├── prisma/schema.prisma
│   ├── package.json
│   └── .env.example
│
├── src/
│   └── renderer/src/
│       ├── api-client.ts        ← HTTP API wrapper
│       ├── ws-client.ts         ← WebSocket client
│       └── main.tsx             (React UI)
│
├── .env.local                    ← Frontend env vars
├── SETUP_RENDER.md               ← Deployment guide
├── DEPLOYMENT_CHECKLIST.md       ← Step-by-step
└── README.md                     ← Project overview
```

---

## ⚡ Environment Variables Quick Copy

### Backend (.env)
```
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/maigun_dev
MAILGUN_API_KEY=YOUR_MAILGUN_API_KEY
MAILGUN_DOMAIN=YOUR_DOMAIN.mailgun.org
API_TOKEN=dev-token-12345
WEBHOOK_URL=http://localhost:3000/api/webhooks
ELECTRON_ORIGIN=http://localhost:5173
```

### Frontend (.env.local)
```
REACT_APP_API_URL=http://localhost:3000/api
REACT_APP_API_TOKEN=dev-token-12345
REACT_APP_WS_URL=http://localhost:3000
```

---

## ✅ Verification Checklist

- [ ] Backend starts: `npm run dev` → `curl http://localhost:3000/health`
- [ ] Database connected: `npm run db:studio` (Prisma Studio opens)
- [ ] Electron app runs: `npm run dev` (window opens)
- [ ] Can create campaign in UI
- [ ] Can send test email
- [ ] Email arrives in inbox
- [ ] Webhook events show in Events tab
- [ ] Deployed to Render and auto-deploys on `git push`

---

## 🆘 Troubleshooting 101

| Problem | Fix |
|---------|-----|
| `Cannot find module @prisma/client` | `cd backend && npm install && npm run db:generate` |
| `ECONNREFUSED` (database) | Check DATABASE_URL, start PostgreSQL |
| WebSocket 401 | Check API_TOKEN in .env.local matches backend |
| Mailgun webhook fails | Verify webhook URL in Mailgun = exact Render URL |
| `Error: Cannot use import statement` | Already fixed! Preload outputs CommonJS |

---

## 📚 Learn More

- **Deployment:** See `SETUP_RENDER.md`
- **Full Checklist:** See `DEPLOYMENT_CHECKLIST.md`
- **Architecture:** See `README.md`

---

**Status:** ✅ Production-ready

**Next:** Push to GitHub and deploy to Render in 5 steps above!
