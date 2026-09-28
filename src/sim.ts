import { TUNE } from './tune'
import { ballRadius, collisionDamage, hopVelocity, horizontalAccel, resolveCircleAabb, verticalAccel, type Body } from './physics'
import { triggerEffects, type EffectApi, type FxEnemy } from './effects'
import { ENEMY_MAP } from './data/enemies'
import { DAMAGE_RULES } from './data/damage'
import { heatOf } from './data/meta'
import type {
  AbilityKind, DamageSource, EnemyDef, HazardDef, HeatDef, HitInfo, HitRecord, HitSource, HookEvent, KillKind, RoomTemplate, Tag,
} from './types'
import type { CompiledBuild } from './types'
import type { FrameInput } from './input'
import { clamp, cosmeticRng, hypot, mulberry32, type Rng } from './util'

export interface LiveEnemy extends FxEnemy {
  kind: 'enemy'
  defId: string
  name: string
  facing: number
  stun: number
  hitCd: number
  attackCd: number
  /** Seconds of visible wind-up before a ranged construct fires. */
  windup: number
  elite: boolean
  flying: boolean
  shield: boolean
  shieldBreak: number
  armorGate: number
  armorMul: number
  contact: number
  color: string
  accent: string
  shape: EnemyDef['shape']
  behavior: EnemyDef['behavior']
  moveSpeed: number
  resists: { tag: Tag; mul: number }[]
  split?: { id: string; count: number }
  explodeOnDeath?: { radius: number; damage: number }
  shot?: EnemyDef['shot']
  keepAway?: number
  pull?: number
  maxHp: number
  hitFlash: number
  blinkCd: number
  killedBy?: KillKind
  pinned: boolean
  /** Placed by the room (not split off or summoned). Only these respawn in the lab. */
  origin: boolean
}

export interface Solid {
  x: number
  y: number
  w: number
  h: number
  kind: 'metal' | 'ice' | 'spring' | 'conveyor'
  conveyor: number
  move?: { axis: 'x' | 'y'; amp: number; period: number; phase?: number }
  baseX: number
  baseY: number
  frameX: number
  frameY: number
  breakable: boolean
  alive: boolean
  /** Boundary walls and ceiling: not drawn, not a landing surface for loot rules. */
  bounds?: boolean
}

export interface Bullet {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  damage: number
  life: number
  friendly: boolean
  reflected: boolean
  color: string
}

export interface Pickup {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  kind: 'cinder' | 'heal'
  value: number
  /** Seconds left. Cinders never expire; healing does. */
  life: number
  homing: boolean
}

export interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  size: number
  color: string
  kind: 'spark' | 'ember' | 'ring' | 'arc' | 'shard'
  x2?: number
  y2?: number
}

export interface Floater {
  x: number
  y: number
  text: string
  life: number
  color: string
}

export interface Rivet extends FxEnemy {
  kind: 'rivet'
  ox: number
  oy: number
  max: number
}

export interface BossState extends FxEnemy {
  kind: 'boss'
  maxHp: number
  phase: 1 | 2 | 3
  rivets: Rivet[]
  attackCd: number
  attack: 'none' | 'slam' | 'barrage'
  telegraph: number
  slamX: number
  slamLive: number
  /** After a slam the Colossus is stuck in the floor: body hits land harder. */
  recover: number
  hitFlash: number
  added: boolean
  /** Countdown before the phase-three floor collapse. Visible warning while > 0. */
  collapse: number
}

/**
 * Explicit rules for how build mechanics meet the Colossus. Everything that
 * works on constructs works here, scaled by these numbers.
 */
export const BOSS_RULES = {
  /** Phase one plate: share of body damage that gets through (all sources). */
  plate: 0.38,
  /** Body damage multiplier while it recovers from a slam. */
  recovering: 1.3,
  burn: 0.6,
  effect: 0.8,
  explosion: 0.65,
  reflectBonus: 6,
  rivetHp: 70,
  /** Integrity the Colossus loses when a rivet breaks. */
  rivetBreak: 40,
  collapseWarning: 1.8,
} as const

export interface SimListeners {
  onDiscovery?: (id: string) => void
  onToast?: (text: string) => void
  onShake?: (mag: number) => void
  onFlash?: (strength: number) => void
  onHitstop?: (time: number) => void
  onImpactSfx?: (speed: number, kind: 'clean' | 'glance' | 'block') => void
  onBounceSfx?: (speed: number) => void
  onReflectSfx?: () => void
  onHurt?: (source: DamageSource, amount: number) => void
  onAbility?: (kind: string) => void
  onCombo?: (n: number) => void
  onKill?: (record: HitRecord, enemy: { defId: string; elite: boolean }) => void
  onBossPhase?: (phase: number) => void
  onHit?: (record: HitRecord) => void
}

export interface SimOptions {
  hp: number
  energy: number
  heat: number
  depth: number
  curse: boolean
  gentle: boolean
  god: boolean
  lab: boolean
  /** Seed for this room's combat stream. The same seed and inputs replay the same room. */
  seed: number
  /** Cosmetic stream. Never read by gameplay. */
  fx?: Rng
  /** Damage-taken assist multiplier (1 = off). */
  assist?: number
}

export function crusherPose(h: { y: number; drop?: number; period?: number; phase?: number }, time: number): { y: number; smashing: boolean; warn: boolean; cycle: number } {
  const period = h.period ?? 2.6
  const local = time + (h.phase ?? 0)
  const t = ((local % period) + period) % period
  const hang = period * 0.46
  const drop = 0.16
  const hold = 0.26
  const rise = Math.max(0.2, period - hang - drop - hold)
  const dist = h.drop ?? 220
  let y = h.y
  let smashing = false
  let warn = false
  if (t < hang) {
    warn = t > hang - 0.45
  } else if (t < hang + drop) {
    const u = (t - hang) / drop
    y = h.y + dist * u
    smashing = u > 0.35
  } else if (t < hang + drop + hold) {
    y = h.y + dist
    smashing = true
  } else {
    const u = (t - hang - drop - hold) / rise
    y = h.y + dist * (1 - Math.min(1, u))
  }
  return { y, smashing, warn, cycle: Math.floor(local / period) }
}

export function geyserPhase(h: { period?: number; phase?: number }, time: number): { warn: boolean; erupt: boolean } {
  const period = h.period ?? 2.4
  const t = ((time + (h.phase ?? 0)) % period + period) % period
  return { warn: t > period - 0.7, erupt: t > period - 0.28 }
}

const HIT_SOURCES: HitSource[] = ['collision', 'ability', 'effect', 'reflect', 'status', 'hazard']

function zeroBy<K extends string>(keys: readonly K[]): Record<K, number> {
  const out = {} as Record<K, number>
  for (const k of keys) out[k] = 0
  return out
}

export class Simulation implements EffectApi {
  readonly dt = TUNE.fixedDt
  room: RoomTemplate
  ball: Body
  /** Ball position at the start of the latest tick, for render interpolation. */
  prevX: number
  prevY: number
  enemies: LiveEnemy[] = []
  bullets: Bullet[] = []
  pickups: Pickup[] = []
  particles: Particle[] = []
  floaters: Floater[] = []
  solids: Solid[] = []
  boss: BossState | null = null
  hp: number
  maxHp: number
  shield = 0
  energy: number
  phase = 0
  slamArmed = false
  magnetTimer = 0
  taxLeft = 0
  controlMul = 1
  /** Seconds during which overspeed from an ability or impulse bleeds slowly. */
  boost = 0
  instability = 0
  combo = 0
  comboTimer = 0
  bestCombo = 0
  grounded = false
  groundKind: Solid['kind'] | null = null
  /** Speed of the surface under the ball (conveyor belts). */
  groundVx = 0
  groundTime = 0
  coyote = 0
  jumpBuffer = 0
  facing = 1
  hurtLock = 0
  tick = 0
  time = 0
  exitOpen = false
  ended: 'play' | 'dead' | 'clear' = 'play'
  cause: DamageSource | '' = ''
  abilityCd = 0
  trail: { x: number; y: number }[] = []
  survivalLeft = 0
  gateWarn = 0
  counters = new Map<string, number>()
  cooldowns = new Map<string, number>()
  once = new Set<string>()
  fxDepth = 0
  discovered = new Set<string>()
  squash = 0
  /** Share of cosmetic particles to spawn. Changing it never changes gameplay. */
  fxLevel = 1
  roomDamage = 0
  /** Integrity lost this room, per source. */
  taken: Record<DamageSource, number>
  /** Damage dealt this room, per source (effective, not overkill). */
  dealt: Record<HitSource, number> = zeroBy(HIT_SOURCES)
  /** Damage the Colossus and its rivets took, per source. */
  bossDealt: Record<HitSource, number> = zeroBy(HIT_SOURCES)
  kills = 0
  /** Cinders collected this room, drained by the game when the room ends. */
  cinderPocket = 0
  readonly heat: HeatDef
  readonly rng: Rng
  readonly fx: Rng
  private uid = 1
  private crusherHits = new Map<number, number>()
  private stormCd = 0.4
  private slagCd = 0
  private riding: Solid | null = null
  private labRespawns: { id: string; x: number; y: number; elite: boolean; t: number }[] = []

