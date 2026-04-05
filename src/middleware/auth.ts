import { Request, Response, NextFunction } from 'express'
import crypto from 'crypto'

const DEV_FALLBACK_TOKEN = 'dev-token-12345'

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function readExplicitBootstrapToken(): string | null {
  const configured = process.env.API_TOKEN || process.env.API_AUTH_TOKEN || ''
  const trimmed = configured.trim()
  return trimmed ? trimmed : null
}

function isProductionEnv(): boolean {
  return String(process.env.NODE_ENV ?? '').trim().toLowerCase() === 'production'
}

function isDevFallbackTokenAccepted(): boolean {
  return !isProductionEnv()
}

export function getAcceptedBootstrapToken(): string | null {
  const explicit = readExplicitBootstrapToken()
  if (explicit) {
    return explicit
  }

  if (isProductionEnv()) {
    return null
  }

  return DEV_FALLBACK_TOKEN
}

export function isFallbackAuthEnabled(): boolean {
  return !readExplicitBootstrapToken() && !isProductionEnv()
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization

  if (!authHeader) {
    return res.status(401).json({ error: 'Missing Authorization header' })
  }

  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Invalid Authorization format' })
  }

  const token = authHeader.slice('Bearer '.length).trim()
  if (!token) {
    return res.status(401).json({ error: 'Invalid token' })
  }

  const bootstrapToken = getAcceptedBootstrapToken()
  const devFallbackAccepted = isDevFallbackTokenAccepted()

  // Allow explicit bootstrap tokens everywhere.
  if (bootstrapToken && token === bootstrapToken) {
    next()
    return
  }

  // In local/non-production use, always keep the fallback token available so the desktop app
  // can talk to the backend even when an explicit bootstrap token is configured in backend/.env.
  if (devFallbackAccepted && token === DEV_FALLBACK_TOKEN) {
    next()
    return
  }

  try {
    const prisma = (req as any).prisma
    if (!prisma) {
      return res.status(500).json({ error: 'Prisma client unavailable on request' })
    }

    const apiToken = await prisma.apiToken.findFirst({
      where: {
        OR: [
          { token: hashToken(token) },
          { token }
        ]
      },
      select: { id: true }
    })

    if (!apiToken?.id) {
      return res.status(401).json({ error: 'Invalid token' })
    }

    await prisma.apiToken.update({
      where: { id: apiToken.id },
      data: { lastUsedAt: new Date() }
    })
  } catch {
    return res.status(500).json({ error: 'Failed to validate API token' })
  }

  next()
}
