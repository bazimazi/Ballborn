import { canFly, compileBuild, feelNumbers, rarityRank } from './build'
import { COMPONENT_MAP, COMPONENTS } from './data/components'
import { heatOf, OVERCHARGE } from './data/meta'
import { ROOM_MAP, roomsOf } from './data/rooms'
import { SYNERGIES } from './data/synergies'
import type { SaveData } from './save'
import type { CompiledBuild, ComponentDef, DamageSource, HitSource, Rarity, RoomTemplate, RoomType, RunMod, Slot, SynergyDef } from './types'
import { SLOTS } from './types'
import { choice, deriveSeed, mulberry32, shuffle, type Rng } from './util'

export type NodeState = 'locked' | 'open' | 'active' | 'done' | 'missed'

export interface MapNode {
  id: string
  depth: number
  index: number
  type: RoomType
  next: string[]
  state: NodeState
}

export interface RouteStep {
  nodeId: string
  type: RoomType
  room: string
  taken: number
  result: 'clear' | 'death' | 'menu'
}

export interface RunState {
  seed: number
  /** Route, reward, shop, and event stream. Room combat uses derived per-room seeds. */
  rng: Rng
  heat: number
  cinders: number
  rerolls: number
  hp: number
  energy: number
  ids: Record<Slot, string | null>
  mods: RunMod[]
  nodes: MapNode[]
  currentId: string | null
  /** Increments each time a room simulation starts; seeds that room's combat stream. */
  roomIndex: number
  roomsCleared: number
  elitesKilled: number
  bestCombo: number
  maxSpeed: number
  bestHit: number
  dealtBySource: Record<HitSource, number>
  takenBySource: Record<DamageSource, number>
  abilityUses: number
  kills: number
  reflectedKills: number
  slamKills: number
  templatesSeen: string[]
  eventsSeen: string[]
  annealFreeUsed: boolean
  curseNext: boolean
  tutorial: boolean
  tutorialStep: number
  commonBroken: boolean
  route: RouteStep[]
  decisions: string[]
  /** Reward table used for the current reward screen, so rerolls draw from the same table. */
  offerKind: OfferKind
}

export type OfferKind = 'combat' | 'elite' | 'soft' | 'treasure'

export interface Offer {
  kind: 'component' | 'heal' | 'cinders' | 'reroll' | 'ember'
  title: string
  description: string
  upside?: string
  downside?: string
  rarity?: Rarity
  slot?: Slot
  componentId?: string
  replaces?: { id: string; name: string } | null
  gained?: string[]
  lost?: string[]
  hp?: { before: number; after: number; maxBefore: number; maxAfter: number }
  energyMax?: { before: number; after: number }
  bars?: { label: string; current: number; next: number }[]
  hints: string[]
  amount?: number
}

export interface ShopItem {
  id: string
  kind: 'heal' | 'component' | 'reroll' | 'ember'
  title: string
  detail: string
  cost: number
  componentId?: string
  amount?: number
  sold: boolean
}

export const DEATH_SOURCES: DamageSource[] = ['contact', 'recoil', 'projectile', 'explosion', 'lava', 'spikes', 'crusher', 'geyser', 'boss', 'pit']
export const HIT_SOURCES: HitSource[] = ['collision', 'ability', 'effect', 'reflect', 'status', 'hazard']

const ROOM_TYPES: RoomType[] = ['combat', 'traversal', 'challenge', 'elite', 'event', 'treasure', 'shop', 'boss']

const PATTERN: RoomType[][] = [
  ['combat', 'traversal'],
  ['combat', 'challenge'],
  ['treasure', 'event', 'shop'],
  ['elite', 'combat'],
  ['event', 'challenge'],
  ['boss'],
]

export const STARTER_IDS: Readonly<Record<Slot, string>> = Object.freeze({
  core: 'balanced-core',
  shell: 'rubber-shell',
  momentum: 'momentum-engine',
  impact: 'crush-impact',
  ability: 'dash',
  passive: 'combo-engine',
})

export const RUN_MODS: Record<string, RunMod> = { [OVERCHARGE.id]: OVERCHARGE }

function zero<K extends string>(keys: readonly K[]): Record<K, number> {
  const out = {} as Record<K, number>
  for (const k of keys) out[k] = 0
  return out
}

