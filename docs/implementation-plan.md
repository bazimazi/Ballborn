# Implementation plan and results

Working plan for the brief in `ai-improvement-prompt.md`, kept up to date with what actually happened. Baseline: commit `e782565`, clean tree, `npm run build` passing, no test suite.

Labels: **Defect** (confirmed wrong behaviour, reproduced before fixing), **Hypothesis** (design change expected to help, needs playtests), **Tuning** (a number or rule chosen deliberately), **Deferred** (not done; see the end).

## Phase 1: correctness and the player's run - done

| # | Player problem | Evidence | Change | Modules | Verification | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | A room can become impossible to finish | Moving Yard grunt fell forever (reproduced) | Constructs that touch slag or leave the room die, drop loot, and count; walkers ride moving floors; flyers stay inside | `sim.ts` | `phase1` §1, every room idle 30 s | Defect, fixed |
| 2 | Old branches stay open | Seed 123, `n0-1` open after `n0-0` (reproduced) | Node states `open/active/done/missed`; entering closes other choices; complete once | `run.ts`, `game.ts` | 100 seeds walked to the boss | Defect, fixed |
| 3 | Boss edits shared content | Phase 3 added lava to the template (reproduced) | Simulation clones its room; all content deep-frozen | `sim.ts`, `util.ts`, `data/*` | template unchanged; frozen | Defect, fixed |
| 4 | Room recovery lost; death/clear races | `onClear` heal overwritten (source) | Simulation only sets `ended`; `commitRoom` syncs, collects, then heals, once | `transactions.ts`, `game.ts`, `sim.ts` | commit tests; heal after death no-op | Defect, fixed |
| 5 | Armor ignored most damage | 20 of 20 through 0.28 armor (reproduced) | One `hurt` pipeline with per-source rules in data | `sim.ts`, `data/damage.ts` | 8 pipeline tests | Defect, fixed |
| 6 | Loot sinks under the floor | Hard-coded Y 640 (source) | Loot collides with solids, rides platforms, floats on slag; flies to the ball when the gate opens | `sim.ts` | 4 loot tests | Defect, fixed |
| 7 | Wrong kill attribution | Sticky flags (reproduced) | Every hit produces a record: source, ability, effect, tags, effective, overkill | `sim.ts`, `effects.ts`, `game.ts` | 4 attribution tests | Defect, fixed |
| 8 | Events pay other than they say | Decline 18 → 12 (reproduced) | Events are outcome data; copy is generated from it; once per run; free anneal tracked | `events.ts` | every cinder outcome checked | Defect, fixed |
| 9 | Equip paths disagree | Shops and events skipped HP policy and rarity (source) | `transact()` for every path | `transactions.ts` | 4 transaction tests | Defect, fixed |
| 10 | Saves unvalidated, UI stale | Source | Validation, v1→v2 migration, backup slot, guarded storage, reset reapplies settings, menus always rebuild | `save.ts`, `game.ts` | 5 save tests | Defect, fixed |

Related contract audit, all fixed: `onDamaged` now dispatched; `pickup` attraction implemented; ice has low grip; Wildfire's spread implemented; Flaming Shell's "panic" removed; knockback action pushed toward the ball (**defect found during work**); conveyors could not move a resting ball (**defect found during work**); abandon paid 2 scrap instantly and repeatably (exploit, removed); a bought ember could be duplicated by reloading (prevented by checkpointing transactions together with the save).

## Phase 2: movement, combat, simulation - done

- Fixed 120 Hz step with a bounded accumulator and ball interpolation (`loop.ts`). Pressed actions are latched until a tick consumes them.
- Separate route, room-combat, and cosmetic random streams; run stream serializable.
- Attraction and every force scaled by the tick.
- Substeps derived from displacement relative to the ball radius; tunnelling, wall, corner, moving platform, spring, conveyor, and projectile-crossing scenarios tested.
- Overspeed from abilities bleeds away instead of being cut (**defect**: a dash at top speed did nothing).
- Clean ram, glance, block, and armor rules defined and shown in-world (**Tuning**: clean at 55% of top speed).
- Enemy shots have a visible wind-up; Blink Wisps wait after a blink; Forge Bolts keep their distance as the codex says.
- Effect recursion capped at depth 3; kills and rewards are exactly-once through the `alive` guard.
- Representative builds measured (`docs/design-and-tuning.md`).

