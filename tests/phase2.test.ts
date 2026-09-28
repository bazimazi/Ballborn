import { describe, expect, it, beforeAll } from 'vitest'
import { FixedStepper } from '../src/loop'
import { hopVelocity, selfCheckPhysics } from '../src/physics'
import type { FrameInput } from '../src/input'
import { TUNE } from '../src/tune'
import type { RoomTemplate } from '../src/types'
import { mulberry32 } from '../src/util'
import { build, BUILDS, input, run, seconds, sim } from './helpers'

/** A tick-indexed input trace: the same inputs arrive on the same ticks whatever the frame rate. */
function trace(tick: number): Partial<FrameInput> {
  return {
    x: tick % 480 < 300 ? 1 : -1,
    y: tick % 211 < 20 ? -1 : 0,
    hopHeld: tick % 211 < 40,
    hopPressed: tick % 211 === 0,
    abilityPressed: tick % 353 === 17,
  }
}

function snapshot(s: ReturnType<typeof sim>) {
  return {
    tick: s.tick,
    ball: [s.ball.x, s.ball.y, s.ball.vx, s.ball.vy],
    hp: s.hp,
    energy: s.energy,
    ended: s.ended,
    enemies: s.enemies.map((e) => [e.defId, e.x, e.y, e.hp, e.alive]),
    bullets: s.bullets.length,
    dealt: { ...s.dealt },
    taken: { ...s.taken },
    rng: s.rng.state(),
  }
}

function playAt(hz: number, ticks: number, room = 'grate-crossing', fxLevel = 1, fxSeed = 1) {
  const s = sim(room, build('balanced'), { god: true, seed: 77, fx: mulberry32(fxSeed) })
  s.fxLevel = fxLevel
  const stepper = new FixedStepper(TUNE.fixedDt, Math.ceil(TUNE.maxFrame / TUNE.fixedDt))
  let frames = 0
  while (s.tick < ticks && frames < 1e6) {
    frames++
    stepper.advance(1 / hz, 1, TUNE.maxFrame, () => {
      s.step(input(trace(s.tick)))
      return s.tick >= ticks
    })
  }
  return snapshot(s)
}

describe('fixed-step timing', () => {
  it('identical tick-indexed inputs give identical results at 30, 60, 120, and 144 Hz', () => {
    const ticks = seconds(20)
    const ref = playAt(60, ticks)
    for (const hz of [30, 120, 144, 47]) expect(playAt(hz, ticks), `${hz} Hz`).toEqual(ref)
  })

  it('cosmetic effects density and cosmetic randomness never change gameplay', () => {
    const ticks = seconds(12)
    const ref = playAt(60, ticks, 'swarm-loft', 1, 1)
    expect(playAt(60, ticks, 'swarm-loft', 0, 1)).toEqual(ref)
    expect(playAt(60, ticks, 'swarm-loft', 1, 99)).toEqual(ref)
  })

  it('the same room seed replays; a different one diverges', () => {
    const a = sim('bolt-storm', build('balanced'), { god: true, seed: 5 })
    const b = sim('bolt-storm', build('balanced'), { god: true, seed: 5 })
    const c = sim('bolt-storm', build('balanced'), { god: true, seed: 6 })
    for (const s of [a, b, c]) run(s, seconds(8), trace)
    expect(snapshot(a)).toEqual(snapshot(b))
    expect(snapshot(a)).not.toEqual(snapshot(c))
  })

  it('a long hitch is capped instead of spiralling, and game speed scales time, not tick length', () => {
    const stepper = new FixedStepper(TUNE.fixedDt, 12)
    let n = 0
    expect(stepper.advance(2, 1, TUNE.maxFrame, () => (n++, false))).toBe(12)
    expect(stepper.acc).toBeLessThanOrEqual(TUNE.fixedDt)
    const slow = new FixedStepper(TUNE.fixedDt, 12)
    let ticks = 0
    for (let i = 0; i < 60; i++) ticks += slow.advance(1 / 60, 0.85, TUNE.maxFrame, () => false)
    expect(ticks).toBeGreaterThanOrEqual(101)
    expect(ticks).toBeLessThanOrEqual(102)
  })

  it('a low-refresh display is not permanently slower', () => {
    const stepper = new FixedStepper(TUNE.fixedDt, Math.ceil(TUNE.maxFrame / TUNE.fixedDt))
    let ticks = 0
    for (let i = 0; i < 20; i++) ticks += stepper.advance(1 / 20, 1, TUNE.maxFrame, () => false)
    expect(ticks).toBe(120)
  })
})

