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
