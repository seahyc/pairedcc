import { createMiddleware } from 'hono/factory'

/**
 * Normalize a trailing slash on /api/* requests for ALL HTTP methods.
 *
 * Hono routes a request before middleware can change its path, and a path
 * like `/api/documents/` matches a different set of registered routes than
 * `/api/documents` (notably a sibling router's `use('*')` auth guard), so a
 * `POST /api/documents/` returned a misleading 401 instead of creating a doc.
 *
 * Rather than try to re-route in place (Hono has already matched), we strip
 * the trailing slash from the URL and re-dispatch the request through the
 * same app. A loop-guard header prevents infinite recursion.
 *
 * Only paths ending in exactly one `/` (and longer than `/api/`) are touched;
 * everything else passes straight through.
 */
const GUARD_HEADER = 'x-pcc-slash-normalized'

export function createNormalizeApiTrailingSlash(fetchApp: (req: Request) => Response | Promise<Response>) {
  return createMiddleware(async (c, next) => {
    const path = c.req.path
    if (
      c.req.header(GUARD_HEADER) ||
      !path.startsWith('/api/') ||
      path === '/api/' ||
      !path.endsWith('/')
    ) {
      return next()
    }

    const url = new URL(c.req.url)
    url.pathname = url.pathname.replace(/\/+$/, '')
    const headers = new Headers(c.req.raw.headers)
    headers.set(GUARD_HEADER, '1')
    const rewritten = new Request(url.toString(), {
      method: c.req.method,
      headers,
      body:
        c.req.method === 'GET' || c.req.method === 'HEAD' ? undefined : c.req.raw.body,
      // @ts-expect-error duplex is required by undici when streaming a body
      duplex: 'half',
    })
    c.res = await fetchApp(rewritten)
  })
}
