# transport-io 0.11, from the app side

quicdraw moved from transport-io 0.10.0 to 0.11.0, and from @transport-io/react 0.3.2 to 0.4.0. I tested it in Chrome with a Node client as the second user, including killing and restarting the server while the page stayed open. The notes for 0.10 are in [transport-io-0.10.md](transport-io-0.10.md).

## Fix these first

| Problem | Where | Fix |
|---|---|---|
| The browser client misses a connection that drops abruptly | `transport/browser.ts`, and the same pattern in `transport/fails.node.ts` | Handle a rejected `closed` promise the way `moq.node.ts` already does |
| A browser refused by `authorize` reports `WT_SESSION_CLOSED` | the client's connect path | Wait for the close code before wrapping the error |
| Reconnect retries a refusal forever | `Client`'s reconnect loop | Stop on `WT_UNAUTHORIZED` |

## What 0.11 fixed for quicdraw

| In 0.10 I wrote | In 0.11 I use |
|---|---|
| A `hello` call, a name map, a guard in every handler, and a 10 second timer for silent peers | `authorize` on `listenDev`, and `peer.data.name` |
| An online list rebuilt by polling every 2 seconds | `peer.closed` |
| Yjs updates base64-encoded inside JSON | `doc: reliable(bytes())` |
| A cursor `from` field the server overwrote | `move` sent by the client and `cursor` sent by the server, both with a direction |
| `useNative()` and a null check around every call | `createHooks({ fallback: false })` |
| No reconnect | `reconnect: { minMs, maxMs }` and `client.onSession` |
| A guess about emit order | D135 states it, and quicdraw relies on it |

The server file went from 91 lines to 81, with the auth plumbing gone. The client grew a little, because it now handles reconnects and refusals and builds its own WebTransport URL.

Measured in the browser, by when the online list changed:

| Case | 0.10 | 0.11 |
|---|---|---|
| A client disconnects cleanly | about 4 s | about 0.5 s |
| A client process dies | about 15 s | about 10 s |

Also confirmed with the Node client:

- A connection with no token, or a forged one, is refused with `WT_UNAUTHORIZED`.
- A client emitting the server-only `chat` event is refused with `WT_VALIDATION_FAILED`.
- `doc` payloads arrive as `Uint8Array`.
- The dev command refuses a TCP port that another process holds, including one held only on `::1`.

## Bugs found

### 1. The browser client misses an abrupt drop

**What I saw.** I killed the server process while the page was open. The page kept saying `connected` for over 50 seconds and never reconnected. Sending a chat message failed with `WT_SESSION_CLOSED`. The console showed two uncaught promise rejections, each "WebTransportError: Connection lost."

**Cause.** The WebTransport spec rejects `closed` when a session ends abruptly. `transport/browser.ts` maps it with `.then()` and no rejection handler. So `Connection.closed` rejects, and the client's `conn.closed.then(…)` never runs. That handler is what sets the status to `closed` and schedules a reconnect. The session's own `conn.closed.then(…)` is the source of the uncaught rejections.

**Proof.** I added a rejection handler to the built `browser.js` that resolves with code 0. The page then noticed the drop 9 seconds after the kill and reconnected a second later. It also sent its board back, so the restarted server had both shapes again. I restored the file afterwards, so quicdraw runs on stock 0.11.0.

**Fix.** `moq.node.ts` already ends its chain with `.catch(() => ({ code: 0, reason: 'closed' }))`. `browser.ts` needs the same. `fails.node.ts` has the same `.then()`-only pattern. I didn't see it fail, because the server side noticed dead clients fine, but I didn't test a Node client against a killed server.

### 2. A browser refused at the door sees `WT_SESSION_CLOSED`

**What I saw.** I restarted the server with a different signing secret, so the page's token became invalid. With the fix from bug 1 applied, every reconnect attempt ended with "WT_SESSION_CLOSED: WebTransportError: The session is closed." The Node client gets `WT_UNAUTHORIZED` for the same refusal.

**Cause, as far as I can tell.** `Session.dispose()` only produces `WT_UNAUTHORIZED` when `closed` has already delivered close code 1007. In Chrome, opening the first stream fails before that happens. The client's catch then wraps the raw `WebTransportError` as `WT_SESSION_CLOSED`.

**Fix.** When `start()` fails on a WebTransport connection, wait briefly for `closed` and map close code 1007 to `WT_UNAUTHORIZED` before rethrowing.

**Why it matters.** quicdraw shows a "sign in again" button when `lastError.code` is `WT_UNAUTHORIZED`. In Chrome that button never appears. The page says "offline, retrying…" forever instead.

### 3. Reconnect retries a refusal forever

**What I saw.** The page above retried about every 1 to 5 seconds for as long as I watched. The token was never going to become valid again.

**Socket.IO:** a connection refused by middleware fires `connect_error`, and the client stops. `socket.active` turns false, and the app decides whether to call `socket.connect()` again. Only low-level failures are retried.

