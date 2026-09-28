import { describe, expect, it } from 'vitest'
import { ROOMS } from '../src/data/rooms'
import { build, BUILDS, run, seconds, sim } from './helpers'

describe('rooms forgive a nonlethal mistake', () => {
  it('falling into slag costs integrity, not the run: every build can steer back out', () => {
    for (const name of Object.keys(BUILDS) as (keyof typeof BUILDS)[]) {
      const s = sim('moving-yard', build(name))
      for (const e of s.enemies) e.alive = false
      s.ball.x = 450
      s.ball.y = 600
      s.ball.vx = 0
      s.ball.vy = 200
      run(s, seconds(3), () => ({ x: -1, hopHeld: true, y: -1 }))
      expect(s.ended, name).toBe('play')
      expect(s.ball.x, name).toBeLessThan(420)
      expect(s.taken.lava, name).toBeLessThan(s.maxHp * 0.6)
    }
  })

  it('every slag pool in every room spits a resting heavy ball back above the floor line', () => {
    for (const room of ROOMS) {
      for (const lava of room.hazards.filter((h) => h.type === 'lava')) {
        // Pools sealed under a bridge cannot be fallen into; test the open stretches.
        const covered = (x: number) => room.platforms.some((p) => x >= p.x - 20 && x <= p.x + p.w + 20 && p.y < lava.y)
        let x = lava.x + 30
        while (x < lava.x + lava.w - 30 && covered(x)) x += 10
        if (covered(x) || x >= lava.x + lava.w - 30) continue
        const s = sim(room, build('heavy'), { god: true })
        for (const e of s.enemies) e.alive = false
        s.ball.x = x
        s.ball.y = lava.y + 4
        s.ball.vy = 100
        let top = Infinity
        run(s, seconds(1), () => {
          top = Math.min(top, s.ball.y)
          return {}
        })
        expect(top + s.ball.r, `${room.id} @${lava.x}`).toBeLessThan(608)
      }
    }
  })
})

describe('the revised Swarm Loft is a ricochet arena any build can finish', () => {
  it('the floor under the roof stays open for the heavy build', () => {
    const s = sim('swarm-loft', build('heavy'), { god: true })
    for (const e of s.enemies) e.alive = false
    run(s, seconds(6), () => ({ x: 1 }))
    expect(s.ball.x).toBeGreaterThan(1300)
  })

  it('a rubber ball keeps bouncing between floor and roof', () => {
    const s = sim('swarm-loft', build('rebound'), { god: true })
    for (const e of s.enemies) e.alive = false
    s.ball.x = 700
    s.ball.y = 560
    s.ball.vy = -900
    let roofHits = 0
    let wasUp = false
    run(s, seconds(1.5), () => {
      const up = s.ball.vy < 0
      if (wasUp && !up && s.ball.y < 400) roofHits++
      wasUp = up
      return {}
    })
    expect(roofHits).toBeGreaterThanOrEqual(1)
  })
})
