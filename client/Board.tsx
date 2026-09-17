import { type PointerEvent, type ReactNode, useEffect, useRef, useState } from 'react'
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

type Tool = 'select' | 'rect' | 'ellipse'

const BOARD = { w: 1600, h: 1000 }

const TOOLS: { kind: Tool; icon: ReactNode }[] = [
  { kind: 'select', icon: <path d="M3 2 L3 15 L6.5 11.5 L9 16 L11 15 L8.5 10.5 L13 10.5 Z" /> },
  { kind: 'rect', icon: <rect x="2.5" y="3.5" width="13" height="11" rx="1" /> },
  { kind: 'ellipse', icon: <ellipse cx="9" cy="9" rx="6.5" ry="5.5" /> },
]

function toBoard(e: PointerEvent<SVGSVGElement>): Point {
  const matrix = e.currentTarget.getScreenCTM()?.inverse()
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix)
  return { x: Math.round(p.x), y: Math.round(p.y) }
}

function ShapeView({ shape, state }: { shape: Shape; state?: 'selected' | 'draft' }) {
  const { kind, x, y, w, h, color } = shape
  const paint = { fill: color, fillOpacity: 0.22, stroke: color, strokeWidth: 3 }
  const common = { 'data-id': shape.id, className: state ? `shape ${state}` : 'shape' }
  return kind === 'rect' ? (
    <rect {...common} x={x} y={y} width={w} height={h} rx={6} {...paint} />
  ) : (
    <ellipse {...common} cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} {...paint} />
  )
}

export function Board({ me, users, doc }: { me: string; users: string[]; doc: Y.Doc }) {
  const client = api.useClient()
  const shared = doc.getArray<Shape>('shapes')
  const [shapes, setShapes] = useState<Shape[]>([])
  const [tool, setTool] = useState<Tool>('rect')
  const [draft, setDraft] = useState<Shape | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [cursors, setCursors] = useState<Record<string, Point>>({})
  const start = useRef<Point | null>(null)
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null)

  api.useEvent('cursor', ({ from, x, y }) => setCursors((prev) => ({ ...prev, [from]: { x, y } })))

  useEffect(() => {
    const render = () => setShapes(shared.toArray())
    render()
    shared.observe(render)
    return () => shared.unobserve(render)
  }, [shared])

  // Escape leaves whatever you are doing; Delete removes the selected shape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      if (e.key === 'Escape') {
        setTool('select')
        setSelected(null)
        setDraft(null)
        start.current = null
      }
      if ((e.key === 'Backspace' || e.key === 'Delete') && selected !== null) {
        const at = shared.toArray().findIndex((s) => s.id === selected)
        if (at >= 0) shared.delete(at, 1)
        setSelected(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [shared, selected])

  const moveShape = (id: string, toX: number, toY: number) => {
    const at = shared.toArray().findIndex((s) => s.id === id)
    const shape = shared.get(at)
    if (at < 0 || shape === undefined) return
    // A shape dragged past the edge would be lost to everyone, so it stops there.
    const x = Math.min(Math.max(toX, 0), BOARD.w - shape.w)
    const y = Math.min(Math.max(toY, 0), BOARD.h - shape.h)
    if (shape.x === x && shape.y === y) return
    // Yjs has no in-place update, so the shape is replaced where it sits.
    doc.transact(() => {
      shared.delete(at, 1)
      shared.insert(at, [{ ...shape, x, y }])
    })
  }

  const down = (e: PointerEvent<SVGSVGElement>) => {
    // Capture keeps the drag alive past the edge of the board; a refusal must not stop it.
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {}
    const p = toBoard(e)
    if (tool === 'select') {
      const id = (e.target as SVGElement).getAttribute('data-id')
      setSelected(id)
      const shape = shapes.find((s) => s.id === id)
      if (shape) drag.current = { id: shape.id, dx: p.x - shape.x, dy: p.y - shape.y }
      return
    }
    start.current = p
    setDraft({ id: crypto.randomUUID(), kind: tool, ...p, w: 0, h: 0, color: colorOf(me) })
  }

  const move = (e: PointerEvent<SVGSVGElement>) => {
    const p = toBoard(e)
    client.emit('move', p)

    const held = drag.current
    if (held) return moveShape(held.id, p.x - held.dx, p.y - held.dy)

    const a = start.current
    if (a === null) return
    const box = { x: Math.min(a.x, p.x), y: Math.min(a.y, p.y), w: Math.abs(p.x - a.x), h: Math.abs(p.y - a.y) }
    setDraft((d) => d && { ...d, ...box })
  }

  const up = () => {
    if (draft && draft.w > 4 && draft.h > 4) shared.push([draft])
    start.current = null
    drag.current = null
    setDraft(null)
  }

  const hint =
    shapes.length === 0
      ? tool === 'select'
        ? 'pick rect or ellipse, then drag'
        : 'drag to draw'
      : tool === 'select' && selected === null
        ? 'drag a shape to move it'
        : null

  return (
    <section className="board">
      <div className="toolbar">
        <div className="tools">
          {TOOLS.map(({ kind, icon }) => (
            <button
              key={kind}
              type="button"
              aria-pressed={tool === kind}
              title={kind === 'select' ? 'select and move (Esc)' : `draw a ${kind}`}
              onClick={() => {
                setTool(kind)
                if (kind !== 'select') setSelected(null)
              }}
            >
              <svg viewBox="0 0 18 18" width="14" height="14" aria-hidden="true" className="tool-icon">
                {icon}
              </svg>
              {kind}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            const at = selected === null ? -1 : shared.toArray().findIndex((s) => s.id === selected)
            if (at >= 0) shared.delete(at, 1)
            else shared.delete(0, shared.length)
            setSelected(null)
          }}
          disabled={shapes.length === 0}
        >
          {selected === null ? 'clear' : 'delete'}
        </button>
        <span className="count tabular">
          {draft ? `${draft.w} × ${draft.h}` : `${shapes.length} shapes`}
        </span>
      </div>
      <div className="surface">
        <svg
          className="canvas"
          viewBox={`0 0 ${BOARD.w} ${BOARD.h}`}
          data-tool={tool}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
        >
          {shapes.map((s) => (
            <ShapeView key={s.id} shape={s} state={s.id === selected ? 'selected' : undefined} />
          ))}
          {draft && <ShapeView shape={draft} state="draft" />}
          {Object.entries(cursors)
            .filter(([name]) => name !== me && users.includes(name))
            .map(([name, { x, y }]) => (
              <g key={name} className="cursor" style={{ translate: `${x}px ${y}px` }}>
                <path
                  d="M0 0 L0 22 L6 17 L11 27 L15 25 L10 15 L18 15 Z"
                  style={{ fill: colorOf(name), scale: '1.6', transformOrigin: '0 0' }}
                />
                <text x={30} y={40}>{name}</text>
              </g>
            ))}
        </svg>
        {hint && <p className="hint">{hint}</p>}
      </div>
    </section>
  )
}