  constructor(
    template: RoomTemplate,
    public build: CompiledBuild,
    public opts: SimOptions,
    public listeners: SimListeners = {},
  ) {
    // Content definitions are frozen. The simulation owns a private copy, so
    // collapsing floors and added hazards never leak into the next room.
    const room = structuredClone(template) as RoomTemplate
    this.room = room
    this.rng = mulberry32(opts.seed)
    this.fx = opts.fx ?? cosmeticRng()
    this.heat = heatOf(opts.heat)
    this.taken = zeroBy(Object.keys(DAMAGE_RULES) as DamageSource[])
    this.maxHp = build.stats.maxHp
    this.hp = clamp(opts.hp, 1, this.maxHp)
    this.energy = clamp(opts.energy, 0, build.stats.energyMax)
    this.ball = { x: room.player.x, y: room.player.y, vx: 0, vy: 0, r: ballRadius(build.stats.mass), spin: 0 }
    this.prevX = this.ball.x
    this.prevY = this.ball.y
    this.survivalLeft = room.survival ?? 0
    const wall = (x: number, y: number, w: number, h: number): Solid => ({
      x, y, w, h, kind: 'metal', conveyor: 0, baseX: x, baseY: y, frameX: x, frameY: y, breakable: false, alive: true, bounds: true,
    })
    this.solids.push(
      wall(-50, -600, 50, room.height + 1200),
      wall(room.width, -600, 50, room.height + 1200),
      wall(-50, -48, room.width + 100, 48),
    )
    for (const p of room.platforms) {
      this.solids.push({
        x: p.x, y: p.y, w: p.w, h: p.h ?? 22,
        kind: p.kind ?? 'metal',
        conveyor: p.conveyor ?? 0,
        move: p.move,
        baseX: p.x, baseY: p.y, frameX: p.x, frameY: p.y,
        breakable: !!p.breakable,
        alive: true,
      })
    }
    if ((opts.curse || (this.heat.geysers && (room.type === 'combat' || room.type === 'elite'))) && room.type !== 'boss') {
      room.hazards.push(
        { type: 'geyser', x: room.width * 0.38, y: 590, w: 54, h: 20, period: 2.5, phase: 0.2 },
        { type: 'geyser', x: room.width * 0.68, y: 590, w: 54, h: 20, period: 2.8, phase: 1.1 },
      )
    }
    const scale = (1 + opts.depth * 0.08) * this.heat.enemyHp * (opts.gentle ? 0.75 : 1)
    const spawns = opts.lab
      ? [
          { id: 'grunt', x: 640, y: 500, elite: false },
          { id: 'plate', x: 980, y: 500, elite: false },
          { id: 'bolt', x: 1280, y: 500, elite: false },
          { id: 'spark', x: 800, y: 320, elite: false },
        ]
      : room.spawns
    for (const s of spawns) this.enemies.push({ ...this.makeEnemy(s.id, s.x, s.y, !!s.elite, scale), origin: true })
    if (room.type === 'boss') this.makeBoss()
    if (!this.enemies.some((e) => e.alive) && room.type === 'traversal' && !room.rules?.includes('survival')) this.exitOpen = true
    this.fireEvent('onRoomStart', this.ball.x, this.ball.y, 0, 0, 0)
  }

  get stats() {
    return this.effectiveStats()
  }

  get hazards(): HazardDef[] {
    return this.room.hazards
  }

  private effectiveStats() {
    const s = { ...this.build.stats }
    if (this.taxLeft > 0) s.airControl *= this.controlMul
    if (this.room.rules?.includes('low-friction')) s.friction *= 0.28
    if (this.grounded && this.groundKind === 'ice') s.friction *= 0.3
    if (this.room.rules?.includes('high-gravity')) s.gravity *= 1.48
    s.gravity *= this.heat.gravity
    return s
  }

  /** Lab swaps. Same policy as every other equip path: keep the integrity ratio. */
  syncBuild(build: CompiledBuild): void {
    const ratio = this.maxHp > 0 ? this.hp / this.maxHp : 1
    this.build = build
    this.maxHp = build.stats.maxHp
    this.hp = clamp(this.maxHp * ratio, 1, this.maxHp)
    this.ball.r = ballRadius(build.stats.mass)
    this.energy = Math.min(this.energy, build.stats.energyMax)
  }

  targets(): FxEnemy[] {
    const list: FxEnemy[] = this.enemies.filter((e) => e.alive)
    if (this.boss && this.boss.alive) {
      list.push(this.boss)
      for (const r of this.boss.rivets) if (r.alive) list.push(r)
    }
    return list
  }

  get done(): boolean {
    return this.ended !== 'play'
  }

  /**
   * Advance exactly one fixed tick. Pressed edges in `input` are acted on
   * once; the caller must not repeat them on the following tick.
   */
  step(input: FrameInput, mouse: { x: number; y: number } | null = null): void {
    if (this.done) return
    const dt = this.dt
    this.tick++
    this.time += dt
    this.prevX = this.ball.x
    this.prevY = this.ball.y
    this.gateWarn = Math.max(0, this.gateWarn - dt)
    const stats = this.effectiveStats()
    this.energy = Math.min(stats.energyMax, this.energy + stats.energyRegen * dt)
    this.abilityCd = Math.max(0, this.abilityCd - dt)
    this.hurtLock = Math.max(0, this.hurtLock - dt)
    this.phase = Math.max(0, this.phase - dt)
    this.magnetTimer = Math.max(0, this.magnetTimer - dt)
    this.taxLeft = Math.max(0, this.taxLeft - dt)
    this.boost = Math.max(0, this.boost - dt)
    this.slagCd = Math.max(0, this.slagCd - dt)
    this.squash = Math.max(0, this.squash - dt)
    if (this.comboTimer > 0) {
      this.comboTimer -= dt
      if (this.comboTimer <= 0) this.combo = 0
    }
    if (input.hopPressed) this.jumpBuffer = TUNE.jumpBuffer
    else this.jumpBuffer = Math.max(0, this.jumpBuffer - dt)
    if (input.abilityPressed) this.useAbility(input)

    let ix = input.x
    if (Math.abs(input.x) > 0.2) this.facing = Math.sign(input.x)
    if (input.mouseThrust && mouse && Math.abs(ix) < 0.25) {
      ix = clamp((mouse.x - this.ball.x) / 90, -1, 1)
      if (Math.abs(ix) > 0.2) this.facing = Math.sign(ix)
    }

    for (const s of this.solids) {
      s.frameX = s.x
      s.frameY = s.y
      if (s.move && s.alive) {
        const t = (this.time * Math.PI * 2) / s.move.period + (s.move.phase ?? 0)
        if (s.move.axis === 'x') s.x = s.baseX + Math.sin(t) * s.move.amp
        else s.y = s.baseY + Math.sin(t) * s.move.amp
      }
    }

    // Substeps are derived from displacement relative to the ball's size, so
    // even an ability-boosted ball moves under half a radius per substep.
    const travel = hypot(this.ball.vx, this.ball.vy) * dt
    const steps = clamp(Math.ceil(travel / (this.ball.r * 0.45)), 1, 8)
    const sub = dt / steps
    for (let i = 0; i < steps; i++) this.substep(sub, ix, input.y, input.hopHeld)

    if (this.riding) {
      this.ball.x += this.riding.x - this.riding.frameX
      this.ball.y += this.riding.y - this.riding.frameY
    }

    this.updateEnemies(dt)
    if (this.done) return
    this.collideEnemies()
    if (this.done) return
    this.updateBoss(dt)
    if (this.done) return
    this.updateBullets(dt)
    if (this.done) return
    this.updatePickups(dt)
    this.updateHazards(dt)
    if (this.done) return
    this.tickStatus(dt)
    if (this.done) return
    this.fireEvent('onTick', this.ball.x, this.ball.y, 0, -1, hypot(this.ball.vx, this.ball.vy), undefined, 0, undefined, dt)
    if (this.done) return
    this.updateRespawns(dt)
    this.checkObjective(dt)
    this.tryExit()
    if (this.done) return
    if (this.ball.y > this.room.height + 150) this.hurt(1, 'pit')
    if (this.done) return
    this.enemies = this.enemies.filter((e) => e.alive)
    this.updateCosmetics(dt)
  }

  private updateCosmetics(dt: number): void {
    const sp = hypot(this.ball.vx, this.ball.vy)
    this.trail.push({ x: this.ball.x, y: this.ball.y })
    if (this.trail.length > 16) this.trail.shift()
    for (const p of this.particles) {
      p.life -= dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.vy += 500 * dt
    }
    if (this.tick % 4 === 0) this.particles = this.particles.filter((p) => p.life > 0)
    if (this.particles.length > 420) this.particles.splice(0, this.particles.length - 420)
    for (const f of this.floaters) {
      f.life -= dt
      f.y -= 28 * dt
    }
    if (this.tick % 4 === 0) this.floaters = this.floaters.filter((f) => f.life > 0)
    if (this.grounded && sp > 80 && this.fx() < dt * 10) this.burst(this.ball.x, this.ball.y + this.ball.r * 0.6, 1, '#c7b8a4', 40)
  }

