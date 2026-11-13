# Ballborn

Build a ball. Feel the build physically. Master it. Break it. Rebuild it.

Ballborn is a side-view action roguelite. You roll a ball through the Foundry, and the ball *is* the build. Six parts change how it actually moves, collides, and hits - mass, acceleration, top speed, hop, bounce, friction, and impact - rather than adding a flat damage bonus.

This repository is the Foundry vertical slice: one biome, a short tutorial, a branching run, the Iron Colossus, and a Ball Lab for trying parts with no stakes.

## Play

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:5173/](http://127.0.0.1:5173/).

| Script | What it does |
| --- | --- |
| `npm run dev` | Local play server |
| `npm run build` | Typecheck and production build into `dist/` |
| `npm run preview` | Serve the production build |
| `npm test` | Unit, regression, and scenario tests (Vitest, Node) |
| `npm run typecheck` | Typecheck the game and the tests |
| `npm run check` | Typecheck, test, and build |
| `npm run smoke` | Browser smoke test against `dist/` (needs a local Chrome or Edge; see below) |

**Play** (a first-time player's only big button) goes straight into First ignition: it teaches the ram, then offers Heavy Core, Light Core, or staying balanced. After that, **Launch run** starts a Foundry route (an optional seed makes the route repeatable), and **Daily Forge** runs the day's shared route at Heat 0 with a score and a best for the day. **Continue run** appears when a run was saved at a safe point; starting anything else over it asks once first. **Ball lab** swaps unlocked parts in a sandbox while the ball keeps rolling: tap a slot in the strip at the top, pick a part, and try it straight away. Presets and a handling readout sit beside the slots. Nothing there touches a run or your save.

## Controls

| Action | Keyboard | Controller |
| --- | --- | --- |
| Roll | A / D (rebindable) or arrows | Left stick or d-pad |
| Hop (hold in the air to float; press against a wall in the air to wall kick) | W (rebindable), Up, or Space | A |
| Ability | Left Shift (rebindable), F, or right click on the game | B, X, or RB |
| Build sheet (pauses) | Tab | Back |
| Pause | Esc | Start |
| Menus | Tab / Shift+Tab, Enter or Space, Esc to go back | D-pad or stick to move focus, A to confirm, B to go back |
| Reward cards | 1, 2, 3 | - |

On a touch screen the game shows on-screen controls: drag anywhere on the lower left to roll (push steeply down to drop, steeply up to aim an ability upward), tap the big arrow to hop and hold it to float (a hop held in the air fires on the next landing), and tap the ability dial beside it. The wrench and pause buttons at the top right open the build sheet and pause; they work with a mouse too. The device used last decides which controls and hints show. Settings has a Touch section for control size, a left-handed layout, and vibration. On the route map, the first tap on a room shows its risk and reward; tap it again or press Go to enter. Banishing a reward card takes two taps. The phone's back gesture pauses a room or goes back a menu instead of leaving the page. Phones play best in landscape; the title screen offers full screen where the browser allows it, and the game can be added to the home screen.

Holding the left mouse button on the game view steers toward the pointer when no key is held. Clicking menus never steers the ball. The game pauses when the window loses focus or a controller disconnects.

Rebinding a key that is already in use swaps the two bindings; Esc cancels a rebind; **Reset keys** restores the defaults.

## How the ball fights

Speed is the weapon. The ring around the ball shows your speed. **A ram at more than 55% of your top speed, or one that breaks the construct, is clean: it costs you nothing.** Slower bumps glance and cost recoil. A clean ram that breaks a construct **plows through** the wreck: the ball keeps most of its speed (less through heavy constructs) instead of bouncing back, so a fast ball can chain through a line. Every ram kill also winds the ability cooldown back by almost half.

In the air, hop just as the ball touches a wall to **wall kick**: it springs away from the wall at a good share of top speed with most of a full hop. Holding hop while sliding into a wall never kicks on its own, so floating stays safe. Hits from above get past shields. Floating numbers say `ARMOR`, `BLOCK`, or `glance` when a hit was reduced, and why.

Heavier balls start slower, hop shorter, and hit harder. Lighter balls snap to speed and can float, but their rams are soft. Slag is survivable: it spits the ball back up once per touch, for a cost.

Arrows at the screen edge point at constructs the camera cannot see; they pulse red while one winds up. The **Ram Hound** shakes and shows chevrons before it charges in a straight line: hop it and it skids into a wall, dazed; meet it head-on at speed for a `COUNTER` (half again the damage); or lead it into slag.

**Elites** carry one affix, named over their health bar and drawn as a dashed ring: **Hasted** (moves and fires faster), **Plated** (extra armor), **Volatile** (bursts when it breaks), **Magnetic** (tows the ball in).

## The ball

| Slot | What it changes |
| --- | --- |
| Core | Mass, gravity, acceleration, integrity |
| Shell | Bounce, friction, contact, projectile handling |
| Momentum | How speed is stored and paid out on impact |
| Impact | What a real collision does |
| Ability | A skill you choose to spend (Dash, Ground Slam, Air Burst, Magnet Pull) |
| Passive | A rule that shapes the whole build |

Reward cards show the part being replaced, the integrity change, reactions (synergies) gained or broken, and a preview that runs the game's own movement code for your current ball and the new one side by side. **Keep the ball** takes a few cinders instead of any card.

## A run

Rooms are short. Clear the room, take a reward, then pick the next route. Routes only go forward: entering a room closes the other rooms at that depth. The map shows every connection, what you have cleared, and the risk and reward of each open room. A route is seven rooms and the Iron Colossus (about twelve minutes): two elite layers, and the layer before the hold is always a shop or a treasure so the build can be finished before the fight.

**Grades.** Every room is graded when its gate opens: two points for beating par time (half again over par still earns one), two for an untouched shell (one for losing no more than 12%). S, A, B, and C pay 10, 6, 3, and 0 cinders. The gate banner shows the grade straight away and the reward screen stamps it.

**Reward cards** also offer **Banish** (two per run): the part leaves the pool for the rest of the run and the card is redrawn. A pity rule makes a rare part likelier on every screen that had none. Cards show a dashed chip when the part would bring a reaction to one part away, and what it still needs.

**Score.** A run summary scores rooms, elites, constructs, best combo, and grades, plus 1,000 for the Colossus, multiplied by heat; a damage assist is shown as a visible cut. **Copy result** puts a short text card on the clipboard (seed or daily date, score, grade strip, clean-ram share, build name).

Currencies:

- **Cinders** ▲ - spent during the run (shop). Every cinder a construct drops is collected when the gate opens.
- **Scrap** ■ - kept between runs; forges new parts in the codex.
- **Embers** ◆ - kept between runs; spent at the Annealing (evolutions) and the Crucible (fusions). Earned from elites, treasure, shops, and achievements.

Forge Heat 0–3 unlocks by winning. The title screen lists exactly what the selected heat changes.

## Saves

Progress is stored in `localStorage` under `ballborn-save-v1` (the key name is historical; the data inside is versioned, currently version 2). On load the save is validated: unknown IDs are dropped, numbers are clamped, and older versions are migrated. The pre-migration copy, or any save that cannot be read, is kept under `ballborn-save-backup` and is never overwritten silently. If the browser refuses storage, the game keeps running and says so on the title screen.

The Daily Forge record (date, best score, attempts) and the best score overall live in the same save.

A run in progress is checkpointed under `ballborn-run-v1` at safe points only: the map, the start of a room, and reward, shop, and event screens. **Continue run** resumes there with the same random state, so a reload restarts an interrupted room with the same seed and cannot duplicate a reward or purchase. The checkpoint is deleted on death, victory, or abandoning.

Settings include screen shake, particles, camera zoom and look-ahead, screen flashes, hit pause, high contrast (world and menus), stronger shape markers, interface size, audio levels, game speed, and a damage-taken assist. Motion defaults follow the operating system's reduced-motion preference.

## Accessibility, honestly

Menus are keyboard and controller navigable with visible focus, and major state changes are announced through a polite live region. Hazards and warnings use shape and timing as well as colour. The game itself is a real-time canvas game and is **not** playable with a screen reader alone.

## Testing

`npm test` runs about 110 tests in Node: regression cases for each Phase 1 defect in `docs/source-review-and-research.md`, fixed-step determinism at 30/60/120/144 Hz, collision safety, content validation, boss build parity, representative build profiles, a 15-minute lab soak, and the overhaul (`tests/overhaul.test.ts`: route shape, grades, score, daily seed, banish and pity, reaction hints, affixes, the Ram Hound).

`npm run smoke` serves `dist/` with `vite preview` and drives a locally installed Chrome or Edge through `playwright-core` in a fresh profile (your real saves are never touched): full tutorial and run to victory, death, shop, settings, codex, lab, keyboard and emulated-controller menus, focus loss, layout at 1280×720, 1920×1080, 800×600, and 125%/150% zoom, frame-cost measurement, and a soak. Set `CHROME_PATH` if the browser is not in a standard location. Screenshots and `smoke-report.json` go to `docs/screenshots` by default. Add `?debug` to the URL to expose the game object as `window.ballborn` for automation.

## Stack

TypeScript, Vite, Canvas 2D, and the Web Audio API. No game engine. Parts, rooms, enemies, synergies, events, heats, and damage rules are data; `src/content.ts` validates them. Fonts load from Google Fonts with system fallbacks; the game needs no other network access. All art is drawn in code and all sound is synthesized. The world view runs a small post stack (`src/post.ts`): a quarter-resolution light map (work lamps, slag, the gate, bolts, blasts, and the ball) multiplies onto the environment before the actors are drawn, so rooms are moody while constructs and the ball stay fully readable; then a filter-free bloom (cascaded downsampling with a power threshold) and a teal-and-ember colour grade. High contrast turns the stack off, and a slow device drops bloom first. The biggest beats (elite kills, rivets, phase changes, the ball breaking) get a rate-limited impact frame, which the screen-flash setting also controls. The music is an adaptive score (`src/music.ts`): a lookahead sequencer on the Web Audio clock plays one loop per state (menu, rooms, the Colossus) in D minor, and layers (bass, kick, an anvil backbeat, hats, an arpeggio) enter with the room's intensity: constructs alive, clean-ram speed, combo, and boss phase. Kill chimes climb the same scale; big hits briefly duck the music; a generated hall reverb and a bus compressor glue the mix.

See `docs/implementation-plan.md` for what changed and what is still open, `docs/design-and-tuning.md` for the rules and numbers, and `docs/validation-report.md` for measured results.
