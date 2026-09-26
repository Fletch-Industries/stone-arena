# Minecraft mechanics reference

Reviewed 2026-09-25. Target: modern **Java Edition** sword/axe/bow/crossbow PvP,
unenchanted diamond melee equipment, with original arena armor progression. This is a browser arena
adaptation, not an exact Minecraft engine or a mixture with pre-1.9/Bedrock combat.
One arena unit represents one block; stored HP uses a 5× scale, so 100 HP still
represents ten hearts. All damage, motion and hit outcomes are server-authoritative.

## Reference and implementation

| Mechanic | Stone Arena behavior |
| --- | --- |
| Movement | Walk 4.317 blocks/s; forward sprint 30% faster (5.6121). Normalize diagonals. Blocking/drawing slows movement. |
| Jump | Approximately 1.252-block apex, grounded jumps only; sprint-jump adds forward momentum. |
| Melee | Three-block targeting ray, blocked by cover. Diamond sword: 3.5 hearts and 0.625 s recovery. Diamond axe: 4.5 hearts and 1 s recovery. |
| Attack strength | Damage scales as `0.2 + 0.8 × charge²`. Misses and switching melee weapons reset recovery. Early clicks are weak; HUD shows recovery. |
| Knockback | Push away from the hit source, with lift for grounded targets. An airborne target receives horizontal impulse without renewed lift. Sprint hits add a stronger horizontal impulse and cancel sprint. Release/repress forward or sprint to reset. |
| Criticals | A charged hit while descending, airborne and not sprinting deals 1.5× melee damage. Rising jumps do not crit. |
| Sweeps | Charged grounded sword attacks at walking speed or below hit nearby opponents for half a heart and knockback. Sprint/critical attacks do not sweep. |
| Damage window | Half-second protection from repeat equal/weaker hits, including repeated knockback. A stronger hit applies only the extra damage. |
| Shield | Quarter-second raise delay; blocks frontal damage and knockback, repels melee attackers. Rear hits remain vulnerable. Any blocked axe hit disables it for five seconds. |
| Bow | One-second full draw; curved draw power, release to fire, minimum power threshold. Fully drawn arrows can crit. |
| Crossbow | 1.25 s load; keeps a loaded arrow when switched away. Separate load/fire actions. |
| Arrows | Bow launch up to 60 blocks/s, crossbow 63; gravity, air drag, speed-based damage, critical bonus, and swept collision. Shield direction comes from the incoming arrow, not the shooter's later position. |
| Animation | Opposing arm/leg rotations based on distance traveled, stronger running strides, distinct airborne/landing poses, head pitch, held tools, weapon swings and red hurt tint. First-person grounded bob honors reduced-motion settings. |

## Deliberate arena adaptations

- Physics is a shared 60 Hz implementation, not Minecraft's 20 Hz physics engine.
  Jump height and ground speeds are matched; acceleration, air control, collision
  corners, knockback distance and jump flight time are approximations.
- The player-requested 120-degree FOV remains the default. Sprint does not widen it.
  F5 cycles first/rear/front perspectives; V and a mobile View button are browser
  conveniences. Camera movement does not change attack rays or player controls.
- Ctrl and double-tap W sprint. Shift remains an alias for the game's existing
  controls; sneaking/crouching is not implemented. Mobile retains its sprint toggle.
- Hold-to-repeat melee and tap-to-load crossbow remain touch-friendly conveniences.
  Bow/shield share the existing Attack/Shield controls rather than Java's use-item
  mouse binding. Arrow aim has no random spread; critical damage is server-random.
- Armor is an arena adaptation: 1 XP per actual HP of damage and 50 per elimination.
  At 50 XP, Guard armor reduces damage 20%; at 150 XP, Enchanted armor reduces
  it 35%. Both apply after shield/hurt-window checks, without healing or changing
  knockback. Protection upgrades take effect after the current simulation tick.
  XP resets each round. The violet glint is cosmetic; Minecraft armor points,
  toughness, XP orbs and enchantment formulas are not implemented.
- Golden apples are another arena adaptation: two per round, 1.6-second use,
  up to four hearts of immediate healing. No regeneration/absorption status
  effects; fatal damage on the completion tick prevents healing. Purple sword
  appearance is cosmetic and adds no enchantment damage.
- No hunger, passive regeneration, durability, fall damage, swimming,
  crafting, block placement or world destruction. The one-life arena rules stand.
- Walk/run/jump poses are original procedural animations. They are not copied
  Minecraft assets or a claim of frame-for-frame animation parity.

## Sources

Primary gameplay and technical references:
- [Minecraft: keyboard controls](https://edusupport.minecraft.net/hc/en-us/articles/360047116832-Minecraft-keyboard-and-mouse-controls):
  F5 first-person/rear/front perspective cycle, verified 2026-09-26.
- [Mojang: controls](https://www.minecraft.net/en-us/article/minecraft-controls):
  movement, jump, Ctrl sprint, hotbar, attack/use and touch controls.
- [Mojang: sword](https://www.minecraft.net/en-us/article/taking-inventory--sword):
  diamond sword damage, charged Java sweep attacks and knockback.
- [Mojang: shield](https://www.minecraft.net/en-us/article/taking-inventory--shield):
  frontal protection, slowing, attacker recoil, knockback protection and axes.
- [Mojang: weapon/blocking components](https://www.minecraft.net/en-us/article/minecraft-snapshot-25w04a):
  explicit shield delay and shield-disable duration. Older guides describing a
  25% axe-disable chance do not describe the modern behavior used here.
- [Mojang: bow](https://www.minecraft.net/en-us/article/taking-inventory--bow) and
  [crossbow](https://www.minecraft.net/en-us/article/taking-inventory--crossbow):
  draw/release, separate crossbow loading/firing, and retained loaded state.
- [Microsoft: animation overview](https://learn.microsoft.com/en-us/minecraft/creator/documents/animations/animationsoverview?view=minecraft-bedrock-stable):
  distance-driven joint rotations and state-based animation. This is Bedrock
  creator documentation used as a rendering reference only, not combat rules.

Community gameplay cross-checks (edition differences and numerical tuning):
[Java PvP](https://minecraft.wiki/w/Tutorial:Player_versus_Player),
[knockback](https://minecraft.wiki/w/Knockback_(mechanic)),
[blocking](https://minecraft.wiki/w/Blocking),
[combat](https://minecraft.wiki/w/Tutorial:Combat),
[arrows](https://minecraft.wiki/rest.php/v1/page/Arrow/html), and
[sprinting](https://minecraft.fandom.com/wiki/Sprinting).
Some wiki pages are unavailable directly; accessible search excerpts were used
as cross-checks, not as proof of complete parity with every current release.

## Verification

`npm test` covers movement, jump height, grounded/airborne/sprint knockback,
critical conditions, recovery, hurt windows, shield direction/delay/disable,
sweeps, projectile speed/collision, boundary containment and prediction replay.
Existing multiplayer, reconnect and room-lifecycle checks remain applicable.
`/tests/animation-preview.html` is a development-only visual fixture using the
actual simulation and renderer. Production builds exclude this preview.
