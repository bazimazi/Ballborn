export type Rng = () => number

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
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

export function choice<T>(rng: Rng, list: T[]): T {
  return list[Math.floor(rng() * list.length)]
}

export function shuffle<T>(rng: Rng, list: T[]): T[] {
  const a = list.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = a[i]!
    a[i] = a[j]!
    a[j] = tmp
  }
  return a
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 9)
}

export function formatNum(n: number): string {
  return Math.round(n).toString()
}
