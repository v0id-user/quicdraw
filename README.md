# quicdraw

A small experiment on [transport-io](https://github.com/transport-io/transport-io). One shared board where everyone sees each other's cursors and draws shapes, a public chat, and private messages.

## Run

```bash
bun install
bun run dev
```

Open http://localhost:5173 in Chrome or Firefox. Safari cannot open a WebTransport session to this server.

Everyone in one browser shares a cookie and so a name. Use a private window or a second browser to be a second person.

## How it works

- **Sign in.** The page asks `/api/challenge` for a salt and finds a nonce whose SHA-256 starts with 16 zero bits. `/api/solve` checks it, derives a name from the winning hash, and sets a signed cookie for a day. A page with a valid cookie skips the puzzle. "new name" clears the cookie.
- **Joining the room.** WebTransport requests carry no cookies, so `/api/session` hands the page its token and the page presents it in the `hello` call. The server ignores a session until `hello` succeeds and closes it after 10 seconds.
- **Board.** Shapes live in a Yjs array. Updates travel base64-encoded on the reliable lane, and the server keeps its own copy for newcomers. Cursors go over datagrams and may drop.
- **Chat.** Each user is in a room named after them, so a private message is a broadcast to that room.
- **Who is online.** transport-io has no disconnect callback, so the server checks room membership every 2 seconds.

| Process | Port |
|---|---|
| Vite, the page | 5173 |
| `/api` for sign-in | 8787 |
| transport-io dev, certificate hash | 4432 |
| WebTransport | 4433 |

## Layout

- `shared/contract.ts` defines every message and which lane it takes.
- `server/` holds the realtime server, the sign-in endpoints, and a small test for the puzzle and tokens.
- `client/` holds the React app.

Everything is in memory and development only. Restarting the server clears the board and chat and signs everyone out.

```bash
bun test
bun run typecheck
```
