You are improving Ballborn in the repository provided to you. Act as a senior gameplay engineer and game designer with responsibility for movement, combat, progression, levels, UI, accessibility, audiovisual presentation, performance, and QA. Inspect the actual repository and implement the work in tested, reviewable increments. Produce a working improvement, not only a design document.

This brief was prepared on 2026-09-28 from source at commit `e782565`. Treat findings as a baseline to revalidate against the current checkout. Read `README.md`, applicable repository instructions, and `docs/source-review-and-research.md` if available. The essential context and requirements are repeated here so this prompt remains usable independently.

**Mission and identity.**

Ballborn's promise is: “Build a ball. Feel the build physically. Master it. Break it. Rebuild it.” Turn the existing Foundry slice into a polished, coherent action roguelite that delivers this promise consistently.

The player directly steers a ball through side-view rooms. Momentum, collision angle, mass, bounce, grip, and timing are the primary combat language. Equipment should change the way the player moves and makes decisions. Preserve this identity, short runs, the six-slot build system, and the Foundry's molten industrial personality. Avoid generic stat inflation, unavoidable contact attrition, or a dominant auto-damage strategy that makes steering irrelevant.

Use the existing TypeScript/Vite/Canvas 2D/Web Audio foundation by default. A framework or engine rewrite requires a demonstrated technical need and a migration argument; it is not a prerequisite for polish. Use original or properly licensed assets and document provenance. Extend the current visual language before buying or generating a large asset library. New online accounts, backends, multiplayer, monetization, and publishing are outside this implementation brief.

**Current implementation you must understand.**

- `src/main.ts`: animation loop; `game.ts`: screens, run transitions, rewards, persistence, and audio orchestration.
- `physics.ts` and `tune.ts`: acceleration, hopping, radius, impact damage, surface response, tuning constants, and a small self-check.
- `sim.ts`: player, enemies, bullets, pickups, hazards, status/effect integration, and the Iron Colossus.
- `types.ts`, `build.ts`, `effects.ts`: six slots, clamped stats, tags, build compilation, archetypes, and event-driven actions.
- `run.ts`: six-layer route generation, template eligibility, offers, shops, events, and post-run suggestions.
- `data/components.ts`, `rooms.ts`, `enemies.ts`, `synergies.ts`, `meta.ts`: current content and progression definitions.
- `render.ts`, `ui.ts`, `styles.css`, `index.html`: world rendering, camera, illustrative reward previews, HUD, and menus.
- `input.ts`, `audio.ts`, `save.ts`: keyboard/mouse/gamepad sampling, synthesized audio, and localStorage persistence.

The reviewed version contains 35 components, 27 room templates, 12 regular enemy definitions, 11 synergies, three fusions, 14 achievements, one biome, a three-phase boss, tutorial, Ball Lab, and Heat 0–3. It already implements coyote time, buffered jumps, component comparisons, reflection, build weaknesses, and some accessibility settings. Improve these systems rather than proposing them as if absent.

The baseline `npm run build` and `selfCheckPhysics()` passed. No dedicated regression suite exists. The review did not include human playtesting, rendered UI inspection, audio audition, hardware controller testing, or performance profiling. Do not treat those areas as validated.

**Research to apply selectively.**

These sources establish reference mechanics; the proposed transfers are design hypotheses to test in Ballborn. Use the linked official descriptions and developer material for further investigation. Do not copy art, characters, writing, or whole game structures.

