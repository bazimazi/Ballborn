import { describe, expect, it } from 'vitest'
import { BOSS_RULES } from '../src/sim'
import { build, BUILDS, input, run, seconds, sim } from './helpers'

function bossRoom(name: keyof typeof BUILDS, phase: 1 | 2 = 2) {
  const s = sim('colossus-hold', build(name), { god: true })
  const boss = s.boss!
  if (phase === 2) {
    for (const r of boss.rivets) s.damageEnemy(r, 999, ['impact'], { source: 'collision', kind: 'impact' })
    expect(boss.phase).toBe(2)
    // The damage plan is measured inside a punish window: the moment after an attack when the shutters are open.
    boss.recover = 10
  }
  for (const e of s.enemies) e.alive = false
  return s
}

/** Ram the open heart at 80% of top speed, then let effects run for three seconds. */
function ramBoss(name: keyof typeof BUILDS): { ram: number; after: number; bySource: Record<string, number> } {
  const s = bossRoom(name)
  const boss = s.boss!
  const start = boss.hp
  s.ball.x = boss.x - boss.r - s.ball.r - 4
  s.ball.y = boss.y
  s.ball.vx = s.stats.maxSpeed * 0.8
  s.ball.vy = 0
  s.step(input())
  const ram = start - boss.hp
  run(s, seconds(3))
  return { ram, after: start - boss.hp, bySource: { ...s.bossDealt } }
}