## Phase 3: rooms, enemies, boss - mostly done

- Content validator for IDs, references, finite geometry, spawn support, exits, requirements, fusions, achievements (`content.ts`), with a negative test.
- Rooms revised: Swarm Loft (ricochet arena), Moving Yard (hazard timing and recovery), Turret Walk (reflection guidance), Colossus Hold (slag seam). Slag now spits the ball out (**Hypothesis**: better recovery; matches the biome description).
- Colossus: one target list for all effects plus explicit boss rules; objectives per phase; stamp, barrage, and collapse telegraphs; a vulnerable window after a stamp; every representative build damages it.
- Not done: authoring new encounters beyond these four rooms; manual reachability review of every room with every build (only automated checks); enemy silhouettes beyond small markers.

## Phase 4: builds, routes, progression - mostly done

- Component audit matrix and fixes (`docs/design-and-tuning.md`).
- Reward cards: replaced part, integrity change, reactions gained and broken, bars with direction arrows, optional numbers table, a trade-off label, and **Keep the ball** salvage.
- Honest previews running the real movement code, before and after side by side.
- Map draws connections, current path, passed-by and reachable rooms, and risk and reward per room.
- Embers resolved as one permanent resource with a save migration; heat effects data-driven and shown for the selected heat.
- Optional seed entry and "same seed again".
- Run summaries: cause, build, route, damage by source both ways, highlights, decisions, earned scrap, one next experiment, quick retry and access to lab and unlocks.
- Save and resume at safe points, with the random stream.
- Not done: a full economy simulation over many runs; revising near-duplicate parts.

## Phase 5: onboarding, interface, controls, accessibility - mostly done

- Tutorial prompts follow the player's bindings and explain the weak bump versus the clean ram and the speed ring; Heavy versus Light choice unchanged.
- Separate gameplay and menu input contexts; Tab, Enter, Space, and Esc work in menus; full controller focus, confirm, back, sliders, and selects; radial deadzone; reconnect notices; binding conflicts swap; Esc cancels; reset to default; pointer thrust only on the game view with capture; pause on focus loss or hidden tab; stale input cleared on resume.
- HUD: integrity and danger first, ability state (ready, cooling, needs energy) second, speed and combo after; build sheet pauses and says so; currencies distinct by icon, colour, and name.
- Focus preserved across menu rebuilds; long panels scroll; tested at 1280×720, 1920×1080, 800×600, 125% and 150% zoom.
- Independent settings for shake, particles, camera motion, flashes, hit pause, contrast (world too), shape markers, interface size, audio, game speed, and a damage assist; defaults follow reduced-motion.
- Not done: a longer playable tutorial step that compares heavy and light side by side in the same room; physical controller testing.

## Phase 6: art direction, sound, character - partly done

- Visual cues for clean rams, armor, shields, elites, burns, lightning resistance, wind-ups, phase states, rivets, shields on the ball, dash phase, and the clean-ram notch.
- Audio: voice budget with priorities (warnings always play), gain ramps, menu, play, boss, and paused music states, rolling sound per shell material, distinct clean, glance, block, reflect, ability-ready, purchase, discovery, and boss-phase sounds, a low-integrity heartbeat; audio unlocks from keys and pointer; failure is silent and safe.
- Foreman lines on run summaries.
- Not done: per-slot visual layering beyond the existing merge; room dressing; an actual listening pass (none was possible in this environment).

## Phase 7: performance, maintainability, release - done for this scope

- Builds cached by loadout; HUD writes only changed values; dead entities removed; lab respawns limited to original spawns and lab loot fades (**defect found by the soak**: splitter shards respawned without limit).
- Transactions, events, damage rules, the fixed stepper, and validation live in their own modules.
- CI: typecheck, tests, build, and the browser smoke test (`.github/workflows/ci.yml`).
- Canvas and audio initialization failures are handled.

