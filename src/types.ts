export type Slot = 'core' | 'shell' | 'momentum' | 'impact' | 'ability' | 'passive'

export const SLOTS: Slot[] = ['core', 'shell', 'momentum', 'impact', 'ability', 'passive']

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'

export type Tag =
  | 'fire'
  | 'lightning'
  | 'impact'
  | 'momentum'
  | 'bounce'
  | 'projectile'
  | 'critical'
  | 'explosive'
  | 'magnetic'
  | 'defensive'
  | 'healing'
  | 'movement'
  | 'combo'
  | 'area'
  | 'heavy'
  | 'light'
  | 'fragile'
  | 'control'
  | 'armor'

export type StatKey =
  | 'mass'
  | 'gravity'
  | 'accel'
  | 'maxSpeed'
  | 'airControl'
  | 'hop'
  | 'airThrust'
  | 'restitution'
  | 'friction'
  | 'impact'
  | 'damageReduction'
  | 'maxHp'
  | 'energyMax'
  | 'energyRegen'
  | 'knockback'
  | 'selfDamage'
  | 'critChance'
  | 'critMul'
  | 'contact'
  | 'stability'

export type RoomType =
  | 'combat'
  | 'traversal'
  | 'challenge'
  | 'elite'
  | 'event'
  | 'treasure'
  | 'shop'
  | 'boss'

export type HookEvent =
  | 'onImpact'
  | 'onBounce'
  | 'onKill'
  | 'onDamaged'
  | 'onTick'
  | 'onLand'
  | 'onRoomStart'
  | 'onLowHp'
  | 'onCombo'
  | 'onAbility'

export type StatusId = 'burn' | 'shock' | 'slow'
export type KillKind = 'burn' | 'explode' | 'impact' | 'any'
export type Scale = 'flat' | 'impact' | 'massSpeed' | 'dealt'
export type Material = 'metal' | 'rubber' | 'glass' | 'fire' | 'electric' | 'heavy'
export type ProjectileStyle = 'normal' | 'reflect-fast' | 'attract'
export type Pool = 'standard' | 'evolution' | 'fusion'
export type AbilityKind = 'dash' | 'slam' | 'burst' | 'magnet'
export type Pattern = 'solid' | 'spikes' | 'rings' | 'flames' | 'arcs' | 'glass' | 'plating' | 'magnet'

export interface Modifier {
  stat: StatKey
  op: 'add' | 'mul'
  value: number
}

export type Action =
  | { type: 'damage'; amount: number; scale: Scale; counter?: string; counterMul?: number; tags?: Tag[]; pierce?: boolean }
  | { type: 'area'; amount: number; scale: Scale; radius: number; tags?: Tag[]; pierce?: boolean }
  | { type: 'status'; status: StatusId; duration: number; magnitude: number }
  | { type: 'knockback'; force: number }
  | { type: 'heal'; amount: number; scale: 'flat' | 'dealt' }
  | { type: 'energy'; amount: number; perSecond?: boolean }
  | { type: 'explode'; amount: number; radius: number; scale: Scale; hurtSelf?: boolean }
  | { type: 'chain'; jumps: number; range: number; amount: number; scale: Scale }
  | { type: 'shield'; amount: number }
  | { type: 'instability'; amount: number }
  | { type: 'attract'; radius: number; strength: number; target: 'projectile' | 'pickup' | 'enemy' }
  | { type: 'counter'; id: string; op: 'add' | 'set' | 'decay'; value: number; max?: number; when?: 'grounded' | 'air' | 'always' }
  | { type: 'impulse'; along: 'velocity' | 'up' | 'normal'; amount: number }
  | { type: 'controlTax'; duration: number; mul: number }

export interface EffectDef {
  id: string
  event: HookEvent
  chance?: number
  cooldown?: number
  minSpeed?: number
  minSpeedRatio?: number
  requiresStatus?: StatusId
  requiresKill?: KillKind
  once?: string
  everyCombo?: number
  actions: Action[]
}

export interface AbilityDef {
  kind: AbilityKind
  cooldown: number
  energy: number
  name: string
  blurb: string
}

export interface VisualDef {
  core: string
  shell: string
  trail: string
  pattern: Pattern
  material: Material
}

export interface ComponentDef {
  id: string
  name: string
  slot: Slot
  rarity: Rarity
  tags: Tag[]
  description: string
  upside: string
  downside: string
  modifiers: Modifier[]
  effects: EffectDef[]
  ability?: AbilityDef
  visual: Partial<VisualDef>
  projectile?: ProjectileStyle
  pool: Pool
  startsUnlocked: boolean
  unlockCost: number
  evolvesFrom?: string
  fusionOf?: [string, string]
}

export interface Stats {
  mass: number
  gravity: number
  accel: number
  maxSpeed: number
  airControl: number
  hop: number
  airThrust: number
  restitution: number
  friction: number
  impact: number
  damageReduction: number
  maxHp: number
  energyMax: number
  energyRegen: number
  knockback: number
  selfDamage: number
  critChance: number
  critMul: number
  contact: number
  stability: number
}

