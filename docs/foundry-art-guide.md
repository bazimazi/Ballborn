Ballborn · Foundry art collection v1

Created 2026-09-28. The standalone review gallery, its `manifest.json`, and the original PNG masters were removed from `public/` because the game does not load them; they remain in git history (commit `592162a`) if the art needs to be re-exported.

**Design direction.** Dark iron bodies, warm bone-colored steel edges, molten highlights, and restrained material accents continue the existing game's palette. Chunky SVG geometry matches its Canvas shapes. The illustrations add texture and scale for menus and background atmosphere. Individual icons use silhouette and internal marks as well as color: heavy is a plated octagon, balanced is a divided circle, light is an open-feeling round frame with a feather motif.

**Deliverables.** All runtime files live in `public/art/foundry-v1/` and are loaded by `src/assets.ts`, `src/ui.ts`, `src/game.ts`, and `index.html`.

| Files | Format | Intended placement |
| --- | --- | --- |
| `icons/slot-core.svg`, `slot-shell.svg`, `slot-momentum.svg`, `slot-impact.svg`, `slot-ability.svg`, `slot-passive.svg` | Transparent SVG, 64 × 64 viewBox | Equipment slots, build sheet, reward categories, lab labels |
| `icons/currency-cinders.svg`, `currency-scrap.svg`, `currency-embers.svg` | Transparent SVG, 64 × 64 viewBox | Resource readouts, shops, forging, run results |
| `icons/core-balanced.svg`, `core-heavy.svg`, `core-light.svg` | Transparent SVG, 64 × 64 viewBox | Starter core selection, component cards, codex |
| `images/title-foundry.webp` | Opaque WebP, 1672 × 941 | Title/menu artwork; dark left area for existing text, ball on the right |
| `images/foundry-depths.webp` | Opaque WebP, 1672 × 941 | Distant Foundry background; low-contrast environment plate |
| `images/iron-colossus.webp` | Opaque WebP, 1254 × 1254 | Boss introduction, codex, or encounter portrait |

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

The game ships WebP versions of the three illustrations (about 250 KB total, down from about 6.0 MB of original PNGs). Load images once, wait for successful decoding, and keep the existing procedural scene available as a fallback. Do not decode or create images in the animation loop.

**Origin and reproducibility.** The 12 icons are original code-authored vector designs. The three illustrations were generated with the built-in OpenAI image-generation tool using text prompts based on Ballborn's own palette and mechanics; no third-party artwork was supplied as a reference. Exact generation prompts are in [foundry-art-prompts.md](foundry-art-prompts.md). Generated originals were copied into this workspace without modifying their pixels. This origin record does not assert an exclusive copyright or a separate legal license.

**Integration status.** The icons and WebP illustrations are wired into the title screen, HUD, menus, and backdrops. `src/assets.ts` loads the images once, waits for decode, and falls back to the procedural scene if one is missing.
