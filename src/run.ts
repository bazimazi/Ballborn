import { canFly, compileBuild, feelNumbers, rarityRank } from './build'
import { COMPONENT_MAP, COMPONENTS } from './data/components'
import { FUSIONS, OVERCHARGE } from './data/meta'
import { ROOM_MAP, roomsOf } from './data/rooms'
import { SYNERGIES } from './data/synergies'
import type { SaveData } from './save'
import type { CompiledBuild, Rarity, RoomTemplate, RoomType, RunMod, Slot } from './types'
import { SLOTS } from './types'
import { choice, mulberry32, shuffle, type Rng } from './util'

export interface MapNode {
  id: string
  depth: number
  index: number
  type: RoomType
  next: string[]
  state: 'locked' | 'open' | 'done'
}

export interface RunState {
  seed: number
  rng: Rng
  heat: number
  cinders: number
  embers: number
  rerolls: number
  hp: number
  energy: number
  ids: Record<Slot, string | null>
  mods: RunMod[]
  nodes: MapNode[]
  currentId: string | null
  roomsCleared: number
  elitesKilled: number
  bestCombo: number
  maxSpeed: number
  bestHit: number
  damageDealt: number
  damageTaken: number
  abilityUses: number
  abilityDamage: number
  kills: number
  reflectedKills: number
  slamKills: number
  templatesSeen: string[]
  curseNext: boolean
  tutorial: boolean
  tutorialStep: number
  commonBroken: boolean
  roomDamage: number
  cleanBoss: boolean
  cleanElite: boolean
}

export interface Offer {
  kind: 'component' | 'heal' | 'cinders' | 'reroll' | 'ember'
  title: string
  description: string
  upside?: string
  downside?: string
  rarity?: Rarity
  slot?: Slot
  componentId?: string
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
  sold: boolean
}

export interface GameEvent {
  id: string
  title: string
  body: string
  choices: { id: string; title: string; detail: string }[]
}

const PATTERN: RoomType[][] = [
  ['combat', 'traversal'],
  ['combat', 'challenge'],
  ['treasure', 'event', 'shop'],
  ['elite', 'combat'],
  ['event', 'challenge'],
  ['boss'],
]

export function createRun(heat: number, tutorial: boolean, seed = (Math.random() * 1e9) | 0): RunState {
  const rng = mulberry32(seed)
  const ids = {
    core: 'balanced-core',
    shell: 'rubber-shell',
    momentum: 'momentum-engine',
    impact: 'crush-impact',
    ability: 'dash',
    passive: 'combo-engine',
  } as Record<Slot, string | null>
  const build = compileBuild(ids, [])
  return {
    seed,
    rng,
    heat,
    cinders: 0,
    embers: 0,
    rerolls: 0,
    hp: build.stats.maxHp,
    energy: build.stats.energyMax,
    ids,
    mods: [],
    nodes: tutorial ? [] : generateMap(rng),
    currentId: null,
    roomsCleared: 0,
    elitesKilled: 0,
    bestCombo: 0,
    maxSpeed: 0,
    bestHit: 0,
    damageDealt: 0,
    damageTaken: 0,
    abilityUses: 0,
    abilityDamage: 0,
    kills: 0,
    reflectedKills: 0,
    slamKills: 0,
    templatesSeen: [],
    curseNext: false,
    tutorial,
    tutorialStep: 0,
    commonBroken: false,
    roomDamage: 0,
    cleanBoss: true,
    cleanElite: true,
  }
}

