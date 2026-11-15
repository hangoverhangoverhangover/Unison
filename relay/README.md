# Jam relay

The internet relay for Unison's **Jam** (shared listening). It is a small Cloudflare
Worker with one Durable Object per room. The relay keeps the room's queue and playback state,
checks every command, and sends the new state to everyone in the room. It never sees audio,
account tokens or local files: only track metadata (ids, titles, artists, durations, https links).

The protocol is defined in `../src/shared/jam.ts`. The relay imports that file directly, so
the app and the relay always agree.

## Deploy it (once, about 5 minutes)

You need Node 22 or newer.

1. Create a free Cloudflare account at <https://dash.cloudflare.com/sign-up>. You do not need a
   domain or a payment card. The Workers Free plan is enough.
2. Open a terminal in this folder and install the tools:

   ```sh
   cd relay
   npm install
   ```

3. Log in. This opens your browser so you can approve access for Wrangler (Cloudflare's CLI):

   ```sh
   npx wrangler login
   ```

4. Deploy:

   ```sh
   npx wrangler deploy
   ```

   The first time, Wrangler may ask you to choose a `workers.dev` subdomain for your account.
   When it finishes, it prints a URL such as
   `https://combined-player-jam.<your-subdomain>.workers.dev`.

5. Copy that URL into the app: **Settings → Jam → Relay URL**.

To check it is up, open the URL in a browser. You should see
`{"ok":true,"service":"combined-player-jam-relay"}`.

To update the relay later (after pulling changes), run `npx wrangler deploy` again.

## Free plan limits

Durable Objects are on the Workers Free plan when they use SQLite storage, which this relay
does. The free plan allows 100,000 Worker requests per day and 100,000 Durable Object storage
writes per day. Each Jam command (add, play, skip and so on) is one write, so this is far more
than a personal app needs. If a limit is reached, new requests fail until the daily reset at
00:00 UTC. You are not charged.

## Delete it

Run `npx wrangler delete` in this folder, or go to the Cloudflare dashboard, open
**Workers & Pages**, select `combined-player-jam`, then **Settings → Delete**.

## How rooms behave

- `POST /rooms` returns `{ code, hostSecret }`. The code is 6 characters with no look-alike
  characters. The secret is 32 random bytes in hex. Only the host's app knows it.
- `GET /rooms/{code}/ws` opens the room's WebSocket. Add `?secret=…` to join as the host.
  Refusals accept the upgrade and then close at once, so any WebSocket client can read why:
  `4404 Room not found` (unknown or ended room), `4403 Wrong host key` (a `?secret=` that does
  not match; it is not downgraded to a guest), `4409 Room is full` (after an `error` frame).
- The first frame must be `hello`, within 10 seconds, or the socket is closed.
- Guests may only `add`. Every other command is host-only.
- When the host disconnects, the host stays listed in the room for 5 minutes, so a reconnect
  with the secret keeps the same participant id. If the host does not come back in time, every
  guest gets `{type:'closed', reason:'The host left.'}`. A room with nobody connected is deleted
  after 5 minutes. A guest who disconnects is removed straight away and gets a new id on rejoin.
- Limits come from `JAM_LIMITS` in the contract: 20 participants, 500 queued tracks, 64 KiB per
  frame, and 40 frames per socket per 10 seconds (all frame types count, pings included).

## Develop

```sh
npm test                 # unit tests (Node) + integration tests (Workers runtime)
npm run typecheck
npx wrangler dev         # local relay on http://localhost:8787, no login needed
node scripts/two-clients.mjs http://127.0.0.1:8787   # host + guest smoke test against it
```

Run `npx wrangler types` after changing `wrangler.jsonc`. It regenerates
`worker-configuration.d.ts`.

The room rules are in `src/room.ts`. That file is plain TypeScript with no Workers APIs, and
`test/room.test.ts` tests it directly. `src/index.ts` is the Worker and the Durable Object.
