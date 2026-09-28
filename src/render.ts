import { BIOME } from './data/meta'
import { crusherPose, geyserPhase, type Simulation } from './sim'
import type { Stats, VisualDef } from './types'
import { ballRadius, hopVelocity, horizontalAccel, resolveCircleAabb, verticalAccel, type Body } from './physics'
import { clamp, hypot, lerp } from './util'

export interface Camera {
  x: number
  y: number
  zoom: number
  shakeX: number
  shakeY: number
}

export interface DrawOptions {
  /** Fraction of a tick elapsed since the last simulation step. */
  alpha: number
  particles: number
  colorblind: boolean
  contrast: boolean
  flash: number
}

export function makeCamera(): Camera {
  return { x: 400, y: 400, zoom: 1, shakeX: 0, shakeY: 0 }
}

export function ballView(sim: Simulation, alpha: number): { x: number; y: number } {
  return { x: lerp(sim.prevX, sim.ball.x, alpha), y: lerp(sim.prevY, sim.ball.y, alpha) }
}

export function updateCamera(cam: Camera, sim: Simulation, dt: number, shake: number, viewW: number, viewH: number, motion: boolean, alpha: number, noise: () => number): void {
  const b = ballView(sim, alpha)
  // Look ahead in the direction of travel so a fast ball can see where it will stop or land.
  const look = motion ? 0.22 : 0.1
  const lookX = b.x + clamp(sim.ball.vx * look, -viewW * 0.22, viewW * 0.22)
  const lookY = b.y + clamp(sim.ball.vy * 0.06, -40, 90) - 30
  const k = 1 - Math.exp(-5.5 * dt)
  cam.x += (lookX - cam.x) * k
  cam.y += (lookY - cam.y) * k
  const sp = hypot(sim.ball.vx, sim.ball.vy)
  const target = motion ? clamp(1.02 - sp / 5200, 0.86, 1.05) : 0.96
  cam.zoom += (target - cam.zoom) * (1 - Math.exp(-2.4 * dt))
  const halfW = viewW / (2 * cam.zoom)
  const halfH = viewH / (2 * cam.zoom)
  cam.x = clamp(cam.x, Math.min(halfW, sim.room.width / 2), Math.max(sim.room.width / 2, sim.room.width - halfW))
  cam.y = clamp(cam.y, Math.min(halfH, sim.room.height / 2) - 60, Math.max(sim.room.height / 2, sim.room.height - halfH + 40))
  cam.shakeX = (noise() * 2 - 1) * shake
  cam.shakeY = (noise() * 2 - 1) * shake
}

export function screenToWorld(cam: Camera, sx: number, sy: number, viewW: number, viewH: number): { x: number; y: number } {
  return {
    x: (sx - viewW / 2 - cam.shakeX) / cam.zoom + cam.x,
    y: (sy - viewH / 2 - cam.shakeY) / cam.zoom + cam.y,
  }
}