**Fix.** Treat `WT_UNAUTHORIZED` as final in the reconnect loop. Leave the client `closed` with that `lastError`, and let the app call `connect()` once it has a new credential.

## Still wished for

### 4. `connectDev` can't add a query string

`authorize` reads the token from the URL query, but `connectDev` takes only `endpoint`. quicdraw fetches `/.well-known/transport-io-dev` itself and calls `connectBrowser` with `?token=…` and `probe: false`. That's 8 lines copying what `connectDev` already does, minus its loopback checks.

**Socket.IO:** the client's `auth` option, which can be a function called on every connection attempt.

**Wish:** `connectDev({ query: { token } })`. A function form, called on each attempt, would cover token refresh the way Socket.IO's `auth` callback does. `connect: () => …` already runs on each attempt, so documenting that pattern would also help.

### 5. `onSession` order against the session's first events

`client.onSession` runs right after the handshake. I couldn't find whether it's guaranteed to run before the first event of that session is dispatched. So quicdraw doesn't depend on it. The server sends chat history as one `history` event that replaces the list, instead of the client clearing the list in `onSession`. A sentence in the reconnect guide, like D135, would settle it.

### 6. `bytes()` only works as the whole payload

`bytes()` fills a whole payload, return or yield slot. That was enough for quicdraw. Sending `{ board, update }` would need a second event or a manual prefix.

**Socket.IO:** Buffers and typed arrays can sit anywhere inside a payload.

**Wish:** not urgent. Say in the schema guide that a slot is either bytes or JSON, and show the two-event pattern for when you need both.

### 7. The dev command doesn't check the WebTransport port on its own

With no server entry, `transport-io dev --wt-port 4433` started and printed that URL while quicdraw's server already held UDP 4433. With an entry, the server's `listenHttp3` would refuse it, so this is minor. The CLI could run the same UDP probe before printing.

## Reports for the recorded-and-not-built entries

These follow the "reconsider when" lines in D136 to D141. quicdraw is still the only app, so none of this counts as a second report.

- **Presence (D136).** With `peer.closed`, hand-rolled presence is about a dozen lines on the server: a `Set`, a broadcast, and a close handler. Two costs remain. A newcomer sees nobody's cursor until that person moves. Cursors of people who left stay in client state, so the page filters them against the online list.
- **Yjs (D138).** On `bytes()`, the sync is about 8 lines on the server and 12 on the client. For resync after a reconnect, the server sends its full state before the peer joins the room. The client sends its full state from `onSession`. That combination restored the board after a server restart in the test with the bug 1 fix.
- **Vite (D139).** The proxy entry for the manifest is still needed. Item 4 adds a second reason to export the manifest fetch: quicdraw had to reimplement it.
- **Idle timeout (D141).** About 10 seconds to notice a dead client was fine for quicdraw. I have no case where it's the problem.
- **Rate limits (D137) and member lists (D140).** Nothing new to report.

## Next to Socket.IO

| Need | transport-io 0.11 | Socket.IO |
|---|---|---|
| Auth at connect | `authorize` on the listener, token in the URL query | `io.use()`, `handshake.auth`, cookies |
| Per-peer data | `peer.data`, typed by `createServer<M, D>` | `socket.data`, typed by the fourth generic |
| Knowing a peer left | `onDisconnecting`, then `peer.closed` | `disconnecting`, then `disconnect` |
| Refusal on the client | `WT_UNAUTHORIZED` from Node, `WT_SESSION_CLOSED` from Chrome (bug 2) | `connect_error` carrying the middleware's error |
| Reconnect | Opt-in with backoff. Retries refusals (bug 3) | On by default. Stops on refusal |
| Each new session | `client.onSession` | the `connect` event |
| Missed events after a drop | The app replays them | Connection state recovery, for short drops |
| Binary | `bytes()` for a whole slot | Anywhere inside a payload |
| Direction | `fromServer` and `fromClient`, enforced at runtime | Separate interfaces, types only |

## What Socket.IO lacks that transport-io could own

1. **Refusal as a typed state.** Socket.IO's `connect_error` is a plain `Error` with an untyped `data` field. transport-io could let `authorize` return a reason, give the client a typed `refused` state, and stop reconnecting in the same step. That would fix bugs 2 and 3 and beat Socket.IO at once.
2. **A credential per attempt, built in.** The `connect` closure already runs per attempt. A `query` function on the connectors would make token refresh a one-liner, typed from the contract if the contract ever declares its auth payload.
3. **Presence, now that the parts exist.** `peer.data`, `peer.closed`, direction and datagrams are everything quicdraw's version uses. The remaining pain is the two costs in the D136 report above, and a library-owned last-state-per-peer map would remove both.

## Suggested order

1. Handle a rejected `closed` in `browser.ts` and `fails.node.ts`.
2. Report `WT_UNAUTHORIZED` from a refused browser handshake.
3. Stop reconnecting after `WT_UNAUTHORIZED`.
4. `connectDev({ query })`.
5. State when `onSession` runs relative to the session's first event.
