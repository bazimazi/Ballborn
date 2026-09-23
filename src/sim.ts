import { TUNE } from './tune'
import { ballRadius, collisionDamage, hopVelocity, horizontalAccel, resolveCircleAabb, verticalAccel, type Body } from './physics'
import { triggerEffects, type EffectApi, type FxEnemy } from './effects'
import { ENEMY_MAP } from './data/enemies'
import type { EnemyDef, KillKind, RoomTemplate, Tag } from './types'
import type { CompiledBuild } from './types'
import type { FrameInput } from './input'
import { clamp, hypot } from './util'

export interface LiveEnemy extends FxEnemy {
  defId: string
  name: string
  facing: number
  stun: number
  hitCd: number
  attackCd: number
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
  pull?: number
  maxHp: number
  hitFlash: number
  blinkCd: number
  killedBy?: KillKind
  pinned: boolean
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
  kind: 'cinder' | 'heal'
  value: number
  life: number
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

export interface Rivet {
  ox: number
  oy: number
  hp: number
  max: number
  alive: boolean
}

export interface BossState {
  x: number
  y: number
  r: number
  hp: number
  maxHp: number
  phase: 1 | 2 | 3
  rivets: Rivet[]
  attackCd: number
  attack: 'none' | 'slam' | 'barrage'
  telegraph: number
  slamX: number
  slamLive: number
  hitFlash: number
  added: boolean
}

export interface SimListeners {
  onDeath?: (cause: string) => void
  onClear?: () => void
  onDiscovery?: (id: string) => void
  onToast?: (text: string) => void
  onShake?: (mag: number) => void
  onHitstop?: (time: number) => void
  onImpactSfx?: (speed: number) => void
  onBounceSfx?: (speed: number) => void
  onHurt?: () => void
  onAbility?: (kind: string) => void
  onCombo?: (n: number) => void
  onKill?: (info: { reflected: boolean; slam: boolean }) => void
  onSpeed?: (speed: number) => void
  onHit?: (damage: number) => void
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

export class Simulation implements EffectApi {
  ball: Body
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
  instability = 0
  combo = 0
  comboTimer = 0
  bestCombo = 0
  grounded = false
  groundTime = 0
  coyote = 0
  jumpBuffer = 0
  facing = 1
  hurtLock = 0
  time = 0
  exitOpen = false
  ended: 'play' | 'dead' | 'clear' = 'play'
  cause = ''
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
  abilityDamage = 0
  roomDamage = 0
  reflectedKill = false
  slamKill = false
  private uid = 1
  private crusherHits = new Map<number, number>()
  private stormCd = 0.4
  private riding: Solid | null = null
  private pendingReflected = false
  private labRespawns: { id: string; x: number; y: number; elite: boolean; t: number }[] = []
  readonly rng: () => number

  constructor(
    public room: RoomTemplate,
    public build: CompiledBuild,
    public opts: {
      hp: number
      energy: number
      heat: number
      depth: number
      curse: boolean
      gentle: boolean
      god: boolean
      lab: boolean
      rng: () => number
    },
    public listeners: SimListeners = {},
  ) {
    this.rng = opts.rng
    this.maxHp = build.stats.maxHp
    this.hp = clamp(opts.hp, 1, this.maxHp)
    this.energy = clamp(opts.energy, 0, build.stats.energyMax)
    this.ball = {
      x: room.player.x,
      y: room.player.y,
      vx: 0,
      vy: 0,
      r: ballRadius(build.stats.mass),
      spin: 0,
    }
    this.survivalLeft = room.survival ?? 0
    this.solids.push(
      { x: -50, y: -600, w: 50, h: room.height + 1200, kind: 'metal', conveyor: 0, baseX: -50, baseY: -600, frameX: -50, frameY: -600, breakable: false, alive: true },
      { x: room.width, y: -600, w: 50, h: room.height + 1200, kind: 'metal', conveyor: 0, baseX: room.width, baseY: -600, frameX: room.width, frameY: -600, breakable: false, alive: true },
      { x: -50, y: -48, w: room.width + 100, h: 48, kind: 'metal', conveyor: 0, baseX: -50, baseY: -48, frameX: -50, frameY: -48, breakable: false, alive: true },
    )
    for (const p of room.platforms) {
      const s: Solid = {
        x: p.x, y: p.y, w: p.w, h: p.h ?? 22,
        kind: p.kind ?? 'metal',
        conveyor: p.conveyor ?? 0,
        move: p.move,
        baseX: p.x, baseY: p.y, frameX: p.x, frameY: p.y,
        breakable: !!p.breakable,
        alive: true,
      }
      this.solids.push(s)
    }
    if ((opts.curse || (opts.heat >= 2 && (room.type === 'combat' || room.type === 'elite'))) && room.type !== 'boss') {
      this.room = {
        ...room,
        hazards: [
          ...room.hazards,
          { type: 'geyser', x: room.width * 0.38, y: 590, w: 54, h: 20, period: 2.5, phase: 0.2 },
          { type: 'geyser', x: room.width * 0.68, y: 590, w: 54, h: 20, period: 2.8, phase: 1.1 },
        ],
      }
    }
    const scale = (1 + opts.depth * 0.08) * (1 + opts.heat * 0.1) * (opts.gentle ? 0.75 : 1)
    const spawns = opts.lab
      ? [
          { id: 'grunt', x: 640, y: 500, elite: false },
          { id: 'plate', x: 980, y: 500, elite: false },
          { id: 'bolt', x: 1280, y: 500, elite: false },
          { id: 'spark', x: 800, y: 320, elite: false },
        ]
      : room.spawns
    for (const s of spawns) this.enemies.push(this.makeEnemy(s.id, s.x, s.y, !!s.elite, scale))
    if (room.type === 'boss') this.makeBoss()
    if (!this.enemies.some((e) => e.alive) && room.type === 'traversal' && !room.rules?.includes('survival')) this.exitOpen = true
    this.fireEvent('onRoomStart', this.ball.x, this.ball.y, 0, 0, 0)
  }