  private substep(dt: number, ix: number, iy: number, hopHeld: boolean): void {
    const stats = this.effectiveStats()
    // Friction acts relative to the surface, so a belt carries a resting ball at its own speed.
    const beltVx = this.grounded ? this.groundVx : 0
    let ax = horizontalAccel(stats, ix, this.ball.vx - beltVx, this.grounded)
    const ay = verticalAccel(stats, hopHeld && iy < 0, iy > 0, this.grounded)
    // Input never pushes past the cap; overspeed from impulses bleeds away
    // instead of being cut, so abilities keep their momentum briefly.
    const cap = stats.maxSpeed
    if (Math.abs(this.ball.vx) >= cap && Math.sign(ax) === Math.sign(this.ball.vx)) ax = 0
    this.ball.vx += ax * dt
    this.ball.vy += ay * dt
    const over = Math.abs(this.ball.vx) - cap
    if (over > 0) {
      const k = this.boost > 0 ? TUNE.overspeedDecayBoosted : TUNE.overspeedDecay
      this.ball.vx = Math.sign(this.ball.vx) * (cap + over * Math.exp(-k * dt))
    }
    const vCap = cap * 1.5
    if (Math.abs(this.ball.vy) > vCap && this.boost <= 0) this.ball.vy = Math.sign(this.ball.vy) * vCap
    if (this.jumpBuffer > 0 && (this.grounded || this.coyote > 0)) {
      this.ball.vy = hopVelocity(stats)
      this.jumpBuffer = 0
      this.coyote = 0
      this.grounded = false
      this.burst(this.ball.x, this.ball.y + 8, 4, '#efe7d6', 80)
    }
    this.ball.x += this.ball.vx * dt
    this.ball.y += this.ball.vy * dt
    const wasGround = this.grounded
    this.grounded = false
    this.riding = null
    for (const s of this.solids) {
      if (!s.alive) continue
      const c = resolveCircleAabb(this.ball, s, stats.restitution, 1, 0, 0)
      if (!c.hit) continue
      if (c.ny < -0.55) {
        this.grounded = true
        this.groundKind = s.kind
        this.groundVx = s.kind === 'conveyor' ? s.conveyor : 0
        this.riding = s
        if (Math.abs(this.ball.vy) < 48) this.ball.vy = 0
        if (s.kind === 'spring' && (c.impactSpeed > 60 || hopHeld)) {
          this.ball.vy = -Math.max(Math.abs(hopVelocity(stats)), 760 / Math.pow(stats.mass, 0.38))
          this.grounded = false
          this.burst(this.ball.x, s.y, 6, '#ffb15a', 160)
          this.listeners.onBounceSfx?.(500)
        }
        if (this.slamArmed && c.impactSpeed > 220) {
          this.slamArmed = false
          this.slamShock(c.impactSpeed)
        } else if (this.slamArmed) this.slamArmed = false
      }
      if (c.impactSpeed > 120) {
        this.listeners.onBounceSfx?.(c.impactSpeed)
        this.squash = Math.max(this.squash, 0.08)
        this.fireEvent('onBounce', this.ball.x, this.ball.y, c.nx, c.ny, c.impactSpeed)
        if (c.ny < -0.55) this.fireEvent('onLand', this.ball.x, this.ball.y, c.nx, c.ny, c.impactSpeed)
      }
    }
    if (!this.grounded) {
      this.groundKind = null
      this.groundVx = 0
    }
    if (wasGround && !this.grounded) this.coyote = TUNE.coyote
    if (this.grounded) {
      this.groundTime += dt
      this.coyote = TUNE.coyote
      this.ball.spin = -this.ball.vx / this.ball.r
    } else {
      this.groundTime = 0
      this.coyote = Math.max(0, this.coyote - dt)
      this.ball.spin += dt * 2
    }
  }

  /** Why the ability cannot fire right now, or null when it is ready. */
  abilityBlock(): 'none' | 'cooldown' | 'energy' | null {
    const ability = this.build.ability
    if (!ability) return 'none'
    if (this.abilityCd > 0) return 'cooldown'
    if (this.energy < ability.energy) return 'energy'
    return null
  }

  private useAbility(input: FrameInput): void {
    const ability = this.build.ability
    if (!ability || this.abilityBlock() !== null) return
    this.energy -= ability.energy
    this.abilityCd = ability.cooldown
    this.listeners.onAbility?.(ability.kind)
    const stats = this.effectiveStats()
    if (ability.kind === 'dash') {
      let dx = input.x
      let dy = input.y
      if (dx === 0 && dy === 0) dx = this.facing
      const len = hypot(dx, dy) || 1
      const impulse = 1020 / Math.pow(stats.mass, 0.35)
      this.ball.vx += (dx / len) * impulse
      this.ball.vy += (dy / len) * impulse * 0.82
      this.phase = 0.14
      this.boost = 0.3
      this.burst(this.ball.x, this.ball.y, 8, this.build.visual.trail, 220)
    } else if (ability.kind === 'slam') {
      this.ball.vy = Math.max(this.ball.vy, 980 / Math.pow(stats.mass, 0.2))
      this.slamArmed = true
      this.boost = 0.4
    } else if (ability.kind === 'burst') {
      this.ball.vy = Math.min(this.ball.vy, -640 / Math.pow(stats.mass, 0.35))
      this.ball.vx += input.x * 220
      this.phase = 0.08
      this.boost = 0.25
      this.blastArea(this.ball.x, this.ball.y, 96, 16, 'burst')
      this.burst(this.ball.x, this.ball.y, 10, '#ffe7c2', 200)
    } else if (ability.kind === 'magnet') {
      this.magnetTimer = 0.55
      this.burst(this.ball.x, this.ball.y, 8, '#9ad7ff', 140)
    }
    this.fireEvent('onAbility', this.ball.x, this.ball.y, this.facing, 0, hypot(this.ball.vx, this.ball.vy))
  }

  private slamShock(impactSpeed: number): void {
    const stats = this.effectiveStats()
    const dmg = collisionDamage(stats, impactSpeed, this.comboMul(), false) * 0.85
    this.blastArea(this.ball.x, this.ball.y, 120 + impactSpeed * 0.05, dmg, 'slam')
    this.listeners.onShake?.(Math.min(14, impactSpeed / 80))
    this.listeners.onHitstop?.(0.045)
    this.ring(this.ball.x, this.ball.y, 18)
    this.listeners.onAbility?.('slam-land')
  }

  private blastArea(x: number, y: number, radius: number, dmg: number, ability: AbilityKind): void {
    for (const e of this.targets()) {
      if (hypot(e.x - x, e.y - y) <= radius + e.r) {
        this.damageEnemy(e, dmg, ['area', 'impact'], { source: 'ability', ability, kind: 'impact' })
        this.knockback(e, (e.x - x) || 1, (e.y - y) || -0.2, 380)
      }
    }
  }

  private updateEnemies(dt: number): void {
    const ballMass = this.effectiveStats().mass
    for (const e of this.enemies) {
      if (!e.alive) continue
      e.hitFlash = Math.max(0, e.hitFlash - dt)
      e.hitCd = Math.max(0, e.hitCd - dt)
      e.stun = Math.max(0, e.stun - dt)
      e.attackCd = Math.max(0, e.attackCd - dt)
      e.blinkCd = Math.max(0, e.blinkCd - dt)
      if (e.shock > 0) e.shock -= dt
      if (e.slow > 0) e.slow -= dt
      const slowMul = e.slow > 0 ? 0.45 : 1
      if (e.stun > 0 || e.shock > 0) {
        e.vx *= Math.exp(-3 * dt)
        e.vy += (e.flying ? 0 : 1500) * dt
      } else if (e.behavior === 'fly') {
        const dx = this.ball.x - e.x
        const dy = this.ball.y - 30 - e.y
        e.vx += clamp(dx, -1, 1) * e.moveSpeed * 2.2 * slowMul * dt
        e.vy += clamp(dy, -1, 1) * e.moveSpeed * 2.2 * slowMul * dt
        e.vx *= Math.exp(-1.4 * dt)
        e.vy *= Math.exp(-1.4 * dt)
      } else if (e.behavior === 'turret') {
        e.vx = 0
        e.vy = 0
        e.facing = Math.sign(this.ball.x - e.x) || e.facing
      } else if (e.behavior === 'blink') {
        const d = hypot(this.ball.x - e.x, this.ball.y - e.y)
        if (d < 150 && e.blinkCd <= 0) {
          this.burst(e.x, e.y, 6, e.accent, 80)
          const ang = this.rng() * Math.PI * 2
          e.x = clamp(this.ball.x + Math.cos(ang) * 220, 40, this.room.width - 40)
          e.y = clamp(this.ball.y - 80 + Math.sin(ang) * 40, 80, 560)
          e.blinkCd = 1.4
          // A blink always gives the player a beat before the next shot.
          e.attackCd = Math.max(e.attackCd, 0.6)
          this.burst(e.x, e.y, 6, e.accent, 80)
        }
        e.vx *= Math.exp(-2 * dt)
        e.vy *= Math.exp(-2 * dt)
      } else {
        const toBall = this.ball.x - e.x
        let dir = Math.sign(toBall) || e.facing
        // Ranged walkers keep their distance, as the codex says.
        if (e.keepAway && Math.abs(toBall) < e.keepAway) dir = -dir
        e.facing = Math.sign(toBall) || e.facing
        const ahead = this.solidAt(e.x + dir * (e.r + 16), e.y + e.r)
        const here = this.solidAt(e.x, e.y + e.r)
        if (!(here && !ahead)) e.vx += dir * e.moveSpeed * 3.2 * slowMul * dt
        e.vy += 1600 * dt
        e.vx *= Math.exp(-2.4 * dt)
      }
      if (e.pull) {
        const d = hypot(this.ball.x - e.x, this.ball.y - e.y)
        if (d < 280 && d > 1) {
          const f = (e.pull / Math.max(0.55, ballMass)) * dt
          this.ball.vx += ((e.x - this.ball.x) / d) * f
          this.ball.vy += ((e.y - this.ball.y) / d) * f
        }
      }
      e.x += e.vx * dt
      e.y += e.vy * dt
      if (!e.flying && e.behavior !== 'turret' && e.behavior !== 'blink') {
        const body: Body = { x: e.x, y: e.y, vx: e.vx, vy: e.vy, r: e.r, spin: 0 }
        let onFloor = false
        for (const s of this.solids) {
          if (!s.alive) continue
          // High platforms are player routes. Walkers drop to the floor so a
          // heavy core is never asked to fly up to a fight.
          if (s.h < 80 && s.y < 556) continue
          const c = resolveCircleAabb(body, s, 0.04, 0.35)
          if (c.hit && c.ny < -0.5) {
            onFloor = true
            // Constructs ride moving floors instead of being scraped off them.
            if (s.move) {
              body.x += s.x - s.frameX
              body.y += s.y - s.frameY
            }
          }
        }
        e.x = body.x
        e.y = body.y
        e.vx = body.vx
        e.vy = body.vy
        if (onFloor && Math.abs(e.vy) < 50) e.vy = 0
      } else if (e.flying) {
        e.x = clamp(e.x, e.r, this.room.width - e.r)
        e.y = clamp(e.y, e.r + 10, this.room.height - 120)
      }
      this.enemyHazards(e)
      if (!e.alive) continue
      if (e.shot) {
        if (e.windup > 0) {
          e.windup -= dt
          if (e.windup <= 0) {
            this.shoot(e)
            e.attackCd = e.shot.period / this.heat.attackRate
          }
        } else if (e.attackCd <= 0 && e.stun <= 0) {
          e.windup = 0.35
        }
      }
      if (e.explodeOnDeath && e.defId === 'cask' && hypot(e.x - this.ball.x, e.y - this.ball.y) < e.r + this.ball.r + 6) {
        this.kill(e, { target: 'enemy', source: 'hazard', tags: [], effective: 0, overkill: 0, lethal: true }, 'impact')
      }
      if (this.done) return
    }
    this.separateEnemies()
  }

