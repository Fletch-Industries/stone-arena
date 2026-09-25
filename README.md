# Stone Arena

A browser-based, first-person arena from Fletch Industries. Two to five players,
one life each, no match timer. The last survivor wins. Includes private invitations,
solo practice, sword/axe/bow/crossbow/shield combat, spectating, results, rematches,
and a 15-second reconnect window.

## Run locally

Requires Node.js 22 or newer.

```sh
npm ci
npm run server
# In another terminal:
npm run dev
```

Open the Vite URL (normally `http://127.0.0.1:5173`). Create an arena and share its
invite link. Everyone readies up, then the host starts. For local multi-browser
testing, open the link in a second tab and use another nickname. Network friends
need a reachable deployed URL rather than your localhost link.

WASD moves, mouse aims, Shift sprints, Space jumps, 1–4 or wheel switches weapons,
left mouse attacks, right mouse blocks, Tab shows scores, Escape opens settings.
Hold the bow to draw and release to fire. Click the crossbow once to load and again
to fire. If mouse capture is unavailable (for example in an embedded browser),
hold Alt and drag to look; the other controls remain the same. Axe hits disable shields briefly. No healing or respawns during a round.

## Build and verify

```sh
npm test
npm run build
npm start
# With a server running:
npx tsx tests/multiplayer.ts
npx tsx tests/reconnect.ts
TEST_ROUNDS=10 npx tsx tests/multiplayer.ts
```

`TEST_ENDPOINT` selects a local or authorized deployed game endpoint. Multiplayer
tests create private rooms, drive five ordinary protocol clients through combat,
check capacity/results, and dispose of those rooms. They have no privileged game
endpoint. Reconnection tests intentionally disconnect their own test participants.

## Architecture

- `shared/game.ts`: protocol, map, validated controls, shared movement and collision.
- `server/simulation.ts`: fixed 60 Hz authority for movement, weapons, health,
  projectiles, one-life elimination, victory, and match lifecycle.
- `server/index.ts`: Colyseus rooms and WebSocket transport, Express static assets,
  health/config routes, reconnect reservations, origin checks, capacity/backpressure.
- `client/scene.ts`: Three.js renderer with instanced stone walls, procedural
  textures, original block avatars/weapons, and pooled projectile meshes.
- `client/main.ts`: lobby/HUD, input prediction and reconciliation, remote movement
  smoothing, audio, settings, spectator and reconnect UX.

The server uses custom 20 Hz snapshots over Colyseus messages. Client controls are
sent at 60 Hz; simulation time always comes from the server, never the input rate.
Melee rewinds target history by up to 100 ms using server-measured round-trip timing.
Arrows use swept projectile collision. Rendering runs independently of simulation.
Eight rooms is the default hard server cap, with five participants per room. There
are no accounts, databases, purchases, public room lists, chat, or external assets.

## Production

Build on the target Linux architecture or in compatible CI. Run one process behind
an HTTPS reverse proxy, with WebSocket upgrade support and explicit allowed origins.
Keep the existing API application separate. A proxy can route `/arena/*` to this
service after stripping the prefix, while preserving every other API route.

| Variable | Purpose |
| --- | --- |
| `HOST` | Explicit listen address; defaults to loopback |
| `PORT` | Default 3107 |
| `ARENA_API_URL` | Browser's HTTPS API base URL, including proxy prefix |
| `ALLOWED_ORIGINS` | Comma-separated exact frontend origins |
| `MAX_ROOMS` | Default 8; size after host load testing |
| `ACME_CHALLENGE_DIR` | Optional explicit HTTP-01 challenge directory |

`/health` reports availability. `/config.json` provides the API URL without secrets.
Runtime matches are in memory. A restart aborts active rounds; reconnects recover
only while the same process retains the room. Drain games before planned releases.
Keep immutable release directories and a previous-release link for rollback.

TLS termination and renewal belong to the host. Private infrastructure paths,
credential references, deployment evidence, and specific host configurations live
in the owner's private operational dossier, not this repository.

## Validation limits

Automated tests establish the rules, real multiplayer protocol behavior, and
reconnection handling. A browser playtest is still needed on each target browser
and physical device to establish input feel and the frame-rate budget. Mobile touch
controls are not implemented. Same-tick final deaths are a draw. Passive opponents
can prolong a round because there is deliberately no timer or shrinking boundary.
