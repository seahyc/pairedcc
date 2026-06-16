import { readFile } from 'node:fs/promises'
import { PairedClient } from '../client.js'

/**
 * Create a paired.cc doc from a markdown file (or stdin) and print the
 * shareable URL. No API key required — without one you get an anonymous,
 * link-shareable doc; with one the doc is owned by your account.
 */
export async function createCommand(
  file: string | undefined,
  opts: { key?: string; url: string; title?: string },
) {
  const markdown = file ? await readFile(file, 'utf-8') : await readStdin()
  if (!markdown.trim()) {
    console.error('No markdown provided. Pass a file path or pipe markdown via stdin.')
    process.exitCode = 1
    return
  }
  const client = new PairedClient(opts.url, opts.key)
  const result = await client.createDocument(markdown, opts.title)
  if (result?.url) {
    console.log(result.url)
  } else {
    console.error(`Error: ${result?.error ?? 'unknown error'}`)
    process.exitCode = 1
  }
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    process.stdin.setEncoding('utf-8')
    process.stdin.on('data', (chunk) => (data += chunk))
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', reject)
  })
}
