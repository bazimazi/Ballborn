# Design and tuning notes

Rules the implementation now follows, and the numbers behind them. Every table here is produced by a test (`tests/profile.test.ts`, `tests/boss.test.ts`, `tests/matrix.test.ts`) so it can be regenerated after tuning.

## Time and determinism

- Gameplay advances in fixed ticks of 1/120 s (`TUNE.fixedDt`). Rendering interpolates the ball between the last two ticks.
- A rendered frame spends at most 0.1 s of real time (12 ticks); longer hitches drop the excess. A 20 Hz display still runs at full game speed.
- Game speed scales how much real time becomes game time, never the tick length.
- Hit pause, the pause menu, the build sheet, and focus loss stop ticks. Pressed actions (hop, ability) are latched until a tick consumes them, so a press is never lost in a frame with zero ticks and never repeated in a frame with several.
- Random streams: the run stream (route, rewards, shops, events) is serializable and saved at checkpoints; each room's combat stream is derived from the run seed and a room counter; particles and camera shake use a separate cosmetic stream that gameplay never reads.
- **Determinism boundary.** The same content version, room seed, settings, and tick-indexed inputs give the same result in the same JavaScript engine, at any refresh rate and any particle setting (tested at 30, 47, 60, 120, and 144 Hz). Bit-identical results across different engines or CPUs are not claimed. A run seed alone does not fix the outcome of different player actions.

## Damage to the ball

One pipeline (`Simulation.hurt`, rules in `src/data/damage.ts`), in this order: dash phase, hit window, armor, tutorial scaling, damage assist, shield, integrity, then `onDamaged`, then `onLowHp`, then the lethal check.

| Source | Armor applies | Dash phases through | Hit window | Over time |
| --- | --- | --- | --- | --- |
| Construct contact | yes | yes | yes | no |
| Ram recoil | **no** (governed by the recoil stat instead) | yes | yes | no |
| Projectiles | yes | yes | yes | no |
| Explosions | yes | yes | yes | no |
| Slag | yes | no | no | yes |
| Slag geysers | yes | no | no | yes |
| Spikes | yes | yes | yes | no |
| Stamps | yes | no | yes | no |
| The Colossus | yes | yes | yes | no |
| Falling out of the room | instant | no | no | no |

- **Second Wind** and any other low-integrity effect resolve before the lethal check, so the once-per-room weld can catch a hit that would otherwise have ended the run, from any non-instant source including slag.
- The lab catches lethal hits and falls instead of ending the session.
- Damage taken is recorded per source and shown on the run summary.

## Rams

- **Clean ram:** closing speed at least 55% of your top speed (the notch on the speed ring), or a ram that breaks the construct, and not blocked by a shield. Clean rams take no recoil, show `CLEAN`, and play a heavier impact.
- **Ram damage:** mass^0.65 × closing speed × 0.03 × impact × combo (`TUNE.massImpactExp`). It was linear in mass, which made a heavy core about five times a light one; now heavy is about 1.7× and light about 0.75× a balanced core at the same share of top speed.
- **Glance:** anything slower. Recoil is the construct's contact damage × your recoil stat × (1 − damage dealt / 48), at least 25%, × 0.65 (`TUNE.recoilScale`; it was × 1, and a light build died to recoil alone in its first elite room).
- **Shield block:** a frontal ram under the shield's break value deals 18% and takes 40% of the recoil. A shield needs 0.5 s (the knight 0.625 s) to turn after the ball crosses over it. A crown hit, a ram from behind, or a ram past the break value **breaks the guard** for 1.5 s: frontal rams land in full until it is back up (`TUNE.shieldTurn`, `TUNE.guardBreak`).
- **White Hot:** at a ×5 combo (`TUNE.overdriveCombo`), while the chain holds, every ram is clean, deals 125%, and folds shields. The combo step is 6% per link (was 8%).
- **Armor:** rams under the armor gate are multiplied down; the number shows `ARMOR`.
- Decision: a well-executed attack avoids retaliation completely. This rewards steering for every build rather than only heavy ones.
- **Plow-through:** a clean ram that breaks the construct undoes the collision bounce and keeps `clamp(1 − (construct mass / ball mass) × 0.09, 0.62, 0.90)` of the ball's velocity (`TUNE.plowDrag`, `plowKeepMin`, `plowKeepMax`). Before this, every kill bounced the ball back, so a fast ball could never carry a run through a line of constructs. A ram that does not kill still rebounds.
- **Kill refund:** any ram kill leaves 55% of the remaining ability cooldown (`TUNE.killCooldownKeep`). Aggression feeds the next dash or slam.
- **Wall kick:** a hop pressed in the air within 0.12 s of touching a wall (`wallKickWindow`) sends the ball away from it at `max(|vx|, 62% of top speed)` with 92% of a floor hop (`wallKickSpeed`, `wallKickHop`). Only a fresh press counts (a held hop buffered for the floor never kicks), so float-holding near walls is unchanged.

