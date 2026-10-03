# Rendering and original assets

Stone Arena uses original, deterministic pixel-art textures generated locally in
`client/textures.ts`. No Minecraft textures, skins, audio, or other game files are
bundled or fetched. The block aesthetic comes from pixel palettes, tiled masonry,
nearest-neighbor magnification, and consistent world-space texture density.

Six 32×32 color maps cover cobblestone, stone, stone brick, wood, metal and cloth.
Matching normal maps add subtle surface relief. Texture wrapping is seamless;
mipmaps reduce distant shimmer while keeping nearby pixels sharp. Floor and cover
UVs repeat per world unit instead of stretching across the whole mesh. Wall blocks
are instanced with subtle color variation.

Lighting uses a warm directional sun, cool sky/ground ambient light, filmic tone
mapping, a light blue distance haze, and emissive lanterns. Graphics quality controls:

| Quality | Resolution cap | Shadows |
| --- | --- | --- |
| Low | 1× | Cheap contact patches beneath cover, walls, and players |
| Medium | 1.5× | One 1024×1024 sunlight shadow map |
| High | 2× | One 2048×2048 sunlight shadow map |

There are no post-processing passes or shadow-casting point lights. Mobile defaults
to Low, and Settings can change quality during play. Reduced camera motion and the
120-degree FOV preference remain independent of lighting quality.

## Fire and equipment

`client/effects.ts` generates an original sixteen-frame 16×32 pixel flame atlas
once. Four lanterns use crossed alpha-tested planes, independent atlas offsets,
and subtle material-brightness flicker at twelve animation frames per second.
There are no per-frame texture uploads or additional dynamic lights.

Armor plates follow the existing head, arm, and leg animation pivots. Guard armor
has inexpensive Phong highlights; enchanted armor adds a shader-based violet
glint over the original metal map. Cloth insignia preserve player colors. The
same material appears on the first-person gauntlet. Shared geometry/materials
keep the five-player limit inexpensive; no bloom or post-processing is added.
Reduced motion freezes flame frames, glint, and the solo armor-preview camera.

`/tests/equipment-preview.html` exercises the actual renderer and simulation with
armor tiers, walk/run/jump/attack/hurt poses, graphics quality and reduced motion.
The development fixture is excluded from production builds.

## Gameplay perspectives

`client/camera.ts` computes rear/front camera booms without modifying the player's
input, aim, hit ray or server state. A conservative camera volume covers the near
plane at the current FOV/aspect ratio; the boom retracts against cover (including
caps), lantern cages, boundary walls and floor. Close follow avatars are hidden
rather than rendering inside the head. The camera follows predicted local
movement, with the local mesh using the same position to avoid network-lag jitter.
First-person weapons are hidden in third person; attached world tools/armor and
normal locomotion remain visible. A selected perspective also follows the current
spectated survivor. No extra render passes or lights are added.

`/tests/camera-preview.html` exercises front/rear views, running/jumping/attacking,
cover and wall locations, and yaw/pitch using the actual renderer. Camera unit
tests cover collision and orientation, independent of WebGL. Production excludes
the preview fixture.

## Sword and golden apple

`client/items.ts` contains original extruded pixel silhouettes for a purple sword
and golden apple. Geometry and materials are shared between first-person items
and third-person held tools. The sword uses a stepped tip, purple guard, wrapped
hilt and the existing inexpensive glint shader. Apple stem and highlight patches
retain the block aesthetic. No reference images or Minecraft assets are bundled.
Eating raises the apple to the face; reduced motion suppresses its oscillation.
The equipment preview includes an Eat apple action and visible HP/item counts.

## Left-hand totem

`client/totem.ts` draws an original pixel-art gold charm with an emerald core and
winged silhouette. The HUD and activation overlay share this SVG. The matching
extruded model in `client/items.ts` is attached to the left hand in first person
and to the animated left arm on world avatars. Switching hands or consuming the
totem updates both models from the authoritative snapshot. The right-hand weapon
remains independent. Shared geometry and cached materials avoid per-frame builds.

The activation overlay stays outside the frequently updated HUD so its short
animation plays once. Reduced-motion preferences suppress the animation; the
image and two-heart message remain visible. No reference image or third-party
game asset is bundled.

