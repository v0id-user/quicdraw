# transport-io 0.12, from the app side

quicdraw moved from transport-io 0.11.0 to 0.12.0, and from @transport-io/react 0.4.0 to 0.4.1. I tested it in Chrome with a Node client as the second user. That included killing the server with SIGKILL and restarting it with a different signing secret while the page stayed open. The earlier notes are in [transport-io-0.11.md](transport-io-0.11.md) and [transport-io-0.10.md](transport-io-0.10.md).

## Every 0.11 item, checked

| 0.11 item | 0.12 | Checked how |
|---|---|---|
| 1. Chrome misses an abrupt drop | Fixed | SIGKILL on the server. The page went to `closed`, reconnected, and logged no errors |
| 2. A refused browser sees `WT_SESSION_CLOSED` | Fixed | Chrome now reports `WT_UNAUTHORIZED` with the reason `bad-token` |
| 3. Reconnect retries a refusal forever | Fixed | No attempts in the 34 seconds after the refusal |
| 4. `connectDev` can't add a query | Fixed | `connectDev({ query: { token } })` replaced quicdraw's copy of the manifest fetch |
| 5. `onSession` order is unstated | Fixed and stated | Not exercised. quicdraw still doesn't depend on it |
| 6. `bytes()` fills a whole slot | Documented | Not rechecked |
| 7. The dev command doesn't check its WebTransport port | Fixed | Exits with `WT_PORT_IN_USE` naming UDP 4433 |
| Node client against a killed server, untested in 0.11 | Works | The client went to `closed`, reconnected, and `onSession` ran again, with no unhandled rejections |

## What changed in quicdraw

- **Connecting:** the page calls `connectDev({ query: { token } })`. The 8-line manifest fetch is gone.
- **Refusing:** the server's `authorize` returns `refuse('bad-token')` instead of `null`.
- **The refused page:** it reads `refused` from `useConnection()` instead of comparing `lastError.code`.
- **Size:** the migration removed 12 lines net across the client and server.

## Measurements

These are single runs, so treat them as rough.

| What | Time |
|---|---|
| Chrome notices a SIGKILLed server | 15 s |
| Chrome notices a SIGTERMed server | 8 s |
| Node client notices a SIGKILLed server | 11 s |
| Reconnect after the server is back | under 1 s |
| Online list drops a client that disconnected cleanly | under 1 s |
| Online list drops a client whose process died | 6 s |

D143 says a quiet server can take about 25 seconds to drop a vanished peer. quicdraw's server was not quiet in my run, which likely explains the 6 seconds.

## Still wished for

### 1. `lastError.message` is written for developers

quicdraw printed `lastError.message` in the page header. For a refusal that read "WT_UNAUTHORIZED: the server refused this connection: bad-token - The same request will be refused again, so a client that reconnects on its own has stopped. Obtain a valid credential, then disconnect() and connect()." That second half is advice for the developer, shown to a user. quicdraw now hides the header error when `refused` is set.

**Socket.IO:** `connect_error` carries the middleware's own `Error`, so the message is whatever the server wrote.

**Wish:** say in the errors guide that `message` includes the remedy and is for logs. Or add a short field without the code and remedy, for apps that want to show something.

### 2. Signing in again without a reload is undocumented

After a refusal, the hint says to call `disconnect()` then `connect()`. Under `TransportProvider`, the provider holds a connect reference, so the app would call the pair from `useConnection()` and rely on the reference count landing back at one. The `query` function form would then send the new token. quicdraw reloads the page instead, so I didn't test this path. A short example in the React guide would settle it.

### 3. Presence still has its two defects (D136)

Nothing in 0.12 targets these, and none was expected:

- A newcomer sees nobody's cursor until that person moves.
- Cursors of people who left stay in client state, so the page filters them against the online list.

### 4. The board depends on someone holding a copy

After "sign in again" reloaded the only open page, a restarted server came back with an empty board. This is quicdraw's design, since nothing is persisted. It is also the case D138 names for a Yjs binding: resync is fine while one peer still holds the document, and nothing helps when none does.

## Next to Socket.IO, updated

| Need | transport-io 0.12 | Socket.IO |
|---|---|---|
| Credential on each attempt | `connectDev({ query })`, where a function runs per attempt | `auth` option, where a function runs per attempt |
| Refusal on the client | `RefusedError` with `reason`, plus `refused` on the snapshot | `connect_error` with the middleware's `Error` |
| Reconnect after a refusal | Stops | Stops |
| Reconnect after a lost connection | Opt-in, with backoff | On by default |
| A lost connection | Noticed on both sides | Noticed through ping timeouts |

transport-io is now ahead on refusals. The reason is a typed field and a snapshot state, where Socket.IO's is an untyped `data` on an `Error`. The refused peer also never receives the event table.

## Suggested order

1. Say in the errors guide which `TransportError` fields are safe to show users.
2. Add a React example of signing in again without a reload.
3. Keep D136 open for the second application.
