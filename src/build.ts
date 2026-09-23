import { COMPONENT_MAP, STARTER_BUILD } from './data/components'
import { SYNERGIES } from './data/synergies'
import {
  BASE_STATS,
  SLOTS,
  STAT_CLAMPS,
  STAT_KEYS,
  type BoundEffect,
  type CompiledBuild,
  type ComponentDef,
  type ProjectileStyle,
  type Rarity,
  type RunMod,
  type Slot,
  type Stats,
  type Tag,
  type VisualDef,
} from './types'

export function emptyLoadout(): Record<Slot, string | null> {
  const ids = {} as Record<Slot, string | null>
  for (const slot of SLOTS) ids[slot] = STARTER_BUILD[slot] ?? null
  return ids
}

export function tagCounts(components: ComponentDef[], mods: RunMod[]): Partial<Record<Tag, number>> {
  const tags: Partial<Record<Tag, number>> = {}
  const add = (t: Tag) => {
    tags[t] = (tags[t] ?? 0) + 1
  }
  for (const c of components) for (const t of c.tags) add(t)
  for (const m of mods) for (const t of m.tags ?? []) add(t)
  return tags
}

export function compileBuild(ids: Record<Slot, string | null>, mods: RunMod[] = []): CompiledBuild {
  const components = SLOTS.map((s) => ids[s]).filter((id): id is string => !!id).map((id) => COMPONENT_MAP[id]).filter((c): c is ComponentDef => !!c)
  const tags = tagCounts(components, mods)
  const synergies = SYNERGIES.filter((s) => s.requires.every((r) => (tags[r.tag] ?? 0) >= r.count))

  const stats: Stats = { ...BASE_STATS }
  const adds: Partial<Record<keyof Stats, number>> = {}
  const muls: Partial<Record<keyof Stats, number>> = {}
  const push = (list: { stat: keyof Stats; op: 'add' | 'mul'; value: number }[]) => {
    for (const m of list) {
      if (m.op === 'add') adds[m.stat] = (adds[m.stat] ?? 0) + m.value
      else muls[m.stat] = (muls[m.stat] ?? 1) * m.value
    }
  }
  for (const c of components) push(c.modifiers)
  for (const m of mods) push(m.modifiers)
  for (const s of synergies) if (s.modifiers) push(s.modifiers)
  for (const key of STAT_KEYS) {
    const raw = (BASE_STATS[key] + (adds[key] ?? 0)) * (muls[key] ?? 1)
    const [lo, hi] = STAT_CLAMPS[key]
    stats[key] = Math.max(lo, Math.min(hi, raw))
  }

  const effects: BoundEffect[] = []
  for (const c of components) for (const effect of c.effects) effects.push({ effect, source: c.name })
  for (const m of mods) for (const effect of m.effects) effects.push({ effect, source: m.name })
  for (const s of synergies) for (const effect of s.effects) effects.push({ effect, source: s.name, synergyId: s.id })

  const abilityComp = components.find((c) => c.slot === 'ability')
  const visual = mergeVisual(components)
  let projectile: ProjectileStyle = 'normal'
  for (const c of components) {
    if (c.projectile === 'reflect-fast') projectile = 'reflect-fast'
    else if (c.projectile === 'attract' && projectile !== 'reflect-fast') projectile = 'attract'
  }

  const impactComp = components.find((c) => c.slot === 'impact')
  const impactTags = (impactComp?.tags ?? ['impact']).filter((t) => t !== 'movement')

  return {
    ids: { ...ids },
    components,
    stats,
    effects,
    tags,
    synergies,
    ability: abilityComp?.ability ?? null,
    visual,
    projectile,
    weaknesses: weaknessesOf(stats, tags),
    strengths: strengthsOf(stats, tags),
    archetype: archetypeOf(stats, tags),
    impactTags,
  }
}

function mergeVisual(components: ComponentDef[]): VisualDef {
  const visual: VisualDef = {
    core: '#ff8a4a',
    shell: '#e4d8c8',
    trail: '#ffb15a',
    pattern: 'solid',
    material: 'metal',
  }
  for (const c of components) {
    if (c.visual.core) visual.core = c.visual.core
    if (c.visual.shell) visual.shell = c.visual.shell
    if (c.visual.trail) visual.trail = c.visual.trail
    if (c.visual.pattern) visual.pattern = c.visual.pattern
    if (c.visual.material) visual.material = c.visual.material
  }
  return visual
}

