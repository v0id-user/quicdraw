import { useEffect, useState } from 'react'
import * as Y from 'yjs'
import type { AppMap } from '../shared/contract.ts'
import { fromBase64, toBase64 } from '../shared/encoding.ts'
import { api, colorOf } from './api.ts'
import { signOut } from './auth.ts'
import { Board } from './Board.tsx'
import { Chat } from './Chat.tsx'

export type Line = AppMap['chat']['payload']
export type Dm = AppMap['dm']['payload']

// Listeners live here, above the connection, so nothing sent during hello is missed.
export function Room({ token }: { token: string }) {
  const client = api.useClient()
  const native = api.useNative()
  const { status, lastError } = api.useConnection()
  const [me, setMe] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [doc] = useState(() => new Y.Doc())
  const [lines, setLines] = useState<Line[]>([])
  const [dms, setDms] = useState<Dm[]>([])
  const [users, setUsers] = useState<string[]>([])

  api.useEvent('chat', (line) => setLines((prev) => [...prev, line].slice(-200)))
  api.useEvent('dm', (dm) => setDms((prev) => [...prev, dm]))
  api.useEvent('users', ({ names }) => setUsers(names))
  api.useEvent('doc', ({ update }) => Y.applyUpdate(doc, fromBase64(update), 'remote'))

  useEffect(() => {
    if (status !== 'connected' || native === null) return
    native.call('hello', { token }).then(
      ({ name }) => setMe(name),
      (e: Error) => setError(e.message),
    )
  }, [status, native, token])

  useEffect(() => {
    const forward = (update: Uint8Array, origin: unknown) => {
      if (origin !== 'remote') client.emit('doc', { update: toBase64(update) })
    }
    doc.on('update', forward)
    return () => doc.off('update', forward)
  }, [doc, client])

  const reroll = async () => {
    await signOut()
    location.reload()
  }

  return (
    <div className="room">
      <header>
        <strong>quicdraw</strong>
        <span className="dim" data-state={status}>{status}</span>
        {me && (
          <span>
            you are <b style={{ color: colorOf(me) }}>{me}</b>{' '}
            <button type="button" onClick={reroll}>new name</button>
          </span>
        )}
        {(error ?? lastError) && <span className="error">{error ?? lastError?.message}</span>}
      </header>
      {me && status === 'connected' ? (
        <main>
          <Board me={me} users={users} doc={doc} />
          <Chat me={me} users={users} lines={lines} dms={dms} />
        </main>
      ) : (
        <p className="splash">{status === 'closed' ? 'disconnected, reload to rejoin' : 'joining…'}</p>
      )}
    </div>
  )
}
