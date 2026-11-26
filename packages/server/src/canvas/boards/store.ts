import { z } from 'zod'

// Server-side canvas boards. A board belongs to one account and carries a revision
// number; a save names the revision it replaces and is rejected if the board has moved
// on, the same contract the canvas applies to objects (`expectedRevision`). Revision 0
// means "create": the board must not exist yet.

export const MAX_BOARD_BYTES = 10 * 1024 * 1024
export const KEEP_REVISIONS = 50
/**
 * Boards one account may keep. Well above normal use (sync adds a board only when it
 * cannot merge), and with the 10 MB and 50-revision caps it bounds one account's storage.
 * Saving an existing board is never limited; only creating one past the cap is refused.
 */
export const MAX_BOARDS_PER_ACCOUNT = 50
export type BoardLimits = { maxBoards: number }
export const defaultLimits: BoardLimits = { maxBoards: MAX_BOARDS_PER_ACCOUNT }

export const boardIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'Board IDs are 1–64 letters, digits, - or _')
/** The tldraw document: store records keyed by ID, and the schema they were written with. */
export const snapshotSchema = z
  .object({
    store: z.record(z.string(), z.object({ id: z.string(), typeName: z.string() }).passthrough()),
    schema: z.object({ schemaVersion: z.number() }).passthrough(),
  })
  .strict()
export const saveSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    name: z.string().trim().min(1).max(200).optional(),
    snapshot: snapshotSchema,
  })
  .strict()

export type Snapshot = z.infer<typeof snapshotSchema>
export type BoardSummary = { id: string; name: string; revision: number; sizeBytes: number; updatedAt: string }
export type Board = BoardSummary & { snapshot: Snapshot }
export type RevisionSummary = { revision: number; sizeBytes: number; savedAt: string }
export type SaveInput = { expectedRevision: number; name?: string; snapshot: Snapshot }
export type SaveResult =
  | { ok: true; board: BoardSummary }
  | { ok: false; reason: 'stale'; current: BoardSummary }
  | { ok: false; reason: 'missing' }
  | { ok: false; reason: 'limit'; limit: number }
export type RemoveResult = { ok: true } | { ok: false; reason: 'stale'; current: BoardSummary } | { ok: false; reason: 'missing' }

export interface BoardStore {
  list(userId: string): Promise<BoardSummary[]>
  get(userId: string, id: string): Promise<Board | null>
  save(userId: string, id: string, input: SaveInput): Promise<SaveResult>
  remove(userId: string, id: string, expectedRevision: number): Promise<RemoveResult>
  revisions(userId: string, id: string): Promise<RevisionSummary[] | null>
  revision(userId: string, id: string, revision: number): Promise<(RevisionSummary & { snapshot: Snapshot }) | null>
}

/** The name stored in the tldraw document record, if any. */
export function documentName(snapshot: Snapshot): string | undefined {
  const doc = snapshot.store['document:document'] as { name?: unknown } | undefined
  return typeof doc?.name === 'string' && doc.name.trim() ? wellFormed(doc.name.trim().slice(0, 200)) : undefined
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

/**
 * The same value with every unpaired UTF-16 surrogate (half of an emoji, left by text
 * clipped mid-character) replaced by U+FFFD. PostgreSQL rejects such text in JSONB, which
 * would fail the whole board's save; paired characters and everything else are untouched.
 */
export function wellFormed<T>(value: T): T {
  if (typeof value === 'string') return value.replace(LONE_SURROGATE, '\uFFFD') as T
  if (Array.isArray(value)) return value.map(wellFormed) as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      const key = wellFormed(k)
      // Two keys that differ only by a broken character would become one, losing a value
      // (a dataset column, say). Refuse rather than store a board with data missing.
      if (key !== k && Object.prototype.hasOwnProperty.call(value, key)) throw new BrokenTextError(key)
      if (Object.prototype.hasOwnProperty.call(out, key)) throw new BrokenTextError(key)
      out[key] = wellFormed(v)
    }
    return out as T
  }
  return value
}

/** A board whose keys would collide once their broken characters are repaired. */
export class BrokenTextError extends Error {
  constructor(readonly key: string) {
    super(`Two names on this board differ only by a broken character (${JSON.stringify(key)}); rename one and save again.`)
    this.name = 'BrokenTextError'
  }
}

