# Render Deployment Guide - Maller Backend

Your Mailgun backend is now pushed to GitHub at:
👉 **https://github.com/Sunnyprabhakar-cmd/maller_backend**

This guide walks you through deploying it to Render with PostgreSQL database.

## 🚀 5-Minute Render Deployment

### Step 1: Create Render PostgreSQL Database
1. Go to **[render.com](https://render.com)** and sign in
2. Click **New +** → **PostgreSQL**
3. Fill in:
   - **Name:** `maller-postgres`
   - **Database Name:** `maigun` (or any name)
   - **Database User:** `postgres`
   - **Plan:** Free (0.25 GB)
   - **Region:** Choose closest to you
4. Click **Create Database**
5. Wait 2-3 minutes for creation
6. **Copy the Internal Database URL** (you'll need this)
   - Format: `postgresql://user:password@host.render.internal:5432/dbname`

### Step 2: Deploy Backend Service to Render
1. Click **New +** → **Web Service**
2. Connect your GitHub account if needed
3. Select your repository: **Sunnyprabhakar-cmd/maller_backend**
4. Fill in configuration:
   ```
   Name: maller-backend
   Runtime: Node
   Region: (same as database)
   Branch: main
   Build Command: npm install && npm run build && npm run db:push
   Start Command: npm start
   Plan: Free
   ```
5. **Add Environment Variables** (click "Add From .env"):
   ```
   NODE_ENV = production
   PORT = 3000
   DATABASE_URL = [PASTE FROM STEP 1]
   MAIL_API_KEY = [YOUR MAILGUN API KEY]
   MAIL_DOMAIN = [YOUR MAILGUN DOMAIN]
   API_AUTH_TOKEN = [GENERATE: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"]
   WEBHOOK_URL = https://maller-backend-xxxxx.onrender.com/api/webhooks
   ELECTRON_ORIGIN = *
   ```
6. Click **Create Web Service**
7. **Wait 5-10 minutes** for the first deployment
8. Check dashboard for your service URL: `https://maller-backend-XXXXX.onrender.com`

### Step 3: Update Mailgun Webhooks
1. Go to **Mailgun Dashboard** → **Sending** → **Webhooks**
2. Click **Add Webhook**
3. Fill in:
   ```
   URL: https://maller-backend-XXXXX.onrender.com/api/webhooks
   Events: All (All the following)
   ```
4. Click **Save**

### Step 4: Update Maigun Electron App
In your Maigun Electron app, create `.env.local`:
```
REACT_APP_API_URL=https://maller-backend-XXXXX.onrender.com/api
REACT_APP_API_TOKEN=[same API_AUTH_TOKEN from step 2]
REACT_APP_WS_URL=https://maller-backend-XXXXX.onrender.com
```

Run the Electron app:
```bash
npm run dev
```

### Step 5: Test End-to-End
1. Open your Electron app
2. Create a campaign
3. Add test recipients
4. Send test email
5. Verify email arrived in inbox
6. Check webhook events in Events tab in app
7. **Celebrate! 🎉**

---

## 📋 Environment Variables Reference

| Variable | Format | Where to Get |
|----------|--------|--------------|
| `DATABASE_URL` | `postgresql://user:pass@host/db` | Render PostgreSQL → Connection String |
| `MAILGUN_KEY` | `key-xxxxx` | Mailgun → Account → API Keys → Private Key |
| `MAILGUN_DOMAIN` | `yourdomain.mailgun.org` | Mailgun → Domains → (Your verified domain) |
| `API_AUTH_TOKEN` | random 64-char | Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `WEBHOOK_URL` | `https://your-service.onrender.com/api/webhooks` | Render → Settings → Service URL |

---

## 🔍 API Endpoints

Your backend exposes these endpoints (all require Bearer token):

```bash
# Test health
curl https://maller-backend-XXXXX.onrender.com/health

# Create campaign
POST /api/campaigns
Header: Authorization: Bearer YOUR_API_AUTH_TOKEN

# Send test email
POST /api/campaigns/{id}/send-test
{
  "testEmail": "user@example.com"
}

# Get all campaigns
GET /api/campaigns
```

---

## 🛠️ Troubleshooting

### Build fails: "Cannot find module '@prisma/client'"
**Solution:** Render auto-runs `npm install && npm run build && npm run db:push`. If it fails:
1. Check Render logs: Dashboard → maller-backend → Logs
2. Ensure DATABASE_URL is correct
3. Retry deployment

### Webhooks not received
1. Verify webhook URL in Mailgun matches your Render service URL exactly
2. Check Render logs for 401 errors (token validation)
3. Ensure `API_AUTH_TOKEN` is set correctly

### WebSocket connection fails
1. Check browser console for WebSocket errors
2. Verify `REACT_APP_WS_URL` in .env.local
3. Use `https://` (wss://) not `http://`

### Database connection refused
1. Check DATABASE_URL is copied exactly from Render PostgreSQL
2. Verify PostgreSQL service is running (Render → Services → maller-postgres)
3. Wait 2-3 minutes after creating PostgreSQL service

---

## 📊 Monitor Your Deployment

**View Logs:**
- Render → maller-backend → Logs (real-time)

**Check Database:**
- Render → maller-postgres → Metrics
- Or use Prisma Studio: `npm run db:studio` (local only)

**Monitor API Health:**
```bash
curl https://maller-backend-XXXXX.onrender.com/health
```

---

## 🚢 Auto-Deploy on Git Push

Every time you push to `main` branch, Render automatically:
1. Pulls the latest code
2. Runs build command
3. Runs migrations
4. Deploys within 2-5 minutes

```bash
# Make changes locally
git add .
git commit -m "Update feature"

# Push to GitHub
git push origin main

# Check Render dashboard for deployment status
# Logs will show build progress in real-time
```

---

## 🔐 Security Checklist

- ✅ Database URL **not** committed to git
- ✅ API token is **strong** (32+ random characters)
- ✅ CORS origin set to `*` for development (restrict in production)
- ✅ Mailgun signatures verified server-side
- ✅ Environment variables set in Render (not in code)

---

## 📈 Scaling Tips

**Free Tier Limitations:**
- Spins down after 15 min inactivity (first request = 30s cold start)
- PostgreSQL auto-deletes after 90 days if unused
- 2 concurrent requests max

**For Production:**
- Upgrade Plan to "Standard" ($7/month)
- Remove auto-sleep: Render → Settings → Auto-Pause
- Add database replica for failover

---

## Next Steps

1. ✅ Backend deployed to Render
2. ✅ PostgreSQL database running
3. ✅ Mailgun webhooks configured
4. Next: Update Maigun Electron app with backend URLs
5. Then: Test end-to-end email sending

---

**Your Backend URL:** 🔗 https://maller-backend-XXXXX.onrender.com

**GitHub Repository:** 🔗 https://github.com/Sunnyprabhakar-cmd/maller_backend

**API Documentation:** See backend/CONFIG.md

Happy deploying! 🚀
