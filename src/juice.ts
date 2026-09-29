import type { FxEvent, Simulation } from './sim'
import { crusherPose, geyserPhase } from './sim'
import { TUNE } from './tune'
import { clamp, cosmeticRng, hypot } from './util'

/**
 * Game feel that lives only on the screen: debris, sparks, smoke, shockwaves,
 * trauma-based camera shake, camera kick and zoom punch, slow motion, ball
 * squash, afterimages, ambient embers, and cinders flying to the counter.
 *
 * The simulation reports what happened through `FxEvent`s; nothing here is
 * ever read back by gameplay, and it draws from its own random stream.
 */

export interface JuiceSettings {
  /** Screen shake multiplier, 0..1. */
  shake: number
  /** Share of cosmetic particles, 0..1. */
  particles: number
  /** Camera zoom, look-ahead, and other large motion. */
  motion: boolean
  /** Hit pause and slow motion. */
  hitPause: boolean
}

interface Shard { x: number; y: number; vx: number; vy: number; rot: number; vr: number; size: number; life: number; max: number; color: string; sides: number; hot: boolean }
interface Streak { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; width: number; gravity: number }
interface Puff { x: number; y: number; vx: number; vy: number; r: number; grow: number; life: number; max: number; color: string; alpha: number }
interface Wave { x: number; y: number; r0: number; r1: number; life: number; max: number; color: string; width: number }
interface Star { x: number; y: number; size: number; life: number; max: number; color: string; angle: number }
interface Mote { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; phase: number; hot: boolean }
interface Ghost { x: number; y: number; r: number; life: number; max: number; color: string }
interface Scorch { x: number; y: number; r: number; life: number }
interface Coin { x: number; y: number; t: number; delay: number; kind: 'cinder' | 'heal' }
interface Timed { at: number; run: () => void }

const HOT = ['#fff4d6', '#ffd58a', '#ffb15a', '#ff7a32']
const EASE_BACK = (t: number): number => {
  const c = 1.70158
  const u = t - 1
  return 1 + (c + 1) * u * u * u + c * u * u
}

export class Juice {
  settings: JuiceSettings = { shake: 1, particles: 1, motion: true, hitPause: true }
  time = 0
  /** Camera trauma, 0..1. Shake grows with its square. */
  trauma = 0
  kickX = 0
  kickY = 0
  zoomPunch = 0
  /** Red edge flash after taking damage, 0..1. */
  hurtFlash = 0
  /** Expanding ring when the ball first reaches clean-ram speed, 1..0. */
  armPulse = 0
  armed = false
  /** Set for one frame when the ball becomes armed; the game plays a cue. */
  armedEdge = false
  /** Hit pause the last events asked for, collected by the game each frame. */
  hitstopRequest = 0
  /** Cinder pickups that reached the counter this frame. */
  arrivals = 0
  /** Ball squash along a contact normal: a damped spring around 0. */
  squash = 0
  private squashVel = 0
  squashNx = 0
  squashNy = -1
  /** The ball broke: it is drawn as debris, not a ball. */
  shattered = false
  private slowLeft = 0
  private slowScale = 1
  private rng = cosmeticRng()
  private phase = [this.rng() * 100, this.rng() * 100, this.rng() * 100]
  private shards: Shard[] = []
  private streaks: Streak[] = []
  private puffs: Puff[] = []
  private waves: Wave[] = []
  private stars: Star[] = []
  private motes: Mote[] = []
  private ghosts: Ghost[] = []
  private scorches: Scorch[] = []
  private coins: Coin[] = []
  private timed: Timed[] = []
  private seen = new Map<number, number>()
  private spawnOrder = 0
  private smashing: boolean[] = []
  private ghostClock = 0
  private moteClock = 0
  private sim: Simulation | null = null

  /** Forget everything tied to the previous room. */
  reset(sim: Simulation | null): void {
    this.sim = sim
    this.shards = []
    this.streaks = []
    this.puffs = []
    this.waves = []
    this.stars = []
    this.ghosts = []
    this.scorches = []
    this.coins = []
    this.timed = []
    this.seen.clear()
    this.spawnOrder = 0
    this.smashing = []
    this.trauma = 0
    this.kickX = 0
    this.kickY = 0
    this.zoomPunch = 0
    this.hurtFlash = 0
    this.armPulse = 0
    this.armed = false
    this.squash = 0
    this.squashVel = 0
    this.shattered = false
    this.slowLeft = 0
    this.slowScale = 1
  }

  /** Game time multiplier for slow-motion beats (1 when off). */
  get timeScale(): number {
    return this.slowLeft > 0 && this.settings.hitPause ? this.slowScale : 1
  }

  slowMo(seconds: number, scale: number): void {
    if (!this.settings.hitPause) return
    this.slowScale = this.slowLeft > 0 ? Math.min(this.slowScale, scale) : scale
    this.slowLeft = Math.max(this.slowLeft, seconds)
  }

