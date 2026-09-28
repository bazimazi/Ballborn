/**
 * Regression cases for the Phase 1 findings in docs/source-review-and-research.md.
 * Each describe block names the finding it protects.
 */
import { describe, expect, it } from 'vitest'
import { ROOM_MAP, ROOMS } from '../src/data/rooms'
import { COMPONENT_MAP } from '../src/data/components'
import { FUSIONS } from '../src/data/meta'
import { applyEventChoice, eventCandidates, rollEvent } from '../src/events'
import {
  completeNode, createRun, currentBuild, enterNode, makeShop, restoreRun, selectableNodes, serializeRun, type RunState,
} from '../src/run'
import { BACKUP_KEY, defaultSave, loadSave, memoryStore, SAVE_KEY, sanitizeSave, writeSave, type SaveData } from '../src/save'
import type { HitRecord, Slot } from '../src/types'
import { buyItem, commitRoom, equip, evolve, fuse, transact, TransactionError } from '../src/transactions'
import { mulberry32 } from '../src/util'
import { build, BUILDS, input, run, seconds, sim } from './helpers'

function runWith(ids: Partial<Record<Slot, string | null>>, seed = 123): RunState {
  const r = createRun(0, false, seed)
  r.ids = { ...r.ids, ...ids }
  r.hp = currentBuild(r).stats.maxHp
  return r
}

describe('1. constructs outside the room or in slag cannot block the exit', () => {
  it('moving-yard (seed 123, no input, ten seconds): no living construct is below the room', () => {
    const s = sim('moving-yard', build('balanced'), { god: true, seed: 123 })
    run(s, seconds(10))
    for (const e of s.enemies) if (e.alive) expect(e.y).toBeLessThan(s.room.height)
  })

  it('a construct that falls out of the world dies, drops loot, and the room can clear', () => {
    const s = sim('ignition-hall', build('balanced'), { god: true })
    const e = s.enemies[0]!
    e.y = s.room.height + 200
    s.step(input())
    expect(e.alive).toBe(false)
    expect(s.pickups.some((p) => p.kind === 'cinder')).toBe(true)
    run(s, 2)
    expect(s.exitOpen).toBe(true)
  })

  it('a walker that reaches slag melts', () => {
    const s = sim('shield-bridge', build('balanced'), { god: true })
    const e = s.enemies[0]!
    e.x = 540
    e.y = 660
    s.step(input())
    expect(e.alive).toBe(false)
  })

  it('every room: 30 idle seconds leave no living construct outside the room', () => {
    for (const room of ROOMS) {
      const s = sim(room, build('balanced'), { god: true, seed: 7 })
      run(s, seconds(30))
      for (const e of s.enemies) {
        if (!e.alive) continue
        expect(e.y, `${room.id} ${e.defId}`).toBeLessThan(room.height)
        expect(e.x, `${room.id} ${e.defId}`).toBeGreaterThan(0)
        expect(e.x, `${room.id} ${e.defId}`).toBeLessThan(room.width)
      }
    }
  })
})

