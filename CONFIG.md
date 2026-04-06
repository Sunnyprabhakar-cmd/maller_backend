# Backend - Configuration Reference

## Environment Variables

### Required for Production
- `DATABASE_URL` - PostgreSQL connection string
- `MAILGUN_API_KEY` - Mailgun API key
- `MAILGUN_DOMAIN` - Mailgun domain
- `API_TOKEN` - Secure token for API authentication

### Optional but Recommended
- `NODE_ENV` - Set to "production" for Render
- `PORT` - Server port (default: 3000)
- `WEBHOOK_URL` - Full URL for Mailgun callbacks
- `EMAIL_ASSET_BASE_URL` - Optional public base URL for email assets (social icons)
- `ELECTRON_ORIGIN` - CORS origin for Electron app
- `REDIS_URL` - Redis connection string for BullMQ background sends

### Example Configurations

#### Development (Local PostgreSQL)
```env
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://user:password@localhost:5432/maigun_dev
REDIS_URL=
MAILGUN_API_KEY=key-xxxxxx
MAILGUN_DOMAIN=sandbox123.mailgun.org
API_TOKEN=dev-token-12345
WEBHOOK_URL=http://localhost:3000/api/webhooks
EMAIL_ASSET_BASE_URL=http://localhost:3000
ELECTRON_ORIGIN=http://localhost:5173
```

#### Production (Render PostgreSQL)
```env
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://user:pass@host.render.internal:5432/db
REDIS_URL=redis://user:password@host:6379
MAILGUN_API_KEY=key-xxxxxx
MAILGUN_DOMAIN=yourdomain.mailgun.org
API_TOKEN=[strong-random-token]
WEBHOOK_URL=https://maigun-backend-xxxxx.onrender.com/api/webhooks
EMAIL_ASSET_BASE_URL=https://maigun-backend-xxxxx.onrender.com
ELECTRON_ORIGIN=*
```

## Prisma Database Setup

### Local Development (File-Based)
```prisma
datasource db {
  provider = "sqlite"
  url      = "file:./dev.db"
}
```

Then run: `npm run db:push`

### Render Production (PostgreSQL)
```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

Environment variable: `DATABASE_URL=postgresql://...`

## API Authentication

### Request Header
```
Authorization: Bearer YOUR_API_TOKEN
Content-Type: application/json
```

### Example
```bash
curl -X GET http://localhost:3000/api/campaigns \
  -H "Authorization: Bearer dev-token-12345" \
  -H "Content-Type: application/json"
```

## CORS Configuration

### Development
```typescript
cors({
  origin: 'http://localhost:5173'
})
```

### Production
```typescript
cors({
  origin: '*'  // Allow any origin
})
```

## Mailgun Configuration

### Required Keys
- `MAILGUN_API_KEY` - Found in Mailgun Dashboard → Settings
- `MAILGUN_DOMAIN` - Your verified domain

### Webhook Verification
Mailgun signs webhooks with HMAC-SHA256:
```
timestamp + token → HMAC-SHA256(API_KEY) → signature
```

We verify this in `src/api/webhooks.ts`.

## Database Models

### Campaign
```prisma
model Campaign {
  id        String   @id @default(cuid())
  name      String
  subject   String
  template  String   @db.Text
  sourceType String  @default("cid")
  imageUrl  String?
  imageCid  String?
  webhookUrl String?
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  
  recipients CampaignRecipient[]
  events     WebhookEvent[]
}
```

### API Interactions

#### Create Campaign
```
POST /api/campaigns
{
  "name": "Spring Launch",
  "subject": "Get your offer",
  "template": "<p>Hi {{name}}</p>",
  "sourceType": "url",
  "imageUrl": "https://example.com/banner.png"
}
```

#### Get Campaign with Events
```
GET /api/campaigns/{id}
Response includes:
- campaign details
- recipients array
- events (delivered, clicked, opened, failed)
```

#### Send Test Email
```
POST /api/campaigns/{id}/send-test
{
  "testEmail": "user@example.com"
}
Response:
{
  "messageId": "mailgun-message-id",
  "sent": true
}
```

## WebSocket Events

### Client Side (Electron)
```javascript
import { wsClient } from './ws-client'

wsClient.connect()

wsClient.on('email:sent', (data) => {
  // data = { campaignId, email, messageId, timestamp }
})

wsClient.on('webhook:event', (data) => {
  // data = { campaignId, email, event, timestamp }
})
```

### Server Side (Express)
```typescript
app.use((req, res, next) => {
  ;(req as any).io = io  // Socket.io instance
  next()
})

// Broadcast events
const io = (req as any).io
io.emit('webhook:event', {
  campaignId: 'xxx',
  email: 'user@example.com',
  event: 'delivered'
})
```

## Error Handling

### 401 Unauthorized
```
Missing or invalid API_TOKEN in Authorization header
```

### 400 Bad Request
```
Invalid request body or missing required fields
```

### 404 Not Found
```
Campaign or resource doesn't exist
```

## Deployment Environment

### Render Service Configuration
```yaml
services:
  - type: web
    name: maigun-backend
    runtime: node
    buildCommand: "cd backend && npm install && npm run build && npm run db:push"
    startCommand: "cd backend && npm start"
```

### Auto-Deploy on Git Push
- Render monitors your GitHub repository
- Any push to `main` triggers automatic deployment
- Build logs available in Render dashboard

## Database Migrations

### Create New Migration
```bash
npm run db:migrate
```

### Apply Migrations
```bash
npm run db:push
```

### View Database
```bash
npm run db:studio
# Opens Prisma Studio at http://localhost:5555
```

## Security Notes

1. **API Token:** Use `crypto.randomBytes(32).toString('hex')` to generate
2. **Database:** Never expose connection string in client code
3. **CORS:** Restrict ELECTRON_ORIGIN to known origins in production
4. **Webhooks:** Always verify Mailgun signature (done automatically)
5. **Passwords:** Don't store in code; use environment variables

## Performance Tips

1. Database indexes on frequently queried fields (already in schema)
2. WebSocket for realtime instead of polling
3. Batch email sending instead of one-by-one
4. Cache campaign templates if reused
5. Monitor Render dashboard for performance metrics

## Monitoring

### Logs
```
Render Dashboard → maigun-backend → Logs
```

### Database
```
Render Dashboard → maigun-postgres → Metrics
```

### Errors
- Check server logs for 500 errors
- Check Mailgun dashboard for delivery failures
- Use Prisma Studio to inspect database

## Development Commands

```bash
npm run dev              # Start with hot reload
npm run build            # Build TypeScript
npm run db:push          # Sync database schema
npm run db:generate      # Regenerate Prisma client
npm run db:migrate       # Create migration
npm run db:studio        # Open Prisma Studio
npm start                # Run production build
```