  get stats() {
    return this.effectiveStats()
  }

  private effectiveStats() {
    const s = { ...this.build.stats }
    if (this.taxLeft > 0) s.airControl *= this.controlMul
    if (this.room.rules?.includes('low-friction')) s.friction *= 0.28
    if (this.room.rules?.includes('high-gravity')) s.gravity *= 1.48
    if (this.opts.heat >= 3) s.gravity *= 1.08
    return s
  }

  syncBuild(build: CompiledBuild): void {
    const ratio = this.maxHp > 0 ? this.hp / this.maxHp : 1
    this.build = build
    this.maxHp = build.stats.maxHp
    this.hp = clamp(this.maxHp * ratio, 1, this.maxHp)
    this.ball.r = ballRadius(build.stats.mass)
    this.energy = Math.min(this.energy, build.stats.energyMax)
  }

  update(dt: number, input: FrameInput, mouse: { x: number; y: number } | null): void {
    if (this.ended !== 'play') return
    this.time += dt
    this.gateWarn = Math.max(0, this.gateWarn - dt)
    const stats = this.effectiveStats()
    this.energy = Math.min(stats.energyMax, this.energy + stats.energyRegen * dt)
    this.abilityCd = Math.max(0, this.abilityCd - dt)
    this.hurtLock = Math.max(0, this.hurtLock - dt)
    this.phase = Math.max(0, this.phase - dt)
    this.magnetTimer = Math.max(0, this.magnetTimer - dt)
    this.taxLeft = Math.max(0, this.taxLeft - dt)
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

    const speedNow = hypot(this.ball.vx, this.ball.vy)
    const steps = clamp(Math.ceil(speedNow / 420), 1, 5)
    const sub = dt / steps
    for (let i = 0; i < steps; i++) this.substep(sub, ix, input.y, input.hopHeld)

    if (this.riding) {
      this.ball.x += this.riding.x - this.riding.frameX
      this.ball.y += this.riding.y - this.riding.frameY
    }

    this.updateEnemies(dt)
    this.collideEnemies()
    this.updateBoss(dt)
    this.updateBullets(dt)
    this.updatePickups(dt)
    this.updateHazards(dt)
    this.tickStatus(dt)
    this.fireEvent('onTick', this.ball.x, this.ball.y, 0, -1, hypot(this.ball.vx, this.ball.vy), undefined, dt)
    this.updateRespawns(dt)
    this.checkObjective(dt)
    this.tryExit()
    if (this.ball.y > this.room.height + 150) this.hurt(999, 'pit')
    const sp = hypot(this.ball.vx, this.ball.vy)
    if (sp > 40) this.listeners.onSpeed?.(sp)
    this.trail.push({ x: this.ball.x, y: this.ball.y })
    if (this.trail.length > 16) this.trail.shift()
    this.particles = this.particles.filter((p) => {
      p.life -= dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.vy += 500 * dt
      return p.life > 0
    })
    if (this.particles.length > 420) this.particles.splice(0, this.particles.length - 420)
    for (const f of this.floaters) {
      f.life -= dt
      f.y -= 28 * dt
    }
    this.floaters = this.floaters.filter((f) => f.life > 0)
    if (this.grounded && sp > 80) {
      if (this.rng() < dt * 10) this.burst(this.ball.x, this.ball.y + this.ball.r * 0.6, 1, '#c7b8a4', 40)
    }
  }

