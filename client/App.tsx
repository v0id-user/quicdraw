import { TransportProvider } from '@transport-io/react'
import { useEffect, useState } from 'react'
import { Client } from 'transport-io'
import { connectDev } from 'transport-io/dev-transport'
import { type AppMap, contract } from '../shared/contract.ts'
import { type Session, signIn } from './auth.ts'
import { Room } from './Room.tsx'

export function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [tries, setTries] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // StrictMode mounts twice; the abort stops the first run before it claims a name.
    const abort = new AbortController()
    signIn(abort.signal, setTries).then(setSession, (e: Error) => {
      if (!abort.signal.aborted) setError(e.message)
    })
    return () => abort.abort()
  }, [])

  if (session === null) {
    return (
      <div className="splash">
        <h1>quicdraw</h1>
        <p>{error ?? `proving work… ${tries.toLocaleString()} hashes`}</p>
      </div>
    )
  }
  return <Connected session={session} />
}

function Connected({ session }: { session: Session }) {
  const [client] = useState(() => new Client<AppMap>({ contract, connect: () => connectDev() }))
  return (
    <TransportProvider client={client}>
      <Room token={session.token} />
    </TransportProvider>
  )
}
