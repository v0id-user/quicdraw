# transport-io 0.12.1, from the app side

quicdraw moved from transport-io 0.12.0 to 0.12.1. @transport-io/react stays at 0.4.1, the latest. This round adopted everything 0.12.1 added: the token fix, the guidance on what to show users, and the React recipe for signing in again without a reload. The earlier notes are [transport-io-0.12.md](transport-io-0.12.md), [transport-io-0.11.md](transport-io-0.11.md) and [transport-io-0.10.md](transport-io-0.10.md).

## Every 0.12 item, checked

| 0.12 item | 0.12.1 | What quicdraw does now |
|---|---|---|
| 1. `lastError.message` is written for developers | The troubleshooting page says which fields are for users and which are for logs | `client/messages.ts` picks a sentence by `code` and logs the rest |
| 2. Signing in again without a reload is undocumented | The React guide has the recipe, verified in a browser | "sign in again" and "new name" both renew the token, then call `disconnect()` and `connect()` |
| 3. Presence has two defects | Unchanged, as expected. D136 records the report | Still filters cursors by hand |
| 4. The board depends on someone holding a copy | Not a library item | Better: the page no longer reloads, so it keeps its copy through a rename or a refusal |

## Checked in Chrome

- **"new name":** the same page got a new name, kept both shapes, and reconnected. The server dropped the old name from the online list.
- **Refusal:** after a server restart with a new secret, the page said "The server no longer accepts this name." instead of the library's developer text.
- **"sign in again":** the same page solved a fresh challenge and reconnected under a new name. It sent its board back, so the restarted server had both shapes again.
- **Token in errors:** a failed handshake now logs `https://127.0.0.1:4433/` with no query.

## Still wished for

### 1. The browser logs the token itself

When the handshake failed, Chrome printed its own console error with the whole URL, token included:

```
Failed to establish a connection to https://127.0.0.1:4433/?token=<name>.<expiry>.<signature>: net::ERR_CONNECTION_REFUSED.
```

No library can suppress that. The authorize guide and SECURITY.md could say it, next to "the token travels in the query": the query shows up in the browser's console and in any log that records request paths, so keep tokens short-lived. quicdraw's token lasts a day, which is fine for a toy and too long for anything real.

### 2. Presence (D136), unchanged

- A newcomer sees nobody's cursor until that person moves.
- Cursors of people who left stay in client state, so the page filters them against the online list.

## Deploying on Fly, which works

KNOWN-ISSUES says many managed platforms give you no UDP ingress, and that it is the first
thing to check. Fly does, with conditions worth writing down somewhere:

- A **dedicated IPv4** is required, about $2 a month. Fly routes no UDP over shared IPv4 or
  over IPv6 at all, so the page dials the address rather than the `fly.dev` name.
- The app binds UDP to **`fly-global-services`**, and the external and internal ports must
  match. Fly rewrites the address but never the port.
- Fly terminates TLS for TCP only, so a deployed app there has **no CA certificate for its
  UDP port**. quicdraw mints a 13-day certificate at startup, serves the hash over Fly's
  HTTPS, and pins it in the browser, which is the dev recipe used in production. The
  certificates guide presents pinning as a development-only path; this is a real case for
  it, and the deploy runbook in `examples/chat/deploy` assumes a VPS with certbot instead.
- The listener cannot swap certificates, so the process exits before the 13 days are up and
  the platform restarts it.

Verified live: a browser holds a session to `quicdraw.fly.dev` over Fly's UDP.

## Where things ended up

Across four releases, the hand-written plumbing quicdraw needed went away piece by piece:

| Built by hand on 0.10 | Replaced in | By |
|---|---|---|
| `hello` call, name map, handler guards, silent-peer timer | 0.11 | `authorize` and `peer.data` |
| Online list polling | 0.11 | `peer.closed` |
| Base64 Yjs updates | 0.11 | `bytes()` |
| Overwriting a client-sent `from` | 0.11 | `fromClient` and `fromServer` |
| `useNative()` null checks | 0.11 | `createHooks({ fallback: false })` |
| No reconnect | 0.11, working in Chrome from 0.12 | `reconnect` and `onSession` |
| Guessing the refusal from error codes | 0.12 | `refused` on the snapshot |
| Copy of the dev manifest fetch | 0.12 | `connectDev({ query })` |
| Reload to sign in again | 0.12.1 docs | `disconnect()` then `connect()` |
| Showing `lastError.message` to users | 0.12.1 docs | Own sentences by `code` |

What's left is recorded in DECISIONS.md and waits for a second application: presence (D136), rate limits (D137), a Yjs binding (D138), a Vite plugin (D139) and member lists (D140). From quicdraw's side, only item 1 above is new.
