import { TUNE } from './tune'
import type { Stats } from './types'
import { clamp } from './util'

export interface Body {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  spin: number
}

export interface Aabb {
  x: number
  y: number
  w: number
  h: number
}

export interface Contact {
  hit: boolean
  nx: number
  ny: number
  impactSpeed: number
}

/**
 * Horizontal acceleration. Mass slows both speeding up and turning around.
 * Friction is a force, so heavier balls are sluggish and carry slides.
 */
export function horizontalAccel(stats: Stats, inputX: number, vx: number, grounded: boolean): number {
  const massF = Math.pow(stats.mass, TUNE.massAccelExp)
  const control = grounded ? 1 : stats.airControl * (0.5 + 0.22 * Math.min(2.2, stats.stability))
  let ax = (inputX * stats.accel * control) / massF
  if (grounded && Math.abs(vx) > 10) {
    const sign = Math.sign(vx)
    const opposing = inputX === 0 || Math.sign(inputX) !== sign
    const fr = stats.friction * (opposing ? 920 : 160)
    ax -= (sign * fr) / massF
  } else if (!grounded) {
    ax -= vx * (0.28 / Math.max(0.55, stats.airControl))
  }
  if (!grounded && inputX !== 0 && vx !== 0 && Math.sign(vx) === -inputX) {
    ax += inputX * 240 * stats.stability
  }
  return ax
}

export function verticalAccel(stats: Stats, holdingUp: boolean, holdingDown: boolean, grounded: boolean): number {
  let ay = stats.gravity
  if (!grounded && holdingUp) {
    ay -= (stats.airThrust * stats.airControl) / Math.sqrt(stats.mass)
  }
  if (holdingDown) ay += 980
  return ay
}

/** Upward velocity (negative Y) imparted by a hop. */
export function hopVelocity(stats: Stats): number {
  return -stats.hop / Math.pow(stats.mass, TUNE.massHopExp)
}

export function ballRadius(mass: number): number {
  return TUNE.baseRadius + mass * TUNE.radiusPerMass
}

export function collisionDamage(stats: Stats, closingSpeed: number, comboMul: number, crit: boolean): number {
  const speed = Math.max(0, closingSpeed)
  let d = stats.mass * speed * TUNE.impactScale * stats.impact * comboMul
  if (crit) d *= stats.critMul
  return d
}

/**
 * Circle vs AABB. Normal points from the surface toward the circle.
 * Screen Y grows downward, so a floor contact has ny < 0.
 */
export function resolveCircleAabb(
  b: Body,
  box: Aabb,
  restitution: number,
  slideKeep: number,
  surfaceVx = 0,
  surfaceVy = 0,
): Contact {
  const closestX = clamp(b.x, box.x, box.x + box.w)
  const closestY = clamp(b.y, box.y, box.y + box.h)
  const dx = b.x - closestX
  const dy = b.y - closestY
  const d2 = dx * dx + dy * dy
  if (d2 > b.r * b.r) return { hit: false, nx: 0, ny: 0, impactSpeed: 0 }

  let nx: number
  let ny: number
  let pen: number
  const dist = Math.sqrt(d2)
  if (dist < 1e-5) {
    const left = b.x - box.x
    const right = box.x + box.w - b.x
    const top = b.y - box.y
    const bottom = box.y + box.h - b.y
    const min = Math.min(left, right, top, bottom)
    if (min === left) {
      nx = -1
      ny = 0
      pen = b.r + left
    } else if (min === right) {
      nx = 1
      ny = 0
      pen = b.r + right
    } else if (min === top) {
      nx = 0
      ny = -1
      pen = b.r + top
    } else {
      nx = 0
      ny = 1
      pen = b.r + bottom
    }
  } else {
    nx = dx / dist
    ny = dy / dist
    pen = b.r - dist
  }

  b.x += nx * pen
  b.y += ny * pen

  const rvx = b.vx - surfaceVx
  const rvy = b.vy - surfaceVy
  const vn = rvx * nx + rvy * ny
  if (vn >= 0) return { hit: true, nx, ny, impactSpeed: 0 }

  const impactSpeed = -vn
  const rest = impactSpeed < 36 ? 0 : restitution
  b.vx -= (1 + rest) * vn * nx
  b.vy -= (1 + rest) * vn * ny

  const tx = -ny
  const ty = nx
  const vt = (b.vx - surfaceVx) * tx + (b.vy - surfaceVy) * ty
  const keep = clamp(slideKeep, 0.05, 1)
  b.vx -= vt * (1 - keep) * tx
  b.vy -= vt * (1 - keep) * ty
  b.spin += vt * 0.004

  return { hit: true, nx, ny, impactSpeed }
}