describe('2. routes are exclusive and only move forward', () => {
  it('seed 123: finishing n0-0 closes n0-1 for good', () => {
    const r = createRun(0, false, 123)
    expect(selectableNodes(r).map((n) => n.id)).toEqual(['n0-0', 'n0-1'])
    expect(enterNode(r, 'n0-0')).not.toBeNull()
    expect(completeNode(r)).not.toBeNull()
    const open = selectableNodes(r).map((n) => n.id)
    expect(open).not.toContain('n0-1')
    const n00 = r.nodes.find((n) => n.id === 'n0-0')!
    for (const id of open) expect(n00.next).toContain(id)
    expect(enterNode(r, 'n0-1')).toBeNull()
  })

  it('a node completes (and rewards) at most once', () => {
    const r = createRun(0, false, 5)
    enterNode(r, 'n0-0')
    expect(completeNode(r)).not.toBeNull()
    expect(completeNode(r)).toBeNull()
    expect(r.roomsCleared).toBe(1)
  })

  it('100 seeds: every legal path reaches the boss, one node per depth, along edges', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const r = createRun(0, false, seed)
      const pick = mulberry32(seed * 31)
      const path: string[] = []
      let guard = 0
      while (selectableNodes(r).length && guard++ < 20) {
        const options = selectableNodes(r)
        if (path.length) {
          const prev = r.nodes.find((n) => n.id === path[path.length - 1])!
          for (const o of options) expect(prev.next).toContain(o.id)
        }
        const node = options[Math.floor(pick() * options.length)]!
        expect(enterNode(r, node.id)).not.toBeNull()
        // Nothing else is enterable while inside a node.
        expect(selectableNodes(r)).toEqual([])
        expect(completeNode(r)).not.toBeNull()
        path.push(node.id)
      }
      const depths = path.map((id) => r.nodes.find((n) => n.id === id)!.depth)
      expect(depths).toEqual([0, 1, 2, 3, 4, 5])
      expect(r.nodes.find((n) => n.id === path[5])!.type).toBe('boss')
      expect(r.roomsCleared).toBe(6)
    }
  })
})

describe('3. room state is instance-local; content is frozen', () => {
  it('the Colossus floor collapse never edits the template', () => {
    const before = JSON.stringify(ROOM_MAP['colossus-hold'])
    const s = sim('colossus-hold', build('heavy'), { god: true })
    const lavaBefore = s.hazards.filter((h) => h.type === 'lava').length
    const boss = s.boss!
    boss.hp = boss.maxHp * 0.3
    s.damageEnemy(boss, 1, ['impact'], { source: 'collision', kind: 'impact' })
    expect(boss.phase).toBe(3)
    expect(boss.collapse).toBeGreaterThan(0)
    // The floor holds during the visible warning.
    expect(s.solids.filter((x) => x.breakable).every((x) => x.alive)).toBe(true)
    run(s, seconds(2))
    expect(s.solids.filter((x) => x.breakable).every((x) => !x.alive)).toBe(true)
    expect(s.hazards.filter((h) => h.type === 'lava').length).toBeGreaterThan(lavaBefore)
    expect(JSON.stringify(ROOM_MAP['colossus-hold'])).toBe(before)
    expect(sim('colossus-hold').hazards.length).toBe(ROOM_MAP['colossus-hold']!.hazards.length)
  })

  it('content definitions are frozen', () => {
    expect(Object.isFrozen(ROOM_MAP['colossus-hold']!.hazards)).toBe(true)
    expect(Object.isFrozen(COMPONENT_MAP['heavy-core']!.modifiers)).toBe(true)
    expect(() => (ROOM_MAP['colossus-hold']!.hazards as unknown[]).push({})).toThrow()
  })
})

function clearRoom(s: ReturnType<typeof sim>): void {
  for (const e of s.enemies) s.damageEnemy(e, 9999, ['impact'], { source: 'collision', kind: 'impact' })
  s.step(input())
  const ex = s.room.exit
  s.ball.x = ex.x + ex.w / 2
  s.ball.y = ex.y + ex.h - s.ball.r - 2
  s.ball.vx = 0
  s.ball.vy = 0
  s.step(input())
}

