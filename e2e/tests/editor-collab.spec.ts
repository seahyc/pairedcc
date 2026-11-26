import { test, expect, type Browser, type APIRequestContext } from '@playwright/test'
import { readFileSync } from 'node:fs'

// Signs in through the real magic-link flow: request a link, read it from the server's log
// (the server prints links until email sending exists), and open it in that user's browser.
async function signIn(browser: Browser, request: APIRequestContext, email: string) {
  const sent = await request.post('/auth/magic/send', { data: { email, returnTo: '/docs' } })
  expect(sent.ok()).toBe(true)
  let link: string | undefined
  await expect
    .poll(() => {
      const log = readFileSync(process.env.E2E_SERVER_LOG!, 'utf8')
      link = [...log.matchAll(/Magic link for (\S+): (\S+)/g)].reverse().find((m) => m[1] === email)?.[2]
      return link
    }, { message: `magic link for ${email} in the server log` })
    .toBeTruthy()
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(link!)
  await page.waitForURL(/\/docs\/?$/)
  expect((await context.cookies()).some((c) => c.name === 'session')).toBe(true)
  return { context, page, email }
}

test.describe('Document collaboration', () => {
  test('two users can edit the same document', async ({ browser, request }) => {
    // Synthetic addresses, unique per run so reruns against the same database stay independent.
    const run = Date.now()
    const user1 = await signIn(browser, request, `user1-${run}@example.test`)
    const user2 = await signIn(browser, request, `user2-${run}@example.test`)

    // User 1 creates a document
    const page1 = user1.page
    await page1.click('text=New Document')
    await page1.waitForURL(/\/docs\/d\//)
    const docUrl = page1.url()

    // User 1 invites user 2 through Share (a signed-in user's document is private until shared)
    await page1.getByRole('button', { name: 'Share' }).click()
    await page1.getByPlaceholder('email@example.com').fill(user2.email)
    await page1.getByRole('button', { name: 'Invite' }).click()
    await expect(page1.locator('.collab-row')).toContainText(user2.email)
    await page1.getByRole('button', { name: 'Close' }).click()

    // User 2 opens the same document
    const page2 = user2.page
    await page2.goto(docUrl)
    await expect(page2.locator('.ProseMirror')).toBeVisible()

    // User 1 types text
    await page1.locator('.ProseMirror').click()
    await page1.keyboard.type('Hello from user 1')

    // Verify text appears in user 2's editor
    await expect(page2.locator('.ProseMirror')).toContainText('Hello from user 1', { timeout: 5000 })

    // Verify presence shows 2 avatars
    await expect(page1.locator('.avatar')).toHaveCount(2, { timeout: 3000 })

    await user1.context.close()
    await user2.context.close()
  })
})