## Review pass (in play) - done

A play-through in the browser plus a code review of the simulation, run, and front end. Regression cases are in `tests/review.test.ts` and `tests/content.test.ts`.

- **Defects, gameplay:** Colossus Hold had a bottomless pit (x 1340–1460) right before the boss; it is slag now, and a test checks every room for open pits. Stamps stopped 64 px above the floor and could never hit a rolling ball; they now land on it. Two Colossus rivets sat inside the plate where no ram could reach them; all three are on the rim facing the entrance. A slow touch on a rivet glued the ball to it (about 14 integrity per second). A stunned turret sank through its mount until it was unreachable. Ground Slam from the floor did a full shockwave. Combo milestones paid out on every hit once the combo was capped, and a killing ram counted twice. A dash deleted shots instead of turning them around as the room and codex text say. A released ball crept forever. The air-turn assist only worked at full stick deflection. Splitter shards and Colossus sparks ignored depth and heat scaling. An expired burn kept its old strength.
- **Defects, run:** treasure rooms never offered the weld. The Molten Bath curse was wasted on the boss or on rooms it does not apply to, did not stack with Heat II geysers, and could be offered when no fight was left. A reload at a reward screen reset the reward table (salvage paid 8 instead of 14 after an elite). The two tutorial rooms made the first real room scale as depth 2. The tutorial's damage carried into the run (a run could start at 13 of 84). Lab discoveries were written to the save. Heat descriptions left out applied modifiers; some route texts overpromised. Geysers could be placed in a pit under a bridge.
- **Defects, interface:** a key held through a screen change pressed the newly focused button (Space took a reward card or relaunched a run past the death summary; a held Esc paused and resumed at once). Esc cancelling a rebind also left Settings; a rebind stayed armed after leaving Settings; binding to Space, an arrow, or F silently double-bound it. The pause key and controller Start did not resume from the pause menu. The HUD always said Tab and Esc. Focus dropped to the page after a purchase or the last reroll. "Same seed" stuck to every later run. The build sheet ignored run modifiers. One-frame audio and HUD cues could repeat every frame while paused. Map labels were clipped at L and XL. The lab strip ran off-screen at 800×600. Controller A did nothing in the build sheet. The discovery toast said only "New".
- **Not changed:** replaying the tutorial while a run is saved still replaces that run without asking (the "New run" button does the same and says so); toasts can briefly cover a menu header.

## Overhaul pass (2026-11-13) - done

Researched world-class roguelites, game feel, web onboarding, boss readability, adaptive audio, and accessibility guidance, then changed what the game lacked. Rules and numbers are in `design-and-tuning.md` ("The overhaul"); tests are in `tests/overhaul.test.ts`.

- **Run:** route from 5 rooms to 7 plus the Colossus, with a shop or treasure layer before the hold; depth scaling, boss integrity, and scrap rebalanced for the length.
- **Speed pays:** room grades (S to C) against par with cinder bonuses, shown on the gate banner and the reward screen; clean-ram share tracked per run.
- **Rewards:** banish (two per run), Slay the Spire style rarity pity, and "one part from a reaction" chips on cards.
- **Retention:** run score with a line-by-line breakdown, best score, Daily Forge (shared seed per local date, best per day), and a copyable result card.
- **Variety:** elite affixes (Hasted, Plated, Volatile, Magnetic); the Ram Hound (telegraphed charger with a counter-hit and a punish window); two new rooms; three achievements.
- **Readability and comfort:** off-screen construct arrows, victim shake, a flash rate limit.
- **Onboarding:** a first-time player's one big button is Play, which is the tutorial.
- **Audio:** adaptive score (`src/music.ts`) replacing the eight-step pulse; hall reverb, bus compressor, ducking, impact pitch variance, chimes in the score's key.
- **Smoke test:** the tutorial roll no longer races a lucky first-ram kill out of the room.
- Not done: Hades-style stackable heat modifiers, per-part damage on the summary, a funnel/analytics hook (needs a decision about data collection), slopes.

