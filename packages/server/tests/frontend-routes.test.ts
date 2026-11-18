import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Hono } from 'hono'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFrontendRoutes, mapLegacyPath, normalizeReturnTo } from '../src/routes/frontend.js'

let dir: string
let app: Hono

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'paired-public-'))
  await mkdir(join(dir, 'docs', 'assets'), { recursive: true })
  await mkdir(join(dir, 'canvas'), { recursive: true })
  await writeFile(join(dir, 'docs', 'index.html'), '<html>docs-spa</html>')
  await writeFile(join(dir, 'docs', 'assets', 'a.js'), 'console.log(1)')
  await writeFile(join(dir, 'canvas', 'index.html'), '<html>canvas</html>')
  app = new Hono()
  app.get('/api/health', (c) => c.json({ ok: true }))
  app.route('/', createFrontendRoutes(dir))
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

const get = (path: string) => app.request(path, { redirect: 'manual' })

describe('legacy redirects (301)', () => {
  it.each([
    ['/d/abc', '/docs/d/abc'],
    ['/d/abc?x=1', '/docs/d/abc?x=1'],
    ['/documents', '/docs'],
    ['/settings', '/docs/settings'],
    ['/new', '/docs/new'],
    ['/login', '/docs/login'],
  ])('%s -> %s', async (from, to) => {
    const res = await get(from)
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe(to)
  })

  it('rewrites a legacy returnTo and keeps other params', async () => {
    const res = await get('/login?returnTo=/d/abc&x=1')
    expect(res.status).toBe(301)
    const loc = new URL(res.headers.get('location')!, 'http://x')
    expect(loc.pathname).toBe('/docs/login')
    expect(loc.searchParams.get('returnTo')).toBe('/docs/d/abc')
    expect(loc.searchParams.get('x')).toBe('1')
  })
})

describe('root and canvas', () => {
  it('/ redirects to /canvas/', async () => {
    const res = await get('/')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/canvas/')
  })
  it('/canvas/ is served statically', async () => {
    const res = await get('/canvas/')
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('canvas')
  })
})

describe('/docs SPA', () => {
  it.each(['/docs', '/docs/', '/docs/d/abc', '/docs/settings', '/docs/login'])('%s serves docs index.html', async (p) => {
    const res = await get(p)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('docs-spa')
  })
  it('serves built assets', async () => {
    const res = await get('/docs/assets/a.js')
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('console.log')
  })
  it('missing asset 404s instead of falling back', async () => {
    expect((await get('/docs/assets/missing.js')).status).toBe(404)
  })
})

describe('untouched paths', () => {
  it('/api/health is not redirected', async () => {
    const res = await get('/api/health')
    expect(res.status).toBe(200)
  })
  it('unknown /api and /auth paths 404 rather than SPA fallback', async () => {
    expect((await get('/api/nope')).status).toBe(404)
    expect((await get('/auth/nope')).status).toBe(404)
  })
})

describe('mapLegacyPath / normalizeReturnTo', () => {
  it('maps only legacy paths', () => {
    expect(mapLegacyPath('/docs/d/abc')).toBeNull()
    expect(mapLegacyPath('/api/documents')).toBeNull()
    expect(mapLegacyPath('/canvas/')).toBeNull()
  })
  it('normalizes returnTo', () => {
    expect(normalizeReturnTo(undefined)).toBe('/docs')
    expect(normalizeReturnTo('/')).toBe('/docs')
    expect(normalizeReturnTo('/documents')).toBe('/docs')
    expect(normalizeReturnTo('/d/abc?x=1')).toBe('/docs/d/abc?x=1')
    expect(normalizeReturnTo('/settings')).toBe('/docs/settings')
    expect(normalizeReturnTo('/docs/d/abc')).toBe('/docs/d/abc')
    expect(normalizeReturnTo('/canvas/')).toBe('/canvas/')
    expect(normalizeReturnTo('//evil.com')).toBe('/docs')
    expect(normalizeReturnTo('https://evil.com')).toBe('/docs')
  })
})