describe('4. one authoritative, once-only room commit', () => {
  it('room recovery survives: sync first, then heal', () => {
    const r = createRun(0, false, 123)
    enterNode(r, 'n0-0')
    const s = sim('ignition-hall', currentBuild(r), { hp: 50 })
    clearRoom(s)
    expect(s.ended).toBe('clear')
    const hpAtExit = s.hp
    const commit = commitRoom(r, s)
    expect(commit?.kind).toBe('clear')
    const max = currentBuild(r).stats.maxHp
    expect(r.hp).toBeCloseTo(Math.min(max, hpAtExit + Math.max(6, max * 0.1)), 5)
    expect(r.hp).toBeGreaterThan(hpAtExit)
    expect(commitRoom(r, s)).toBeNull()
  })

  it('a room still in play cannot be committed', () => {
    const r = createRun(0, false, 1)
    const s = sim('ignition-hall')
    expect(commitRoom(r, s)).toBeNull()
  })

  it('death is terminal: no heal, no clear, no more ticks', () => {
    const s = sim('ignition-hall', build('balanced'), { hp: 5 })
    s.hurt(50, 'projectile')
    expect(s.ended).toBe('dead')
    s.heal(100)
    s.addShield(20)
    expect(s.hp).toBe(0)
    expect(s.shield).toBe(0)
    const tick = s.tick
    s.exitOpen = true
    const ex = s.room.exit
    s.ball.x = ex.x + ex.w / 2
    s.step(input())
    expect(s.tick).toBe(tick)
    expect(s.ended).toBe('dead')
    const r = createRun(0, false, 1)
    const commit = commitRoom(r, s)
    expect(commit?.kind).toBe('death')
    expect(r.hp).toBe(0)
  })

  it('clear and death are mutually exclusive in one tick', () => {
    const s = sim('ignition-hall')
    clearRoom(s)
    expect(s.ended).toBe('clear')
    s.hurt(999, 'projectile')
    expect(s.ended).toBe('clear')
  })
})

describe('5. one damage pipeline for every source', () => {
  const armored = () => build({ ...BUILDS.balanced!, shell: 'armored-shell' })

  it('armor reduces projectiles (the reported 20 → 20 case)', () => {
    const b = armored()
    expect(b.stats.damageReduction).toBeCloseTo(0.28, 5)
    const s = sim('ignition-hall', b)
    const before = s.hp
    expect(s.hurt(20, 'projectile')).toBeCloseTo(14.4, 5)
    expect(before - s.hp).toBeCloseTo(14.4, 5)
  })

  it('recoil is governed by selfDamage, not armor (documented exception)', () => {
    const s = sim('ignition-hall', armored())
    expect(s.hurt(10, 'recoil')).toBeCloseTo(10, 5)
  })

  it('shield absorbs after armor; the hit window blocks a second hit but not slag', () => {
    const s = sim('ignition-hall')
    s.addShield(10)
    expect(s.hurt(15, 'projectile')).toBeCloseTo(5, 5)
    expect(s.shield).toBe(0)
    expect(s.hurt(15, 'projectile')).toBe(0)
    expect(s.hurt(3, 'lava')).toBeCloseTo(3, 5)
  })

  it('dash phase ignores projectiles but not slag or stamps', () => {
    const s = sim('ignition-hall')
    s.phase = 0.1
    expect(s.hurt(20, 'projectile')).toBe(0)
    expect(s.hurt(2, 'lava')).toBeGreaterThan(0)
    expect(s.hurt(10, 'crusher')).toBeGreaterThan(0)
  })

  it('Second Wind catches an otherwise lethal hit once per room, from slag too', () => {
    const b = build({ ...BUILDS.balanced!, passive: 'second-wind' })
    const s = sim('ignition-hall', b, { hp: 3 })
    s.hurt(8, 'lava')
    expect(s.ended).toBe('play')
    expect(s.hp).toBeGreaterThan(20)
    expect(s.shield).toBe(24)
    s.hp = 2
    s.shield = 0
    s.hurt(8, 'lava')
    expect(s.ended).toBe('dead')
    expect(s.cause).toBe('lava')
  })

  it('falling out of the room is instant; the lab catches it', () => {
    const s = sim('ignition-hall')
    s.hurt(1, 'pit')
    expect(s.ended).toBe('dead')
    expect(s.taken.pit).toBeGreaterThan(0)
    const lab = sim('ignition-hall', build('balanced'), { god: true })
    lab.hurt(1, 'pit')
    expect(lab.ended).toBe('play')
  })

  it('the damage assist scales every non-instant source', () => {
    const s = sim('ignition-hall', build('balanced'), { assist: 0.5 })
    expect(s.hurt(20, 'projectile')).toBeCloseTo(10, 5)
  })

  it('damage taken is recorded per source', () => {
    const s = sim('ignition-hall')
    s.hurt(10, 'spikes')
    expect(s.taken.spikes).toBeCloseTo(10, 5)
  })
})