export function drawWorld(ctx: CanvasRenderingContext2D, sim: Simulation, cam: Camera, viewW: number, viewH: number, o: DrawOptions): void {
  const bg = ctx.createLinearGradient(0, 0, 0, viewH)
  bg.addColorStop(0, o.contrast ? '#000' : BIOME.skyTop)
  bg.addColorStop(1, o.contrast ? '#0a0806' : BIOME.skyBottom)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, viewW, viewH)
  if (!o.contrast) drawParallax(ctx, cam, viewH)

  ctx.save()
  ctx.translate(viewW / 2 + cam.shakeX, viewH / 2 + cam.shakeY)
  ctx.scale(cam.zoom, cam.zoom)
  ctx.translate(-cam.x, -cam.y)

  for (const h of sim.hazards) {
    if (h.type === 'lava') drawLava(ctx, h.x, h.y, h.w, h.h, sim.time, o.contrast)
    if (h.type === 'spikes') drawSpikes(ctx, h.x, h.y, h.w, o.contrast)
    if (h.type === 'geyser') drawGeyser(ctx, h, sim.time, o.contrast)
    if (h.type === 'crusher') drawCrusher(ctx, h, sim.time, o.contrast)
  }

  const collapsing = !!sim.boss && sim.boss.collapse > 0
  for (const s of sim.solids) {
    if (!s.alive || s.bounds) continue
    drawBeam(ctx, s.x, s.y, s.w, s.h, s.kind, sim.time, o.contrast)
    if (collapsing && s.breakable) drawCollapseWarning(ctx, s, sim.boss!.collapse, sim.time)
  }

  drawGate(ctx, sim)
  for (const p of sim.pickups) drawPickup(ctx, p.x, p.y, p.kind, sim.time, p.life)
  if (sim.boss) drawBoss(ctx, sim, o)
  for (const e of sim.enemies) if (e.alive) drawEnemy(ctx, e, sim.time, o)
  for (const b of sim.bullets) drawBullet(ctx, b.x, b.y, b.r, b.color, b.friendly, o.contrast)
  const limit = Math.round(sim.particles.length * o.particles)
  for (let i = 0; i < sim.particles.length; i++) {
    const p = sim.particles[i]!
    // Rings and arcs carry information (a blast radius, a chain), so they always draw.
    if (p.kind === 'arc' || p.kind === 'ring' || i < limit) drawParticle(ctx, p)
  }
  drawBall(ctx, sim, o)
  ctx.textAlign = 'center'
  ctx.font = '700 16px Outfit, Segoe UI, sans-serif'
  for (const f of sim.floaters) {
    ctx.globalAlpha = clamp(f.life * 2, 0, 1)
    if (o.contrast) {
      ctx.lineWidth = 4
      ctx.strokeStyle = '#000'
      ctx.strokeText(f.text, f.x, f.y)
    }
    ctx.fillStyle = f.color
    ctx.fillText(f.text, f.x, f.y)
    ctx.globalAlpha = 1
  }
  if (sim.boss && sim.boss.attack === 'slam') drawTelegraph(ctx, sim.boss.slamX, 608, sim.boss.telegraph)
  if (sim.gateWarn > 0) {
    ctx.fillStyle = '#ffd15c'
    ctx.font = '700 18px Outfit, sans-serif'
    ctx.fillText('TOO SLOW', sim.room.exit.x + 20, sim.room.exit.y - 16)
  }
  if (collapsing) {
    ctx.fillStyle = '#ff5d3a'
    ctx.font = '800 22px Syne, Outfit, sans-serif'
    const s = sim.solids.find((x) => x.breakable)
    if (s) ctx.fillText(`FLOOR GIVING WAY ${sim.boss!.collapse.toFixed(1)}`, s.x + s.w / 2, s.y - 120)
  }
  ctx.restore()

  if (sim.lowHp) {
    const g = ctx.createRadialGradient(viewW / 2, viewH / 2, viewW * 0.3, viewW / 2, viewH / 2, viewW * 0.72)
    g.addColorStop(0, 'rgba(0,0,0,0)')
    g.addColorStop(1, 'rgba(90, 16, 16, 0.45)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, viewW, viewH)
  }
  if (o.flash > 0) {
    ctx.fillStyle = `rgba(255, 240, 220, ${clamp(o.flash, 0, 0.5)})`
    ctx.fillRect(0, 0, viewW, viewH)
  }
}

function drawParallax(ctx: CanvasRenderingContext2D, cam: Camera, h: number): void {
  ctx.save()
  ctx.translate(-cam.x * 0.15, 0)
  ctx.strokeStyle = BIOME.girder
  ctx.lineWidth = 8
  ctx.globalAlpha = 0.55
  ctx.beginPath()
  for (let i = -2; i < 16; i++) {
    const x = i * 180
    ctx.moveTo(x, 0)
    ctx.lineTo(x + 40, h)
    ctx.moveTo(x, 120)
    ctx.lineTo(x + 160, 120)
  }
  ctx.stroke()
  ctx.globalAlpha = 1
  ctx.restore()
}