  /**
   * Constructs that touch slag or leave the room die. They drop their loot
   * where they fell, and anything unreached is collected when the gate opens,
   * so a room can never be blocked by a construct nobody can reach.
   */
  private enemyHazards(e: LiveEnemy): void {
    const out = e.y > this.room.height + 60 || e.x < -60 || e.x > this.room.width + 60
    let melted = false
    if (!e.flying && !out) {
      for (const h of this.room.hazards) {
        if (h.type === 'lava' && e.x > h.x && e.x < h.x + h.w && e.y + e.r * 0.5 > h.y) {
          melted = true
          break
        }
      }
    }
    if (!out && !melted) return
    const record: HitRecord = { target: 'enemy', source: 'hazard', tags: ['fire'], effective: e.hp, overkill: 0, lethal: true }
    this.dealt.hazard += e.hp
    if (out) {
      e.x = clamp(e.x, 40, this.room.width - 40)
      e.y = Math.min(e.y, this.room.height - 140)
    }
    this.floater(e.x, e.y - e.r, melted ? 'MELTED' : 'LOST', '#ffb15a')
    this.kill(e, record, 'hazard')
  }

  private solidAt(x: number, y: number): boolean {
    return this.solids.some((s) => s.alive && s.w > 40 && x >= s.x + 2 && x <= s.x + s.w - 2 && y >= s.y - 6 && y <= s.y + 30)
  }

  private separateEnemies(): void {
    for (let i = 0; i < this.enemies.length; i++) {
      const a = this.enemies[i]!
      if (!a.alive || a.pinned) continue
      for (let j = i + 1; j < this.enemies.length; j++) {
        const b = this.enemies[j]!
        if (!b.alive || b.pinned) continue
        const dx = b.x - a.x
        const dy = b.y - a.y
        const min = a.r + b.r
        if (Math.abs(dx) >= min || Math.abs(dy) >= min) continue
        const d = hypot(dx, dy) || 0.001
        if (d < min) {
          const p = (min - d) / 2
          a.x -= (dx / d) * p
          a.y -= (dy / d) * p
          b.x += (dx / d) * p
          b.y += (dy / d) * p
        }
      }
    }
  }

  private shoot(e: LiveEnemy): void {
    if (!e.shot) return
    const dx = this.ball.x - e.x
    const dy = this.ball.y - e.y
    const len = hypot(dx, dy) || 1
    this.bullets.push({
      x: e.x + (dx / len) * (e.r + 8),
      y: e.y + (dy / len) * (e.r + 8),
      vx: (dx / len) * e.shot.speed,
      vy: (dy / len) * e.shot.speed,
      r: 6,
      damage: e.shot.damage * this.heat.enemyDamage,
      life: 3.2,
      friendly: false,
      reflected: false,
      color: e.shot.color,
    })
  }

  private collideEnemies(): void {
    const stats = this.effectiveStats()
    for (const e of this.enemies) {
      if (!e.alive || e.hitCd > 0) continue
      const dx = this.ball.x - e.x
      const dy = this.ball.y - e.y
      const dist = hypot(dx, dy)
      const min = this.ball.r + e.r
      if (dist >= min || dist < 0.001) continue
      const nx = dx / dist
      const ny = dy / dist
      const pen = min - dist
      const tm = stats.mass + e.mass
      if (!e.pinned) {
        this.ball.x += nx * pen * (e.mass / tm)
        this.ball.y += ny * pen * (e.mass / tm)
        e.x -= nx * pen * (stats.mass / tm)
        e.y -= ny * pen * (stats.mass / tm)
      } else {
        this.ball.x += nx * pen
        this.ball.y += ny * pen
      }
      const rel = (this.ball.vx - e.vx) * nx + (this.ball.vy - e.vy) * ny
      const ballToward = -(this.ball.vx * nx + this.ball.vy * ny)
      const incoming = hypot(this.ball.vx, this.ball.vy)
      // The enemy walking into a ball that is leaving is not a ram.
      if (ballToward < 90) {
        const push = 280 / Math.pow(stats.mass, 0.35)
        this.ball.vx += nx * push
        this.ball.vy += ny * push * 0.45
        if (!e.pinned) e.vx -= nx * 120
        e.hitCd = 0.28
        e.stun = Math.max(e.stun, 0.16)
        if (incoming < 150) this.hurt(e.contact * 0.35, 'contact')
        if (this.done) return
        continue
      }
      if (rel >= -30) continue
      const closing = -rel
      const rest = stats.restitution
      const impulse = (-(1 + rest) * rel) / (1 / stats.mass + (e.pinned ? 0 : 1 / e.mass))
      this.ball.vx += (impulse * nx) / stats.mass
      this.ball.vy += (impulse * ny) / stats.mass
      if (!e.pinned) {
        const kb = stats.knockback
        e.vx -= (impulse * nx * kb) / e.mass
        e.vy -= (impulse * ny * kb) / e.mass
        e.stun = Math.max(e.stun, 0.18)
      }
      const away = 240 / Math.pow(stats.mass, 0.35)
      const vn = this.ball.vx * nx + this.ball.vy * ny
      if (vn < away) {
        this.ball.vx += nx * (away - vn)
        this.ball.vy += ny * (away - vn) * 0.45
      }
      e.hitCd = TUNE.enemyHitLock
      if (this.phase > 0) continue
      this.resolveHit(e, nx, ny, Math.max(closing, ballToward))
      if (this.done) return
    }
    this.collideBoss()
  }

  private resolveHit(e: LiveEnemy, nx: number, ny: number, closing: number): void {
    const stats = this.effectiveStats()
    const crit = this.rng() < stats.critChance
    let raw = collisionDamage(stats, closing, this.comboMul(), crit)
    raw += stats.contact * (0.35 + closing / 900)
    const fromAbove = ny < -0.45
    let blocked = false
    if (e.shield && !fromAbove && (this.ball.x - e.x) * e.facing > 0 && raw < e.shieldBreak) {
      raw *= 0.18
      blocked = true
    }
    const armored = !!e.armorGate && raw < e.armorGate
    const hpBefore = e.hp
    const dealt = this.damageEnemy(e, raw, this.build.impactTags, { kind: 'impact', source: 'collision' })
    const killed = !e.alive
    const clean = !blocked && (killed || closing >= stats.maxSpeed * TUNE.cleanRamRatio)
    this.fireEvent('onImpact', e.x, e.y, nx, ny, closing, e, dealt)
    if (this.done) return
    if (!clean) {
      const dirty = clamp(1 - dealt / 48, TUNE.minRecoil, 1)
      this.hurt(e.contact * stats.selfDamage * dirty * (blocked ? 0.4 : 1), 'recoil')
      if (this.done) return
    }
    this.squash = 0.12
    this.listeners.onImpactSfx?.(closing, blocked ? 'block' : clean ? 'clean' : 'glance')
    this.listeners.onShake?.(clamp(dealt / 18, 1.5, 12))
    if (dealt > 24) this.listeners.onHitstop?.(this.opts.gentle ? 0 : clamp(dealt / 900, 0.02, 0.05))
    if (clean && dealt > 30) this.listeners.onFlash?.(clamp(dealt / 160, 0.15, 0.5))
    this.burst(e.x, e.y, blocked ? 3 : 6 + dealt / 12, crit ? '#ffe28a' : this.build.visual.trail, 80 + closing)
    const tag = blocked ? ' BLOCK' : armored ? ' ARMOR' : clean ? '' : ' glance'
    this.floater(e.x, e.y - e.r, `${Math.round(dealt)}${crit ? '!' : ''}${tag}`, blocked || armored ? '#9aa4b2' : crit ? '#ffe28a' : clean ? '#fff6ea' : '#c3b4a2')
    if (clean && !killed && hpBefore > 0) this.floater(e.x, e.y - e.r - 18, 'CLEAN', '#8dffc0')
    if (dealt > 8) this.addCombo()
  }