describe('input edges', () => {
  type Listener = (e: unknown) => void
  const listeners = new Map<string, Listener[]>()
  const target = {
    addEventListener: (type: string, fn: Listener) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
  }
  const fire = (type: string, props: Record<string, unknown>) => {
    for (const fn of listeners.get(type) ?? []) fn({ preventDefault() {}, repeat: false, ...props })
  }
  let Input: typeof import('../src/input').Input

  beforeAll(async () => {
    Object.assign(globalThis, { window: target, document: { ...target, hidden: false } })
    Input = (await import('../src/input')).Input
  })

  it('a hop pressed in a frame that runs no tick is kept for the next tick, then used exactly once', () => {
    listeners.clear()
    const inp = new Input(undefined, null)
    inp.setContext('play')
    const s = sim('ignition-hall', build('balanced'), { god: true })
    run(s, seconds(1))
    const stepper = new FixedStepper(TUNE.fixedDt, 12)
    let hops = 0
    fire('keydown', { code: 'Space' })
    // 480 Hz display: most frames run zero ticks.
    for (let frame = 0; frame < 480; frame++) {
      const frameInput = inp.sample()
      const held = { ...frameInput, hopPressed: false, abilityPressed: false }
      const steps = stepper.advance(1 / 480, 1, TUNE.maxFrame, (first) => {
        s.step(first ? frameInput : held)
        // A hop sets vertical speed to exactly the hop velocity; bounces never do.
        if (s.ball.vy === hopVelocity(s.stats)) hops++
        return false
      })
      if (steps > 0) inp.consumeActions()
      inp.endFrame()
      if (frame === 2) fire('keyup', { code: 'Space' })
    }
    expect(hops).toBe(1)
  })

  it('a two-second hitch spends an ability once', () => {
    listeners.clear()
    const inp = new Input(undefined, null)
    inp.setContext('play')
    const s = sim('ignition-hall', build('balanced'), { god: true })
    const stepper = new FixedStepper(TUNE.fixedDt, 12)
    fire('keydown', { code: 'KeyF' })
    const frameInput = inp.sample()
    const energy = s.energy
    stepper.advance(2, 1, TUNE.maxFrame, (first) => {
      s.step(first ? frameInput : { ...frameInput, hopPressed: false, abilityPressed: false })
      return false
    })
    inp.consumeActions()
    expect(energy - s.energy).toBeGreaterThan(15)
    expect(energy - s.energy).toBeLessThan(18 + 1)
    expect(inp.sample().abilityPressed).toBe(false)
  })

  it('focus loss clears held keys and pending actions; menus ignore gameplay keys', () => {
    listeners.clear()
    const inp = new Input(undefined, null)
    inp.setContext('play')
    fire('keydown', { code: 'KeyD' })
    fire('keydown', { code: 'Space' })
    expect(inp.sample().x).toBe(1)
    fire('blur', {})
    const after = inp.sample()
    expect(after.x).toBe(0)
    expect(after.hopPressed).toBe(false)
    inp.setContext('menu')
    fire('keydown', { code: 'Space' })
    expect(inp.sample().hopPressed).toBe(false)
  })

  it('Escape cancels a rebind', () => {
    listeners.clear()
    const inp = new Input(undefined, null)
    const seen: (string | null)[] = []
    inp.onRebound = (_b, code) => seen.push(code)
    inp.rebinding = 'left'
    fire('keydown', { code: 'Escape' })
    expect(seen).toEqual([null])
  })
})