describe('the Colossus meets every build through the shared target rules', () => {
  it('burn, chain, explosion, and reflected shots all reach the boss', () => {
    const s = bossRoom('balanced')
    const boss = s.boss!
    s.applyStatus(boss, 'burn', 2, 10)
    run(s, seconds(1))
    expect(s.bossDealt.status).toBeGreaterThan(4)
    s.chain(boss.x - 80, boss.y, 2, 200, 20)
    s.explode(boss.x - 60, boss.y, 120, 30, false)
    expect(s.bossDealt.effect).toBeGreaterThan(20)
    s.bullets.push({ x: boss.x, y: boss.y, vx: 0, vy: 0, r: 6, damage: 10, life: 1, friendly: true, reflected: true, color: '#fff' })
    s.step(input())
    expect(s.bossDealt.reflect).toBeGreaterThan(10)
  })

  it('phase one: the plate blunts body damage, rivets take full damage and open phase two', () => {
    const s = bossRoom('balanced', 1)
    const boss = s.boss!
    const before = boss.hp
    s.damageEnemy(boss, 100, ['impact'], { source: 'collision', kind: 'impact' })
    expect(before - boss.hp).toBeCloseTo(100 * BOSS_RULES.plate, 5)
    const rivet = boss.rivets[0]!
    s.damageEnemy(rivet, 30, ['fire'], { source: 'effect', kind: 'impact' })
    expect(rivet.max - rivet.hp).toBeCloseTo(30, 5)
    s.applyStatus(rivet, 'burn', 3, 10)
    run(s, seconds(1))
    expect(rivet.hp).toBeLessThan(rivet.max - 30)
    for (const r of boss.rivets) s.damageEnemy(r, 999, ['impact'], { source: 'collision', kind: 'impact' })
    expect(boss.phase).toBe(2)
  })

  it('every representative build has a working damage plan against the open heart', () => {
    const rows: string[] = []
    for (const name of Object.keys(BUILDS) as (keyof typeof BUILDS)[]) {
      const r = ramBoss(name)
      const sources = Object.entries(r.bySource).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n.toFixed(0)}`).join(', ')
      rows.push(`${name.padEnd(9)} ram ${r.ram.toFixed(0).padStart(4)}  after 3 s ${r.after.toFixed(0).padStart(4)}  ${sources}`)
      expect(r.ram, name).toBeGreaterThan(15)
      expect(r.after, name).toBeGreaterThanOrEqual(r.ram)
    }
    console.log(`Colossus, phase two, one ram at 80% top speed:\n${rows.join('\n')}`)
    expect(ramBoss('fire').bySource.status).toBeGreaterThan(0)
    expect(ramBoss('magnetic').bySource.effect).toBeGreaterThan(0)
  })

  it('phases two and three: the heart is guarded between attacks, and every attack opens a punish window', () => {
    const s = bossRoom('balanced')
    const boss = s.boss!
    boss.recover = 0
    let before = boss.hp
    s.damageEnemy(boss, 100, ['impact'], { source: 'collision', kind: 'impact' })
    expect(before - boss.hp).toBeCloseTo(100 * BOSS_RULES.guarded, 5)
    boss.recover = 0.5
    before = boss.hp
    s.damageEnemy(boss, 100, ['impact'], { source: 'collision', kind: 'impact' })
    expect(before - boss.hp).toBeCloseTo(100 * BOSS_RULES.recovering, 5)
    // Run the fight with an idle ball: every finished attack opens a window.
    boss.recover = 0
    s.hp = s.maxHp = 1e6
    const seen = new Set<string>()
    let windows = 0
    let was = false
    for (let i = 0; i < seconds(40); i++) {
      if (boss.attack !== 'none') seen.add(boss.attack)
      s.step(input())
      if (boss.recover > 0 && !was) windows++
      was = boss.recover > 0
    }
    expect(seen.has('wave')).toBe(true)
    expect(windows).toBeGreaterThanOrEqual(seen.size)
  })

  it('a shockwave catches a ball on the floor and is cleared by any hop', () => {
    const s = bossRoom('heavy')
    const boss = s.boss!
    boss.attackCd = 99
    s.ball.x = 600
    s.ball.y = 608 - s.ball.r
    s.shocks.push({ x: 700, y: 608, dir: -1, speed: 560, life: 4, damage: 14, hit: false })
    const hp = s.hp
    run(s, seconds(0.4))
    expect(s.hp).toBeLessThan(hp)
    const h = bossRoom('heavy')
    h.boss!.attackCd = 99
    h.ball.x = 600
    h.ball.y = 608 - h.ball.r
    run(h, seconds(0.3))
    h.shocks.push({ x: 760, y: 608, dir: -1, speed: 560, life: 4, damage: 14, hit: false })
    const hp2 = h.hp
    // A heavy ball's short hop, pressed as the crest comes within reach.
    let pressed = false
    run(h, seconds(0.6), () => {
      const w = h.shocks[0]
      if (!pressed && w && w.x - h.ball.x < 90) {
        pressed = true
        return { hopPressed: true, hopHeld: true }
      }
      return {}
    })
    expect(h.hp).toBe(hp2)
  })

  it('the collapse warning runs its full length before terrain changes', () => {
    const s = bossRoom('heavy')
    const boss = s.boss!
    boss.hp = boss.maxHp * 0.3
    s.damageEnemy(boss, 1, ['impact'], { source: 'collision', kind: 'impact' })
    expect(boss.phase).toBe(3)
    run(s, seconds(BOSS_RULES.collapseWarning - 0.1))
    expect(s.solids.some((x) => x.breakable && x.alive)).toBe(true)
    expect(s.objectiveText()).toMatch(/floor/i)
    run(s, seconds(0.2))
    expect(s.solids.some((x) => x.breakable && x.alive)).toBe(false)
  })

  it('the stamp is telegraphed for 0.7 s before it can land', () => {
    const s = bossRoom('balanced', 1)
    const boss = s.boss!
    let telegraphTicks = 0
    let checked = false
    for (let i = 0; i < seconds(20); i++) {
      if (boss.attack === 'slam') telegraphTicks++
      s.step(input())
      if (boss.slamLive > 0 && !checked) {
        expect(telegraphTicks).toBeGreaterThanOrEqual(seconds(0.69))
        checked = true
      }
      if (boss.attack === 'none') telegraphTicks = 0
    }
    expect(checked).toBe(true)
  })
})