export function randomSeed(): number {
  return (Math.random() * 1e9) >>> 0
}

export function createRun(heat: number, tutorial: boolean, seed = randomSeed()): RunState {
  const rng = mulberry32(seed)
  const ids = { ...STARTER_IDS } as Record<Slot, string | null>
  const build = compileBuild(ids, [])
  return {
    seed,
    rng,
    heat,
    cinders: 0,
    rerolls: 0,
    hp: build.stats.maxHp,
    energy: build.stats.energyMax,
    ids,
    mods: [],
    nodes: tutorial ? [] : generateMap(rng),
    currentId: null,
    roomIndex: 0,
    roomsCleared: 0,
    elitesKilled: 0,
    bestCombo: 0,
    maxSpeed: 0,
    bestHit: 0,
    dealtBySource: zero(HIT_SOURCES),
    takenBySource: zero(DEATH_SOURCES),
    abilityUses: 0,
    kills: 0,
    reflectedKills: 0,
    slamKills: 0,
    templatesSeen: [],
    eventsSeen: [],
    annealFreeUsed: false,
    curseNext: false,
    tutorial,
    tutorialStep: 0,
    commonBroken: false,
    route: [],
    decisions: [],
    offerKind: 'combat',
  }
}

export function generateMap(rng: () => number): MapNode[] {
  const nodes: MapNode[] = []
  PATTERN.forEach((layer, depth) => {
    layer.forEach((type, index) => {
      nodes.push({ id: `n${depth}-${index}`, depth, index, type, next: [], state: depth === 0 ? 'open' : 'locked' })
    })
  })
  const layers: MapNode[][] = []
  for (const n of nodes) {
    layers[n.depth] = layers[n.depth] ?? []
    layers[n.depth]!.push(n)
  }
  for (let d = 0; d < layers.length - 1; d++) {
    const a = layers[d]!
    const b = layers[d + 1]!
    for (const node of a) {
      const pool = b.filter((n) => b.length === 1 || Math.abs(n.index - node.index) <= 1)
      const list = pool.length ? pool : b
      link(node, choice(rng, list))
      if (rng() < 0.4) {
        const other = list.filter((n) => !node.next.includes(n.id))
        if (other.length) link(node, choice(rng, other))
      }
    }
    for (const node of b) {
      if (a.some((p) => p.next.includes(node.id))) continue
      const parents = a.filter((p) => Math.abs(p.index - node.index) <= 1)
      link(choice(rng, parents.length ? parents : a), node)
    }
  }
  return nodes
}

function link(a: MapNode, b: MapNode): void {
  if (!a.next.includes(b.id)) a.next.push(b.id)
}

/** Nodes the player may enter right now. Only ever the current node's outgoing edges. */
export function selectableNodes(run: RunState): MapNode[] {
  return run.nodes.filter((n) => n.state === 'open')
}

/**
 * Enter a node. Legal only for an open node. Every other open choice is
 * closed for good, so routes are exclusive and always move forward.
 */
export function enterNode(run: RunState, id: string): MapNode | null {
  const node = run.nodes.find((n) => n.id === id)
  if (!node || node.state !== 'open') return null
  for (const n of run.nodes) if (n.state === 'open' && n !== node) n.state = 'missed'
  node.state = 'active'
  run.currentId = id
  return node
}

/** Complete the active node exactly once and open its outgoing edges. */
export function completeNode(run: RunState): MapNode | null {
  const node = run.nodes.find((n) => n.id === run.currentId)
  if (!node || node.state !== 'active') return null
  node.state = 'done'
  run.roomsCleared++
  if (node.type === 'elite') run.elitesKilled++
  for (const id of node.next) {
    const nxt = run.nodes.find((n) => n.id === id)
    if (nxt && nxt.state === 'locked') nxt.state = 'open'
  }
  return node
}

export function currentNode(run: RunState): MapNode | undefined {
  return run.nodes.find((n) => n.id === run.currentId)
}

const buildCache = new Map<string, CompiledBuild>()

/** Compiled builds are immutable and cached by loadout, so per-frame reads are free. */
export function buildFor(ids: Record<Slot, string | null>, mods: RunMod[]): CompiledBuild {
  const key = `${SLOTS.map((s) => ids[s] ?? '').join(',')}|${mods.map((m) => m.id).join(',')}`
  let build = buildCache.get(key)
  if (!build) {
    build = compileBuild(ids, mods)
    if (buildCache.size > 96) buildCache.clear()
    buildCache.set(key, build)
  }
  return build
}