  /**
   * Every hit on a construct, the Colossus, or a rivet goes through here. The
   * returned number is damage after armor and resistances, before clamping to
   * the target's remaining integrity (so a huge ram still reads as huge).
   */
  damageEnemy(e: FxEnemy, amount: number, tags: Tag[], info: HitInfo): number {
    if (!e.alive || !(amount > 0)) return 0
    if (e.kind === 'boss') return this.hurtBoss(amount, tags, info)
    if (e.kind === 'rivet') return this.hurtRivet(e as Rivet, amount, tags, info)
    const live = e as LiveEnemy
    let dmg = amount
    if (!info.pierce && live.armorGate && dmg < live.armorGate && info.kind === 'impact') dmg *= live.armorMul
    for (const res of live.resists) if (tags.includes(res.tag)) dmg *= res.mul
    const before = live.hp
    live.hp -= dmg
    live.hitFlash = 0.08
    const record = this.record('enemy', tags, info, dmg, before)
    if (live.hp <= 0) this.kill(live, record, info.kind ?? 'impact')
    return dmg
  }

  private record(target: HitRecord['target'], tags: Tag[], info: HitInfo, dmg: number, before: number): HitRecord {
    const effective = Math.max(0, Math.min(dmg, before))
    const record: HitRecord = {
      target, source: info.source, ability: info.ability, effectId: info.effectId, tags,
      effective, overkill: Math.max(0, dmg - before), lethal: before - dmg <= 0,
    }
    this.dealt[info.source] += effective
    if (target !== 'enemy') this.bossDealt[info.source] += effective
    this.listeners.onHit?.(record)
    return record
  }

  private kill(e: LiveEnemy, record: HitRecord, kind: KillKind): void {
    if (!e.alive) return
    e.alive = false
    e.hp = 0
    e.killedBy = kind
    this.kills++
    this.burst(e.x, e.y, 10, e.accent, 180)
    this.dropLoot(e.x, e.y, e.elite ? 8 : 4)
    this.listeners.onKill?.(record, { defId: e.defId, elite: e.elite })
    this.addCombo()
    this.fireEvent('onKill', e.x, e.y, 0, -1, hypot(this.ball.vx, this.ball.vy), e, 0, kind)
    if (e.split) {
      for (let i = 0; i < e.split.count; i++) {
        const child = this.makeEnemy(e.split.id, e.x + (i === 0 ? -16 : 16), Math.min(e.y, this.room.height - 140), false, 1)
        child.vx = i === 0 ? -180 : 180
        child.vy = -160
        this.enemies.push(child)
      }
    }
    if (e.explodeOnDeath) this.explode(e.x, e.y, e.explodeOnDeath.radius, e.explodeOnDeath.damage * this.heat.enemyDamage, true)
    if (this.opts.lab && e.origin) this.labRespawns.push({ id: e.defId, x: clamp(e.x, 80, this.room.width - 80), y: 480, elite: e.elite, t: 1.5 })
  }

  private dropLoot(x: number, y: number, cinders: number): void {
    // Lab loot is decoration: it fades so a long session cannot pile it up.
    this.pickups.push({ x, y, vx: 0, vy: -80, r: 7, kind: 'cinder', value: cinders, life: this.opts.lab ? 10 : Infinity, homing: false })
    if (this.rng() < 0.08 * this.heat.healDrops) {
      this.pickups.push({ x, y: y - 10, vx: 40, vy: -120, r: 7, kind: 'heal', value: 12, life: 12, homing: false })
    }
  }

  private addCombo(): void {
    this.combo = Math.min(TUNE.comboCap + ((this.build.tags.combo ?? 0) > 0 ? 3 : 0), this.combo + 1)
    this.comboTimer = TUNE.comboWindow
    this.bestCombo = Math.max(this.bestCombo, this.combo)
    this.listeners.onCombo?.(this.combo)
    this.fireEvent('onCombo', this.ball.x, this.ball.y, 0, -1, hypot(this.ball.vx, this.ball.vy))
  }

  private comboMul(): number {
    const step = (this.build.tags.combo ?? 0) > 0 ? 0.1 : TUNE.comboStep
    return 1 + this.combo * step
  }

  objectiveText(): string {
    const boss = this.boss
    if (boss && boss.alive) {
      if (boss.collapse > 0) return 'The floor is failing. Get to solid ground.'
      if (boss.phase === 1) return `Crack the rivets (${boss.rivets.filter((r) => r.alive).length} left). The plate blunts everything else.`
      if (boss.phase === 2) return 'The heart is open. Ram it hard, then clear out before the stamp.'
      return 'No middle floor. Strike from the ledges and the spring.'
    }
    return this.room.objective
  }

  private updateBoss(dt: number): void {
    const boss = this.boss
    if (!boss || !boss.alive) return
    boss.hitFlash = Math.max(0, boss.hitFlash - dt)
    boss.recover = Math.max(0, boss.recover - dt)
    if (boss.collapse > 0) {
      boss.collapse -= dt
      if (boss.collapse <= 0) this.collapseFloor()
    }
    for (const r of boss.rivets) {
      r.x = boss.x + r.ox
      r.y = boss.y + r.oy
    }
    if (boss.recover <= 0) boss.attackCd -= dt
    if (boss.attack === 'slam') {
      boss.telegraph -= dt
      if (boss.telegraph <= 0 && boss.slamLive <= 0) {
        boss.slamLive = 0.16
        boss.attack = 'none'
        boss.recover = 0.9
        this.ring(boss.slamX, 600, 10)
        this.listeners.onShake?.(8)
      }
    } else if (boss.attack === 'barrage') {
      boss.telegraph -= dt
      if (boss.telegraph <= 0) {
        boss.attack = 'none'
        this.barrage(boss)
      }
    }
    if (boss.slamLive > 0) {
      boss.slamLive -= dt
      if (Math.abs(this.ball.x - boss.slamX) < 70 && this.ball.y > 520) this.hurt(18, 'boss')
      if (this.done) return
    }
    if (boss.attackCd <= 0 && boss.attack === 'none') {
      const wait = boss.phase === 1 ? 2.5 : boss.phase === 2 ? 2.05 : 1.55
      boss.attackCd = Math.max(0.9, wait - this.heat.bossTempo)
      if (this.rng() < 0.55) {
        boss.attack = 'slam'
        boss.telegraph = 0.7
        boss.slamX = clamp(this.ball.x + (this.rng() * 80 - 40), 120, this.room.width - 420)
      } else {
        boss.attack = 'barrage'
        boss.telegraph = 0.45
      }
    }
  }

  private barrage(boss: BossState): void {
    const n = boss.phase === 1 ? 4 : boss.phase === 2 ? 6 : 8
    for (let i = 0; i < n; i++) {
      const ang = Math.PI + (-0.6 + (1.2 * i) / (n - 1))
      const sp = 250 + boss.phase * 30
      this.bullets.push({
        x: boss.x - 40,
        y: boss.y - 20,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp,
        r: 7,
        damage: (10 + boss.phase * 2) * this.heat.enemyDamage,
        life: 4,
        friendly: false,
        reflected: false,
        color: '#ffb15a',
      })
    }
  }

  private collideBoss(): void {
    const boss = this.boss
    if (!boss || !boss.alive || this.phase > 0) return
    const stats = this.effectiveStats()
    for (const rivet of boss.rivets) {
      if (!rivet.alive) continue
      const d = hypot(this.ball.x - rivet.x, this.ball.y - rivet.y)
      if (d < this.ball.r + rivet.r) {
        const closing = hypot(this.ball.vx, this.ball.vy)
        if (closing < 180) {
          this.hurt(6, 'boss')
          this.ball.vx *= -0.4
          this.ball.vy *= -0.4
          return
        }
        const dmg = collisionDamage(stats, closing, this.comboMul(), false) * 0.7
        const dealt = this.damageEnemy(rivet, dmg, this.build.impactTags, { source: 'collision', kind: 'impact' })
        this.listeners.onImpactSfx?.(closing, 'clean')
        this.addCombo()
        const nx = (this.ball.x - rivet.x) / (d || 1)
        const ny = (this.ball.y - rivet.y) / (d || 1)
        this.bounceOff(rivet.x, rivet.y)
        this.fireEvent('onImpact', rivet.x, rivet.y, nx, ny, closing, rivet, dealt)
        return
      }
    }
    const d = hypot(this.ball.x - boss.x, this.ball.y - boss.y)
    if (d < this.ball.r + boss.r) {
      const closing = hypot(this.ball.vx, this.ball.vy)
      if (closing < 200) {
        this.hurt(8, 'boss')
        this.bounceOff(boss.x, boss.y)
        return
      }
      const crit = this.rng() < stats.critChance
      const raw = collisionDamage(stats, closing, this.comboMul(), crit)
      const dealt = this.damageEnemy(boss, raw, this.build.impactTags, { source: 'collision', kind: 'impact' })
      const nx = (this.ball.x - boss.x) / (d || 1)
      const ny = (this.ball.y - boss.y) / (d || 1)
      this.bounceOff(boss.x, boss.y)
      this.fireEvent('onImpact', boss.x, boss.y, nx, ny, closing, boss, dealt)
      if (this.done) return
      this.floater(boss.x, boss.y - 70, `${Math.round(dealt)}${boss.phase === 1 ? ' PLATE' : ''}`, boss.phase === 1 ? '#9aa4b2' : '#fff6ea')
      this.listeners.onImpactSfx?.(closing, boss.phase === 1 ? 'block' : 'clean')
      this.addCombo()
      const clean = boss.phase > 1 && closing >= stats.maxSpeed * TUNE.cleanRamRatio
      if (!clean) this.hurt(12 * stats.selfDamage * clamp(1 - dealt / 60, 0.2, 1), 'recoil')
    }
  }

