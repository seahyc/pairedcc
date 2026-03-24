import { readdir, readFile } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { sql } from './client.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

export async function migrate() {
  await sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT now()
    )
  `

  const dir = join(__dirname, 'migrations')
  const files = (await readdir(dir)).filter(f => f.endsWith('.sql')).sort()

  for (const file of files) {
    const [applied] = await sql`SELECT 1 FROM _migrations WHERE name = ${file}`
    if (applied) continue

    const content = await readFile(join(dir, file), 'utf-8')
    await sql.begin(async (tx) => {
      await tx.unsafe(content)
      await tx`INSERT INTO _migrations (name) VALUES (${file})`
    })
    console.log(`Applied migration: ${file}`)
  }
}