export function currentBuild(run: RunState): CompiledBuild {
  return buildFor(run.ids, run.mods)
}

export function roomSeed(run: RunState): number {
  return deriveSeed(run.seed, 'room', run.roomIndex)
}

export function pickTemplate(run: RunState, build: CompiledBuild, type: RoomType): RoomTemplate {
  if (type === 'boss') return ROOM_MAP['colossus-hold']!
  const all = roomsOf(type)
  if (!all.length) throw new Error(`No room templates of type ${type}`)
  const allowed = all.filter((t) => roomAllowed(t, build))
  const fresh = allowed.filter((t) => !run.templatesSeen.includes(t.id))
  const list = fresh.length ? fresh : allowed.length ? allowed : all
  return choice(run.rng, list)
}

export function roomAllowed(room: RoomTemplate, build: CompiledBuild): boolean {
  const need = room.requires?.mobility
  if (!need) return true
  const s = build.stats
  if (need === 'speed') return s.maxSpeed >= (room.gateSpeed ?? 760) + 30
  const kind = build.ability?.kind
  return kind === 'dash' || kind === 'burst' || canFly(s) || s.mass < 1.15
}

export interface RouteInfo {
  label: string
  risk: string
  reward: string
  advice: string
}

export function routeInfo(type: RoomType, build: CompiledBuild, run: RunState): RouteInfo {
  const s = build.stats
  const hpPct = run.hp / Math.max(1, s.maxHp)
  const heat = heatOf(run.heat)
  const low = hpPct < 0.45
  switch (type) {
    case 'elite':
      return {
        label: 'Elite',
        risk: low ? 'High, and you are cracked.' : 'High. Armored constructs.',
        reward: 'Rare-leaning part, 28 cinders, and an ember.',
        advice: s.mass * s.impact > 1.7 ? 'Your collisions can crack an elite.' : 'Elites are armored. Fire or a heavier impact will suffer less.',
      }
    case 'challenge':
      return {
        label: 'Challenge',
        risk: 'Medium. A rule bends the room.',
        reward: 'Standard part or supplies.',
        advice: s.mass > 1.7 && build.ability?.kind !== 'dash' && build.ability?.kind !== 'burst'
          ? 'Some trials want air. A heavy ball is only offered rooms it can finish.'
          : 'A trial of the room, not a brawl. Your movement decides it.',
      }
    case 'shop':
      return {
        label: 'Shop',
        risk: 'None.',
        reward: `Spend ${run.cinders} cinders on parts, a weld, or an ember.`,
        advice: low ? 'A patch here is cheaper than a death.' : 'Spend before the Colossus, or save it and regret it.',
      }
    case 'treasure':
      return { label: 'Treasure', risk: 'None.', reward: 'Free pick: a part, 36 cinders, or a large weld.', advice: low ? 'The weld is here if you need it.' : 'A free choice. Good when the build is bored.' }
    case 'event':
      return { label: 'Event', risk: 'Your call. Costs are shown before you pay.', reward: 'A bargain, or cinders to walk away.', advice: 'The foundry offers a bargain. Read the cost.' }
    case 'boss':
      return { label: 'Iron Colossus', risk: 'Final. Three phases.', reward: 'The run.', advice: 'The Colossus tests whatever you actually built.' }
    case 'traversal':
      return { label: 'Traversal', risk: 'Low. Hazards, few constructs.', reward: 'Common parts or supplies.', advice: 'A path of timing and bounce. Few things to break.' }
    default:
      return {
        label: 'Combat',
        risk: heat.geysers ? 'Medium. Slag geysers at this heat.' : 'Medium.',
        reward: 'Part, weld, cinders, or a reroll.',
        advice: 'A fight. Speed, mass, and the angle you choose.',
      }
  }
}

