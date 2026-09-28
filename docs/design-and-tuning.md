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
- **Glance:** anything slower. Recoil is the construct's contact damage × your recoil stat × (1 − damage dealt / 48), at least 25%.
- **Shield block:** a frontal ram under the shield's break value deals 18% and takes 40% of the recoil. Hits from above pass.
- **Armor:** rams under the armor gate are multiplied down; the number shows `ARMOR`.
- Decision: a well-executed attack avoids retaliation completely. This rewards steering for every build rather than only heavy ones.

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
| Phase one plate: body damage that gets through, all sources | 38% |
| Rivets | full damage from rams, blasts, arcs, and burns; 70 integrity each; each break costs the Colossus 40 |
| Burn on the boss or rivets | 60% |
| Other effect damage | 80% |
| Explosions | 65% |
| Reflected shot bonus | +6 |
| Body damage while stuck after a stamp (0.9 s, green ring) | 130% |
| Stamp telegraph | 0.7 s red band and chevrons |
| Barrage telegraph | 0.45 s flashing port |
| Phase three floor collapse warning | 1.8 s: pulsing floor, countdown text, alarm |

Phases: 1, crack the rivets (the objective line counts them); 2, the heart opens; 3, the middle floor gives way after the warning. The objective line always states the current task.

One ram at 80% of top speed into the open heart, then three seconds of after-effects (`tests/boss.test.ts`):

| Build | Ram | After 3 s | Extra sources |
| --- | --- | --- | --- |
| balanced | 51 | 51 | none |
| heavy | 104 | 104 | none |
| light | 19 | 19 | none |
| rebound | 37 | 37 | none |
| fire | 35 | 58 | burn 24, effects 10 |
| magnetic | 35 | 35 | arcs 13 |

Every representative build damages the heart. Light builds need many clean rams (about 30 at this rate for 860 integrity at Heat 0), which is the intended weakness; they have the speed and hop to get them. This is a measured estimate, not a playtested kill time.

## Representative build profiles

Measured in a flat test room with the real simulation. Builds are listed in `tests/helpers.ts`.

| Build | Top speed | To 90% (s) | Turn-around distance (px) | Hop height (px) | Bounce kept | Ram on a plate | Dash launch |
| --- | --- | --- | --- | --- | --- | --- | --- |
| balanced | 924 | 0.88 | 222 | 152 | 71% | 34 | 1018 |
| heavy | 615 | 0.89 | 133 | 61 | 2% | 77 | - |
| light | 953 | 0.35 | 112 | 341 | 3% | 35 | 1251 |
| rebound | 840 | 0.80 | 241 | 140 | 97% | 23 | 1016 |
| fire | 924 | 0.63 | 173 | 159 | 10% | 24 | 1018 |
| magnetic | 924 | 1.18 | 254 | 133 | 71% | 7 | - |

Reading it: heavy rams more than twice as hard as light and cannot hop more than a 61 px step, so every required route has a floor path (the heavy build crosses the revised Swarm Loft and escapes every slag pool in tests). Light reaches speed in a third of the time and hops over 300 px. Rebound keeps almost all of its bounce. Magnetic's Lightning Impact is grounded by Iron Plates (7), as designed; its answer to plates is Magnet Pull. These are tuning facts, not balance verdicts; see the open questions below.

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

## Open tuning questions for playtests

- Is 55% of top speed the right clean-ram threshold for light builds on short rooms?
- Heavy's 61 px hop: does it feel deliberate or punishing on stair rooms?
- Light builds need about 30 clean rams on the Colossus heart: too many?
- Does the slag spit make slag rooms too forgiving at Heat 0?
