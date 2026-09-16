import { defineContract, type MapOf, reliable, rpc, unreliable } from 'transport-io'
import { z } from 'zod'

const name = z.string().max(64)
const text = z.string().trim().min(1).max(500)
const chat = z.object({ from: name, body: z.string(), at: z.number() })

export const contract = defineContract({
  // Client to server. Nothing else is accepted from a session until hello succeeds.
  hello: rpc(z.object({ token: z.string().max(256) }), z.object({ name })),
  say: rpc(z.object({ body: text }), z.boolean()),
  whisper: rpc(z.object({ to: name, body: text }), z.boolean()),

  // Server to client.
  users: reliable(z.object({ names: z.array(name) })),
  chat: reliable(chat),
  dm: reliable(chat.extend({ to: name })),

  // Both ways. The server overwrites `from` before relaying a cursor.
  cursor: unreliable(z.object({ from: name, x: z.number(), y: z.number() })),
  doc: reliable(z.object({ update: z.string().max(1_000_000) })),
})

export interface AppMap extends MapOf<typeof contract> {}
