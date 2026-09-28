import { COMPONENT_MAP } from './data/components'
import { FUSIONS, heatOf } from './data/meta'
import { buildFor, completeNode, currentBuild, currentNode, DEATH_SOURCES, HIT_SOURCES, keepRatio, noteRarity, salvageValue, synergyLabel, type Offer, type RunState, type ShopItem } from './run'
import type { SaveData } from './save'
import type { Simulation } from './sim'
import type { ComponentDef, FusionRecipe, Pool, RoomType, Slot } from './types'
import { SLOTS } from './types'

export interface EquipReport {
  added: ComponentDef[]
  removed: ComponentDef[]
  gained: string[]
  lost: string[]
  hpBefore: number
  hpAfter: number
  maxBefore: number
  maxAfter: number
}

export class TransactionError extends Error {}

/**
 * Apply a loadout change with one policy for every path (rewards, shop,
 * events, evolutions, fusions): integrity keeps its fraction of the maximum,
 * energy keeps its value up to the new maximum, rarity is tracked for every
 * fitted part, and gained and lost reactions are reported.
 */
export function transact(run: RunState, save: SaveData | null, changes: Partial<Record<Slot, string | null>>, pools: Pool[]): EquipReport {
  for (const slot of Object.keys(changes) as Slot[]) {
    if (!SLOTS.includes(slot)) throw new TransactionError(`Unknown slot ${slot}`)
    const id = changes[slot]
    if (id === null || id === undefined) continue
    const comp = COMPONENT_MAP[id]
    if (!comp) throw new TransactionError(`Unknown component ${id}`)
    if (comp.slot !== slot) throw new TransactionError(`${comp.name} does not fit the ${slot} slot`)
    if (!pools.includes(comp.pool)) throw new TransactionError(`${comp.name} cannot be fitted this way`)
  }
  const before = currentBuild(run)
  const beforeIds = { ...run.ids }
  const nextIds = { ...run.ids, ...changes }
  const after = buildFor(nextIds, run.mods)
  const hpBefore = run.hp
  run.ids = nextIds
  run.hp = keepRatio(run.hp, before.stats.maxHp, after.stats.maxHp)
  run.energy = Math.min(run.energy, after.stats.energyMax)
  const added: ComponentDef[] = []
  const removed: ComponentDef[] = []
  for (const slot of SLOTS) {
    if (beforeIds[slot] === nextIds[slot]) continue
    const was = beforeIds[slot] ? COMPONENT_MAP[beforeIds[slot]!] : undefined
    const now = nextIds[slot] ? COMPONENT_MAP[nextIds[slot]!] : undefined
    if (was) removed.push(was)
    if (now) {
      added.push(now)
      noteRarity(run, now.rarity)
    }
  }
  const had = new Set(before.synergies.map((s) => s.id))
  const has = new Set(after.synergies.map((s) => s.id))
  const label = (s: (typeof after.synergies)[number]) => (save ? synergyLabel(s, save) : s.name)
  const report: EquipReport = {
    added, removed,
    gained: after.synergies.filter((s) => !had.has(s.id)).map(label),
    lost: before.synergies.filter((s) => !has.has(s.id)).map(label),
    hpBefore, hpAfter: run.hp, maxBefore: before.stats.maxHp, maxAfter: after.stats.maxHp,
  }
  for (const c of added) {
    const out = removed.find((r) => r.slot === c.slot)
    run.decisions.push(out ? `${out.name} → ${c.name}` : `+ ${c.name}`)
  }
  for (const r of removed) if (!added.some((c) => c.slot === r.slot)) run.decisions.push(`${r.name} consumed`)
  if (save) for (const c of added) if (!save.discoveredComponents.includes(c.id)) save.discoveredComponents.push(c.id)
  return report
}

export function equip(run: RunState, save: SaveData | null, id: string, pools: Pool[] = ['standard']): EquipReport {
  const comp = COMPONENT_MAP[id]
  if (!comp) throw new TransactionError(`Unknown component ${id}`)
  return transact(run, save, { [comp.slot]: id }, pools)
}

export function fusionFor(run: RunState): FusionRecipe | undefined {
  const ids = new Set(Object.values(run.ids))
  return FUSIONS.find((f) => ids.has(f.requires[0]) && ids.has(f.requires[1]))
}

/** Slots a fusion empties (every ingredient slot except the one it fills). */
export function fusionConsumes(run: RunState, recipe: FusionRecipe): Slot[] {
  return SLOTS.filter((slot) => {
    const id = run.ids[slot]
    return !!id && recipe.requires.includes(id) && slot !== recipe.into
  })
}

export function fuse(run: RunState, save: SaveData | null, recipe: FusionRecipe): EquipReport {
  const ids = new Set(Object.values(run.ids))
  if (!ids.has(recipe.requires[0]) || !ids.has(recipe.requires[1])) throw new TransactionError(`${recipe.name} needs both ingredients`)
  const changes: Partial<Record<Slot, string | null>> = { [recipe.into]: recipe.result }
  for (const slot of fusionConsumes(run, recipe)) changes[slot] = null
  return transact(run, save, changes, ['fusion'])
}

export function evolve(run: RunState, save: SaveData | null, from: string, to: string): EquipReport {
  const target = COMPONENT_MAP[to]
  if (!target || target.evolvesFrom !== from) throw new TransactionError(`${to} does not evolve from ${from}`)
  if (run.ids[target.slot] !== from) throw new TransactionError(`${from} is not fitted`)
  return transact(run, save, { [target.slot]: to }, ['evolution'])
}

