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

**First ignition** teaches the ram and then offers Heavy Core, Light Core, or staying balanced. **Launch run** starts a Foundry route (an optional seed makes the route repeatable). **Continue run** appears when a run was saved at a safe point. **Ball lab** swaps unlocked parts in a sandbox; nothing there touches a run or your save.

## Controls

| Action | Keyboard | Controller |
| --- | --- | --- |
| Roll | A / D (rebindable) or arrows | Left stick or d-pad |
| Hop (hold in the air to float) | W (rebindable), Up, or Space | A |
| Ability | Left Shift (rebindable), F, or right click on the game | B, X, or RB |
| Build sheet (pauses) | Tab | Back |
| Pause | Esc | Start |
| Menus | Tab / Shift+Tab, Enter or Space, Esc to go back | D-pad or stick to move focus, A to confirm, B to go back |
| Reward cards | 1, 2, 3 | - |

Holding the left mouse button on the game view steers toward the pointer when no key is held. Clicking menus never steers the ball. The game pauses when the window loses focus or a controller disconnects.

Rebinding a key that is already in use swaps the two bindings; Esc cancels a rebind; **Reset keys** restores the defaults.

## How the ball fights

Speed is the weapon. The ring around the ball shows your speed. **A ram at more than 55% of your top speed, or one that breaks the construct, is clean: it costs you nothing.** Slower bumps glance and cost recoil. Hits from above get past shields. Floating numbers say `ARMOR`, `BLOCK`, or `glance` when a hit was reduced, and why.

Heavier balls start slower, hop shorter, and hit harder. Lighter balls snap to speed and can float, but their rams are soft. Slag is survivable: it spits the ball back up once per touch, for a cost.

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

Rooms are short. Clear the room, take a reward, then pick the next route. Routes only go forward: entering a room closes the other rooms at that depth. The map shows every connection, what you have cleared, and the risk and reward of each open room.

Currencies:

- **Cinders** ▲ - spent during the run (shop). Every cinder a construct drops is collected when the gate opens.
- **Scrap** ■ - kept between runs; forges new parts in the codex.
- **Embers** ◆ - kept between runs; spent at the Annealing (evolutions) and the Crucible (fusions). Earned from elites, treasure, shops, and achievements.

Forge Heat 0–3 unlocks by winning. The title screen lists exactly what the selected heat changes.

## Saves

Progress is stored in `localStorage` under `ballborn-save-v1` (the key name is historical; the data inside is versioned, currently version 2). On load the save is validated: unknown IDs are dropped, numbers are clamped, and older versions are migrated. The pre-migration copy, or any save that cannot be read, is kept under `ballborn-save-backup` and is never overwritten silently. If the browser refuses storage, the game keeps running and says so on the title screen.

A run in progress is checkpointed under `ballborn-run-v1` at safe points only: the map, the start of a room, and reward, shop, and event screens. **Continue run** resumes there with the same random state, so a reload restarts an interrupted room with the same seed and cannot duplicate a reward or purchase. The checkpoint is deleted on death, victory, or abandoning.

Settings include screen shake, particles, camera zoom and look-ahead, screen flashes, hit pause, high contrast (world and menus), stronger shape markers, interface size, audio levels, game speed, and a damage-taken assist. Motion defaults follow the operating system's reduced-motion preference.

## Accessibility, honestly

Menus are keyboard and controller navigable with visible focus, and major state changes are announced through a polite live region. Hazards and warnings use shape and timing as well as colour. The game itself is a real-time canvas game and is **not** playable with a screen reader alone.

## Testing

`npm test` runs about 80 tests in Node: regression cases for each Phase 1 defect in `docs/source-review-and-research.md`, fixed-step determinism at 30/60/120/144 Hz, collision safety, content validation, boss build parity, representative build profiles, and a 15-minute lab soak.

`npm run smoke` serves `dist/` with `vite preview` and drives a locally installed Chrome or Edge through `playwright-core` in a fresh profile (your real saves are never touched): full tutorial and run to victory, death, shop, settings, codex, lab, keyboard and emulated-controller menus, focus loss, layout at 1280×720, 1920×1080, 800×600, and 125%/150% zoom, frame-cost measurement, and a soak. Set `CHROME_PATH` if the browser is not in a standard location. Screenshots and `smoke-report.json` go to `docs/screenshots` by default. Add `?debug` to the URL to expose the game object as `window.ballborn` for automation.

## Stack

TypeScript, Vite, Canvas 2D, and the Web Audio API. No game engine. Parts, rooms, enemies, synergies, events, heats, and damage rules are data; `src/content.ts` validates them. Fonts load from Google Fonts with system fallbacks; the game needs no other network access. All art is drawn in code and all sound is synthesized.

See `docs/implementation-plan.md` for what changed and what is still open, `docs/design-and-tuning.md` for the rules and numbers, and `docs/validation-report.md` for measured results.
