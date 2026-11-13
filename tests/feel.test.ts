import { describe, expect, it } from 'vitest'
import { ROOM_MAP } from '../src/data/rooms'
import { buildFor } from '../src/run'
import { STAT_CLAMPS } from '../src/types'
import { build, BUILDS, input, run, seconds, sim } from './helpers'

// Regression cases from the feel and smoothness review (docs/implementation-plan.md, "Feel pass").

describe('feel pass: the ball', () => {
  it('rolling turns the ball: the spin angle keeps advancing at a steady speed', () => {
    // A heavy, dull shell stays on the floor, so this is pure rolling.
    const s = sim('ignition-hall', build('heavy'))
    run(s, seconds(1.5), () => ({ x: 1 }))
    expect(s.grounded).toBe(true)
    const a = s.ball.spin
    run(s, seconds(0.25), () => ({ x: 1 }))
    const b = s.ball.spin
    run(s, seconds(0.25), () => ({ x: 1 }))
    const c = s.ball.spin
    // Rolling right turns clockwise (positive), by about distance / radius each quarter second.
    expect(b - a).toBeGreaterThan(5)
    expect(c - b).toBeGreaterThan(5)
    expect(s.prevSpin).not.toBe(s.ball.spin)
  })

  it('no part makes a bounce return more energy than it received', () => {
    expect(STAT_CLAMPS.restitution[1]).toBeLessThanOrEqual(0.95)
    const ids = { ...BUILDS.rebound!, core: 'pinball-heart' }
    const b = buildFor(ids, [])
    expect(b.stats.restitution).toBeLessThanOrEqual(0.95)
    const s = sim('ignition-hall', b)
    s.ball.y -= 200
    let peak = Infinity
    let lastPeak = -Infinity
    for (let t = 0; t < seconds(12); t++) {
      s.step(input())
      if (s.ball.vy < 0) peak = Math.min(peak, s.ball.y)
      if (t === seconds(2)) lastPeak = peak
    }
    // After the first bounces, the ball never climbs higher than it already had.
    expect(peak).toBeGreaterThanOrEqual(lastPeak - 1)
  })

  it('the starter ball (a rubber pogo by design) still comes to rest after a hop', () => {
    const s = sim('ignition-hall')
    run(s, seconds(1.5))
    run(s, 1, () => ({ hopPressed: true, hopHeld: true, y: -1 }))
    run(s, seconds(6))
    let grounded = 0
    for (let t = 0; t < seconds(0.5); t++) {
      s.step(input())
      if (s.grounded) grounded++
    }
    expect(grounded).toBeGreaterThan(seconds(0.4))
  })

  it('a hop pressed and held in the air fires on the next floor contact', () => {
    const s = sim('ignition-hall')
    run(s, seconds(1.5))
    s.ball.y -= 120
    s.ball.vy = 0
    s.step(input({ hopPressed: true, hopHeld: true, y: -1 }))
    let hopped = false
    for (let t = 0; t < seconds(1.2) && !hopped; t++) {
      s.step(input({ hopHeld: true, y: -1 }))
      if (s.ball.vy < -500) hopped = true
    }
    expect(hopped).toBe(true)
  })
})

describe('feel pass: combat', () => {
  it('a dash that meets a construct straight away still lands its ram', () => {
    const s = sim('ignition-hall', build({ ...BUILDS.balanced!, ability: 'dash' }), { energy: 100 })
    run(s, seconds(1))
    const e = s.enemies[0]!
    e.x = s.ball.x + 90
    e.y = s.ball.y
    e.vx = 0
    const hp0 = e.hp
    s.step(input({ abilityPressed: true, x: 1 }))
    run(s, seconds(0.12), () => ({ x: 1 }))
    expect(e.hp).toBeLessThan(hp0 - 15)
  })

  it('a turret holds fire while the ball is a room away', () => {
    const room = ROOM_MAP['turret-walk']!
    const s = sim(room)
    const turret = s.enemies.find((e) => e.behavior === 'turret')!
    s.ball.x = turret.x - 1100
    run(s, seconds(4))
    expect(s.taken.projectile).toBe(0)
  })

  it('a slow touch on the Colossus moves the ball out by the overlap, not across the room', () => {
    const s = sim('colossus-hold', build('balanced'), { god: true, hp: 9999 })
    s.boss!.attackCd = 999
    const r = s.boss!.rivets[0]!
    s.ball.x = r.x
    s.ball.y = r.y - (s.ball.r + r.r) + 3
    s.ball.vx = 0
    s.ball.vy = 40
    const before = { x: s.ball.x, y: s.ball.y }
    s.step(input())
    expect(Math.hypot(s.ball.x - before.x, s.ball.y - before.y)).toBeLessThan(20)
  })
})