## Streamed Wilds terrain

The secret passage switches the view between the citadel and a room-seeded
landscape. `shared/world.ts` defines deterministic height, triangle interpolation,
trees and collision. The server sends the seed and player realm, without terrain
meshes. `client/terrain-worker.ts` generates one 24×24 chunk at a time and transfers
its typed arrays. The renderer uploads at most one chunk each frame; queues,
resident chunks (25/49/81) and height caches (4,096 vertices) remain bounded.
Leaving an area disposes its geometry and instancing buffers. Trees share geometry
and materials, with two or three instanced draws per chunk depending on the mixture of canopies; grass uses original pixel noise.
Wilds renders without dynamic shadows, with quality-scaled fog masking the edge.
Worker failure falls back to one small chunk per frame and the Low chunk limit.

`/tests/world-preview.html` uses the production renderer with controls for walking,
quality, distant regions, the clearing and the stone door. It reports frame pacing,
resident chunks, draw calls and GPU resource counts. It is excluded from production.
On October 2, 2026, the development preview on an M4 Mac at 1280×720 sustained
about 120 FPS, with 95th-percentile frame intervals around 9–10 ms while walking
and after moving across several distant regions. High stayed at 81 resident chunks,
Medium at 49 and phone-sized Low at 25; texture counts stayed steady across regions,
and returning to the citadel released all terrain chunks. These are local desktop
measurements, including the phone viewport; physical phones were not benchmarked.
The production build retains its existing large-client-bundle warning.

Tests cover seams, shared terrain footing, collision and camera rays, door proximity,
portal return, realm isolation, flag drops and bounded schedules/caches. The ordinary
two-client Wilds integration verifies discovery, exploration, reconnect and return.

## Rune frontier iteration

A bounded coarse horizon extends detailed terrain, using one worker-produced
mesh outside the exact nearby ring, one water mesh and two instanced forest draws.
Near collision remains unchanged; far terrain samples every 12/8/6 blocks at
Low/Medium/High. The view ends in fog at 150/280/440 blocks. Every horizon has
fewer than 65,536 vertices, excludes the nearby square, regenerates only on chunk
or quality changes and disposes its predecessor. Worker fallback uses Low range.

The original sky shader uses a vertical atmospheric gradient and a sun disk;
84 instanced cloud puffs drift slowly. Grass, bark and leaf textures are locally
generated, with softened masonry seams and larger courtyard paving. Faceted
canopies use two nearby layers, a shared texture, per-instance tint and a subtle
vertex wind effect; water uses inexpensive Phong highlights and vertex ripples.
There is no bloom, screen-space reflection, downloaded art or new asset service.
Three seeded rune landmarks reuse geometry, glow sprites and colored beam meshes.
Rune sparks share a fixed pool of 256 points. Reduced motion freezes decorative
wind, ripples, cloud drift, rune rotation and reward aura, and suppresses sparks.

First-person hands hold the tools; swing arcs combine rotation on three axes,
small aim sway and landing motion. Third-person scarves move with running and
wind. The Warden aura uses shared ring/crystal geometry. These effects preserve
authoritative hit rays and movement.

`client/audio.ts` synthesizes original tones and filtered noise. It has one loop
for ambient wind, at most 32 transient voices, a master volume and a compressor.
Transient sources disconnect when finished. Footsteps follow traveled distance,
landings follow grounded transitions, and distant same-area events are quieter.
A user gesture creates/resumes audio; background tabs fade ambience and stop
scheduling music. There are no downloaded samples, always-running intervals or
autoplay prompts. The development world preview includes sound/dash/rune/aura
controls and reports context state and voice count.

## Biomes and waystone ruins

`shared/biomes.ts` blends nine nearby seeded habitat centers. Near chunks and the
coarse horizon share its vertex palette, preventing palette seams at their edge.
The meadow, Moonwood, Emberfields and Tideglade change canopy tint, density, flower
color and the synthesized ambience/melody tuning. Moonwood uses shared pointed
canopy geometry. Noise and terrain heights remain compatible with the earlier
Wilds landscape; new collision includes the seeded ruin pillars.