  addTrauma(n: number): void {
    this.trauma = Math.min(1, this.trauma + n)
  }

  private kick(dx: number, dy: number, px: number): void {
    const len = Math.hypot(dx, dy) || 1
    this.kickX += (dx / len) * px
    this.kickY += (dy / len) * px
  }

  private hitstop(s: number): void {
    this.hitstopRequest = Math.max(this.hitstopRequest, s)
  }

  /** Hit pause asked for since the last call. */
  takeHitstop(): number {
    const s = this.hitstopRequest
    this.hitstopRequest = 0
    return s
  }

  private n(count: number): number {
    return Math.round(count * this.settings.particles)
  }

  private r(a: number, b: number): number {
    return a + this.rng() * (b - a)
  }

  private pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.rng() * list.length)]!
  }

  /** Camera shake for this frame: translation in px and a small roll in radians. */
  shakeOffset(): { x: number; y: number; rot: number } {
    const s = this.settings.shake
    const amt = this.trauma * this.trauma * s
    const t = this.time
    const [a, b, c] = this.phase as [number, number, number]
    const nx = Math.sin(t * 41 + a) * 0.6 + Math.sin(t * 73 + b) * 0.4
    const ny = Math.sin(t * 47 + b) * 0.6 + Math.sin(t * 89 + c) * 0.4
    const nr = Math.sin(t * 37 + c) * 0.7 + Math.sin(t * 61 + a) * 0.3
    return {
      x: nx * amt * 16 + this.kickX * s,
      y: ny * amt * 16 + this.kickY * s,
      rot: this.settings.motion ? nr * amt * 0.03 : 0,
    }
  }

  /** Pop-in scale for a construct the first time it is drawn. */
  enemyScale(uid: number): number {
    let born = this.seen.get(uid)
    if (born === undefined) {
      born = this.time + Math.min(0.5, this.spawnOrder++ * 0.05)
      this.seen.set(uid, born)
    }
    const age = this.time - born
    if (age <= 0) return 0.001
    if (age >= 0.36 || !this.settings.motion) return 1
    return Math.max(0.001, EASE_BACK(age / 0.36))
  }

  // ---------------------------------------------------------------------------
  // Events.

  onEvent(e: FxEvent): void {
    switch (e.type) {
      case 'hit': {
        const p = clamp(e.dealt / 60, 0.15, 1.6)
        const color = e.blocked ? '#c7ccd4' : e.crit ? '#ffe28a' : '#fff6ea'
        this.stars.push({ x: e.x, y: e.y, size: 16 + 34 * p, life: 0.1, max: 0.1, color, angle: this.rng() * Math.PI })
        const base = Math.atan2(-e.ny, -e.nx)
        for (let i = 0; i < this.n(5 + 14 * p); i++) {
          const a = base + this.r(-1.2, 1.2)
          const s = this.r(200, 520) * (0.6 + p * 0.5)
          this.streaks.push({ x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, life: this.r(0.14, 0.34), max: 0.34, color: e.blocked ? '#dfe4ea' : this.pick(HOT), width: this.r(1.5, 3), gravity: 900 })
        }
        if (e.clean || e.killed) this.waves.push({ x: e.x, y: e.y, r0: 8, r1: 34 + 46 * p, life: 0.22, max: 0.22, color: '#fff1d6', width: 4 })
        this.addTrauma(e.blocked ? 0.12 : 0.08 + 0.22 * Math.min(1, p))
        this.kick(-e.nx, -e.ny, 3 + 7 * Math.min(1, p))
        if (this.settings.motion && e.clean) this.zoomPunch = Math.min(0.08, this.zoomPunch + 0.01 + 0.02 * Math.min(1, p))
        this.squashBall(e.nx, e.ny, 0.16 + 0.14 * Math.min(1, p))
        if (e.dealt > 60) this.hitstop(clamp(e.dealt / 1000, 0.06, 0.1))
        return
      }
      case 'kill': {
        const n = this.n(5 + e.r / 6 + (e.elite ? 5 : 0))
        const colors = [e.color, e.accent, e.color, '#2a2118']
        for (let i = 0; i < n; i++) {
          const a = this.r(-Math.PI, 0) + this.r(-0.3, 0.3)
          const s = this.r(160, 420)
          this.shards.push({
            x: e.x + this.r(-e.r, e.r) * 0.5, y: e.y + this.r(-e.r, e.r) * 0.5,
            vx: Math.cos(a) * s + e.vx * 0.4, vy: Math.sin(a) * s + e.vy * 0.2,
            rot: this.rng() * 6, vr: this.r(-14, 14), size: this.r(e.r * 0.22, e.r * 0.5),
            life: this.r(1.6, 2.6), max: 2.6, color: this.pick(colors), sides: 3 + Math.floor(this.rng() * 3), hot: this.rng() < 0.3,
          })
        }
        for (let i = 0; i < this.n(5); i++) {
          this.puffs.push({ x: e.x + this.r(-8, 8), y: e.y + this.r(-8, 8), vx: this.r(-50, 50), vy: this.r(-70, -20), r: e.r * 0.5, grow: 50, life: this.r(0.5, 0.9), max: 0.9, color: '#2a221c', alpha: 0.55 })
        }
        for (let i = 0; i < this.n(14); i++) {
          const a = this.rng() * Math.PI * 2
          const s = this.r(240, 560)
          this.streaks.push({ x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 80, life: this.r(0.2, 0.45), max: 0.45, color: this.pick(HOT), width: this.r(1.5, 3.2), gravity: 1100 })
        }
        this.waves.push({ x: e.x, y: e.y, r0: e.r, r1: e.r * 3.4, life: 0.32, max: 0.32, color: e.accent, width: 6 })
        this.stars.push({ x: e.x, y: e.y, size: e.r * 2.6, life: 0.12, max: 0.12, color: '#fff6ea', angle: this.rng() * Math.PI })
        this.scorch(e.x, e.y, e.r * 1.3)
        this.addTrauma(e.elite ? 0.45 : 0.28)
        if (this.settings.motion) this.zoomPunch = Math.min(0.09, this.zoomPunch + (e.elite ? 0.05 : 0.03))
        this.hitstop(e.elite ? 0.11 : 0.065)
        return
      }
      case 'bounce': {
        const floor = e.ny < -0.55
        if (floor && e.speed > 200) {
          for (let i = 0; i < this.n(2 + e.speed / 220); i++) {
            const side = i % 2 ? 1 : -1
            this.puffs.push({ x: e.x + side * this.r(2, 10), y: e.y - 3, vx: side * this.r(40, 120), vy: this.r(-40, -10), r: this.r(4, 8), grow: 26, life: this.r(0.35, 0.6), max: 0.6, color: '#8d7f70', alpha: 0.4 })
          }
        } else if (!floor && e.speed > 260) {
          for (let i = 0; i < this.n(4); i++) {
            const a = Math.atan2(e.ny, e.nx) + this.r(-0.9, 0.9)
            this.streaks.push({ x: e.x, y: e.y, vx: Math.cos(a) * 260, vy: Math.sin(a) * 260, life: 0.18, max: 0.18, color: '#ffe7c2', width: 1.5, gravity: 600 })
          }
        }
        this.squashBall(e.nx, e.ny, clamp(e.speed / 1700, 0.05, 0.3))
        if (e.speed > 760) this.addTrauma(Math.min(0.2, (e.speed - 760) / 3000))
        return
      }
      case 'hop':
        for (let i = 0; i < this.n(4); i++) {
          const side = i % 2 ? 1 : -1
          this.puffs.push({ x: e.x + side * 6, y: e.y - 2, vx: side * this.r(50, 110), vy: this.r(-30, 0), r: 4, grow: 22, life: 0.4, max: 0.4, color: '#9a8b7b', alpha: 0.35 })
        }
        this.squashBall(0, -1, -0.16)
        return
      case 'spring':
        this.waves.push({ x: e.x, y: e.y, r0: 6, r1: 60, life: 0.25, max: 0.25, color: '#ffcf8a', width: 4 })
        this.squashBall(0, -1, -0.24)
        return
      case 'hurt': {
        const small = e.amount < 2
        this.hurtFlash = Math.min(1, Math.max(this.hurtFlash, small ? 0.18 : 0.4 + e.amount / 40))
        if (small) return
        this.addTrauma(Math.min(0.4, 0.12 + e.amount / 70))
        for (let i = 0; i < this.n(8); i++) {
          const a = this.rng() * Math.PI * 2
          this.streaks.push({ x: e.x, y: e.y, vx: Math.cos(a) * 280, vy: Math.sin(a) * 280, life: 0.25, max: 0.25, color: '#ff8a7a', width: 2, gravity: 400 })
        }
        return
      }
      case 'ability': {
        if (e.kind === 'dash') {
          const len = Math.hypot(e.vx, e.vy) || 1
          for (let i = 0; i < this.n(10); i++) {
            const off = this.r(-14, 14)
            this.streaks.push({ x: e.x - (e.vy / len) * off, y: e.y + (e.vx / len) * off, vx: (-e.vx / len) * this.r(300, 600), vy: (-e.vy / len) * this.r(300, 600), life: 0.18, max: 0.18, color: '#fff1d6', width: 2, gravity: 0 })
          }
          this.waves.push({ x: e.x, y: e.y, r0: 12, r1: 46, life: 0.18, max: 0.18, color: '#fff1d6', width: 3 })
          this.kick(e.vx, e.vy, 6)
        } else if (e.kind === 'burst') {
          this.waves.push({ x: e.x, y: e.y, r0: 16, r1: 100, life: 0.28, max: 0.28, color: '#ffe7c2', width: 6 })
          this.addTrauma(0.18)
        } else if (e.kind === 'magnet') {
          this.waves.push({ x: e.x, y: e.y, r0: 150, r1: 20, life: 0.4, max: 0.4, color: '#9ad7ff', width: 3 })
          this.waves.push({ x: e.x, y: e.y, r0: 110, r1: 14, life: 0.32, max: 0.32, color: '#9ad7ff', width: 2 })
        } else if (e.kind === 'slam') {
          this.squashBall(0, -1, -0.2)
        }
        return
      }
      case 'slam':
        this.waves.push({ x: e.x, y: e.y, r0: 10, r1: e.radius, life: 0.36, max: 0.36, color: '#fff1d6', width: 8 })
        for (let i = 0; i < this.n(12); i++) {
          const side = i % 2 ? 1 : -1
          this.puffs.push({ x: e.x + side * this.r(0, 30), y: e.y - 4, vx: side * this.r(120, 320), vy: this.r(-60, -10), r: this.r(6, 12), grow: 40, life: this.r(0.5, 0.8), max: 0.8, color: '#8d7f70', alpha: 0.45 })
        }
        this.debris(e.x, e.y, 6, '#6a5c4e')
        this.addTrauma(0.5)
        this.hitstop(0.08)
        return
      case 'explode':
        this.fireball(e.x, e.y, e.radius)
        return
      case 'collect':
        this.stars.push({ x: e.x, y: e.y, size: 20, life: 0.12, max: 0.12, color: e.kind === 'cinder' ? '#ffd58a' : '#b8ffd6', angle: 0 })
        if (e.kind === 'cinder') this.coins.push({ x: e.x, y: e.y, t: 0, delay: 0, kind: 'cinder' })
        return
      case 'rivet':
        this.debris(e.x, e.y, 8, '#ffd15c')
        this.waves.push({ x: e.x, y: e.y, r0: 12, r1: 80, life: 0.3, max: 0.3, color: '#ffd15c', width: 6 })
        this.addTrauma(0.35)
        this.hitstop(0.09)
        return
      case 'boss-phase':
        this.waves.push({ x: e.x, y: e.y, r0: 60, r1: 320, life: 0.5, max: 0.5, color: '#ffb15a', width: 10 })
        this.debris(e.x, e.y - 20, 14, '#5a534c')
        this.addTrauma(0.6)
        this.hitstop(0.16)
        if (this.settings.motion) this.zoomPunch = Math.min(0.1, this.zoomPunch + 0.06)
        return
      case 'boss-down':
        this.hitstop(0.22)
        this.slowMo(1.5, 0.3)
        this.addTrauma(0.8)
        for (let i = 0; i < 7; i++) {
          const x = e.x + this.r(-70, 70)
          const y = e.y + this.r(-90, 40)
          this.timed.push({ at: this.time + i * 0.16, run: () => this.fireball(x, y, 90 + i * 12) })
        }
        this.timed.push({ at: this.time + 1.2, run: () => {
          this.debris(e.x, e.y - 20, 30, '#6a3a30')
          this.waves.push({ x: e.x, y: e.y, r0: 40, r1: 520, life: 0.7, max: 0.7, color: '#fff1d6', width: 14 })
          this.addTrauma(0.9)
        } })
        return
      case 'boss-slam':
        for (let i = 0; i < this.n(14); i++) {
          const side = i % 2 ? 1 : -1
          this.puffs.push({ x: e.x + side * this.r(20, 70), y: e.y - 6, vx: side * this.r(100, 360), vy: this.r(-80, -10), r: this.r(8, 16), grow: 50, life: this.r(0.5, 0.9), max: 0.9, color: '#6a5c4e', alpha: 0.5 })
        }
        this.debris(e.x, e.y - 6, 8, '#5a534c')
        this.waves.push({ x: e.x, y: e.y, r0: 20, r1: 180, life: 0.3, max: 0.3, color: '#ffb15a', width: 6 })
        return
      case 'collapse':
        for (let i = 0; i < 5; i++) this.debris(e.x + (e.w * i) / 4, e.y, 5, '#4a433c')
        this.addTrauma(0.5)
        return
      case 'slag':
        for (let i = 0; i < this.n(14); i++) {
          this.streaks.push({ x: e.x + this.r(-14, 14), y: e.y, vx: this.r(-160, 160), vy: this.r(-520, -220), life: this.r(0.4, 0.7), max: 0.7, color: this.pick(['#ffb15a', '#ff6a2a', '#ffd58a']), width: this.r(2, 4), gravity: 1400 })
        }
        return
      case 'die':
        this.shatter(e.x, e.y)
        return
    }
  }

  private squashBall(nx: number, ny: number, amount: number): void {
    // A stronger contact replaces a weaker one; the spring does the rest.
    if (Math.abs(amount) < Math.abs(this.squash) * 0.7) return
    this.squash = amount
    this.squashVel = 0
    this.squashNx = nx
    this.squashNy = ny
  }

  private debris(x: number, y: number, count: number, color: string): void {
    for (let i = 0; i < this.n(count); i++) {
      const a = this.r(-Math.PI, 0)
      const s = this.r(160, 460)
      this.shards.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, rot: this.rng() * 6, vr: this.r(-12, 12), size: this.r(4, 11), life: this.r(1.4, 2.4), max: 2.4, color, sides: 3 + Math.floor(this.rng() * 3), hot: this.rng() < 0.25 })
    }
  }

  private fireball(x: number, y: number, radius: number): void {
    this.stars.push({ x, y, size: radius * 0.55, life: 0.1, max: 0.1, color: '#fff4d6', angle: this.rng() * Math.PI })
    this.waves.push({ x, y, r0: 12, r1: radius * 1.1, life: 0.3, max: 0.3, color: '#ffb15a', width: 7 })
    for (let i = 0; i < this.n(8); i++) {
      this.puffs.push({ x: x + this.r(-radius, radius) * 0.3, y: y + this.r(-radius, radius) * 0.3, vx: this.r(-80, 80), vy: this.r(-110, -30), r: radius * 0.22, grow: radius * 0.6, life: this.r(0.4, 0.8), max: 0.8, color: this.pick(['#ff7a32', '#ffb15a', '#3a2a20', '#2a221c']), alpha: 0.6 })
    }
    for (let i = 0; i < this.n(16); i++) {
      const a = this.rng() * Math.PI * 2
      const s = this.r(200, 520)
      this.streaks.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, life: this.r(0.2, 0.5), max: 0.5, color: this.pick(HOT), width: this.r(2, 3.5), gravity: 900 })
    }
    this.scorch(x, y, radius * 0.5)
    this.addTrauma(0.32)
  }

  private shatter(x: number, y: number): void {
    const sim = this.sim
    const v = sim?.build.visual
    const r = sim?.ball.r ?? 16
    this.shattered = true
    const colors = [v?.core ?? '#c4552a', v?.shell ?? '#e8e2d6', '#2a160f', '#fff1d6']
    for (let i = 0; i < Math.max(10, this.n(22)); i++) {
      const a = this.rng() * Math.PI * 2
      const s = this.r(120, 420)
      this.shards.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 160, rot: this.rng() * 6, vr: this.r(-16, 16), size: this.r(r * 0.2, r * 0.5), life: this.r(2, 3), max: 3, color: this.pick(colors), sides: 3 + Math.floor(this.rng() * 3), hot: this.rng() < 0.4 })
    }
    this.waves.push({ x, y, r0: r, r1: r * 7, life: 0.5, max: 0.5, color: '#fff1d6', width: 8 })
    this.stars.push({ x, y, size: r * 5, life: 0.16, max: 0.16, color: '#fff6ea', angle: 0 })
    for (let i = 0; i < this.n(8); i++) this.puffs.push({ x, y, vx: this.r(-90, 90), vy: this.r(-120, -30), r: r * 0.6, grow: 60, life: this.r(0.7, 1.2), max: 1.2, color: '#2a221c', alpha: 0.6 })
    this.addTrauma(0.7)
  }

  private scorch(x: number, y: number, r: number): void {
    const ground = this.groundBelow(x, y, 220)
    if (ground === null) return
    this.scorches.push({ x, y: ground, r, life: 14 })
    if (this.scorches.length > 28) this.scorches.shift()
  }

  /** Top of the nearest solid under a point, or null. */
  groundBelow(x: number, y: number, reach: number): number | null {
    const sim = this.sim
    if (!sim) return null
    let best: number | null = null
    for (const s of sim.solids) {
      if (!s.alive || s.bounds) continue
      if (x < s.x || x > s.x + s.w || s.y < y - 2 || s.y > y + reach) continue
      if (best === null || s.y < best) best = s.y
    }
    return best
  }

  // ---------------------------------------------------------------------------
  // Update.

  /**
   * Advance by real time. `frozen` is true during hit pause: effects crawl
   * instead of stopping, so the freeze reads as weight rather than a hitch.
   */
  update(realDt: number, sim: Simulation | null, view: { x: number; y: number; w: number; h: number }, frozen: boolean, ballX: number, ballY: number): void {
    if (sim !== this.sim) this.reset(sim)
    const dt = realDt * (frozen ? 0.15 : this.timeScale)
    this.time += realDt
    this.arrivals = 0
    this.armedEdge = false
    if (this.slowLeft > 0) this.slowLeft = Math.max(0, this.slowLeft - realDt)
    this.trauma = Math.max(0, this.trauma - realDt * 1.25)
    const kd = Math.exp(-14 * realDt)
    this.kickX *= kd
    this.kickY *= kd
    this.zoomPunch *= Math.exp(-7 * realDt)
    this.hurtFlash = Math.max(0, this.hurtFlash - realDt * 2.2)
    this.armPulse = Math.max(0, this.armPulse - realDt * 2.8)
    // Under-damped spring: flatten, rebound past rest into a stretch, settle.
    const k = 520
    const c = 16
    this.squashVel += (-k * this.squash - c * this.squashVel) * realDt
    this.squash += this.squashVel * realDt
    if (Math.abs(this.squash) < 0.002 && Math.abs(this.squashVel) < 0.02) this.squash = this.squashVel = 0

    for (let i = this.timed.length - 1; i >= 0; i--) {
      if (this.timed[i]!.at <= this.time) {
        const t = this.timed[i]!
        this.timed.splice(i, 1)
        t.run()
      }
    }

    if (sim && !sim.done) this.watchBall(sim, dt, ballX, ballY)
    if (sim) this.watchHazards(sim, dt, view)
    this.ambient(dt, view, sim)

    for (const p of this.shards) {
      p.life -= dt
      p.vy += 1300 * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.rot += p.vr * dt
      if (p.vy > 0) {
        const g = this.groundBelow(p.x, p.y - p.vy * dt - 2, p.vy * dt + 4)
        if (g !== null && p.y + p.size * 0.3 > g) {
          p.y = g - p.size * 0.3
          p.vy *= -0.32
          p.vx *= 0.62
          p.vr *= 0.5
          if (Math.abs(p.vy) < 40) p.vy = 0
        }
      }
    }
    for (const p of this.streaks) {
      p.life -= dt
      p.vy += p.gravity * dt
      p.vx *= Math.exp(-2.2 * dt)
      p.x += p.vx * dt
      p.y += p.vy * dt
    }
    for (const p of this.puffs) {
      p.life -= dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.vx *= Math.exp(-3 * dt)
      p.vy *= Math.exp(-1.5 * dt)
      p.r += p.grow * dt
    }
    for (const p of this.waves) p.life -= dt
    for (const p of this.stars) p.life -= dt
    for (const p of this.ghosts) p.life -= dt
    for (const p of this.scorches) p.life -= dt
    for (const c2 of this.coins) {
      c2.t += realDt
      if (c2.t >= 0.6) this.arrivals++
    }
    this.shards = this.shards.filter((p) => p.life > 0)
    this.streaks = this.streaks.filter((p) => p.life > 0)
    this.puffs = this.puffs.filter((p) => p.life > 0)
    this.waves = this.waves.filter((p) => p.life > 0)
    this.stars = this.stars.filter((p) => p.life > 0)
    this.ghosts = this.ghosts.filter((p) => p.life > 0)
    this.scorches = this.scorches.filter((p) => p.life > 0)
    this.coins = this.coins.filter((p) => p.t < 0.6)
    // Hard caps so a chain reaction can never flood the frame.
    if (this.shards.length > 160) this.shards.splice(0, this.shards.length - 160)
    if (this.streaks.length > 320) this.streaks.splice(0, this.streaks.length - 320)
    if (this.puffs.length > 120) this.puffs.splice(0, this.puffs.length - 120)
  }

  private watchBall(sim: Simulation, dt: number, bx: number, by: number): void {
    const sp = hypot(sim.ball.vx, sim.ball.vy)
    const ratio = sp / Math.max(1, sim.stats.maxSpeed)
    if (!this.armed && ratio >= TUNE.cleanRamRatio) {
      this.armed = true
      this.armedEdge = true
      this.armPulse = 1
    } else if (this.armed && ratio < TUNE.cleanRamRatio - 0.06) this.armed = false
    this.ghostClock -= dt
    if (ratio > 0.62 && this.ghostClock <= 0 && this.settings.particles > 0) {
      this.ghostClock = 0.028
      this.ghosts.push({ x: bx, y: by, r: sim.ball.r, life: 0.2, max: 0.2, color: sim.build.visual.trail })
      if (this.ghosts.length > 14) this.ghosts.shift()
    }
  }

  private watchHazards(sim: Simulation, dt: number, view: { x: number; y: number; w: number; h: number }): void {
    const hazards = sim.hazards
    for (let i = 0; i < hazards.length; i++) {
      const h = hazards[i]!
      const near = h.x + h.w > view.x - 100 && h.x < view.x + view.w + 100
      if (h.type === 'crusher') {
        const pose = crusherPose(h, sim.time)
        const was = this.smashing[i] ?? false
        this.smashing[i] = pose.smashing
        if (pose.smashing && !was && near) {
          const land = pose.y + h.h
          for (let j = 0; j < this.n(8); j++) {
            const side = j % 2 ? 1 : -1
            this.puffs.push({ x: h.x + h.w / 2 + side * this.r(0, h.w / 2), y: land, vx: side * this.r(80, 220), vy: this.r(-50, -10), r: this.r(5, 10), grow: 30, life: 0.5, max: 0.5, color: '#6a5c4e', alpha: 0.45 })
          }
          const d = Math.abs(sim.ball.x - (h.x + h.w / 2))
          if (d < 500) this.addTrauma(0.12 * (1 - d / 500))
        }
      } else if (h.type === 'geyser' && near) {
        if (geyserPhase(h, sim.time).erupt && this.rng() < dt * 50 * this.settings.particles) {
          this.streaks.push({ x: h.x + this.r(8, h.w - 8), y: h.y - 10, vx: this.r(-60, 60), vy: this.r(-620, -380), life: this.r(0.4, 0.7), max: 0.7, color: this.pick(['#ffb15a', '#ff6a2a', '#ffd58a']), width: this.r(2, 4), gravity: 1300 })
        }
      } else if (h.type === 'lava' && near) {
        if (this.rng() < dt * (h.w / 90) * this.settings.particles) {
          this.motes.push({ x: h.x + this.rng() * h.w, y: h.y + 4, vx: this.r(-12, 12), vy: this.r(-90, -40), life: this.r(1.2, 2.4), max: 2.4, size: this.r(1.5, 3), phase: this.rng() * 6, hot: true })
        }
      }
    }
  }

  /** Embers and dust drifting up through the view. */
  private ambient(dt: number, view: { x: number; y: number; w: number; h: number }, sim: Simulation | null): void {
    const target = Math.round((sim ? 46 : 70) * this.settings.particles)
    this.moteClock -= dt
    while (this.motes.length < target && this.moteClock <= 0) {
      this.moteClock += 0.05
      const hot = this.rng() < 0.55
      this.motes.push({
        x: view.x + this.rng() * view.w, y: view.y + view.h * this.r(0.4, 1.05),
        vx: this.r(-14, 14), vy: this.r(-46, -14), life: this.r(3, 7), max: 7, size: hot ? this.r(1.2, 2.6) : this.r(0.8, 1.6), phase: this.rng() * 6, hot,
      })
    }
    for (const m of this.motes) {
      m.life -= dt
      m.x += (m.vx + Math.sin(this.time * 1.3 + m.phase) * 14) * dt
      m.y += m.vy * dt
    }
    this.motes = this.motes.filter((m) => m.life > 0 && m.y > view.y - 40 && m.x > view.x - 200 && m.x < view.x + view.w + 200)
    if (this.motes.length > 140) this.motes.splice(0, this.motes.length - 140)
  }

  // ---------------------------------------------------------------------------
  // Drawing. World layers are called inside the camera transform.

  drawScorches(ctx: CanvasRenderingContext2D): void {
    for (const s of this.scorches) {
      ctx.globalAlpha = Math.min(1, s.life / 3) * 0.55
      const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 1.6)
      g.addColorStop(0, 'rgba(8,5,3,0.9)')
      g.addColorStop(0.5, 'rgba(40,18,8,0.5)')
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.ellipse(s.x, s.y + 1, s.r * 1.6, s.r * 0.35, 0, 0, Math.PI * 2)
      ctx.fill()
      // A still-hot seam for the first few seconds.
      if (s.life > 10) {
        ctx.globalAlpha = (s.life - 10) / 4 * 0.8
        ctx.fillStyle = '#ff7a32'
        ctx.fillRect(s.x - s.r * 0.7, s.y - 1, s.r * 1.4, 2)
      }
    }
    ctx.globalAlpha = 1
  }

  drawGhosts(ctx: CanvasRenderingContext2D): void {
    if (!this.ghosts.length) return
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (const g of this.ghosts) {
      const t = g.life / g.max
      ctx.globalAlpha = t * 0.35
      ctx.drawImage(glowSprite(g.color), g.x - g.r * 1.4, g.y - g.r * 1.4, g.r * 2.8, g.r * 2.8)
    }
    ctx.restore()
  }

  drawBack(ctx: CanvasRenderingContext2D): void {
    // Embers behind the action.
    if (!this.motes.length) return
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (const m of this.motes) {
      const fade = Math.min(1, m.life / 0.8, (m.max - m.life) / 0.6 + 0.2)
      const flicker = 0.65 + 0.35 * Math.sin(this.time * 9 + m.phase * 3)
      ctx.globalAlpha = clamp(fade * flicker * (m.hot ? 0.9 : 0.35), 0, 1)
      const s = m.size * (m.hot ? 5 : 3)
      ctx.drawImage(glowSprite(m.hot ? '#ff9a3c' : '#c3b4a2'), m.x - s, m.y - s, s * 2, s * 2)
    }
    ctx.restore()
  }

  drawFront(ctx: CanvasRenderingContext2D): void {
    for (const p of this.puffs) {
      const t = p.life / p.max
      ctx.globalAlpha = p.alpha * t * t
      ctx.fillStyle = p.color
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
    for (const p of this.shards) {
      const t = Math.min(1, p.life / 0.45)
      ctx.globalAlpha = t
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.rot)
      ctx.fillStyle = p.color
      ctx.beginPath()
      for (let i = 0; i < p.sides; i++) {
        const a = (Math.PI * 2 * i) / p.sides
        const rr = p.size * (i % 2 ? 0.55 : 0.9)
        if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr)
        else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr)
      }
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = 'rgba(12,8,6,0.6)'
      ctx.lineWidth = 1
      ctx.stroke()
      if (p.hot && p.life > p.max - 1) {
        ctx.fillStyle = '#ffb15a'
        ctx.globalAlpha = t * (p.life - (p.max - 1))
        ctx.fillRect(-p.size * 0.25, -1, p.size * 0.5, 2)
      }
      ctx.restore()
    }
    ctx.globalAlpha = 1
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineCap = 'round'
    for (const p of this.streaks) {
      const t = p.life / p.max
      ctx.globalAlpha = Math.min(1, t * 1.6)
      ctx.strokeStyle = p.color
      ctx.lineWidth = p.width * (0.4 + t * 0.6)
      ctx.beginPath()
      ctx.moveTo(p.x, p.y)
      ctx.lineTo(p.x - p.vx * 0.028, p.y - p.vy * 0.028)
      ctx.stroke()
    }
    for (const w of this.waves) {
      const t = 1 - w.life / w.max
      const e = 1 - (1 - t) * (1 - t)
      const r = w.r0 + (w.r1 - w.r0) * e
      ctx.globalAlpha = (1 - t) * 0.9
      ctx.strokeStyle = w.color
      ctx.lineWidth = Math.max(0.5, w.width * (1 - t))
      ctx.beginPath()
      ctx.arc(w.x, w.y, Math.max(1, r), 0, Math.PI * 2)
      ctx.stroke()
    }
    for (const s of this.stars) {
      const t = s.life / s.max
      ctx.globalAlpha = t
      ctx.drawImage(glowSprite(s.color), s.x - s.size, s.y - s.size, s.size * 2, s.size * 2)
      ctx.fillStyle = s.color
      ctx.save()
      ctx.translate(s.x, s.y)
      ctx.rotate(s.angle)
      const l = s.size * (0.6 + 0.4 * t)
      const wdt = s.size * 0.12
      ctx.beginPath()
      ctx.moveTo(-l, 0)
      ctx.lineTo(0, -wdt)
      ctx.lineTo(l, 0)
      ctx.lineTo(0, wdt)
      ctx.closePath()
      ctx.moveTo(0, -l * 0.7)
      ctx.lineTo(wdt, 0)
      ctx.lineTo(0, l * 0.7)
      ctx.lineTo(-wdt, 0)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }
    ctx.restore()
    ctx.globalAlpha = 1
  }

  /** Cinders flying from where they were picked up to the counter, in screen space. */
  drawCoins(ctx: CanvasRenderingContext2D, toScreen: (x: number, y: number) => { x: number; y: number }, target: { x: number; y: number }): void {
    if (!this.coins.length) return
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (const c of this.coins) {
      const from = toScreen(c.x, c.y)
      const t = clamp(c.t / 0.6, 0, 1)
      const e = t * t * (3 - 2 * t)
      const x = from.x + (target.x - from.x) * e
      const y = from.y + (target.y - from.y) * e - Math.sin(t * Math.PI) * 80
      ctx.globalAlpha = 0.9
      ctx.drawImage(glowSprite('#ffb15a'), x - 12, y - 12, 24, 24)
      ctx.fillStyle = '#ffe0aa'
      ctx.beginPath()
      ctx.moveTo(x, y - 5)
      ctx.lineTo(x + 4.5, y + 4)
      ctx.lineTo(x - 4.5, y + 4)
      ctx.closePath()
      ctx.fill()
    }
    ctx.restore()
  }
}