  private substep(dt: number, ix: number, iy: number, hopHeld: boolean): void {
    const stats = this.effectiveStats()
    const ax = horizontalAccel(stats, ix, this.ball.vx, this.grounded)
    const ay = verticalAccel(stats, hopHeld && iy < 0, iy > 0, this.grounded)
    this.ball.vx += ax * dt
    this.ball.vy += ay * dt
    if (Math.abs(this.ball.vx) > stats.maxSpeed) this.ball.vx = Math.sign(this.ball.vx) * stats.maxSpeed
    const vCap = stats.maxSpeed * 1.5
    if (Math.abs(this.ball.vy) > vCap) this.ball.vy = Math.sign(this.ball.vy) * vCap
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
    // Floor contact happens every frame. A per-frame tangent multiplier caps
    // roll speed far below maxSpeed. Ground drag is the friction force.
    for (const s of this.solids) {
      if (!s.alive) continue
      const c = resolveCircleAabb(this.ball, s, stats.restitution, 1, 0, 0)
      if (!c.hit) continue
      if (c.ny < -0.55) {
        this.grounded = true
        this.riding = s
        if (Math.abs(this.ball.vy) < 48) this.ball.vy = 0
        if (s.kind === 'spring' && (c.impactSpeed > 60 || hopHeld)) {
          this.ball.vy = -Math.max(Math.abs(hopVelocity(stats)), 760 / Math.pow(stats.mass, 0.38))
          this.grounded = false
          this.burst(this.ball.x, s.y, 6, '#ffb15a', 160)
          this.listeners.onBounceSfx?.(500)
        }
        if (s.kind === 'conveyor') this.ball.vx += s.conveyor * dt * 4
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

  private useAbility(input: FrameInput): void {
    const ability = this.build.ability
    if (!ability || this.abilityCd > 0 || this.energy < ability.energy) return
    this.energy -= ability.energy
    this.abilityCd = ability.cooldown
    this.opts && (this.listeners.onAbility?.(ability.kind))
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
      this.burst(this.ball.x, this.ball.y, 8, this.build.visual.trail, 220)
    } else if (ability.kind === 'slam') {
      this.ball.vy = Math.max(this.ball.vy, 980 / Math.pow(stats.mass, 0.2))
      this.slamArmed = true
    } else if (ability.kind === 'burst') {
      this.ball.vy = Math.min(this.ball.vy, -640 / Math.pow(stats.mass, 0.35))
      this.ball.vx += input.x * 220
      this.phase = 0.08
      this.blastArea(this.ball.x, this.ball.y, 96, 16, true)
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
    this.blastArea(this.ball.x, this.ball.y, 120 + impactSpeed * 0.05, dmg, true)
    this.listeners.onShake?.(Math.min(14, impactSpeed / 80))
    this.listeners.onHitstop?.(0.045)
    this.ring(this.ball.x, this.ball.y, 18)
    this.listeners.onAbility?.('slam-land')
  }

  private blastArea(x: number, y: number, radius: number, dmg: number, fromAbility: boolean): void {
    for (const e of this.enemies) {
      if (!e.alive) continue
      if (hypot(e.x - x, e.y - y) <= radius + e.r) {
        if (fromAbility) this.slamKill = true
        this.damageEnemy(e, dmg, ['area', 'impact'], { source: fromAbility ? 'ability' : 'effect', kind: 'impact' })
        this.knockback(e, (e.x - x) || 1, (e.y - y) || -0.2, 380)
      }
    }
    if (this.boss && this.boss.hp > 0 && hypot(this.boss.x - x, this.boss.y - y) < radius + this.boss.r) {
      this.hurtBoss(dmg, fromAbility)
    }
  }

  private updateEnemies(dt: number): void {
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
      } else if (e.behavior === 'blink') {
        const d = hypot(this.ball.x - e.x, this.ball.y - e.y)
        if (d < 150 && e.blinkCd <= 0) {
          const ang = this.rng() * Math.PI * 2
          e.x = clamp(this.ball.x + Math.cos(ang) * 220, 40, this.room.width - 40)
          e.y = clamp(this.ball.y - 80 + Math.sin(ang) * 40, 80, 560)
          e.blinkCd = 1.4
          this.burst(e.x, e.y, 6, e.accent, 80)
        }
        e.vx *= Math.exp(-2 * dt)
        e.vy *= Math.exp(-2 * dt)
      } else {
        const dir = Math.sign(this.ball.x - e.x) || e.facing
        e.facing = dir
        const ahead = this.solidAt(e.x + dir * (e.r + 16), e.y + e.r)
        const here = this.solidAt(e.x, e.y + e.r)
        if (here && !ahead) e.facing *= -1
        else e.vx += e.facing * e.moveSpeed * 3.2 * slowMul * dt
        e.vy += 1600 * dt
        e.vx *= Math.exp(-2.4 * dt)
      }
      if (e.pull && e.alive) {
        const d = hypot(this.ball.x - e.x, this.ball.y - e.y)
        if (d < 280 && d > 1) {
          const f = (e.pull / Math.max(0.55, this.effectiveStats().mass)) * dt
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
          if (c.hit && c.ny < -0.5) onFloor = true
        }
        e.x = body.x
        e.y = body.y
        e.vx = body.vx
        e.vy = body.vy
        if (onFloor && Math.abs(e.vy) < 50) e.vy = 0
      }
      if (e.shot && e.attackCd <= 0 && e.alive) {
        this.shoot(e)
        e.attackCd = e.shot.period
      }
      if (e.explodeOnDeath && e.defId === 'cask' && hypot(e.x - this.ball.x, e.y - this.ball.y) < e.r + this.ball.r + 6) {
        this.kill(e, 'impact')
      }
    }
    this.separateEnemies()
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
        const d = hypot(dx, dy) || 0.001
        const min = a.r + b.r
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
      damage: e.shot.damage * (1 + this.opts.heat * 0.08),
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
        if (incoming < 150 && this.phase <= 0) this.hurt(e.contact * 0.35 * (this.opts.gentle ? 0.55 : 1), 'enemy')
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
    }
    this.collideBoss()
  }

