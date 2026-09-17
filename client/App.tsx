import { TransportProvider } from '@transport-io/react'
import { useEffect, useRef, useState } from 'react'
import { Client } from 'transport-io'
import { connectDev } from 'transport-io/dev-transport'
import { type AppMap, contract } from '../shared/contract.ts'
import { type Session, signIn, signOut } from './auth.ts'
import { Room } from './Room.tsx'

export function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [tries, setTries] = useState(0)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    // StrictMode mounts twice; the abort stops the first run before it claims a name.
    const abort = new AbortController()
    signIn(abort.signal, setTries).then(setSession, (e: unknown) => {
      if (abort.signal.aborted) return
      console.warn(e)
      setFailed(true)
    })
    return () => abort.abort()
  }, [])

  if (session === null) {
    return (
      <div className="splash">
        <h1>quicdraw</h1>
        <p>{failed ? 'Could not sign in. Reload to try again.' : `proving work… ${tries.toLocaleString()} hashes`}</p>
      </div>
    )
  }
  return <Connected first={session} />
}

function Connected({ first }: { first: Session }) {
  const [me, setMe] = useState(first.name)
  const token = useRef(first.token)
  const [client] = useState(
    () =>
      new Client<AppMap>({
        contract,
        // Read on every attempt, so a reconnect sends whatever the last sign-in stored.
        connect: () => connectDev({ query: () => ({ token: token.current }) }),
        reconnect: { minMs: 500, maxMs: 5000 },
      }),
  )

  // Drops the cookie and solves a fresh challenge. The page stays, and so does its board.
  const renew = async () => {
    await signOut()
    const next = await signIn(new AbortController().signal, () => {})
    token.current = next.token
    setMe(next.name)
  }

  return (
    <TransportProvider client={client}>
      <Room me={me} renew={renew} />
    </TransportProvider>
  )
}
