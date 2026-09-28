/**
 * A seeded random stream. Calling it returns a float in [0, 1). `state()`
 * returns the internal counter so a stream can be saved and resumed exactly.
 */
export interface Rng {
  (): number
  state: () => number
}

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  const next = (() => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }) as Rng
  next.state = () => a >>> 0
  return next
}

/** Derive an independent seed for a named sub-stream (room combat, cosmetics). */
export function deriveSeed(seed: number, ...parts: (string | number)[]): number {
  let h = (seed ^ 0x9e3779b9) >>> 0
  for (const part of parts) {
    const s = String(part)
    for (let i = 0; i < s.length; i++) {
      h = Math.imul(h ^ s.charCodeAt(i), 0x85ebca6b) >>> 0
      h = (h ^ (h >>> 13)) >>> 0
    }
    h = Math.imul(h ^ 0x27d4eb2f, 0xc2b2ae35) >>> 0
  }
  return h >>> 0
}

/** A non-gameplay stream for particles and other cosmetic noise. */
export function cosmeticRng(): Rng {
  return mulberry32((Math.random() * 4294967296) >>> 0)
}

export function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v))
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function hypot(x: number, y: number): number {
  return Math.hypot(x, y)
}

export function sign(n: number): number {
  return n < 0 ? -1 : n > 0 ? 1 : 0
}

export function choice<T>(rng: () => number, list: readonly T[]): T {
  return list[Math.floor(rng() * list.length)]!
}

export function shuffle<T>(rng: () => number, list: readonly T[]): T[] {
  const a = list.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = a[i]!
    a[i] = a[j]!
    a[j] = tmp
  }
  return a
}

/** Recursively freeze content definitions so runtime code cannot edit them. */
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.keys(value as object)) deepFreeze((value as Record<string, unknown>)[key])
  }
  return value
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}