- [Go Mecha Ball](https://store.steampowered.com/app/2008510/Go_Mecha_Ball/): rolling/bouncing arenas, movement devices, and responsive audio suggest combat spaces built around deliberate momentum routes.
- [Roundguard](https://store.steampowered.com/app/848030/Roundguard/): physics combat with distinct skill/item combinations suggests clear build identities and replay challenges.
- [Peglin](https://store.steampowered.com/app/1296610/Peglin/): physics-affecting orb/relic interactions suggest upgrades whose consequences can be understood and observed.
- [Yoku's Island Express](https://www.team17.com/games/yokus-island-express) and [its developer interview](https://www.team17.com/news/team17s-100-games-the-final-chapter-2018-overcooked-2-planet-alpha-yokus-island-express-more): integrated traversal and iterative control design suggest readable entries, bounce routes, and recovery spaces.
- [Slay the Spire](https://store.steampowered.com/app/646570/Slay_the_Spire/): risky/safe paths and synergistic choices suggest route decisions that respond to the current build and resources.
- [Hades](https://www.supergiantgames.com/blog/hades-faq/): repeated attempts, build discoveries, characterization, and optional resilience suggest useful failure feedback and adjustable challenge.
- [Dead Cells accessibility update](https://dead-cells.com/patchnotes/29): configurable outlines, UI, input, sound priorities, and assists suggest independently adjustable readability and control settings.

Retain Ballborn's direct real-time steering. These references do not require a turn-based mode, shooting, flippers, an open world, or a large narrative production.

**Working process and scope.**

Start by checking the working tree and preserving existing user changes. Run the baseline build. Launch the game if browser tools are available; document the title, tutorial, a normal room, reward, map, shop/event, settings, lab, boss, death, and victory states as you reach them. Use isolated test saves and preserve real player progress.

Write a concise prioritized implementation plan with player problem, evidence, proposed change, affected modules, dependencies, and verification. Then implement it. Keep that plan updated with actual results. Distinguish confirmed defects, hypotheses, tuning decisions, and deferred expansion. Make reasonable reversible decisions without stopping for routine approval. Ask only when missing information materially changes scope or would cause an irreversible action.

Deliver the Foundry improvement through the phases below. Complete the reliability work before major balance adjustments. Keep each phase playable and run relevant checks as you go. If resources prevent completing the whole brief, finish the current coherent phase, explicitly list outstanding requirements, and leave a precise continuation note; do not claim the overall mission is complete.

**Phase 1: repair correctness and protect the player's run.**

Reproduce and fix these high-priority findings before adding content. Record a regression case for each meaningful defect:

1. Resolve enemies outside room bounds and invalid spawns. In `moving-yard`, the reviewed grunt remained alive at Y ≈10,124 after ten seconds in a 720-high room. Ensure required enemies cannot become permanently unreachable and block the exit. Choose deliberate fall/death/recovery behavior and handle drops consistently.
2. Make routes genuinely exclusive and forward-moving. `Game.finishNode` leaves earlier unchosen nodes open. With seed 123, finishing `n0-0` left `n0-1` selectable. Validate eligibility from the current position and outgoing edges; allow the initial layer only before the first selection. Complete and reward each node at most once.
3. Isolate mutable room state. Boss phase 3 currently adds lava to the imported `ROOM_MAP` template, affecting future simulations. Freeze or validate definitions in development and keep destructible platforms, spawned hazards, and boss changes instance-local.
4. Correct completion ordering. `onClear` awards room healing, then `Game.frame` overwrites it with simulation HP. Move to one authoritative transition/commit sequence. Death and clear must be mutually exclusive; stop simulation processing once terminal. Verify no post-death heal, duplicated payout, or transition callback can revive or reward a resolved run accidentally.
5. Establish a common damage pipeline. `damageReduction = 0.28` currently still takes all 20 damage from a 20-point projectile; only direct lava damage reads that stat. Define mitigation, shields, phasing, contact retaliation, low-HP effects, damage-over-time, and lethal handling for each source. Apply Second Wind and lab protection according to explicit rules. Preserve deliberate exceptions in data and UI.
6. Make pickups reachable. They currently settle at hard-coded Y 640 beneath the usual Y 608 floor. Use actual surfaces or a clearly designed collection rule, support moving platforms/pits, and avoid requiring players to stand around after clearing a room. Test cinders and healing separately.
7. Replace sticky kill flags with event attribution. A nonlethal reflected hit currently labels a later collision kill as reflected; ability blasts can incorrectly label Air Burst as Ground Slam. Record source, instigator, ability, tags, effective HP damage, and overkill separately. Make collision-only achievements exclude every other damaging source, not merely abilities. Include effect damage in appropriate run statistics.
8. Make event outcomes match their text. Overcharge advertises 18 cinders on decline but pays 12; other decline values also disagree. Use an event ID plus choice ID or typed outcome data. Unify resource amounts, costs, once-per-run allowances, availability, and execution. Show fusion consumption and resulting empty slots.
9. Centralize equipment transactions. Use the same explicit HP/energy adjustment policy for rewards, shops, events, evolutions, fusions, and lab swaps. Validate slot compatibility and IDs. Update rarity tracking for every equip path, including evolutions. Report gained and lost synergies.
10. Repair save and UI synchronization. Validate parsed save types, numeric ranges, known content IDs, and versions; add migrations and backup/recovery behavior. Handle unavailable storage and failed writes gracefully. Reapply settings/input/audio on reset. Refresh codex unlock buttons and balances after purchases even when the screen stays the same.

Audit related contracts rather than fixing only the listed examples: undispatched hooks, unsupported action targets, descriptions that claim unimplemented effects, invalid room fallbacks, damage source handling, death statistics, and repeatable currency exploits. Do not invent shipped mechanics merely because an unused type exists; implement, remove, or accurately document the contract.

**Phase 2: make movement, combat, and simulation dependable.**

Implement a real fixed-step gameplay loop with a bounded catch-up accumulator and interpolation where useful. Decide how game speed, pause, hit pause, tab suspension, and overload interact. Consume pressed edges exactly once per intended action even when a rendered frame performs zero or multiple simulation steps. Held input must remain responsive. Do not silently make the game permanently slower on a low-refresh display.

Separate seeded RNG streams for route/rewards, combat, and cosmetic effects. Make RNG state serializable where continuation requires it. The same seed, content version, settings, and tick-indexed gameplay inputs should yield the same gameplay result regardless of rendering frequency or visual-effects density. A seed alone need not mean the same outcome for different player actions. Establish the supported determinism boundary; do not promise cross-engine bit-identical physics without proving it.

Use time-scaled forces consistently, including attraction. Verify fast player/enemy/projectile collision paths, thin surfaces, corners, moving platforms, springs, conveyor belts, knockback, and phasing. Use swept collision or justified adaptive substeps where needed. Derive collision safety from relative displacement and collider size. Test the highest supported speeds and temporary ability impulses.

Tune using representative builds: balanced, heavy, light, rebound/pinball, fire/explosive, and magnetic/reflection. Measure time to reach speed, stopping/turning distance, hop height/range, air control, rebound energy, typical impact damage, and ability value in the same lab scenarios. Preserve noticeable strengths and costs. Heavy builds must have feasible required routes; light builds need skillful damage opportunities; bouncing should reward aim rather than remove agency.

Clarify a clean ram, glancing hit, shield block, armor resistance, reflection, and self-damage. Decide whether a well-executed attack can avoid retaliation and communicate the rule before tuning around it. Make abilities reliable for positioning and recovery. Do not accidentally remove an ability's momentum immediately through a generic velocity cap. Preserve existing jump buffering and coyote-time benefits.

Provide clear attack anticipation, active danger, and recovery windows. Let players identify why a hit failed and what they can try next. Repeated contact should neither farm effects for free nor trap the player in unavoidable damage. Cap recursive effects deliberately, and test kill chains for correct source attribution and exactly-once rewards.

**Phase 3: improve rooms, enemies, and the boss as one system.**

Audit all existing rooms with representative builds and mobility constraints. Build an automated content validator for IDs, finite dimensions, bounds, supported spawns, exit placement, and declared requirements. Combine this with scenario tests and manual reachability checks; geometric validation alone cannot establish that a room is fun or traversable.

Author encounters with recognizable purposes: run-up and braking, overhead attack, controlled ricochet, projectile return, crowd separation, and hazard timing. Give each room a readable entry, a meaningful maneuver, and a way to recover from a nonlethal mistake. Use safe floor routes and optional aerial shortcuts where appropriate. Avoid long empty travel, waiting for stragglers, and rooms decided entirely by whether one part was rolled.

Improve a bounded set of three to five existing rooms first. Include one ground/air route comparison, one ricochet arena, one projectile/reflection encounter, and one moving-surface or hazard-timing encounter; a room may serve two purposes. Measure whether these offer different decisions before adding more templates. Optional ramps or bumpers are worthwhile only if their collision support is reliable and their role is clear.

Give enemy roles distinctive silhouettes, movement, anticipation, and counterplay. Validate that behavior matches codex claims, such as ranged enemies maintaining distance. Make armor and elemental resistance readable without requiring memorization. Use complementary enemy combinations and bounded spawn budgets rather than HP multiplication as the main variety. Prevent off-screen or obscured attacks from feeling arbitrary.

Refine the Iron Colossus into a fair test of the player's build. Every phase needs an understandable objective, legible weak points, usable attack windows, and a transition warning before terrain changes. Test all representative builds against it. Either support status, chain, area, direct component effects, and rivet interactions through a shared target interface, or provide explicit, balanced boss adapters and resistance rules. Fire, magnetic, and rebound builds should retain meaningful strategies. Avoid a final boss that silently disables most of a build's investment.

Expand encounter variety before proposing another biome. A later biome prototype must introduce a different movement decision, enemy ecology, hazard language, palette, and sound, rather than recoloring the Foundry. Keep it as a separately justified follow-on milestone.

**Phase 4: make build choices, routes, and progression rewarding.**

Audit all 35 components, 11 synergies, and three fusions against actual behavior. Create a compact matrix of role, mechanic, downside, enabling combinations, counterplay, boss behavior, and overlap with other parts. Fix misleading descriptions and nearly identical choices. Prefer a small number of differentiated revisions to an indiscriminate expansion.

Provide three useful reward decisions where the current pool permits. Show the current component being replaced, physical changes, HP/energy consequences, gained and lost reactions, and all resource amounts. Keep essential information readable at a glance, with optional details for players who want numbers. Offer a sensible skip or salvage choice so players can preserve a working build. Keep meaningful uncertainty without guaranteeing a perfect synergy every room.

Make reward previews honest. Either run a compact scenario using the same movement rules as gameplay or clearly label the animation as illustrative. Prefer a side-by-side before/after comparison at matching scale, initial state, and input. Explain normalized bars and distinguish a tradeoff from an unconditional upgrade. Let players test unlocked builds in the lab without altering the active run.

Render actual route connections, current position, completed path, inaccessible branches, and reachable alternatives. Before selection, explain room type, foreseeable risk, and reward category. Ensure future visible choices have strategic meaning for the current build, health, and cinders. Preserve the compact run length initially; do not lengthen runs to disguise weak decisions.

Balance shops, healing, elite rewards, rerolls, and event costs as an economy. Decide whether embers are a run resource, permanent resource, or two explicitly separate resources. The reviewed permanent ember balance has no evident use. Resolve that inconsistency with a migration that respects existing saves. Do not add a fourth currency to conceal it. Favor unlocks that broaden playstyles; avoid compulsory grinding for baseline viability.

Make higher Heat levels understandable and selective. Improve encounter or hazard demands before relying on inflated health and damage. Display the selected Heat's effects, not merely the highest unlocked tier's text. Introduce optional seed entry/retry after repeatability is verified. Keep seed sharing and local challenge presets separate from an online leaderboard service.

End-of-run feedback should include the actual cause of death, build, route, key component decisions, damage by source, useful performance highlights, earned progress, and one specific experiment for the next run. Provide quick retry and easy access to the lab or unlocks. Support save-and-resume at well-defined safe checkpoints; preserve RNG and completed transactions and prevent reload-based duplicated rewards.

**Phase 5: improve onboarding, interface, controls, and accessibility.**

Make a first-time player understand roll, brake/turn, hop/air control, ability, and clean impact through short playable steps. Demonstrate a weak bump and a strong ram, then let the player compare heavy and light behavior. Use input-aware prompts that respect rebinding. Keep tutorial replay and skip available. Avoid large instruction dumps and surprise advanced systems before their first use.

Create separate UI and gameplay input contexts. Restore keyboard focus traversal in menus, support Enter/Space activation and Escape/back, and implement complete gamepad focus/confirm/cancel for every screen. Handle analog deadzones, disconnect/reconnect, binding conflicts, rebinding cancellation, and reset-to-default. Scope pointer thrust to the playfield and support pointer capture/cancellation. Pause safely on focus loss or hidden tabs; clear stale edges before resuming.

Clarify the HUD hierarchy: integrity and danger first, ability readiness and cost second, speed/combo and build details after that. Show cooldown and insufficient energy as distinct states. Make the build sheet pause behavior deliberate and visible. Avoid six equally prominent text blocks obscuring the arena on small screens. Make currencies visually and verbally distinct.

Use reusable, consistent component comparisons in rewards, shop, codex, and lab. Preserve focus when a screen updates. Make confirmations explicit only for destructive actions. Ensure long menus, reward cards, settings, and lab controls scroll within the viewport. Test 1280×720, 1920×1080, an approximately 800×600 window, and browser zoom at 125% and 150%. Treat desktop keyboard/controller as the initial platform; a narrow responsive layout does not constitute a playable touch release.

Complete independent options for shake, camera motion/zoom, flashes, particles, hit pause, font/HUD scale, outlines/contrast, audio levels, and gameplay assists. Honor reduced-motion preferences and retain critical hazard telegraphs at reduced effects. Use shape, icon, text, and timing in addition to color. Contrast settings must affect the world as well as DOM panels. Avoid sound-only warnings; use concise live announcements for menu and major state changes without flooding assistive technology every frame. Describe the extent of accessibility honestly; a canvas game with live regions is not automatically fully screen-reader playable.

**Phase 6: strengthen art direction, sound, and the Foundry's character.**

Keep a cohesive industrial style with a clear distinction between scenery, solid surfaces, hazards, enemies, loot, and the player's ball. Give the six equipment slots visible contributions where useful: core glow, shell silhouette/material, momentum trail, impact signature, ability tell, and restrained passive cue. Avoid the current last-writer visual merging obscuring the important physical identity. Every visual effect should help identify cause, danger, or payoff.

Improve motion and impact through controlled squash, rotation, sparks, brief flashes, material response, and restrained hit pause. Scale feedback with actual impact while keeping weak hits understandable. Tune camera look-ahead, framing, dead zone, zoom limits, and recovery so the player can see the space needed to stop or land. Verify that the camera works at speed and does not hide required exits or hazards behind UI.

Build on the existing synthesized audio: distinguish rolling materials, weak/strong impacts, blocked hits, reflection, ability readiness, damage, purchases, synergy activation, and boss phases. Use a bounded voice budget, gain ramps, category priorities, and a mix that preserves warnings during effect chains. Suspend or reduce gameplay loops when paused or outside play. Unlock audio from supported keyboard and pointer interactions. Improve music pacing with a few purposeful states or layers rather than an expensive soundtrack scope by default. Audition the result and report whether actual listening was possible.

Add concise original world detail through room dressing, event characters, tool descriptions, and a few reactive lines after milestones. Give the ball's rebuilding cycle a small narrative purpose. Keep flavor optional and brief enough to preserve replay pace. Prepare UI strings for future localization; do not claim a translated release without reviewed translations and layout testing.

**Phase 7: performance, maintainability, and release readiness.**

Separate state transitions, combat/damage, boss logic, and rendering concerns where doing so improves correctness and testability. Keep data-defined content easy to add and validate. Avoid a speculative general-purpose engine or abstraction for every field. Use explicit ownership for run state, simulation state, and saved meta progression.

Cache compiled builds until equipment/modifiers change. Cache DOM references and update HUD structure only when its data changes. Remove dead entity records when safe, especially in long lab sessions. Profile allocation, particles, enemy pair checks, draw calls, gradients, and audio nodes before choosing pooling or spatial indexing. Bound resource growth and allow effects quality adjustments that do not change gameplay RNG or damage.

Set and document a reference browser, machine, resolution, and device-pixel ratio. A provisional target is stable 60 FPS at 1280×720 on the available reference machine with acceptable input response and no sustained frame-time growth. Measure frame-time percentiles and update/render costs under ordinary and worst-supported encounters. Preserve the small initial bundle where practical; justify material asset/dependency increases. Treat these as measured targets, not claims supported by the old production build alone.

Add appropriate automated checks and CI for typechecking/build, core gameplay regressions, save validation/migration, and data contracts. Keep tests behavior-based. Add a browser smoke path if tooling permits. Handle Canvas/Audio initialization failure gracefully, verify production assets and font fallbacks, and document deployment requirements. Package and document the improved build; do not publish or create paid services as a side effect.

**Verification and acceptance contract.**

Use this minimum verification matrix and report actual results:

| Area | Acceptance evidence |
| --- | --- |
| Baseline | Build passes; changed files and any remaining warnings explained. |
| Known defects | Reproductions above have regression checks; route, boss-template, pickup, mitigation, event, recovery, and attribution failures are resolved. |
| Timing | Identical tick-indexed input traces at 30/60/120/144 Hz rendering produce matching gameplay results within a documented tolerance; a frame hitch and tab return do not duplicate actions or lose run state. |
| Collision | Fast movement, thin surfaces, corners, moving platforms, and projectile crossings behave correctly in targeted scenarios. |
| Build identity | Measured movement/impact profiles differ meaningfully across representative builds; each has a demonstrated viable boss strategy. |
| Room completion | All existing templates pass data validation; required routes and enemies are checked for representative builds; no observed unreachable living enemy or trapped exit remains. |
| Run graph | Across at least 100 fixed seeds, legal paths progress to the boss, no earlier branch can be re-entered, and transactions occur at most once. This is a proposed test sample, not a prior result. |
| Economy | Displayed costs/rewards equal execution; currency ownership and sinks are documented; saves and reloads cannot duplicate payouts. |
| Save resilience | Missing, malformed, outdated, and unavailable-storage cases are handled; checkpoint continuation restores the defined state and RNG policy. |
| Controls | Keyboard-only and controller-only users can reach every essential menu action; focus loss, rebinding, reconnect, and pointer/UI separation are verified. Mark physical hardware tests outstanding if unavailable. |
| UI/accessibility | Required viewport/zoom checks are captured; no inaccessible clipped controls; world and menus honor relevant settings; critical information survives reduced effects and non-color cues. |
| Performance | Report machine/browser, frame-time measurements, test encounter, and a 15-minute lab soak for entity/audio/memory growth. Never invent missing measurements. |
| Full experience | Complete tutorial, normal run, death/retry, shop/event/fusion, boss/victory, unlock, lab, and resume flows in browser where available. Record remaining limitations. |

For human evaluation, propose a small initial session with approximately five new players when recruitment is available. Record whether they can explain the difference between heavy and light builds, perform a deliberate strong ram, identify why they were damaged, understand a replacement offer, and choose a next experiment after death. Capture actual observations; automated input scripts cannot establish player comprehension or fun. Use outcomes to revise tuning and tutorial pacing rather than claiming success from feature completion.

**Deliverables and final report.**

Deliver working source changes, appropriate regression tests, any original/credited assets, an updated README with accurate controls and save behavior, concise design/tuning notes, and a validation report with commands, results, screenshots where available, and unresolved risks. Keep a prioritized follow-on list for larger content expansion, touch support, additional biomes, and any online features rather than blending them into an unbounded rewrite.

In your final report, lead with the concrete player-facing improvements, list the important fixed defects, summarize verification, identify anything incomplete, and explain how to run and evaluate the build. Begin now by inspecting the current repository and establishing the baseline, then proceed through the implementation phases.
