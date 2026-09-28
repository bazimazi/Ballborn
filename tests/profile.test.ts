/**
 * Movement and impact profiles for the representative builds, measured with
 * the real simulation in a flat test room. The printed table is copied into
 * docs/design-and-tuning.md; the assertions keep the identities distinct.
 */
import { describe, expect, it } from 'vitest'
import type { HitRecord, RoomTemplate } from '../src/types'
import { build, BUILDS, input, run, seconds, sim } from './helpers'

const FLAT: RoomTemplate = {
  id: 'flat', name: 'Flat', type: 'traversal', width: 6000, height: 720, player: { x: 200, y: 560 },
  exit: { x: 5900, y: 100, w: 60, h: 60 }, platforms: [{ x: 0, y: 608, w: 6000, h: 150 }], hazards: [], spawns: [], objective: '',
}

interface Profile {
  topSpeed: number
  toSpeed: number
  stop: number
  hop: number
  bounce: number
  ram: number
  dash: number
}

function profile(name: keyof typeof BUILDS): Profile {
  const b = build(name)
  const s = sim(FLAT, b)
  run(s, seconds(0.5))
  let t = 0
  while (Math.abs(s.ball.vx) < s.stats.maxSpeed * 0.9 && t < seconds(6)) {
    s.step(input({ x: 1 }))
    t++
  }
  run(s, seconds(1), () => ({ x: 1 }))
  const x0 = s.ball.x
  let guard = 0
  while (s.ball.vx > 20 && guard++ < seconds(6)) s.step(input({ x: -1 }))
  const stop = s.ball.x - x0

  const h = sim(FLAT, b)
  run(h, seconds(0.5))
  const y0 = h.ball.y
  h.step(input({ hopPressed: true }))
  let top = y0
  run(h, seconds(1.5), () => {
    top = Math.min(top, h.ball.y)
    return {}
  })

  const d = sim(FLAT, b)
  d.ball.y = 200
  let fallPeak = Infinity
  let landed = false
  run(d, seconds(3), () => {
    if (d.grounded) landed = true
    if (landed && d.ball.vy < 0) fallPeak = Math.min(fallPeak, d.ball.y)
    return {}
  })
  const floorY = 608 - d.ball.r
  const bounce = Number.isFinite(fallPeak) ? (floorY - fallPeak) / (floorY - 200) : 0

  const room: RoomTemplate = { ...FLAT, spawns: [{ id: 'plate', x: 1500, y: 580 }] }
  const hits: HitRecord[] = []
  const r = sim(room, b, { god: true }, { onHit: (rec) => hits.push(rec) })
  r.enemies[0]!.hp = 1e6
  r.enemies[0]!.maxHp = 1e6
  run(r, seconds(3), () => ({ x: 1 }))
  const ram = hits.filter((x) => x.source === 'collision' && !x.effectId).map((x) => x.effective + x.overkill)[0] ?? 0

  const k = sim(FLAT, b)
  run(k, seconds(0.5))
  k.step(input({ x: 1, abilityPressed: true }))
  const dash = b.ability?.kind === 'dash' ? Math.abs(k.ball.vx) : 0

  return { topSpeed: b.stats.maxSpeed, toSpeed: t / 120, stop, hop: y0 - top, bounce, ram, dash }
}

describe('representative build profiles', () => {
  it('builds feel measurably different, and keep their costs', () => {
    const table: Record<string, Profile> = {}
    for (const name of Object.keys(BUILDS) as (keyof typeof BUILDS)[]) table[name] = profile(name)
    const lines = [
      '| Build | Top speed | To 90% (s) | Turn-around distance (px) | Hop height (px) | Bounce kept | Ram on a plate | Dash launch |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ]
    for (const [name, p] of Object.entries(table)) {
      lines.push(`| ${name} | ${Math.round(p.topSpeed)} | ${p.toSpeed.toFixed(2)} | ${Math.round(p.stop)} | ${Math.round(p.hop)} | ${Math.round(p.bounce * 100)}% | ${Math.round(p.ram)} | ${p.dash ? Math.round(p.dash) : '-'} |`)
    }
    console.log(lines.join('\n'))
    const heavy = table.heavy!
    const light = table.light!
    const rebound = table.rebound!
    expect(heavy.ram).toBeGreaterThan(light.ram * 1.5)
    expect(light.toSpeed).toBeLessThan(heavy.toSpeed)
    expect(light.hop).toBeGreaterThan(heavy.hop * 1.3)
    expect(rebound.bounce).toBeGreaterThan(heavy.bounce + 0.2)
  })
})
