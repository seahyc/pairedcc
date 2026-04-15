import { useEffect, useMemo, useRef } from 'react'
import type { BlockRendererProps } from './registry'

/**
 * `pairedcc:chart` — opinionated data viz with d3-quality defaults baked in.
 *
 * props shape:
 *   {
 *     kind: 'line' | 'bar' | 'area',
 *     data: Array<Record<string, number | string>>,
 *     x: string,        // key in data
 *     y: string,        // key in data
 *     title?: string,
 *     color?: string,   // default palette entry
 *   }
 *
 * Renders via pure SVG to avoid the 300KB d3 core dep. Handles the 80% of
 * "I need a chart" cases — line, bar, area — with sensible defaults so
 * agents don't have to specify margins, axes, colors. For anything fancier
 * (brushed, layered, interactive), use pairedcc:react with d3.
 */
export function ChartRenderer({ props }: BlockRendererProps) {
  const p = (props && typeof props === 'object' ? props : {}) as {
    kind?: string
    data?: Array<Record<string, unknown>>
    x?: string
    y?: string
    title?: string
    color?: string
  }
  const data = Array.isArray(p.data) ? p.data : []
  const xKey = p.x || 'x'
  const yKey = p.y || 'y'
  const kind = p.kind || 'line'
  const color = p.color || '#4a9eff'

  const ref = useRef<SVGSVGElement | null>(null)

  const viz = useMemo(() => {
    if (data.length === 0) return null
    const width = 640
    const height = 260
    const margin = { top: 24, right: 16, bottom: 32, left: 40 }
    const w = width - margin.left - margin.right
    const h = height - margin.top - margin.bottom

    const xVals = data.map(d => d[xKey])
    const yVals = data.map(d => Number(d[yKey] ?? 0))
    const yMax = Math.max(...yVals, 0)
    const yMin = Math.min(...yVals, 0)
    const yPad = (yMax - yMin) * 0.08 || 1
    const yScale = (v: number) => h - ((v - yMin + yPad) / (yMax - yMin + yPad * 2)) * h

    const xIsNumeric = xVals.every(v => typeof v === 'number' || !Number.isNaN(Number(v)))
    const xNums = xIsNumeric ? xVals.map(v => Number(v)) : xVals.map((_, i) => i)
    const xMin = Math.min(...xNums)
    const xMax = Math.max(...xNums)
    const xScale = (v: number) => ((v - xMin) / (xMax - xMin || 1)) * w

    const points = data.map((d, i) => ({
      x: xScale(xNums[i]),
      y: yScale(Number(d[yKey] ?? 0)),
      raw: d,
    }))

    // y-axis ticks (5)
    const yTicks = Array.from({ length: 5 }, (_, i) => {
      const v = yMin - yPad + ((yMax - yMin + 2 * yPad) * i) / 4
      return { v, y: yScale(v) }
    })

    return { width, height, margin, w, h, points, yTicks, xIsNumeric, xVals }
  }, [data, xKey, yKey])

  if (!viz) {
    return (
      <div className="pcc-renderer pcc-renderer--chart">
        <div className="pcc-renderer-label">chart</div>
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          No data. Set <code>props.data</code> to an array of <code>{`{${xKey}, ${yKey}}`}</code> objects.
        </p>
      </div>
    )
  }

  const { width, height, margin, w, h, points, yTicks } = viz

  // Line/area path
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  const areaPath = points.length > 0
    ? `${linePath} L ${points[points.length - 1].x} ${h} L ${points[0].x} ${h} Z`
    : ''
  const barWidth = Math.max(4, (w / points.length) * 0.7)

  return (
    <div className="pcc-renderer pcc-renderer--chart">
      <div className="pcc-renderer-label">chart · {kind}</div>
      {p.title && <h4 style={{ margin: '4px 0 12px', fontSize: 15 }}>{p.title}</h4>}
      <svg ref={ref} viewBox={`0 0 ${width} ${height}`} className="pcc-chart-svg" role="img">
        <g transform={`translate(${margin.left},${margin.top})`}>
          {/* y gridlines */}
          {yTicks.map((t, i) => (
            <g key={i}>
              <line x1={0} y1={t.y} x2={w} y2={t.y} stroke="currentColor" strokeOpacity={0.08} />
              <text x={-6} y={t.y + 3} textAnchor="end" fontSize={10} fill="currentColor" opacity={0.55}>
                {formatNum(t.v)}
              </text>
            </g>
          ))}
          {kind === 'area' && <path d={areaPath} fill={color} fillOpacity={0.18} />}
          {kind === 'line' && <path d={linePath} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />}
          {kind === 'area' && <path d={linePath} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />}
          {kind === 'bar' && points.map((pt, i) => (
            <rect key={i} x={pt.x - barWidth / 2} y={pt.y} width={barWidth} height={Math.max(0, h - pt.y)} fill={color} rx={2} />
          ))}
          {(kind === 'line' || kind === 'area') && points.map((pt, i) => (
            <circle key={i} cx={pt.x} cy={pt.y} r={3} fill={color}>
              <title>{String(pt.raw[xKey])}: {String(pt.raw[yKey])}</title>
            </circle>
          ))}
        </g>
      </svg>
    </div>
  )
}

function formatNum(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (abs >= 1_000) return (n / 1_000).toFixed(1) + 'k'
  if (abs >= 10) return n.toFixed(0)
  return n.toFixed(2).replace(/\.?0+$/, '')
}