## Abilities and overspeed

Input never accelerates the ball past its top speed, but overspeed from a dash, slam, burst, turbo pop, or spring now bleeds away (quickly normally, slowly for a moment after an ability) instead of being cut on the same tick. Before this change a dash at top speed did nothing.

## Rooms and recovery

- **Slag spits.** Touching slag throws the ball upward (at least 700 px/s) at most once every 0.35 s, costing a quarter-second of slag damage on top of the burn. Every open slag pool in every room returns even the heavy build above floor height (tested). The Colossus Hold's seam between floors is now slag rather than a bottomless pit.
- **Constructs cannot block a room.** A construct that touches slag or leaves the room dies (`MELTED` / `LOST`), drops its loot at the lip, and counts as cleared. Flying constructs are kept inside the room.
- **Loot** rests on real surfaces, rides moving platforms, floats on slag, and never falls out of the room. Cinders never expire. When the gate opens, every drop flies to the ball; anything still uncollected is credited at the exit. Healing drops fade after 12 s. In the lab, loot fades after 10 s.
- **Conveyors** are moving surfaces: friction acts relative to the belt, so a resting ball rides it. (Before, friction cancelled the belt and a resting ball crept at about 10 px/s.)
- **Moving platforms** carry walkers as well as the ball.
- **Revised rooms:** Swarm Loft is now a ricochet arena (a low roof over an open floor any build can cross); Moving Yard explains the slag rule; Turret Walk names the three ways to turn shots around; Colossus Hold's seam is slag.
- Ranged walkers (Forge Bolt) back away inside 240 px, as the codex says. Shooting constructs show a 0.35 s wind-up ring before every shot; a Blink Wisp always waits at least 0.6 s after a blink before firing.

## The Iron Colossus

All effect targeting goes through one list of targets (constructs, the Colossus body, and its rivets), so status, chains, area, explosions, reflected shots, and direct part bonuses work on the boss. Explicit rules (`BOSS_RULES` in `src/sim.ts`):

| Rule | Value |
| --- | --- |
| Integrity | 1,050 (was 940) |
| Phase one plate: body damage that gets through, all sources | 38% |
| Phases two and three, between attacks (shutters closed) | 50% |
| Punish window after a stamp / shockwave / barrage (green ring) | 0.9 s / 1.05 s / 0.6 s, body damage 130% |
| Shockwave (phases two and three) | 0.75 s wind-up (the body rears, chevrons run along the floor); a crest 34 px high at 550-610 px/s; 14-18 damage; any hop clears it; phase three sends a second one 0.6 s later |
| Combo from the Colossus | only hits inside a punish window, at most one link per 0.7 s (it stands still; it was a combo farm) |
| Rivets | full damage from rams, blasts, arcs, and burns; 70 integrity each; each break costs the Colossus 40 |
| Burn on the boss or rivets | 60% |
| Other effect damage | 80% |
| Explosions | 65% |
| Reflected shot bonus | +6 |
| Stamp telegraph | 0.7 s red band and chevrons |
| Barrage telegraph | 0.45 s flashing port |
| Phase three floor collapse warning | 1.8 s: pulsing floor, countdown text, alarm |

