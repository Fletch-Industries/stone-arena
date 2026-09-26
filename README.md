# Stone Arena

Play at **https://moriah.fletchindustries.com/**.

A browser-based, first- and third-person arena from Fletch Industries. Two to five players,
one life each, no match timer. The last survivor wins. Includes private invitations,
solo practice, sword/axe/bow/crossbow/shield combat, spectating, results, rematches,
and a 15-second reconnect window.

Source: [Fletch-Industries/stone-arena](https://github.com/Fletch-Industries/stone-arena).
[Request a feature or report a bug](https://github.com/Fletch-Industries/stone-arena/issues/new/choose).
See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidance.

The arena uses original pixel-art cobblestone, stone brick, wood, metal, and fabric
maps, warmer sunlight, cooler ambient light, and quality-scaled shadows. See the
[rendering notes](docs/rendering.md) for asset provenance and performance settings.

## Install on your Mac or phone

Open the live game in Safari on macOS Sonoma 14 or newer, then choose **File →
Add to Dock**. Chrome and Edge offer **Install app** in the address bar or browser
menu. On iPhone/iPad, use **Share → Add to Home Screen**. The landing page's
**Install game** button opens the native install prompt where supported, or shows
these instructions. See [Apple's web app guide](https://support.apple.com/104996).

The PWA opens in its own window with an original app icon. A fixed manifest ID and
start URL launch the lobby, without saving a private invitation as the app's home.
Both solo practice and multiplayer require internet. The service worker stores
only an offline explanation; it never caches matchmaking, room state, configuration,
or game bundles, and never forces a reload during play. Updates appear on the next
online launch/reload. Original PNG icons can be regenerated with
`python3 tools/generate-icons.py` (no third-party dependencies).

## Combat and movement

Movement and combat follow modern Java Edition conventions: sword knockback,
stronger sprint hits, falling criticals, charged attacks, sword sweeps, shield
blocking, and bow/crossbow projectiles. Players have animated walking, running,
jumping, landing and weapon swings. Wait for the attack-strength bar to fill for
full damage; fast clicks deal weaker hits. Holding Attack repeats at full recovery.

The [mechanics reference](docs/minecraft-mechanics.md) records the researched rules,
sources, exact kit values, and deliberate arena adaptations. The arena remains
one-life, without healing or hunger; its browser physics is not an exact replica.

## Armor and progression

Everyone starts each round unarmored. Deal damage to earn 1 XP per actual HP
removed, plus 50 XP per elimination. Upgrades equip automatically:

| Level | XP | Equipment | Damage reduction |
| --- | --- | --- | --- |
| 1 | 0 | Unarmored | 0% |
| 2 | 50 | Guard armor | 20% |
| 3 | 150 | Enchanted armor with moving violet glint | 35% |

Armor protects against melee and arrows without healing or reducing knockback.
Blocked/immune hits and forfeits award no XP. XP survives reconnects but resets
for the next round; no accounts or permanent advantages are required. These are
original arena progression rules, not Minecraft's armor or experience formulas.

In solo practice, open **Settings → Practice armor** to choose a tier, then
**View your character · 360°** to inspect it. **Resume play** restores your selected perspective.
Preview choices never carry into competitive rounds. Corner lanterns now use
animated original pixel fire; reduced motion freezes flame and glint animation.

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

WASD moves, mouse aims, Ctrl/Shift or double-tap W sprints, Space jumps, 1–4 or wheel switches weapons,
left mouse attacks, right mouse blocks, Tab shows scores, Escape opens settings.
Hold the bow to draw and release to fire. Click the crossbow once to load and again
to fire. If mouse capture is unavailable (for example in an embedded browser),
hold Alt and drag to look; the other controls remain the same. Blocked axe hits disable shields for five seconds. No healing or respawns during a round.

On phones and tablets, use the left thumbstick to move and swipe the right side
to aim. Hold Attack for melee or bow charge; release the bow to fire. Tap Attack
to load/fire a crossbow. Hold Shield, tap Jump, toggle Sprint, and tap a weapon to
equip it. Menu and Scores are in the top right. Landscape is recommended; portrait
is supported. Small screens default to low graphics with a one-pixel render ratio.
The camera defaults to 120° FOV (adjustable from 60° to 120° in Settings).
The classic tool hotbar shows ten full/half hearts, four selectable tools, arrow
counts, shield status, armor level, and XP progress. Empty slots collapse on very narrow landscape screens.
The touch surfaces preserve multiple pointer captures across HUD refreshes and
clear held controls when interrupted. No installation or account is needed.

## Camera perspectives

Press **F5** or **V** to cycle **first person → third-person rear → third-person
front**. On phones, tap **View** beside Scores and Menu. You can also choose a
view in **Settings → Perspective**; the selection is saved on this browser.
Some Macs require Fn + F5, so V is the convenient alternative.

Move, jump, attack and block normally in all three views. Third-person attacks
still follow your character's facing direction; the front view looks back at
you, so it does not aim at the center of the screen. Third person hides the
first-person tool overlay and crosshair, and shows your animated body and armor.
The camera retracts before walls, cover and the floor, hiding your avatar when
it gets too close to obstruct visibility. Your FOV setting applies to all play
perspectives, including the default 120°.

**Settings → View your character · 360°** orbits around your equipment in solo
or multiplayer. The round continues during this preview. **Resume play** returns
to your selected perspective. Reduced motion freezes this preview camera.

## Build and verify

```sh
npm test
npm run build
npm start
# With a server running:
npx tsx tests/multiplayer.ts
npx tsx tests/reconnect.ts
npx tsx tests/room-lifecycle.ts
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
- `client/touch.ts`: independent joystick, look, and action pointer captures.
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
and physical device to establish input feel and the frame-rate budget. Desktop and
phone-sized portrait/landscape browser previews have been checked; physical iOS
and Android multitouch hardware have not been tested. Same-tick final deaths are a draw. Passive opponents
can prolong a round because there is deliberately no timer or shrinking boundary.

## Room lifecycle regression checks

`tests/room-lifecycle.ts` checks repeated ready messages, duplicate seat rejection,
solo practice, reconnect without a second player, explicit leave/recreate, silent
client expiry, and empty-room disposal against a running server. Run it without
other tests creating or deleting rooms because it checks room-count conservation.
Each browser tab keeps one seat identity; normal refresh reuses its reconnect token.
An explicit leave clears that token and waits for teardown before another join.
Disconnected seats have a 15-second reconnect reservation. A connected socket that
stops sending application heartbeats/controls is removed after 30 seconds. Empty
rooms dispose automatically; a live lobby has a 30-minute lifetime.

For mobile compatibility, open `/tests/mobile-preview.html` on the Vite development
server. This renders the actual app in a 390×844 iframe with Pointer Lock APIs
unavailable. Create, ready, solo practice, leave, rejoin, and reload must all work
without browser exceptions. These test fixtures are excluded from production builds.
