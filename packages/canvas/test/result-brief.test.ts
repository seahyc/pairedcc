import { describe, expect, it } from 'vitest'
import { briefResult } from '../src/result-brief'

const doc = (...paras: string[]) => ({ type: 'doc', content: paras.map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })) })
const card = (tone: string, ...paras: string[]) => ({ id: 'shape:a', type: 'card', revision: 0, props: { w: 420, tone, richText: doc(...paras) } })

describe('briefResult (item 140 (e), (i))', () => {
  it('gives a created card its words as text, not rich text', () => {
    const out = briefResult(card('agent', 'Two', 'lines')) as any
    expect(out.props.richText).toBeUndefined()
    expect(out.props.w).toBe(420)
    expect(out.text).toContain('Two')
    expect(out.text).toContain('lines')
  })
  it('echoes a heading card\'s style', () => {
    expect((briefResult(card('heading', 'Plan')) as any).style).toBe('heading')
    expect((briefResult(card('agent', 'x')) as any).style).toBe('note')
  })
  it('reaches objects nested in a result (scene, arrange, reply)', () => {
    const out = briefResult({ objects: { a: card('agent', 'A') }, reply: card('agent', 'B'), list: [card('code', 'C')] }) as any
    expect(out.objects.a.props.richText).toBeUndefined()
    expect(out.reply.text).toBe('B')
    expect(out.list[0].style).toBe('code')
  })
  it('keeps meta as it is and leaves objects without rich text alone', () => {
    const geo = { id: 'shape:g', type: 'geo', props: { w: 10, geo: 'rectangle' }, meta: { richText: 'kept' } }
    expect(briefResult(geo)).toEqual(geo)
    expect(briefResult(null)).toBeNull()
    expect(briefResult('ok')).toBe('ok')
  })
  it('makes a result smaller', () => {
    const big = card('agent', ...Array.from({ length: 20 }, (_, i) => `Paragraph ${i} with some words in it`))
    expect(JSON.stringify(briefResult(big)).length).toBeLessThan(JSON.stringify(big).length * 0.6)
  })
})