Phases: 1, crack the rivets (the objective line counts them); 2, the heart opens; 3, the middle floor gives way after the warning. The objective line always states the current task.

One ram at 80% of top speed into the open heart, then three seconds of after-effects (`tests/boss.test.ts`):

Measured inside a punish window:

| Build | Ram | After 3 s | Extra sources |
| --- | --- | --- | --- |
| balanced | 70 | 70 | none |
| heavy | 111 | 111 | none |
| light | 31 | 31 | none |
| rebound | 50 | 50 | none |
| fire | 50 | 78 | burn 28, effects 15 |
| magnetic | 47 | 47 | arcs 18 |

Every representative build damages the heart. A bot that rams well and hops the shockwaves took about 31 s and lost about half its integrity with a starter build (before this pass: 16 s and a fifth, because every body hit stacked the combo and the heart took full damage at any time). A person should expect a minute or more.

## Representative build profiles

Measured in a flat test room with the real simulation. Builds are listed in `tests/helpers.ts`.

| Build | Top speed | To 90% (s) | Turn-around distance (px) | Hop height (px) | Bounce kept | Ram on a plate | Dash launch |
| --- | --- | --- | --- | --- | --- | --- | --- |
| balanced | 924 | 0.64 | 222 | 154 | 71% | 34 | 1018 |
| heavy | 615 | 0.89 | 133 | 61 | 2% | 56 | - |
| light | 953 | 0.35 | 112 | 341 | 3% | 41 | 1251 |
| rebound | 840 | 0.68 | 184 | 145 | 89% | 26 | 1016 |
| fire | 924 | 0.63 | 173 | 159 | 10% | 24 | 1018 |
| magnetic | 924 | 0.74 | 254 | 135 | 71% | 7 | - |

