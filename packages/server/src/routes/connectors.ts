import { Hono } from 'hono'
import postgres from 'postgres'
import { requireAuth, optionalAuth } from '../auth/middleware.js'
import { sql } from '../db/client.js'
import { encryptJson, decryptJson } from '../crypto/encrypt.js'

/**
 * Connector management.
 *
 * V1 supports Postgres only. Creds shape for postgres: { url } (a single
 * connection string) or { host, port, database, user, password, ssl? }.
 * Stored encrypted at rest. Never returned to the client — only metadata.
 *
 * Query execution (the actual iframe bridge target) uses the stored creds
 * to open a short-lived postgres client, runs one query, closes. Read-only
 * mode wraps the query in a BEGIN READ ONLY transaction.
 */

export const connectorRoutes = new Hono()

// ---- User connector CRUD (requires auth) ----

connectorRoutes.use('*', requireAuth)

// List the current user's connectors (metadata only — never creds)
connectorRoutes.get('/', async (c) => {
  const { userId } = c.get('user')
  const rows = await sql`
    SELECT id, name, kind, scope, created_at, last_used
    FROM connectors
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
  `
  return c.json(rows)
})

// Create a new connector
connectorRoutes.post('/', async (c) => {
  const { userId } = c.get('user')
  const body = await c.req.json<{
    name: string
    kind: 'postgres'
    scope?: 'read' | 'write'
    creds: Record<string, unknown>
  }>()

  if (!body.name || !body.kind || !body.creds) {
    return c.json({ error: 'name, kind, and creds are required' }, 400)
  }
  if (body.kind !== 'postgres') {
    return c.json({ error: `Unsupported kind: ${body.kind}. Only 'postgres' is supported in V1.` }, 400)
  }
  // Minimal shape validation — we accept `{ url }` or `{ host, user, password, database }`
  const c0 = body.creds as Record<string, unknown>
  if (typeof c0.url !== 'string' && (!c0.host || !c0.database || !c0.user)) {
    return c.json({ error: 'Postgres creds require either `url` or `{host, user, database, password?}`' }, 400)
  }

  let encrypted: string
  try {
    encrypted = encryptJson(body.creds)
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500)
  }

  try {
    const [row] = await sql`
      INSERT INTO connectors (user_id, name, kind, scope, encrypted_creds)
      VALUES (${userId}, ${body.name}, ${body.kind}, ${body.scope || 'read'}, ${encrypted})
      RETURNING id, name, kind, scope, created_at
    `
    return c.json(row, 201)
  } catch (e) {
    const msg = (e as { message?: string }).message || 'unknown'
    if (msg.includes('unique')) return c.json({ error: 'A connector with this name already exists.' }, 409)
    return c.json({ error: msg }, 500)
  }
})

// Delete a connector
connectorRoutes.delete('/:id', async (c) => {
  const { userId } = c.get('user')
  const connectorId = c.req.param('id')
  const result = await sql`DELETE FROM connectors WHERE id = ${connectorId} AND user_id = ${userId}`
  if (result.count === 0) return c.json({ error: 'Not found' }, 404)
  return c.json({ ok: true })
})

// ---- Per-doc grant (mounted as a separate router below) ----

export const docConnectorRoutes = new Hono()

/**
 * GET /api/documents/:id/connectors — list connectors granted to this doc.
 * Owner sees all grants. Other viewers (including public/anon) get 403.
 * (Connectors are never exposed to unsigned-in or non-owner viewers — that
 * would leak which data sources the doc is configured to touch.)
 */