function drawLava(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, time: number, contrast: boolean): void {
  const g = ctx.createLinearGradient(0, y, 0, y + h)
  g.addColorStop(0, '#ffb15a')
  g.addColorStop(0.4, BIOME.lava)
  g.addColorStop(1, '#6a1408')
  ctx.fillStyle = g
  ctx.fillRect(x, y, w, h)
  // A zigzag lip marks slag by shape as well as colour.
  ctx.strokeStyle = contrast ? '#fff' : '#ffd7a1'
  ctx.lineWidth = contrast ? 3 : 2
  ctx.beginPath()
  for (let px = x; px <= x + w; px += 12) ctx.lineTo(px, y + ((px - x) / 12) % 2 * 5)
  ctx.stroke()
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

function drawSpikes(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, contrast: boolean): void {
  ctx.fillStyle = contrast ? '#ffffff' : '#b7a89a'
  ctx.beginPath()
  const n = Math.max(2, Math.floor(w / 16))
  ctx.moveTo(x, y + 16)
  for (let i = 0; i < n; i++) {
    const px = x + (i * w) / n
    ctx.lineTo(px + w / n / 2, y - 2)
    ctx.lineTo(px + w / n, y + 16)
  }
  ctx.fill()
  if (contrast) {
    ctx.strokeStyle = '#ff3b3b'
    ctx.lineWidth = 2
    ctx.stroke()
  }
}

function drawGeyser(ctx: CanvasRenderingContext2D, h: { x: number; y: number; w: number; h: number; period?: number; phase?: number }, time: number, contrast: boolean): void {
  const g = geyserPhase(h, time)
  ctx.fillStyle = g.warn ? 'rgba(255, 90, 30, 0.45)' : contrast ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.06)'
  ctx.fillRect(h.x, h.y - 8, h.w, 14)
  if (g.warn && !g.erupt) {
    // Rising chevrons: the warning reads without colour.
    ctx.strokeStyle = '#ffd15c'
    ctx.lineWidth = 3
    ctx.beginPath()
    const cx = h.x + h.w / 2
    ctx.moveTo(cx - 12, h.y - 20)
    ctx.lineTo(cx, h.y - 32)
    ctx.lineTo(cx + 12, h.y - 20)
    ctx.stroke()
  }
  if (g.erupt) drawLava(ctx, h.x + 8, h.y - 70, h.w - 16, 78, time, contrast)
}

function drawCrusher(ctx: CanvasRenderingContext2D, h: { x: number; y: number; w: number; h: number; drop?: number; period?: number; phase?: number }, time: number, contrast: boolean): void {
  const pose = crusherPose(h, time)
  const landing = h.y + (h.drop ?? 220) + h.h
  ctx.fillStyle = pose.warn ? 'rgba(255, 80, 40, 0.4)' : 'rgba(0,0,0,0.25)'
  ctx.fillRect(h.x, landing - 18, h.w, 18)
  if (pose.warn) {
    ctx.strokeStyle = '#ffd15c'
    ctx.lineWidth = 2
    ctx.setLineDash([8, 6])
    ctx.strokeRect(h.x, pose.y, h.w, landing - pose.y)
    ctx.setLineDash([])
  }
  ctx.strokeStyle = '#4a433c'
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.moveTo(h.x + h.w / 2, 0)
  ctx.lineTo(h.x + h.w / 2, pose.y)
  ctx.stroke()
  drawBeam(ctx, h.x, pose.y, h.w, h.h, 'metal', time, contrast)
  ctx.fillStyle = pose.smashing ? '#ff5d3a' : '#ffb15a'
  for (let px = h.x + 6; px < h.x + h.w - 8; px += 18) ctx.fillRect(px, pose.y + h.h - 6, 10, 6)
}