## Feel pass: smoothness and phones (2026-11-13) - done

A four-way review (simulation and feel, input and touch, game flow and saves, rendering and audio), with fixes. Regression tests are in `tests/feel.test.ts`.

- **Smoothness:** every moving thing is drawn between ticks, not just the ball: constructs, bolts, loot, the Colossus and its rivets, moving platforms, sparks, floaters, and decorative timers. Before this, they jumped against the camera at 90, 120, and 144 Hz and froze on zero-tick frames during slow motion. The ball's spin now accumulates (it rolls visibly), the trail no longer leads the ball, and the camera's look-ahead eases, so a bounce does not yank the view. Hit pause starts on the tick of the hit and no longer stacks. Close pauses share a cooldown. Shake is no longer added twice per ram.
- **Robustness:** an exception in one frame no longer stops the loop. `roundRect` is polyfilled for iOS 15 and older Android WebViews. `getGamepads` is guarded.
- **Feel and combat:**
  - A dash or burst that meets a construct during its phase still lands the ram (phase blocks recoil and bolts only).
  - A hop pressed in the air is held until the next floor contact while the button stays down.
  - Small floor bounces die out.
  - Restitution is capped at 0.95, so no bounce gains energy.
  - Shooters only wind up within about a screen of the ball. A ram during a wind-up spoils the shot, and there are no point-blank shots inside the ball.
  - Fliers steer proportionally instead of buzzing.
  - A hound COUNTER needs real speed.
  - A rivet or Colossus touch pushes out by the overlap, not by 78 px.
  - Moving platforms neither jump on their first tick nor lift the ball twice.
  - Spawns in the middle of a fight are visible at once.
  - A slam spent on a construct is not stored for the next landing.
  - A hop off a spring is never weaker than the spring.
- **Touch:**
  - The stick reads up and down only within about 30 degrees of vertical, so a drifting thumb no longer fast-falls or dashes into the floor.
  - Stick travel follows Control size.
  - A new thumb always takes the stick, and stale fingers are cleared on focus loss.
  - A stylus counts as touch, and the on-screen keyboard (seed field) no longer flips the game into keyboard mode.
  - Pinch-zoom and long-press menus are blocked.
  - The Android back gesture acts like Esc during play.
  - Touch targets are at least 44 px.
  - Banish takes two taps on touch.
  - On short landscape phones the ability dial sits low, beside hop, off the lane where constructs come in.
  - The world is drawn larger on phones (`fitZoom`).
- **Menus:**
  - Intro animations play on entering a screen, not on every rebuild.
  - Every scroller (map, card carousel, part strip) keeps its position across a rebuild, sideways included.
  - The picked room's Go stays in view on short screens, and the room's advice shows there.
  - Nothing is auto-focused on touch.
  - The build sheet is no longer covered by toasts.
  - New-construct notes come as one toast after the room banner.
  - Very short phones get tighter reward cards.
- **Run and saves:**
  - Reloading during the death beat no longer brings the room back.
  - The beat after a room ends cannot be paused into, which fixes a frozen lab after abandoning there.
  - Starting a new run, daily, or tutorial over a saved run asks once.
  - The score's assist cut uses the lowest assist any room was played at.
  - The tutorial rooms no longer count toward the route's rooms, score, and scrap.
  - Pity is judged on the cards actually shown.
  - A banish redraws from the screen's own rarity table.
  - A failed checkpoint write removes the stale checkpoint.
  - Event outcomes that throw are caught.
  - The shop's patch cannot be bought at full integrity.
  - "Same seed" replays at the original heat (and a daily replays as the daily).
  - The Colossus's grade shows on its banner.
  - The share line says "Left after N rooms" for an abandoned run.
  - Seeds are capped at 32 bits.
