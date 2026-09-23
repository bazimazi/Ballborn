import { BIOME } from './data/meta'
import { crusherPose, type Simulation } from './sim'
import type { Stats, VisualDef } from './types'
import { hopVelocity } from './physics'
import { clamp, hypot } from './util'

export interface Camera {
  x: number
  y: number
  zoom: number
  shakeX: number
  shakeY: number
}

export function makeCamera(): Camera {
  return { x: 400, y: 400, zoom: 1, shakeX: 0, shakeY: 0 }
}

export function updateCamera(cam: Camera, sim: Simulation, dt: number, shake: number, viewW: number, viewH: number): void {
  const lookX = sim.ball.x + sim.ball.vx * 0.15
  const lookY = sim.ball.y + Math.min(80, sim.ball.vy * 0.06) - 20
  const k = 1 - Math.exp(-5 * dt)
  cam.x += (lookX - cam.x) * k
  cam.y += (lookY - cam.y) * k
  const halfW = viewW / (2 * cam.zoom)
  const halfH = viewH / (2 * cam.zoom)
  cam.x = clamp(cam.x, halfW * 0.35, Math.max(halfW, sim.room.width - halfW * 0.35))
  cam.y = clamp(cam.y, halfH * 0.2, Math.max(halfH, sim.room.height - halfH * 0.45))
  const sp = hypot(sim.ball.vx, sim.ball.vy)
  const target = clamp(1.02 - sp / 5200, 0.86, 1.05)
  cam.zoom += (target - cam.zoom) * (1 - Math.exp(-2.4 * dt))
  cam.shakeX = (Math.random() * 2 - 1) * shake
  cam.shakeY = (Math.random() * 2 - 1) * shake
}

export function screenToWorld(cam: Camera, sx: number, sy: number, viewW: number, viewH: number): { x: number; y: number } {
  return {
    x: (sx - viewW / 2 - cam.shakeX) / cam.zoom + cam.x,
    y: (sy - viewH / 2 - cam.shakeY) / cam.zoom + cam.y,
  }
}

export function drawWorld(
  ctx: CanvasRenderingContext2D,
  sim: Simulation,
  cam: Camera,
  viewW: number,
  viewH: number,
  reduced: boolean,
  colorblind: boolean,
): void {
  const bg = ctx.createLinearGradient(0, 0, 0, viewH)
  bg.addColorStop(0, BIOME.skyTop)
  bg.addColorStop(1, BIOME.skyBottom)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, viewW, viewH)
  drawParallax(ctx, cam, viewH)

  ctx.save()
  ctx.translate(viewW / 2 + cam.shakeX, viewH / 2 + cam.shakeY)
  ctx.scale(cam.zoom, cam.zoom)
  ctx.translate(-cam.x, -cam.y)

  for (const h of sim.room.hazards) {
    if (h.type === 'lava') drawLava(ctx, h.x, h.y, h.w, h.h, sim.time)
    if (h.type === 'spikes') drawSpikes(ctx, h.x, h.y, h.w)
    if (h.type === 'geyser') drawGeyser(ctx, h, sim.time)
    if (h.type === 'crusher') drawCrusher(ctx, h, sim.time)
  }

  for (const s of sim.solids) {
    if (!s.alive) continue
    // Boundary walls and the ceiling sit outside the room. The floor starts
    // slightly left of 0 so it still has to draw.
    if (s.x + s.w <= 4 || s.y + s.h <= 4 || s.x >= sim.room.width - 4) continue
    drawBeam(ctx, s.x, s.y, s.w, s.h, s.kind, sim.time)
  }

  drawGate(ctx, sim)
  for (const p of sim.pickups) drawPickup(ctx, p.x, p.y, p.kind, sim.time)
  if (sim.boss) drawBoss(ctx, sim, colorblind)
  for (const e of sim.enemies) if (e.alive) drawEnemy(ctx, e, sim.time, colorblind)
  for (const b of sim.bullets) drawBullet(ctx, b.x, b.y, b.r, b.color, b.friendly)
  if (!reduced) {
    for (const p of sim.particles) drawParticle(ctx, p)
  } else {
    for (const p of sim.particles) if (p.kind === 'arc' || p.kind === 'ring') drawParticle(ctx, p)
  }
  drawBall(ctx, sim, colorblind)
  for (const f of sim.floaters) {
    ctx.globalAlpha = clamp(f.life * 2, 0, 1)
    ctx.fillStyle = f.color
    ctx.font = '700 16px Outfit, Segoe UI, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(f.text, f.x, f.y)
    ctx.globalAlpha = 1
  }
  if (sim.boss && sim.boss.attack === 'slam') drawTelegraph(ctx, sim.boss.slamX, 608, sim.boss.telegraph)
  if (sim.gateWarn > 0) {
    ctx.fillStyle = '#ffd15c'
    ctx.font = '700 18px Outfit, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('TOO SLOW', sim.room.exit.x + 20, sim.room.exit.y - 16)
  }
  ctx.restore()

  if (sim.hp < sim.maxHp * 0.32) {
    const g = ctx.createRadialGradient(viewW / 2, viewH / 2, viewW * 0.3, viewW / 2, viewH / 2, viewW * 0.72)
    g.addColorStop(0, 'rgba(0,0,0,0)')
    g.addColorStop(1, 'rgba(90, 16, 16, 0.45)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, viewW, viewH)
  }
}