export function makeOffers(run: RunState, save: SaveData, kind: OfferKind): Offer[] {
  run.offerKind = kind
  if (run.tutorial && run.tutorialStep === 0) {
    return [
      componentOffer(run, save, 'heavy-core'),
      componentOffer(run, save, 'light-core'),
      { kind: 'heal', title: 'Keep the balance', description: 'Stay on the Balanced Core and weld 20 integrity.', hints: [], amount: 20 },
    ]
  }
  const offers: Offer[] = []
  const bias: Rarity[] = kind === 'elite' || kind === 'treasure'
    ? ['rare', 'epic', 'uncommon', 'rare']
    : kind === 'soft'
      ? ['common', 'uncommon', 'common']
      : ['common', 'uncommon', 'rare', 'common', 'uncommon']
  const wantSame = run.rng() < 0.55
  const pool = availableComponents(run, save)
  if (wantSame && pool.length >= 2) {
    const bySlot = new Map<Slot, ComponentDef[]>()
    for (const c of pool) {
      const list = bySlot.get(c.slot) ?? []
      list.push(c)
      bySlot.set(c.slot, list)
    }
    const slots = [...bySlot.entries()].filter(([, list]) => list.length >= 2)
    if (slots.length) {
      const [, list] = choice(run.rng, slots)
      for (const c of weighted(run.rng, list, bias).slice(0, 2)) offers.push(componentOffer(run, save, c.id))
    }
  }
  let spins = 0
  while (offers.length < 2 && spins < 12) {
    spins++
    const pick = weighted(run.rng, pool.filter((c) => !offers.some((o) => o.componentId === c.id)), bias)[0]
    if (!pick) break
    offers.push(componentOffer(run, save, pick.id))
  }
  const maxHp = currentBuild(run).stats.maxHp
  if (kind === 'treasure') {
    offers.push({ kind: 'cinders', title: 'Cinder cache', description: 'A pouch of run currency.', hints: [], amount: 36 })
    offers.push({ kind: 'heal', title: 'Weld', description: 'Restore a large share of integrity.', hints: [], amount: Math.round(maxHp * 0.5) })
    if (save.embers < 3 && run.rng() < 0.5) {
      offers[2] = { kind: 'ember', title: 'Ember', description: 'A rare coal that keeps between runs. Evolutions and fusions drink these.', hints: [], amount: 1 }
    }
    return offers.slice(0, 3)
  }
  while (offers.length < 3) {
    const roll = run.rng()
    if (roll < 0.45) offers.push({ kind: 'heal', title: 'Field weld', description: 'Restore integrity now.', hints: [], amount: Math.round(maxHp * 0.34) })
    else if (roll < 0.8) offers.push({ kind: 'cinders', title: 'Cinders', description: 'Spend these in the shop.', hints: [], amount: kind === 'elite' ? 28 : 18 })
    else offers.push({ kind: 'reroll', title: 'Reroll token', description: 'Redraw a future reward, free.', hints: [], amount: 1 })
  }
  return offers.slice(0, 3)
}

/** Cinders for passing on every card and keeping the ball as it is. */
export function salvageValue(kind: OfferKind): number {
  return kind === 'elite' ? 14 : kind === 'treasure' ? 12 : 8
}

export function availableComponents(run: RunState, save: SaveData): ComponentDef[] {
  const equipped = new Set(Object.values(run.ids))
  return COMPONENTS.filter((c) => c.pool === 'standard' && save.unlocked.includes(c.id) && !equipped.has(c.id))
}

function weighted<T extends { rarity: Rarity }>(rng: () => number, list: T[], bias: Rarity[]): T[] {
  if (!list.length) return []
  const weight = (r: Rarity) => {
    const base = { common: 46, uncommon: 30, rare: 16, epic: 7, legendary: 1 }[r]
    return base + (bias.includes(r) ? 18 : 0)
  }
  const scored = list.map((item) => ({ item, w: weight(item.rarity) }))
  const total = scored.reduce((s, i) => s + i.w, 0)
  let roll = rng() * total
  for (const s of scored) {
    roll -= s.w
    if (roll <= 0) return [s.item, ...shuffle(rng, list.filter((i) => i !== s.item))]
  }
  return shuffle(rng, list)
}

export function synergyLabel(s: SynergyDef, save: SaveData): string {
  return save.discoveredSynergies.includes(s.id) ? s.name : `Unlisted reaction (${s.requires.map((r) => r.tag).join(' + ')})`
}

