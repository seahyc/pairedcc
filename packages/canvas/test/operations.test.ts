import { describe, expect, it } from 'vitest'
import { createInput, patchInput } from '../src/operations'

describe('object operation boundary', () => {
  it('accepts the same five primitives exposed by the canvas bridge', () => {
    for (const kind of ['rectangle', 'ellipse', 'text', 'note', 'frame']) {
      expect(createInput.parse({ kind, x: 0, y: 0 }).kind).toBe(kind)
    }
  })
  it('rejects invalid and unbounded object geometry', () => {
    for (const width of [-1, 0, Infinity, NaN, 20001]) {
      expect(createInput.safeParse({ kind: 'rectangle', x: 0, y: 0, width }).success).toBe(false)
    }
  })
  it('requires the revision being changed', () => {
    expect(patchInput.safeParse({ id: 'shape:example', x: 20 }).success).toBe(false)
    expect(patchInput.safeParse({ id: 'shape:example', expectedRevision: 2, x: 20 }).success).toBe(true)
  })
  it('rejects unrecognised colors and object kinds', () => {
    expect(createInput.safeParse({ kind: 'script', x: 0, y: 0 }).success).toBe(false)
    expect(createInput.safeParse({ kind: 'note', x: 0, y: 0, color: 'invalid' }).success).toBe(false)
  })
})