  private resolveHit(e: LiveEnemy, nx: number, ny: number, closing: number): void {
    const stats = this.effectiveStats()
    const crit = this.rng() < stats.critChance
    const comboMul = this.comboMul()
    let raw = collisionDamage(stats, closing, comboMul, crit)
    raw += stats.contact * (0.35 + closing / 900)
    const fromAbove = ny < -0.45
    let blocked = false
    if (e.shield && !fromAbove && (this.ball.x - e.x) * e.facing > 0 && raw < e.shieldBreak) {
      raw *= 0.18
      blocked = true
    }
    const dealt = this.damageEnemy(e, raw, this.build.impactTags, { kind: 'impact', source: 'collision', pierce: false })
    this.fireEvent('onImpact', e.x, e.y, nx, ny, closing, e, 0, dealt)
    const dirty = clamp(1 - dealt / 48, 0.18, 1)
    const self = e.contact * stats.selfDamage * dirty * (this.opts.gentle ? 0.55 : 1)
    if (!blocked) this.hurt(self, 'enemy')
    else this.hurt(self * 0.4, 'enemy')
    this.squash = 0.12
    this.listeners.onImpactSfx?.(closing)
    this.listeners.onShake?.(clamp(dealt / 18, 1.5, 12))
    if (dealt > 24) this.listeners.onHitstop?.(this.opts.gentle ? 0 : clamp(dealt / 900, 0.02, 0.05))
    this.burst(e.x, e.y, blocked ? 3 : 6 + dealt / 12, crit ? '#ffe28a' : this.build.visual.trail, 80 + closing)
    this.floater(e.x, e.y - e.r, `${Math.round(dealt)}${crit ? '!' : ''}${blocked ? ' block' : ''}`, crit ? '#ffe28a' : '#fff6ea')
    if (dealt > 8) this.addCombo()
    this.listeners.onHit?.(dealt)
  }

  damageEnemy(
    e: FxEnemy,
    amount: number,
    tags: Tag[],
    opts?: { pierce?: boolean; kind?: KillKind; source?: 'collision' | 'ability' | 'effect' },
  ): number {
    const live = e as LiveEnemy
    if (!live.alive) return 0
    let dmg = amount
    if (!opts?.pierce && live.armorGate && dmg < live.armorGate && opts?.kind === 'impact') dmg *= live.armorMul
    if (tags.includes('lightning')) {
      const res = live.resists.find((r) => r.tag === 'lightning')
      if (res) dmg *= res.mul
    }
    dmg = Math.max(0, dmg)
    if (opts?.source === 'ability') this.abilityDamage += dmg
    live.hp -= dmg
    live.hitFlash = 0.08
    if (live.hp <= 0) this.kill(live, opts?.kind ?? 'impact')
    return dmg
  }

  private kill(e: LiveEnemy, kind: KillKind): void {
    if (!e.alive && e.killedBy) return
    e.alive = false
    e.hp = 0
    e.killedBy = kind
    this.burst(e.x, e.y, 10, e.accent, 180)
    this.pickups.push({ x: e.x, y: e.y, vx: 0, vy: -80, kind: 'cinder', value: e.elite ? 8 : 4, life: 8 })
    if (this.rng() < 0.08) this.pickups.push({ x: e.x, y: e.y - 10, vx: 40, vy: -120, kind: 'heal', value: 12, life: 8 })
    this.listeners.onKill?.({ reflected: this.pendingReflected, slam: this.slamKill })
    this.pendingReflected = false
    this.slamKill = false
    this.addCombo()
    this.fireEvent('onKill', e.x, e.y, 0, -1, hypot(this.ball.vx, this.ball.vy), e, 0, 0, kind)
    if (e.split) {
      for (let i = 0; i < e.split.count; i++) {
        const child = this.makeEnemy(e.split.id, e.x + (i === 0 ? -16 : 16), e.y, false, 1)
        child.vx = i === 0 ? -180 : 180
        child.vy = -160
        this.enemies.push(child)
      }
    }
    if (e.explodeOnDeath) this.explode(e.x, e.y, e.explodeOnDeath.radius, e.explodeOnDeath.damage, true)
    if (this.opts.lab) this.labRespawns.push({ id: e.defId, x: e.x, y: 480, elite: e.elite, t: 1.5 })
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

  private updateBoss(dt: number): void {
    const boss = this.boss
    if (!boss || boss.hp <= 0) return
    boss.hitFlash = Math.max(0, boss.hitFlash - dt)
    boss.attackCd -= dt
    if (boss.attack === 'slam') {
      boss.telegraph -= dt
      if (boss.telegraph <= 0 && boss.slamLive <= 0) {
        boss.slamLive = 0.16
        boss.attack = 'none'
        this.ring(boss.slamX, 600, 10)
        this.listeners.onShake?.(8)
      }
    }
    if (boss.slamLive > 0) {
      boss.slamLive -= dt
      if (Math.abs(this.ball.x - boss.slamX) < 70 && this.ball.y > 520) this.hurt(18, 'boss')
    }
    if (boss.attackCd <= 0 && boss.attack === 'none') {
      const wait = boss.phase === 1 ? 2.5 : boss.phase === 2 ? 2.05 : 1.55
      boss.attackCd = wait - this.opts.heat * 0.12
      if (this.rng() < 0.55) {
        boss.attack = 'slam'
        boss.telegraph = 0.7
        boss.slamX = clamp(this.ball.x + (this.rng() * 80 - 40), 120, this.room.width - 420)
      } else {
        boss.attack = 'none'
        this.barrage(boss)
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
        damage: 10 + boss.phase * 2,
        life: 4,
        friendly: false,
        reflected: false,
        color: '#ffb15a',
      })
    }
  }

