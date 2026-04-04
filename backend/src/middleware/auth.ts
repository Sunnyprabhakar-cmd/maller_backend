import { Request, Response, NextFunction } from 'express'

const VALID_TOKEN = process.env.API_TOKEN || process.env.API_AUTH_TOKEN || 'dev-token-12345'

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization
  
  if (!authHeader) {
    return res.status(401).json({ error: 'Missing Authorization header' })
  }

  const token = authHeader.replace('Bearer ', '')
  
  if (token !== VALID_TOKEN) {
    return res.status(401).json({ error: 'Invalid token' })
  }

  next()
}
