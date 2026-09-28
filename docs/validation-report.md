# Validation report

Date: 2026-09-28. Machine: Windows 11 Pro, Intel Core i9-14900K. Browser: Google Chrome 153.0.8010.53, headless, driven by `playwright-core` in a fresh profile. Node 24.18.0. Reference resolution 1280×720 at device-pixel ratio 1 unless stated.

## Commands and results

| Command | Result |
| --- | --- |
| `npm run typecheck` | Pass, no errors (game and tests) |
| `npm test` | 77 passed, 0 failed (plus the matrix printout) |
| `npm run build` | Pass. JS 197 kB (65 kB gzip), CSS 10 kB (3 kB gzip). Baseline was 140 kB / 45 kB gzip: the increase is the new modules (events, transactions, validation, input contexts, UI). No runtime dependencies were added. |
| `node scripts/smoke.mjs --soak-minutes 15` | 21 of 21 checks passed, no console errors |

`vitest` and `playwright-core` were added as development dependencies only.

## Acceptance matrix

| Area | Evidence | Result |
| --- | --- | --- |
| Baseline | Build passes; no warnings | Pass |
| Known defects | `tests/phase1.test.ts`: a regression case for each of the ten findings, reproduced as failing probes before the fixes | Pass |
| Timing | Identical tick-indexed traces at 30, 47, 60, 120, and 144 Hz give identical state (exact equality); particle density and cosmetic seed do not change gameplay; a 2 s hitch spends an ability once; a press in a zero-tick frame is used exactly once; a 20 Hz display runs at full speed | Pass. Tolerance: exact, same engine |
| Collision | 2400 px/s onto a 22 px platform, side wall at 2400 px/s, a corner, a moving platform, a spring, a conveyor, a shot crossing a fast ball | Pass |
| Build identity | Profiles differ (heavy ram 77 vs light 35 on a plate; light hop 341 vs heavy 61; rebound keeps 97% of bounce); each representative build damages the Colossus heart | Pass as measurement. A *viable* boss strategy per build is demonstrated only as a damage estimate, not by play |
| Room completion | All templates pass validation; every room idles 30 s with no construct outside the room; every open slag pool returns the heavy build; heavy crosses the revised Swarm Loft | Pass automated. Manual reachability review not done |
| Run graph | 100 seeds walked to the boss along edges, one node per depth, no re-entry, one completion per node | Pass |
| Economy | Every event cinder outcome equals its card; shop sells once at the shown price; salvage and abandon values fixed; reload cannot duplicate rewards or embers (checkpoint design) | Pass; the reload case is by design and was not driven in the browser |
| Save resilience | Missing, malformed, newer-version, v1 (migrated), and unavailable-storage cases; run checkpoint round trip including the random stream | Pass |
| Controls | Keyboard: focus on load, Esc back, Esc lab pause, reward keys. Emulated gamepad: d-pad focus move, A confirm. Focus loss pauses. Rebind cancel and conflicts tested in Node | Pass. **Physical controller testing outstanding** |
| UI and accessibility | Title, map, reward, and settings at 1280×720, 1920×1080, 800×600, 125% and 150% zoom: no sideways-clipped or unreachable controls. Screenshots below | Pass for tested views. Codex, shop, event, and summaries were not checked at every size |
| Performance | Per-frame CPU cost (simulation, canvas, and HUD) in the lab: p50 0.3 ms, p95 0.6 ms, p99 1.1 ms, max 1.4 ms. Stress (20 constructs, an explosion every 0.3 s): p50 0.4 ms, p95 0.7 ms, p99 1.0 ms, max 1.3 ms. Frame pacing during a 5 s tutorial roll: p50 16.7 ms, p99 16.8 ms; 60 s in the lab: p99 17.0 ms, max 33.5 ms (one frame) | Pass on this machine. Headless Chrome; a GPU-composited, visible window on a slower machine was not measured |
| Soak | 15 simulated minutes of lab fighting (accelerated, in the browser): constructs 4, particles 12, loot 1 at the end; heap change −0.8 MB. The same test in Node with splitters. A 60 s real-time lab session: 2 audio voices active at the end | Pass after fixing the lab respawn leak the soak found |
| Full experience | In the browser: tutorial (rolled with real keys), reward by key, second tutorial room, map, a full route to victory, shop purchase, event, death, settings, codex, lab, controller menu, pause on blur. Rooms were cleared through the debug hook, not by play | Partial: automated flow, not a human play session |

## Screenshots

In `docs/screenshots/`: `01-title`, `02-tutorial`, `03-reward`, `04-map`, `05-room`, `06-shop`, `07-event`, `09-boss`, `10-victory`, `11-death`, `12-settings`, `13-codex`, `14-lab`, and `layout-*` for the map and reward screens at each tested size. `smoke-report.json` has the raw measurements.

## Not validated

- **Human play.** No one played a run by hand in this session. Fun, fairness, difficulty, and comprehension are unknown.
- **Audio.** No listening was possible here; the mix and every new sound are unauditioned.
- **Physical controllers**, real browser zoom (emulated with viewport and scale), touch, Safari and Firefox.
- **Cross-engine determinism.**

## Risks

- The slag spit and the clean-ram rule change the difficulty curve noticeably; both need playtests.
- Light builds need about 30 clean rams on the Colossus heart.
- The route map is wide; at 800×600 it scrolls sideways inside its panel.
- `public/art/foundry-v1/` and `docs/foundry-art-*.md` appeared in the working tree during this session from another source; they are not used by the game and were not reviewed.

## Proposed first playtest

About five players new to the game, 30 minutes each, a fresh save, observed without help:

1. Tutorial, then one full run at Heat 0.
2. Afterwards ask: What is the difference between the heavy and light balls? Show me a strong ram. Why did you lose integrity just then (point to a recording)? What would the last reward card have changed? What will you try next run?
3. Record: time to first clean ram, deaths by source, rooms that took over 90 s, reward choices and whether they read the replaced part, any menu the player could not leave.

Use the answers to tune the clean-ram threshold, the tutorial pacing, and the light build's boss damage before adding content.