  private collideBoss(): void {
    const boss = this.boss
    if (!boss || boss.hp <= 0 || this.phase > 0) return
    for (const rivet of boss.rivets) {
      if (!rivet.alive) continue
      const x = boss.x + rivet.ox
      const y = boss.y + rivet.oy
      const d = hypot(this.ball.x - x, this.ball.y - y)
      if (d < this.ball.r + 16) {
        const closing = hypot(this.ball.vx, this.ball.vy)
        if (closing < 180) {
          this.hurt(6, 'boss')
          this.ball.vx *= -0.4
          this.ball.vy *= -0.4
          return
        }
        const dmg = collisionDamage(this.effectiveStats(), closing, this.comboMul(), false) * 0.7
        rivet.hp -= dmg
        this.floater(x, y - 20, Math.round(dmg).toString(), '#ffe7c2')
        this.listeners.onHit?.(dmg)
        this.listeners.onImpactSfx?.(closing)
        this.addCombo()
        if (rivet.hp <= 0) {
          rivet.alive = false
          this.burst(x, y, 8, '#ffd29a', 200)
          boss.hp -= 40
          this.floater(x, y - 30, 'RIVET', '#ffb15a')
        }
        this.bounceOff(x, y)
        if (boss.rivets.every((r) => !r.alive) && boss.phase === 1) this.setPhase(2)
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
      let dmg = collisionDamage(this.effectiveStats(), closing, this.comboMul(), this.rng() < this.stats.critChance)
      if (boss.phase === 1) dmg *= 0.38
      this.hurtBoss(dmg, false)
      this.bounceOff(boss.x, boss.y)
      this.fireEvent('onImpact', boss.x, boss.y, (this.ball.x - boss.x) / (d || 1), (this.ball.y - boss.y) / (d || 1), closing, undefined, 0, dmg)
      this.floater(boss.x, boss.y - 70, Math.round(dmg).toString(), '#fff6ea')
      this.addCombo()
      const self = 12 * this.stats.selfDamage * clamp(1 - dmg / 60, 0.2, 1)
      this.hurt(self, 'boss')
    }
  }

  private hurtBoss(dmg: number, ability: boolean): void {
    const boss = this.boss
    if (!boss || boss.hp <= 0) return
    if (ability) this.abilityDamage += dmg
    boss.hp -= dmg
    boss.hitFlash = 0.1
    this.listeners.onHit?.(dmg)
    this.listeners.onShake?.(6)
    if (boss.phase === 1 && boss.hp < boss.maxHp * 0.66) this.setPhase(2)
    if (boss.phase < 3 && boss.hp < boss.maxHp * 0.34) this.setPhase(3)
    if (boss.hp <= 0) {
      boss.hp = 0
      this.exitOpen = true
      this.burst(boss.x, boss.y, 24, '#ffb15a', 300)
      this.listeners.onToast?.('The Colossus breaks. The gate is open.')
      this.pickups.push({ x: boss.x, y: boss.y, vx: 0, vy: -40, kind: 'cinder', value: 20, life: 12 })
    }
  }

  private setPhase(phase: 1 | 2 | 3): void {
    const boss = this.boss
    if (!boss || boss.phase >= phase) return
    boss.phase = phase
    this.listeners.onToast?.(phase === 2 ? 'Armor splits. The heart is open.' : 'The floor gives way.')
    this.listeners.onShake?.(10)
    if (phase === 2 && !boss.added) {
      boss.added = true
      this.enemies.push(this.makeEnemy('spark', boss.x - 200, 300, false, 1))
      this.enemies.push(this.makeEnemy('spark', boss.x - 260, 340, false, 1))
    }
    if (phase === 3) {
      for (const s of this.solids) {
        if (!s.breakable) continue
        s.alive = false
        this.room.hazards = [...this.room.hazards, { type: 'lava', x: s.x, y: 640, w: s.w, h: 100, dps: 40 }]
      }
    }
  }

  private bounceOff(x: number, y: number): void {
    const dx = this.ball.x - x
    const dy = this.ball.y - y
    const d = hypot(dx, dy) || 1
    const nx = dx / d
    const ny = dy / d
    const vn = this.ball.vx * nx + this.ball.vy * ny
    if (vn < 0) {
      this.ball.vx -= (1 + this.stats.restitution) * vn * nx
      this.ball.vy -= (1 + this.stats.restitution) * vn * ny
    }
    this.ball.x = x + nx * (this.ball.r + 78)
    this.ball.y = y + ny * (this.ball.r + 78)
  }

  private makeBoss(): void {
    const hp = 860 * (1 + this.opts.heat * 0.14)
    this.boss = {
      x: this.room.width - 320,
      y: 530,
      r: 64,
      hp,
      maxHp: hp,
      phase: 1,
      rivets: [
        { ox: -36, oy: -78, hp: 70, max: 70, alive: true },
        { ox: 28, oy: -24, hp: 70, max: 70, alive: true },
        { ox: -8, oy: 36, hp: 70, max: 70, alive: true },
      ],
      attackCd: 1.4,
      attack: 'none',
      telegraph: 0,
      slamX: 400,
      slamLive: 0,
      hitFlash: 0,
      added: false,
    }
  }

  private updateBullets(dt: number): void {
    for (const b of this.bullets) {
      b.life -= dt
      b.x += b.vx * dt
      b.y += b.vy * dt
      if (this.magnetTimer > 0 || this.build.projectile === 'attract') {
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
          this.listeners.onBounceSfx?.(sp)
          continue
        }
        this.hurt(b.damage, 'projectile')
        b.life = 0
        this.burst(b.x, b.y, 4, b.color, 80)
        continue
      }
      if (b.friendly) {
        for (const e of this.enemies) {
          if (!e.alive) continue
          if (hypot(b.x - e.x, b.y - e.y) < b.r + e.r) {
            this.pendingReflected = true
            this.damageEnemy(e, b.damage + 8, ['projectile'], { pierce: true, kind: 'impact', source: 'effect' })
            b.life = 0
            break
          }
        }
        if (this.boss && this.boss.hp > 0 && hypot(b.x - this.boss.x, b.y - this.boss.y) < b.r + this.boss.r) {
          this.hurtBoss(b.damage + 6, false)
          b.life = 0
        }
      }
    }
    this.bullets = this.bullets.filter((b) => b.life > 0 && b.x > -40 && b.x < this.room.width + 40 && b.y < this.room.height + 80)
  }