export function describeReport(r: EquipReport): string {
  const parts: string[] = []
  for (const c of r.added) parts.push(`${c.name} fitted.`)
  const empty = r.removed.filter((c) => !r.added.some((a) => a.slot === c.slot))
  for (const c of empty) parts.push(`${c.name} consumed; the ${c.slot} slot is empty.`)
  if (r.gained.length) parts.push(`Gained: ${r.gained.join(', ')}.`)
  if (r.lost.length) parts.push(`Lost: ${r.lost.join(', ')}.`)
  if (Math.round(r.maxAfter) !== Math.round(r.maxBefore)) parts.push(`Integrity ${Math.round(r.hpBefore)}/${Math.round(r.maxBefore)} → ${Math.round(r.hpAfter)}/${Math.round(r.maxAfter)}.`)
  return parts.join(' ')
}

export type RewardResult = { text: string; report?: EquipReport }

/** Resolve one reward card. The caller clears the offers so it cannot run twice. */
export function takeOffer(run: RunState, save: SaveData, offer: Offer): RewardResult {
  if (offer.kind === 'component' && offer.componentId) {
    const report = equip(run, save, offer.componentId, ['standard'])
    return { text: describeReport(report), report }
  }
  if (offer.kind === 'heal') {
    const max = currentBuild(run).stats.maxHp
    const before = run.hp
    run.hp = Math.min(max, run.hp + (offer.amount ?? 0))
    return { text: `Welded ${Math.round(run.hp - before)} integrity.` }
  }
  if (offer.kind === 'cinders') {
    run.cinders += offer.amount ?? 0
    return { text: `+${offer.amount ?? 0} cinders.` }
  }
  if (offer.kind === 'reroll') {
    run.rerolls += offer.amount ?? 1
    return { text: `+${offer.amount ?? 1} reroll token.` }
  }
  save.embers += offer.amount ?? 1
  return { text: `+${offer.amount ?? 1} ember (kept between runs).` }
}

export function takeSalvage(run: RunState): RewardResult {
  const n = salvageValue(run.offerKind)
  run.cinders += n
  run.decisions.push('Kept the build')
  return { text: `Salvaged ${n} cinders. The ball stays as it is.` }
}

export function buyItem(run: RunState, save: SaveData, item: ShopItem): RewardResult | null {
  if (item.sold || run.cinders < item.cost) return null
  let result: RewardResult
  if (item.kind === 'component' && item.componentId) {
    const report = equip(run, save, item.componentId, ['standard'])
    result = { text: describeReport(report), report }
  } else if (item.kind === 'heal') {
    const max = currentBuild(run).stats.maxHp
    const before = run.hp
    run.hp = Math.min(max, run.hp + (item.amount ?? max * 0.45))
    result = { text: `Welded ${Math.round(run.hp - before)} integrity.` }
  } else if (item.kind === 'reroll') {
    run.rerolls += item.amount ?? 1
    result = { text: '+1 reroll token.' }
  } else {
    save.embers += item.amount ?? 1
    result = { text: '+1 ember.' }
  }
  run.cinders -= item.cost
  item.sold = true
  return result
}

export type RoomCommit =
  | { kind: 'clear'; regen: number; type: RoomType; roomDamage: number; cinders: number }
  | { kind: 'death'; cause: string; type: RoomType; roomDamage: number; cinders: number }

const committed = new WeakSet<Simulation>()

/**
 * The one authoritative end-of-room sequence: sync the run from the finished
 * simulation, collect loot, then apply room recovery. Runs at most once per
 * simulation and never for one that is still in play.
 */
export function commitRoom(run: RunState, sim: Simulation): RoomCommit | null {
  if (sim.ended === 'play' || committed.has(sim)) return null
  committed.add(sim)
  if (sim.ended === 'clear') sim.collectRemaining()
  const cinders = sim.takeCinders()
  run.cinders += cinders
  run.hp = sim.hp
  run.energy = sim.energy
  run.bestCombo = Math.max(run.bestCombo, sim.bestCombo)
  for (const k of HIT_SOURCES) run.dealtBySource[k] += sim.dealt[k]
  for (const k of DEATH_SOURCES) run.takenBySource[k] += sim.taken[k]
  const type = sim.room.type
  const node = currentNode(run)
  run.route.push({ nodeId: node?.id ?? 'tutorial', type, room: sim.room.name, taken: Math.round(sim.roomDamage), result: sim.ended === 'clear' ? 'clear' : 'death' })
  if (sim.ended === 'dead') return { kind: 'death', cause: sim.cause, type, roomDamage: sim.roomDamage, cinders }
  const heat = heatOf(run.heat)
  const max = sim.maxHp
  const before = run.hp
  run.hp = Math.min(max, run.hp + Math.max(6, max * heat.roomRecovery))
  return { kind: 'clear', regen: run.hp - before, type, roomDamage: sim.roomDamage, cinders }
}

/** Finish the current map node once. Elite nodes pay one ember into the save. */
export function finishNode(run: RunState, save: SaveData): { ember: boolean } | null {
  const node = completeNode(run)
  if (!node) return null
  if (node.type === 'elite') {
    save.embers += 1
    return { ember: true }
  }
  return { ember: false }
}

export function deathScrap(run: RunState): number {
  return 4 + run.roomsCleared * 3 + run.elitesKilled * 6
}

/** Leaving a run pays like a death, but nothing at all before the first room is cleared. */
export function abandonScrap(run: RunState): number {
  return run.roomsCleared > 0 ? deathScrap(run) : 0
}

export function victoryScrap(run: RunState): number {
  return 24 + run.roomsCleared * 4 + run.heat * 10
}