Reading it: heavy rams clearly harder than light (the light build here carries Spiked Shell's contact damage) and cannot hop more than a 61 px step, though a rolling ball now climbs ledges up to 40 px by itself, so every required route has a floor path (the heavy build crosses the revised Swarm Loft and escapes every slag pool in tests). Light reaches speed in a third of the time and hops over 300 px. Rebound keeps almost all of its bounce. Magnetic's Lightning Impact is grounded by Iron Plates (7), as designed; its answer to plates is Magnet Pull. These are tuning facts, not balance verdicts; see the open questions below.

## Economy

- **Embers are one permanent resource** (decision). They are kept between runs, earned from elites (1), treasure (sometimes 1), shops (64 cinders), and achievements, and spent at the Annealing and the Crucible. The old save field `embers` was already permanent and had no consumer; the migration keeps every ember and makes them spendable. The old per-run ember pool is gone. No new currency was added.
- **Cinders** are run-only. **Scrap** is permanent and forges parts.
- Abandoning before clearing a room pays nothing (it used to pay 2 scrap, repeatable instantly).
- Event cards are generated from their own outcome data. Declines pay 18 (Overcharge), 10 (Blood Forge), 12 (Molten Bath, Annealing), or 15 (Crucible), exactly as printed. Each event appears at most once per run. The Annealing is free once per run, otherwise it costs an ember. The Crucible costs an ember, or 24 integrity if you have none, and names the slot it empties. The Blood Forge names the part it will fit before you pay.
- **Keep the ball** (salvage) pays 8 cinders after combat, 14 after an elite, 12 at a treasure.
- Every equipment change (reward, shop, event, evolution, fusion, lab) keeps the integrity fraction, clamps energy, tracks rarity, and reports reactions gained and lost.

## Forge Heat

Heat is cumulative and shown on the title screen for the selected level.

| Heat | Changes |
| --- | --- |
| 0 | None. |
| I | Constructs shoot and attack 15% more often; room recovery 8% (from 10%); construct integrity +5%. |
| II | Heat I, plus two slag geysers in combat and elite rooms; elites +15% integrity; constructs hit 8% harder; shop prices +18%. |
| III | Heat II, plus gravity +8%; the Colossus attacks 0.36 s sooner; healing drops halved; room recovery 6%. |

Encounter demands (tempo, geysers, gravity) now carry more of each step than integrity inflation.

## World voice

The Foundry's foreman comments once on each run summary (`src/data/lines.ts`): the ball is scrap that keeps being recast, and each failure is ore for the next pour. Lines are short and optional to read.

## Component audit

Checked by `tests/matrix.test.ts`: every part states an upside and a cost and changes the ball. Fixed descriptions and contracts: Flaming Shell no longer promises that burning constructs "panic"; Wildfire's burn now really spreads to neighbours; the knockback action pushed constructs toward the ball and now pushes them away; `onDamaged` is now dispatched; the `pickup` attraction target is implemented; ice platforms now have low grip.

Near-duplicates to revisit (not changed yet): Momentum Engine and Momentum Harvest both reward sustained speed; Inferno and Combustion differ mainly in numbers until Chain Reaction is present.

| Part | Slot | Rarity | Mechanic | Cost | Enables | Versus the Colossus |
| --- | --- | --- | --- | --- | --- | --- |
| Balanced Core | core | common | stats only | No extreme strength. Other cores will outshine it in a specialty. | - | movement/stat change only |
| Heavy Core | core | common | stats only | Sluggish acceleration, a short hop, and weak air control. | Mass Hammer, Vampire Circuit | movement/stat change only |
| Light Core | core | uncommon | stats only | Collisions glance. Integrity is thin. | - | movement/stat change only |
| Glass Core | core | rare | stats only | Very little integrity, and you take extra contact damage. | Critical Momentum, Glass Cannon | movement/stat change only |
| Magnetic Core | core | rare | projectiles: attract | Heavier, and shots that miss your catch still find you. | Arc Tether | returns barrage shots |
| Volatile Core | core | epic | instability | The blast includes you, and your shell is thinner. | Burning Detonation, Reactor | movement/stat change only |
| Rubber Shell | shell | common | projectiles: reflect-fast | Low grip. You slide past the thing you meant to hit. | Storm Bounce, Bulwark Rhythm | returns barrage shots |
| Spiked Shell | shell | common | stats only | Almost no bounce, and no armor. | Mass Hammer, Vampire Circuit | movement/stat change only |
| Armored Shell | shell | uncommon | stats only | Dull bounce and a lower top speed. | Bulwark Rhythm | movement/stat change only |
| Flaming Shell | shell | rare | status | The shell runs hot. Less integrity, no armor. | Burning Detonation, Wildfire | burns boss and rivets (x0.6) |
| Conductive Shell | shell | rare | chain | The arcs are the damage. Direct hits are ordinary. | Arc Tether, Storm Bounce, Bulwark Rhythm | arcs reach rivets and heart (x0.8) |
| Momentum Engine | momentum | common | damage | You take a little more when a fast hit goes wrong. | Critical Momentum, Harvest Cadence, Reactor | bonus counts as ram damage |
| Gyro Stabilizer | momentum | uncommon | energy | A lower top speed. The gyro spends power on poise, not pace. | - | movement/stat change only |
| Turbo Coil | momentum | rare | impulse+controlTax | After each pop, air control dips. | Critical Momentum, Harvest Cadence, Reactor | movement/stat change only |
| Rebound Engine | momentum | epic | counter+damage | The first hit is weaker. The engine needs a warm-up. | Storm Bounce, Critical Momentum, Bulwark Rhythm | bonus counts as ram damage |
| Crush Impact | impact | common | damage | No element, no area. One target, one answer. | Mass Hammer, Vampire Circuit | bonus counts as ram damage |
| Fire Impact | impact | uncommon | status | The instant hit is softer than a pure crush. | Mass Hammer, Burning Detonation, Wildfire | burns boss and rivets (x0.6) |
| Lightning Impact | impact | rare | chain | Weaker against a single armored target. Plates ground the arc. | Arc Tether, Storm Bounce | arcs reach rivets and heart (x0.8) |
| Explosive Impact | impact | epic | explode | Needs speed, and the direct hit is only a fuse. | Burning Detonation, Reactor | blasts reach boss (x0.65) |
| Shockwave Impact | impact | rare | knockback+area | You launch enemies out of your own follow-up. | Mass Hammer, Vampire Circuit | area reaches boss (x0.8) |
| Dash | ability | common | ability: dash | It spends energy and does not hit by itself. | - | movement/stat change only |
| Ground Slam | ability | uncommon | ability: slam | Useless if you never leave the floor. A whiff still spends the cooldown. | Mass Hammer, Vampire Circuit | ability blast hits boss |
| Air Burst | ability | uncommon | ability: burst | The damage is modest. This is a key, not a hammer. | - | ability blast hits boss |
| Magnet Pull | ability | rare | ability: magnet | A long cooldown, and it does nothing in a silent room. | Arc Tether | movement/stat change only |
| Combo Engine | passive | common | energy+heal | The base hit is slightly softer if you fight in isolated slams. | Harvest Cadence | movement/stat change only |
| Momentum Harvest | passive | uncommon | energy | Standing still, you are ordinary. The passive is the pace. | Critical Momentum, Harvest Cadence, Reactor | movement/stat change only |
| Siphon Rivets | passive | uncommon | heal | Less max integrity. Soft hits do not feed you. | Mass Hammer, Vampire Circuit | movement/stat change only |
| Chain Reaction | passive | rare | explode | Your own energy recovers slower. The chaos spends it. | Burning Detonation, Wildfire, Harvest Cadence | blasts reach boss (x0.65) |
| Second Wind | passive | epic | heal+shield | You start each room with less max integrity. | Bulwark Rhythm, Vampire Circuit | movement/stat change only |
| Reinforced Rubber | shell | uncommon (evolution) | projectiles: reflect-fast | Still slippery. Precision is a choice you keep making. | Storm Bounce, Bulwark Rhythm | returns barrage shots |
| Inferno Impact | impact | rare (evolution) | status | Still a single-target answer until something else makes fire spread. | Mass Hammer, Burning Detonation, Wildfire | burns boss and rivets (x0.6) |
| Combustion Impact | impact | rare (evolution) | status+explode | The burn itself is milder than Inferno. | Mass Hammer, Burning Detonation, Wildfire | burns boss and rivets (x0.6) |
| Singularity Mass | core | legendary (fusion) | damage+area | You are a siege engine. Climbing and turning are chores. | Mass Hammer, Vampire Circuit | area reaches boss (x0.8) |
| Electromagnetic Heart | core | legendary (fusion) | projectiles: attract | You are the lightning rod. Miss the catch and the room aims at you. | Arc Tether, Storm Bounce | arcs reach rivets and heart (x0.8) |
| Pinball Heart | shell | legendary (fusion) | projectiles: reflect-fast | Thin integrity and almost no grip. The floor is not your friend. | Storm Bounce, Critical Momentum, Bulwark Rhythm | bonus counts as ram damage |

## Game feel

Everything here is cosmetic. The simulation reports what happened through `FxEvent`s (`src/sim.ts`), and `src/juice.ts` turns them into effects with its own random stream. Nothing in it is read back by gameplay, so seeded replays stay exact.

| Moment | What the player sees | Numbers |
| --- | --- | --- |
| Any ram | Impact star, sparks thrown along the ram, camera kick along the ram, ball squash along the contact normal | Kick 3-10 px; squash 0.16-0.30 on an under-damped spring |
| Clean ram | Shockwave ring, small zoom punch | Zoom punch up to +8% |
| Break | Tumbling shards that bounce and settle, smoke, a scorch left on the floor for 14 s | Hit pause 65 ms (elite 110 ms) |
| Heavy ram (over 60 damage) | Longer hit pause | 60-100 ms |
| Last construct | Slow motion, "Gate open" banner, chord | 0.5 s at 35% speed |
| Colossus phase / rivet | Big ring, debris, banner | Hit pause 160 ms / 90 ms |
| Colossus down | Chain of explosions, slow motion | 1.5 s at 30% speed |
| Ball breaks | Ball shatters, 1.4 s beat with "SHELL FAILED" before the summary | The first 0.5 s runs at 60% |
| Clean-ram speed reached | Green pulse ring, rising chirp, two charge arcs circling the ball, a hot ribbon trail | Arms at 55% of top speed, disarms under 49% |
| Plow-through | Cone of sparks ahead of the ball, forward camera kick, zoom punch, a rip and thump | Kick 9 px, zoom +2.5% |
| Wall kick | Dust puff and ring at the wall, sideways squash, knock-and-lift sound, a short buzz on touch | Kick 5 px |
| Gate opens | Light burst with rays and two rings at the gate | Zoom +4%, trauma 0.25 |
| Elite kill, rivet, Colossus phase, ball breaks, rams over 140 | Impact frame: one beat of inverted, desaturated contrast, then a warm afterglow | Rate limited to one per 0.7 s; off with screen flashes or camera motion |
| Near top speed | Radial speed lines at the screen edge, redrawn 18 times a second | From 82% of top speed |

Camera shake uses trauma (0-1, decays 1.25 per second). Shake is trauma squared times 16 px, plus a roll of up to 0.03 rad. Screen flashes are capped at 28% opacity.

The settings still apply to all of it. **Screen shake** scales trauma and kick. **Particles** scales every spawn count. **Hit pause** also turns off slow motion. **Camera zoom and look-ahead** turns off zoom punch, squash, speed lines, the room iris, card tilt, and CSS motion. Telegraphs, rings, and hazard warnings draw at every setting.

The painted art in `public/art/foundry-v1/images/` ships as WebP (about 250 KB in total, down from 6 MB of PNG). It is used as the title backdrop, a far parallax layer in rooms, and the Colossus intro portrait. If an image fails to load, the procedural scene is drawn instead.

## The overhaul (November 2026)

Research input: Celeste's forgiveness write-up, Vlambeer's "Art of Screenshake", Slay the Spire's card-reward odds, Vampire Survivors' banish, Hades' rerolls and Pact of Punishment, Spelunky's Daily Challenge, Balatro's signposting, Poki and CrazyGames onboarding benchmarks, the Game Accessibility Guidelines and Xbox guideline 118 (photosensitivity), and Chris Wilson's "two clocks" Web Audio scheduling. Items the game already had (coyote time, hop buffer, speed ring, look-ahead, camera kick, rerolls, boss punish window) were kept as they were.

| Change | Rule | Numbers |
| --- | --- | --- |
| Route | 8 layers: combat/traversal, combat/challenge/combat, treasure/event/shop, elite/combat/challenge, event/traversal/combat, elite/challenge/combat, shop/treasure, boss | 7 rooms; about 12 minutes (CrazyGames reports ~13-minute action sessions) |
| Depth scaling | Construct integrity per layer | +6.5% (was +8%); the Colossus 940 (was 860) |
| Run scrap | Death 4 + 2.4 per room + 5 per elite; victory 24 + 3 per room + 10 per heat | Keeps scrap per run near the old five-room totals |
| Grades | Pace (≤ par 2, ≤ 1.5× par 1) + shell (untouched 2, ≤ 12% 1); judged when the gate opens, or at the exit for open traversals | Par = 6 + width/240 + 3.2 per construct (elites 2.5×); survival = timer + 4; S/A/B/C pay 10/6/3/0 cinders |
| Score | Rooms 100, elites 150, constructs 10, best combo 15, grades S/A/B/C 160/100/45/10, Colossus 1,000; × (1 + 0.25 × heat); assist cuts (1 − assist) / 2 | Shown line by line on the summary |
| Daily Forge | FNV-1a hash of the local date; Heat 0; best and attempts kept per day | Same date, same route |
| Banish | Two per run; the part leaves the pool, the card is redrawn from the same table | |
| Rarity pity | +6 to rare weight (+3 epic) per reward screen with no rare part; resets on one | Cap +40 |
| Reaction hints | A dashed chip when the part brings an inactive reaction to exactly one missing tag | At most two per card |
| Elite affixes | One per elite (room stream): Hasted ×1.45 move, ×1.35 fire rate; Plated armor gate +6 (min 20) and ×0.85; Volatile bursts on death (125 px, 18); Magnetic tow 560 | Never in the lab |
| Ram Hound | Wind-up 0.62 s (shake, red chevrons), charge 0.9 s at 5.4× walk speed; wall: dazed 1.3 s, end of run 0.9 s; a caught ball takes 1.15× contact; a head-on ram during a charge deals ×1.5 (`COUNTER`) and dazes it 1.2 s | 84 integrity, mass 1.6 |
| Off-screen arrows | Edge arrows for unseen constructs, sized by distance, red and pulsing while one winds up | |
| Flash limit | A second flash within 0.34 s is cut to 30% | About 3 per second at most |
| Victim shake | A struck construct rattles during the hit pause (real time) | Up to 3.2 px |
| Music | 116 bpm rooms, 128 bpm boss (+6 per phase), 78 bpm menu; layers by intensity: bass > 0.12, anvil > 0.25, hats > 0.3, four-on-the-floor > 0.55, sixteenth hats > 0.62, arpeggio > 0.66 | Kills duck the music 30% for 60 ms, phases 70% |

New rooms: **Hound Kennel** (combat; two hounds, a slag gap with a stepping plate) and **Charge Yard** (elite; an elite hound, a bolt, a grunt). New achievements: Matador, Perfect Pour, Daily Smith.

## Play pass two (November 14, 2026)

Played in the browser with a scripted player that presses real keys (run-ups, hops, crown hits, vaults, shockwave hops), then measured with the simulation. What it found, and what changed:

| Found in play | Change | Numbers |
| --- | --- | --- |
| A heavy core one-shot almost everything; a light core needed three rams per grunt and died to recoil in its first elite room | Ram damage grows with mass^0.65; light core impact ×0.86 (was ×0.72) and +10% crit; heavy core impact ×1.45 (was ×1.5); glance recoil ×0.65 | Per ram at 80% speed against a balanced core: heavy 1.65× (was 2.4×), light 0.73× (was 0.55×) |
| A rolling ball bonked backward off every low step, turret mount, and bridge lip (a rubber shell bounced away) | A grounded ball climbs a ledge up to 40 px, keeping 93% of its speed | `TUNE.stepUp`, `TUNE.stepKeep` |
| Shields always faced the ball: only a crown hit worked, and the elite Furnace Knight had 403 integrity | Shields turn slowly; crown hits, back hits, and folding rams break the guard for 1.5 s; the knight's base integrity 200 (was 250) | `TUNE.shieldTurn` 0.5 s, `TUNE.guardBreak` 1.5 s |
| The Colossus fell in 16 s: every body hit added to the combo, and the open heart took full damage at any time | Shutters between attacks (50%), punish windows after each attack (130%), the shockwave attack, combo only from punishes, integrity 1,050 | See the Colossus table |
| Fights had no peak beyond a kill | White Hot at a ×5 combo: every ram clean, 125% damage, folds shields | Combo step 6% (was 8%) |
| The ball and constructs were small on screen; with the ball on a spring the floor fight slid under the bottom HUD | Camera 1.3× at rest easing to 1.06× at speed (was 1.13× to 0.94×); vertical framing hangs off the floor line | Shooters open fire within 720 px (was 860), about the visible half-width |
| The Speed Lane (a challenge with no constructs) graded every run at 0.0 s, an automatic S | Rooms with nothing to break are graded on the run to the exit | `tests/playpass.test.ts` |
| Room banners, toasts, and the tutorial prompt covered the playfield | Banners sit high and narrow (only the boss intro is central); in-room toasts are small, two at most; the prompt waits for the banner | |
| Reward previews drew the ball about 5 px wide | The preview follows the new ball at 120 world px tall, over a floor marked every 100 px; the Weld card shows the integrity bar before and after | |

## Open tuning questions for playtests

- Are the par times fair for a first run, or should S be rarer still? (Par assumes a player who already rams cleanly.)
- Is a seven-room route the right length on phones?

- Is 55% of top speed the right clean-ram threshold for light builds on short rooms?
- Heavy's 61 px hop: does it feel deliberate or punishing on stair rooms?
- Light builds need about 30 clean rams on the Colossus heart: too many?
- Does the slag spit make slag rooms too forgiving at Heat 0?