  private redirect(b: Bullet): void {
    let tx = this.facing * 400
    let ty = 0
    let best = 1e9
    for (const e of this.enemies) {
      if (!e.alive) continue
      const d = hypot(e.x - this.ball.x, e.y - this.ball.y)
      if (d < best) {
        best = d
        tx = e.x - b.x
        ty = e.y - b.y
      }
    }
    if (this.boss && this.boss.hp > 0) {
      const d = hypot(this.boss.x - this.ball.x, this.boss.y - this.ball.y)
      if (d < best) {
        tx = this.boss.x - b.x
        ty = this.boss.y - b.y
      }
    }
    const len = hypot(tx, ty) || 1
    b.vx = (tx / len) * 460
    b.vy = (ty / len) * 460
    b.friendly = true
    b.reflected = true
    b.life = 2.4
    b.color = '#eafff6'
  }

  private updatePickups(dt: number): void {
    const magnet = (this.build.tags.magnetic ?? 0) > 0 || this.magnetTimer > 0
    for (const p of this.pickups) {
      p.life -= dt
      p.vy += 900 * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      if (magnet) {
        const dx = this.ball.x - p.x
        const dy = this.ball.y - p.y
        const d = hypot(dx, dy) || 1
        if (d < 280) {
          p.vx += (dx / d) * 700 * dt
          p.vy += (dy / d) * 700 * dt
        }
      }
      if (p.y > 640) {
        p.y = 640
        p.vy *= -0.3
      }
      if (hypot(p.x - this.ball.x, p.y - this.ball.y) < this.ball.r + 12) {
        p.life = 0
        if (p.kind === 'cinder') this.cinderPocket += p.value
        else this.heal(p.value)
        this.burst(p.x, p.y, 4, p.kind === 'cinder' ? '#ffb15a' : '#7dffb3', 80)
      }
    }
    this.pickups = this.pickups.filter((p) => p.life > 0)
  }

  /** Cinders collected this room, drained by the game. */
  cinderPocket = 0

  private updateHazards(dt: number): void {
    // rewrite pickup cinders cleanly — I'll fix pocket in the loop below by redoing collection.
    for (const h of this.room.hazards) {
      if (h.type === 'lava' && overlap(this.ball, h)) {
        const dr = this.effectiveStats().damageReduction
        const d = (h.dps ?? 34) * dt * (1 - dr) * (this.opts.gentle ? 0.5 : 1)
        this.hp -= d
        this.roomDamage += d
        if (this.ball.vy > 40) this.ball.vy -= 500 * dt
        this.burst(this.ball.x, this.ball.y, 1, '#ff6a2a', 40)
        if (this.hp <= 0) this.die('lava')
      } else if (h.type === 'spikes' && overlap(this.ball, h) && this.phase <= 0) {
        this.hurt(h.damage ?? 12, 'spike')
        this.ball.vy = Math.min(this.ball.vy, hopVelocity(this.effectiveStats()) * 0.75)
      } else if (h.type === 'crusher') {
        const pose = crusherPose(h, this.time)
        const rect = { x: h.x, y: pose.y, w: h.w, h: h.h }
        if (pose.smashing && overlap(this.ball, rect)) {
          const key = this.room.hazards.indexOf(h)
          if (this.crusherHits.get(key) !== pose.cycle) {
            this.crusherHits.set(key, pose.cycle)
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
            damage: 9,
            life: 4,
            friendly: false,
            reflected: false,
            color: '#ffb15a',
          })
        }
      } else if (h.type === 'geyser') {
        const period = h.period ?? 2.4
        const t = ((this.time + (h.phase ?? 0)) % period + period) % period
        const erupt = t > period - 0.28
        if (erupt && overlap(this.ball, { x: h.x, y: h.y - 80, w: h.w, h: h.h + 80 })) {
          this.hurt(16 * dt * 3, 'lava')
          this.ball.vy = Math.min(this.ball.vy, -200)
        }
      }
    }
  }

