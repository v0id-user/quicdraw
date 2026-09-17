import { useEffect, useState } from 'react'
import * as Y from 'yjs'
import type { Dm, Line } from '../shared/contract.ts'
import { api, colorOf } from './api.ts'
import { signOut } from './auth.ts'
import { Board } from './Board.tsx'
import { Chat } from './Chat.tsx'

async function reroll() {
  await signOut()
  location.reload()
}

// Listeners live here, above the connection, so nothing a session sends first is missed.
export function Room({ me }: { me: string }) {
  const client = api.useClient()
  const { status, lastError, refused } = api.useConnection()
  const [doc] = useState(() => new Y.Doc())
  const [lines, setLines] = useState<Line[]>([])
  const [dms, setDms] = useState<Dm[]>([])
  const [users, setUsers] = useState<string[]>([])

  // Every session starts with the full history, so it replaces what we had.
  api.useEvent('history', setLines)
  api.useEvent('chat', (line) => setLines((prev) => [...prev, line].slice(-200)))
  api.useEvent('dm', (dm) => setDms((prev) => [...prev, dm]))
  api.useEvent('users', ({ names }) => setUsers(names))
  api.useEvent('doc', (update) => Y.applyUpdate(doc, update, 'remote'))

  useEffect(() => {
    const forward = (update: Uint8Array, origin: unknown) => {
      if (origin !== 'remote' && client.getSnapshot().status === 'connected') client.emit('doc', update)
    }
    doc.on('update', forward)
    // An edit lost when a session dropped goes back with the whole document on the next one.
    const stop = client.onSession(() => client.emit('doc', Y.encodeStateAsUpdate(doc)))
    return () => {
      doc.off('update', forward)
      stop()
    }
  }, [doc, client])

  return (
    <div className="room">
      <header>
        <strong>quicdraw</strong>
        <span className="dim" data-state={status}>{status}</span>
        <span>
          you are <b style={{ color: colorOf(me) }}>{me}</b>{' '}
          <button type="button" onClick={reroll}>new name</button>
        </span>
        {lastError && !refused && status !== 'connected' && <span className="error">{lastError.message}</span>}
      </header>
      {status === 'connected' ? (
        <main>
          <Board me={me} users={users} doc={doc} />
          <Chat me={me} users={users} lines={lines} dms={dms} />
        </main>
      ) : (
        <p className="splash">
          {refused ? (
            <span>
              the server no longer accepts this name{' '}
              <button type="button" onClick={reroll}>sign in again</button>
            </span>
          ) : status === 'closed' ? (
            'offline, retrying…'
          ) : (
            'connecting…'
          )}
        </p>
      )}
    </div>
  )
}