export interface SynergyDef {
  id: string
  name: string
  description: string
  requires: { tag: Tag; count: number }[]
  effects: EffectDef[]
  modifiers?: Modifier[]
}

export type Behavior = 'walk' | 'fly' | 'turret' | 'blink'

export interface EnemyDef {
  id: string
  name: string
  behavior: Behavior
  hp: number
  r: number
  mass: number
  speed: number
  contact: number
  color: string
  accent: string
  shape: 'blob' | 'diamond' | 'shield' | 'hex' | 'splitter' | 'cask' | 'mite' | 'wisp' | 'turret' | 'spark' | 'knight' | 'shard'
  armorGate?: number
  armorMul?: number
  resists?: { tag: Tag; mul: number }[]
  flying?: boolean
  pinned?: boolean
  shield?: boolean
  shieldBreak?: number
  shot?: { period: number; speed: number; damage: number; color: string }
  pull?: number
  split?: { id: string; count: number }
  explode?: { radius: number; damage: number }
  codex: string
  question: string
}

export interface PlatformDef {
  x: number
  y: number
  w: number
  h?: number
  kind?: 'metal' | 'ice' | 'spring' | 'conveyor'
  conveyor?: number
  move?: { axis: 'x' | 'y'; amp: number; period: number; phase?: number }
  breakable?: boolean
}

export interface HazardDef {
  type: 'lava' | 'spikes' | 'crusher' | 'storm' | 'geyser'
  x: number
  y: number
  w: number
  h: number
  dps?: number
  damage?: number
  drop?: number
  period?: number
  phase?: number
  interval?: number
}

export interface SpawnDef {
  id: string
  x: number
  y: number
  elite?: boolean
}

export interface RoomTemplate {
  id: string
  name: string
  type: RoomType
  width: number
  height: number
  player: { x: number; y: number }
  exit: { x: number; y: number; w: number; h: number }
  platforms: PlatformDef[]
  hazards: HazardDef[]
  spawns: SpawnDef[]
  rules?: ('low-friction' | 'high-gravity' | 'survival' | 'speed-gate')[]
  survival?: number
  gateSpeed?: number
  requires?: { mobility?: 'air' | 'speed' }
  objective: string
}

export interface BiomeDef {
  id: string
  name: string
  mechanic: string
  skyTop: string
  skyBottom: string
  girder: string
  metal: string
  metalHi: string
  lava: string
  ember: string
}

export interface AchievementDef {
  id: string
  name: string
  description: string
  target: number
  scrap?: number
  embers?: number
  unlocks?: string
}

export interface FusionRecipe {
  id: string
  name: string
  requires: [string, string]
  result: string
  /** Slot that receives the result. The other component is consumed. */
  into: Slot
  description: string
}

export interface RunMod {
  id: string
  name: string
  description: string
  modifiers: Modifier[]
  effects: EffectDef[]
  tags?: Tag[]
}

export const STAT_KEYS: StatKey[] = [
  'mass', 'gravity', 'accel', 'maxSpeed', 'airControl', 'hop', 'airThrust',
  'restitution', 'friction', 'impact', 'damageReduction', 'maxHp', 'energyMax',
  'energyRegen', 'knockback', 'selfDamage', 'critChance', 'critMul', 'contact', 'stability',
]

export const BASE_STATS: Stats = {
  mass: 1,
  gravity: 1480,
  accel: 1500,
  maxSpeed: 840,
  airControl: 1,
  hop: 680,
  airThrust: 900,
  restitution: 0.33,
  friction: 1,
  impact: 1,
  damageReduction: 0,
  maxHp: 100,
  energyMax: 100,
  energyRegen: 17,
  knockback: 1,
  selfDamage: 1,
  critChance: 0.05,
  critMul: 1.8,
  contact: 0,
  stability: 1,
}

export const STAT_CLAMPS: Record<StatKey, [number, number]> = {
  mass: [0.4, 4.8],
  gravity: [700, 2800],
  accel: [500, 4200],
  maxSpeed: [460, 1650],
  airControl: [0.35, 2.2],
  hop: [300, 1100],
  airThrust: [200, 2200],
  restitution: [0.05, 1.08],
  friction: [0.18, 2.5],
  impact: [0.45, 3.2],
  damageReduction: [0, 0.62],
  maxHp: [55, 230],
  energyMax: [60, 180],
  energyRegen: [4, 42],
  knockback: [0.45, 2.6],
  selfDamage: [0.35, 1.85],
  critChance: [0, 0.7],
  critMul: [1.2, 3],
  contact: [0, 48],
  stability: [0.4, 3],
}

export interface BoundEffect {
  effect: EffectDef
  source: string
  synergyId?: string
}

export interface CompiledBuild {
  ids: Record<Slot, string | null>
  components: ComponentDef[]
  stats: Stats
  effects: BoundEffect[]
  tags: Partial<Record<Tag, number>>
  synergies: SynergyDef[]
  ability: AbilityDef | null
  visual: VisualDef
  projectile: ProjectileStyle
  weaknesses: string[]
  strengths: string[]
  archetype: string
  impactTags: Tag[]
}
