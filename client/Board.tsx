import { type PointerEvent, useEffect, useRef, useState } from 'react'
import type * as Y from 'yjs'
import { api, colorOf } from './api.ts'

interface Shape {
  id: string
  kind: 'rect' | 'ellipse'
  x: number
  y: number
  w: number
  h: number
  color: string
}

interface Point {
  x: number
  y: number
}

function toBoard(e: PointerEvent<SVGSVGElement>): Point {
  const matrix = e.currentTarget.getScreenCTM()?.inverse()
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix)
  return { x: Math.round(p.x), y: Math.round(p.y) }
}

function ShapeView({ shape }: { shape: Shape }) {
  const { kind, x, y, w, h, color } = shape
  const paint = { fill: color, fillOpacity: 0.25, stroke: color, strokeWidth: 3 }
  return kind === 'rect' ? (
    <rect x={x} y={y} width={w} height={h} rx={6} {...paint} />
  ) : (
    <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} {...paint} />
  )
}

export function Board({ me, users, doc }: { me: string; users: string[]; doc: Y.Doc }) {
  const client = api.useClient()
  const shared = doc.getArray<Shape>('shapes')
  const [shapes, setShapes] = useState<Shape[]>([])
  const [tool, setTool] = useState<Shape['kind']>('rect')
  const [draft, setDraft] = useState<Shape | null>(null)
  const [cursors, setCursors] = useState<Record<string, Point>>({})
  const start = useRef<Point | null>(null)

  api.useEvent('cursor', ({ from, x, y }) => setCursors((prev) => ({ ...prev, [from]: { x, y } })))

  useEffect(() => {
    const render = () => setShapes(shared.toArray())
    render()
    shared.observe(render)
    return () => shared.unobserve(render)
  }, [shared])

  const down = (e: PointerEvent<SVGSVGElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = toBoard(e)
    start.current = p
    setDraft({ id: crypto.randomUUID(), kind: tool, ...p, w: 0, h: 0, color: colorOf(me) })
  }

  const move = (e: PointerEvent<SVGSVGElement>) => {
    const p = toBoard(e)
    client.emit('move', p)
    const a = start.current
    if (a === null) return
    const box = { x: Math.min(a.x, p.x), y: Math.min(a.y, p.y), w: Math.abs(p.x - a.x), h: Math.abs(p.y - a.y) }
    setDraft((d) => d && { ...d, ...box })
  }

  const up = () => {
    if (draft && draft.w > 4 && draft.h > 4) shared.push([draft])
    start.current = null
    setDraft(null)
  }

  return (
    <section className="board">
      <div className="toolbar">
        {(['rect', 'ellipse'] as const).map((kind) => (
          <button key={kind} type="button" aria-pressed={tool === kind} onClick={() => setTool(kind)}>
            {kind}
          </button>
        ))}
        <button type="button" onClick={() => shared.delete(0, shared.length)}>clear</button>
        <span className="dim">{shapes.length} shapes</span>
      </div>
      <svg viewBox="0 0 1600 1000" onPointerDown={down} onPointerMove={move} onPointerUp={up}>
        {shapes.map((s) => <ShapeView key={s.id} shape={s} />)}
        {draft && <ShapeView shape={draft} />}
        {Object.entries(cursors)
          .filter(([name]) => name !== me && users.includes(name))
          .map(([name, { x, y }]) => (
            <g key={name} style={{ transform: `translate(${x}px, ${y}px) scale(1.6)` }} className="cursor">
              <path d="M0 0 L0 22 L6 17 L11 27 L15 25 L10 15 L18 15 Z" fill={colorOf(name)} />
              <text x={20} y={30}>{name}</text>
            </g>
          ))}
      </svg>
    </section>
  )
}