export function selfCheckPhysics(): string[] {
  const errors: string[] = []
  const heavy: Stats = { ...baseLike(), mass: 2.3, accel: 1400, friction: 1.2, hop: 640, gravity: 1750 }
  const light: Stats = { ...baseLike(), mass: 0.55, accel: 1680, friction: 0.85, hop: 720, gravity: 1200, airControl: 1.3, airThrust: 1100 }
  const aH = Math.abs(horizontalAccel(heavy, 1, 0, true))
  const aL = Math.abs(horizontalAccel(light, 1, 0, true))
  if (!(aL > aH * 1.6)) errors.push(`light accel should dwarf heavy (${aL.toFixed(0)} vs ${aH.toFixed(0)})`)
  const hopH = Math.abs(hopVelocity(heavy))
  const hopL = Math.abs(hopVelocity(light))
  if (!(hopL > hopH * 1.25)) errors.push(`light hop should beat heavy (${hopL.toFixed(0)} vs ${hopH.toFixed(0)})`)

  const dHeavy = collisionDamage({ ...heavy, impact: 1.5 }, 600, 1, false)
  const dLight = collisionDamage({ ...light, impact: 0.72 }, 600, 1, false)
  if (!(dHeavy > dLight * 2)) errors.push(`heavy impact should hit much harder (${dHeavy.toFixed(1)} vs ${dLight.toFixed(1)})`)

  const body: Body = { x: 120, y: 20, vx: 40, vy: 0, r: 18, spin: 0 }
  const floor: Aabb = { x: 0, y: 220, w: 400, h: 80 }
  for (let i = 0; i < 240; i++) {
    body.vy += 1500 / 60
    body.x += body.vx / 60
    body.y += body.vy / 60
    const c = resolveCircleAabb(body, floor, 0.25, 0.4)
    if (c.hit && c.ny < -0.5 && Math.abs(body.vy) < 50) body.vy = 0
  }
  if (body.y > 220) errors.push(`ball sank through the floor (y=${body.y.toFixed(1)})`)
  if (Math.abs(body.vy) > 90) errors.push(`ball never settled (vy=${body.vy.toFixed(1)})`)

  const rubber = dropBounce(0.9)
  const stone = dropBounce(0.12)
  if (!(rubber > stone + 20)) errors.push(`rubber bounce should exceed stone (${rubber.toFixed(0)} vs ${stone.toFixed(0)})`)
  return errors
}

function baseLike(): Stats {
  return {
    mass: 1, gravity: 1480, accel: 1500, maxSpeed: 840, airControl: 1, hop: 680, airThrust: 900,
    restitution: 0.33, friction: 1, impact: 1, damageReduction: 0, maxHp: 100, energyMax: 100,
    energyRegen: 17, knockback: 1, selfDamage: 1, critChance: 0.05, critMul: 1.8, contact: 0, stability: 1,
  }
}

function dropBounce(rest: number): number {
  const body: Body = { x: 50, y: 0, vx: 0, vy: 0, r: 16, spin: 0 }
  const floor: Aabb = { x: 0, y: 200, w: 200, h: 40 }
  let peak = 200
  let bounced = false
  for (let i = 0; i < 180; i++) {
    body.vy += 1600 / 60
    body.y += body.vy / 60
    const before = body.vy
    resolveCircleAabb(body, floor, rest, 0.5)
    if (!bounced && before > 200 && body.vy < 0) bounced = true
    if (bounced) peak = Math.min(peak, body.y)
  }
  return 200 - peak
}