describe('6. loot rests on real surfaces and is collected without waiting', () => {
  const drop = (s: ReturnType<typeof sim>, x: number, y: number, kind: 'cinder' | 'heal' = 'cinder') => {
    const p = { x, y, vx: 0, vy: 0, r: 7, kind, value: kind === 'cinder' ? 4 : 12, life: kind === 'cinder' ? Infinity : 12, homing: false }
    s.pickups.push(p)
    return p
  }

  it('a cinder settles on the floor, not beneath it, and can be rolled over', () => {
    const s = sim('ignition-hall', build('balanced'), { god: true })
    s.enemies[0]!.x = 1500
    const p = drop(s, 300, 560)
    run(s, seconds(1.5))
    expect(p.y).toBeLessThanOrEqual(608 - 6)
    expect(p.y).toBeGreaterThan(590)
    s.ball.x = p.x
    s.ball.y = 608 - s.ball.r - 1
    s.step(input())
    expect(s.cinderPocket).toBe(4)
  })

  it('a healing drop restores integrity when collected', () => {
    const s = sim('ignition-hall', build('balanced'), { god: true, hp: 40 })
    s.enemies[0]!.x = 1500
    const p = drop(s, 400, 560, 'heal')
    run(s, seconds(1))
    s.ball.x = p.x
    s.ball.y = p.y
    const before = s.hp
    s.step(input())
    expect(s.hp).toBeCloseTo(before + 12, 0)
  })

  it('loot rides a moving platform and floats on slag', () => {
    const s = sim('moving-yard', build('balanced'), { god: true })
    const onPlatform = drop(s, 620, 540)
    const onSlag = drop(s, 700, 600)
    run(s, seconds(2))
    const plat = s.solids.find((x) => x.move?.axis === 'x')!
    expect(onPlatform.x).toBeGreaterThanOrEqual(plat.x - 8)
    expect(onPlatform.x).toBeLessThanOrEqual(plat.x + plat.w + 8)
    expect(onPlatform.y).toBeLessThan(plat.y)
    const lava = s.hazards.find((h) => h.type === 'lava')!
    if (onSlag.x > lava.x && onSlag.x < lava.x + lava.w) expect(onSlag.y).toBeLessThanOrEqual(lava.y)
  })

  it('once the gate opens, every drop flies to the ball; anything left is credited', () => {
    const s = sim('ignition-hall', build('balanced'), { god: true })
    drop(s, 1400, 560)
    drop(s, 900, 560)
    for (const e of s.enemies) s.damageEnemy(e, 9999, ['impact'], { source: 'collision', kind: 'impact' })
    run(s, seconds(2.5))
    expect(s.pickups.filter((p) => p.life > 0).length).toBe(0)
    expect(s.cinderPocket).toBeGreaterThanOrEqual(12)
    const t = sim('ignition-hall', build('balanced'), { god: true })
    drop(t, 1400, 100)
    t.collectRemaining()
    expect(t.cinderPocket).toBe(4)
  })
})

