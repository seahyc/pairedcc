import type postgres from 'postgres'
import { byteSize, revisionsToKeep, defaultLimits, documentName, type BoardLimits, type BoardStore, type BoardSummary, type RemoveResult, type SaveInput, type SaveResult, type Snapshot, storable } from './store.js'

// Postgres board store (migration 007). Every save is one transaction: a conditional
// UPDATE on the expected revision (or an INSERT for revision 0), a revision row, and
// pruning. Concurrent saves against the same revision cannot both succeed.

type Row = { id: string; name: string; revision: number; size_bytes: number; updated_at: Date }
const summary = (r: Row): BoardSummary => ({ id: r.id, name: r.name, revision: r.revision, sizeBytes: r.size_bytes, updatedAt: r.updated_at.toISOString() })

export class PostgresBoardStore implements BoardStore {
  constructor(
    private sql: postgres.Sql,
    private limits: BoardLimits = defaultLimits,
  ) {}

  async list(userId: string) {
    const rows = await this.sql<Row[]>`
      SELECT id, name, revision, size_bytes, updated_at FROM canvas_boards
      WHERE user_id = ${userId} ORDER BY updated_at DESC, id`
    return rows.map(summary)
  }

  async get(userId: string, id: string) {
    const [row] = await this.sql<(Row & { snapshot: Snapshot })[]>`
      SELECT id, name, revision, size_bytes, updated_at, snapshot FROM canvas_boards
      WHERE user_id = ${userId} AND id = ${id}`
    return row ? { ...summary(row), snapshot: row.snapshot } : null
  }

  async save(userId: string, id: string, raw: SaveInput): Promise<SaveResult> {
    const input = storable(raw)
    const sizeBytes = byteSize(input.snapshot)
    const name = input.name ?? documentName(input.snapshot) ?? null
    const json = this.sql.json(input.snapshot as never)
    return this.sql.begin(async (t) => {
      // postgres.js types drop the call signature on transactions; it is callable at run time.
      const tx = t as unknown as postgres.Sql
      let row: Row | undefined
      if (input.expectedRevision === 0) {
        // Creates for one account queue on a lock, so concurrent creates cannot pass the cap together.
        await tx`SELECT pg_advisory_xact_lock(hashtext(${`canvas_boards:${userId}`}))`
        const [{ count }] = await tx<{ count: number }[]>`
          SELECT count(*)::int AS count FROM canvas_boards WHERE user_id = ${userId} AND id <> ${id}`
        const [exists] = await tx`SELECT 1 FROM canvas_boards WHERE user_id = ${userId} AND id = ${id}`
        if (!exists && count >= this.limits.maxBoards) return { ok: false as const, reason: 'limit' as const, limit: this.limits.maxBoards }
        ;[row] = await tx<Row[]>`
          INSERT INTO canvas_boards (user_id, id, name, revision, snapshot, size_bytes)
          VALUES (${userId}, ${id}, ${name ?? 'Untitled exploration'}, 1, ${json}, ${sizeBytes})
          ON CONFLICT (user_id, id) DO NOTHING
          RETURNING id, name, revision, size_bytes, updated_at`
      } else {
        ;[row] = await tx<Row[]>`
          UPDATE canvas_boards SET revision = revision + 1, snapshot = ${json}, size_bytes = ${sizeBytes},
            name = COALESCE(${name}, name), updated_at = now()
          WHERE user_id = ${userId} AND id = ${id} AND revision = ${input.expectedRevision}
          RETURNING id, name, revision, size_bytes, updated_at`
      }
      if (!row) {
        const [current] = await tx<Row[]>`
          SELECT id, name, revision, size_bytes, updated_at FROM canvas_boards WHERE user_id = ${userId} AND id = ${id}`
        return current ? { ok: false as const, reason: 'stale' as const, current: summary(current) } : { ok: false as const, reason: 'missing' as const }
      }
      await tx`
        INSERT INTO canvas_board_revisions (user_id, board_id, revision, snapshot, size_bytes)
        VALUES (${userId}, ${id}, ${row.revision}, ${json}, ${sizeBytes})`
      const history = await tx<{ revision: number; saved_at: Date }[]>`
        SELECT revision, saved_at FROM canvas_board_revisions WHERE user_id = ${userId} AND board_id = ${id}`
      const keep = [...revisionsToKeep(history.map((h) => ({ revision: h.revision, savedAt: h.saved_at.toISOString() })))]
      await tx`
        DELETE FROM canvas_board_revisions
        WHERE user_id = ${userId} AND board_id = ${id} AND NOT (revision = ANY(${keep}::int[]))`
      return { ok: true as const, board: summary(row) }
    }) as Promise<SaveResult>
  }

  async remove(userId: string, id: string, expectedRevision: number): Promise<RemoveResult> {
    const deleted = await this.sql`
      DELETE FROM canvas_boards WHERE user_id = ${userId} AND id = ${id} AND revision = ${expectedRevision} RETURNING id`
    if (deleted.length) return { ok: true }
    const [current] = await this.sql<Row[]>`
      SELECT id, name, revision, size_bytes, updated_at FROM canvas_boards WHERE user_id = ${userId} AND id = ${id}`
    return current ? { ok: false, reason: 'stale', current: summary(current) } : { ok: false, reason: 'missing' }
  }

  async revisions(userId: string, id: string) {
    const [exists] = await this.sql`SELECT 1 FROM canvas_boards WHERE user_id = ${userId} AND id = ${id}`
    if (!exists) return null
    const rows = await this.sql<{ revision: number; size_bytes: number; saved_at: Date }[]>`
      SELECT revision, size_bytes, saved_at FROM canvas_board_revisions
      WHERE user_id = ${userId} AND board_id = ${id} ORDER BY revision DESC`
    return rows.map((r) => ({ revision: r.revision, sizeBytes: r.size_bytes, savedAt: r.saved_at.toISOString() }))
  }

  async revision(userId: string, id: string, revision: number) {
    const [r] = await this.sql<{ revision: number; size_bytes: number; saved_at: Date; snapshot: Snapshot }[]>`
      SELECT revision, size_bytes, saved_at, snapshot FROM canvas_board_revisions
      WHERE user_id = ${userId} AND board_id = ${id} AND revision = ${revision}`
    return r ? { revision: r.revision, sizeBytes: r.size_bytes, savedAt: r.saved_at.toISOString(), snapshot: r.snapshot } : null
  }
}
