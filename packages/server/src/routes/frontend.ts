import { Hono } from 'hono'
import { readFile } from 'node:fs/promises'
import { serveStatic } from '@hono/node-server/serve-static'

/** Default post-login landing (document dashboard / homepage redirect). */
export const DOCS_HOME = '/docs'

/**
 * Map a legacy (pre-/docs) frontend pathname to its new location, or null if
 * the path is not a legacy document-editor route.
 *   /documents, /documents/ → /docs
 *   /login, /settings, /new → /docs/<same>
 *   /d/:id[/...]            → /docs/d/:id[/...]
 */
export function mapLegacyPath(pathname: string): string | null {
  if (pathname === '/documents' || pathname === '/documents/') return DOCS_HOME
  if (/^\/(login|settings|new)\/?$/.test(pathname)) return `/docs${pathname.replace(/\/$/, '')}`
  if (/^\/d\/[^/]+/.test(pathname)) return `/docs${pathname}`
  return null
}

/**
 * Normalize a post-login returnTo target. Only same-origin absolute paths are
 * allowed (no `//host` or schemes); legacy paths are mapped to /docs paths and
 * anything missing, empty or unsafe lands on the docs home.
 */
export function normalizeReturnTo(returnTo: string | null | undefined): string {
  if (!returnTo || !returnTo.startsWith('/') || returnTo.startsWith('//') || returnTo.includes('\\')) {
    return DOCS_HOME
  }
  const [, path, rest] = returnTo.match(/^([^?#]*)(.*)$/)!
  if (path === '/') return DOCS_HOME + rest
  const mapped = mapLegacyPath(path)
  return mapped ? mapped + rest : returnTo
}

/**
 * Frontend routes: legacy redirects, `/` → canvas, static files (document
 * editor build in public/docs, canvas in public/canvas) and the SPA fallback
 * for client-side routes under /docs. Mounted after the API/auth/ws routes.
 */
export function createFrontendRoutes(publicDir = './public') {
  const app = new Hono()

  // The canvas is the landing page. Temporary (302) until it is final.
  app.get('/', (c) => c.redirect('/canvas/'))
  app.get('/canvas', (c) => c.redirect('/canvas/'))

  // Legacy document-editor URLs → /docs/* (301 so shared links keep working).
  // Preserves the query string and rewrites a legacy returnTo param.
  app.all('*', async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return next()
    const target = mapLegacyPath(c.req.path)
    if (!target) return next()
    const url = new URL(c.req.url)
    const returnTo = url.searchParams.get('returnTo')
    if (returnTo !== null) url.searchParams.set('returnTo', normalizeReturnTo(returnTo))
    return c.redirect(target + url.search, 301)
  })

  app.use('/*', serveStatic({ root: publicDir }))

  // SPA history fallback — for client-side routes under /docs (e.g. /docs/d/:id,
  // /docs/settings) the file doesn't exist on disk, so serve the web build's
  // index.html and let React Router handle it. Skips API/auth/ws paths and
  // anything that looks like a static asset (has a file extension).
  app.get('*', async (c) => {
    const path = c.req.path
    if (path !== '/docs' && !path.startsWith('/docs/')) return c.notFound()
    if (/\.[a-zA-Z0-9]+$/.test(path)) return c.notFound()
    try {
      const html = await readFile(`${publicDir}/docs/index.html`, 'utf-8')
      return c.html(html)
    } catch {
      return c.notFound()
    }
  })

  return app
}