describe('7. kills are attributed per event, not by sticky flags', () => {
  it('a nonlethal reflected shot does not label a later ram kill', () => {
    const kills: HitRecord[] = []
    const s = sim('ignition-hall', build('balanced'), { god: true }, { onKill: (r) => kills.push(r) })
    const e = s.enemies[0]!
    s.bullets.push({ x: e.x, y: e.y, vx: 0, vy: 0, r: 6, damage: 5, life: 1, friendly: true, reflected: true, color: '#fff' })
    s.step(input())
    expect(e.alive).toBe(true)
    expect(s.dealt.reflect).toBeGreaterThan(0)
    s.damageEnemy(e, 999, ['impact'], { source: 'collision', kind: 'impact' })
    expect(kills).toHaveLength(1)
    expect(kills[0]!.source).toBe('collision')
  })

  it('an Air Burst kill is credited to Air Burst, a Slam kill to Ground Slam', () => {
    const burstKills: HitRecord[] = []
    const b = build({ ...BUILDS.balanced!, ability: 'air-burst' })
    const s = sim('ignition-hall', b, { god: true }, { onKill: (r) => burstKills.push(r) })
    const e = s.enemies[0]!
    run(s, seconds(1))
    e.hp = 5
    e.x = s.ball.x + 30
    e.y = s.ball.y
    s.step(input({ abilityPressed: true }))
    expect(burstKills[0]?.ability).toBe('burst')

    const slamKills: HitRecord[] = []
    const t = sim('ignition-hall', build({ ...BUILDS.balanced!, ability: 'ground-slam' }), { god: true }, { onKill: (r) => slamKills.push(r) })
    const g = t.enemies[0]!
    run(t, seconds(1))
    g.hp = 5
    g.x = t.ball.x + 60
    t.ball.y = 300
    t.ball.vy = 0
    t.step(input({ abilityPressed: true }))
    run(t, seconds(1))
    expect(slamKills[0]?.ability).toBe('slam')
    expect(slamKills[0]?.source).toBe('ability')
  })

  it('effect and status damage count in the run statistics', () => {
    const s = sim('ignition-hall', build('fire'), { god: true })
    const e = s.enemies[0]!
    s.applyStatus(e, 'burn', 2, 10)
    run(s, seconds(1))
    expect(s.dealt.status).toBeGreaterThan(5)
    s.explode(e.x, e.y, 80, 5, false)
    expect(s.dealt.effect).toBeGreaterThan(0)
  })

  it('records carry effective damage and overkill separately', () => {
    const records: HitRecord[] = []
    const s = sim('ignition-hall', build('balanced'), {}, { onHit: (r) => records.push(r) })
    const e = s.enemies[0]!
    const hp = e.hp
    s.damageEnemy(e, hp + 40, ['impact'], { source: 'collision', kind: 'impact' })
    expect(records[0]!.effective).toBeCloseTo(hp, 5)
    expect(records[0]!.overkill).toBeCloseTo(40, 5)
    expect(records[0]!.lethal).toBe(true)
  })
})

