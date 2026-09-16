# transport-io, from the app side

Notes from building quicdraw on transport-io 0.10.0 and @transport-io/react 0.3.2. quicdraw is a shared board with cursors and Yjs shapes, a public chat, private messages, and a proof-of-work sign-in, in about 690 lines.

Each section covers three things: what I wrote by hand, what Socket.IO gives you for the same job, and what I'd want in transport-io.

## The short list

Effort is my guess from reading the source, not a measurement.

| Wish | Effort | In Socket.IO |
|---|---|---|
| `peer.closed`, a signal that a peer left | Small. `accept()` already chains on `conn.closed` | Yes, `disconnect` and `disconnecting` |
| `peer.data`, typed | Small | Yes, `socket.data` |
| Connect-time auth that sees the request URL | Medium. The QUIC binding already has the hook | Yes, `io.use()` and `allowRequest` |
| Binary payloads | Medium. The codec seam is reserved | Yes |
| Opt-in reconnect and a per-session hook | Medium | Yes, reconnect is on by default |
| Direction on contract events | Medium | Types only |
| Room member lists and join or leave events | Medium | Yes, `fetchSockets()` and adapter events |
| A Vite plugin for dev | Medium | Not needed, it attaches to your HTTP server |
| Presence as a built-in | Large | No |
| Rate limits declared in the contract | Medium | No |

## What I built by hand

### 1. Knowing a peer left

quicdraw shows who is online. `ServerPeer` has no close signal, so the server checks `server.memberCount('user:<name>')` every 2 seconds and compares against a `Set` of names.

- A client that disconnected cleanly vanished from the list within about 4 seconds.
- A client that exited without closing was still listed 5 seconds later and gone within about 15, when QUIC's idle timeout fired.

**Socket.IO:** `socket.on('disconnect', reason)`. There is also `disconnecting`, which fires while `socket.rooms` is still filled in.

**Wish:** `peer.closed: Promise<CloseInfo>`. `Server.accept()` already chains its cleanup on `conn.closed`, so this means exposing a promise that already exists. A `disconnecting` moment, while `peer.rooms` can still be read, would make presence cleanup a few lines.

A configurable idle timeout on `listenHttp3` would also help. Socket.IO's defaults are a 25 second `pingInterval` and a 20 second `pingTimeout`, which detect a dead peer more slowly than QUIC does here. So this one is a knob, not a gap.

### 2. Per-peer state

The server holds a `WeakMap<ServerPeer, string>` for names. It also has a `nameOf(peer)` guard at the top of every handler.

**Socket.IO:** `socket.data`, typed through the fourth generic on `Server`. It can also be read on remote sockets returned by `fetchSockets()`.

**Wish:** `peer.data`, typed. Better still, typed from the contract, as described under "What Socket.IO lacks".

### 3. Authentication

This took the most code, spread over three files:

- A plain `node:http` server with `/api/challenge`, `/api/solve` and `/api/session`. It runs on its own port, behind its own Vite proxy entry.
- `/api/session` exists only to hand the page its token, because browsers send no cookies on a WebTransport request.
- A `hello` call verifies the token and records the name. Every other handler throws until `hello` has run, and every `peer.on` handler checks for it.
- A 10 second timer in `onSession` closes peers that never call `hello`.

Even with all that, an unauthenticated peer still receives the full event table in the first frame. SECURITY.md already says this.

**Socket.IO:** `io.use((socket, next) => …)` can read `socket.handshake.auth`, headers and cookies. `allowRequest` can refuse at the HTTP layer. The client's `auth` option can be a function that runs again on every reconnect. By default a connection starts with HTTP long-polling before upgrading, so cookies are present at the handshake without extra work.

**What makes this fixable:** `@fails-components/webtransport` already has `setRequestCallback`. It receives the CONNECT request headers before the session exists. Every session object it creates also carries `header` and `peerAddress`. transport-io's `listenHttp3` uses neither, and `FailsConnection` passes neither on.

**Wish:**

- An option like `listenHttp3({ authorize: async (request) => data | null })`. It would run before the session is accepted and receive the request path, query and peer address. The query string is the one place a browser can put a token on a WebTransport request.
- Whatever `authorize` returns becomes `peer.data`.
- Until that exists, an option that closes a session if it doesn't complete a named call within a deadline.

**A contradiction in the docs:** SECURITY.md says to put the HTTP/3 endpoint behind something that authenticates. KNOWN-ISSUES.md says UDP must reach your process with no proxy in front. On most deployments there is nothing to put in front, so that advice can't be followed.

### 4. Messaging one user

Private messages go through one room per identity, `user:<name>`, which the peer joins in `hello`. A private message is a broadcast to the recipient's room, sent to the sender's room too so their other tabs see it. "Is Bob online" is `memberCount('user:bob') > 0`.

**Socket.IO:** every socket automatically joins a room named after its id, so `io.to(socketId)` works with no setup. Joining a room named after the user id is the usual way to reach every tab a person has open.

**Wish:** no new API. A "private messages" section in the rooms guide would cover it. A room per identity handles several tabs, which a peer id can't.

### 5. Payloads that differ by direction

Clients send `{ body }`, and receivers need `{ from, body, at }`. I made sending a call (`say`, `whisper`) and receiving an event (`chat`, `dm`). That worked well, and the call gives the sender an error or a boolean back. Cursors stayed a single event, so the client sends a `from` field that the server overwrites.

The contract also lets a client emit `users` or `dm`. The server never listens for them, so it's harmless. Still, the types don't mark those events as server-only.

**Socket.IO:** separate `ServerToClientEvents` and `ClientToServerEvents` interfaces, enforced by types only.