function drawBeam(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, kind: string, time: number, contrast: boolean): void {
  const floor = h >= 80
  ctx.fillStyle = kind === 'spring' ? '#6a5344' : kind === 'conveyor' ? '#4e5854' : kind === 'ice' ? '#6e8c90' : floor ? '#3a332c' : '#4a433c'
  ctx.fillRect(x, y, w, h)
  ctx.fillStyle = kind === 'spring' ? '#ffb15a' : kind === 'ice' ? '#d5f4f6' : '#f3eadc'
  ctx.fillRect(x, y, w, floor ? 7 : 3)
  if (contrast) {
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 2
    ctx.strokeRect(x + 1, y + 1, w - 2, Math.min(h, 200) - 2)
  }
  if (floor) {
    ctx.fillStyle = '#6a5c4e'
    for (let px = x + 28; px < x + w; px += 84) ctx.fillRect(px, y + 7, 2, 18)
  }
  ctx.fillStyle = '#2a241e'
  const rivets = Math.max(2, Math.floor(w / 48))
  ctx.beginPath()
  for (let i = 0; i < rivets; i++) {
    const rx = x + 12 + ((w - 24) * i) / Math.max(1, rivets - 1)
    ctx.moveTo(rx + 2.2, y + Math.min(h, 40) * 0.55)
    ctx.arc(rx, y + Math.min(h, 40) * 0.55, 2.2, 0, Math.PI * 2)
  }
  ctx.fill()
  if (kind === 'conveyor') {
    ctx.strokeStyle = '#d9cbb8'
    ctx.lineWidth = 2
    ctx.globalAlpha = 0.7
    ctx.beginPath()
    const shift = (time * 80) % 20
    for (let px = x + shift; px < x + w - 8; px += 20) {
      ctx.moveTo(px, y + 12)
      ctx.lineTo(px + 8, y + 8)
      ctx.lineTo(px, y + 4)
    }
    ctx.stroke()
    ctx.globalAlpha = 1
  }
  if (kind === 'spring') {
    ctx.strokeStyle = '#ffcf8a'
    ctx.lineWidth = 2
    ctx.strokeRect(x + 4, y + 4, w - 8, h - 8)
    ctx.beginPath()
    for (let px = x + 10; px < x + w - 10; px += 14) {
      ctx.moveTo(px, y + h - 4)
      ctx.lineTo(px + 7, y + 6)
    }
    ctx.stroke()
  }
}

function drawCollapseWarning(ctx: CanvasRenderingContext2D, s: { x: number; y: number; w: number }, left: number, time: number): void {
  const pulse = 0.4 + 0.35 * Math.abs(Math.sin(time * (6 + (1.8 - left) * 8)))
  ctx.fillStyle = `rgba(255, 70, 30, ${pulse})`
  ctx.fillRect(s.x, s.y, s.w, 12)
  ctx.strokeStyle = '#1a0d08'
  ctx.lineWidth = 3
  ctx.beginPath()
  for (let px = s.x + 20; px < s.x + s.w; px += 60) {
    ctx.moveTo(px, s.y)
    ctx.lineTo(px + 14, s.y + 16)
    ctx.lineTo(px + 4, s.y + 30)
  }
  ctx.stroke()
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
    ctx.fillStyle = '#ffe7c2'
    ctx.beginPath()
    const cx = e.x + e.w / 2
    const cy = e.y + e.h / 2
    ctx.moveTo(cx - 8, cy - 12)
    ctx.lineTo(cx + 8, cy)
    ctx.lineTo(cx - 8, cy + 12)
    ctx.fill()
  } else {
    ctx.strokeStyle = '#6a5c4e'
    ctx.lineWidth = 3
    ctx.beginPath()
    for (let px = e.x + 18; px < e.x + e.w - 10; px += 12) {
      ctx.moveTo(px, e.y + 10)
      ctx.lineTo(px, e.y + e.h)
    }
    ctx.stroke()
  }
}

function drawPickup(ctx: CanvasRenderingContext2D, x: number, y: number, kind: string, time: number, life: number): void {
  if (kind === 'heal' && life < 3 && Math.floor(time * 8) % 2 === 0) return
  ctx.save()
  ctx.translate(x, y + Math.sin(time * 4 + x) * 2)
  ctx.fillStyle = kind === 'heal' ? '#7dffb3' : '#ffb15a'
  ctx.beginPath()
  if (kind === 'heal') {
    ctx.rect(-2.5, -7, 5, 14)
    ctx.rect(-7, -2.5, 14, 5)
  } else {
    ctx.moveTo(0, -8)
    ctx.lineTo(7, 6)
    ctx.lineTo(-7, 6)
    ctx.closePath()
  }
  ctx.fill()
  ctx.restore()
}

