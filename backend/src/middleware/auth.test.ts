import test from 'node:test'
import assert from 'node:assert/strict'

type MockResponse = {
  statusCode: number
  body: any
  status: (code: number) => MockResponse
  json: (payload: any) => MockResponse
}

function createResponse(): MockResponse {
  return {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(payload: any) {
      this.body = payload
      return this
    }
  }
}

test('authMiddleware accepts a hashed database token and updates lastUsedAt', async () => {
  process.env.API_TOKEN = 'bootstrap-token'
  const { authMiddleware } = await import('./auth.js')

  let updatedId = ''
  const prisma = {
    apiToken: {
      findFirst: async ({ where }: any) => {
        assert.ok(Array.isArray(where.OR))
        assert.equal(where.OR[1].token, 'plain-db-token')
        return { id: 'token-1' }
      },
      update: async ({ where }: any) => {
        updatedId = where.id
        return { id: where.id }
      }
    }
  }

  const req: any = {
    headers: {
      authorization: 'Bearer plain-db-token'
    },
    prisma
  }
  const res = createResponse()
  let nextCalled = false

  await authMiddleware(req, res as any, () => {
    nextCalled = true
  })

  assert.equal(nextCalled, true)
  assert.equal(updatedId, 'token-1')
  assert.equal(res.statusCode, 200)
})

test('authMiddleware rejects invalid authorization format', async () => {
  process.env.API_TOKEN = 'bootstrap-token'
  const { authMiddleware } = await import('./auth.js')

  const req: any = {
    headers: {
      authorization: 'Token nope'
    },
    prisma: {}
  }
  const res = createResponse()
  let nextCalled = false

  await authMiddleware(req, res as any, () => {
    nextCalled = true
  })

  assert.equal(nextCalled, false)
  assert.equal(res.statusCode, 401)
  assert.deepEqual(res.body, { error: 'Invalid Authorization format' })
})

test('authMiddleware rejects unknown tokens', async () => {
  process.env.API_TOKEN = 'bootstrap-token'
  const { authMiddleware } = await import('./auth.js')

  const req: any = {
    headers: {
      authorization: 'Bearer missing-token'
    },
    prisma: {
      apiToken: {
        findFirst: async () => null,
        update: async () => {
          throw new Error('should not update')
        }
      }
    }
  }
  const res = createResponse()
  let nextCalled = false

  await authMiddleware(req, res as any, () => {
    nextCalled = true
  })

  assert.equal(nextCalled, false)
  assert.equal(res.statusCode, 401)
  assert.deepEqual(res.body, { error: 'Invalid token' })
})
