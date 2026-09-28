import { COMPONENTS, COMPONENT_MAP } from './data/components'
import { ENEMIES, ENEMY_MAP } from './data/enemies'
import { ACHIEVEMENTS, FUSIONS, HEATS } from './data/meta'
import { ROOMS } from './data/rooms'
import { SYNERGIES } from './data/synergies'
import type { RoomTemplate, RoomType } from './types'
import { SLOTS } from './types'

const ROUTE_TYPES: RoomType[] = ['combat', 'traversal', 'challenge', 'elite', 'boss']

function finite(...values: (number | undefined)[]): boolean {
  return values.every((v) => v === undefined || Number.isFinite(v))
}

/** Solid tops a walker or the player can stand on under a point. */
function supportUnder(room: RoomTemplate, x: number, y: number): boolean {
  return room.platforms.some((p) => x >= p.x - 4 && x <= p.x + p.w + 4 && p.y >= y - 4)
}

/**
 * Static checks for all data-defined content. Geometry checks catch broken
 * rooms; they do not prove a room is fun or reachable, which the scenario
 * tests and playtests cover.
 */
export function validateContent(rooms: readonly RoomTemplate[] = ROOMS): string[] {
  const errors: string[] = []
  const unique = (label: string, ids: string[]) => {
    const seen = new Set<string>()
    for (const id of ids) {
      if (seen.has(id)) errors.push(`${label}: duplicate id ${id}`)
      seen.add(id)
    }
  }
  unique('component', COMPONENTS.map((c) => c.id))
  unique('enemy', ENEMIES.map((e) => e.id))
  unique('room', rooms.map((r) => r.id))
  unique('synergy', SYNERGIES.map((s) => s.id))
  unique('achievement', ACHIEVEMENTS.map((a) => a.id))

  for (const c of COMPONENTS) {
    if (!SLOTS.includes(c.slot)) errors.push(`${c.id}: bad slot ${c.slot}`)
    if (c.slot === 'ability' && !c.ability) errors.push(`${c.id}: ability slot without an ability`)
    if (c.evolvesFrom && COMPONENT_MAP[c.evolvesFrom]?.slot !== c.slot) errors.push(`${c.id}: evolvesFrom ${c.evolvesFrom} is missing or another slot`)
    if (c.pool === 'evolution' && !c.evolvesFrom) errors.push(`${c.id}: evolution without evolvesFrom`)
    if (c.pool === 'fusion' && !FUSIONS.some((f) => f.result === c.id)) errors.push(`${c.id}: fusion result with no recipe`)
    for (const m of c.modifiers) if (!Number.isFinite(m.value)) errors.push(`${c.id}: non-finite modifier ${m.stat}`)
    for (const e of c.effects) {
      for (const a of e.actions) {
        if (a.type === 'attract' && !['projectile', 'pickup', 'enemy'].includes(a.target)) errors.push(`${c.id}: unsupported attract target`)
      }
    }
  }
  for (const f of FUSIONS) {
    for (const id of f.requires) if (!COMPONENT_MAP[id]) errors.push(`fusion ${f.id}: unknown ingredient ${id}`)
    const result = COMPONENT_MAP[f.result]
    if (!result) errors.push(`fusion ${f.id}: unknown result ${f.result}`)
    else if (result.slot !== f.into) errors.push(`fusion ${f.id}: result slot ${result.slot} is not ${f.into}`)
    if (!f.requires.some((id) => COMPONENT_MAP[id]?.slot === f.into)) errors.push(`fusion ${f.id}: no ingredient sits in ${f.into}`)
  }
  for (const a of ACHIEVEMENTS) {
    if (a.unlocks && COMPONENT_MAP[a.unlocks]?.pool !== 'standard') errors.push(`achievement ${a.id}: unlocks unknown part ${a.unlocks}`)
    if (!(a.target > 0)) errors.push(`achievement ${a.id}: target must be positive`)
  }
  for (const e of ENEMIES) {
    if (e.split && !ENEMY_MAP[e.split.id]) errors.push(`enemy ${e.id}: splits into unknown ${e.split.id}`)
    if (!finite(e.hp, e.r, e.mass, e.speed, e.contact) || e.hp <= 0 || e.r <= 0) errors.push(`enemy ${e.id}: bad numbers`)
  }
  HEATS.forEach((h, i) => {
    if (h.id !== i) errors.push(`heat ${h.id}: ids must match their index`)
  })

  for (const type of ROUTE_TYPES) if (!rooms.some((r) => r.type === type)) errors.push(`no room template of type ${type}`)

  for (const r of rooms) {
    const at = `room ${r.id}`
    if (!finite(r.width, r.height, r.player.x, r.player.y, r.exit.x, r.exit.y, r.exit.w, r.exit.h) || r.width < 400 || r.height < 400) {
      errors.push(`${at}: bad dimensions`)
      continue
    }
    for (const p of r.platforms) if (!finite(p.x, p.y, p.w, p.h) || p.w <= 0 || (p.h ?? 22) <= 0) errors.push(`${at}: bad platform`)
    for (const h of r.hazards) if (!finite(h.x, h.y, h.w, h.h, h.dps, h.damage, h.period) || h.w <= 0 || h.h <= 0) errors.push(`${at}: bad hazard ${h.type}`)
    const inside = (x: number, y: number) => x > 0 && x < r.width && y > 0 && y < r.height
    if (!inside(r.player.x, r.player.y)) errors.push(`${at}: player starts outside the room`)
    if (!supportUnder(r, r.player.x, r.player.y)) errors.push(`${at}: nothing under the player start`)
    const ex = r.exit
    if (ex.x < 0 || ex.x + ex.w > r.width || ex.y < 0 || ex.y + ex.h > r.height) errors.push(`${at}: exit outside the room`)
    if (!supportUnder(r, ex.x + ex.w / 2, ex.y + ex.h - 10)) errors.push(`${at}: nothing under the exit`)
    for (const s of r.spawns) {
      const def = ENEMY_MAP[s.id]
      if (!def) {
        errors.push(`${at}: unknown construct ${s.id}`)
        continue
      }
      if (!inside(s.x, s.y)) errors.push(`${at}: ${s.id} spawns outside the room`)
      if (!def.flying && !supportUnder(r, s.x, s.y)) errors.push(`${at}: ${s.id} at ${s.x} has no floor beneath`)
      for (const h of r.hazards) {
        if (h.type === 'lava' && s.x > h.x && s.x < h.x + h.w && !def.flying && !r.platforms.some((p) => s.x >= p.x && s.x <= p.x + p.w && p.y < h.y)) {
          errors.push(`${at}: ${s.id} spawns over slag`)
        }
      }
    }
    if (r.type === 'combat' || r.type === 'elite') {
      if (!r.spawns.length) errors.push(`${at}: a ${r.type} room needs constructs`)
    }
    if (r.rules?.includes('survival') && !(r.survival && r.survival > 0)) errors.push(`${at}: survival room without a timer`)
    if (r.rules?.includes('speed-gate') && r.requires?.mobility !== 'speed') errors.push(`${at}: speed gate must declare requires.mobility = speed`)
    if (r.type === 'boss' && !r.platforms.some((p) => p.breakable)) errors.push(`${at}: the Colossus needs a breakable floor for phase three`)
  }
  return errors
}