describe('8. event text and outcomes agree', () => {
  const save = (): SaveData => {
    const s = defaultSave()
    s.unlocked = Object.keys(COMPONENT_MAP).filter((id) => COMPONENT_MAP[id]!.pool === 'standard')
    return s
  }

  it('Overcharge: leaving it pays exactly the 18 cinders it promises', () => {
    const r = createRun(0, false, 123)
    const ev = eventCandidates(r, save()).find((e) => e.id === 'overcharge')!
    const decline = ev.choices.find((c) => c.id === 'decline')!
    expect(decline.detail).toContain('18')
    const before = r.cinders
    applyEventChoice(r, save(), ev, 'decline')
    expect(r.cinders - before).toBe(18)
  })

  it('every cinder outcome in every event pays what its card says', () => {
    const loadouts: Partial<Record<Slot, string>>[] = [
      {},
      { impact: 'fire-impact' },
      { core: 'heavy-core', impact: 'crush-impact' },
      { shell: 'rubber-shell', momentum: 'rebound-engine' },
    ]
    for (const ids of loadouts) {
      const events = eventCandidates(runWith(ids), save())
      for (const ev of events) {
        for (const c of ev.choices) {
          const r = runWith(ids)
          const fresh = eventCandidates(r, save()).find((e) => e.id === ev.id)!
          const choice = fresh.choices.find((x) => x.id === c.id)!
          const cinders = choice.outcomes.filter((o) => o.kind === 'cinders').reduce((n, o) => n + (o.kind === 'cinders' ? o.amount : 0), 0)
          if (cinders) expect(choice.detail).toContain(String(cinders))
          const before = r.cinders
          const res = applyEventChoice(r, save(), fresh, c.id)
          if ('error' in res) continue
          expect(r.cinders - before, `${ev.id}/${c.id}`).toBe(cinders)
        }
      }
    }
  })

  it('the Annealing is free once, then needs an ember', () => {
    const sv = save()
    const r = runWith({ impact: 'fire-impact' })
    const ev = eventCandidates(r, sv).find((e) => e.id === 'anneal')!
    expect(ev.choices.find((c) => c.id === 'inferno')!.detail).toContain('Free')
    applyEventChoice(r, sv, ev, 'inferno')
    expect(r.ids.impact).toBe('inferno-impact')
    expect(r.annealFreeUsed).toBe(true)
    expect(r.commonBroken).toBe(true)
    const r2 = runWith({ shell: 'rubber-shell', impact: 'fire-impact' })
    r2.annealFreeUsed = true
    r2.eventsSeen = []
    const ev2 = eventCandidates(r2, sv).find((e) => e.id === 'anneal')!
    expect(ev2.choices.find((c) => c.id === 'rubber')!.disabled).toBeTruthy()
    expect('error' in applyEventChoice(r2, sv, ev2, 'rubber')).toBe(true)
    sv.embers = 2
    const ev3 = eventCandidates(r2, sv).find((e) => e.id === 'anneal')!
    applyEventChoice(r2, sv, ev3, 'rubber')
    expect(sv.embers).toBe(1)
    expect(r2.ids.shell).toBe('reinforced-rubber')
  })

  it('the Crucible shows and performs the consumed slot', () => {
    const sv = save()
    const r = runWith({ core: 'heavy-core', impact: 'crush-impact' })
    const ev = eventCandidates(r, sv).find((e) => e.id === 'crucible')!
    const fuseChoice = ev.choices.find((c) => c.id === 'fuse')!
    expect(fuseChoice.detail).toContain('impact slot is left empty')
    expect(fuseChoice.detail).toContain('24 integrity')
    const res = applyEventChoice(r, sv, ev, 'fuse')
    expect('error' in res).toBe(false)
    expect(r.ids.core).toBe('singularity-mass')
    expect(r.ids.impact).toBeNull()
  })

  it('a choice not on the card is refused, and events do not repeat in a run', () => {
    const r = createRun(0, false, 9)
    const ev = rollEvent(r, save())
    expect('error' in applyEventChoice(r, save(), ev, 'nonsense')).toBe(true)
    const next = rollEvent(r, save())
    expect(next.id).not.toBe(ev.id)
  })
})

describe('9. one equipment transaction for every path', () => {
  it('keeps the integrity ratio and clamps energy', () => {
    const r = createRun(0, false, 1)
    const max = currentBuild(r).stats.maxHp
    r.hp = max / 2
    equip(r, null, 'heavy-core')
    expect(r.hp / currentBuild(r).stats.maxHp).toBeCloseTo(0.5, 5)
  })

  it('rejects unknown parts and wrong slots', () => {
    const r = createRun(0, false, 1)
    expect(() => transact(r, null, { core: 'rubber-shell' }, ['standard'])).toThrow(TransactionError)
    expect(() => equip(r, null, 'nope')).toThrow(TransactionError)
    expect(() => equip(r, null, 'singularity-mass', ['standard'])).toThrow(TransactionError)
  })

  it('tracks rarity on evolutions and fusions, and reports lost reactions', () => {
    const r = runWith({ impact: 'fire-impact' })
    expect(r.commonBroken).toBe(false)
    evolve(r, null, 'fire-impact', 'inferno-impact')
    expect(r.commonBroken).toBe(true)
    const h = runWith({ shell: 'rubber-shell', impact: 'lightning-impact' })
    const report = equip(h, null, 'spiked-shell')
    expect(report.lost).toContain('Storm Bounce')
    expect(report.gained).toEqual([])
    const f = runWith({ core: 'heavy-core', impact: 'crush-impact' })
    const fr = fuse(f, null, FUSIONS.find((x) => x.id === 'singularity')!)
    expect(fr.removed.map((c) => c.id)).toContain('crush-impact')
    expect(f.commonBroken).toBe(true)
  })

  it('a shop item sells once and needs the cinders', () => {
    const sv = defaultSave()
    const r = createRun(0, false, 2)
    const items = makeShop(r, sv)
    const heal = items.find((i) => i.kind === 'heal')!
    expect(buyItem(r, sv, heal)).toBeNull()
    r.cinders = 1000
    expect(buyItem(r, sv, heal)).not.toBeNull()
    expect(buyItem(r, sv, heal)).toBeNull()
    expect(r.cinders).toBe(1000 - heal.cost)
  })
})

