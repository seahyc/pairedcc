import { useEffect, useRef, useState } from 'react'
import type { BlockRendererProps } from './registry'

/**
 * `pairedcc:scrolly` — scrollytelling stepper. Left column scrolls with N
 * text steps; right column is a sticky pane that swaps content as each step
 * enters view. The NYT-style explainer format in ~50 lines.
 *
 * props:
 *   {
 *     steps: Array<{ text: string; panel: string }>,
 *     // panel is HTML — supports <img>, <svg>, inline styles. Agent authored.
 *   }
 */
export function ScrollyRenderer({ props }: BlockRendererProps) {
  const p = (props && typeof props === 'object' ? props : {}) as {
    steps?: Array<{ text?: string; panel?: string }>
  }
  const steps = Array.isArray(p.steps) ? p.steps : []
  const [active, setActive] = useState(0)
  const stepRefs = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => {
    if (steps.length === 0) return
    const io = new IntersectionObserver((entries) => {
      // Pick the step whose center is closest to the viewport center.
      const visible = entries.filter(e => e.isIntersecting)
      if (visible.length === 0) return
      const closest = visible.reduce((best, e) => {
        const rect = e.boundingClientRect
        const center = rect.top + rect.height / 2
        const viewCenter = window.innerHeight / 2
        const dist = Math.abs(center - viewCenter)
        return dist < best.dist ? { target: e.target, dist } : best
      }, { target: visible[0].target, dist: Infinity })
      const idx = stepRefs.current.findIndex(r => r === closest.target)
      if (idx >= 0) setActive(idx)
    }, {
      threshold: [0, 0.5, 1],
      rootMargin: '-30% 0px -30% 0px',
    })
    stepRefs.current.forEach(el => el && io.observe(el))
    return () => io.disconnect()
  }, [steps.length])

  if (steps.length === 0) {
    return (
      <div className="pcc-renderer pcc-renderer--scrolly">
        <div className="pcc-renderer-label">scrolly</div>
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          Set <code>props.steps</code> to an array of <code>{`{text, panel}`}</code>.
        </p>
      </div>
    )
  }

  return (
    <div className="pcc-renderer pcc-renderer--scrolly">
      <div className="pcc-renderer-label">scrolly · {steps.length} steps</div>
      <div className="pcc-scrolly-layout">
        <div className="pcc-scrolly-steps">
          {steps.map((s, i) => (
            <div
              key={i}
              ref={el => { stepRefs.current[i] = el }}
              className={`pcc-scrolly-step ${i === active ? 'is-active' : ''}`}
            >
              <p>{s.text}</p>
            </div>
          ))}
        </div>
        <div className="pcc-scrolly-panel">
          <div
            className="pcc-scrolly-panel-inner"
            // Agent-authored content. This is unsandboxed — scrolly panels are
            // static HTML only, no <script>. For anything interactive, use
            // pairedcc:react. We strip script tags defensively.
            dangerouslySetInnerHTML={{ __html: stripScripts(steps[active]?.panel || '') }}
          />
        </div>
      </div>
    </div>
  )
}

function stripScripts(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
}
