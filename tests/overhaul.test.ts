import { describe, expect, it } from 'vitest'
import { ROOM_MAP, ROOMS } from '../src/data/rooms'
import { COMPONENT_MAP } from '../src/data/components'
import { dailyKey, dailySeed, gradeRoom, parTime, runScore } from '../src/grade'
import { banishOffer, createRun, generateMap, makeOffers, nearReactions, restoreRun, serializeRun, STARTER_IDS } from '../src/run'
import { defaultSave, sanitizeSave } from '../src/save'
import { commitRoom } from '../src/transactions'
import { mulberry32 } from '../src/util'
import { build, input, run, seconds, sim } from './helpers'

// The overhaul: longer route, room grades, run score, Daily Forge, banish and
// pity, reaction hints, elite affixes, and the Ram Hound.

describe('route', () => {
  it('runs seven rooms and the Colossus, with a build stop right before the hold', () => {
    const nodes = generateMap(mulberry32(7))
    const depth = Math.max(...nodes.map((n) => n.depth))
    expect(depth).toBe(7)
    expect(nodes.filter((n) => n.depth === 7).map((n) => n.type)).toEqual(['boss'])
    for (const n of nodes.filter((x) => x.depth === 6)) expect(['shop', 'treasure']).toContain(n.type)
    expect(nodes.filter((n) => n.type === 'elite').length).toBeGreaterThanOrEqual(2)
  })

  it('every elite and combat layer has enough templates to stay fresh', () => {
    expect(ROOMS.filter((r) => r.type === 'elite').length).toBeGreaterThanOrEqual(3)
  })
})

describe('room grades', () => {
  it('par grows with length and constructs, and survival rooms use their timer', () => {
    const short = ROOM_MAP['ignition-hall']!
    const kennel = ROOM_MAP['hound-kennel']!
    expect(parTime(kennel)).toBeGreaterThan(parTime(short))
    const survival = ROOMS.find((r) => r.rules?.includes('survival'))
    if (survival) expect(parTime(survival)).toBe((survival.survival ?? 20) + 4)
  })

  it('S needs pace and an untouched shell; C has neither', () => {
    expect(gradeRoom(10, 20, 0, 100)).toBe('S')
    expect(gradeRoom(10, 20, 8, 100)).toBe('A')
    expect(gradeRoom(25, 20, 0, 100)).toBe('A')
    expect(gradeRoom(25, 20, 8, 100)).toBe('B')
    expect(gradeRoom(40, 20, 40, 100)).toBe('C')
  })

  it('the clock stops when the gate opens, and a clear commits a grade and its cinders once', () => {
    const r = createRun(0, false, 5)
    r.nodes = generateMap(r.rng)
    const s = sim('ignition-hall')
    run(s, seconds(1))
    for (const e of s.enemies) s.damageEnemy(e, 1e6, ['impact'], { source: 'collision', kind: 'impact' })
    run(s, 2)
    expect(s.gateTime).not.toBeNull()
    const opened = s.gateTime!
    run(s, seconds(1))
    expect(s.gradeFacts().time).toBe(opened)
    s.ended = 'clear'
    const before = r.cinders
    const commit = commitRoom(r, s)
    expect(commit?.kind).toBe('clear')
    const g = commit?.kind === 'clear' ? commit.grade : null
    expect(g?.grade).toBe('S')
    expect(r.grades).toHaveLength(1)
    expect(r.cinders - before).toBeGreaterThanOrEqual(g!.bonus)
    expect(commitRoom(r, s)).toBeNull()
    expect(r.grades).toHaveLength(1)
  })

  it('an open traversal is timed to the exit', () => {
    const t = ROOMS.find((x) => x.type === 'traversal' && !x.spawns.length && !x.rules?.includes('survival'))
    if (!t) return
    const s = sim(t)
    expect(s.openAtStart).toBe(true)
    run(s, seconds(2))
    expect(s.gateTime).toBeNull()
    expect(s.gradeFacts().time).toBeCloseTo(s.time)
  })
})

