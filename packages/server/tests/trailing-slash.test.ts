import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { createNormalizeApiTrailingSlash } from '../src/middleware/trailing-slash.js'

/**
 * Reproduces the production footgun: two routers mounted on the same prefix,
 * one with a bare `POST /` handler and a sibling with a `use('*')` auth guard.
 * Without normalization, a trailing-slash POST falls through to the guard and
 * returns 401 instead of hitting the create handler.
 */
function buildApp() {
  const app = new Hono()
  app.use('/api/*', createNormalizeApiTrailingSlash((req) => app.fetch(req)))

  const createRouter = new Hono()
  createRouter.post('/', (c) => c.json({ created: true }, 201))
  createRouter.get('/', (c) => c.json({ list: true }))

  const guardedRouter = new Hono()
  guardedRouter.use('*', async (c, next) => {
    // emulate requireAuth-style guard
    if (!c.req.header('authorization')) return c.json({ error: 'Unauthorized' }, 401)
    await next()
  })
  guardedRouter.get('/:id/secret', (c) => c.json({ ok: true }))

  app.route('/api/documents', createRouter)
  app.route('/api/documents', guardedRouter)
  return app
}

describe('trailing-slash normalization', () => {
  it('POST without slash creates (baseline)', async () => {
    const app = buildApp()
    const res = await app.request('/api/documents', { method: 'POST' })
    expect(res.status).toBe(201)
  })

  it('POST WITH trailing slash also creates (no misleading 401)', async () => {
    const app = buildApp()
    const res = await app.request('/api/documents/', { method: 'POST' })
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ created: true })
  })

  it('GET with trailing slash routes to the list handler', async () => {
    const app = buildApp()
    const res = await app.request('/api/documents/', { method: 'GET' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ list: true })
  })

  it('preserves the POST body across the rewrite', async () => {
    const app = new Hono()
    app.use('/api/*', createNormalizeApiTrailingSlash((req) => app.fetch(req)))
    const r = new Hono()
    r.post('/echo', async (c) => c.json(await c.req.json()))
    app.route('/api/x', r)
    const res = await app.request('/api/x/echo/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hello: 'world' }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ hello: 'world' })
  })

  it('does not touch non-/api paths', async () => {
    const app = new Hono()
    app.use('/api/*', createNormalizeApiTrailingSlash((req) => app.fetch(req)))
    app.get('/page/', (c) => c.text('with-slash'))
    const res = await app.request('/page/')
    expect(await res.text()).toBe('with-slash')
  })

  it('leaves the API root alone', async () => {
    const app = new Hono()
    app.use('/api/*', createNormalizeApiTrailingSlash((req) => app.fetch(req)))
    app.get('/api/', (c) => c.text('root'))
    const res = await app.request('/api/')
    expect(await res.text()).toBe('root')
  })
})
