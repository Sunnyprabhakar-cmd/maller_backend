import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import cors from 'cors'
import dotenv from 'dotenv'
import { PrismaClient } from '@prisma/client'

// Routes
import campaignRoutes from './api/campaigns.js'
import webhookRoutes from './api/webhooks.js'
import tokenRoutes from './api/tokens.js'

dotenv.config()

const app = express()
const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: {
    origin: process.env.ELECTRON_ORIGIN || 'http://localhost:5173',
    methods: ['GET', 'POST']
  }
})

const prisma = new PrismaClient()

// Middleware
app.use(cors({
  origin: process.env.ELECTRON_ORIGIN || 'http://localhost:5173'
}))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Attach prisma and io to requests
app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
  ;(req as any).prisma = prisma
  ;(req as any).io = io
  next()
})

// Health check
app.get('/health', (req: express.Request, res: express.Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
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
})

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n[Shutdown] Closing server...')
  httpServer.close()
  await prisma.$disconnect()
  process.exit(0)
})