/** A save as stored: text made well-formed (see wellFormed). */
export const storable = (input: SaveInput): SaveInput => ({ ...input, ...(input.name ? { name: wellFormed(input.name) } : {}), snapshot: wellFormed(input.snapshot) })

export const byteSize = (snapshot: Snapshot) => Buffer.byteLength(JSON.stringify(snapshot))

type Stored = Board & { history: (RevisionSummary & { snapshot: Snapshot })[] }

/** In-memory store with the same semantics as the Postgres store; used by tests. */
export class MemoryBoardStore implements BoardStore {
  private boards = new Map<string, Stored>()
  constructor(
    private now: () => Date = () => new Date(),
    private limits: BoardLimits = defaultLimits,
  ) {}
  /** The same boards under different limits (tests). */
  withLimits(limits: BoardLimits) {
    const view = new MemoryBoardStore(this.now, limits)
    view.boards = this.boards
    return view
  }
  private key = (userId: string, id: string) => `${userId}\u0000${id}`
  private summary = ({ id, name, revision, sizeBytes, updatedAt }: Stored): BoardSummary => ({ id, name, revision, sizeBytes, updatedAt })

  async list(userId: string) {
    return [...this.boards.entries()]
      .filter(([k]) => k.startsWith(`${userId}\u0000`))
      .map(([, b]) => this.summary(b))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
  }
  async get(userId: string, id: string) {
    const b = this.boards.get(this.key(userId, id))
    return b ? { ...this.summary(b), snapshot: structuredClone(b.snapshot) } : null
  }
  async save(userId: string, id: string, raw: SaveInput): Promise<SaveResult> {
    const input = storable(raw)
    const k = this.key(userId, id)
    const current = this.boards.get(k)
    const at = this.now().toISOString(), sizeBytes = byteSize(input.snapshot)
    const name = input.name ?? documentName(input.snapshot)
    if (!current) {
      if (input.expectedRevision !== 0) return { ok: false, reason: 'missing' }
      // Counted synchronously, so concurrent creates cannot interleave past the cap.
      const owned = [...this.boards.keys()].filter((key) => key.startsWith(`${userId}\u0000`)).length
      if (owned >= this.limits.maxBoards) return { ok: false, reason: 'limit', limit: this.limits.maxBoards }
      const board: Stored = { id, name: name ?? 'Untitled exploration', revision: 1, sizeBytes, updatedAt: at, snapshot: structuredClone(input.snapshot), history: [] }
      board.history.push({ revision: 1, sizeBytes, savedAt: at, snapshot: board.snapshot })
      this.boards.set(k, board)
      return { ok: true, board: this.summary(board) }
    }
    if (current.revision !== input.expectedRevision) return { ok: false, reason: 'stale', current: this.summary(current) }
    const revision = current.revision + 1
    Object.assign(current, { revision, sizeBytes, updatedAt: at, snapshot: structuredClone(input.snapshot), ...(name ? { name } : {}) })
    current.history.push({ revision, sizeBytes, savedAt: at, snapshot: current.snapshot })
    current.history.splice(0, Math.max(0, current.history.length - KEEP_REVISIONS))
    return { ok: true, board: this.summary(current) }
  }
  async remove(userId: string, id: string, expectedRevision: number): Promise<RemoveResult> {
    const k = this.key(userId, id), current = this.boards.get(k)
    if (!current) return { ok: false, reason: 'missing' }
    if (current.revision !== expectedRevision) return { ok: false, reason: 'stale', current: this.summary(current) }
    this.boards.delete(k)
    return { ok: true }
  }
  async revisions(userId: string, id: string) {
    const b = this.boards.get(this.key(userId, id))
    return b ? b.history.map(({ revision, sizeBytes, savedAt }) => ({ revision, sizeBytes, savedAt })).reverse() : null
  }
  async revision(userId: string, id: string, revision: number) {
    const r = this.boards.get(this.key(userId, id))?.history.find((h) => h.revision === revision)
    return r ? { ...r, snapshot: structuredClone(r.snapshot) } : null
  }
}
