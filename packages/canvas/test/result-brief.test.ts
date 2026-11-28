import { describe, expect, it } from 'vitest'
import { briefResult } from '../src/result-brief'
import { optionRichText } from '../src/ask-rules'

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
  it('keeps a card\'s lines: paragraphs and hard breaks come back as newlines', () => {
    const code = { id: 'shape:c', type: 'card', props: { tone: 'code', richText: { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'const a = 1' }, { type: 'hardBreak' }, { type: 'text', text: 'const b = 2' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'return a + b' }] },
    ] } } }
    expect((briefResult(code) as any).text).toBe('const a = 1\nconst b = 2\nreturn a + b')
    const option = { id: 'shape:o', type: 'card', props: { tone: 'agent', richText: optionRichText('A · Charge per seat\nCost to try: Low\nRisk: Churn', ['Cost to try', 'Risk']) } }
    expect((briefResult(option) as any).text).toBe('A · Charge per seat\nCost to try: Low\nRisk: Churn')
  })
  it('makes a result smaller', () => {
    const big = card('agent', ...Array.from({ length: 20 }, (_, i) => `Paragraph ${i} with some words in it`))
    expect(JSON.stringify(briefResult(big)).length).toBeLessThan(JSON.stringify(big).length * 0.6)
  })
})