describe('10. saves are validated, migrated, backed up, and never crash the game', () => {
  it('malformed data is kept in the backup slot, not overwritten', () => {
    const store = memoryStore({ [SAVE_KEY]: '{not json' })
    const res = loadSave(store)
    expect(res.status).toBe('recovered')
    expect(store.data[BACKUP_KEY]).toBe('{not json')
    expect(store.data[SAVE_KEY]).toBe('{not json')
  })

  it('a newer save version is left alone', () => {
    const raw = JSON.stringify({ version: 99, scrap: 5 })
    const store = memoryStore({ [SAVE_KEY]: raw })
    expect(loadSave(store).status).toBe('recovered')
    expect(store.data[SAVE_KEY]).toBe(raw)
  })

  it('v1 saves migrate, keep progress, drop unknown IDs, and clamp numbers', () => {
    const v1 = {
      version: 1, scrap: 42, embers: 3, unlocked: ['glass-core', 'not-a-part', 7], discoveredSynergies: ['wildfire', 'bogus'],
      heatUnlocked: 9, settings: { reducedEffects: true, sfx: 'loud', bindings: { left: 'KeyQ', right: '<script>' } },
      stats: { runs: 4, wins: -2 }, achievements: { ignition: { progress: 1, done: true } },
    }
    const store = memoryStore({ [SAVE_KEY]: JSON.stringify(v1) })
    const { save, status } = loadSave(store)
    expect(status).toBe('migrated')
    expect(store.data[BACKUP_KEY]).toBe(JSON.stringify(v1))
    expect(save.version).toBe(2)
    expect(save.scrap).toBe(42)
    expect(save.embers).toBe(3)
    expect(save.unlocked).toContain('glass-core')
    expect(save.unlocked).not.toContain('not-a-part')
    expect(save.discoveredSynergies).toEqual(['wildfire'])
    expect(save.heatUnlocked).toBe(3)
    expect(save.settings.sfx).toBe(0.75)
    expect(save.settings.flashes).toBe(false)
    expect(save.settings.bindings.left).toBe('KeyQ')
    expect(save.settings.bindings.right).toBe('KeyD')
    expect(save.stats.wins).toBe(0)
    expect(save.achievements.ignition!.done).toBe(true)
  })

  it('unavailable storage is reported, not thrown', () => {
    const broken = { get: () => null, set: () => false, remove: () => undefined }
    expect(writeSave(defaultSave(), broken)).toBe(false)
    expect(loadSave(broken).status).toBe('fresh')
    expect(() => sanitizeSave('text')).toThrow()
  })

  it('a run checkpoint round-trips, including the random stream', () => {
    const r = createRun(1, false, 4242)
    enterNode(r, 'n0-1')
    completeNode(r)
    r.cinders = 33
    r.rng()
    const restored = restoreRun(JSON.parse(JSON.stringify(serializeRun(r))))!
    expect(restored).not.toBeNull()
    expect(restored.cinders).toBe(33)
    expect(restored.nodes.map((n) => n.state)).toEqual(r.nodes.map((n) => n.state))
    expect(restored.rng()).toBe(r.rng())
    expect(restoreRun({ v: 1, seed: 'x' })).toBeNull()
    expect(restoreRun(null)).toBeNull()
  })
})
