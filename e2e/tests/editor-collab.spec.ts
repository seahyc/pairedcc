import { test, expect } from '@playwright/test'

test.describe('Document collaboration', () => {
  test('two users can edit the same document', async ({ browser, request }) => {
    const ctx1 = await browser.newContext()
    const ctx2 = await browser.newContext()

    // User 1: send magic link and verify
    await request.post('/auth/magic/send', { data: { email: 'user1@test.com' } })
    const jwt1 = await request.fetch('/auth/magic/verify?token=test-token-1')
    const cookies1 = jwt1.headers()['set-cookie']
    await ctx1.addCookies([{ name: 'session', value: extractCookieValue(cookies1), domain: 'localhost', path: '/' }])

    // User 2: send magic link and verify
    await request.post('/auth/magic/send', { data: { email: 'user2@test.com' } })
    const jwt2 = await request.fetch('/auth/magic/verify?token=test-token-2')
    const cookies2 = jwt2.headers()['set-cookie']
    await ctx2.addCookies([{ name: 'session', value: extractCookieValue(cookies2), domain: 'localhost', path: '/' }])

    // User 1 creates a document
    const page1 = await ctx1.newPage()
    await page1.goto('/')
    await page1.click('text=New Document')
    await page1.waitForURL(/\/d\//)
    const docUrl = page1.url()

    // User 2 opens the same document
    const page2 = await ctx2.newPage()
    await page2.goto(docUrl)

    // User 1 types text
    await page1.locator('.ProseMirror').click()
    await page1.keyboard.type('Hello from user 1')

    // Verify text appears in user 2's editor
    await expect(page2.locator('.ProseMirror')).toContainText('Hello from user 1', { timeout: 5000 })

    // Verify presence shows 2 avatars
    await expect(page1.locator('.avatar')).toHaveCount(2, { timeout: 3000 })

    await ctx1.close()
    await ctx2.close()
  })
})

function extractCookieValue(setCookie: string): string {
  return setCookie.split(';')[0].split('=')[1]
}
