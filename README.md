# Ballborn

Build a ball. Feel the build physically. Master it. Break it. Rebuild it.

Ballborn is a side-view action roguelite. You roll a ball through the Foundry, and the ball *is* the build. Six parts change how it actually moves, collides, and hits — mass, acceleration, top speed, hop, bounce, friction, and impact — rather than adding a flat damage bonus.

This repository is the Foundry vertical slice: one biome, a short tutorial, a branching run, and a Ball Lab for trying parts with no stakes.

## Play

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:5173/](http://127.0.0.1:5173/).

| Script | What it does |
| --- | --- |
| `npm run dev` | Local play server |
| `npm run build` | Typecheck and production build |
| `npm run preview` | Serve the production build |

**First ignition** teaches the ram, then offers Heavy Core, Light Core, or staying balanced. **Launch run** starts a full Foundry route. **Ball lab** swaps unlocked parts in a sandbox. Nothing in the lab is saved into a run.

## Controls

| Action | Keyboard | Controller |
| --- | --- | --- |
| Roll | A / D or arrows | Left stick |
| Hop | W, Up, or Space | A |
| Ability | Shift, F, or right click | B |
| Build sheet | Tab | Back |
| Pause | Esc | Start |

Mouse-left drag also thrusts when no key is held. Bindings, screen shake, effects, contrast, shape markers, audio, and game speed are in Settings.

Speed is the weapon. A run-up ram hits much harder than grinding into an enemy. Heavier balls start slower, hop shorter, and hit harder. Lighter balls snap to speed and can miss by flying over the target.

## The ball

Each run equips one part per slot:

| Slot | What it changes |
| --- | --- |
| Core | Mass, gravity, acceleration, integrity |
| Shell | Bounce, friction, contact, surface effects |
| Momentum | How speed is stored and paid out on impact |
| Impact | What a real collision does |
| Ability | A skill you choose to spend |
| Passive | A rule that shapes the whole build |

Rarity adds mechanics, not just larger numbers. Combinations surface as archetypes such as the Juggernaut, the Pinball, the Storm, or the Pyromaniac. Synergies are tag-driven and show up in the codex after you trigger them.

## A run

Rooms are short. Clear the room, take a reward, then pick the next route on the map: combat, traversal, challenge, elite, event, shop, treasure, and finally the Iron Colossus.

Three currencies:

- **Cinders** — spent during the run
- **Scrap** — unlocks parts between runs
- **Embers** — rarer progression for evolutions and fusions

Heat 0–3 adds constraints on later runs. Dying ends the run and still pays scrap. Progress is stored in `localStorage` under `ballborn-save-v1`.

## Stack

TypeScript, Vite, Canvas 2D, and the Web Audio API. No game engine. Parts, rooms, enemies, and synergies are data. Adding another component is another entry, not a new branch in the player.
