import { describe, expect, it } from 'vitest'
import { horizontalAccel } from '../src/physics'
import { createRun, makeOffers, restoreRun, salvageValue, serializeRun } from '../src/run'
import { defaultSave } from '../src/save'
import { build, BUILDS, input, run, seconds, sim } from './helpers'

// Regression cases from the in-play review (see docs/implementation-plan.md, "Review pass").

describe('review pass: simulation', () => {
  it('a slow touch on a rivet pushes the ball clear instead of gluing it on', () => {
    for (const name of ['balanced', 'heavy', 'light'] as const) {
      const s = sim('colossus-hold', build(name), { god: true, hp: 9999 })
      s.boss!.attackCd = 999
      const r = s.boss!.rivets[0]!
      s.ball.x = r.x - 6
      s.ball.y = r.y - (s.ball.r + r.r) - 4
      s.ball.vx = 0
      s.ball.vy = 60
      run(s, seconds(4))
      expect(s.taken.boss, name).toBeLessThan(15)
    }
  })

  it('every rivet sits on the rim, outside the plate, where a ram can reach it', () => {
    const s = sim('colossus-hold')
    for (const r of s.boss!.rivets) expect(Math.hypot(r.ox, r.oy) + r.r).toBeGreaterThan(s.boss!.r + 10)
  })

  it('combo milestones do not pay again while the count sits at its cap', () => {
    const s = sim('ignition-hall', build('balanced'), { energy: 0 })
    const add = () => (s as unknown as { addCombo(): void }).addCombo()
    for (let i = 0; i < 40; i++) add()
    const e0 = s.energy
    for (let i = 0; i < 10; i++) add()
    expect(s.energy).toBe(e0)
  })

  it('Ground Slam pressed on the floor is a whiff', () => {
    const s = sim('ignition-hall', build({ ...BUILDS.heavy!, ability: 'ground-slam' }))
    run(s, seconds(1))
    const g = s.enemies[0]!
    g.x = s.ball.x + 90
    g.y = 590
    g.vx = 0
    const hp = g.hp
    expect(s.grounded).toBe(true)
    s.step(input({ abilityPressed: true }))
    run(s, 30)
    expect(g.hp).toBe(hp)
  })

  it('a stunned turret stays on its mount', () => {
    const s = sim('turret-walk', build('heavy'), { god: true })
    const t = s.enemies.find((e) => e.defId === 'turret')!
    const y0 = t.y
    for (let k = 0; k < 5; k++) {
      t.stun = 0.16
      run(s, seconds(0.5))
    }
    expect(t.y).toBe(y0)
  })

  it('a dash through a shot turns it around', () => {
    const s = sim('turret-walk', build('balanced'))
    for (const e of s.enemies) if (e.defId !== 'turret') e.alive = false
    s.ball.x = 400
    s.ball.y = 560
    s.ball.vx = 0
    s.ball.vy = 0
    s.bullets.push({ x: 470, y: 560, vx: -340, vy: 0, r: 6, damage: 10, life: 3, friendly: false, reflected: false, color: '' })
    const hp = s.hp
    s.step(input({ abilityPressed: true, x: 1 }))
    let friendly = 0
    for (let i = 0; i < 30; i++) {
      s.step(input())
      friendly = Math.max(friendly, s.bullets.filter((b) => b.friendly).length)
    }
    expect(friendly).toBe(1)
    expect(s.hp).toBe(hp)
  })

  it('a released ball comes to rest instead of creeping', () => {
    const s = sim('speed-lane', build('balanced'))
    run(s, seconds(1))
    s.ball.x = 300
    run(s, seconds(0.4), () => ({ x: 1 }))
    run(s, seconds(3))
    const x = s.ball.x
    run(s, seconds(5))
    expect(Math.abs(s.ball.x - x)).toBeLessThan(1)
  })

  it('the air-turn assist works with an analog stick', () => {
    const stats = build('balanced').stats
    const full = horizontalAccel(stats, -1, 600, false)
    const most = horizontalAccel(stats, -0.99, 600, false)
    expect(most / full).toBeGreaterThan(0.97)
  })

  it('splitter shards share the room scaling', () => {
    const plain = sim('ignition-hall', build('balanced'), { depth: 0 })
    const deep = sim('ignition-hall', build('balanced'), { depth: 5 })
    const make = (s: typeof plain) => (s as unknown as { makeEnemy(id: string, x: number, y: number, e: boolean, sc: number): { maxHp: number } })
    const scale = (s: typeof plain) => (s as unknown as { enemyScale: number }).enemyScale
    expect(scale(deep)).toBeGreaterThan(scale(plain))
    expect(make(deep).makeEnemy('grunt', 0, 0, false, scale(deep)).maxHp).toBeGreaterThan(make(plain).makeEnemy('grunt', 0, 0, false, scale(plain)).maxHp)
  })
})

describe('review pass: run', () => {
  it('treasure offers a part, cinders or an ember, and the weld', () => {
    for (let seed = 1; seed < 200; seed++) {
      const r = createRun(0, false, seed)
      const kinds = makeOffers(r, defaultSave(), 'treasure').map((o) => o.kind)
      expect(kinds.length, String(seed)).toBe(3)
      expect(kinds.filter((k) => k === 'component').length, String(seed)).toBeLessThanOrEqual(1)
      expect(kinds, String(seed)).toContain('heal')
      expect(kinds.some((k) => k === 'cinders' || k === 'ember'), String(seed)).toBe(true)
    }
  })

  it('a checkpoint keeps the reward table it was rolled from', () => {
    const r = createRun(0, false, 7)
    makeOffers(r, defaultSave(), 'elite')
    const back = restoreRun(JSON.parse(JSON.stringify(serializeRun(r))))!
    expect(back.offerKind).toBe('elite')
    expect(salvageValue(back.offerKind)).toBe(14)
  })
})