  private bossMul(tags: Tag[], info: HitInfo): number {
    const boss = this.boss!
    let mul = 1
    if (info.source === 'status') mul *= BOSS_RULES.burn
    else if (info.kind === 'explode') mul *= BOSS_RULES.explosion
    else if (info.source === 'effect') mul *= BOSS_RULES.effect
    if (boss.phase === 1) mul *= BOSS_RULES.plate
    else if (boss.recover > 0) mul *= BOSS_RULES.recovering
    if (tags.includes('lightning')) mul *= 0.85
    return mul
  }

  private hurtBoss(amount: number, tags: Tag[], info: HitInfo): number {
    const boss = this.boss
    if (!boss || !boss.alive) return 0
    const dmg = amount * this.bossMul(tags, info)
    const before = boss.hp
    boss.hp -= dmg
    boss.hitFlash = 0.1
    this.record('boss', tags, info, dmg, before)
    if (info.source !== 'status') this.listeners.onShake?.(4)
    this.checkBossPhase()
    return dmg
  }

  private hurtRivet(r: Rivet, amount: number, tags: Tag[], info: HitInfo): number {
    const boss = this.boss
    if (!boss || !boss.alive || !r.alive) return 0
    let dmg = amount
    if (info.source === 'status') dmg *= BOSS_RULES.burn
    else if (info.kind === 'explode') dmg *= BOSS_RULES.explosion
    const before = r.hp
    r.hp -= dmg
    this.record('rivet', tags, info, dmg, before)
    if (info.source !== 'status') this.floater(r.x, r.y - 20, Math.round(dmg).toString(), '#ffe7c2')
    if (r.hp <= 0) {
      r.hp = 0
      r.alive = false
      this.burst(r.x, r.y, 8, '#ffd29a', 200)
      this.floater(r.x, r.y - 30, 'RIVET', '#ffb15a')
      const bossBefore = boss.hp
      boss.hp -= BOSS_RULES.rivetBreak
      this.record('boss', tags, info, BOSS_RULES.rivetBreak, bossBefore)
      this.listeners.onShake?.(6)
      if (boss.rivets.every((x) => !x.alive) && boss.phase === 1) this.setPhase(2)
      this.checkBossPhase()
    }
    return dmg
  }

  private checkBossPhase(): void {
    const boss = this.boss
    if (!boss) return
    if (boss.phase === 1 && boss.hp < boss.maxHp * 0.66) this.setPhase(2)
    if (boss.phase < 3 && boss.hp < boss.maxHp * 0.34) this.setPhase(3)
    if (boss.hp <= 0 && boss.alive) {
      boss.hp = 0
      boss.alive = false
      this.exitOpen = true
      this.burst(boss.x, boss.y, 24, '#ffb15a', 300)
      this.listeners.onToast?.('The Colossus breaks. The gate is open.')
      this.listeners.onFlash?.(0.6)
      this.dropLoot(boss.x, boss.y - 40, 20)
    }
  }

  private setPhase(phase: 1 | 2 | 3): void {
    const boss = this.boss
    if (!boss || boss.phase >= phase) return
    boss.phase = phase
    for (const r of boss.rivets) {
      if (phase > 1 && r.alive) {
        r.alive = false
        this.burst(r.x, r.y, 6, '#ffd29a', 160)
      }
    }
    this.listeners.onToast?.(phase === 2 ? 'Armor splits. The heart is open.' : 'The Colossus stamps. The middle floor is cracking.')
    this.listeners.onBossPhase?.(phase)
    this.listeners.onShake?.(10)
    if (phase === 2 && !boss.added) {
      boss.added = true
      this.enemies.push(this.makeEnemy('spark', boss.x - 200, 300, false, 1))
      this.enemies.push(this.makeEnemy('spark', boss.x - 260, 340, false, 1))
    }
    if (phase === 3) boss.collapse = BOSS_RULES.collapseWarning
  }

  /** Phase three terrain change. Runs only after the visible warning. */
  private collapseFloor(): void {
    for (const s of this.solids) {
      if (!s.breakable || !s.alive) continue
      s.alive = false
      this.room.hazards.push({ type: 'lava', x: s.x, y: 640, w: s.w, h: 100, dps: 40 })
      for (let i = 0; i < 6; i++) this.burst(s.x + (s.w * i) / 5, s.y, 3, '#ffb15a', 160)
    }
    this.listeners.onShake?.(12)
  }

  private bounceOff(x: number, y: number): void {
    const dx = this.ball.x - x
    const dy = this.ball.y - y
    const d = hypot(dx, dy) || 1
    const nx = dx / d
    const ny = dy / d
    const vn = this.ball.vx * nx + this.ball.vy * ny
    const rest = this.effectiveStats().restitution
    if (vn < 0) {
      this.ball.vx -= (1 + rest) * vn * nx
      this.ball.vy -= (1 + rest) * vn * ny
    }
    this.ball.x = x + nx * (this.ball.r + 78)
    this.ball.y = y + ny * (this.ball.r + 78)
  }

  private makeBoss(): void {
    const hp = 860 * this.heat.bossHp
    const x = this.room.width - 320
    const y = 530
    const rivet = (ox: number, oy: number): Rivet => ({
      kind: 'rivet', uid: this.uid++, ox, oy, x: x + ox, y: y + oy, vx: 0, vy: 0, r: 16,
      hp: BOSS_RULES.rivetHp, max: BOSS_RULES.rivetHp, alive: true,
      burn: 0, burnDps: 0, shock: 0, slow: 0, mass: 99, pinned: true,
    })
    this.boss = {
      kind: 'boss', uid: this.uid++, x, y, vx: 0, vy: 0, r: 64, mass: 99, pinned: true,
      hp, maxHp: hp, alive: true, burn: 0, burnDps: 0, shock: 0, slow: 0,
      phase: 1,
      rivets: [rivet(-36, -78), rivet(28, -24), rivet(-8, 36)],
      attackCd: 1.4, attack: 'none', telegraph: 0, slamX: 400, slamLive: 0, recover: 0,
      hitFlash: 0, added: false, collapse: 0,
    }
  }

  private updateBullets(dt: number): void {
    const magnetPull = this.magnetTimer > 0 || this.build.projectile === 'attract'
    for (const b of this.bullets) {
      b.life -= dt
      b.x += b.vx * dt
      b.y += b.vy * dt
      if (magnetPull && !b.friendly) {
        const dx = this.ball.x - b.x
        const dy = this.ball.y - b.y
        const d = hypot(dx, dy) || 1
        const reach = this.magnetTimer > 0 ? 420 : 260
        if (d < reach) {
          const s = (this.magnetTimer > 0 ? 900 : 420) * dt
          b.vx += (dx / d) * s
          b.vy += (dy / d) * s
        }
      }
      if (b.life <= 0) continue
      const hitBall = hypot(b.x - this.ball.x, b.y - this.ball.y) < b.r + this.ball.r
      if (hitBall && !b.friendly) {
        if (this.phase > 0) {
          b.life = 0
          continue
        }
        if (this.magnetTimer > 0) {
          this.redirect(b)
          continue
        }
        const sp = hypot(this.ball.vx, this.ball.vy)
        if (this.build.projectile === 'reflect-fast' && sp > 540) {
          this.redirect(b)
          continue
        }
        this.hurt(b.damage, 'projectile')
        b.life = 0
        this.burst(b.x, b.y, 4, b.color, 80)
        if (this.done) return
        continue
      }
      if (b.friendly) {
        for (const e of this.targets()) {
          if (hypot(b.x - e.x, b.y - e.y) < b.r + e.r) {
            const bonus = e.kind === 'enemy' ? 8 : BOSS_RULES.reflectBonus
            this.damageEnemy(e, b.damage + bonus, ['projectile'], { source: 'reflect', pierce: true, kind: 'impact' })
            b.life = 0
            break
          }
        }
      }
    }
    this.bullets = this.bullets.filter((b) => b.life > 0 && b.x > -40 && b.x < this.room.width + 40 && b.y < this.room.height + 80 && b.y > -200)
  }

  private redirect(b: Bullet): void {
    let tx = this.facing * 400
    let ty = 0
    let best = 1e9
    for (const e of this.targets()) {
      if (e.kind === 'rivet') continue
      const d = hypot(e.x - this.ball.x, e.y - this.ball.y)
      if (d < best) {
        best = d
        tx = e.x - b.x
        ty = e.y - b.y
      }
    }
    const len = hypot(tx, ty) || 1
    b.vx = (tx / len) * 460
    b.vy = (ty / len) * 460
    b.friendly = true
    b.reflected = true
    b.life = 2.4
    b.color = '#eafff6'
    this.listeners.onReflectSfx?.()
    this.ring(b.x, b.y, 6)
  }

