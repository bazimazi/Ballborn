import { describe, expect, it } from 'vitest'
import type { RoomTemplate } from '../src/types'
import { TUNE } from '../src/tune'
import type { FxEvent } from '../src/sim'
import { build, input, run, seconds, sim } from './helpers'

// Flow mechanics from the gameplay overhaul: plow-through rams, wall kicks, and the kill refund.

const FLAT: RoomTemplate = {
  id: 'flat', name: 'Flat', type: 'combat', width: 4000, height: 720, player: { x: 200, y: 560 },
  exit: { x: 3900, y: 100, w: 60, h: 60 }, platforms: [{ x: 0, y: 608, w: 4000, h: 150 }], hazards: [], spawns: [], objective: '',
}

describe('flow: plow-through', () => {
  it('a killing clean ram carries on through the wreck instead of bouncing back', () => {
    const room: RoomTemplate = { ...FLAT, spawns: [{ id: 'grunt', x: 1400, y: 580 }] }
    const fx: FxEvent[] = []
    const s = sim(room, build('heavy'), { god: true }, { onFx: (e) => fx.push(e) })
    const grunt = s.enemies[0]!
    grunt.hp = 1
    // Wind up to full speed before reaching it.
    let guard = 0
    while (grunt.alive && guard++ < seconds(6)) s.step(input({ x: 1 }))
    expect(grunt.alive).toBe(false)
    // Still heading right, at a real share of the run-up speed.
    expect(s.ball.vx).toBeGreaterThan(s.stats.maxSpeed * TUNE.cleanRamRatio * TUNE.plowKeepMin)
    expect(fx.some((e) => e.type === 'plow')).toBe(true)
  })

  it('a ram that does not kill still rebounds', () => {
    const room: RoomTemplate = { ...FLAT, spawns: [{ id: 'grunt', x: 1400, y: 580 }] }
    const s = sim(room, build('balanced'), { god: true })
    const grunt = s.enemies[0]!
    grunt.hp = 1e6
    grunt.maxHp = 1e6
    let guard = 0
    while (grunt.hp === 1e6 && guard++ < seconds(6)) s.step(input({ x: 1 }))
    expect(grunt.hp).toBeLessThan(1e6)
    expect(s.ball.vx).toBeLessThan(0)
  })
})

describe('flow: wall kick', () => {
  it('a hop pressed against a wall in the air kicks the ball away from it', () => {
    const fx: FxEvent[] = []
    const s = sim(FLAT, build('balanced'), {}, { onFx: (e) => fx.push(e) })
    // Airborne, drifting into the left room wall.
    s.ball.x = s.ball.r + 2
    s.ball.y = 300
    s.ball.vx = -400
    s.ball.vy = 0
    s.step(input({ x: -1 }))
    s.step(input({ x: -1 }))
    expect(s.wallTime).toBeGreaterThan(0)
    s.step(input({ hopPressed: true, hopHeld: true }))
    expect(s.ball.vx).toBeGreaterThan(s.stats.maxSpeed * TUNE.wallKickSpeed * 0.9)
    expect(s.ball.vy).toBeLessThan(-200)
    expect(fx.some((e) => e.type === 'wallkick')).toBe(true)
  })

  it('holding hop while sliding into a wall never kicks on its own', () => {
    const s = sim(FLAT, build('balanced'))
    s.ball.x = s.ball.r + 2
    s.ball.y = 300
    s.ball.vx = -400
    s.ball.vy = 0
    run(s, seconds(0.3), () => ({ x: -1, hopHeld: true, y: -1 }))
    expect(s.ball.vx).toBeLessThanOrEqual(TUNE.wallKickSpeed * s.stats.maxSpeed * 0.5)
  })

  it('a floor hop is unchanged', () => {
    const a = sim(FLAT, build('balanced'))
    run(a, seconds(0.5))
    const y0 = a.ball.y
    a.step(input({ hopPressed: true }))
    let top = y0
    run(a, seconds(1.2), () => {
      top = Math.min(top, a.ball.y)
      return {}
    })
    expect(y0 - top).toBeGreaterThan(80)
  })
})

describe('flow: kill refund', () => {
  it('a killing ram winds the ability cooldown back', () => {
    const room: RoomTemplate = { ...FLAT, spawns: [{ id: 'grunt', x: 1400, y: 580 }] }
    const s = sim(room, build('balanced'), { god: true })
    s.enemies[0]!.hp = 1
    let guard = 0
    while (s.enemies.length && s.enemies[0]!.alive && guard++ < seconds(6)) {
      s.abilityCd = 4
      s.step(input({ x: 1 }))
    }
    expect(s.kills).toBe(1)
    expect(s.abilityCd).toBeLessThan(4 * TUNE.killCooldownKeep + 0.05)
  })
})