export function archetypeOf(stats: Stats, tags: Partial<Record<Tag, number>>): string {
  const n = (t: Tag) => tags[t] ?? 0
  if (n('magnetic') >= 2 || (n('magnetic') >= 1 && n('lightning') >= 1 && n('projectile') >= 1)) return 'The Magnet'
  if (n('fire') >= 2 && n('explosive') >= 1) return 'The Pyromaniac'
  if (n('lightning') >= 2 || (n('lightning') >= 1 && n('bounce') >= 1 && n('area') >= 1)) return 'The Storm'
  if (n('healing') >= 1 && n('impact') >= 1) return 'The Vampire'
  if (stats.mass >= 1.8 && n('impact') >= 1) return 'The Juggernaut'
  if (stats.restitution >= 0.78 && n('bounce') >= 1 && n('momentum') >= 1 && stats.mass < 1.6) return 'The Pinball'
  if (n('fragile') >= 1 && stats.maxSpeed >= 980) return 'The Assassin'
  if (n('explosive') >= 1 && n('momentum') >= 1) return 'The Reactor'
  if (n('combo') >= 1 && stats.restitution >= 0.7) return 'The Chaos Ball'
  if (n('defensive') >= 1 && stats.damageReduction >= 0.2) return 'The Bulwark'
  return 'Unshaped Ball'
}

function weaknessesOf(stats: Stats, tags: Partial<Record<Tag, number>>): string[] {
  const out: string[] = []
  if (stats.mass >= 1.8) out.push('Slow to start and turn. Hops stay short.')
  if (stats.maxHp <= 86) out.push('Thin integrity. Dirty hits add up.')
  if (stats.restitution >= 0.78) out.push('The ball will not settle. Aim with bounces.')
  if (stats.airControl < 0.85 && stats.mass >= 1.4) out.push('Little say in the air.')
  if (stats.friction < 0.6) out.push('Poor grip. Lines run long.')
  if (stats.selfDamage >= 1.25) out.push('Sloppy contact punishes you.')
  if ((tags.lightning ?? 0) > 0 && (tags.fire ?? 0) === 0 && stats.mass < 1.4) out.push('Iron Plates ground lightning.')
  if (stats.impact * stats.mass < 0.9) out.push('Light collisions. Armor will shrug.')
  return out.slice(0, 3)
}

function strengthsOf(stats: Stats, tags: Partial<Record<Tag, number>>): string[] {
  const out: string[] = []
  if (stats.mass * stats.impact >= 2) out.push('Collisions carry real weight.')
  if (stats.maxSpeed >= 1000) out.push('A high ceiling on speed.')
  if (stats.restitution >= 0.8) out.push('Walls return you at pace.')
  const lift = (stats.airThrust * stats.airControl) / Math.sqrt(stats.mass)
  if (lift > stats.gravity) out.push('Can climb on air thrust.')
  if (stats.damageReduction >= 0.2) out.push('Dirty hits are blunted.')
  if ((tags.fire ?? 0) >= 1) out.push('Burns keep working after you leave.')
  if ((tags.magnetic ?? 0) >= 1) out.push('Projectiles bend toward the ball.')
  if ((tags.healing ?? 0) >= 1) out.push('Aggression feeds integrity.')
  return out.slice(0, 3)
}

export function feelNumbers(stats: Stats): { label: string; value: number }[] {
  const massF = Math.pow(stats.mass, 0.8)
  const accel = stats.accel / massF
  const lift = (stats.airThrust * stats.airControl) / Math.sqrt(stats.mass)
  return [
    { label: 'Mass', value: norm(stats.mass, 0.45, 3) },
    { label: 'Speed', value: norm(stats.maxSpeed, 480, 1400) },
    { label: 'Accel', value: norm(accel, 400, 2800) },
    { label: 'Impact', value: norm(stats.mass * stats.impact, 0.4, 5) },
    { label: 'Bounce', value: norm(stats.restitution, 0.05, 1.05) },
    { label: 'Air', value: norm(lift / stats.gravity, 0.2, 1.6) },
  ]
}

function norm(v: number, a: number, b: number): number {
  return Math.max(0, Math.min(1, (v - a) / (b - a)))
}

export function rarityRank(r: Rarity): number {
  return { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 }[r]
}

export function canFly(stats: Stats): boolean {
  return (stats.airThrust * stats.airControl) / Math.sqrt(stats.mass) > stats.gravity * 0.98
}