function drawBullet(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, friendly: boolean, contrast: boolean): void {
  ctx.fillStyle = friendly ? '#eafff6' : color
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
  if (contrast || friendly) {
    ctx.strokeStyle = friendly ? '#1fa971' : '#ff3b3b'
    ctx.lineWidth = 2
    ctx.stroke()
  }
}

function drawParticle(ctx: CanvasRenderingContext2D, p: { x: number; y: number; x2?: number; y2?: number; life: number; max: number; size: number; color: string; kind: string }): void {
  if (p.life <= 0) return
  ctx.globalAlpha = clamp(p.life / p.max, 0, 1)
  if (p.kind === 'arc' && p.x2 !== undefined && p.y2 !== undefined) {
    ctx.strokeStyle = p.color
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
    ctx.lineTo((p.x + p.x2) / 2 + 6, (p.y + p.y2) / 2 - 6)
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

function drawEnemy(ctx: CanvasRenderingContext2D, e: Simulation['enemies'][number], time: number, o: DrawOptions): void {
  ctx.save()
  ctx.translate(e.x, e.y)
  ctx.fillStyle = e.hitFlash > 0 ? '#fff1df' : e.color
  ctx.strokeStyle = o.contrast ? '#ffffff' : e.accent
  ctx.lineWidth = o.contrast ? 3 : 2
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
  } else if (e.shape === 'splitter') {
    ctx.arc(0, 0, r, 0, Math.PI * 2)
    ctx.moveTo(0, -r)
    ctx.lineTo(0, r)
  } else {
    ctx.arc(0, 0, r, 0, Math.PI * 2)
  }
  ctx.fill()
  ctx.stroke()
  if (e.shape === 'turret' || e.shot) {
    ctx.strokeStyle = e.accent
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(e.facing * r * 1.4, -4)
    ctx.stroke()
  }
  if (e.windup > 0) {
    // Attack anticipation: a closing ring that lands as the shot leaves.
    ctx.strokeStyle = '#fff4df'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(0, 0, r + 4 + e.windup * 40, 0, Math.PI * 2)
    ctx.stroke()
  }
  if (e.shield) {
    ctx.strokeStyle = '#f3efe6'
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.arc(e.facing * r * 0.2, 0, r + 4, e.facing > 0 ? -1 : Math.PI - 1, e.facing > 0 ? 1 : Math.PI + 1)
    ctx.stroke()
  }
  if (e.armorGate) {
    // Armor plates: small bars on the crown so armor reads by shape.
    ctx.fillStyle = '#c7b8a4'
    ctx.fillRect(-r * 0.5, -r - 3, r * 0.35, 4)
    ctx.fillRect(r * 0.15, -r - 3, r * 0.35, 4)
  }
  if (e.resists.some((x) => x.tag === 'lightning')) {
    ctx.strokeStyle = '#8fd0ff'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(-5, r * 0.3)
    ctx.lineTo(5, r * 0.3)
    ctx.moveTo(-3, r * 0.3 + 4)
    ctx.lineTo(3, r * 0.3 + 4)
    ctx.stroke()
  }
  if (e.burn > 0) {
    ctx.fillStyle = '#ff6a2a'
    ctx.beginPath()
    ctx.moveTo(-5, -r - 4)
    ctx.lineTo(0, -r - 14)
    ctx.lineTo(5, -r - 4)
    ctx.fill()
  }
  if (e.elite) {
    ctx.strokeStyle = '#ffd15c'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(-8, -r - 16)
    ctx.lineTo(-4, -r - 22)
    ctx.lineTo(0, -r - 16)
    ctx.lineTo(4, -r - 22)
    ctx.lineTo(8, -r - 16)
    ctx.stroke()
  }
  if (o.colorblind) {
    ctx.fillStyle = '#fff'
    ctx.font = '700 11px Outfit, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(e.name.slice(e.elite ? 6 : 0, (e.elite ? 6 : 0) + 1), 0, 4)
  }
  ctx.restore()
  const pct = clamp(e.hp / e.maxHp, 0, 1)
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  ctx.fillRect(e.x - 16, e.y - e.r - 14, 32, 4)
  ctx.fillStyle = e.elite ? '#ffd15c' : '#ffb15a'
  ctx.fillRect(e.x - 16, e.y - e.r - 14, 32 * pct, 4)
}

function drawBoss(ctx: CanvasRenderingContext2D, sim: Simulation, o: DrawOptions): void {
  const b = sim.boss
  if (!b || !b.alive) return
  ctx.save()
  ctx.translate(b.x, b.y)
  ctx.fillStyle = b.hitFlash > 0 ? '#fff1df' : '#6a3a30'
  ctx.fillRect(-70, -90, 140, 170)
  if (o.contrast) {
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 3
    ctx.strokeRect(-70, -90, 140, 170)
  }
  ctx.fillStyle = b.phase === 1 ? '#5a534c' : '#3a241e'
  ctx.fillRect(-50, -70, 100, 120)
  // The heart: plated grey in phase one, molten and pulsing once open.
  const open = b.phase > 1
  ctx.fillStyle = open ? '#ffb15a' : '#8a847c'
  ctx.beginPath()
  ctx.arc(0, -10, 28 + (open ? Math.sin(sim.time * 6) * 3 : 0), 0, Math.PI * 2)
  ctx.fill()
  if (!open) {
    ctx.strokeStyle = '#c7b8a4'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(-28, -10)
    ctx.lineTo(28, -10)
    ctx.moveTo(0, -38)
    ctx.lineTo(0, 18)
    ctx.stroke()
  }
  if (b.recover > 0) {
    ctx.strokeStyle = '#8dffc0'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(0, -10, 40, 0, Math.PI * 2 * (b.recover / 0.9))
    ctx.stroke()
  }
  if (b.attack === 'barrage') {
    ctx.fillStyle = `rgba(255, 177, 90, ${0.4 + 0.4 * Math.abs(Math.sin(sim.time * 20))})`
    ctx.fillRect(-58, -30, 18, 22)
  }
  if (o.colorblind) {
    ctx.fillStyle = '#111'
    ctx.font = '800 14px Outfit, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(`P${b.phase}`, 0, -4)
  }
  ctx.restore()
  for (const r of b.rivets) {
    if (!r.alive) continue
    const pulse = 12 + Math.abs(Math.sin(sim.time * 4)) * 3
    ctx.fillStyle = '#ffd15c'
    ctx.beginPath()
    ctx.arc(r.x, r.y, pulse, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#2a2118'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(r.x - 6, r.y - 6)
    ctx.lineTo(r.x + 6, r.y + 6)
    ctx.moveTo(r.x + 6, r.y - 6)
    ctx.lineTo(r.x - 6, r.y + 6)
    ctx.stroke()
    ctx.fillStyle = '#2a2118'
    ctx.fillRect(r.x - 10, r.y + 16, 20, 4)
    ctx.fillStyle = '#ffd15c'
    ctx.fillRect(r.x - 10, r.y + 16, 20 * (r.hp / r.max), 4)
    if (r.burn > 0) {
      ctx.fillStyle = '#ff6a2a'
      ctx.fillRect(r.x - 3, r.y - 22, 6, 6)
    }
  }
  const pct = b.hp / b.maxHp
  ctx.fillStyle = 'rgba(0,0,0,0.5)'
  ctx.fillRect(b.x - 70, b.y - 120, 140, 8)
  ctx.fillStyle = '#ff5a1f'
  ctx.fillRect(b.x - 70, b.y - 120, 140 * pct, 8)
  ctx.fillStyle = '#f4efe6'
  ctx.fillRect(b.x - 70 + 140 * 0.66, b.y - 122, 2, 12)
  ctx.fillRect(b.x - 70 + 140 * 0.34, b.y - 122, 2, 12)
  if (b.burn > 0) {
    ctx.fillStyle = '#ff6a2a'
    ctx.fillRect(b.x + 74, b.y - 122, 8, 12)
  }
}

function drawTelegraph(ctx: CanvasRenderingContext2D, x: number, y: number, t: number): void {
  ctx.save()
  ctx.globalAlpha = 0.45 + Math.sin(t * 24) * 0.12
  ctx.fillStyle = '#ff4d3a'
  ctx.fillRect(x - 70, y - 8, 140, 16)
  ctx.globalAlpha = 0.9
  ctx.strokeStyle = '#ffd15c'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(x - 70, y - 90)
  ctx.lineTo(x - 70, y)
  ctx.moveTo(x + 70, y - 90)
  ctx.lineTo(x + 70, y)
  ctx.moveTo(x - 10, y - 60)
  ctx.lineTo(x, y - 44)
  ctx.lineTo(x + 10, y - 60)
  ctx.stroke()
  ctx.restore()
}

function drawBall(ctx: CanvasRenderingContext2D, sim: Simulation, o: DrawOptions): void {
  const b = sim.ball
  const view = ballView(sim, o.alpha)
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
    ctx.lineTo(view.x, view.y)
    ctx.stroke()
    ctx.globalAlpha = 1
  }
  if (sim.shield > 0) {
    ctx.strokeStyle = '#9ad7ff'
    ctx.lineWidth = 3
    ctx.globalAlpha = 0.7
    ctx.beginPath()
    ctx.arc(view.x, view.y, b.r + 10, 0, Math.PI * 2)
    ctx.stroke()
    ctx.globalAlpha = 1
  }
  ctx.translate(view.x, view.y)
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
  ctx.strokeStyle = o.contrast ? '#ffffff' : v.shell
  ctx.lineWidth = 4
  ctx.stroke()
  drawPattern(ctx, v, b.r, o.colorblind)
  if (sim.phase > 0) {
    ctx.globalAlpha = 0.6
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 2
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.arc(0, 0, b.r + 5, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([])
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
  // Speed ring: a clean ram needs the arc past the notch.
  const ratio = clamp(sp / sim.stats.maxSpeed, 0, 1)
  ctx.lineWidth = 2
  ctx.strokeStyle = ratio >= 0.55 ? 'rgba(141,255,192,0.8)' : 'rgba(255,255,255,0.35)'
  ctx.beginPath()
  ctx.arc(view.x, view.y, b.r + 7, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio)
  ctx.stroke()
  const notch = -Math.PI / 2 + Math.PI * 2 * 0.55
  ctx.strokeStyle = '#fff6ea'
  ctx.beginPath()
  ctx.moveTo(view.x + Math.cos(notch) * (b.r + 4), view.y + Math.sin(notch) * (b.r + 4))
  ctx.lineTo(view.x + Math.cos(notch) * (b.r + 10), view.y + Math.sin(notch) * (b.r + 10))
  ctx.stroke()
}

function drawPattern(ctx: CanvasRenderingContext2D, v: VisualDef, r: number, colorblind: boolean): void {
  ctx.strokeStyle = v.shell
  ctx.fillStyle = v.shell
  ctx.lineWidth = 1.5
  if (v.pattern === 'spikes') {
    ctx.beginPath()
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI / 4) * i
      ctx.moveTo(Math.cos(a) * (r - 2), Math.sin(a) * (r - 2))
      ctx.lineTo(Math.cos(a) * (r + 7), Math.sin(a) * (r + 7))
    }
    ctx.stroke()
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

export function drawTitleScene(ctx: CanvasRenderingContext2D, w: number, h: number, time: number, still: boolean): void {
  const t = still ? 0 : time
  const bg = ctx.createLinearGradient(0, 0, 0, h)
  bg.addColorStop(0, '#14110f')
  bg.addColorStop(1, '#2a1c14')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = '#3a332c'
  ctx.lineWidth = 6
  ctx.globalAlpha = 0.7
  ctx.beginPath()
  for (let i = 0; i < Math.ceil(w / 160) + 2; i++) {
    ctx.moveTo(i * 160 - (t * 20) % 160, 0)
    ctx.lineTo(i * 160 + 50 - (t * 20) % 160, h)
  }
  ctx.stroke()
  ctx.globalAlpha = 1
  const builds = [
    { core: '#c4552a', shell: '#e8e2d6', r: 46 },
    { core: '#f2d2a2', shell: '#3ecf8e', r: 28 },
    { core: '#7ec8ff', shell: '#8fd0ff', r: 34 },
  ]
  const which = builds[Math.floor(t / 3.2) % builds.length]!
  const x = w * 0.74
  const base = h * 0.62
  const hop = Math.abs(Math.sin(t * 2.2))
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

/**
 * A reward preview that uses the game's own movement functions. Two balls run
 * the same scripted input from the same start at the same scale: the ghost is
 * your current ball, the solid one is the ball with the offered part.
 */
export class CardPreview {
  private a: Body
  private b: Body
  private t = 0
  private groundA = false
  private groundB = false

  constructor(
    public before: Stats,
    public after: Stats,
    public beforeVisual: VisualDef,
    public afterVisual: VisualDef,
  ) {
    this.a = this.spawn(before)
    this.b = this.spawn(after)
  }

  private spawn(stats: Stats): Body {
    const r = ballRadius(stats.mass)
    return { x: 80, y: 300 - r, vx: 0, vy: 0, r, spin: 0 }
  }

  /** Scripted input: roll right, hop at 1.1 s, turn back at 2.2 s, repeat every 4 s. */
  private input(t: number): { x: number; hop: boolean; hold: boolean } {
    const local = t % 4
    if (local < 2.2) return { x: 1, hop: local > 1.1 && local < 1.15, hold: local > 1.1 && local < 1.5 }
    return { x: -1, hop: local > 3.1 && local < 3.15, hold: false }
  }

  private advance(body: Body, stats: Stats, grounded: boolean, dt: number, input: { x: number; hop: boolean; hold: boolean }, width: number): boolean {
    let ax = horizontalAccel(stats, input.x, body.vx, grounded)
    if (Math.abs(body.vx) >= stats.maxSpeed && Math.sign(ax) === Math.sign(body.vx)) ax = 0
    body.vx += ax * dt
    body.vy += verticalAccel(stats, input.hold, false, grounded) * dt
    if (Math.abs(body.vx) > stats.maxSpeed) body.vx = Math.sign(body.vx) * stats.maxSpeed
    if (input.hop && grounded) body.vy = hopVelocity(stats)
    body.x += body.vx * dt
    body.y += body.vy * dt
    let ground = false
    const boxes = [
      { x: -100, y: 300, w: width + 200, h: 100 },
      { x: -100, y: -400, w: 100, h: 800 },
      { x: width, y: -400, w: 100, h: 800 },
    ]
    for (const box of boxes) {
      const c = resolveCircleAabb(body, box, stats.restitution, 1)
      if (c.hit && c.ny < -0.55) {
        ground = true
        if (Math.abs(body.vy) < 48) body.vy = 0
      }
    }
    return ground
  }

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
    const scale = h / 340
    const worldW = w / scale
    const steps = Math.min(8, Math.max(1, Math.round(dt / (1 / 120))))
    for (let i = 0; i < steps; i++) {
      this.t += 1 / 120
      const input = this.input(this.t)
      this.groundA = this.advance(this.a, this.before, this.groundA, 1 / 120, input, worldW)
      this.groundB = this.advance(this.b, this.after, this.groundB, 1 / 120, input, worldW)
    }
    if (this.t > 12) {
      this.t = 0
      this.a = this.spawn(this.before)
      this.b = this.spawn(this.after)
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#1a1612'
    ctx.fillRect(0, 0, w, h)
    ctx.save()
    ctx.scale(scale, scale)
    ctx.fillStyle = '#4a433c'
    ctx.fillRect(0, 300, worldW, 60)
    ctx.fillStyle = '#f3eadc'
    ctx.fillRect(0, 300, worldW, 8)
    ctx.globalAlpha = 0.4
    drawPreviewBall(ctx, this.a, this.beforeVisual)
    ctx.globalAlpha = 1
    drawPreviewBall(ctx, this.b, this.afterVisual)
    ctx.restore()
  }
}

function drawPreviewBall(ctx: CanvasRenderingContext2D, body: Body, visual: VisualDef): void {
  ctx.fillStyle = visual.core
  ctx.beginPath()
  ctx.arc(body.x, body.y, body.r, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = visual.shell
  ctx.lineWidth = 5
  ctx.stroke()
}
