# Maigun - Hosted Backend Setup Guide

## Architecture Overview

```
┌─────────────┐          ┌─────────────────┐          ┌──────────┐
│ Electron    │          │ Hosted Backend  │          │ Mailgun  │
│ (Desktop)   ├─────────►│ (Render.com)    ├─────────►│   API    │
└─────────────┘   HTTP   └────────┬────────┘   SMTP   └──────────┘
                                  │
                            WebSocket (realtime)
                                  │
                         ┌────────▼────────┐
                         │  PostgreSQL DB  │
                         │  (Render)       │
                         └─────────────────┘
```

## Prerequisites

- GitHub account (for version control)
- Render.com account (free tier available)
- Mailgun account with verified domain
- Node.js 18+ (for local development)

## Step 1: Prepare Your GitHub Repository

```bash
# Initialize git if not already done
cd /home/sunny/maigun_from_scratch
git init
git add .
git commit -m "Initial commit: Maigun with hosted backend"

# Add your GitHub remote
git remote add origin https://github.com/YOUR_USERNAME/maigun.git
git branch -M main
git push -u origin main
```

## Step 2: Deploy Backend to Render

### 2.1 Create Render Account
- Go to [render.com](https://render.com)
- Sign up with GitHub
- Authorize Render to access your repositories

### 2.2 Create PostgreSQL Database
1. Dashboard → New+ → PostgreSQL
2. Name: `maigun-postgres`
3. Plan: Free (0.25 GB storage)
4. Region: Choose closest to you
5. Create Database
6. Copy **Internal Database URL** (you'll need it for backend env vars)

### 2.3 Deploy Backend Service
1. Dashboard → New+ → Web Service
2. Connect your GitHub repository
3. Configure:
   - **Name:** `maigun-backend`
   - **Runtime:** Node
   - **Build Command:** `cd backend && npm install && npm run build && npm run db:push`
   - **Start Command:** `cd backend && npm start`
   - **Plan:** Free

4. Add Environment Variables:
   ```
   NODE_ENV = production
   PORT = 3000
   DATABASE_URL = [paste from PostgreSQL service]
   MAILGUN_API_KEY = [your-mailgun-api-key]
   MAILGUN_DOMAIN = [your-mailgun-domain.mailgun.org]
   API_TOKEN = [generate-strong-random-token]
   WEBHOOK_URL = https://[your-service-name].onrender.com/api/webhooks
   ELECTRON_ORIGIN = *
   ```

5. Click "Create Web Service"
6. Wait for deployment (5-10 minutes)
7. Note the service URL: `https://maigun-backend-xxxxx.onrender.com`

### 2.4 Configure Mailgun Webhook
1. Mailgun Dashboard → Sending → Webhooks
2. Add Webhook:
   - **Event:** All events (delivered, clicked, opened, failed, etc.)
   - **URL:** `https://maigun-backend-xxxxx.onrender.com/api/webhooks`
   - Save and verify

## Step 3: Update Electron App Configuration

Create `.env.local` in the Electron app root:

```bash
# .env.local (Electron frontend)
REACT_APP_API_URL=https://maigun-backend-xxxxx.onrender.com/api
REACT_APP_API_TOKEN=same-token-as-backend
REACT_APP_WS_URL=https://maigun-backend-xxxxx.onrender.com
```

Update `electron.vite.config.ts`:

```typescript
export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: ['sqlite3', 'better-sqlite3']
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: '[name].js'
        }
      }
    }
  },
  renderer: {
    define: {
      __VITE_BACKEND_URL__: JSON.stringify(process.env.REACT_APP_API_URL || 'http://localhost:3000/api')
    }
  }
})
```

## Step 4: Local Development

### Backend Setup
```bash
# Install backend dependencies
cd backend
npm install

# Create .env file
cp .env.example .env

# Update .env with your Mailgun credentials
nano .env

# Run database migrations
npm run db:push

# Start development server
npm run dev
# Backend runs on http://localhost:3000
```

### Frontend Setup
```bash
# In root directory
npm install
npm run dev
# Electron app runs on http://localhost:5173
```

## Step 5: Testing End-to-End

1. **Create Campaign** in Electron app
2. **Add Recipients** (CSV upload)
3. **Send Test Email** to yourself
   - Verify email received
   - Check Mailgun dashboard for delivery status
   - WebSocket should show realtime event in Events tab

## Important Notes

### Security
- **Never** commit `.env` files to git
- Always use strong API_TOKEN (mint one with `crypto.randomBytes(32).toString('hex')`)
- Set `ELECTRON_ORIGIN=*` only for development; in production, specify exact origin

### Database
- Free tier PostgreSQL on Render has 90-day auto-delete if unused
- Check database usage: Render Dashboard → Services → maigun-postgres → Metrics

### Render Limitations
- Free web service spins down after 15 minutes of inactivity
- First request after spin-down takes 30 seconds
- For production, upgrade to paid plans

### Development vs Production

**Development (localhost):**
```bash
REACT_APP_API_URL=http://localhost:3000/api
REACT_APP_WS_URL=http://localhost:3000
```

**Production (Render):**
```bash
REACT_APP_API_URL=https://maigun-backend-xxxxx.onrender.com/api
REACT_APP_WS_URL=https://maigun-backend-xxxxx.onrender.com
```

## Troubleshooting

### "Cannot find module '@prisma/client'"
```bash
cd backend
npm install @prisma/client
npm run db:generate
```

### "database connection refused"
- Check DATABASE_URL env var on Render
- Verify PostgreSQL service is running
- Check Render logs: Dashboard → Services → maigun-backend → Logs

### WebSocket connection fails
- Check CORS origin in `backend/src/index.ts`
- Verify WebSocket URL is exactly: `wss://service-name.onrender.com` (with `wss://` not `ws://`)

### Mailgun webhook not receiving
- Verify webhook URL in Mailgun dashboard
- Check Render logs for 401 (signature verification failed)
- Ensure `MAILGUN_API_KEY` is set correctly

## Next Steps

1. ✅ Deploy backend to Render
2. ✅ Update Electron app with backend URLs
3. ✅ Test end-to-end
4. 📊 Monitor logs and metrics on Render
5. 🔐 Set up custom domain (optional)
6. 💳 Plan subscription when ready for production

## Git Workflow

```bash
# Make changes locally
git add .
git commit -m "Update feature"

# Push to GitHub
git push origin main

# Render auto-deploys on push
# Check Render dashboard for build logs
```

---

**Backend Repo Structure:**
- `backend/src/index.ts` - Express server + Socket.io
- `backend/src/api/` - API endpoints
- `backend/src/services/` - Business logic (mailer, renderer)
- `backend/prisma/schema.prisma` - Database models
- `backend/.env.example` - Configuration template

**Electron Integration:**
- `src/renderer/src/api-client.ts` - HTTP API calls
- `src/renderer/src/ws-client.ts` - WebSocket realtime events
- `.env.local` - Frontend configuration