**Wish:** an optional direction on an event, for example `reliable(schema, { from: 'server' })`. The client's `emit` would stop accepting it, and the server would drop it at runtime if a client sent it anyway. That removes most of the cost KNOWN-ISSUES describes, without doubling the event names.

### 6. Bytes

Yjs updates are `Uint8Array`. They cross the wire base64-encoded inside JSON. That costs about a third more bytes, plus a helper used on both sides.

**Socket.IO:** Buffers, ArrayBuffers, typed arrays and Blobs work inside any payload.

**Wish:** a `bytes()` payload type, or the codec seam the README reserves. The wire format is already binary, so this is the most surprising gap for anyone syncing a CRDT.

### 7. Reconnect

quicdraw doesn't reconnect. When the connection closes, the page says to reload. Doing it properly means copying the reconnect guide's recipe: watch for the change into `connected`, guard against overlapping runs, call `hello` again, then resync the document.

**Socket.IO:** reconnection is on by default, with randomized backoff. Emits are buffered while offline unless marked `volatile`. Since 4.6, connection state recovery can restore the socket id, rooms, `socket.data` and missed packets after a short drop.

KNOWN-ISSUES rules out resuming a session, and that reasoning holds. Two additions don't conflict with it:

- `new Client({ reconnect: { minMs, maxMs } })`, off unless you opt in.
- `client.onSession(callback)`, called once per new session. The status-change detection and the overlap guard would then live in the library instead of in every app.

### 8. Ordering I had to guess

I didn't return chat history in the `hello` response. A call's response and the emit lane travel on different streams, so their relative order isn't defined.

Instead, `hello` sends history and the full Yjs state with `peer.emit` before calling `peer.join('board')`. That assumes `peer.emit` and room broadcasts share the peer's single outgoing emit stream. The README's "one stream per direction" implies it, and it worked. One sentence in the rooms guide would make it safe to rely on.

Related: `useEvent` handlers attach to the `Client`, not to a session. So listeners mounted before the connection opens receive everything, which is what makes this pattern work in React. The React guide should say so.

### 9. The React binding

- `api.useClient()` returns a type without `call`, because the client might be a fallback client. quicdraw has no fallback, yet every call still needs `useNative()` and a null check.
- The function `useCall` returns resolves to `void`. Getting the result means reading hook state. `whisper` returns a boolean I wanted right away, so I called `useNative().call` instead.

**Wish:** have `useCall`'s function resolve to the result, like TanStack Query's `mutateAsync`. Also, give `createHooks` a way to say there is no fallback, so `useClient()` can return the native client type.

### 10. The dev CLI next to Vite

- Port 3000 was already in use by a Next.js dev server listening on all IPv6 addresses. The CLI bound `127.0.0.1:3000` without an error and printed `http://localhost:3000`. A browser can resolve that to `::1`, which is the other server. I moved the CLI to port 4432.
- Under Vite, the CLI prints a "page" URL that isn't the page, and a "No static directory found" warning.
- Vite needs a proxy entry for `/.well-known/transport-io-dev`. The CLI's HTTP server can't take extra routes, which is why quicdraw runs a second server for `/api`.

**Socket.IO:** `new Server(httpServer)` attaches to your own HTTP server, so the API and realtime share one process and one port. WebTransport can't share a TCP port that way, but your own server could still serve the certificate manifest.

**Wish:**

- `transport-io/vite`, a plugin that serves the manifest from Vite's dev server and starts the server entry.
- Or an exported request handler, so any Node HTTP server can serve the manifest.
- Exit with an error when the port is taken, and print `127.0.0.1` since that's the address it binds.

### 11. Flooding

The proof of work only protects sign-in. After that, a client can send `doc` updates of up to 1 MB as fast as it likes, and the server applies every one. quicdraw doesn't limit this.

**Socket.IO:** nothing built in beyond `maxHttpBufferSize`. People add a separate rate-limiting library.

This is more an opportunity than a gap. See below.

## What Socket.IO lacks that transport-io could own

1. **Auth in the contract.** Socket.IO's `handshake.auth` is untyped. Its `socket.data` is typed but never validated. A contract field like `auth: schema` could validate the value at the door and type `peer.data` from it.
2. **Direction enforced at runtime,** not only in types.
3. **Presence as a lane.** quicdraw's cursors and online list are the standard case: short-lived per-peer state on datagrams, joins and leaves on the reliable lane, all cleared on close. Socket.IO has nothing for this, and Yjs handles it with a separate "awareness" protocol. transport-io already has both lanes and drops stale datagrams, so it is the natural place for it.
4. **Rate and size limits per event,** declared next to the lane, for example `reliable(schema, { rate: '20/s' })`, and enforced before the handler runs.
5. **A Yjs binding.** Document updates would go on the reliable lane, awareness on datagrams, and a full sync on connect. Socket.IO only has community providers. quicdraw's version is about 20 lines, and it would be my first candidate for an `@transport-io/yjs` package.

Where transport-io was already ahead in this build:

- Cursor datagrams arrived with duplicates removed and stale frames dropped. Socket.IO's `volatile` only skips a send when the transport isn't writable.
- zod checked every inbound payload. A `say` sent before `hello` came back as a clean `WT_HANDLER_ERROR` carrying my message.
- Each call gets its own stream, so a slow `whisper` can't hold up a `say`.
- The dev CLI handled certificates entirely. The page needed no openssl steps and no config.

## Suggested order

1. `peer.closed`, plus a `disconnecting` moment. It exposes something the server already holds.
2. `peer.data`.
3. Connect-time `authorize` through the binding's request callback, feeding `peer.data`.
4. `bytes()` payloads.
5. `client.onSession` and opt-in reconnect.
6. Direction on events.
7. The Vite plugin.
8. A presence lane, then the Yjs binding on top of it.
