import { describe, expect, it } from 'vitest'
import { validateContent } from '../src/content'
import { COMPONENTS } from '../src/data/components'
import { ROOMS } from '../src/data/rooms'
import { createRun, pickTemplate, roomAllowed } from '../src/run'
import { build, BUILDS, run, seconds, sim } from './helpers'

describe('content contracts', () => {
  it('all data passes the validator', () => {
    expect(validateContent()).toEqual([])
  })

  it('the validator catches broken rooms', () => {
    const bad = structuredClone(ROOMS[2]!)
    bad.id = 'bad-room'
    bad.spawns = [{ id: 'grunt', x: 99999, y: 500 }, { id: 'ghost', x: 500, y: 500 }]
    bad.exit = { x: 5000, y: 0, w: 10, h: 10 }
    bad.width = Number.NaN
    const errors = validateContent([...ROOMS, bad])
    expect(errors.some((e) => e.includes('bad-room'))).toBe(true)
    const bad2 = structuredClone(ROOMS[2]!)
    bad2.id = 'bad-2'
    bad2.spawns = [{ id: 'grunt', x: 500, y: 500 }, { id: 'ghost', x: 500, y: 500 }, { id: 'grunt', x: 3000, y: 500 }]
    bad2.exit = { x: 5000, y: 0, w: 10, h: 10 }
    const e2 = validateContent([...ROOMS, bad2])
    expect(e2).toContain('room bad-2: unknown construct ghost')
    expect(e2).toContain('room bad-2: grunt spawns outside the room')
    expect(e2).toContain('room bad-2: exit outside the room')
  })

  it('every room builds and runs for every representative build', () => {
    for (const room of ROOMS) {
      for (const name of Object.keys(BUILDS)) {
        const s = sim(room, build(name), { god: true })
        run(s, seconds(3))
        expect(Number.isFinite(s.ball.x) && Number.isFinite(s.ball.y), `${room.id}/${name}`).toBe(true)
      }
    }
  })

  it('heat and Molten Bath geysers stack and every one sits on solid floor', () => {
    for (const room of ROOMS.filter((r) => r.type === 'combat' || r.type === 'elite')) {
      const plain = sim(room, build('balanced'), { heat: 2 })
      const cursed = sim(room, build('balanced'), { heat: 2, curse: true })
      const count = (s: ReturnType<typeof sim>) => s.room.hazards.filter((h) => h.type === 'geyser').length
      expect(count(cursed), room.id).toBe(count(plain) + 2)
      for (const h of cursed.room.hazards.filter((g) => g.type === 'geyser')) {
        const cx = h.x + h.w / 2
        const floor = cursed.solids.some((p) => p.x <= cx && p.x + p.w >= cx && p.y >= h.y && p.y <= h.y + h.h + 30)
        const pit = cursed.room.hazards.some((l) => l.type === 'lava' && l.x <= cx && l.x + l.w >= cx)
        expect(floor && !pit, `${room.id}: geyser at ${Math.round(cx)}`).toBe(true)
      }
    }
    // The bath does not touch rooms it is not meant for.
    const boss = ROOMS.find((r) => r.type === 'boss')!
    expect(sim(boss, build('balanced'), { curse: true }).room.hazards.filter((h) => h.type === 'geyser').length).toBe(0)
  })

  it('no room has a bottomless gap in its floor, and every stamp reaches the floor under it', () => {
    for (const room of ROOMS) {
      const floors = room.platforms.filter((p) => p.y >= 560 && !p.move)
      for (let x = 0; x <= room.width; x += 8) {
        const solid = floors.some((p) => p.x <= x && p.x + p.w >= x)
        const slag = room.hazards.some((h) => h.type === 'lava' && h.x <= x && h.x + h.w >= x)
        expect(solid || slag, `${room.id}: open pit at x=${x}`).toBe(true)
      }
      for (const h of room.hazards.filter((c) => c.type === 'crusher')) {
        const under = floors.filter((p) => p.x < h.x + h.w && p.x + p.w > h.x)
        const top = Math.min(...under.map((p) => p.y))
        expect(h.y + (h.drop ?? 220) + h.h, `${room.id}: stamp at ${h.x}`).toBeGreaterThanOrEqual(top - 2)
      }
    }
  })

  it('rooms with mobility requirements are only offered to builds that meet them', () => {
    const heavy = build({ ...BUILDS.heavy!, ability: 'ground-slam' })
    for (const room of ROOMS.filter((r) => r.requires)) {
      if (room.requires?.mobility === 'air') expect(roomAllowed(room, heavy), room.id).toBe(false)
    }
    for (let seed = 1; seed < 60; seed++) {
      const r = createRun(0, false, seed)
      const t = pickTemplate(r, heavy, 'challenge')
      expect(roomAllowed(t, heavy), t.id).toBe(true)
    }
  })

  it('no component description promises an effect with no implementation (spot checks)', () => {
    const text = COMPONENTS.map((c) => c.description).join(' ')
    expect(text).not.toMatch(/panic/i)
  })
})
