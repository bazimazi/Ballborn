import { glowSprite } from './juice'

/**
 * Screen-space light and lens passes for the world view.
 *
 * - Lighting: a low-resolution light map starts at a cool ambient and gathers
 *   warm light from the ball, slag, the gate, bolts, and blasts. It multiplies
 *   onto the environment only (drawn before the actors), so rooms get depth and
 *   mood while constructs and the ball stay fully readable on top.
 * - Bloom: the finished frame is cascaded down to 1/4, 1/8 and 1/16 size
 *   (bilinear steps act as a blur), raised to a power so only bright pixels
 *   survive, and added back. No `ctx.filter`, so it works in every browser.
 * - Grade: a cool-top, warm-bottom overlay split, the teal and orange of a lit
 *   foundry, and a soft lens vignette.
 *
 * Everything here is cosmetic and can be switched off (high contrast, slow
 * devices) without touching gameplay.
 */

export interface PostLight {
  x: number
  y: number
  r: number
  color: string
  a: number
}

const LIGHT_SCALE = 0.25

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.ceil(w))
  c.height = Math.max(1, Math.ceil(h))
  return c
}

function fit(c: HTMLCanvasElement, w: number, h: number): void {
  const cw = Math.max(1, Math.ceil(w))
  const ch = Math.max(1, Math.ceil(h))
  if (c.width !== cw || c.height !== ch) {
    c.width = cw
    c.height = ch
  }
}

export class Post {
  /** Light map in screen space at a quarter of the CSS size. */
  private light = canvas(4, 4)
  private lctx = this.light.getContext('2d')!
  private a = canvas(4, 4)
  private b = canvas(4, 4)
  private c = canvas(4, 4)
  private t = canvas(4, 4)
  private actx = this.a.getContext('2d')!
  private bctx = this.b.getContext('2d')!
  private cctx = this.c.getContext('2d')!
  private tctx = this.t.getContext('2d')!
  private lights: PostLight[] = []
  private gradeCache: { w: number; h: number; g: CanvasGradient; v: CanvasGradient } | null = null
  /** Cool shadow fill of the light map: how dark the unlit foundry is. */
  ambient = '#a8b2cc'

  reset(): void {
    this.lights.length = 0
  }

  /** A light in screen space (CSS pixels). */
  add(x: number, y: number, r: number, color: string, a = 1): void {
    if (r <= 1 || a <= 0.01 || this.lights.length > 220) return
    this.lights.push({ x, y, r, color, a })
  }

  /** Multiply the gathered light over what has been drawn so far (the environment). */
  applyLights(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const lw = w * LIGHT_SCALE
    const lh = h * LIGHT_SCALE
    fit(this.light, lw, lh)
    const l = this.lctx
    l.setTransform(1, 0, 0, 1, 0, 0)
    l.globalCompositeOperation = 'source-over'
    l.globalAlpha = 1
    l.fillStyle = this.ambient
    l.fillRect(0, 0, this.light.width, this.light.height)
    l.globalCompositeOperation = 'lighter'
    l.setTransform(LIGHT_SCALE, 0, 0, LIGHT_SCALE, 0, 0)
    for (const p of this.lights) {
      if (p.x + p.r < 0 || p.y + p.r < 0 || p.x - p.r > w || p.y - p.r > h) continue
      l.globalAlpha = Math.min(1, p.a)
      l.drawImage(glowSprite(p.color), p.x - p.r, p.y - p.r, p.r * 2, p.r * 2)
    }
    l.globalAlpha = 1
    l.globalCompositeOperation = 'source-over'
    ctx.save()
    ctx.globalCompositeOperation = 'multiply'
    ctx.imageSmoothingEnabled = true
    ctx.drawImage(this.light, 0, 0, w, h)
    ctx.restore()
  }

  /** Bright light bleeds: threshold by power, blur by cascading down, add back. */
  bloom(ctx: CanvasRenderingContext2D, src: HTMLCanvasElement, w: number, h: number, strength: number): void {
    if (strength <= 0) return
    const aw = w / 4
    const ah = h / 4
    fit(this.a, aw, ah)
    fit(this.b, aw / 2, ah / 2)
    fit(this.c, aw / 4, ah / 4)
    fit(this.t, aw / 2, ah / 2)
    const A = this.actx
    const B = this.bctx
    const C = this.cctx
    const T = this.tctx
    for (const g of [A, B, C, T]) {
      g.imageSmoothingEnabled = true
      g.globalCompositeOperation = 'source-over'
      g.globalAlpha = 1
    }
    A.drawImage(src, 0, 0, this.a.width, this.a.height)
    // Threshold: x^3 keeps highlights and drops the midtones.
    A.globalCompositeOperation = 'multiply'
    A.drawImage(this.a, 0, 0)
    A.drawImage(this.a, 0, 0)
    A.globalCompositeOperation = 'source-over'
    B.drawImage(this.a, 0, 0, this.b.width, this.b.height)
    C.drawImage(this.b, 0, 0, this.c.width, this.c.height)
    // Widen once more: the 1/16 level back up into the 1/8 level, so the halo has a soft tail.
    T.clearRect(0, 0, this.t.width, this.t.height)
    T.drawImage(this.b, 0, 0)
    T.globalAlpha = 0.9
    T.globalCompositeOperation = 'lighter'
    T.drawImage(this.c, 0, 0, this.t.width, this.t.height)
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.imageSmoothingEnabled = true
    ctx.globalAlpha = Math.min(1, 0.32 * strength)
    ctx.drawImage(this.a, 0, 0, w, h)
    ctx.globalAlpha = Math.min(1, 0.5 * strength)
    ctx.drawImage(this.t, 0, 0, w, h)
    ctx.restore()
  }

  /** Teal shadows up top, warm heat from the floor, and a lens vignette. */
  grade(ctx: CanvasRenderingContext2D, w: number, h: number, warmth: number): void {
    let gc = this.gradeCache
    if (!gc || gc.w !== w || gc.h !== h) {
      const g = ctx.createLinearGradient(0, 0, 0, h)
      g.addColorStop(0, 'rgba(40, 92, 140, 0.55)')
      g.addColorStop(0.5, 'rgba(128, 128, 128, 0)')
      g.addColorStop(1, 'rgba(255, 120, 50, 0.5)')
      const v = ctx.createRadialGradient(w / 2, h * 0.48, Math.min(w, h) * 0.42, w / 2, h / 2, Math.hypot(w, h) * 0.6)
      v.addColorStop(0, 'rgba(6, 8, 14, 0)')
      v.addColorStop(1, 'rgba(6, 8, 14, 0.62)')
      gc = this.gradeCache = { w, h, g, v }
    }
    ctx.save()
    ctx.globalCompositeOperation = 'overlay'
    ctx.globalAlpha = 0.42 + 0.12 * warmth
    ctx.fillStyle = gc.g
    ctx.fillRect(0, 0, w, h)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    ctx.fillStyle = gc.v
    ctx.fillRect(0, 0, w, h)
    ctx.restore()
  }
}