  private tickStatus(dt: number): void {
    for (const e of this.enemies) {
      if (!e.alive || e.burn <= 0) continue
      e.burn -= dt
      const dealt = this.damageEnemy(e, e.burnDps * dt, ['fire'], { pierce: true, kind: 'burn', source: 'effect' })
      if (dealt > 0 && this.rng() < dt * 8) this.burst(e.x, e.y - e.r, 1, '#ff6a2a', 30)
    }
  }

  private checkObjective(dt: number): void {
    if (this.room.rules?.includes('survival')) {
      this.survivalLeft = Math.max(0, this.survivalLeft - dt)
      if (this.survivalLeft <= 0) this.exitOpen = true
      return
    }
    if (this.room.type === 'boss') {
      this.exitOpen = !!this.boss && this.boss.hp <= 0
      return
    }
    const alive = this.enemies.some((e) => e.alive)
    if (!alive) this.exitOpen = true
  }

  private tryExit(): void {
    if (!this.exitOpen || this.opts.lab) return
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
    this.listeners.onClear?.()
  }

  private updateRespawns(dt: number): void {
    for (const r of this.labRespawns) r.t -= dt
    const ready = this.labRespawns.filter((r) => r.t <= 0)
    this.labRespawns = this.labRespawns.filter((r) => r.t > 0)
    for (const r of ready) this.enemies.push(this.makeEnemy(r.id, r.x, r.y, r.elite, 1))
  }

  hurt(amount: number, cause: string): void {
    if (this.ended !== 'play') return
    if (amount < 900 && this.phase > 0 && cause !== 'lava' && cause !== 'crusher' && cause !== 'pit') return
    if (amount < 900 && this.hurtLock > 0 && cause !== 'pit' && cause !== 'lava') return
    if (this.opts.god && (cause === 'pit' || cause === 'lava')) {
      this.ball.x = this.room.player.x
      this.ball.y = this.room.player.y
      this.ball.vx = 0
      this.ball.vy = -200
      this.hp = Math.max(this.hp, 1)
      return
    }
    let d = amount
    if (this.shield > 0) {
      const used = Math.min(this.shield, d)
      this.shield -= used
      d -= used
    }
    if (d <= 0) return
    this.hp -= d
    this.roomDamage += d
    if (cause !== 'lava') this.hurtLock = TUNE.playerHurtLock
    this.listeners.onHurt?.()
    if (this.hp <= this.maxHp * 0.32) this.fireEvent('onLowHp', this.ball.x, this.ball.y, 0, -1, 0)
    if (this.hp <= 0) {
      if (this.opts.god) {
        this.hp = this.maxHp * 0.65
        this.listeners.onToast?.('The lab catches the shell.')
        return
      }
      this.die(cause)
    }
  }

  private die(cause: string): void {
    if (this.ended !== 'play') return
    this.hp = 0
    this.ended = 'dead'
    this.cause = cause
    this.listeners.onDeath?.(cause)
  }

  heal(n: number): void {
    this.hp = Math.min(this.maxHp, this.hp + n)
  }

  addEnergy(n: number): void {
    this.energy = clamp(this.energy + n, 0, this.effectiveStats().energyMax)
  }

  addShield(n: number): void {
    this.shield = Math.min(60, this.shield + n)
  }

  explode(x: number, y: number, radius: number, damage: number, hurtSelf: boolean): void {
    this.ring(x, y, 16)
    this.burst(x, y, 12, '#ffb15a', 240)
    this.listeners.onShake?.(7)
    for (const e of this.enemies) {
      if (!e.alive) continue
      if (hypot(e.x - x, e.y - y) <= radius + e.r) {
        this.damageEnemy(e, damage, ['explosive', 'area'], { pierce: true, kind: 'explode', source: 'effect' })
        this.knockback(e, e.x - x, e.y - y, 300)
      }
    }
    if (this.boss && this.boss.hp > 0 && hypot(this.boss.x - x, this.boss.y - y) < radius + this.boss.r) {
      this.hurtBoss(damage * 0.65, false)
    }
    if (hurtSelf && hypot(this.ball.x - x, this.ball.y - y) <= radius * 0.75) this.hurt(Math.min(26, damage * 0.45), 'explosion')
  }