/** Before/after for fitting one component, using the same HP policy as the actual equip. */
export function previewSwap(run: RunState, slot: Slot, id: string, save: SaveData) {
  const current = currentBuild(run)
  const next = buildFor({ ...run.ids, [slot]: id }, run.mods)
  const had = new Set(current.synergies.map((s) => s.id))
  const has = new Set(next.synergies.map((s) => s.id))
  const replacedId = run.ids[slot]
  const replaced = replacedId ? COMPONENT_MAP[replacedId] ?? null : null
  return {
    current,
    next,
    replaced,
    gained: next.synergies.filter((s) => !had.has(s.id)).map((s) => synergyLabel(s, save)),
    lost: current.synergies.filter((s) => !has.has(s.id)).map((s) => synergyLabel(s, save)),
    hp: {
      before: run.hp,
      after: keepRatio(run.hp, current.stats.maxHp, next.stats.maxHp),
      maxBefore: current.stats.maxHp,
      maxAfter: next.stats.maxHp,
    },
    energyMax: { before: current.stats.energyMax, after: next.stats.energyMax },
  }
}

/** The single integrity policy for every equipment change: keep the same fraction. */
export function keepRatio(hp: number, maxBefore: number, maxAfter: number): number {
  const ratio = maxBefore > 0 ? hp / maxBefore : 1
  return Math.max(1, Math.min(maxAfter, ratio * maxAfter))
}

export function componentOffer(run: RunState, save: SaveData, id: string): Offer {
  const comp = COMPONENT_MAP[id]
  if (!comp) throw new Error(`Unknown component: ${id}`)
  const p = previewSwap(run, comp.slot, id, save)
  const a = feelNumbers(p.current.stats)
  const b = feelNumbers(p.next.stats)
  return {
    kind: 'component',
    title: comp.name,
    description: comp.description,
    upside: comp.upside,
    downside: comp.downside,
    rarity: comp.rarity,
    slot: comp.slot,
    componentId: id,
    replaces: p.replaced ? { id: p.replaced.id, name: p.replaced.name } : null,
    gained: p.gained,
    lost: p.lost,
    hp: p.hp,
    energyMax: p.energyMax,
    hints: [],
    bars: a.map((bar, i) => ({ label: bar.label, current: bar.value, next: b[i]!.value })),
  }
}

export function makeShop(run: RunState, save: SaveData): ShopItem[] {
  const heat = heatOf(run.heat)
  const price = (n: number) => Math.round(n * heat.shopPrice)
  const pool = availableComponents(run, save)
  const a = pool.length ? weighted(run.rng, pool, ['uncommon', 'rare'])[0] : undefined
  const rest = pool.filter((c) => c !== a)
  const b = rest.length ? weighted(run.rng, rest, ['rare', 'epic'])[0] : undefined
  const maxHp = currentBuild(run).stats.maxHp
  const heal = Math.round(maxHp * 0.45)
  const items: ShopItem[] = [
    { id: 'heal', kind: 'heal', title: 'Patch the shell', detail: `Restore ${heal} integrity (45%).`, cost: price(26), amount: heal, sold: false },
    { id: 'reroll', kind: 'reroll', title: 'Reroll token', detail: 'Redraw one future reward screen.', cost: price(16), amount: 1, sold: false },
  ]
  const partItem = (slotId: string, c: ComponentDef): ShopItem => ({
    id: slotId, kind: 'component', title: c.name, detail: `${c.slot} · ${c.rarity}. ${c.upside}`,
    cost: price(24 + rarityRank(c.rarity) * 12), componentId: c.id, sold: false,
  })
  if (a) items.push(partItem('c1', a))
  if (b) items.push(partItem('c2', b))
  if (run.rng() < 0.55) items.push({ id: 'ember', kind: 'ember', title: 'Ember', detail: 'One ember. It keeps between runs. Fuel for an evolution or a fusion.', cost: price(64), amount: 1, sold: false })
  return items
}

export function noteRarity(run: RunState, rarity: Rarity): void {
  if (rarity !== 'common') run.commonBroken = true
}

export function freshSynergyHints(save: SaveData): { id: string; known: boolean; label: string }[] {
  return SYNERGIES.map((s) => ({
    id: s.id,
    known: save.discoveredSynergies.includes(s.id),
    label: save.discoveredSynergies.includes(s.id)
      ? `${s.name} — ${s.description}`
      : `${s.requires.map((r) => `${r.tag} ×${r.count}`).join(' · ')}`,
  }))
}

