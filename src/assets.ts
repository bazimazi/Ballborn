/**
 * Painted backdrops from the Foundry art set. Images load once in the
 * background and are only handed out after they decode; until then (or if
 * they fail) every caller falls back to the procedural scene.
 */
export type ArtId = 'title' | 'depths' | 'colossus'

const FILES: Record<ArtId, string> = {
  title: 'art/foundry-v1/images/title-foundry.webp',
  depths: 'art/foundry-v1/images/foundry-depths.webp',
  colossus: 'art/foundry-v1/images/iron-colossus.webp',
}

/** Where the hero ball sits in the title painting, as a fraction of the image. */
export const TITLE_BALL = { x: 0.755, y: 0.535, r: 0.1 }

const ready = new Map<ArtId, HTMLImageElement>()
let started = false

export function artUrl(id: ArtId): string {
  return new URL(FILES[id], document.baseURI).href
}

export function iconUrl(name: string): string {
  return new URL(`art/foundry-v1/icons/${name}.svg`, document.baseURI).href
}

export function loadArt(): void {
  if (started || typeof Image === 'undefined') return
  started = true
  for (const id of Object.keys(FILES) as ArtId[]) {
    const img = new Image()
    img.decoding = 'async'
    img.src = artUrl(id)
    img.decode().then(() => ready.set(id, img), () => {
      // Missing art is not an error: the procedural scene stays.
    })
  }
}

export function art(id: ArtId): HTMLImageElement | null {
  return ready.get(id) ?? null
}

/** Draw an image to cover a box, like CSS `object-fit: cover`, with an extra zoom and a pan in -1..1. */
export function coverRect(img: { width: number; height: number }, w: number, h: number, zoom = 1, panX = 0, panY = 0): { x: number; y: number; w: number; h: number } {
  const s = Math.max(w / img.width, h / img.height) * zoom
  const dw = img.width * s
  const dh = img.height * s
  return { x: (w - dw) / 2 + ((dw - w) / 2) * panX, y: (h - dh) / 2 + ((dh - h) / 2) * panY, w: dw, h: dh }
}
