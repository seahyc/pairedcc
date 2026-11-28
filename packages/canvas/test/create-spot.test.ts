import { describe, expect, it } from 'vitest'
import { createSpot, CREATE_GAP } from '../src/create-spot'

type Rect = { x: number; y: number; w: number; h: number }
const hits = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
const inside = (a: Rect, v: Rect) => a.x >= v.x && a.y >= v.y && a.x + a.w <= v.x + v.w && a.y + a.h <= v.y + v.h
const view = { x: 0, y: 0, w: 1440, h: 900 }
const size = { w: 420, h: 100 }

describe('createSpot (canvas_create without x/y)', () => {
  it('goes in the middle of the view on an empty board', () => {
    const spot = createSpot(size, { view }, [])
    expect(spot).toEqual({ x: 510, y: 400, w: 420, h: 100 })
  })

  it('moves clear of a card in the middle of the view, staying in view', () => {
    const card = { x: 520, y: 380, w: 400, h: 140 }
    const spot = createSpot(size, { view }, [card])
    expect(hits(spot, card)).toBe(false)
    expect(inside(spot, view)).toBe(true)
    // The nearest clear spot, not a jump across the screen.
    const d = Math.hypot(spot.x + spot.w / 2 - 720, spot.y + spot.h / 2 - 450)
    expect(d).toBeLessThan(260)
  })

  it('goes beside the selection, level with its top', () => {
    const sel = { x: 100, y: 200, w: 300, h: 120 }
    const spot = createSpot(size, { view, selection: sel }, [sel])
    expect(spot).toEqual({ x: 100 + 300 + CREATE_GAP, y: 200, w: 420, h: 100 })
  })

  it('beside the selection, steps past what is in the way', () => {
    const sel = { x: 100, y: 200, w: 300, h: 120 }
    const other = { x: 440, y: 180, w: 400, h: 160 }
    const spot = createSpot(size, { view, selection: sel }, [sel, other])
    expect(hits(spot, sel) || hits(spot, other)).toBe(false)
    expect(inside(spot, view)).toBe(true)
  })

  it('a selection at the right edge puts the object under it rather than off screen', () => {
    const sel = { x: 1100, y: 200, w: 300, h: 120 }
    const spot = createSpot(size, { view, selection: sel }, [sel])
    expect(inside(spot, view)).toBe(true)
    expect(hits(spot, sel)).toBe(false)
  })

  it('never covers anything on a crowded view, even when nothing in view is clear', () => {
    const others: Rect[] = []
    for (let x = 0; x < 1440; x += 300) for (let y = 0; y < 900; y += 150) others.push({ x, y, w: 290, h: 140 })
    const spot = createSpot(size, { view }, others)
    expect(others.some((o) => hits(spot, o))).toBe(false)
  })

  it('a view smaller than the object still gives its middle', () => {
    const small = { x: 0, y: 0, w: 390, h: 700 }
    const spot = createSpot(size, { view: small }, [])
    expect(spot.x + spot.w / 2).toBe(195)
  })
})

describe('createSpot beside a selection with something level with its top', () => {
  it('lines up with the selection\'s bottom before going further away', () => {
    const sel = { x: 80, y: 596, w: 260, h: 120 }
    const other = { x: 510, y: 566, w: 420, h: 60 }
    const blocked = { x: 0, y: 800, w: 600, h: 100 } // the window's controls under the selection
    const spot = createSpot({ w: 420, h: 59 }, { view, selection: sel }, [sel, other, blocked])
    expect(spot).toEqual({ x: 80 + 260 + CREATE_GAP, y: 596 + 120 - 59, w: 420, h: 59 })
  })
})