  private updatePickups(dt: number): void {
    const magnet = (this.build.tags.magnetic ?? 0) > 0 || this.magnetTimer > 0
    for (const p of this.pickups) {
      p.life -= dt
      if (this.exitOpen) p.homing = true
      const dx = this.ball.x - p.x
      const dy = this.ball.y - p.y
      const d = hypot(dx, dy) || 1
      if (p.homing) {
        // Once the gate opens every drop flies to the ball: no waiting around.
        const speed = 900
        p.vx = (dx / d) * speed
        p.vy = (dy / d) * speed
        p.x += p.vx * dt
        p.y += p.vy * dt
      } else {
        p.vy += 900 * dt
        if (magnet && d < 280) {
          p.vx += (dx / d) * 700 * dt
          p.vy += (dy / d) * 700 * dt
        }
        p.x += p.vx * dt
        p.y += p.vy * dt
        const body: Body = { x: p.x, y: p.y, vx: p.vx, vy: p.vy, r: p.r, spin: 0 }
        for (const s of this.solids) {
          if (!s.alive) continue
          const c = resolveCircleAabb(body, s, 0.3, 0.6)
          if (c.hit && c.ny < -0.5 && s.move) {
            body.x += s.x - s.frameX
            body.y += s.y - s.frameY
          }
        }
        // Loot floats on slag: visible, reachable at a cost, and collected at the gate.
        for (const h of this.room.hazards) {
          if (h.type !== 'lava') continue
          if (body.x > h.x && body.x < h.x + h.w && body.y + body.r > h.y && body.y < h.y + h.h) {
            body.y = h.y - body.r
            if (body.vy > 0) body.vy = 0
            body.vx *= Math.exp(-3 * dt)
          }
        }
        // Nothing is lost to a pit: it waits at the lip of the room.
        if (body.y > this.room.height - body.r) {
          body.y = this.room.height - body.r
          body.vy = 0
        }
        p.x = body.x
        p.y = body.y
        p.vx = body.vx
        p.vy = body.vy
      }
      if (hypot(p.x - this.ball.x, p.y - this.ball.y) < this.ball.r + 12) this.collect(p)
    }
    this.pickups = this.pickups.filter((p) => p.life > 0)
  }

  private collect(p: Pickup): void {
    if (p.life <= 0) return
    p.life = 0
    if (p.kind === 'cinder') this.cinderPocket += p.value
    else this.heal(p.value)
    this.burst(p.x, p.y, 4, p.kind === 'cinder' ? '#ffb15a' : '#7dffb3', 80)
  }

  /** Credit everything still on the floor. Called once when the room is cleared. */
  collectRemaining(): void {
    for (const p of this.pickups) {
      if (p.life <= 0) continue
      if (p.kind === 'cinder') this.cinderPocket += p.value
      else this.hp = Math.min(this.maxHp, this.hp + p.value)
      p.life = 0
    }
    this.pickups = []
  }

  private updateHazards(dt: number): void {
    const hazards = this.room.hazards
    for (let i = 0; i < hazards.length; i++) {
      const h = hazards[i]!
      if (h.type === 'lava' && overlap(this.ball, h)) {
        this.hurt((h.dps ?? 34) * dt, 'lava')
        // Slag spits the ball back out: a mistake costs integrity, not the run.
        if (this.slagCd <= 0 && this.ball.vy > -200) {
          this.slagCd = 0.35
          this.ball.vy = -Math.max(700, Math.abs(hopVelocity(this.effectiveStats())) * 1.15)
          this.hurt((h.dps ?? 34) * 0.25, 'lava')
          this.burst(this.ball.x, h.y, 8, '#ff6a2a', 160)
          this.listeners.onShake?.(3)
        }
        this.burst(this.ball.x, this.ball.y, 1, '#ff6a2a', 40)
      } else if (h.type === 'spikes' && overlap(this.ball, h)) {
        this.hurt(h.damage ?? 12, 'spikes')
        this.ball.vy = Math.min(this.ball.vy, hopVelocity(this.effectiveStats()) * 0.75)
      } else if (h.type === 'crusher') {
        const pose = crusherPose(h, this.time)
        const rect = { x: h.x, y: pose.y, w: h.w, h: h.h }
        if (pose.smashing && overlap(this.ball, rect)) {
          if (this.crusherHits.get(i) !== pose.cycle) {
            this.crusherHits.set(i, pose.cycle)
            this.hurt(h.damage ?? 22, 'crusher')
            this.listeners.onShake?.(8)
          }
        }
      } else if (h.type === 'storm') {
        this.stormCd -= dt
        if (this.stormCd <= 0) {
          this.stormCd = h.interval ?? 0.75
          const fromLeft = this.rng() < 0.5
          const y = 120 + this.rng() * 460
          const sp = 240 + this.rng() * 80
          this.bullets.push({
            x: fromLeft ? 20 : this.room.width - 20,
            y,
            vx: fromLeft ? sp : -sp,
            vy: 40 + this.rng() * 40,
            r: 6,
            damage: 9 * this.heat.enemyDamage,
            life: 4,
            friendly: false,
            reflected: false,
            color: '#ffb15a',
          })
        }
      } else if (h.type === 'geyser') {
        if (geyserPhase(h, this.time).erupt && overlap(this.ball, { x: h.x, y: h.y - 80, w: h.w, h: h.h + 80 })) {
          this.hurt(48 * dt, 'geyser')
          this.ball.vy = Math.min(this.ball.vy, -200)
        }
      }
      if (this.done) return
    }
  }

  private tickStatus(dt: number): void {
    for (const e of this.targets()) {
      if (e.burn <= 0) continue
      e.burn -= dt
      const dealt = this.damageEnemy(e, e.burnDps * dt, ['fire'], { source: 'status', pierce: true, kind: 'burn' })
      if (dealt > 0 && this.fx() < dt * 8) this.burst(e.x, e.y - e.r, 1, '#ff6a2a', 30)
    }
  }

  private checkObjective(dt: number): void {
    if (this.room.rules?.includes('survival')) {
      this.survivalLeft = Math.max(0, this.survivalLeft - dt)
      if (this.survivalLeft <= 0) this.exitOpen = true
      return
    }
    if (this.room.type === 'boss') {
      this.exitOpen = !!this.boss && !this.boss.alive
      return
    }
    if (!this.enemies.some((e) => e.alive)) this.exitOpen = true
  }

  private tryExit(): void {
    if (!this.exitOpen || this.opts.lab || this.done) return
    const ex = this.room.exit
    const inside = this.ball.x > ex.x && this.ball.x < ex.x + ex.w && this.ball.y > ex.y && this.ball.y < ex.y + ex.h
    if (!inside) return
    if (this.room.rules?.includes('speed-gate')) {
      const sp = hypot(this.ball.vx, this.ball.vy)
      if (sp < (this.room.gateSpeed ?? 760)) {
        this.gateWarn = 0.35
        return
      }
    }
    this.ended = 'clear'
  }

  private updateRespawns(dt: number): void {
    if (!this.labRespawns.length) return
    for (const r of this.labRespawns) r.t -= dt
    const ready = this.labRespawns.filter((r) => r.t <= 0)
    this.labRespawns = this.labRespawns.filter((r) => r.t > 0)
    for (const r of ready) this.enemies.push({ ...this.makeEnemy(r.id, r.x, r.y, r.elite, 1), origin: true })
  }

  private respawnBall(): void {
    this.ball.x = this.room.player.x
    this.ball.y = this.room.player.y
    this.ball.vx = 0
    this.ball.vy = -200
    this.prevX = this.ball.x
    this.prevY = this.ball.y
  }

  /**
   * The single damage pipeline for the ball. Returns integrity actually lost.
   * See DAMAGE_RULES for which sources armor, phase, and the hit window affect.
   */
  hurt(amount: number, source: DamageSource): number {
    if (this.done || !(amount > 0)) return 0
    const rule = DAMAGE_RULES[source]
    if (rule.instant) {
      if (this.opts.god) {
        this.respawnBall()
        this.listeners.onToast?.('The lab catches the shell.')
        return 0
      }
      const lost = this.hp
      this.taken[source] += lost
      this.roomDamage += lost
      this.die(source)
      return lost
    }
    if (rule.phaseable && this.phase > 0) return 0
    if (rule.lock && this.hurtLock > 0) return 0
    let d = amount
    if (rule.mitigated) d *= 1 - this.effectiveStats().damageReduction
    if (this.opts.gentle) d *= 0.55
    d *= this.opts.assist ?? 1
    if (this.shield > 0) {
      const used = Math.min(this.shield, d)
      this.shield -= used
      d -= used
    }
    if (rule.lock) this.hurtLock = TUNE.playerHurtLock
    if (d <= 0) return 0
    this.hp -= d
    this.roomDamage += d
    this.taken[source] += d
    this.listeners.onHurt?.(source, d)
    this.fireEvent('onDamaged', this.ball.x, this.ball.y, 0, -1, d)
    // Low-integrity effects (Second Wind) resolve before the lethal check,
    // so a once-per-room weld can catch an otherwise fatal hit.
    if (this.hp <= this.maxHp * TUNE.lowHp) this.fireEvent('onLowHp', this.ball.x, this.ball.y, 0, -1, 0)
    if (this.hp <= 0) {
      if (this.opts.god) {
        this.hp = this.maxHp * 0.65
        if (source === 'lava' || source === 'geyser') this.respawnBall()
        this.listeners.onToast?.('The lab catches the shell.')
        return d
      }
      this.die(source)
    }
    return d
  }