export function deathTip(run: RunState, cause: string): string {
  const build = currentBuild(run)
  if (cause === 'lava' || cause === 'pit' || cause === 'geyser') return 'The slag only wins if you stay in it. A shorter hop needs an earlier jump, or a lighter core.'
  if (cause === 'crusher') return 'Stamps telegraph their drop. If you are slow to start, begin moving before the shadow lands.'
  if (cause === 'projectile') return 'Shots are a build question. Dash through them, bounce them back at speed, or catch them.'
  if (cause === 'recoil') return 'Glancing rams cost you. Hit at over half your top speed and the ram is clean: no recoil at all.'
  if (cause === 'boss') return 'The Colossus telegraphs the stamp in red. After it lands, it is stuck for a moment: that is the window.'
  if (build.stats.mass * build.stats.impact < 1 && run.bestHit < 20) return 'Your hits were glancing. Mass or a crush impact would have changed the math.'
  if (build.stats.mass > 1.8 && cause === 'contact') return 'The heavy ball needs room to arrive. Do not trade hits while you are still slow.'
  if (run.abilityUses === 0) return 'The ability slot was quiet. It is a tool, not a tax.'
  return 'The ball broke. The build is still yours to change.'
}

export function nextIdea(run: RunState, save: SaveData): string {
  const tags = currentBuild(run).tags
  const locked = COMPONENTS.filter((c) => c.pool === 'standard' && !save.unlocked.includes(c.id))
  const cheapest = locked.slice().sort((a, b) => a.unlockCost - b.unlockCost)[0]
  if ((tags.fire ?? 0) >= 1 && locked.some((c) => c.id === 'explosive-impact')) return 'Fire is already in the ball. An explosive temper would ask a new question.'
  if ((tags.heavy ?? 0) >= 1 && locked.some((c) => c.id === 'volatile-core')) return 'The weight is there. A volatile heart would spend it all at once.'
  if ((tags.bounce ?? 0) >= 1 && locked.some((c) => c.id === 'rebound-engine')) return 'You already bounce. A rebound engine would make the bounce the damage.'
  if (locked.some((c) => c.id === 'magnetic-core')) return 'Nothing in this ball catches a shot. A magnetic core would.'
  if ((run.takenBySource.recoil ?? 0) > 30) return 'Much of the damage was your own recoil. Try the Light Core in the lab and practise clean, fast rams.'
  if (cheapest && save.scrap >= cheapest.unlockCost) return `You can already forge ${cheapest.name} in the codex. Try it next run.`
  if (run.roomsCleared < 3) return 'A shorter route still teaches the ball. Try the other fork.'
  return 'Change one slot that felt invisible, and run it again.'
}

// ---------------------------------------------------------------------------
// Checkpoint serialization. A run is saved only at the map, between rooms, so
// no reward or purchase can be replayed by reloading.

export interface SavedRun {
  v: 1
  seed: number
  rngState: number
  heat: number
  cinders: number
  rerolls: number
  hp: number
  energy: number
  ids: Record<Slot, string | null>
  mods: string[]
  nodes: MapNode[]
  currentId: string | null
  roomIndex: number
  roomsCleared: number
  elitesKilled: number
  bestCombo: number
  maxSpeed: number
  bestHit: number
  dealtBySource: Record<HitSource, number>
  takenBySource: Record<DamageSource, number>
  abilityUses: number
  kills: number
  reflectedKills: number
  slamKills: number
  templatesSeen: string[]
  eventsSeen: string[]
  annealFreeUsed: boolean
  curseNext: boolean
  commonBroken: boolean
  route: RouteStep[]
  decisions: string[]
}

export function serializeRun(run: RunState): SavedRun {
  return {
    v: 1,
    seed: run.seed,
    rngState: run.rng.state(),
    heat: run.heat,
    cinders: run.cinders,
    rerolls: run.rerolls,
    hp: run.hp,
    energy: run.energy,
    ids: { ...run.ids },
    mods: run.mods.map((m) => m.id),
    nodes: run.nodes.map((n) => ({ ...n, next: [...n.next] })),
    currentId: run.currentId,
    roomIndex: run.roomIndex,
    roomsCleared: run.roomsCleared,
    elitesKilled: run.elitesKilled,
    bestCombo: run.bestCombo,
    maxSpeed: run.maxSpeed,
    bestHit: run.bestHit,
    dealtBySource: { ...run.dealtBySource },
    takenBySource: { ...run.takenBySource },
    abilityUses: run.abilityUses,
    kills: run.kills,
    reflectedKills: run.reflectedKills,
    slamKills: run.slamKills,
    templatesSeen: [...run.templatesSeen],
    eventsSeen: [...run.eventsSeen],
    annealFreeUsed: run.annealFreeUsed,
    curseNext: run.curseNext,
    commonBroken: run.commonBroken,
    route: run.route.map((r) => ({ ...r })),
    decisions: [...run.decisions],
  }
}

