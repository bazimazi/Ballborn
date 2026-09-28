Ballborn · Foundry art collection v1

Created 2026-09-28. Preview the complete collection at [the local gallery](http://127.0.0.1:5173/art/foundry-v1/) after starting `npm run dev`, or open `public/art/foundry-v1/index.html` directly in a browser. The gallery works without a network connection and has icon-size, light-surface, and grayscale controls.

**Design direction.** Dark iron bodies, warm bone-colored steel edges, molten highlights, and restrained material accents continue the existing game's palette. Chunky SVG geometry matches its Canvas shapes. The illustrations add texture and scale for menus and background atmosphere. Individual icons use silhouette and internal marks as well as color: heavy is a plated octagon, balanced is a divided circle, light is an open-feeling round frame with a feather motif.

**Deliverables.** All runtime-ready files live in `public/art/foundry-v1/`. `manifest.json` lists paths, dimensions, origin, sizes, palette, and usage roles.

| Files | Format | Intended placement |
| --- | --- | --- |
| `icons/slot-core.svg`, `slot-shell.svg`, `slot-momentum.svg`, `slot-impact.svg`, `slot-ability.svg`, `slot-passive.svg` | Transparent SVG, 64 × 64 viewBox | Equipment slots, build sheet, reward categories, lab labels |
| `icons/currency-cinders.svg`, `currency-scrap.svg`, `currency-embers.svg` | Transparent SVG, 64 × 64 viewBox | Resource readouts, shops, forging, run results |
| `icons/core-balanced.svg`, `core-heavy.svg`, `core-light.svg` | Transparent SVG, 64 × 64 viewBox | Starter core selection, component cards, codex |
| `images/title-foundry.png` | Opaque PNG, 1672 × 941 | Title/menu artwork; dark left area for existing text, ball on the right |
| `images/foundry-depths.png` | Opaque PNG, 1672 × 941 | Distant Foundry background; low-contrast environment plate |
| `images/iron-colossus.png` | Opaque PNG, 1254 × 1254 | Boss introduction, codex, or encounter portrait |

**Using the icons.** Use 32–64 px for normal UI, with 24 px as a compact preview size that should be checked in its final context. At 16 px, use a deliberately simplified future variant rather than assuming fine details survive. The SVGs contain no fonts, external references, embedded rasters, or scripts. Their transparent backgrounds let existing panels supply the surface. Keep visible labels beside them; provide appropriate `alt` text when an icon is the only label, or `alt=""` when it duplicates adjacent text. Equipment accents indicate function/material, not rarity, so use separate rarity text or a border rather than recoloring these indiscriminately.

Example in a Vite TypeScript module, respecting its configured base URL:

```ts
const artRoot = `${import.meta.env.BASE_URL}art/foundry-v1/`
const icon = document.createElement('img')
icon.src = `${artRoot}icons/slot-core.svg`
icon.width = 32
icon.height = 32
icon.alt = '' // Adjacent visible text already says "Core".
```

The existing project does not currently declare Vite's client types. If using `import.meta.env` in its source, add `/// <reference types="vite/client" />` in `src/vite-env.d.ts`, or use the project's chosen equivalent for the public base URL. The example is an integration recipe, not code already added to gameplay.

**Using the illustrations.** The title art is composed for a left-hand title/menu and a right-hand hero ball. Keep menu text over the calm dark region; add a local gradient scrim if contrast requires it. Use `cover` for the title screen and recheck cropping at narrow aspect ratios. The backdrop is not seamless: fit it to the viewport or use bounded camera movement, not repeating texture wrapping. Its architectural lines are distant scenery and must never imply actual platforms. Use an additional dark overlay if enemies or projectiles lose contrast. The Colossus is a portrait with an opaque smoky background, not a transparent cutout, collision mask, sprite sheet, or animation-ready replacement for the existing boss renderer.

The three raster files total approximately 6.0 MB (5.73 MiB). They are unchanged original PNGs. Before loading them during gameplay, profile decode time and GPU memory and make deliberate delivery-size decisions. Load images once, wait for successful decoding, and keep the existing procedural scene available as a fallback. Do not decode or create images in the animation loop.

**Origin and reproducibility.** The 12 icons are original code-authored vector designs. The three illustrations were generated with the built-in OpenAI image-generation tool using text prompts based on Ballborn's own palette and mechanics; no third-party artwork was supplied as a reference. Exact generation prompts are in [foundry-art-prompts.md](foundry-art-prompts.md). Generated originals were copied into this workspace without modifying their pixels. This origin record does not assert an exclusive copyright or a separate legal license.

**Integration status and validation.** Assets are connected to the standalone gallery and manifest. This asset task did not edit the running game's title, HUD, world rendering, or mechanics. The gallery intentionally provides a review surface before those integrations. The generated artwork was visually inspected in the tool output. PNG dimensions, SVG XML structure, all 15 manifest entries, and local gallery references passed validation. A connected browser was unavailable, so rendered gallery layout, interactive controls, and small-size icon readability still need browser inspection. The grayscale/light controls support that review; they are not proof of accessibility compliance.

`npm run build` was attempted, but other source edits appeared in the shared working tree during this task. At validation time TypeScript reported an incompatible `Simulation.damageEnemy`/`EffectApi` signature and missing `targets` and `LiveEnemy.kind` fields in `src/sim.ts`. Those gameplay changes were left untouched. The standalone gallery and assets have no dependency on that TypeScript code; a successful full-game build is not claimed here.