- **Performance and battery:**
  - The canvas is opaque.
  - The backing store has a pixel budget and an adaptive resolution scale.
  - The paused world is drawn once, not every frame.
  - The menu backdrop runs at 30 fps on touch.
  - Panels are not backdrop-blurred on coarse pointers.
  - HUD bars fill with `transform: scaleX`, not width.
  - Particles are no longer scaled twice by the particles setting, and are lighter on touch.
  - `hypot` is plain `sqrt`.
- **Audio:**
  - The context is suspended while the tab is hidden.
  - iOS plays through the silent switch (`audioSession`).
  - Phones have a smaller voice budget and a shorter reverb.
  - Muted effects build no nodes.
  - Per-frame automation is sent only on change.
  - Ducking holds the live value.
  - The music lookahead is 300 ms, so main-thread stalls no longer flam or skip notes.
- **Rendering details:**
  - The low-integrity vignette fits portrait screens.
  - Cinders fly to the real counter.
  - Off-screen arrows sit below the HUD.
  - The parallax layer is not rebuilt as the phone's URL bar moves.
  - Card previews run at the same pace at any refresh rate.
- Not done:
  - The Daily Forge shares its route, but later draws (offers, shops, events) still depend on each player's unlocks.
  - Two open tabs can still overwrite each other's save.
  - PNG home-screen icons.
  - Cached gradients and batched particle draws (no profiling showed them as the bottleneck on desktop; check on a low-end phone first).

## Play pass two: UI, feel, and balance (2026-11-14) - done

Played in the browser through Playwright: a scripted player pressing real keys played the tutorial, full routes, every elite type, and the Colossus, and every screen was captured and reviewed. Findings and numbers are in `design-and-tuning.md` ("Play pass two"); regression tests are in `tests/playpass.test.ts`.

- **Balance:** ram damage grows with mass^0.65 (heavy was about five light cores); light core gets crits and a softer impact cut; glance recoil ×0.65; the elite Furnace Knight is thinner.
- **Gameplay:** White Hot at a ×5 combo (every ram clean, +25%, folds shields); shields turn slowly and their guard breaks for 1.5 s; a rolling ball climbs low ledges; the Colossus has shutters between attacks, punish windows after them, a hop-over shockwave attack, and is no longer a combo farm.
- **Defect:** a challenge room with nothing to break (Speed Lane) graded at 0.0 s.
- **Camera:** closer (about 15%), easing out with speed; vertical framing hangs off the floor line so fights stay above the bottom HUD.
- **Animation:** walkers squash on each footfall, shooters rear up before a shot, hounds crouch before a charge; a White Hot aura with flame tongues; the boss rears before a shockwave and its heart shutters open and close; the iris closes on the ball as it leaves a cleared room.
- **Interface:** smaller, higher banners; compact in-room toasts; one-time notes for White Hot, guard breaks, and shockwaves; the combo widget's White Hot state; readable reward previews and an integrity-bar Weld card; a Rules tab in the codex; clearer reaction hints.
- **Audio:** cues for White Hot on and off, guard breaks, and shockwaves; the score rises while White Hot.
- Not done: a listening pass on the new cues; human playtests of the new numbers.

## Deferred, in priority order

1. Human playtests with about five new players (protocol in `validation-report.md`).
2. Physical controller testing (only an emulated gamepad was driven).
3. Listening pass on the synthesized audio and mix.
4. More authored encounters and a second pass on the remaining rooms, guided by playtests.
5. Differentiating near-duplicate parts; an economy simulation across many runs.
6. Per-slot visual identity (shell silhouette, trail, impact signature layered, not merged).
7. Localization preparation: strings are still inline in `ui.ts`, `events.ts`, and data files.
8. Touch support, a second biome, and any online features: separate milestones.

## Continuation note

Start with `npm run check` and `npm run build && npm run smoke`. The quickest way to see the changes is a tutorial run, a lab session with the presets, and a run with the seed from any summary. Tuning lives in `src/tune.ts`, `src/data/damage.ts`, `BOSS_RULES` in `src/sim.ts`, and `HEATS` in `src/data/meta.ts`; re-run `tests/profile.test.ts` and `tests/boss.test.ts` after changing them and update the tables in `design-and-tuning.md`.