  chain(x: number, y: number, jumps: number, range: number, damage: number): void {
    const hit = new Set<number>()
    let cx = x
    let cy = y
    for (let i = 0; i < jumps; i++) {
      let best: LiveEnemy | undefined
      let bestD = range
      for (const e of this.enemies) {
        if (!e.alive || hit.has(e.uid)) continue
        const d = hypot(e.x - cx, e.y - cy)
        if (d < bestD) {
          best = e
          bestD = d
        }
      }
      if (!best) break
      hit.add(best.uid)
      this.arc(cx, cy, best.x, best.y)
      this.damageEnemy(best, damage * (1 - i * 0.18), ['lightning'], { pierce: true, kind: 'impact', source: 'effect' })
      cx = best.x
      cy = best.y
    }
  }

  attract(radius: number, strength: number, target: 'projectile' | 'pickup' | 'enemy'): void {
    if (target === 'projectile') {
      for (const b of this.bullets) {
        const dx = this.ball.x - b.x
        const dy = this.ball.y - b.y
        const d = hypot(dx, dy) || 1
        if (d < radius) {
          b.vx += (dx / d) * strength * 0.016
          b.vy += (dy / d) * strength * 0.016
        }
      }
    } else if (target === 'enemy') {
      for (const e of this.enemies) {
        if (!e.alive || e.pinned) continue
        const dx = this.ball.x - e.x
        const dy = this.ball.y - e.y
        const d = hypot(dx, dy) || 1
        if (d < radius) {
          e.vx += (dx / d) * strength * 0.01
          e.vy += (dy / d) * strength * 0.01
        }
      }
    }
  }

  knockback(e: FxEnemy, nx: number, ny: number, force: number): void {
    const live = e as LiveEnemy
    if (live.pinned) return
    const len = hypot(nx, ny) || 1
    live.vx += (nx / len) * (force / Math.max(0.4, live.mass))
    live.vy += (ny / len) * (force / Math.max(0.4, live.mass)) * 0.6
  }

  applyStatus(e: FxEnemy, status: 'burn' | 'shock' | 'slow', duration: number, magnitude: number): void {
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
  }

  controlTax(duration: number, mul: number): void {
    this.taxLeft = Math.max(this.taxLeft, duration)
    this.controlMul = mul
  }

  addInstability(n: number): void {
    this.instability = Math.min(100, this.instability + n)
    if (this.instability >= 100) {
      this.instability = 0
      this.explode(this.ball.x, this.ball.y, 150, 62, true)
      this.listeners.onToast?.('The core vents.')
    }
  }

  discover(id: string): void {
    if (this.discovered.has(id)) return
    this.discovered.add(id)
    this.listeners.onDiscovery?.(id)
  }

  private fireEvent(
    event: 'onImpact' | 'onBounce' | 'onKill' | 'onTick' | 'onLand' | 'onRoomStart' | 'onLowHp' | 'onCombo' | 'onAbility',
    x: number,
    y: number,
    nx: number,
    ny: number,
    speed: number,
    enemy?: FxEnemy,
    dt = 0.016,
    dealt = 0,
    killedBy?: KillKind,
  ): void {
    triggerEffects(this.build.effects, event, this, {
      x, y, nx, ny, speed, impact: dealt || collisionDamage(this.effectiveStats(), speed, this.comboMul(), false),
      enemy, dealt, killedBy, combo: this.combo, dt,
    })
  }

  private makeEnemy(id: string, x: number, y: number, elite: boolean, scale: number): LiveEnemy {
    const def = ENEMY_MAP[id] ?? ENEMY_MAP['grunt']!
    const hp = def.hp * scale * (elite ? 1.35 : 1)
    return {
      uid: this.uid++,
      defId: def.id,
      name: elite ? `Elite ${def.name}` : def.name,
      x, y, vx: 0, vy: 0, r: def.r * (elite ? 1.08 : 1),
      hp, maxHp: hp, alive: true,
      burn: 0, burnDps: 0, shock: 0, slow: 0,
      mass: def.mass, pinned: !!def.pinned,
      facing: -1, stun: 0, hitCd: 0, attackCd: 0.6, elite,
      flying: !!def.flying, shield: !!def.shield, shieldBreak: def.shieldBreak ?? 36,
      armorGate: def.armorGate ?? 0, armorMul: def.armorMul ?? 1,
      contact: def.contact * (1 + this.opts.depth * 0.04 + this.opts.heat * 0.08),
      color: def.color, accent: def.accent, shape: def.shape, behavior: def.behavior,
      moveSpeed: def.speed * (elite ? 1.08 : 1),
      resists: def.resists ?? [],
      split: def.split, explodeOnDeath: def.explode, shot: def.shot, pull: def.pull,
      hitFlash: 0, blinkCd: 0,
    }
  }

  private burst(x: number, y: number, n: number, color: string, speed: number): void {
    for (let i = 0; i < n; i++) {
      const a = this.rng() * Math.PI * 2
      const s = speed * (0.3 + this.rng())
      this.particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40,
        life: 0.25 + this.rng() * 0.3, max: 0.5, size: 2 + this.rng() * 2.5,
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
