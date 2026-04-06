import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import cors from 'cors'
import dotenv from 'dotenv'
import { PrismaClient } from '@prisma/client'
import { createHash } from 'crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { isFallbackAuthEnabled } from './middleware/auth.js'

// Routes
import campaignRoutes from './api/campaigns.js'
import webhookRoutes from './api/webhooks.js'
import tokenRoutes from './api/tokens.js'
import { campaignSendQueue } from './services/campaign-send-queue.js'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const DEPLOY_SIGNATURE = createHash('sha1').update('webhook-recovery-v5').digest('hex').slice(0, 12)
const configuredOrigin = process.env.ELECTRON_ORIGIN || 'http://localhost:5173'

function isAllowedOrigin(origin?: string): boolean {
  if (!origin) {
    return true
  }

  if (configuredOrigin === '*') {
    return true
  }

  if (origin === configuredOrigin || origin === 'http://localhost:5173' || origin === 'null') {
    return true
  }

  return origin.startsWith('file://')
}

const app = express()
const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) {
        callback(null, true)
        return
      }
      callback(new Error(`CORS blocked for origin: ${origin}`))
    },
    methods: ['GET', 'POST']
  }
})

const prisma = new PrismaClient()

// Middleware
app.use(cors({
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) {
      callback(null, true)
      return
    }
    callback(new Error(`CORS blocked for origin: ${origin}`))
  }
}))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

const socialIconCandidates = [
  path.resolve(__dirname, '../../src/shared/social-icons'),
  path.resolve(__dirname, '../shared/social-icons')
]
const socialIconPath = socialIconCandidates.find((candidate) => fs.existsSync(candidate))
if (socialIconPath) {
  app.use('/assets/social-icons', express.static(socialIconPath))
  console.log(`[Backend] Serving social icons from ${socialIconPath}`)
} else {
  console.warn('[Backend] Social icon directory not found; /assets/social-icons will return 404')
}

// Attach prisma and io to requests
app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
  ;(req as any).prisma = prisma
  ;(req as any).io = io
  next()
})

// Health check
app.get('/health', async (req: express.Request, res: express.Response) => {
  let database = {
    status: 'ok' as 'ok' | 'unreachable'
  }

  try {
    await prisma.$queryRawUnsafe('SELECT 1')
  } catch {
    database = {
      status: 'unreachable'
    }
  }

  res.json({
    status: database.status === 'ok' ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    deploySignature: DEPLOY_SIGNATURE,
    service: 'maller-backend-1',
    database
  })
})

// Routes
app.use('/api/campaigns', campaignRoutes)
app.use('/api/webhooks', webhookRoutes)
app.use('/api/tokens', tokenRoutes)

// WebSocket connection
io.on('connection', (socket) => {
  console.log(`[WebSocket] Client connected: ${socket.id}`)

  socket.on('disconnect', () => {
    console.log(`[WebSocket] Client disconnected: ${socket.id}`)
  })
})

// Make io available globally for webhooks
;(global as any).io = io
campaignSendQueue.bindIoProvider(() => io)
campaignSendQueue.start()

// Error handling
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[Error]', err)
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  })
})

// Start server
const PORT = process.env.PORT || 3000

httpServer.listen(PORT, () => {
  console.log(`[Backend] Server running on http://localhost:${PORT}`)
  console.log(`[Socket.io] WebSocket enabled on ws://localhost:${PORT}`)
  if (isFallbackAuthEnabled()) {
    console.warn('[Auth] Fallback dev token auth is enabled because no API_TOKEN/API_AUTH_TOKEN is configured and NODE_ENV is not production.')
  }
})

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n[Shutdown] Closing server...')
  campaignSendQueue.stop()
  httpServer.close()
  await prisma.$disconnect()
  process.exit(0)
})
