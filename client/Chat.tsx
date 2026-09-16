import { type FormEvent, useEffect, useState } from 'react'
import { api, colorOf } from './api.ts'
import type { Dm, Line } from './Room.tsx'

interface Props {
  me: string
  users: string[]
  lines: Line[]
  dms: Dm[]
}

// `peer` null is the public room; a name is a private conversation with that user.
export function Chat({ me, users, lines, dms }: Props) {
  const native = api.useNative()
  const [peer, setPeer] = useState<string | null>(null)
  const [body, setBody] = useState('')
  const [note, setNote] = useState('')
  const [seen, setSeen] = useState<Record<string, number>>({})

  const withUser = (name: string) => dms.filter((m) => m.from === name || m.to === name)
  const shown = peer === null ? lines : withUser(peer)

  useEffect(() => {
    if (peer !== null) setSeen((prev) => ({ ...prev, [peer]: shown.length }))
  }, [peer, shown.length])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const text = body.trim()
    if (text === '' || native === null) return
    setBody('')
    setNote('')
    try {
      const ok = peer === null
        ? await native.call('say', { body: text })
        : await native.call('whisper', { to: peer, body: text })
      if (!ok) setNote(`${peer} is offline`)
    } catch (err) {
      setNote((err as Error).message)
    }
  }

  return (
    <aside className="chat">
      <ul className="people">
        <li>
          <button type="button" aria-pressed={peer === null} onClick={() => setPeer(null)}>
            # public
          </button>
        </li>
        {users.filter((name) => name !== me).map((name) => {
          const unread = withUser(name).length - (seen[name] ?? 0)
          return (
            <li key={name}>
              <button type="button" aria-pressed={peer === name} onClick={() => setPeer(name)}>
                <span style={{ color: colorOf(name) }}>●</span> {name}
                {unread > 0 && peer !== name && <b className="unread">{unread}</b>}
              </button>
            </li>
          )
        })}
      </ul>
      <div className="log">
        {shown.map((m) => (
          <div key={`${m.at}-${m.from}`}>
            <span className="dim">{new Date(m.at).toLocaleTimeString([], { timeStyle: 'short' })}</span>{' '}
            <b style={{ color: colorOf(m.from) }}>{m.from}</b> {m.body}
          </div>
        ))}
      </div>
      {note && <p className="error">{note}</p>}
      <form onSubmit={submit}>
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={peer === null ? 'message everyone' : `message ${peer}`}
          maxLength={500}
        />
        <button type="submit">send</button>
      </form>
    </aside>
  )
}