docConnectorRoutes.get('/:id/connectors', requireAuth, async (c) => {
  const { userId } = c.get('user')
  const docId = c.req.param('id')
  const [doc] = await sql`SELECT owner_id FROM documents WHERE id = ${docId}`
  if (!doc) return c.json({ error: 'Not found' }, 404)
  if (doc.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const rows = await sql`
    SELECT c.id, c.name, c.kind, c.scope, dc.granted_at
    FROM document_connectors dc
    JOIN connectors c ON c.id = dc.connector_id
    WHERE dc.document_id = ${docId} AND c.user_id = ${userId}
    ORDER BY dc.granted_at DESC
  `
  return c.json(rows)
})

// Grant a connector to a doc
docConnectorRoutes.post('/:id/connectors/:connectorId', requireAuth, async (c) => {
  const { userId } = c.get('user')
  const docId = c.req.param('id')
  const connectorId = c.req.param('connectorId')
  const [doc] = await sql`SELECT owner_id FROM documents WHERE id = ${docId}`
  if (!doc || doc.owner_id !== userId) return c.json({ error: 'Not found or not owner' }, 404)
  const [conn] = await sql`SELECT id FROM connectors WHERE id = ${connectorId} AND user_id = ${userId}`
  if (!conn) return c.json({ error: 'Connector not found' }, 404)
  await sql`
    INSERT INTO document_connectors (document_id, connector_id)
    VALUES (${docId}, ${connectorId})
    ON CONFLICT DO NOTHING
  `
  return c.json({ ok: true })
})

// Revoke a connector from a doc
docConnectorRoutes.delete('/:id/connectors/:connectorId', requireAuth, async (c) => {
  const { userId } = c.get('user')
  const docId = c.req.param('id')
  const connectorId = c.req.param('connectorId')
  const [doc] = await sql`SELECT owner_id FROM documents WHERE id = ${docId}`
  if (!doc || doc.owner_id !== userId) return c.json({ error: 'Not found or not owner' }, 404)
  await sql`DELETE FROM document_connectors WHERE document_id = ${docId} AND connector_id = ${connectorId}`
  return c.json({ ok: true })
})

/**
 * POST /api/documents/:id/db/:connectorId/query
 *
 * Runs a SQL query via an approved connector. This is the endpoint the
 * iframe's `paired.db(connectorId, query)` bridge hits. Read-only by
 * default (wraps in BEGIN READ ONLY). Write requires scope=write AND
 * an explicit { write: true } flag in the request.
 *
 * Auth rules:
 *   - Public/anonymous docs: always 403 (no connectors on public docs)
 *   - Private docs: caller must be the owner of both the doc AND the
 *     connector, and the connector must be granted to this doc.
 *
 * Returns: { columns: [{name, type}], rows: Record<string,unknown>[], rowCount: number }
 */
docConnectorRoutes.post('/:id/db/:connectorId/query', optionalAuth, async (c) => {
  const user = c.get('user')
  const docId = c.req.param('id')
  const connectorId = c.req.param('connectorId')

  const [doc] = await sql`SELECT owner_id, is_anonymous, is_public FROM documents WHERE id = ${docId}`
  if (!doc) return c.json({ error: 'Not found' }, 404)
  if (doc.is_anonymous || doc.is_public) {
    return c.json({ error: 'Connectors are disabled on public/anonymous docs.' }, 403)
  }
  if (!user) return c.json({ error: 'Unauthorized' }, 401)
  if (doc.owner_id !== user.userId) return c.json({ error: 'Forbidden' }, 403)

  // Verify grant + load connector (only the owner's connectors can run, and only if granted)
  const [row] = await sql`
    SELECT c.id, c.kind, c.scope, c.encrypted_creds
    FROM connectors c
    JOIN document_connectors dc ON dc.connector_id = c.id
    WHERE c.id = ${connectorId} AND c.user_id = ${user.userId} AND dc.document_id = ${docId}
  `
  if (!row) return c.json({ error: 'Connector not granted to this doc' }, 403)

  const body = await c.req.json<{ query: string; params?: unknown[]; write?: boolean }>()
  if (!body.query || typeof body.query !== 'string') {
    return c.json({ error: 'query is required' }, 400)
  }
  const allowWrite = body.write === true && row.scope === 'write'

  let creds: Record<string, unknown>
  try {
    creds = decryptJson<Record<string, unknown>>(row.encrypted_creds)
  } catch (e) {
    return c.json({ error: 'Could not decrypt connector credentials' }, 500)
  }

  if (row.kind !== 'postgres') {
    return c.json({ error: `Unsupported connector kind: ${row.kind}` }, 500)
  }

  // Build the postgres connection. Accept either `url` or discrete fields.
  let client: postgres.Sql
  try {
    if (typeof creds.url === 'string') {
      client = postgres(creds.url, { max: 1, idle_timeout: 5, connect_timeout: 8 })
    } else {
      client = postgres({
        host: String(creds.host || 'localhost'),
        port: Number(creds.port || 5432),
        database: String(creds.database),
        username: String(creds.user),
        password: typeof creds.password === 'string' ? creds.password : undefined,
        ssl: creds.ssl === true || creds.ssl === 'require' ? 'require' : false,
        max: 1,
        idle_timeout: 5,
        connect_timeout: 8,
      })
    }
  } catch (e) {
    return c.json({ error: 'Bad connector configuration: ' + (e as Error).message }, 500)
  }

  try {
    const rows = allowWrite
      ? await client.unsafe(body.query, (body.params || []) as any[])
      : await client.begin('READ ONLY', async (tx) => tx.unsafe(body.query, (body.params || []) as any[]))

    // Update last_used
    await sql`UPDATE connectors SET last_used = now() WHERE id = ${connectorId}`

    return c.json({
      rows,
      rowCount: Array.isArray(rows) ? rows.length : 0,
    })
  } catch (e) {
    return c.json({ error: 'Query error: ' + (e as Error).message }, 400)
  } finally {
    try { await client.end({ timeout: 2 }) } catch {}
  }
})