const num = (v: unknown, lo: number, hi: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/** Rebuild a run from a checkpoint. Returns null when the data cannot be trusted. */
export function restoreRun(data: unknown): RunState | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Partial<SavedRun>
  if (d.v !== 1 || typeof d.seed !== 'number' || typeof d.rngState !== 'number') return null
  const ids = {} as Record<Slot, string | null>
  for (const slot of SLOTS) {
    const id = d.ids?.[slot]
    ids[slot] = typeof id === 'string' && COMPONENT_MAP[id]?.slot === slot ? id : id === null ? null : STARTER_IDS[slot]
  }
  if (!Array.isArray(d.nodes) || !d.nodes.length) return null
  const states: NodeState[] = ['locked', 'open', 'active', 'done', 'missed']
  const nodes: MapNode[] = []
  for (const n of d.nodes) {
    if (!n || typeof n.id !== 'string' || !states.includes(n.state) || !ROOM_TYPES.includes(n.type)) return null
    nodes.push({ id: n.id, depth: num(n.depth, 0, 20, 0), index: num(n.index, 0, 20, 0), type: n.type, next: strs(n.next), state: n.state })
  }
  // A checkpoint is only written at the map; an active node means the room was
  // interrupted. It reopens with its combat seed, so the room replays exactly.
  for (const n of nodes) if (n.state === 'active') n.state = 'open'
  const run = createRun(num(d.heat, 0, 3, 0), false, d.seed)
  // mulberry32 takes its state as the seed, so this resumes the same sequence.
  run.rng = mulberry32(d.rngState)
  run.cinders = num(d.cinders, 0, 1e6, 0)
  run.rerolls = num(d.rerolls, 0, 99, 0)
  run.ids = ids
  run.mods = strs(d.mods).map((id) => RUN_MODS[id]).filter((m): m is RunMod => !!m)
  const maxHp = buildFor(ids, run.mods).stats.maxHp
  run.hp = num(d.hp, 1, maxHp, maxHp)
  run.energy = num(d.energy, 0, 999, 100)
  run.nodes = nodes
  run.currentId = typeof d.currentId === 'string' ? d.currentId : null
  run.roomIndex = num(d.roomIndex, 0, 1e4, 0)
  run.roomsCleared = num(d.roomsCleared, 0, 99, 0)
  run.elitesKilled = num(d.elitesKilled, 0, 99, 0)
  run.bestCombo = num(d.bestCombo, 0, 1e4, 0)
  run.maxSpeed = num(d.maxSpeed, 0, 1e5, 0)
  run.bestHit = num(d.bestHit, 0, 1e6, 0)
  for (const k of HIT_SOURCES) run.dealtBySource[k] = num(d.dealtBySource?.[k], 0, 1e9, 0)
  for (const k of DEATH_SOURCES) run.takenBySource[k] = num(d.takenBySource?.[k], 0, 1e9, 0)
  run.abilityUses = num(d.abilityUses, 0, 1e6, 0)
  run.kills = num(d.kills, 0, 1e6, 0)
  run.reflectedKills = num(d.reflectedKills, 0, 1e6, 0)
  run.slamKills = num(d.slamKills, 0, 1e6, 0)
  run.templatesSeen = strs(d.templatesSeen).filter((id) => !!ROOM_MAP[id])
  run.eventsSeen = strs(d.eventsSeen)
  run.annealFreeUsed = !!d.annealFreeUsed
  run.curseNext = !!d.curseNext
  run.commonBroken = !!d.commonBroken
  run.route = Array.isArray(d.route) ? d.route.filter((r) => r && typeof r.nodeId === 'string').map((r) => ({ ...r })) : []
  run.decisions = strs(d.decisions)
  return run
}
