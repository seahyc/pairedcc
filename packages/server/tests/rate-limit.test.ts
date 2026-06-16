import { describe, it, expect } from 'vitest'
import { checkRateLimit } from '../src/middleware/rate-limit.js'

/** In-memory stand-in for the ioredis client surface the limiter touches. */
function fakeRedis() {
  const store = new Map<string, number>()
  return {
    store,
    incr: async (k: string) => {
      const v = (store.get(k) ?? 0) + 1
      store.set(k, v)
      return v
    },
    expire: async (_k: string, _s: number) => 1,
  }
}

describe('checkRateLimit', () => {
  it('allows up to the limit then blocks', async () => {
    const r = fakeRedis()
    const results: boolean[] = []
    for (let i = 0; i < 5; i++) {
      const { allowed } = await checkRateLimit(r as any, 'k', 3, 60)
      results.push(allowed)
    }
    expect(results).toEqual([true, true, true, false, false])
  })

  it('sets TTL only on the first hit of a window', async () => {
    const r = fakeRedis()
    let expireCalls = 0
    const wrapped = {
      incr: r.incr,
      expire: async (k: string, s: number) => { expireCalls++; return r.expire(k, s) },
    }
    await checkRateLimit(wrapped as any, 'k', 10, 60)
    await checkRateLimit(wrapped as any, 'k', 10, 60)
    await checkRateLimit(wrapped as any, 'k', 10, 60)
    expect(expireCalls).toBe(1)
  })

  it('keys are independent', async () => {
    const r = fakeRedis()
    expect((await checkRateLimit(r as any, 'a', 1, 60)).allowed).toBe(true)
    expect((await checkRateLimit(r as any, 'a', 1, 60)).allowed).toBe(false)
    expect((await checkRateLimit(r as any, 'b', 1, 60)).allowed).toBe(true)
  })
})