describe('collision safety', () => {
  const box = (platforms: RoomTemplate['platforms']): RoomTemplate => ({
    id: 'test', name: 'Test', type: 'traversal', width: 1600, height: 720, player: { x: 200, y: 200 },
    exit: { x: 1500, y: 100, w: 60, h: 60 }, platforms, hazards: [], spawns: [], objective: '',
  })

  it('the existing physics self-check passes', () => {
    expect(selfCheckPhysics()).toEqual([])
  })

  it('a ball falling at 2400 px/s does not pass through a 22 px platform', () => {
    const s = sim(box([{ x: 0, y: 400, w: 1600, h: 22 }]), build('heavy'))
    s.ball.y = 300
    s.ball.vy = 2400
    s.boost = 1
    run(s, 30)
    expect(s.ball.y).toBeLessThan(400)
  })

  it('a ball driven into the side wall at high speed stays in the room, and a corner hit is finite', () => {
    const s = sim(box([{ x: 0, y: 608, w: 1600, h: 150 }, { x: 700, y: 560, w: 40, h: 48 }]), build('light'))
    s.ball.x = 1500
    s.ball.y = 580
    s.ball.vx = 2400
    s.boost = 1
    run(s, 60, () => ({ x: 1 }))
    expect(s.ball.x).toBeLessThan(1600)
    const t = sim(box([{ x: 0, y: 608, w: 1600, h: 150 }, { x: 700, y: 560, w: 40, h: 48 }]), build('light'))
    t.ball.x = 660
    t.ball.y = 530
    t.ball.vx = 1400
    t.ball.vy = 900
    run(t, 60)
    expect(Number.isFinite(t.ball.x) && Number.isFinite(t.ball.y)).toBe(true)
    expect(t.ball.y).toBeLessThan(608)
  })

  it('a dash keeps its momentum briefly instead of being cut to top speed', () => {
    const s = sim(box([{ x: 0, y: 608, w: 1600, h: 150 }]), build('balanced'))
    s.ball.y = 600 - s.ball.r
    run(s, seconds(1.2), () => ({ x: 1 }))
    const top = s.stats.maxSpeed
    s.step(input({ x: 1, abilityPressed: true }))
    run(s, 6, () => ({ x: 1 }))
    expect(Math.abs(s.ball.vx)).toBeGreaterThan(top * 1.2)
    run(s, seconds(1.5), () => ({ x: 1 }))
    expect(Math.abs(s.ball.vx)).toBeLessThanOrEqual(top * 1.05)
  })

  it('a moving platform carries the ball; a spring launches it; a conveyor pushes it', () => {
    const s = sim('moving-yard', build('balanced'), { god: true })
    for (const e of s.enemies) e.alive = false
    const plat = s.solids.find((x) => x.move?.axis === 'x')!
    s.ball.x = plat.x + plat.w / 2
    s.ball.y = plat.y - s.ball.r - 1
    run(s, seconds(0.6))
    const offset = s.ball.x - plat.x
    run(s, seconds(0.6))
    expect(Math.abs(s.ball.x - plat.x - offset)).toBeLessThan(6)

    const sp = sim('spring-shaft', build('balanced'), { god: true })
    const spring = sp.solids.find((x) => x.kind === 'spring')!
    sp.ball.x = spring.x + spring.w / 2
    sp.ball.y = spring.y - 80
    sp.ball.vy = 300
    let minVy = 0
    run(sp, 30, () => {
      minVy = Math.min(minVy, sp.ball.vy)
      return {}
    })
    expect(minVy).toBeLessThan(-600)

    const cv = sim('conveyor-line', build({ ...BUILDS.balanced!, shell: 'armored-shell' }), { god: true })
    cv.ball.x = 200
    cv.ball.y = 560
    run(cv, seconds(2))
    // The first belt runs at 160 px/s: a resting ball rides it.
    expect(cv.ball.vx).toBeGreaterThan(120)
    expect(cv.ball.x).toBeGreaterThan(400)
  })

  it('a shot crossing a fast ball still connects', () => {
    const s = sim(box([{ x: 0, y: 608, w: 1600, h: 150 }]), build('heavy'))
    s.ball.x = 400
    s.ball.y = 600 - s.ball.r
    s.ball.vx = 1200
    s.bullets.push({ x: 520, y: s.ball.y, vx: -460, vy: 0, r: 6, damage: 10, life: 3, friendly: false, reflected: false, color: '#fff' })
    const hp = s.hp
    run(s, 20)
    expect(s.hp).toBeLessThan(hp)
  })

  it('knockback pushes constructs away from the ball', () => {
    const s = sim('ignition-hall', build('balanced'), { god: true })
    const e = s.enemies[0]!
    e.x = s.ball.x + 40
    e.vx = 0
    s.knockback(e, e.x - s.ball.x, 0, 400)
    expect(e.vx).toBeGreaterThan(0)
  })
})

describe('long lab sessions', () => {
  it('fifteen simulated minutes of lab fighting keep entities bounded', () => {
    const s = sim('grate-crossing', build('balanced'), { lab: true, god: true, gentle: true })
    // Extra splitters: their shards must not respawn.
    const extra = sim('splitter-yard', build('balanced'), { lab: true, god: true })
    for (const t of [s, extra]) {
      for (let i = 0; i < seconds(15 * 60); i++) {
        if (i % 30 === 0) for (const e of t.enemies) t.damageEnemy(e, 40, ['impact'], { source: 'collision', kind: 'impact' })
        t.step(input({ x: Math.floor(i / 240) % 2 ? 1 : -1, hopPressed: i % 97 === 0 }))
      }
      expect(t.enemies.length).toBeLessThanOrEqual(8)
      expect(t.pickups.length).toBeLessThan(60)
      expect(t.particles.length).toBeLessThanOrEqual(420)
    }
  })
})
