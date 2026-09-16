import { bytes, defineContract, fromClient, fromServer, type MapOf, reliable, rpc, unreliable } from 'transport-io'
import { z } from 'zod'

const name = z.string().max(64)
const text = z.string().trim().min(1).max(500)
const line = z.object({ from: name, body: z.string(), at: z.number() })

export const contract = defineContract({
  // Client to server. The sender is whoever the token at the door said.
  say: rpc(z.object({ body: text }), z.boolean()),
  whisper: rpc(z.object({ to: name, body: text }), z.boolean()),
  move: fromClient(unreliable(z.object({ x: z.number(), y: z.number() }))),

  // Server to client.
  users: fromServer(reliable(z.object({ names: z.array(name) }))),
  history: fromServer(reliable(z.array(line))),
  chat: fromServer(reliable(line)),
  dm: fromServer(reliable(line.extend({ to: name }))),
  cursor: fromServer(unreliable(z.object({ from: name, x: z.number(), y: z.number() }))),

  // Both ways: Yjs document updates.
  doc: reliable(bytes()),
})

export interface AppMap extends MapOf<typeof contract> {}
export type Line = z.infer<typeof line>
export type Dm = AppMap['dm']['payload']