function drawParallax(ctx: CanvasRenderingContext2D, cam: Camera, h: number): void {
  ctx.save()
  ctx.translate(-cam.x * 0.15, 0)
  ctx.strokeStyle = BIOME.girder
  ctx.lineWidth = 8
  ctx.globalAlpha = 0.55
  for (let i = -2; i < 14; i++) {
    const x = i * 180
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x + 40, h)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(x, 120)
    ctx.lineTo(x + 160, 120)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
  ctx.restore()
}

function drawLava(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, time: number): void {
  const g = ctx.createLinearGradient(0, y, 0, y + h)
  g.addColorStop(0, '#ffb15a')
  g.addColorStop(0.4, BIOME.lava)
  g.addColorStop(1, '#6a1408')
  ctx.fillStyle = g
  ctx.fillRect(x, y, w, h)
  ctx.globalAlpha = 0.45
  ctx.fillStyle = '#ffd7a1'
  for (let i = 0; i < 4; i++) {
    const bx = x + ((i * 97 + time * 30) % w)
    const by = y + 8 + Math.sin(time * 3 + i) * 4
    ctx.beginPath()
    ctx.arc(bx, by, 4, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

function drawSpikes(ctx: CanvasRenderingContext2D, x: number, y: number, w: number): void {
  ctx.fillStyle = '#b7a89a'
  ctx.beginPath()
  const n = Math.max(2, Math.floor(w / 16))
  ctx.moveTo(x, y + 16)
  for (let i = 0; i < n; i++) {
    const px = x + (i * w) / n
    ctx.lineTo(px + w / n / 2, y - 2)
    ctx.lineTo(px + w / n, y + 16)
  }
  ctx.fill()
}

function drawGeyser(ctx: CanvasRenderingContext2D, h: { x: number; y: number; w: number; h: number; period?: number; phase?: number }, time: number): void {
  const period = h.period ?? 2.4
  const t = ((time + (h.phase ?? 0)) % period + period) % period
  const warn = t > period - 0.7
  const erupt = t > period - 0.28
  ctx.fillStyle = warn ? 'rgba(255, 90, 30, 0.35)' : 'rgba(255,255,255,0.05)'
  ctx.fillRect(h.x, h.y - 8, h.w, 14)
  if (erupt) drawLava(ctx, h.x + 8, h.y - 70, h.w - 16, 78, time)
}

function drawCrusher(ctx: CanvasRenderingContext2D, h: { x: number; y: number; w: number; h: number; drop?: number; period?: number; phase?: number }, time: number): void {
  const pose = crusherPose(h, time)
  ctx.fillStyle = pose.warn ? 'rgba(255, 80, 40, 0.28)' : 'rgba(0,0,0,0.25)'
  ctx.fillRect(h.x, 590, h.w, 18)
  ctx.strokeStyle = '#4a433c'
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.moveTo(h.x + h.w / 2, 0)
  ctx.lineTo(h.x + h.w / 2, pose.y)
  ctx.stroke()
  drawBeam(ctx, h.x, pose.y, h.w, h.h, 'metal', time)
}

function drawBeam(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, kind: string, time: number): void {
  const floor = h >= 80
  ctx.fillStyle = kind === 'spring' ? '#6a5344' : kind === 'conveyor' ? '#4e5854' : kind === 'ice' ? '#6e8c90' : floor ? '#3a332c' : '#4a433c'
  ctx.fillRect(x, y, w, h)
  ctx.fillStyle = kind === 'spring' ? '#ffb15a' : kind === 'ice' ? '#d5f4f6' : '#f3eadc'
  ctx.fillRect(x, y, w, floor ? 7 : 3)
  if (floor) {
    ctx.fillStyle = '#6a5c4e'
    for (let px = x + 28; px < x + w; px += 84) ctx.fillRect(px, y + 7, 2, 18)
  }
  ctx.fillStyle = '#2a241e'
  const rivets = Math.max(2, Math.floor(w / 48))
  for (let i = 0; i < rivets; i++) {
    ctx.beginPath()
    ctx.arc(x + 12 + ((w - 24) * i) / Math.max(1, rivets - 1), y + h * 0.55, 2.2, 0, Math.PI * 2)
    ctx.fill()
  }
  if (kind === 'conveyor') {
    ctx.strokeStyle = '#d9cbb8'
    ctx.globalAlpha = 0.7
    ctx.beginPath()
    const shift = (time * 80) % 20
    for (let px = x + shift; px < x + w; px += 20) {
      ctx.moveTo(px, y + 8)
      ctx.lineTo(px + 8, y + 8)
    }
    ctx.stroke()
    ctx.globalAlpha = 1
  }
  if (kind === 'spring') {
    ctx.strokeStyle = '#ffcf8a'
    ctx.lineWidth = 2
    ctx.strokeRect(x + 4, y + 4, w - 8, h - 8)
  }
}

function drawGate(ctx: CanvasRenderingContext2D, sim: Simulation): void {
  const e = sim.room.exit
  ctx.fillStyle = sim.exitOpen ? '#ffb15a' : '#3a332c'
  ctx.fillRect(e.x, e.y, 10, e.h)
  ctx.fillRect(e.x + e.w - 10, e.y, 10, e.h)
  ctx.fillRect(e.x, e.y, e.w, 10)
  if (sim.exitOpen) {
    ctx.fillStyle = 'rgba(255, 177, 90, 0.28)'
    ctx.fillRect(e.x + 10, e.y + 10, e.w - 20, e.h - 10)
  }
}

function drawPickup(ctx: CanvasRenderingContext2D, x: number, y: number, kind: string, time: number): void {
  ctx.save()
  ctx.translate(x, y + Math.sin(time * 4 + x) * 2)
  ctx.fillStyle = kind === 'heal' ? '#7dffb3' : '#ffb15a'
  ctx.beginPath()
  if (kind === 'heal') ctx.arc(0, 0, 7, 0, Math.PI * 2)
  else {
    ctx.moveTo(0, -8)
    ctx.lineTo(7, 6)
    ctx.lineTo(-7, 6)
    ctx.closePath()
  }
  ctx.fill()
  ctx.restore()
}

function drawBullet(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, friendly: boolean): void {
  ctx.fillStyle = friendly ? '#eafff6' : color
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
}

function drawParticle(ctx: CanvasRenderingContext2D, p: { x: number; y: number; x2?: number; y2?: number; life: number; max: number; size: number; color: string; kind: string }): void {
  ctx.globalAlpha = clamp(p.life / p.max, 0, 1)
  if (p.kind === 'arc' && p.x2 !== undefined && p.y2 !== undefined) {
    ctx.strokeStyle = p.color
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
    ctx.lineTo(p.x2, p.y2)
    ctx.stroke()
  } else if (p.kind === 'ring') {
    ctx.strokeStyle = p.color
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(p.x, p.y, p.size + (1 - p.life / p.max) * 40, 0, Math.PI * 2)
    ctx.stroke()
  } else {
    ctx.fillStyle = p.color
    ctx.fillRect(p.x, p.y, p.size, p.size)
  }
  ctx.globalAlpha = 1
}

function drawEnemy(ctx: CanvasRenderingContext2D, e: Simulation['enemies'][number], time: number, colorblind: boolean): void {
  ctx.save()
  ctx.translate(e.x, e.y)
  if (e.hitFlash > 0) ctx.globalAlpha = 0.65
  ctx.fillStyle = e.color
  ctx.strokeStyle = e.accent
  ctx.lineWidth = 2
  const r = e.r
  ctx.beginPath()
  if (e.shape === 'diamond' || e.shape === 'spark') {
    ctx.moveTo(0, -r)
    ctx.lineTo(r, 0)
    ctx.lineTo(0, r)
    ctx.lineTo(-r, 0)
    ctx.closePath()
  } else if (e.shape === 'hex' || e.shape === 'knight') {
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 2
      const px = Math.cos(a) * r
      const py = Math.sin(a) * r
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.closePath()
  } else if (e.shape === 'shield') {
    ctx.roundRect(-r, -r * 0.8, r * 2, r * 1.6, 4)
  } else if (e.shape === 'cask') {
    ctx.rect(-r * 0.8, -r, r * 1.6, r * 2)
  } else if (e.shape === 'mite') {
    ctx.arc(0, 0, r, Math.PI * 0.15, Math.PI * 0.85, true)
  } else if (e.shape === 'wisp') {
    ctx.arc(0, 0, r * (0.85 + Math.sin(time * 6) * 0.08), 0, Math.PI * 2)
  } else if (e.shape === 'turret') {
    ctx.rect(-r, -r * 0.4, r * 2, r * 1.2)
  } else {
    ctx.arc(0, 0, r, 0, Math.PI * 2)
  }
  ctx.fill()
  ctx.stroke()
  if (e.shape === 'turret') {
    ctx.strokeStyle = e.accent
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(e.facing * r * 1.4, -4)
    ctx.stroke()
  }
  if (e.shield) {
    ctx.strokeStyle = '#f3efe6'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(e.facing * r * 0.2, 0, r + 4, e.facing > 0 ? -1 : Math.PI - 1, e.facing > 0 ? 1 : Math.PI + 1)
    ctx.stroke()
  }
  if (e.burn > 0) {
    ctx.fillStyle = '#ff6a2a'
    ctx.fillRect(-4, -r - 8, 8, 6)
  }
  if (colorblind && e.elite) {
    ctx.fillStyle = '#fff'
    ctx.fillRect(-2, -2, 4, 4)
  }
  ctx.restore()
  const pct = clamp(e.hp / e.maxHp, 0, 1)
  ctx.fillStyle = 'rgba(0,0,0,0.45)'
  ctx.fillRect(e.x - 16, e.y - e.r - 14, 32, 4)
  ctx.fillStyle = e.elite ? '#ffd15c' : '#ffb15a'
  ctx.fillRect(e.x - 16, e.y - e.r - 14, 32 * pct, 4)
}

function drawBoss(ctx: CanvasRenderingContext2D, sim: Simulation, colorblind: boolean): void {
  const b = sim.boss
  if (!b || b.hp <= 0) return
  ctx.save()
  ctx.translate(b.x, b.y)
  ctx.fillStyle = b.hitFlash > 0 ? '#fff1df' : '#6a3a30'
  ctx.fillRect(-70, -90, 140, 170)
  ctx.fillStyle = '#3a241e'
  ctx.fillRect(-50, -70, 100, 120)
  ctx.fillStyle = b.phase === 1 ? '#8a847c' : '#ffb15a'
  ctx.beginPath()
  ctx.arc(0, -10, 28, 0, Math.PI * 2)
  ctx.fill()
  if (colorblind) {
    ctx.fillStyle = '#111'
    ctx.fillRect(-8, -16, 16, 6)
  }
  ctx.restore()
  for (const r of b.rivets) {
    if (!r.alive) continue
    ctx.fillStyle = '#ffd15c'
    ctx.beginPath()
    ctx.arc(b.x + r.ox, b.y + r.oy, 12, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#2a2118'
    ctx.fillRect(b.x + r.ox - 8, b.y + r.oy - 2, 16 * (r.hp / r.max), 4)
  }
  const pct = b.hp / b.maxHp
  ctx.fillStyle = 'rgba(0,0,0,0.5)'
  ctx.fillRect(b.x - 70, b.y - 120, 140, 8)
  ctx.fillStyle = '#ff5a1f'
  ctx.fillRect(b.x - 70, b.y - 120, 140 * pct, 8)
}

function drawTelegraph(ctx: CanvasRenderingContext2D, x: number, y: number, t: number): void {
  ctx.save()
  ctx.globalAlpha = 0.35 + Math.sin(t * 24) * 0.1
  ctx.fillStyle = '#ff4d3a'
  ctx.fillRect(x - 64, y - 8, 128, 16)
  ctx.restore()
}

function drawBall(ctx: CanvasRenderingContext2D, sim: Simulation, colorblind: boolean): void {
  const b = sim.ball
  const v = sim.build.visual
  const sp = hypot(b.vx, b.vy)
  ctx.save()
  if (sim.trail.length > 1 && sp > 80) {
    ctx.strokeStyle = v.trail
    ctx.globalAlpha = 0.35
    ctx.lineWidth = b.r * 0.7
    ctx.lineCap = 'round'
    ctx.beginPath()
    const start = sim.trail[0]!
    ctx.moveTo(start.x, start.y)
    for (const p of sim.trail) ctx.lineTo(p.x, p.y)
    ctx.stroke()
    ctx.globalAlpha = 1
  }
  ctx.translate(b.x, b.y)
  const ang = Math.atan2(b.vy, b.vx)
  const stretch = clamp(sp / 1400, 0, 0.28) + sim.squash
  ctx.rotate(ang)
  ctx.scale(1 + stretch, 1 - stretch * 0.65)
  ctx.rotate(-ang)
  ctx.rotate(b.spin)
  const g = ctx.createRadialGradient(-b.r * 0.3, -b.r * 0.35, 2, 0, 0, b.r)
  g.addColorStop(0, '#fff6ea')
  g.addColorStop(0.45, v.core)
  g.addColorStop(1, '#2a160f')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(0, 0, b.r, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = v.shell
  ctx.lineWidth = 4
  ctx.stroke()
  drawPattern(ctx, v, b.r, colorblind)
  if (sim.phase > 0) {
    ctx.globalAlpha = 0.45
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.globalAlpha = 1
  }
  if (sim.instability > 8) {
    ctx.globalAlpha = sim.instability / 160
    ctx.fillStyle = '#ff4d6a'
    ctx.beginPath()
    ctx.arc(0, 0, b.r * 0.45, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
  }
  ctx.restore()
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(b.x, b.y, b.r + 7, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(sp / sim.stats.maxSpeed, 0, 1))
  ctx.stroke()
}

function drawPattern(ctx: CanvasRenderingContext2D, v: VisualDef, r: number, colorblind: boolean): void {
  ctx.strokeStyle = v.shell
  ctx.fillStyle = v.shell
  ctx.lineWidth = 1.5
  if (v.pattern === 'spikes') {
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI / 4) * i
      ctx.beginPath()
      ctx.moveTo(Math.cos(a) * (r - 2), Math.sin(a) * (r - 2))
      ctx.lineTo(Math.cos(a) * (r + 7), Math.sin(a) * (r + 7))
      ctx.stroke()
    }
  } else if (v.pattern === 'rings') {
    ctx.beginPath()
    ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2)
    ctx.stroke()
  } else if (v.pattern === 'flames') {
    ctx.beginPath()
    ctx.moveTo(-4, r * 0.2)
    ctx.lineTo(0, -r * 0.7)
    ctx.lineTo(4, r * 0.2)
    ctx.fill()
  } else if (v.pattern === 'arcs') {
    ctx.beginPath()
    ctx.arc(-2, 2, r * 0.45, Math.PI, 0)
    ctx.stroke()
  } else if (v.pattern === 'glass') {
    ctx.beginPath()
    ctx.moveTo(-r * 0.2, -r * 0.6)
    ctx.lineTo(r * 0.5, r * 0.2)
    ctx.stroke()
  } else if (v.pattern === 'plating') {
    ctx.strokeRect(-r * 0.35, -r * 0.35, r * 0.7, r * 0.7)
  } else if (v.pattern === 'magnet') {
    ctx.beginPath()
    ctx.arc(0, 2, r * 0.4, Math.PI * 0.1, Math.PI * 0.9)
    ctx.stroke()
  }
  if (colorblind) {
    ctx.beginPath()
    ctx.moveTo(-r * 0.25, 0)
    ctx.lineTo(r * 0.25, 0)
    ctx.moveTo(0, -r * 0.25)
    ctx.lineTo(0, r * 0.25)
    ctx.stroke()
  }
}

export function drawTitleScene(ctx: CanvasRenderingContext2D, w: number, h: number, time: number): void {
  const bg = ctx.createLinearGradient(0, 0, 0, h)
  bg.addColorStop(0, '#14110f')
  bg.addColorStop(1, '#2a1c14')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = '#3a332c'
  ctx.lineWidth = 6
  ctx.globalAlpha = 0.7
  for (let i = 0; i < 8; i++) {
    ctx.beginPath()
    ctx.moveTo(i * 160 - (time * 20) % 160, 0)
    ctx.lineTo(i * 160 + 50 - (time * 20) % 160, h)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
  const builds = [
    { core: '#c4552a', shell: '#e8e2d6', r: 46, pattern: 'spikes' as const },
    { core: '#f2d2a2', shell: '#3ecf8e', r: 28, pattern: 'rings' as const },
    { core: '#7ec8ff', shell: '#8fd0ff', r: 34, pattern: 'arcs' as const },
  ]
  const which = builds[Math.floor(time / 3.2) % builds.length]!
  const x = w * 0.72
  const base = h * 0.62
  const hop = Math.abs(Math.sin(time * 2.2))
  const y = base - hop * hop * (which.r > 40 ? 70 : 160)
  ctx.fillStyle = 'rgba(0,0,0,0.35)'
  ctx.beginPath()
  ctx.ellipse(x, base + which.r, which.r * 0.9, 10, 0, 0, Math.PI * 2)
  ctx.fill()
  const g = ctx.createRadialGradient(x - 8, y - 10, 2, x, y, which.r)
  g.addColorStop(0, '#fff1e0')
  g.addColorStop(0.18, which.core)
  g.addColorStop(1, '#1a100c')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(x, y, which.r, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = which.shell
  ctx.lineWidth = 5
  ctx.stroke()
  ctx.fillStyle = '#6a6258'
  ctx.fillRect(w * 0.5, base + which.r, w * 0.46, 18)
}

export class CardPreview {
  x = 28
  y = 20
  vx = 90
  vy = 0
  private acc = 0

  constructor(
    public stats: Stats,
    public visual: VisualDef,
  ) {}

  step(ctx: CanvasRenderingContext2D, dt: number): void {
    const canvas = ctx.canvas
    const w = canvas.clientWidth || canvas.width
    const h = canvas.clientHeight || canvas.height
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const bw = Math.max(1, Math.round(w * dpr))
    const bh = Math.max(1, Math.round(h * dpr))
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw
      canvas.height = bh
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const r = clamp(7 + this.stats.mass * 2.4, 6, 16)
    this.vy += this.stats.gravity * 0.35 * dt
    this.vx += (this.vx > 0 ? 1 : -1) * 40 * dt
    this.x += this.vx * dt
    this.y += this.vy * dt
    if (this.y > h - 16 - r) {
      this.y = h - 16 - r
      this.vy = hopVelocity(this.stats) * 0.16 * this.stats.restitution * 3.2
      if (this.vy > -40) this.vy = -40 - this.stats.restitution * 30
    }
    if (this.x < r + 8) {
      this.x = r + 8
      this.vx = Math.abs(this.vx) * this.stats.restitution
    }
    if (this.x > w - r - 8) {
      this.x = w - r - 8
      this.vx = -Math.abs(this.vx)
    }
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = '#1a1612'
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = '#4a433c'
    ctx.fillRect(0, h - 16, w, 16)
    ctx.fillStyle = '#f3eadc'
    ctx.fillRect(0, h - 16, w, 3)
    ctx.fillStyle = this.visual.core
    ctx.beginPath()
    ctx.arc(this.x, this.y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = this.visual.shell ?? '#efe6d6'
    ctx.lineWidth = 2
    ctx.stroke()
    this.acc += dt
  }
}
