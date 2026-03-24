import { sql } from '../db/client.js'

export interface SnapshotMeta {
  id: string
  authorId: string
  authorType: 'human' | 'agent'
  description: string | null
  createdAt: Date
}

export interface SnapshotStore {
  save(docId: string, data: Uint8Array, meta: { authorId: string; authorType: string; description?: string }): Promise<void>
  load(docId: string): Promise<Uint8Array | null>
  list(docId: string): Promise<SnapshotMeta[]>
  loadById(snapshotId: string): Promise<Uint8Array | null>
}

export class PostgresSnapshotStore implements SnapshotStore {
  async save(docId: string, data: Uint8Array, meta: { authorId: string; authorType: string; description?: string }): Promise<void> {
    await sql`
      INSERT INTO document_snapshots (document_id, author_id, author_type, yjs_snapshot, description)
      VALUES (${docId}, ${meta.authorId}, ${meta.authorType}, ${Buffer.from(data)}, ${meta.description || null})
    `
    // Also update the main document's yjs_state
    await sql`
      UPDATE documents SET yjs_state = ${Buffer.from(data)}, updated_at = now()
      WHERE id = ${docId}
    `
  }

  async load(docId: string): Promise<Uint8Array | null> {
    const [row] = await sql`
      SELECT yjs_snapshot FROM document_snapshots
      WHERE document_id = ${docId}
      ORDER BY created_at DESC LIMIT 1
    `
    if (!row) return null
    return new Uint8Array(row.yjs_snapshot)
  }

  async loadById(snapshotId: string): Promise<Uint8Array | null> {
    const [row] = await sql`SELECT yjs_snapshot FROM document_snapshots WHERE id = ${snapshotId}`
    if (!row) return null
    return new Uint8Array(row.yjs_snapshot)
  }

  async list(docId: string): Promise<SnapshotMeta[]> {
    const rows = await sql`
      SELECT id, author_id, author_type, description, created_at
      FROM document_snapshots
      WHERE document_id = ${docId}
      ORDER BY created_at DESC
    `
    return rows.map(r => ({
      id: r.id,
      authorId: r.author_id,
      authorType: r.author_type,
      description: r.description,
      createdAt: r.created_at,
    }))
  }
}