describe('score and Daily Forge', () => {
  it('a win outscores a death on the same route, heat multiplies, and an assist is shown as a cut', () => {
    const base = { roomsCleared: 5, elitesKilled: 1, kills: 20, bestCombo: 8, grades: [], heat: 0, assist: 1 }
    const dead = runScore({ ...base, won: false }).total
    const won = runScore({ ...base, won: true }).total
    expect(won).toBeGreaterThan(dead)
    expect(runScore({ ...base, won: true, heat: 2 }).total).toBe(Math.round(won * 1.5))
    const assisted = runScore({ ...base, won: true, assist: 0.5 })
    expect(assisted.total).toBeLessThan(won)
    expect(assisted.lines.some((l) => l.label === 'Assist' && l.points < 0)).toBe(true)
  })

  it('the daily seed is stable for a date and different the next day', () => {
    const a = dailySeed('2026-11-13')
    expect(dailySeed('2026-11-13')).toBe(a)
    expect(dailySeed('2026-11-14')).not.toBe(a)
    expect(dailyKey(new Date(2026, 0, 5))).toBe('2026-01-05')
    // Same seed, same route.
    const m1 = createRun(0, false, a).nodes.map((n) => `${n.id}:${n.type}:${n.next.join('|')}`)
    const m2 = createRun(0, false, a).nodes.map((n) => `${n.id}:${n.type}:${n.next.join('|')}`)
    expect(m1).toEqual(m2)
  })

  it('daily and best-score fields survive a save round trip and reject junk', () => {
    const save = defaultSave()
    save.daily = { key: '2026-11-13', best: 4200, tries: 3, won: true }
    save.stats.bestScore = 5100
    const back = sanitizeSave(JSON.parse(JSON.stringify(save))).save
    expect(back.daily).toEqual(save.daily)
    expect(back.stats.bestScore).toBe(5100)
    expect(sanitizeSave({ ...save, daily: { key: 'yesterday', best: 1 } }).save.daily).toBeNull()
    // Saves from before the overhaul load with no daily record.
    const old = JSON.parse(JSON.stringify(save))
    delete old.daily
    delete old.stats.bestScore
    expect(sanitizeSave(old).save.daily).toBeNull()
    expect(sanitizeSave(old).save.stats.bestScore).toBe(0)
  })
})

describe('rewards: banish, pity, reaction hints', () => {
  const save = () => {
    const s = defaultSave()
    s.unlocked = Object.values(COMPONENT_MAP).filter((c) => c.pool === 'standard').map((c) => c.id)
    return s
  }

  it('a banished part leaves the pool for the run and the card is redrawn', () => {
    const sv = save()
    for (let seed = 1; seed <= 30; seed++) {
      const r = createRun(0, false, seed)
      const offers = makeOffers(r, sv, 'combat')
      const i = offers.findIndex((o) => o.kind === 'component')
      if (i < 0) continue
      const gone = offers[i]!.componentId!
      const next = banishOffer(r, sv, offers, i)!
      expect(next).not.toBeNull()
      expect(r.banishes).toBe(1)
      expect(next[i]!.componentId).not.toBe(gone)
      for (let k = 0; k < 20; k++) expect(makeOffers(r, sv, 'combat').some((o) => o.componentId === gone)).toBe(false)
    }
  })

  it('banish charges run out', () => {
    const sv = save()
    const r = createRun(0, false, 3)
    r.banishes = 0
    const offers = makeOffers(r, sv, 'combat')
    const i = offers.findIndex((o) => o.kind === 'component')
    expect(banishOffer(r, sv, offers, i)).toBeNull()
  })

  it('pity rises on screens without a rare part and resets when one shows', () => {
    const sv = save()
    const r = createRun(0, false, 11)
    let rose = false
    let reset = false
    for (let k = 0; k < 40; k++) {
      const before = r.rarePity
      const offers = makeOffers(r, sv, 'soft')
      const rare = offers.some((o) => o.rarity === 'rare' || o.rarity === 'epic' || o.rarity === 'legendary')
      if (rare) {
        expect(r.rarePity).toBe(0)
        if (before > 0) reset = true
      } else {
        expect(r.rarePity).toBe(Math.min(40, before + 6))
        rose = true
      }
    }
    expect(rose).toBe(true)
    expect(reset || r.rarePity > 0).toBe(true)
  })

  it('reaction hints name reactions this part brings to one part away, and never ones already active', () => {
    const sv = save()
    const r = createRun(0, false, 1)
    r.ids = { ...STARTER_IDS }
    // Fire Impact brings fire; Burning Detonation then needs only an explosive part.
    const hints = nearReactions(r, 'impact', 'fire-impact', sv)
    expect(hints.some((h) => /explosive/.test(h))).toBe(true)
    // Heavy Core with Crush Impact already fitted completes Mass Hammer: not a "near" hint.
    expect(nearReactions(r, 'core', 'heavy-core', sv).some((h) => /Mass Hammer|heavy \+ impact/.test(h))).toBe(false)
  })

  it('banishes, pity, grades, and the daily key survive a checkpoint', () => {
    const r = createRun(0, false, 77)
    r.banishes = 1
    r.banished = ['spiked-shell']
    r.rarePity = 12
    r.daily = '2026-11-13'
    r.grades = [{ room: 'Rivet Hall', grade: 'A', time: 18.2, par: 24, taken: 6, bonus: 6 }]
    r.rams = 10
    r.cleanRams = 7
    const back = restoreRun(JSON.parse(JSON.stringify(serializeRun(r))))!
    expect(back.banishes).toBe(1)
    expect(back.banished).toEqual(['spiked-shell'])
    expect(back.rarePity).toBe(12)
    expect(back.daily).toBe('2026-11-13')
    expect(back.grades).toEqual(r.grades)
    expect(back.cleanRams).toBe(7)
  })
})

