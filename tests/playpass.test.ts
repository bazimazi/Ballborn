/**
 * Play pass two (November 2026): what a human player ran into, played in the
 * browser, and what changed. Each case pins the new rule so a later tuning
 * pass can see what it is moving.
 */
import { describe, expect, it } from 'vitest'
import { collisionDamage } from '../src/physics'
import { BOSS_RULES, FLOOR_Y } from '../src/sim'
import { TUNE } from '../src/tune'
import { STARTER_IDS } from '../src/run'
import type { RoomTemplate } from '../src/types'
import { build, input, run, seconds, sim } from './helpers'

const FLAT = (extra: Partial<RoomTemplate> = {}): RoomTemplate => ({
  id: 'flat', name: 'Flat', type: 'combat', width: 4000, height: 720, player: { x: 200, y: 560 },
  exit: { x: 3900, y: 100, w: 60, h: 60 }, platforms: [{ x: 0, y: FLOOR_Y, w: 4000, h: 150 }], hazards: [], spawns: [], objective: '',
  ...extra,
})

describe('ram damage curve', () => {
  it('mass counts, but a heavy core is no longer five light cores', () => {
    const per = (core: string) => {
      const s = build({ ...STARTER_IDS, core }).stats
      return collisionDamage(s, s.maxSpeed * 0.8, 1, false)
    }
    const balanced = per('balanced-core')
    const heavy = per('heavy-core')
    const light = per('light-core')
    expect(heavy / balanced).toBeGreaterThan(1.5)
    expect(heavy / balanced).toBeLessThan(1.9)
    expect(light / balanced).toBeGreaterThan(0.65)
    expect(light / balanced).toBeLessThan(0.85)
    expect(build({ ...STARTER_IDS, core: 'light-core' }).stats.critChance).toBeGreaterThan(build('balanced').stats.critChance)
  })
})

describe('rolling over low ledges', () => {
  it('a rolling ball climbs a 36 px step instead of bouncing back off its side', () => {
    const room = FLAT({ platforms: [{ x: 0, y: FLOOR_Y, w: 4000, h: 150 }, { x: 700, y: FLOOR_Y - 36, w: 400, h: 36 }] })
    const s = sim(room, build('balanced'))
    run(s, seconds(0.3))
    let onTop = false
    run(s, seconds(2), () => {
      if (s.grounded && s.ball.y + s.ball.r <= FLOOR_Y - 35) onTop = true
      return { x: 1 }
    })
    expect(onTop).toBe(true)
    expect(s.ball.x).toBeGreaterThan(1100)
  })

  it('a wall taller than a step still stops the ball', () => {
    const room = FLAT({ platforms: [{ x: 0, y: FLOOR_Y, w: 4000, h: 150 }, { x: 700, y: FLOOR_Y - 120, w: 60, h: 120 }] })
    const s = sim(room, build('balanced'))
    run(s, seconds(3), () => ({ x: 1 }))
    expect(s.ball.x).toBeLessThan(700)
  })
})

describe('shields turn slowly and their guard can be broken', () => {
  it('a ball that crosses over a shield bearer gets a moment at its back', () => {
    const s = sim(FLAT({ spawns: [{ id: 'shield', x: 900, y: 580 }] }), build('balanced'))
    const e = s.enemies[0]!
    run(s, seconds(0.5))
    expect(e.facing).toBe(-1)
    // Put the ball behind it.
    s.ball.x = e.x + 140
    s.ball.y = FLOOR_Y - s.ball.r
    s.step(input())
    expect(e.facing).toBe(-1)
    run(s, seconds(TUNE.shieldTurn * 0.6))
    expect(e.facing).toBe(-1)
    run(s, seconds(TUNE.shieldTurn * 0.6))
    expect(e.facing).toBe(1)
  })

  it('a crown hit drops the guard, and a frontal ram then lands in full', () => {
    const s = sim(FLAT({ spawns: [{ id: 'shield', x: 900, y: 580 }] }), build('balanced'), { god: true })
    const e = s.enemies[0]!
    e.hp = e.maxHp = 1e5
    run(s, seconds(0.4))
    e.vx = 0
    // Down onto the crown.
    s.ball.x = e.x
    s.ball.y = e.y - e.r - s.ball.r - 2
    s.ball.vx = 0
    s.ball.vy = 700
    s.step(input())
    expect(e.guard).toBeGreaterThan(0)
    // Now from the front, at a speed the shield would normally turn.
    const front = e.x + e.facing * (e.r + s.ball.r + 2)
    s.ball.x = front
    s.ball.y = e.y
    s.ball.vx = -e.facing * s.stats.maxSpeed * 0.6
    s.ball.vy = 0
    e.hitCd = 0
    const before = e.hp
    s.step(input())
    expect(before - e.hp).toBeGreaterThan(15)
  })
})

describe('White Hot', () => {
  it('at a five-hit chain every ram is clean and hits harder; it ends with the chain', () => {
    const fx: string[] = []
    const s = sim(FLAT({ spawns: [{ id: 'plate', x: 900, y: 570 }] }), build('balanced'), { god: true }, { onFx: (e) => { if (e.type === 'overdrive') fx.push(e.on ? 'on' : 'off') } })
    const e = s.enemies[0]!
    e.hp = e.maxHp = 1e5
    run(s, seconds(0.3))
    // A slow bump: a glance with recoil.
    const ram = () => {
      e.hitCd = 0
      e.vx = 0
      s.hurtLock = 0
      s.ball.x = e.x - e.r - s.ball.r - 1
      s.ball.y = e.y
      s.ball.vx = 240
      s.ball.vy = 0
      const hp = s.hp
      const before = e.hp
      s.step(input())
      return { lost: hp - s.hp, dealt: before - e.hp }
    }
    const cold = ram()
    expect(cold.lost).toBeGreaterThan(0)
    for (let i = 0; i < TUNE.overdriveCombo; i++) s['addCombo']()
    expect(s.overdrive).toBe(true)
    expect(fx).toContain('on')
    s.comboTimer = 2
    const hot = ram()
    expect(hot.lost).toBe(0)
    expect(hot.dealt).toBeGreaterThan(cold.dealt * TUNE.overdriveDamage)
    run(s, seconds(TUNE.comboWindow + 0.2))
    expect(s.overdrive).toBe(false)
    expect(fx).toContain('off')
  })
})

describe('the Colossus is not a combo farm', () => {
  it('body hits outside a punish window add nothing to the chain; rivet hits are rate limited', () => {
    const s = sim('colossus-hold', build('balanced'), { god: true })
    const boss = s.boss!
    for (const r of boss.rivets) s.damageEnemy(r, 999, ['impact'], { source: 'collision', kind: 'impact' })
    for (const e of s.enemies) e.alive = false
    s.combo = 0
    boss.recover = 0
    boss.attackCd = 99
    for (let i = 0; i < 6; i++) {
      s.ball.x = boss.x - boss.r - s.ball.r - 2
      s.ball.y = boss.y
      s.ball.vx = s.stats.maxSpeed
      s.ball.vy = 0
      s.step(input())
      run(s, seconds(0.2))
    }
    expect(s.combo).toBe(0)
    expect(BOSS_RULES.guarded).toBeLessThan(1)
  })
})

describe('grading', () => {
  it('a challenge with nothing to break is graded on the run to the exit, not at 0.0 s', () => {
    const s = sim('speed-lane', build('balanced'))
    run(s, seconds(1.5), () => ({ x: 1 }))
    expect(s.openAtStart).toBe(true)
    expect(s.gradeFacts().time).toBeGreaterThan(1)
  })
})