// -----------------------------------------------------------------------------
// Shared drawing helpers.

const glowCache = new Map<string, HTMLCanvasElement>()

/** A soft radial glow in a colour, pre-rendered once. Draw it with 'lighter' for additive light. */
export function glowSprite(color: string): HTMLCanvasElement {
  let c = glowCache.get(color)
  if (c) return c
  c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, color)
  grad.addColorStop(0.25, withAlpha(color, 0.55))
  grad.addColorStop(0.6, withAlpha(color, 0.14))
  grad.addColorStop(1, withAlpha(color, 0))
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  glowCache.set(color, c)
  return c
}

function parseHex(hex: string): [number, number, number] {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map((x) => x + x).join('')
  const n = parseInt(h.slice(0, 6), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function withAlpha(hex: string, a: number): string {
  if (!hex.startsWith('#')) return hex
  const [r, g, b] = parseHex(hex)
  return `rgba(${r},${g},${b},${a})`
}

const shadeCache = new Map<string, string>()

/** Lighten (amt > 0) or darken (amt < 0) a hex colour. */
export function shade(hex: string, amt: number): string {
  const key = `${hex}|${amt}`
  let out = shadeCache.get(key)
  if (out) return out
  if (!hex.startsWith('#')) return hex
  const [r, g, b] = parseHex(hex)
  const f = (v: number) => Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt))
  out = `rgb(${f(r)},${f(g)},${f(b)})`
  shadeCache.set(key, out)
  return out
}
