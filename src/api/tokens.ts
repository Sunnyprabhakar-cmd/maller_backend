import { Router, Request, Response } from 'express'
import crypto from 'crypto'
import { PrismaClient } from '@prisma/client'
import { authMiddleware } from '../middleware/auth.js'

const router = Router()

router.use(authMiddleware)

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

// Generate new API token
router.post('/generate', async (req: Request, res: Response) => {
  try {
    const { name } = req.body
    const prisma = (req as any).prisma as PrismaClient

    // Generate random token
    const token = 'mk_' + crypto.randomBytes(32).toString('hex')

    const apiToken = await prisma.apiToken.create({
      data: {
        name: name || 'Generated Token',
        token: hashToken(token)
      }
    })

    res.json({
      id: apiToken.id,
      name: apiToken.name,
      token,
      createdAt: apiToken.createdAt,
      updatedAt: apiToken.updatedAt,
      lastUsedAt: apiToken.lastUsedAt
    })
  } catch (error: any) {
    res.status(400).json({ error: error.message })
  }
})

// Get all tokens (without showing full token)
router.get('/', async (req: Request, res: Response) => {
  try {
    const prisma = (req as any).prisma as PrismaClient
    const tokens = await prisma.apiToken.findMany({
      orderBy: { createdAt: 'desc' }
    })

    // Add masked token for display
    const maskedTokens = tokens.map((t: any) => ({
      id: t.id,
      name: t.name,
      createdAt: t.createdAt,
      lastUsedAt: t.lastUsedAt,
      tokenPreview: '••••••••'
    }))

    res.json(maskedTokens)
  } catch (error: any) {
    res.status(400).json({ error: error.message })
  }
})

// Revoke token
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const prisma = (req as any).prisma as PrismaClient
    await prisma.apiToken.delete({
      where: { id: req.params.id }
    })
    res.json({ success: true })
  } catch (error: any) {
    res.status(400).json({ error: error.message })
  }
})

export default router