export function generateMap(rng: Rng): MapNode[] {
  const nodes: MapNode[] = []
  PATTERN.forEach((layer, depth) => {
    layer.forEach((type, index) => {
      nodes.push({
        id: `n${depth}-${index}`,
        depth,
        index,
        type,
        next: [],
        state: depth === 0 ? 'open' : 'locked',
      })
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

export function currentBuild(run: RunState): CompiledBuild {
  return compileBuild(run.ids, run.mods)
}

export function pickTemplate(run: RunState, build: CompiledBuild, type: RoomType): RoomTemplate {
  if (type === 'boss') return ROOM_MAP['colossus-hold']!
  const all = roomsOf(type)
  const allowed = all.filter((t) => roomAllowed(t, build))
  const fresh = allowed.filter((t) => !run.templatesSeen.includes(t.id))
  const list = fresh.length ? fresh : allowed.length ? allowed : all
  return choice(run.rng, list)
}

function roomAllowed(room: RoomTemplate, build: CompiledBuild): boolean {
  const need = room.requires?.mobility
  if (!need) return true
  const s = build.stats
  if (need === 'speed') return s.maxSpeed >= (room.gateSpeed ?? 760) + 30
  const kind = build.ability?.kind
  const mobile = kind === 'dash' || kind === 'burst' || canFly(s) || s.mass < 1.15
  return mobile
}

export function routeAdvice(type: RoomType, build: CompiledBuild): string {
  const s = build.stats
  if (type === 'elite') {
    return s.mass * s.impact > 1.7
      ? 'Your collisions can crack an elite.'
      : 'Elites are armored. Fire or a heavier impact will suffer less.'
  }
  if (type === 'challenge') {
    return s.mass > 1.7 && build.ability?.kind !== 'dash' && build.ability?.kind !== 'burst'
      ? 'Some trials want air. A heavy ball may be offered an oiled floor instead.'
      : 'A trial of the room, not a brawl. Your movement decides it.'
  }
  if (type === 'shop') return 'Spend cinders before the Colossus, or save them and regret it.'
  if (type === 'treasure') return 'A free choice. Good when the shell is cracked or the build is bored.'
  if (type === 'event') return 'The foundry offers a bargain. Read the cost.'
  if (type === 'boss') return 'The Iron Colossus tests whatever you actually built.'
  if (type === 'traversal') return 'A path of timing and bounce. Few things to break.'
  return 'A fight. Speed, mass, and the angle you choose.'
}

export function makeOffers(run: RunState, save: SaveData, kind: 'combat' | 'elite' | 'soft' | 'treasure'): Offer[] {
  if (run.tutorial && run.roomsCleared === 0) {
    return [
      componentOffer(run, save, 'heavy-core'),
      componentOffer(run, save, 'light-core'),
      { kind: 'heal', title: 'Keep the balance', description: 'Stay on the Balanced Core and weld the shell.', hints: [], amount: 20 },
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
    const bySlot = new Map<Slot, typeof pool>()
    for (const c of pool) {
      const list = bySlot.get(c.slot) ?? []
      list.push(c)
      bySlot.set(c.slot, list)
    }
    const slots = [...bySlot.entries()].filter(([, list]) => list.length >= 2)
    if (slots.length) {
      const [, list] = choice(run.rng, slots)
      const picked = weighted(run.rng, list, bias).slice(0, 2)
      for (const c of picked) offers.push(componentOffer(run, save, c.id))
    }
  }
  const guard = 12
  let spins = 0
  while (offers.length < 2 && spins < guard) {
    spins++
    const pick = weighted(run.rng, pool.filter((c) => !offers.some((o) => o.componentId === c.id)), bias)[0]
    if (!pick) break
    offers.push(componentOffer(run, save, pick.id))
  }
  if (kind === 'treasure') {
    offers.push({ kind: 'cinders', title: 'Cinder cache', description: 'A pouch of run currency.', hints: [], amount: 36 })
    offers.push({ kind: 'heal', title: 'Weld', description: 'Restore a large share of integrity.', hints: [], amount: Math.round(currentBuild(run).stats.maxHp * 0.5) })
    if (run.embers < 2 && run.rng() < 0.5) {
      offers[2] = { kind: 'ember', title: 'Ember', description: 'A rare coal. Evolutions and fusions drink these.', hints: [], amount: 1 }
    }
    return offers.slice(0, 3)
  }
  while (offers.length < 3) {
    const roll = run.rng()
    if (roll < 0.45) offers.push({ kind: 'heal', title: 'Field weld', description: 'Restore integrity now.', hints: [], amount: Math.round(currentBuild(run).stats.maxHp * 0.34) })
    else if (roll < 0.8) offers.push({ kind: 'cinders', title: 'Cinders', description: 'Spend these in the shop.', hints: [], amount: kind === 'elite' ? 28 : 18 })
    else offers.push({ kind: 'reroll', title: 'Reroll token', description: 'Redraw a future reward, free.', hints: [], amount: 1 })
  }
  return offers.slice(0, 3)
}

function availableComponents(run: RunState, save: SaveData) {
  const equipped = new Set(Object.values(run.ids))
  return COMPONENTS.filter((c) => c.pool === 'standard' && save.unlocked.includes(c.id) && !equipped.has(c.id))
}

function weighted<T extends { rarity: Rarity }>(rng: Rng, list: T[], bias: Rarity[]): T[] {
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

export function componentOffer(run: RunState, save: SaveData, id: string): Offer {
  const comp = COMPONENT_MAP[id]!
  const current = currentBuild(run)
  const nextIds = { ...run.ids, [comp.slot]: id }
  const next = compileBuild(nextIds, run.mods)
  const oldSyn = new Set(current.synergies.map((s) => s.id))
  const hints = next.synergies.filter((s) => !oldSyn.has(s.id)).map((s) => {
    if (save.discoveredSynergies.includes(s.id)) return `Primes ${s.name}`
    return `Unlisted reaction: ${s.requires.map((r) => r.tag).join(' + ')}`
  })
  const a = feelNumbers(current.stats)
  const b = feelNumbers(next.stats)
  return {
    kind: 'component',
    title: comp.name,
    description: comp.description,
    upside: comp.upside,
    downside: comp.downside,
    rarity: comp.rarity,
    slot: comp.slot,
    componentId: id,
    hints,
    bars: a.map((bar, i) => ({ label: bar.label, current: bar.value, next: b[i]!.value })),
  }
}

export function makeShop(run: RunState, save: SaveData): ShopItem[] {
  const price = (n: number) => Math.round(n * (1 + run.heat * 0.18))
  const pool = availableComponents(run, save)
  const a = pool.length ? weighted(run.rng, pool, ['uncommon', 'rare'])[0] : undefined
  const b = pool.filter((c) => c !== a).length ? weighted(run.rng, pool.filter((c) => c !== a), ['rare', 'epic'])[0] : undefined
  const items: ShopItem[] = [
    { id: 'heal', kind: 'heal', title: 'Patch the shell', detail: 'Restore 45% integrity.', cost: price(26), sold: false },
    { id: 'reroll', kind: 'reroll', title: 'Reroll token', detail: 'Redraw your next reward.', cost: price(16), sold: false },
  ]
  if (a) items.push({ id: 'c1', kind: 'component', title: a.name, detail: a.upside, cost: price(24 + rarityRank(a.rarity) * 12), componentId: a.id, sold: false })
  if (b) items.push({ id: 'c2', kind: 'component', title: b.name, detail: b.upside, cost: price(24 + rarityRank(b.rarity) * 12), componentId: b.id, sold: false })
  if (run.rng() < 0.55) items.push({ id: 'ember', kind: 'ember', title: 'Ember', detail: 'Fuel for an evolution or a fusion.', cost: price(64), sold: false })
  return items
}

export function rollEvent(run: RunState): GameEvent {
  const ids = new Set(Object.values(run.ids))
  const options: GameEvent[] = []
  options.push({
    id: 'overcharge',
    title: 'Overcharge the Core',
    body: 'The heart of the ball can be driven past its temper. You will be faster for the rest of the run, and less able to settle.',
    choices: [
      { id: 'accept', title: 'Overcharge', detail: '+speed, −air control, −grip, for the run.' },
      { id: 'decline', title: 'Leave it', detail: 'Take 18 cinders and walk.' },
    ],
  })
  if (run.hp > 36) {
    options.push({
      id: 'blood-forge',
      title: 'The Blood Forge',
      body: 'A smith offers a rare schematic in exchange for a cut of your shell.',
      choices: [
        { id: 'pay', title: 'Give 24 integrity', detail: 'Receive a rare component you can equip.' },
        { id: 'decline', title: 'Refuse', detail: 'Keep your shell. Gain 10 cinders.' },
      ],
    })
  }
  options.push({
    id: 'molten-bath',
    title: 'Molten Bath',
    body: 'The slag will close every crack. The next room remembers the favor and grows teeth.',
    choices: [
      { id: 'bathe', title: 'Bathe', detail: 'Full integrity. The next combat room weeps slag.' },
      { id: 'decline', title: 'Stay cracked', detail: 'Gain 12 cinders.' },
    ],
  })
  if (ids.has('rubber-shell') || ids.has('fire-impact')) {
    options.push({
      id: 'anneal',
      title: 'The Annealing',
      body: 'A quiet kiln. One component can be pushed into a specialized shape. This spends an ember if you have one, otherwise it is free once.',
      choices: annealChoices(run),
    })
  }
  const fusion = FUSIONS.find((f) => ids.has(f.requires[0]) && ids.has(f.requires[1]))
  if (fusion) {
    options.push({
      id: 'crucible',
      title: 'The Crucible',
      body: `${fusion.description} This is the sort of choice a run is remembered for.`,
      choices: [
        { id: 'fuse-ember', title: `Fuse (${run.embers > 0 ? '1 ember' : '24 integrity'})`, detail: fusion.name },
        { id: 'decline', title: 'Not yet', detail: 'Keep both components. Gain 15 cinders.' },
      ],
    })
  }
  return choice(run.rng, options)
}

function annealChoices(run: RunState): GameEvent['choices'] {
  const choices: GameEvent['choices'] = []
  if (run.ids.shell === 'rubber-shell') {
    choices.push({ id: 'rubber', title: 'Reinforce the rubber', detail: 'More bounce, a little integrity, still slippery.' })
  }
  if (run.ids.impact === 'fire-impact') {
    choices.push({ id: 'inferno', title: 'Inferno branch', detail: 'A longer, crueler burn.' })
    choices.push({ id: 'combust', title: 'Combustion branch', detail: 'A milder burn that detonates on death.' })
  }
  choices.push({ id: 'decline', title: 'Walk away', detail: 'Gain 12 cinders.' })
  return choices
}

export function applyEvent(run: RunState, choiceId: string, save: SaveData): string {
  if (choiceId === 'decline') {
    run.cinders += 12
    return 'You leave with a few cinders.'
  }
  if (choiceId === 'accept') {
    if (!run.mods.some((m) => m.id === 'overcharge')) run.mods.push(OVERCHARGE)
    return 'The core screams and runs hot.'
  }
  if (choiceId === 'pay') {
    run.hp = Math.max(1, run.hp - 24)
    const rare = availableComponents(run, save).filter((c) => c.rarity === 'rare' || c.rarity === 'epic')
    const pick = rare.length ? choice(run.rng, rare) : availableComponents(run, save)[0]
    if (pick) {
      run.ids[pick.slot] = pick.id
      noteRarity(run, pick.rarity)
      return `The forge presses ${pick.name} into the ball.`
    }
    run.cinders += 20
    return 'The forge had nothing new. It pays you instead.'
  }
  if (choiceId === 'bathe') {
    const stats = currentBuild(run).stats
    run.hp = stats.maxHp
    run.curseNext = true
    return 'The cracks close. The next room will not be kind.'
  }
  if (choiceId === 'rubber') {
    payEmberOrNot(run)
    run.ids.shell = 'reinforced-rubber'
    return 'The shell anneals into Reinforced Rubber.'
  }
  if (choiceId === 'inferno') {
    payEmberOrNot(run)
    run.ids.impact = 'inferno-impact'
    return 'Fire Impact blooms into Inferno.'
  }
  if (choiceId === 'combust') {
    payEmberOrNot(run)
    run.ids.impact = 'combustion-impact'
    return 'Fire Impact learns to burst.'
  }
  if (choiceId === 'fuse-ember') {
    const ids = new Set(Object.values(run.ids))
    const fusion = FUSIONS.find((f) => ids.has(f.requires[0]) && ids.has(f.requires[1]))
    if (!fusion) return 'Nothing in the ball will fuse.'
    if (run.embers > 0) run.embers -= 1
    else run.hp = Math.max(1, run.hp - 24)
    const result = COMPONENT_MAP[fusion.result]!
    for (const slot of SLOTS) {
      const id = run.ids[slot]
      if (id && fusion.requires.includes(id) && slot !== fusion.into) run.ids[slot] = null
    }
    run.ids[fusion.into] = fusion.result
    noteRarity(run, result.rarity)
    return `${fusion.name} locks into the ${fusion.into}.`
  }
  return 'Nothing happens.'
}

function payEmberOrNot(run: RunState): void {
  if (run.embers > 0) run.embers -= 1
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
  if (cause === 'lava' || cause === 'pit') return 'The slag only wins if you stay in it. A shorter hop needs an earlier jump, or a lighter core.'
  if (cause === 'crusher') return 'Stamps telegraph their drop. If you are slow to start, begin moving before the shadow lands.'
  if (cause === 'projectile') return 'Shots are a build question. Dash through them, bounce them back, or catch them.'
  if (build.stats.mass * build.stats.impact < 1 && run.bestHit < 20) return 'Your hits were glancing. Mass or a crush impact would have changed the math.'
  if (build.stats.mass > 1.8 && cause === 'enemy') return 'The heavy ball needs room to arrive. Do not trade hits while you are still slow.'
  if (run.abilityUses === 0) return 'The ability slot was quiet. It is a tool, not a tax.'
  return 'The ball broke. The build is still yours to change.'
}

export function nextIdea(run: RunState, save: SaveData): string {
  const tags = currentBuild(run).tags
  const locked = COMPONENTS.filter((c) => c.pool === 'standard' && !save.unlocked.includes(c.id))
  if ((tags.fire ?? 0) >= 1 && locked.some((c) => c.id === 'explosive-impact')) return 'Fire is already in the ball. An explosive temper would ask a new question.'
  if ((tags.heavy ?? 0) >= 1 && locked.some((c) => c.id === 'volatile-core')) return 'The weight is there. A volatile heart would spend it all at once.'
  if ((tags.bounce ?? 0) >= 1 && locked.some((c) => c.id === 'rebound-engine')) return 'You already bounce. A rebound engine would make the bounce the damage.'
  if (locked.some((c) => c.id === 'magnetic-core')) return 'Nothing in this ball catches a shot. A magnetic core would.'
  if (run.roomsCleared < 3) return 'A shorter route still teaches the ball. Try the other fork.'
  return 'Change one slot that felt invisible, and run it again.'
}
