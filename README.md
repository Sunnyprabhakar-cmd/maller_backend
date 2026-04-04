# Maigun Campaign Studio

Maigun Campaign Studio is a desktop app for managing email campaigns, importing CSV contacts, composing branded emails, and sending via Mailgun. Now supports **hosted backend deployment on Render.com**.

## Architecture

### Local Development
```
Electron App → Local Node Backend (port 3000) → Mailgun → Webhooks → Local Backend
```

### Production (Render.com)
```
Electron App → Hosted Backend (Render) → Mailgun → Webhooks → Hosted Backend
             (WebSocket for realtime events)    (PostgreSQL database)
```

## Features

- **Campaign Management:** Create campaigns with templates, branding, and dynamic variables
- **CSV Import:** Validate and import contact lists with custom fields
- **Email Preview:** Desktop and mobile preview modes
- **Template Variables:** Use `{{name}}`, `{{offer_code}}`, etc. in content
- **Mailgun Integration:** Send via Mailgun with retry and throttling
- **Webhook Events:** Realtime tracking of delivered, clicked, opened, and failed emails
- **Database:** PostgreSQL (production) or file storage (development)
- **API:** RESTful backend with token-based auth

## Tech Stack

**Frontend:**
- Electron for desktop shell
- React + Vite for UI
- TypeScript + Socket.io for realtime events

**Backend:**
- Express.js for REST API
- Socket.io for WebSocket realtime updates
- Prisma ORM for database
- PostgreSQL for persistent storage

## Quick Start - Local Development

### 1. Install Dependencies
```bash
npm install
cd backend && npm install
cd ..
```

### 2. Setup Backend
```bash
cd backend

# Create environment file
cp .env.example .env

# Update .env with your Mailgun credentials
nano .env

# Setup database
npm run db:push

# Start backend (terminal 1)
npm run dev
```

### 3. Start Electron App
```bash
# In root directory (terminal 2)
npm run dev
```

Visit `http://localhost:5173` (or your Electron window)

## Deployment to Render.com

For production deployment with hosted backend, database, and auto-scaling:

👉 **See [SETUP_RENDER.md](./SETUP_RENDER.md) for step-by-step guide**

Key points:
1. Push code to GitHub
2. Create PostgreSQL database on Render
3. Deploy backend service with auto-deployment on git push
4. Update Electron app with backend URL and token
5. Configure Mailgun webhooks to new backend URL

## Configuration

### Backend Environment Variables
```
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://user:pass@localhost/maigun
MAILGUN_API_KEY=your-mailgun-key
MAILGUN_DOMAIN=your-domain.mailgun.org
API_TOKEN=your-secure-token
WEBHOOK_URL=http://localhost:3000/api/webhooks
ELECTRON_ORIGIN=http://localhost:5173
```

### Frontend Environment Variables (.env.local)
```
REACT_APP_API_URL=http://localhost:3000/api
REACT_APP_WS_URL=http://localhost:3000
REACT_APP_API_TOKEN=dev-token-12345
```

## API Endpoints

### Campaigns
- `POST /api/campaigns` - Create campaign
- `GET /api/campaigns` - List all campaigns
- `GET /api/campaigns/:id` - Get campaign with events
- `POST /api/campaigns/:id/recipients` - Add recipients from CSV
- `POST /api/campaigns/:id/send-test` - Send test email
- `POST /api/campaigns/:id/send` - Send to all recipients
- `GET /api/campaigns/:id/events` - Get webhook events

### Webhooks
- `POST /api/webhooks` - Mailgun webhook receiver (signature verified)

### Tokens
- `POST /api/tokens/generate` - Create new API token
- `GET /api/tokens` - List tokens
- `DELETE /api/tokens/:id` - Revoke token

## Database Schema

**Campaign** - Email campaign details
**CampaignRecipient** - Recipients for a campaign
**WebhookEvent** - Mailgun delivery events (delivered, clicked, opened, failed, etc.)
**ApiToken** - Authentication tokens

## Development Commands

```bash
# Backend
cd backend
npm run dev          # Start development server
npm run build        # Build TypeScript
npm run db:push      # Push schema to database
npm run db:generate  # Regenerate Prisma client
npm run db:studio    # Open Prisma Studio (data explorer)

# Frontend
npm run dev          # Start Electron with hot reload
npm run build        # Build for production
npm run preview      # Preview production build
```

## Troubleshooting

**Backend won't start:**
```bash
# Check database connection
npm run db:push

# View database with Prisma Studio
npm run db:studio
```

**WebSocket not connecting:**
- Verify backend is running on port 3000
- Check `REACT_APP_WS_URL` in .env.local
- Check browser console for WebSocket errors

**Mailgun webhooks not received:**
- Verify webhook URL in Mailgun dashboard
- Check backend logs for signature validation
- Ensure `MAILGUN_API_KEY` matches webhook signature settings

## Project Structure

```
├── src/
│   ├── main/           # Electron main process
│   ├── preload/        # Preload bridge
│   └── renderer/       # React UI
├── backend/            # Express backend
│   ├── src/
│   │   ├── api/        # Route handlers
│   │   ├── services/   # Business logic
│   │   └── middleware/ # Auth, etc.
│   └── prisma/         # Database schema
├── SETUP_RENDER.md     # Render deployment guide
└── render.yaml         # Render.com configuration
```

## Notes

- **Security:** Always use token-based auth for API; set strong API_TOKEN in production
- **Database:** Free tier Render PostgreSQL auto-deletes after 90 days of inactivity
- **Webhooks:** Mailgun signature verification required for security
- **CORS:** Adjust ELECTRON_ORIGIN in backend for production domains