Each nearby chunk adds at most 16 flowers (half on Low) in one instanced draw,
with inexpensive vertex wind. `SpiritMoths` has one instanced draw and only
8/18/32 decorative moths at Low/Medium/High. It does not create network actors
or claim creature AI. Reduced motion freezes wings, flowers and moth movement.
Tree metadata is cached across seeds with a 2,048-entry bound, alongside the
existing 4,096-height limit and 25/49/81 resident-chunk limits.

Nine waystone landmarks include the arrival stone and eight seeded ruins. They
share masonry, ring/crystal geometry and four glow materials. Changing room seeds
disposes the old labels and instancing buffers. The center and all four approaches
remain walkable; actual terrain heights support each pillar. Discovery and Warden
travel are server-authoritative. Travel clears movement, pending attacks, owned
projectiles and outdated lag-compensation poses; it requires a discovered source
and destination, all three shards, a two-second rest and five damage-free seconds.

The constellation atlas is the same component in the game and development
preview. It caches one biome chart per seed while updating discoveries, player
location and travel readiness. Phone layouts scroll and keep every destination
accessible. The preview includes habitat/waystone controls, reduced motion, the
atlas and bounded-cache counters. All art and audio are generated locally from
original code; no Minecraft assets or external asset services are included.

## Shared rune construction

`shared/construction.ts` keeps at most 4,096 blocks in sparse 16m collision regions.
Nearby movement, projectiles and camera queries reuse cached boxes. Normal 20Hz
snapshots carry a revision and player counts, without full construction geometry.
Compact ordered edit packets replicate changes; joins/reconnects and gap recovery
receive a bounded full state. The client stages only edited cells for atomic updates.

`client/construction.ts` uses seven fixed-capacity instanced meshes and a single
placement preview cube. Visible matrices rebuild only on edits, graphics changes
or crossing a 16m camera region. All seven materials share cube geometry; rune glyph
textures, opaque opal glass, emissive tiles and the crystal wand are original assets.
There are no per-rune point lights, individual meshes or postprocessing passes.
Windlift jumps share client/server physics. Placement sparks share the fixed pool;
weave and erase sounds use the 32-voice synth budget. Reduced motion suppresses sparks.

Portable world uploads retain the 4KiB inbound WebSocket ceiling by sending up to
64 coordinate tuples per packet. Validation checks the whole bounded world before
replacing a lobby; landmarks, terrain and native geometry remain protected. The
host's optional three-world browser book is bounded and stores no player names.


## Shared supplies and Sky sails

`shared/forage.ts` deterministically places three original resource kinds in
clear patches. Supplies use one cache capped at 1,024 entries across seeds;
resource patches never become separate network actors. The server keeps only
at most 512 depleted patches, which regrow after 7,200 simulation ticks. Ordered
edit packets, bounded full states, and throttled recovery requests follow the
same replication pattern as rune construction. Small pantry counters and two
upgrade bits accompany ordinary snapshots. Harvesting and crafting validate the
authenticated explorer's position and state, without accepting client stock or
world-coordinate claims.

`client/forage.ts` uses five fixed-capacity instanced meshes for stems, wind-blown
leaves, reed heads, Gleamstone spires and Emberbloom heads. One selection halo is
reused. Matrices rebuild only on ledger edits, a 24m region crossing or quality
changes; Low/Medium/High display patches within 72/96/120m. Resources add no point
lights, terrain edits or texture uploads. Gather/craft/Hearthstone sparks reuse
the existing pool and their original chimes reuse the 32-voice synthesizer.

`client/sail.ts` shares two original five-vertex kite wings, edge geometry and a
crystal between first-person tips and every avatar. Sail flex and the gliding
pose reuse existing animation pivots; reduced motion freezes decorative flex.
The existing wind loop responds to flight without creating another audio loop.
Shared physics retains the ordinary jump/Windlift height, then eases descent to
1.4m/s, with terrain/cover collision and a ten-second flight limit. Landing,
damage, blocking, travel and realm changes fold the sail.

The seventh rune uses an original 32×32 heart glyph and warm emissive material,
sharing construction geometry and instancing. Its healing is server-authoritative
and checks cover, health and damage-free rest. Version-2 world saves retain
pantry/upgrades; version-1 worlds remain readable. Restoring a world renews resource
patches and resets personal state rather than restoring mid-flight players.