describe('elite affixes', () => {
  it('every elite outside the lab carries one affix, the same one for the same seed', () => {
    for (const id of ['knight-foundry', 'plate-duet', 'charge-yard']) {
      const a = sim(id, build('balanced'), { seed: 42 })
      const b = sim(id, build('balanced'), { seed: 42 })
      const elites = a.enemies.filter((e) => e.elite)
      expect(elites.length).toBeGreaterThan(0)
      for (const e of elites) expect(e.affix).toBeTruthy()
      expect(a.enemies.map((e) => e.affix ?? '')).toEqual(b.enemies.map((e) => e.affix ?? ''))
      for (const e of a.enemies.filter((x) => !x.elite)) expect(e.affix).toBeUndefined()
    }
  })

  it('affixes change the construct the way their label says', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed < 60 && seen.size < 4; seed++) {
      const s = sim('knight-foundry', build('balanced'), { seed })
      const e = s.enemies.find((x) => x.elite)!
      seen.add(e.affix!)
      if (e.affix === 'hasted') expect(e.attackMul).toBeGreaterThan(1)
      if (e.affix === 'plated') expect(e.armorGate).toBeGreaterThan(14)
      if (e.affix === 'volatile') expect(e.explodeOnDeath).toBeTruthy()
      if (e.affix === 'magnetic') expect(e.pull).toBeGreaterThan(0)
    }
    expect(seen.size).toBe(4)
  })
})

describe('Ram Hound', () => {
  it('winds up visibly before it charges, and a wall leaves it dazed', () => {
    const s = sim('hound-kennel', build('balanced'), { god: true, hp: 9999 })
    const h = s.enemies.find((e) => e.defId === 'hound')!
    s.enemies = [h]
    h.x = 400
    h.y = 580
    h.attackCd = 0
    s.ball.x = 150
    s.ball.y = 580
    let wound = false
    let charged = false
    let dazed = false
    for (let i = 0; i < seconds(4); i++) {
      s.step(input())
      if (h.windup > 0 && !charged) wound = true
      if (h.charging > 0) {
        expect(wound).toBe(true)
        charged = true
      }
      if (charged && h.charging <= 0 && h.stun > 0) dazed = true
      if (s.done) break
    }
    expect(charged).toBe(true)
    expect(dazed).toBe(true)
  })

  it('meeting a charge head-on is a counter: more damage than the same ram into a standing hound', () => {
    const dealt = (charging: boolean) => {
      const s = sim('hound-kennel', build('balanced'), { god: true, hp: 9999 })
      const h = s.enemies.find((e) => e.defId === 'hound')!
      s.enemies = [h]
      h.hp = h.maxHp = 1e5
      h.x = 600
      h.y = 589
      h.vx = 0
      h.vy = 0
      h.facing = -1
      h.attackCd = 99
      h.charging = charging ? 0.5 : 0
      s.ball.x = 600 - s.ball.r - h.r - 2
      s.ball.y = 589
      s.ball.vx = 700
      s.ball.vy = 0
      const before = h.hp
      for (let i = 0; i < 6; i++) s.step(input({ x: 1 }))
      return before - h.hp
    }
    expect(dealt(true)).toBeGreaterThan(dealt(false) * 1.3)
  })
})
