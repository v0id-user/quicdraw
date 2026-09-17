// quicdraw's own glyph: the two shapes the board draws. transport-io's mark is its own
// and only ever refers to that project, which is what the credit link uses it for.
export function Quicdraw({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" className="glyph">
      <rect x="6.5" y="6.5" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3" />
      <circle cx="22" cy="22" r="5.5" fill="var(--accent)" />
    </svg>
  )
}

export function TransportIo({ size = 13 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" fill="currentColor">
      <path d="M4 8 H42 V23 L27 32 L42 41 V56 H4 Z" />
      <path d="M45 46 L62 40 L62 57 H45 Z" />
    </svg>
  )
}
