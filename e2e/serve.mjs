// Starts the real paired.cc server for the end-to-end tests: builds the document editor,
// serves it from a temporary public directory exactly as production does (/docs), and
// writes the server's output to E2E_SERVER_LOG so tests can follow real magic links.
// Needs DATABASE_URL, REDIS_URL and JWT_SECRET; see e2e/README.md.
import { spawn, execSync } from 'node:child_process'
import { cpSync, createWriteStream, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
for (const name of ['DATABASE_URL', 'REDIS_URL', 'JWT_SECRET', 'E2E_SERVER_LOG', 'PORT']) {
  if (!process.env[name]) {
    console.error(`e2e: ${name} is not set (see e2e/README.md)`)
    process.exit(1)
  }
}

execSync('pnpm --filter @pairedcc/web build', { cwd: root, stdio: 'inherit' })
const work = mkdtempSync(join(tmpdir(), 'paired-e2e-'))
mkdirSync(join(work, 'public'))
cpSync(join(root, 'packages/web/dist'), join(work, 'public/docs'), { recursive: true })

mkdirSync(dirname(process.env.E2E_SERVER_LOG), { recursive: true })
const log = createWriteStream(process.env.E2E_SERVER_LOG, { flags: 'w' })
const server = spawn(join(root, 'packages/server/node_modules/.bin/tsx'), [join(root, 'packages/server/src/index.ts')], {
  cwd: work,
  env: { ...process.env, BASE_URL: `http://localhost:${process.env.PORT}` },
  stdio: ['ignore', 'pipe', 'pipe'],
})
for (const stream of [server.stdout, server.stderr]) {
  stream.on('data', (chunk) => {
    log.write(chunk)
    process.stdout.write(chunk)
  })
}
server.on('exit', (code) => process.exit(code ?? 1))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal))