  get lowHp(): boolean {
    return this.hp <= this.maxHp * TUNE.lowHp
  }

  private die(cause: DamageSource): void {
    if (this.done) return
    this.hp = 0
    this.ended = 'dead'
    this.cause = cause
  }

  heal(n: number): void {
    if (this.done || !(n > 0)) return
    this.hp = Math.min(this.maxHp, this.hp + n)
  }

  addEnergy(n: number): void {
    if (this.done) return
    this.energy = clamp(this.energy + n, 0, this.effectiveStats().energyMax)
  }

  addShield(n: number): void {
    if (this.done) return
    this.shield = Math.min(60, this.shield + n)
  }

  explode(x: number, y: number, radius: number, damage: number, hurtSelf: boolean, effectId?: string): void {
    if (this.done) return
    this.ring(x, y, 16)
    this.burst(x, y, 12, '#ffb15a', 240)
    this.listeners.onShake?.(7)
    for (const e of this.targets()) {
      if (hypot(e.x - x, e.y - y) <= radius + e.r) {
        this.damageEnemy(e, damage, ['explosive', 'area'], { source: 'effect', effectId, pierce: true, kind: 'explode' })
        this.knockback(e, e.x - x, e.y - y, 300)
      }
    }
    if (hurtSelf && hypot(this.ball.x - x, this.ball.y - y) <= radius * 0.75) this.hurt(Math.min(26, damage * 0.45), 'explosion')
  }

  chain(x: number, y: number, jumps: number, range: number, damage: number, effectId?: string): void {
    if (this.done) return
    const hit = new Set<number>()
    let cx = x
    let cy = y
    for (let i = 0; i < jumps; i++) {
      let best: FxEnemy | undefined
      let bestD = range
      for (const e of this.targets()) {
        if (hit.has(e.uid)) continue
        const d = Math.max(0, hypot(e.x - cx, e.y - cy) - (e.kind === 'boss' ? e.r : 0))
        if (d < bestD) {
          best = e
          bestD = d
        }
      }
      if (!best) break
      hit.add(best.uid)
      this.arc(cx, cy, best.x, best.y)
      this.damageEnemy(best, damage * (1 - i * 0.18), ['lightning'], { source: 'effect', effectId, pierce: true, kind: 'impact' })
      cx = best.x
      cy = best.y
    }
  }

  attract(radius: number, strength: number, target: 'projectile' | 'pickup' | 'enemy', dt: number): void {
    if (target === 'projectile') {
      for (const b of this.bullets) {
        if (b.friendly) continue
        const dx = this.ball.x - b.x
        const dy = this.ball.y - b.y
        const d = hypot(dx, dy) || 1
        if (d < radius) {
          b.vx += (dx / d) * strength * dt
          b.vy += (dy / d) * strength * dt
        }
      }
    } else if (target === 'pickup') {
      for (const p of this.pickups) {
        const dx = this.ball.x - p.x
        const dy = this.ball.y - p.y
        const d = hypot(dx, dy) || 1
        if (d < radius) {
          p.vx += (dx / d) * strength * dt
          p.vy += (dy / d) * strength * dt
        }
      }
    } else {
      for (const e of this.enemies) {
        if (!e.alive || e.pinned) continue
        const dx = this.ball.x - e.x
        const dy = this.ball.y - e.y
        const d = hypot(dx, dy) || 1
        if (d < radius) {
          e.vx += (dx / d) * strength * 0.6 * dt
          e.vy += (dy / d) * strength * 0.6 * dt
        }
      }
    }
  }

  knockback(e: FxEnemy, nx: number, ny: number, force: number): void {
    if (e.pinned || e.kind !== 'enemy') return
    const len = hypot(nx, ny) || 1
    e.vx += (nx / len) * (force / Math.max(0.4, e.mass))
    e.vy += (ny / len) * (force / Math.max(0.4, e.mass)) * 0.6
  }

  applyStatus(e: FxEnemy, status: 'burn' | 'shock' | 'slow', duration: number, magnitude: number): void {
    if (!e.alive) return
    if (status === 'burn') {
      e.burn = Math.max(e.burn, duration)
      e.burnDps = Math.max(e.burnDps, magnitude)
    } else if (status === 'shock') e.shock = Math.max(e.shock, duration)
    else e.slow = Math.max(e.slow, duration)
  }

  impulse(along: 'velocity' | 'up' | 'normal', amount: number, nx: number, ny: number): void {
    if (along === 'up') this.ball.vy -= amount / Math.pow(this.stats.mass, 0.35)
    else if (along === 'normal') {
      this.ball.vx += nx * amount
      this.ball.vy += ny * amount
    } else {
      const sp = hypot(this.ball.vx, this.ball.vy) || 1
      this.ball.vx += (this.ball.vx / sp) * amount
      this.ball.vy += (this.ball.vy / sp) * amount
    }
    this.boost = Math.max(this.boost, 0.25)
  }

  controlTax(duration: number, mul: number): void {
    this.taxLeft = Math.max(this.taxLeft, duration)
    this.controlMul = mul
  }

  addInstability(n: number): void {
    if (this.done) return
    this.instability = Math.min(100, this.instability + n)
    if (this.instability >= 100) {
      this.instability = 0
      this.explode(this.ball.x, this.ball.y, 150, 62, true, 'volatile-vent')
      this.listeners.onToast?.('The core vents.')
    }
  }

  discover(id: string): void {
    if (this.discovered.has(id)) return
    this.discovered.add(id)
    this.listeners.onDiscovery?.(id)
  }

  private fireEvent(
    event: HookEvent,
    x: number,
    y: number,
    nx: number,
    ny: number,
    speed: number,
    enemy?: FxEnemy,
    dealt = 0,
    killedBy?: KillKind,
    dt = this.dt,
  ): void {
    if (this.done) return
    triggerEffects(this.build.effects, event, this, {
      event, x, y, nx, ny, speed, impact: dealt || collisionDamage(this.effectiveStats(), speed, this.comboMul(), false),
      enemy, dealt, killedBy, combo: this.combo, dt,
    })
  }

  private makeEnemy(id: string, x: number, y: number, elite: boolean, scale: number): LiveEnemy {
    const def = ENEMY_MAP[id]
    if (!def) throw new Error(`Unknown construct: ${id}`)
    const hp = def.hp * scale * (elite ? 1.35 * this.heat.eliteHp : 1)
    return {
      kind: 'enemy',
      uid: this.uid++,
      defId: def.id,
      name: elite ? `Elite ${def.name}` : def.name,
      x, y, vx: 0, vy: 0, r: def.r * (elite ? 1.08 : 1),
      hp, maxHp: hp, alive: true,
      burn: 0, burnDps: 0, shock: 0, slow: 0,
      mass: def.mass, pinned: !!def.pinned,
      facing: -1, stun: 0, hitCd: 0, attackCd: 0.6 + this.rng() * 0.6, windup: 0, elite,
      flying: !!def.flying, shield: !!def.shield, shieldBreak: def.shieldBreak ?? 36,
      armorGate: def.armorGate ?? 0, armorMul: def.armorMul ?? 1,
      contact: def.contact * (1 + this.opts.depth * 0.04) * this.heat.enemyDamage,
      color: def.color, accent: def.accent, shape: def.shape, behavior: def.behavior,
      moveSpeed: def.speed * (elite ? 1.08 : 1),
      resists: def.resists ? def.resists.map((r) => ({ ...r })) : [],
      split: def.split, explodeOnDeath: def.explode, shot: def.shot, keepAway: def.keepAway, pull: def.pull,
      hitFlash: 0, blinkCd: 0, origin: false,
    }
  }

  private burst(x: number, y: number, n: number, color: string, speed: number): void {
    const count = Math.round(n * this.fxLevel)
    for (let i = 0; i < count; i++) {
      const a = this.fx() * Math.PI * 2
      const s = speed * (0.3 + this.fx())
      this.particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40,
        life: 0.25 + this.fx() * 0.3, max: 0.5, size: 2 + this.fx() * 2.5,
        color, kind: 'spark',
      })
    }
  }

  private ring(x: number, y: number, size: number): void {
    this.particles.push({ x, y, vx: 0, vy: 0, life: 0.25, max: 0.25, size, color: '#fff6ea', kind: 'ring' })
  }

  private arc(x: number, y: number, x2: number, y2: number): void {
    this.particles.push({ x, y, x2, y2, vx: 0, vy: 0, life: 0.12, max: 0.12, size: 2, color: '#d7f4ff', kind: 'arc' })
  }

  private floater(x: number, y: number, text: string, color: string): void {
    this.floaters.push({ x, y, text, life: 0.7, color })
  }

  takeCinders(): number {
    const n = this.cinderPocket
    this.cinderPocket = 0
    return n
  }
}

function overlap(ball: Body, rect: { x: number; y: number; w: number; h: number }): boolean {
  const cx = clamp(ball.x, rect.x, rect.x + rect.w)
  const cy = clamp(ball.y, rect.y, rect.y + rect.h)
  const dx = ball.x - cx
  const dy = ball.y - cy
  return dx * dx + dy * dy <= ball.r * ball.r
}
