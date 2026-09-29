import { art, coverRect, TITLE_BALL } from './assets'
import { BIOME } from './data/meta'
import { glowSprite, shade, withAlpha, type Juice } from './juice'
import { crusherPose, geyserPhase, type LiveEnemy, type Simulation } from './sim'
import { TUNE } from './tune'
import type { Stats, VisualDef } from './types'
import { ballRadius, hopVelocity, horizontalAccel, resolveCircleAabb, verticalAccel, type Body } from './physics'
import { clamp, hypot, lerp, mulberry32 } from './util'

export interface Camera {
  x: number
  y: number
  zoom: number
  shakeX: number
  shakeY: number
  rot: number
}

export interface DrawOptions {
  /** Fraction of a tick elapsed since the last simulation step. */
  alpha: number
  particles: number
  colorblind: boolean
  contrast: boolean
  flash: number
  motion: boolean
  juice: Juice
  /** Real time in seconds, for purely decorative motion. */
  time: number
  /** Room entry iris, 0 (closed) to 1 (fully open). */
  iris: number
  /** End-of-room beat: the ball leaving through the gate, or breaking. */
  outro: { kind: 'clear' | 'dead'; t: number } | null
}

const INK = '#120d0a'
const BONE = '#efe4d2'

export function makeCamera(): Camera {
  return { x: 400, y: 400, zoom: 1, shakeX: 0, shakeY: 0, rot: 0 }
}

export function ballView(sim: Simulation, alpha: number): { x: number; y: number } {
  return { x: lerp(sim.prevX, sim.ball.x, alpha), y: lerp(sim.prevY, sim.ball.y, alpha) }
}

export function updateCamera(cam: Camera, sim: Simulation, dt: number, viewW: number, viewH: number, motion: boolean, alpha: number): void {
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
}

export function screenToWorld(cam: Camera, sx: number, sy: number, viewW: number, viewH: number): { x: number; y: number } {
  return {
    x: (sx - viewW / 2 - cam.shakeX) / cam.zoom + cam.x,
    y: (sy - viewH / 2 - cam.shakeY) / cam.zoom + cam.y,
  }
}

export function worldToScreen(cam: Camera, x: number, y: number, viewW: number, viewH: number): { x: number; y: number } {
  return { x: (x - cam.x) * cam.zoom + viewW / 2 + cam.shakeX, y: (y - cam.y) * cam.zoom + viewH / 2 + cam.shakeY }
}

/** The part of the world the camera currently sees, with a margin. */
export function viewRect(cam: Camera, w: number, h: number): { x: number; y: number; w: number; h: number } {
  const vw = w / cam.zoom
  const vh = h / cam.zoom
  return { x: cam.x - vw / 2, y: cam.y - vh / 2, w: vw, h: vh }
}

// =============================================================================
// World.

export function drawWorld(ctx: CanvasRenderingContext2D, sim: Simulation, cam: Camera, viewW: number, viewH: number, o: DrawOptions): void {
  const juice = o.juice
  drawBackdrop(ctx, sim, cam, viewW, viewH, o)

  const zoom = cam.zoom * (1 + juice.zoomPunch)
  ctx.save()
  ctx.translate(viewW / 2 + cam.shakeX, viewH / 2 + cam.shakeY)
  if (cam.rot) ctx.rotate(cam.rot)
  ctx.scale(zoom, zoom)
  ctx.translate(-cam.x, -cam.y)

  for (const h of sim.hazards) if (h.type === 'lava') drawLavaGlow(ctx, h.x, h.y, h.w, sim.time, o.contrast)
  if (!o.contrast) juice.drawBack(ctx)
  for (const h of sim.hazards) {
    if (h.type === 'lava') drawLava(ctx, h.x, h.y, h.w, h.h, sim.time, o.contrast)
    if (h.type === 'spikes') drawSpikes(ctx, h.x, h.y, h.w, o.contrast)
    if (h.type === 'geyser') drawGeyser(ctx, h, sim.time, o.contrast)
  }

  const collapsing = !!sim.boss && sim.boss.collapse > 0
  const lava = sim.hazards.filter((h) => h.type === 'lava')
  for (const s of sim.solids) {
    if (!s.alive || s.bounds) continue
    const hot = lava.some((l) => l.x < s.x + s.w + 60 && l.x + l.w > s.x - 60 && l.y > s.y && l.y - s.y < 260)
    drawBeam(ctx, s.x, s.y, s.w, s.h, s.kind, sim.time, o.contrast, hot)
    if (collapsing && s.breakable) drawCollapseWarning(ctx, s, sim.boss!.collapse, sim.time)
  }
  for (const h of sim.hazards) if (h.type === 'crusher') drawCrusher(ctx, h, sim.time, o.contrast)
  juice.drawScorches(ctx)

  drawGate(ctx, sim, o)
  for (const p of sim.pickups) drawPickup(ctx, p.x, p.y, p.kind, sim.time, p.life, o.contrast)
  if (sim.boss) drawBoss(ctx, sim, o)
  for (const e of sim.enemies) if (e.alive) drawEnemy(ctx, e, sim, o)
  for (const b of sim.bullets) drawBullet(ctx, b, o.contrast)
  drawSimParticles(ctx, sim, o)
  juice.drawGhosts(ctx)
  drawBall(ctx, sim, o)
  juice.drawFront(ctx)
  drawFloaters(ctx, sim, o)
  if (sim.boss && sim.boss.attack === 'slam') drawTelegraph(ctx, sim.boss.slamX, 608, sim.boss.telegraph, sim.time)
  ctx.textAlign = 'center'
  if (sim.gateWarn > 0) {
    worldText(ctx, 'TOO SLOW', sim.room.exit.x + 20, sim.room.exit.y - 16, 20, '#ffd15c')
  }
  if (collapsing) {
    const s = sim.solids.find((x) => x.breakable)
    if (s) worldText(ctx, `FLOOR GIVING WAY ${sim.boss!.collapse.toFixed(1)}`, s.x + s.w / 2, s.y - 120, 24, '#ff5d3a')
  }
  ctx.restore()

  drawScreenFx(ctx, sim, cam, viewW, viewH, o)
}

function worldText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string): void {
  ctx.font = `800 ${size}px Syne, Outfit, sans-serif`
  ctx.textAlign = 'center'
  ctx.lineJoin = 'round'
  ctx.lineWidth = 6
  ctx.strokeStyle = INK
  ctx.strokeText(text, x, y)
  ctx.fillStyle = color
  ctx.fillText(text, x, y)
}

// -----------------------------------------------------------------------------
// Backdrop: painted depths far away, silhouettes in the middle, light and heat.

let midLayer: { canvas: HTMLCanvasElement; h: number } | null = null
const MID_W = 1400

function buildMidLayer(h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = MID_W
  c.height = Math.ceil(h)
  const g = c.getContext('2d')!
  const rnd = mulberry32(7)
  // Pillars with a warm rim on the side that faces the furnaces.
  for (let i = 0; i < 6; i++) {
    const x = i * (MID_W / 6) + rnd() * 120
    const w = 34 + rnd() * 46
    g.fillStyle = '#0d0a08'
    g.fillRect(x, 0, w, h)
    g.fillRect(x - 8, h * 0.18, w + 16, 14)
    g.fillStyle = 'rgba(255, 130, 60, 0.10)'
    g.fillRect(x + w - 3, 0, 3, h)
    g.fillStyle = 'rgba(255, 200, 150, 0.04)'
    for (let y = 40; y < h; y += 70) g.fillRect(x + 6, y, w - 12, 2)
  }
  // A truss catwalk.
  const ty = h * 0.3
  g.strokeStyle = 'rgba(15, 12, 10, 0.6)'
  g.lineWidth = 4
  g.beginPath()
  g.moveTo(0, ty)
  g.lineTo(MID_W, ty)
  g.moveTo(0, ty + 34)
  g.lineTo(MID_W, ty + 34)
  g.stroke()
  g.lineWidth = 2
  g.beginPath()
  for (let x = 0; x < MID_W; x += 34) {
    g.moveTo(x, ty)
    g.lineTo(x + 17, ty + 34)
    g.lineTo(x + 34, ty)
  }
  g.stroke()
  // Hanging chains, some with a lamp.
  for (let i = 0; i < 9; i++) {
    const x = rnd() * MID_W
    const len = 60 + rnd() * h * 0.35
    g.strokeStyle = '#100c0a'
    g.lineWidth = 3
    for (let y = 0; y < len; y += 11) {
      g.beginPath()
      if ((y / 11) % 2) g.ellipse(x, y, 2, 6, 0, 0, Math.PI * 2)
      else g.ellipse(x, y, 5, 6, 0, 0, Math.PI * 2)
      g.stroke()
    }
    if (rnd() < 0.5) {
      g.fillStyle = '#100c0a'
      g.beginPath()
      g.moveTo(x - 12, len + 16)
      g.lineTo(x - 6, len)
      g.lineTo(x + 6, len)
      g.lineTo(x + 12, len + 16)
      g.fill()
      g.globalCompositeOperation = 'lighter'
      const lg = g.createRadialGradient(x, len + 18, 0, x, len + 18, 70)
      lg.addColorStop(0, 'rgba(255, 170, 90, 0.35)')
      lg.addColorStop(1, 'rgba(255, 120, 40, 0)')
      g.fillStyle = lg
      g.fillRect(x - 70, len - 52, 140, 140)
      g.globalCompositeOperation = 'source-over'
    }
  }
  // Soften it: this is scenery far behind the playfield and must never read as a ledge.
  const soft = document.createElement('canvas')
  soft.width = c.width
  soft.height = c.height
  const sg = soft.getContext('2d')!
  sg.filter = 'blur(2.5px)'
  sg.drawImage(c, 0, 0)
  return soft
}

function drawBackdrop(ctx: CanvasRenderingContext2D, sim: Simulation, cam: Camera, w: number, h: number, o: DrawOptions): void {
  const bg = ctx.createLinearGradient(0, 0, 0, h)
  bg.addColorStop(0, o.contrast ? '#000' : BIOME.skyTop)
  bg.addColorStop(1, o.contrast ? '#0a0806' : '#2e1a10')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, h)
  if (o.contrast) return
  const img = art('depths')
  if (img) {
    const panX = clamp((cam.x / Math.max(1, sim.room.width)) * 2 - 1, -1, 1) * 0.8
    const panY = clamp((cam.y / Math.max(1, sim.room.height)) * 2 - 1, -1, 1) * 0.5
    const r = coverRect(img, w, h, 1.14, panX, panY)
    ctx.globalAlpha = 0.62
    ctx.drawImage(img, r.x, r.y, r.w, r.h)
    ctx.globalAlpha = 1
  }
  if (!midLayer || midLayer.h !== h) midLayer = { canvas: buildMidLayer(h), h }
  const off = -((cam.x * 0.28) % MID_W) - MID_W
  ctx.globalAlpha = 0.6
  for (let x = off; x < w; x += MID_W) ctx.drawImage(midLayer.canvas, x, (-cam.y + 400) * 0.08)
  ctx.globalAlpha = 1
  // Dusty light shafts from high windows.
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  for (let i = 0; i < 3; i++) {
    const x = ((i * 530 - cam.x * 0.12) % (w + 600) + w + 600) % (w + 600) - 300
    const sway = Math.sin(o.time * 0.3 + i * 2) * 20
    const g = ctx.createLinearGradient(x, 0, x + 260 + sway, h)
    g.addColorStop(0, 'rgba(255, 190, 120, 0.07)')
    g.addColorStop(1, 'rgba(255, 190, 120, 0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x + 90, 0)
    ctx.lineTo(x + 360 + sway, h)
    ctx.lineTo(x + 180 + sway, h)
    ctx.fill()
  }
  ctx.restore()
  // Heat from below and smoke above keep the playfield readable.
  const haze = ctx.createLinearGradient(0, 0, 0, h)
  haze.addColorStop(0, 'rgba(10, 8, 6, 0.5)')
  haze.addColorStop(0.45, 'rgba(10, 8, 6, 0.15)')
  haze.addColorStop(1, 'rgba(90, 30, 8, 0.28)')
  ctx.fillStyle = haze
  ctx.fillRect(0, 0, w, h)
}

// -----------------------------------------------------------------------------
// Hazards.

function drawLavaGlow(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, time: number, contrast: boolean): void {
  if (contrast) return
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  const pulse = 0.85 + 0.15 * Math.sin(time * 2.2 + x)
  const g = ctx.createLinearGradient(0, y - 220, 0, y)
  g.addColorStop(0, 'rgba(255, 90, 30, 0)')
  g.addColorStop(1, `rgba(255, 90, 30, ${0.22 * pulse})`)
  ctx.fillStyle = g
  ctx.fillRect(x - 40, y - 220, w + 80, 222)
  ctx.globalAlpha = 0.5 * pulse
  for (let px = x; px < x + w; px += 110) ctx.drawImage(glowSprite('#ff6a2a'), px - 70, y - 90, 220, 180)
  ctx.restore()
}

function drawLava(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, time: number, contrast: boolean): void {
  const g = ctx.createLinearGradient(0, y, 0, y + h)
  g.addColorStop(0, '#ffd27a')
  g.addColorStop(0.12, '#ff9a3c')
  g.addColorStop(0.45, BIOME.lava)
  g.addColorStop(1, '#5a1206')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.moveTo(x, y + h)
  for (let px = x; px <= x + w; px += 6) {
    const wave = Math.sin(px * 0.05 + time * 3) * 2 + Math.sin(px * 0.13 - time * 4.4) * 1.2
    ctx.lineTo(px, y + wave)
  }
  ctx.lineTo(x + w, y + h)
  ctx.closePath()
  ctx.fill()
  // Crust: dark cooling plates that drift on the surface.
  if (!contrast) {
    ctx.fillStyle = 'rgba(60, 14, 6, 0.55)'
    for (let i = 0; i < Math.floor(w / 70); i++) {
      const cx = x + ((i * 83 + time * 14) % w)
      const cy = y + 14 + ((i * 37) % Math.max(10, h - 30))
      ctx.beginPath()
      ctx.ellipse(cx, cy, 14 + (i % 3) * 5, 4, 0, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  // A zigzag lip marks slag by shape as well as colour.
  ctx.strokeStyle = contrast ? '#fff' : '#fff0c8'
  ctx.lineWidth = contrast ? 3 : 2
  ctx.beginPath()
  const shift = (time * 10) % 12
  for (let px = x; px <= x + w; px += 12) ctx.lineTo(px, y + (((px - x + shift) / 12) % 2 < 1 ? 0 : 5))
  ctx.stroke()
  // Bubbles that swell and pop.
  for (let i = 0; i < Math.max(2, Math.floor(w / 60)); i++) {
    const cycle = (time * 0.8 + i * 0.37) % 1
    const bx = x + ((i * 97 + Math.floor(time * 0.8 + i * 0.37) * 53) % Math.max(1, w - 10)) + 5
    const r = 2 + cycle * 5
    ctx.globalAlpha = cycle < 0.9 ? 0.7 : (1 - cycle) * 7
    ctx.strokeStyle = '#ffe7b0'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(bx, y + 6 - cycle * 4, r, Math.PI, 0)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}

function drawSpikes(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, contrast: boolean): void {
  const n = Math.max(2, Math.floor(w / 16))
  const g = ctx.createLinearGradient(0, y - 2, 0, y + 16)
  g.addColorStop(0, contrast ? '#ffffff' : '#f1e6d6')
  g.addColorStop(1, contrast ? '#ffffff' : '#5a5048')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.moveTo(x, y + 16)
  for (let i = 0; i < n; i++) {
    const px = x + (i * w) / n
    ctx.lineTo(px + w / n / 2, y - 2)
    ctx.lineTo(px + w / n, y + 16)
  }
  ctx.fill()
  ctx.strokeStyle = contrast ? '#ff3b3b' : INK
  ctx.lineWidth = contrast ? 2 : 1.5
  ctx.stroke()
}

function drawGeyser(ctx: CanvasRenderingContext2D, h: { x: number; y: number; w: number; h: number; period?: number; phase?: number }, time: number, contrast: boolean): void {
  const g = geyserPhase(h, time)
  // A grated vent.
  ctx.fillStyle = '#2a221c'
  ctx.fillRect(h.x, h.y - 8, h.w, 14)
  ctx.fillStyle = g.warn ? `rgba(255, 90, 30, ${0.5 + 0.4 * Math.sin(time * 30)})` : contrast ? 'rgba(255,255,255,0.3)' : 'rgba(255, 120, 50, 0.18)'
  for (let px = h.x + 6; px < h.x + h.w - 4; px += 10) ctx.fillRect(px, h.y - 5, 5, 8)
  if (g.warn && !g.erupt) {
    // Rising chevrons: the warning reads without colour.
    ctx.strokeStyle = '#ffd15c'
    ctx.lineWidth = 3
    const cx = h.x + h.w / 2
    const rise = (time * 60) % 12
    ctx.beginPath()
    for (let k = 0; k < 2; k++) {
      ctx.moveTo(cx - 12, h.y - 20 - k * 12 - rise)
      ctx.lineTo(cx, h.y - 32 - k * 12 - rise)
      ctx.lineTo(cx + 12, h.y - 20 - k * 12 - rise)
    }
    ctx.stroke()
  }
  if (g.erupt) {
    const top = h.y - 78
    const col = ctx.createLinearGradient(0, top, 0, h.y)
    col.addColorStop(0, 'rgba(255, 220, 140, 0.2)')
    col.addColorStop(0.3, '#ffb15a')
    col.addColorStop(1, '#ff4a1c')
    ctx.fillStyle = col
    ctx.beginPath()
    ctx.moveTo(h.x + 10, h.y)
    for (let yy = h.y; yy > top; yy -= 8) ctx.lineTo(h.x + 8 + Math.sin(yy * 0.2 + time * 30) * 3, yy)
    ctx.lineTo(h.x + h.w / 2, top - 8)
    for (let yy = top; yy < h.y; yy += 8) ctx.lineTo(h.x + h.w - 8 + Math.sin(yy * 0.2 - time * 30) * 3, yy)
    ctx.closePath()
    ctx.fill()
    if (!contrast) {
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = 0.6
      ctx.drawImage(glowSprite('#ff7a32'), h.x - 40, top - 40, h.w + 80, 160)
      ctx.restore()
    }
  }
}

function drawCrusher(ctx: CanvasRenderingContext2D, h: { x: number; y: number; w: number; h: number; drop?: number; period?: number; phase?: number }, time: number, contrast: boolean): void {
  const pose = crusherPose(h, time)
  const landing = h.y + (h.drop ?? 220) + h.h
  // Danger zone on the floor, with hazard stripes.
  ctx.save()
  ctx.beginPath()
  ctx.rect(h.x, landing - 10, h.w, 10)
  ctx.clip()
  ctx.fillStyle = pose.warn ? '#ff5d3a' : '#3a2a20'
  ctx.fillRect(h.x, landing - 10, h.w, 10)
  ctx.fillStyle = pose.warn ? '#ffd15c' : '#5a4636'
  for (let px = h.x - 10; px < h.x + h.w; px += 16) {
    ctx.beginPath()
    ctx.moveTo(px, landing)
    ctx.lineTo(px + 8, landing - 10)
    ctx.lineTo(px + 14, landing - 10)
    ctx.lineTo(px + 6, landing)
    ctx.fill()
  }
  ctx.restore()
  if (pose.warn) {
    ctx.strokeStyle = '#ffd15c'
    ctx.lineWidth = 2
    ctx.setLineDash([8, 6])
    ctx.lineDashOffset = -time * 40
    ctx.strokeRect(h.x, pose.y, h.w, landing - pose.y)
    ctx.setLineDash([])
  }
  // Piston rod.
  const cx = h.x + h.w / 2
  const rod = ctx.createLinearGradient(cx - 7, 0, cx + 7, 0)
  rod.addColorStop(0, '#2a241e')
  rod.addColorStop(0.5, '#8a7e70')
  rod.addColorStop(1, '#2a241e')
  ctx.fillStyle = rod
  ctx.fillRect(cx - 7, 0, 14, pose.y)
  drawBeam(ctx, h.x, pose.y, h.w, h.h, 'metal', time, contrast, false)
  // Teeth.
  ctx.fillStyle = pose.smashing ? '#ff5d3a' : '#d7c6ae'
  ctx.beginPath()
  for (let px = h.x + 4; px < h.x + h.w - 10; px += 16) {
    ctx.moveTo(px, pose.y + h.h)
    ctx.lineTo(px + 8, pose.y + h.h + 9)
    ctx.lineTo(px + 16, pose.y + h.h)
  }
  ctx.fill()
}

function drawBeam(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, kind: string, time: number, contrast: boolean, hot: boolean): void {
  const floor = h >= 80
  const face = Math.min(h, floor ? 240 : h)
  const base = kind === 'spring' ? '#6a5344' : kind === 'conveyor' ? '#46504c' : kind === 'ice' ? '#5e7c82' : floor ? '#3a322b' : '#4a4038'
  // Soft drop shadow under floating platforms.
  if (!floor && !contrast) {
    const sh = ctx.createLinearGradient(0, y + h, 0, y + h + 22)
    sh.addColorStop(0, 'rgba(0,0,0,0.35)')
    sh.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = sh
    ctx.fillRect(x + 4, y + h, w - 8, 22)
  }
  const g = ctx.createLinearGradient(0, y, 0, y + face)
  g.addColorStop(0, shade(base, 0.12))
  g.addColorStop(0.35, base)
  g.addColorStop(1, shade(base, -0.55))
  ctx.fillStyle = g
  ctx.fillRect(x, y, w, h)
  if (hot && !contrast) {
    const hg = ctx.createLinearGradient(0, y + h - Math.min(h, 40), 0, y + h)
    hg.addColorStop(0, 'rgba(255, 90, 30, 0)')
    hg.addColorStop(1, 'rgba(255, 110, 40, 0.35)')
    ctx.fillStyle = hg
    ctx.fillRect(x, y + h - Math.min(h, 40), w, Math.min(h, 40))
  }
  // Plate seams.
  const seam = floor ? 96 : 64
  ctx.fillStyle = 'rgba(0,0,0,0.35)'
  for (let px = x + seam; px < x + w - 8; px += seam) ctx.fillRect(px, y + 3, 2, face - 3)
  ctx.fillStyle = 'rgba(255,240,220,0.06)'
  for (let px = x + seam + 2; px < x + w - 8; px += seam) ctx.fillRect(px, y + 3, 1, face - 3)
  // Lit top lip (the walkable edge), and a dark underside.
  const lip = kind === 'spring' ? '#ffb15a' : kind === 'ice' ? '#d5f4f6' : BONE
  ctx.fillStyle = lip
  ctx.fillRect(x, y, w, floor ? 5 : 3)
  ctx.fillStyle = 'rgba(255,255,255,0.35)'
  ctx.fillRect(x, y, w, 1)
  ctx.fillStyle = 'rgba(0,0,0,0.45)'
  ctx.fillRect(x, y + (floor ? 5 : 3), w, 2)
  if (!floor) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)'
    ctx.fillRect(x, y + h - 2, w, 2)
  }
  if (contrast) {
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 2
    ctx.strokeRect(x + 1, y + 1, w - 2, Math.min(h, 200) - 2)
  }
  // Rivets with a highlight.
  const rivets = Math.max(2, Math.floor(w / 48))
  const ry = y + Math.min(h, 40) * 0.55
  for (let i = 0; i < rivets; i++) {
    const rx = x + 12 + ((w - 24) * i) / Math.max(1, rivets - 1)
    ctx.fillStyle = '#1e1915'
    ctx.beginPath()
    ctx.arc(rx, ry, 2.8, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = 'rgba(255,235,210,0.35)'
    ctx.fillRect(rx - 1.4, ry - 1.6, 1.4, 1.2)
  }
  if (kind === 'ice' && !contrast) {
    ctx.strokeStyle = 'rgba(230, 250, 255, 0.35)'
    ctx.lineWidth = 2
    ctx.beginPath()
    for (let px = x + 18; px < x + w - 18; px += 54) {
      ctx.moveTo(px, y + h - 4)
      ctx.lineTo(px + 14, y + 5)
    }
    ctx.stroke()
  }
  if (kind === 'conveyor') {
    ctx.strokeStyle = '#e8dcc6'
    ctx.lineWidth = 2
    ctx.globalAlpha = 0.75
    ctx.beginPath()
    const shift = (time * 80) % 20
    for (let px = x + shift; px < x + w - 8; px += 20) {
      ctx.moveTo(px, y + 12)
      ctx.lineTo(px + 8, y + 8)
      ctx.lineTo(px, y + 4)
    }
    ctx.stroke()
    ctx.globalAlpha = 1
    // End rollers.
    for (const rx of [x + 6, x + w - 6]) {
      ctx.save()
      ctx.translate(rx, y + Math.min(h, 20) / 2 + 2)
      ctx.rotate(time * 6)
      ctx.fillStyle = '#2a241e'
      ctx.beginPath()
      ctx.arc(0, 0, 5, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#a89a88'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(-4, 0)
      ctx.lineTo(4, 0)
      ctx.stroke()
      ctx.restore()
    }
  }
  if (kind === 'spring') {
    ctx.strokeStyle = '#ffcf8a'
    ctx.lineWidth = 2
    ctx.strokeRect(x + 4, y + 5, w - 8, h - 9)
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

// -----------------------------------------------------------------------------
// Gate, pickups, bullets.

function drawGate(ctx: CanvasRenderingContext2D, sim: Simulation, o: DrawOptions): void {
  const e = sim.room.exit
  const open = sim.exitOpen
  const t = o.time
  const cx = e.x + e.w / 2
  if (open) {
    if (!o.contrast) {
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      const flare = o.outro?.kind === 'clear' ? 1 + o.outro.t * 2 : 1
      ctx.globalAlpha = Math.min(1, (0.55 + 0.15 * Math.sin(t * 3)) * flare)
      ctx.drawImage(glowSprite('#ffb15a'), cx - e.w * 1.3 * flare, e.y + e.h / 2 - e.h * 0.9 * flare, e.w * 2.6 * flare, e.h * 1.8 * flare)
      ctx.restore()
    }
    const inner = ctx.createLinearGradient(0, e.y, 0, e.y + e.h)
    inner.addColorStop(0, 'rgba(255, 225, 170, 0.55)')
    inner.addColorStop(1, 'rgba(255, 140, 60, 0.3)')
    ctx.fillStyle = inner
    ctx.fillRect(e.x + 10, e.y + 10, e.w - 20, e.h - 10)
    // Chevrons streaming into the gate.
    ctx.strokeStyle = 'rgba(255, 246, 230, 0.9)'
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    const cy = e.y + e.h / 2
    for (let k = 0; k < 3; k++) {
      const p = ((t * 1.4 + k / 3) % 1)
      const x = e.x + 16 + p * (e.w - 32)
      ctx.globalAlpha = Math.sin(p * Math.PI)
      ctx.beginPath()
      ctx.moveTo(x - 7, cy - 11)
      ctx.lineTo(x + 5, cy)
      ctx.lineTo(x - 7, cy + 11)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    ctx.lineCap = 'butt'
  }
  // Frame.
  const frame = (x: number, y: number, w: number, h: number) => {
    const g = ctx.createLinearGradient(x, 0, x + w, 0)
    g.addColorStop(0, open ? '#ffcf8a' : '#4a4038')
    g.addColorStop(1, open ? '#c46a2a' : '#2a241e')
    ctx.fillStyle = g
    ctx.fillRect(x, y, w, h)
  }
  frame(e.x, e.y, 10, e.h)
  frame(e.x + e.w - 10, e.y, 10, e.h)
  frame(e.x, e.y, e.w, 10)
  if (!open) {
    ctx.strokeStyle = '#6a5c4e'
    ctx.lineWidth = 4
    ctx.beginPath()
    for (let px = e.x + 18; px < e.x + e.w - 10; px += 12) {
      ctx.moveTo(px, e.y + 10)
      ctx.lineTo(px, e.y + e.h)
    }
    ctx.stroke()
    // A red lamp over a shut gate.
    ctx.fillStyle = '#ff5d3a'
    ctx.beginPath()
    ctx.arc(cx, e.y - 6, 5, 0, Math.PI * 2)
    ctx.fill()
    if (!o.contrast) {
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = 0.5 + 0.2 * Math.sin(t * 4)
      ctx.drawImage(glowSprite('#ff5d3a'), cx - 22, e.y - 28, 44, 44)
      ctx.restore()
    }
  }
}

function drawPickup(ctx: CanvasRenderingContext2D, x: number, y: number, kind: string, time: number, life: number, contrast: boolean): void {
  if (kind === 'heal' && life < 3 && Math.floor(time * 8) % 2 === 0) return
  const bob = Math.sin(time * 4 + x) * 2.5
  ctx.save()
  ctx.translate(x, y + bob)
  if (!contrast) {
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = 0.55
    ctx.drawImage(glowSprite(kind === 'heal' ? '#7dffb3' : '#ffb15a'), -20, -20, 40, 40)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
  }
  if (kind === 'heal') {
    const s = 1 + Math.sin(time * 6) * 0.1
    ctx.scale(s, s)
    ctx.fillStyle = '#7dffb3'
    ctx.strokeStyle = INK
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.rect(-2.5, -7, 5, 14)
    ctx.rect(-7, -2.5, 14, 5)
    ctx.stroke()
    ctx.fill()
  } else {
    // A spinning cinder: the width follows the turn.
    ctx.scale(Math.max(0.2, Math.abs(Math.cos(time * 3 + x))), 1)
    ctx.fillStyle = '#ffb15a'
    ctx.strokeStyle = '#ffe0aa'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(0, -8)
    ctx.lineTo(7, 6)
    ctx.lineTo(-7, 6)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  }
  ctx.restore()
}

function drawBullet(ctx: CanvasRenderingContext2D, b: Simulation['bullets'][number], contrast: boolean): void {
  const color = b.friendly ? '#b8ffe0' : b.color
  const sp = Math.hypot(b.vx, b.vy) || 1
  ctx.save()
  if (!contrast) {
    ctx.globalCompositeOperation = 'lighter'
    ctx.strokeStyle = withAlpha(color.startsWith('#') ? color : '#ffb15a', 0.45)
    ctx.lineWidth = b.r * 1.4
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(b.x, b.y)
    ctx.lineTo(b.x - (b.vx / sp) * b.r * 4, b.y - (b.vy / sp) * b.r * 4)
    ctx.stroke()
    ctx.globalAlpha = 0.8
    ctx.drawImage(glowSprite(color.startsWith('#') ? color : '#ffb15a'), b.x - b.r * 3, b.y - b.r * 3, b.r * 6, b.r * 6)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
  }
  ctx.fillStyle = '#fff6ea'
  ctx.beginPath()
  ctx.arc(b.x, b.y, b.r * 0.6, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = b.friendly ? '#1fa971' : contrast ? '#ff3b3b' : color
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

function drawSimParticles(ctx: CanvasRenderingContext2D, sim: Simulation, o: DrawOptions): void {
  const limit = Math.round(sim.particles.length * o.particles)
  ctx.save()
  ctx.globalCompositeOperation = o.contrast ? 'source-over' : 'lighter'
  ctx.lineCap = 'round'
  for (let i = 0; i < sim.particles.length; i++) {
    const p = sim.particles[i]!
    if (p.life <= 0) continue
    // Rings and arcs carry information (a blast radius, a chain), so they always draw.
    if (!(p.kind === 'arc' || p.kind === 'ring' || i < limit)) continue
    const t = clamp(p.life / p.max, 0, 1)
    ctx.globalAlpha = t
    if (p.kind === 'arc' && p.x2 !== undefined && p.y2 !== undefined) {
      // Jagged bolt with a soft halo.
      const segs = 6
      const pts: [number, number][] = [[p.x, p.y]]
      const nx = -(p.y2 - p.y)
      const ny = p.x2 - p.x
      const len = Math.hypot(nx, ny) || 1
      for (let k = 1; k < segs; k++) {
        const f = k / segs
        const j = (Math.sin(o.time * 90 + k * 7.3 + p.x) * 0.5) * 14
        pts.push([p.x + (p.x2 - p.x) * f + (nx / len) * j, p.y + (p.y2 - p.y) * f + (ny / len) * j])
      }
      pts.push([p.x2, p.y2])
      for (const [wdt, col] of [[6, 'rgba(140, 200, 255, 0.35)'], [2, p.color]] as const) {
        ctx.strokeStyle = col
        ctx.lineWidth = wdt
        ctx.beginPath()
        pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
        ctx.stroke()
      }
    } else if (p.kind === 'ring') {
      const e = 1 - t
      ctx.strokeStyle = p.color
      ctx.lineWidth = 1 + t * 4
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size + (1 - (1 - e) * (1 - e)) * 48, 0, Math.PI * 2)
      ctx.stroke()
    } else {
      // Sparks read as short streaks along their motion.
      ctx.strokeStyle = p.color
      ctx.lineWidth = p.size * 0.8
      ctx.beginPath()
      ctx.moveTo(p.x, p.y)
      ctx.lineTo(p.x - p.vx * 0.02, p.y - p.vy * 0.02)
      ctx.stroke()
    }
  }
  ctx.restore()
  ctx.globalAlpha = 1
}

function drawFloaters(ctx: CanvasRenderingContext2D, sim: Simulation, o: DrawOptions): void {
  ctx.textAlign = 'center'
  ctx.lineJoin = 'round'
  for (const f of sim.floaters) {
    const age = 0.7 - f.life
    const n = parseFloat(f.text)
    const big = Number.isFinite(n) ? clamp(n / 8, 0, 16) : 2
    const size = 15 + big
    // Pop in large, settle, then fade and drift.
    const pop = o.motion ? (age < 0.09 ? lerp(1.7, 1, age / 0.09) : 1) : 1
    ctx.globalAlpha = clamp(f.life * 2.4, 0, 1)
    ctx.save()
    ctx.translate(f.x, f.y)
    ctx.scale(pop, pop)
    ctx.font = `800 ${size}px Outfit, Segoe UI, sans-serif`
    ctx.lineWidth = 5
    ctx.strokeStyle = INK
    ctx.strokeText(f.text, 0, 0)
    ctx.fillStyle = f.color
    ctx.fillText(f.text, 0, 0)
    ctx.restore()
  }
  ctx.globalAlpha = 1
}

// -----------------------------------------------------------------------------
// Constructs.

function groundShadow(ctx: CanvasRenderingContext2D, juice: Juice, x: number, bottom: number, r: number): void {
  const g = juice.groundBelow(x, bottom - 4, 360)
  if (g === null) return
  const k = clamp(1 - (g - bottom) / 300, 0.2, 1)
  ctx.fillStyle = `rgba(0,0,0,${0.42 * k})`
  ctx.beginPath()
  ctx.ellipse(x, g + 1, r * 1.05 * k, Math.max(2, r * 0.26 * k), 0, 0, Math.PI * 2)
  ctx.fill()
}

function enemyPath(ctx: CanvasRenderingContext2D, shape: LiveEnemy['shape'], r: number, time: number): void {
  ctx.beginPath()
  if (shape === 'diamond' || shape === 'spark') {
    ctx.moveTo(0, -r)
    ctx.lineTo(r, 0)
    ctx.lineTo(0, r)
    ctx.lineTo(-r, 0)
    ctx.closePath()
  } else if (shape === 'hex' || shape === 'knight') {
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 2
      if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r)
      else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r)
    }
    ctx.closePath()
  } else if (shape === 'shield') {
    ctx.roundRect(-r, -r * 0.8, r * 2, r * 1.6, 5)
  } else if (shape === 'cask') {
    ctx.roundRect(-r * 0.8, -r, r * 1.6, r * 2, 6)
  } else if (shape === 'mite') {
    ctx.arc(0, 0, r, Math.PI * 0.15, Math.PI * 0.85, true)
    ctx.closePath()
  } else if (shape === 'wisp') {
    ctx.arc(0, 0, r * (0.85 + Math.sin(time * 6) * 0.08), 0, Math.PI * 2)
  } else if (shape === 'turret') {
    ctx.roundRect(-r, -r * 0.4, r * 2, r * 1.2, 4)
  } else if (shape === 'shard') {
    ctx.moveTo(0, -r)
    ctx.lineTo(r * 0.8, -r * 0.1)
    ctx.lineTo(r * 0.4, r)
    ctx.lineTo(-r * 0.6, r * 0.8)
    ctx.lineTo(-r * 0.9, -r * 0.2)
    ctx.closePath()
  } else {
    ctx.arc(0, 0, r, 0, Math.PI * 2)
  }
}

function drawEnemy(ctx: CanvasRenderingContext2D, e: LiveEnemy, sim: Simulation, o: DrawOptions): void {
  const time = sim.time
  const r = e.r
  const pop = o.juice.enemyScale(e.uid)
  if (!e.flying) groundShadow(ctx, o.juice, e.x, e.y + r, r * pop)
  ctx.save()
  const moving = Math.abs(e.vx) > 20
  const bob = e.flying ? Math.sin(time * 3 + e.uid) * 3 : moving ? -Math.abs(Math.sin(time * 9 + e.uid)) * 2.5 : 0
  ctx.translate(e.x, e.y + bob)
  const shake = e.windup > 0 ? Math.sin(time * 70) * 1.5 : 0
  ctx.translate(shake, 0)
  ctx.rotate(clamp(e.vx / 900, -0.22, 0.22))
  // Squash on hit, a slow breath at rest.
  const hf = clamp(e.hitFlash / 0.08, 0, 1)
  const breath = 1 + Math.sin(time * 2.4 + e.uid) * 0.025
  ctx.scale(pop * (1 + 0.3 * hf) * breath, pop * (1 - 0.24 * hf) / breath)
  if (e.elite && !o.contrast) {
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = 0.35 + 0.1 * Math.sin(time * 4)
    ctx.drawImage(glowSprite('#ffd15c'), -r * 2, -r * 2, r * 4, r * 4)
    ctx.restore()
  }
  if (e.shape === 'wisp' && !o.contrast) {
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = 0.5
    ctx.drawImage(glowSprite(e.accent), -r * 2.2, -r * 2.2, r * 4.4, r * 4.4)
    ctx.restore()
  }
  enemyPath(ctx, e.shape, r, time)
  const body = ctx.createLinearGradient(0, -r, 0, r)
  body.addColorStop(0, shade(e.color, 0.28))
  body.addColorStop(0.5, e.color)
  body.addColorStop(1, shade(e.color, -0.45))
  ctx.fillStyle = body
  ctx.fill()
  ctx.lineJoin = 'round'
  ctx.strokeStyle = o.contrast ? '#ffffff' : INK
  ctx.lineWidth = o.contrast ? 3 : 3.5
  ctx.stroke()
  ctx.strokeStyle = e.accent
  ctx.lineWidth = 1.5
  ctx.save()
  ctx.clip()
  ctx.stroke()
  // Top sheen.
  ctx.fillStyle = 'rgba(255, 245, 230, 0.16)'
  ctx.beginPath()
  ctx.ellipse(-r * 0.2, -r * 0.55, r * 0.6, r * 0.25, -0.2, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
  if (e.shape === 'splitter') {
    ctx.strokeStyle = INK
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.moveTo(0, -r)
    ctx.lineTo(-3, -r * 0.3)
    ctx.lineTo(3, r * 0.3)
    ctx.lineTo(0, r)
    ctx.stroke()
  }
  if (e.shape === 'cask') {
    // A fuse that sparks: this one explodes.
    ctx.strokeStyle = '#2a1c14'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(0, -r)
    ctx.quadraticCurveTo(6, -r - 8, 2, -r - 12)
    ctx.stroke()
    ctx.fillStyle = Math.sin(time * 30) > 0 ? '#ffe28a' : '#ff6a2a'
    ctx.beginPath()
    ctx.arc(2, -r - 13, 3, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = 'rgba(0,0,0,0.35)'
    ctx.fillRect(-r * 0.8, -r * 0.45, r * 1.6, 3)
    ctx.fillRect(-r * 0.8, r * 0.4, r * 1.6, 3)
  }
  if (e.shape === 'turret' || e.shot) {
    ctx.strokeStyle = INK
    ctx.lineWidth = 7
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(e.facing * r * 1.4, -4)
    ctx.stroke()
    ctx.strokeStyle = e.accent
    ctx.lineWidth = 3.5
    ctx.stroke()
    ctx.lineCap = 'butt'
    if (e.windup > 0) {
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      const s = 10 + (1 - clamp(e.windup / 0.6, 0, 1)) * 14
      ctx.drawImage(glowSprite('#ffb15a'), e.facing * r * 1.4 - s, -4 - s, s * 2, s * 2)
      ctx.restore()
    }
  }
  drawEyes(ctx, e, sim, o)
  if (e.windup > 0) {
    // Attack anticipation: a closing ring that lands as the shot leaves.
    ctx.strokeStyle = '#fff4df'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(0, 0, r + 4 + e.windup * 40, 0, Math.PI * 2)
    ctx.stroke()
  }
  if (e.shield) {
    const a0 = e.facing > 0 ? -1 : Math.PI - 1
    const a1 = e.facing > 0 ? 1 : Math.PI + 1
    ctx.strokeStyle = INK
    ctx.lineWidth = 8
    ctx.beginPath()
    ctx.arc(e.facing * r * 0.2, 0, r + 5, a0, a1)
    ctx.stroke()
    ctx.strokeStyle = '#f3efe6'
    ctx.lineWidth = 4.5
    ctx.stroke()
    ctx.strokeStyle = 'rgba(154, 215, 255, 0.8)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(e.facing * r * 0.2, 0, r + 9, a0 + 0.2, a1 - 0.2)
    ctx.stroke()
  }
  if (e.armorGate) {
    // Armor plates: small bars on the crown so armor reads by shape.
    ctx.fillStyle = '#c7b8a4'
    ctx.strokeStyle = INK
    ctx.lineWidth = 1.5
    ctx.fillRect(-r * 0.5, -r - 4, r * 0.35, 5)
    ctx.strokeRect(-r * 0.5, -r - 4, r * 0.35, 5)
    ctx.fillRect(r * 0.15, -r - 4, r * 0.35, 5)
    ctx.strokeRect(r * 0.15, -r - 4, r * 0.35, 5)
  }
  if (e.resists.some((x) => x.tag === 'lightning')) {
    ctx.strokeStyle = '#8fd0ff'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(-5, r * 0.45)
    ctx.lineTo(5, r * 0.45)
    ctx.moveTo(-3, r * 0.45 + 4)
    ctx.lineTo(3, r * 0.45 + 4)
    ctx.stroke()
  }
  if (e.burn > 0) {
    for (let k = -1; k <= 1; k++) {
      const hgt = 10 + Math.sin(time * 18 + k * 2) * 4
      ctx.fillStyle = k === 0 ? '#ffb15a' : '#ff6a2a'
      ctx.beginPath()
      ctx.moveTo(k * 6 - 4, -r - 3)
      ctx.quadraticCurveTo(k * 6, -r - 3 - hgt * 1.4, k * 6 + 4, -r - 3)
      ctx.fill()
    }
  }
  if (e.elite) {
    ctx.fillStyle = '#ffd15c'
    ctx.strokeStyle = INK
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(-9, -r - 12)
    ctx.lineTo(-9, -r - 22)
    ctx.lineTo(-4, -r - 16)
    ctx.lineTo(0, -r - 24)
    ctx.lineTo(4, -r - 16)
    ctx.lineTo(9, -r - 22)
    ctx.lineTo(9, -r - 12)
    ctx.closePath()
    ctx.stroke()
    ctx.fill()
  }
  if (e.hitFlash > 0) {
    enemyPath(ctx, e.shape, r, time)
    ctx.globalAlpha = hf * 0.85
    ctx.fillStyle = '#fff6ea'
    ctx.fill()
    ctx.globalAlpha = 1
  }
  if (o.colorblind) {
    ctx.font = '800 12px Outfit, sans-serif'
    ctx.textAlign = 'center'
    ctx.lineWidth = 3
    ctx.strokeStyle = INK
    const letter = e.name.slice(e.elite ? 6 : 0, (e.elite ? 6 : 0) + 1)
    ctx.strokeText(letter, 0, r * 0.75)
    ctx.fillStyle = '#fff'
    ctx.fillText(letter, 0, r * 0.75)
  }
  ctx.restore()
  // Integrity: shown once something has been taken, or always on elites.
  if (e.hp < e.maxHp || e.elite) {
    const pct = clamp(e.hp / e.maxHp, 0, 1)
    const w = Math.max(30, r * 2)
    const y = e.y - r - (e.elite ? 32 : 16)
    ctx.fillStyle = 'rgba(12, 9, 7, 0.8)'
    ctx.beginPath()
    ctx.roundRect(e.x - w / 2 - 1.5, y - 1.5, w + 3, 7, 3)
    ctx.fill()
    ctx.fillStyle = e.elite ? '#ffd15c' : '#ffb15a'
    ctx.beginPath()
    ctx.roundRect(e.x - w / 2, y, w * pct, 4, 2)
    ctx.fill()
  }
}

function drawEyes(ctx: CanvasRenderingContext2D, e: LiveEnemy, sim: Simulation, o: DrawOptions): void {
  const r = e.r
  const single = e.shape === 'turret' || e.shape === 'wisp' || e.shape === 'mite' || e.shape === 'spark' || r < 12
  const size = Math.max(2.5, r * (single ? 0.28 : 0.2))
  const ey = e.shape === 'cask' ? r * 0.05 : e.shape === 'turret' ? r * 0.2 : e.shape === 'mite' ? -r * 0.05 : -r * 0.12
  const spots = single ? [e.shape === 'turret' ? -e.facing * r * 0.3 : 0] : [-r * 0.34, r * 0.34]
  const dx = sim.ball.x - e.x
  const dy = sim.ball.y - e.y
  const d = Math.hypot(dx, dy) || 1
  const look = { x: (dx / d) * size * 0.45, y: (dy / d) * size * 0.45 }
  const dazed = e.stun > 0.05 || e.shock > 0
  const angry = e.windup > 0
  const blink = (sim.time + e.uid * 1.7) % 3.7 < 0.12
  for (const sx of spots) {
    const x = sx
    if (dazed) {
      ctx.strokeStyle = INK
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(x - size * 0.7, ey - size * 0.7)
      ctx.lineTo(x + size * 0.7, ey + size * 0.7)
      ctx.moveTo(x + size * 0.7, ey - size * 0.7)
      ctx.lineTo(x - size * 0.7, ey + size * 0.7)
      ctx.stroke()
      continue
    }
    if (blink && !angry) {
      ctx.strokeStyle = INK
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(x - size, ey)
      ctx.lineTo(x + size, ey)
      ctx.stroke()
      continue
    }
    const glow = e.shape === 'wisp' || angry || e.elite
    ctx.fillStyle = angry ? '#ffd9c2' : glow ? '#fff1c9' : '#f6ecdc'
    ctx.beginPath()
    ctx.arc(x, ey, size, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = INK
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.fillStyle = angry ? '#d7261e' : INK
    ctx.beginPath()
    ctx.arc(x + look.x, ey + look.y, size * 0.5, 0, Math.PI * 2)
    ctx.fill()
    if (angry && !o.contrast) {
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = 0.7
      ctx.drawImage(glowSprite('#ff5d3a'), x - size * 2.4, ey - size * 2.4, size * 4.8, size * 4.8)
      ctx.restore()
    }
  }
  if ((angry || e.elite) && !single) {
    // Brows.
    ctx.strokeStyle = INK
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.moveTo(-r * 0.58, ey - size * 1.5)
    ctx.lineTo(-r * 0.14, ey - size * 0.9)
    ctx.moveTo(r * 0.58, ey - size * 1.5)
    ctx.lineTo(r * 0.14, ey - size * 0.9)
    ctx.stroke()
  }
}

// -----------------------------------------------------------------------------
// The Iron Colossus: a riveted sphere on two pedestals, heart in the middle.

function drawBoss(ctx: CanvasRenderingContext2D, sim: Simulation, o: DrawOptions): void {
  const b = sim.boss
  if (!b || !b.alive) return
  const t = sim.time
  const open = b.phase > 1
  const hf = clamp(b.hitFlash / 0.1, 0, 1)
  groundShadow(ctx, o.juice, b.x, b.y + 80, 90)
  ctx.save()
  const stuck = b.recover > 0 ? Math.sin(t * 40) * 1.5 * (b.recover / 0.9) : 0
  const winding = b.attack !== 'none' ? Math.sin(t * 50) * 2 : 0
  ctx.translate(b.x + stuck + winding, b.y)
  ctx.scale(1 + hf * 0.04, 1 - hf * 0.03)
  // Heat haze behind.
  if (!o.contrast) {
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = open ? 0.55 + 0.15 * Math.sin(t * 5) : 0.3
    ctx.drawImage(glowSprite('#ff6a2a'), -170, -190, 340, 340)
    ctx.restore()
  }
  // Pedestals.
  for (const side of [-1, 1]) {
    const g = ctx.createLinearGradient(0, 40, 0, 82)
    g.addColorStop(0, '#5a5048')
    g.addColorStop(1, '#221c18')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.moveTo(side * 22, 40)
    ctx.lineTo(side * 62, 40)
    ctx.lineTo(side * 78, 82)
    ctx.lineTo(side * 14, 82)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = INK
    ctx.lineWidth = 3
    ctx.stroke()
    ctx.fillStyle = '#8a7e70'
    ctx.beginPath()
    ctx.arc(side * 44, 62, 4, 0, Math.PI * 2)
    ctx.fill()
  }
  // Body sphere.
  const R = 76
  const body = ctx.createRadialGradient(-26, -40, 10, 0, -8, R)
  body.addColorStop(0, hf > 0 ? '#fff1df' : '#8a8078')
  body.addColorStop(0.5, hf > 0 ? '#e8d6c0' : '#4e4640')
  body.addColorStop(1, '#1a1512')
  ctx.fillStyle = body
  ctx.beginPath()
  ctx.arc(0, -8, R, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = o.contrast ? '#fff' : INK
  ctx.lineWidth = 4
  ctx.stroke()
  // Plate bands and bolts.
  ctx.save()
  ctx.beginPath()
  ctx.arc(0, -8, R - 2, 0, Math.PI * 2)
  ctx.clip()
  ctx.strokeStyle = 'rgba(10, 8, 6, 0.7)'
  ctx.lineWidth = 3
  for (const off of [-50, 50]) {
    ctx.beginPath()
    ctx.ellipse(off, -8, 22, R, 0, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.beginPath()
  ctx.ellipse(0, -8, R, 26, 0, 0, Math.PI * 2)
  ctx.stroke()
  // Glowing seams between plates, hotter each phase.
  if (!o.contrast) {
    ctx.globalCompositeOperation = 'lighter'
    ctx.strokeStyle = `rgba(255, 120, 40, ${b.phase === 1 ? 0.25 : b.phase === 2 ? 0.55 : 0.8})`
    ctx.lineWidth = 1.5
    for (const off of [-50, 50]) {
      ctx.beginPath()
      ctx.ellipse(off, -8, 22, R, 0, 0, Math.PI * 2)
      ctx.stroke()
    }
    if (b.phase === 3) {
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(-60, -40)
      ctx.lineTo(-30, -20)
      ctx.lineTo(-44, 10)
      ctx.moveTo(40, -60)
      ctx.lineTo(28, -30)
      ctx.lineTo(56, -6)
      ctx.stroke()
    }
    ctx.globalCompositeOperation = 'source-over'
  }
  ctx.restore()
  // The heart: plated grey in phase one, molten and pulsing once open.
  const hr = 28 + (open ? Math.sin(t * 6) * 3 : 0)
  ctx.fillStyle = '#1a1512'
  ctx.beginPath()
  ctx.arc(0, -10, hr + 8, 0, Math.PI * 2)
  ctx.fill()
  if (open) {
    const heart = ctx.createRadialGradient(0, -10, 2, 0, -10, hr)
    heart.addColorStop(0, '#fff4d6')
    heart.addColorStop(0.35, '#ffb15a')
    heart.addColorStop(1, '#c43a10')
    ctx.fillStyle = heart
    ctx.beginPath()
    ctx.arc(0, -10, hr, 0, Math.PI * 2)
    ctx.fill()
    if (!o.contrast) {
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = 0.7 + 0.2 * Math.sin(t * 6)
      ctx.drawImage(glowSprite('#ffb15a'), -hr * 2.6, -10 - hr * 2.6, hr * 5.2, hr * 5.2)
      ctx.restore()
    }
  } else {
    const plate = ctx.createRadialGradient(-8, -18, 2, 0, -10, hr)
    plate.addColorStop(0, '#b8aea2')
    plate.addColorStop(1, '#5a534c')
    ctx.fillStyle = plate
    ctx.beginPath()
    ctx.arc(0, -10, hr, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#2a241e'
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.moveTo(-hr, -10)
    ctx.lineTo(hr, -10)
    ctx.moveTo(0, -10 - hr)
    ctx.lineTo(0, -10 + hr)
    ctx.stroke()
  }
  ctx.strokeStyle = INK
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.arc(0, -10, hr + 8, 0, Math.PI * 2)
  ctx.stroke()
  if (b.recover > 0) {
    ctx.strokeStyle = '#8dffc0'
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.arc(0, -10, hr + 14, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (b.recover / 0.9))
    ctx.stroke()
  }
  if (b.attack === 'barrage') {
    const a = 0.5 + 0.5 * Math.abs(Math.sin(t * 20))
    ctx.fillStyle = `rgba(255, 177, 90, ${a})`
    ctx.beginPath()
    ctx.arc(-58, -20, 12, 0, Math.PI * 2)
    ctx.fill()
    if (!o.contrast) {
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = a
      ctx.drawImage(glowSprite('#ffb15a'), -98, -60, 80, 80)
      ctx.restore()
    }
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
    const pulse = 13 + Math.abs(Math.sin(t * 4)) * 2.5
    if (!o.contrast) {
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = 0.6
      ctx.drawImage(glowSprite('#ffd15c'), r.x - 32, r.y - 32, 64, 64)
      ctx.restore()
    }
    const g = ctx.createRadialGradient(r.x - 4, r.y - 5, 1, r.x, r.y, pulse)
    g.addColorStop(0, '#fff4c2')
    g.addColorStop(0.5, '#ffd15c')
    g.addColorStop(1, '#a8741c')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(r.x, r.y, pulse, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = INK
    ctx.lineWidth = 3
    ctx.stroke()
    ctx.strokeStyle = '#2a2118'
    ctx.beginPath()
    ctx.moveTo(r.x - 6, r.y - 6)
    ctx.lineTo(r.x + 6, r.y + 6)
    ctx.moveTo(r.x + 6, r.y - 6)
    ctx.lineTo(r.x - 6, r.y + 6)
    ctx.stroke()
    // Rivet integrity as a ring around it.
    ctx.strokeStyle = 'rgba(12,9,7,0.7)'
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.arc(r.x, r.y, pulse + 6, 0, Math.PI * 2)
    ctx.stroke()
    ctx.strokeStyle = '#ffd15c'
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.arc(r.x, r.y, pulse + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (r.hp / r.max))
    ctx.stroke()
    if (r.burn > 0) {
      ctx.fillStyle = '#ff6a2a'
      ctx.beginPath()
      ctx.moveTo(r.x - 4, r.y - 22)
      ctx.quadraticCurveTo(r.x, r.y - 34 - Math.sin(t * 18) * 3, r.x + 4, r.y - 22)
      ctx.fill()
    }
  }
}

function drawTelegraph(ctx: CanvasRenderingContext2D, x: number, y: number, t: number, time: number): void {
  ctx.save()
  const a = 0.5 + Math.sin(t * 24) * 0.15
  // Hazard-striped strike zone.
  ctx.beginPath()
  ctx.rect(x - 70, y - 8, 140, 16)
  ctx.clip()
  ctx.globalAlpha = a
  ctx.fillStyle = '#ff4d3a'
  ctx.fillRect(x - 70, y - 8, 140, 16)
  ctx.fillStyle = '#ffd15c'
  const shift = (time * 60) % 20
  for (let px = x - 90 + shift; px < x + 70; px += 20) {
    ctx.beginPath()
    ctx.moveTo(px, y + 8)
    ctx.lineTo(px + 10, y - 8)
    ctx.lineTo(px + 16, y - 8)
    ctx.lineTo(px + 6, y + 8)
    ctx.fill()
  }
  ctx.restore()
  ctx.save()
  ctx.globalAlpha = 0.9
  ctx.strokeStyle = '#ffd15c'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(x - 70, y - 90)
  ctx.lineTo(x - 70, y)
  ctx.moveTo(x + 70, y - 90)
  ctx.lineTo(x + 70, y)
  const drop = (time * 80) % 24
  for (let k = 0; k < 2; k++) {
    ctx.moveTo(x - 10, y - 66 + drop + k * 16)
    ctx.lineTo(x, y - 50 + drop + k * 16)
    ctx.lineTo(x + 10, y - 66 + drop + k * 16)
  }
  ctx.stroke()
  ctx.restore()
}

// -----------------------------------------------------------------------------
// The ball.

function drawBall(ctx: CanvasRenderingContext2D, sim: Simulation, o: DrawOptions): void {
  const juice = o.juice
  if (juice.shattered) return
  const b = sim.ball
  const view = ballView(sim, o.alpha)
  const v = sim.build.visual
  const sp = hypot(b.vx, b.vy)
  const ratio = clamp(sp / sim.stats.maxSpeed, 0, 1.5)
  const armed = ratio >= TUNE.cleanRamRatio
  const leaving = o.outro?.kind === 'clear' ? clamp(o.outro.t, 0, 1) : 0
  const scale = 1 - leaving
  groundShadow(ctx, juice, view.x, view.y + b.r, b.r * scale)
  ctx.save()
  // Tapered trail, hotter once the ball is fast enough to ram cleanly.
  if (sim.trail.length > 1 && sp > 80) {
    const pts = [...sim.trail, view]
    ctx.lineCap = 'round'
    if (armed && !o.contrast) ctx.globalCompositeOperation = 'lighter'
    for (let i = 1; i < pts.length; i++) {
      const f = i / pts.length
      ctx.globalAlpha = (armed ? 0.5 : 0.3) * f * scale
      ctx.strokeStyle = v.trail
      ctx.lineWidth = b.r * (armed ? 1.5 : 1) * f
      ctx.beginPath()
      ctx.moveTo(pts[i - 1]!.x, pts[i - 1]!.y)
      ctx.lineTo(pts[i]!.x, pts[i]!.y)
      ctx.stroke()
    }
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
  }
  if (armed && !o.contrast) {
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = (0.32 + 0.1 * Math.sin(o.time * 14)) * scale
    ctx.drawImage(glowSprite(v.trail), view.x - b.r * 2.6, view.y - b.r * 2.6, b.r * 5.2, b.r * 5.2)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
  }
  if (juice.armPulse > 0) {
    ctx.strokeStyle = `rgba(141, 255, 192, ${juice.armPulse})`
    ctx.lineWidth = 3 * juice.armPulse
    ctx.beginPath()
    ctx.arc(view.x, view.y, b.r + 8 + (1 - juice.armPulse) * 36, 0, Math.PI * 2)
    ctx.stroke()
  }
  if (sim.shield > 0) {
    const sg = ctx.createRadialGradient(view.x, view.y, b.r, view.x, view.y, b.r + 12)
    sg.addColorStop(0, 'rgba(154, 215, 255, 0)')
    sg.addColorStop(1, 'rgba(154, 215, 255, 0.35)')
    ctx.fillStyle = sg
    ctx.beginPath()
    ctx.arc(view.x, view.y, b.r + 12, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#9ad7ff'
    ctx.lineWidth = 2.5
    ctx.globalAlpha = 0.8
    ctx.stroke()
    ctx.globalAlpha = 1
  }
  // Invulnerability after a hit blinks.
  if (sim.hurtLock > 0 && Math.floor(o.time * 20) % 2 === 0) ctx.globalAlpha = 0.45
  ctx.translate(view.x, view.y)
  ctx.scale(scale, scale)
  // Stretch along the velocity (volume kept), then squash along the last contact.
  if (sp > 60) {
    const k = clamp(ratio * (sim.grounded ? 0.05 : 0.16), 0, 0.2)
    const ang = Math.atan2(b.vy, b.vx)
    ctx.rotate(ang)
    ctx.scale(1 + k, 1 / (1 + k))
    ctx.rotate(-ang)
  }
  const s = clamp(juice.squash, -0.3, 0.38)
  if (s !== 0 && o.motion) {
    const na = Math.atan2(juice.squashNy, juice.squashNx)
    ctx.rotate(na)
    ctx.scale(1 - s, 1 / (1 - s * 0.9))
    ctx.rotate(-na)
  }
  const r = b.r
  // Body lit from the top left; this lighting does not spin.
  const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.05, 0, 0, r)
  g.addColorStop(0, '#fff6ea')
  g.addColorStop(0.28, shade(v.core, 0.2))
  g.addColorStop(0.7, v.core)
  g.addColorStop(1, shade(v.core, -0.7))
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.fill()
  // Rolling detail: a seam and two bolts turn with the ball.
  ctx.save()
  ctx.beginPath()
  ctx.arc(0, 0, r - 1, 0, Math.PI * 2)
  ctx.clip()
  ctx.rotate(b.spin)
  ctx.strokeStyle = 'rgba(20, 10, 6, 0.45)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(-r, 0)
  ctx.quadraticCurveTo(0, r * 0.45, r, 0)
  ctx.stroke()
  ctx.fillStyle = 'rgba(20, 10, 6, 0.5)'
  ctx.beginPath()
  ctx.arc(-r * 0.55, r * 0.1, r * 0.08, 0, Math.PI * 2)
  ctx.arc(r * 0.55, r * 0.1, r * 0.08, 0, Math.PI * 2)
  ctx.fill()
  drawPattern(ctx, v, r, o.colorblind)
  ctx.restore()
  if (armed && !o.contrast) {
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = 0.35
    ctx.drawImage(glowSprite(v.trail), -r, -r, r * 2, r * 2)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = sim.hurtLock > 0 && Math.floor(o.time * 20) % 2 === 0 ? 0.45 : 1
  }
  // Shell ring, rim light, and a fixed specular glint.
  ctx.strokeStyle = INK
  ctx.lineWidth = 6
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = o.contrast ? '#ffffff' : v.shell
  ctx.lineWidth = 3.5
  ctx.stroke()
  if (v.pattern === 'spikes') drawSpikeRing(ctx, v, r, b.spin)
  ctx.strokeStyle = 'rgba(255, 246, 234, 0.6)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(0, 0, r - 3.5, Math.PI * 1.05, Math.PI * 1.45)
  ctx.stroke()
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
  ctx.beginPath()
  ctx.ellipse(-r * 0.36, -r * 0.42, r * 0.17, r * 0.11, -0.6, 0, Math.PI * 2)
  ctx.fill()
  if (juice.hurtFlash > 0.3) {
    ctx.globalAlpha = (juice.hurtFlash - 0.3) * 0.9
    ctx.fillStyle = '#ff8a7a'
    ctx.beginPath()
    ctx.arc(0, 0, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
  }
  if (sim.phase > 0) {
    ctx.globalAlpha = 0.6
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 2
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.arc(0, 0, r + 5, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.globalAlpha = 1
  }
  if (sim.instability > 8) {
    ctx.globalAlpha = sim.instability / 160
    ctx.fillStyle = '#ff4d6a'
    ctx.beginPath()
    ctx.arc(0, 0, r * 0.45, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
  }
  ctx.restore()
  if (leaving > 0) return
  // Speed ring: a clean ram needs the arc past the notch.
  const ringR = b.r + 9
  ctx.lineCap = 'round'
  ctx.lineWidth = 3
  ctx.strokeStyle = 'rgba(12, 9, 7, 0.45)'
  ctx.beginPath()
  ctx.arc(view.x, view.y, ringR, 0, Math.PI * 2)
  ctx.stroke()
  const fill = clamp(ratio, 0, 1)
  ctx.lineWidth = armed ? 3.5 : 2.5
  ctx.strokeStyle = armed ? 'rgba(141,255,192,0.95)' : 'rgba(255,246,234,0.5)'
  ctx.beginPath()
  ctx.arc(view.x, view.y, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * fill)
  ctx.stroke()
  ctx.lineCap = 'butt'
  const notch = -Math.PI / 2 + Math.PI * 2 * TUNE.cleanRamRatio
  ctx.strokeStyle = '#fff6ea'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(view.x + Math.cos(notch) * (ringR - 5), view.y + Math.sin(notch) * (ringR - 5))
  ctx.lineTo(view.x + Math.cos(notch) * (ringR + 5), view.y + Math.sin(notch) * (ringR + 5))
  ctx.stroke()
}

function drawSpikeRing(ctx: CanvasRenderingContext2D, v: VisualDef, r: number, spin: number): void {
  ctx.save()
  ctx.rotate(spin)
  ctx.fillStyle = v.shell
  ctx.strokeStyle = INK
  ctx.lineWidth = 1.5
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI / 4) * i
    ctx.beginPath()
    ctx.moveTo(Math.cos(a - 0.18) * (r - 1), Math.sin(a - 0.18) * (r - 1))
    ctx.lineTo(Math.cos(a) * (r + 8), Math.sin(a) * (r + 8))
    ctx.lineTo(Math.cos(a + 0.18) * (r - 1), Math.sin(a + 0.18) * (r - 1))
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  }
  ctx.restore()
}

function drawPattern(ctx: CanvasRenderingContext2D, v: VisualDef, r: number, colorblind: boolean): void {
  ctx.strokeStyle = v.shell
  ctx.fillStyle = v.shell
  ctx.lineWidth = 2
  if (v.pattern === 'rings') {
    ctx.beginPath()
    ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2)
    ctx.stroke()
  } else if (v.pattern === 'flames') {
    ctx.beginPath()
    ctx.moveTo(-5, r * 0.25)
    ctx.quadraticCurveTo(-4, -r * 0.3, 0, -r * 0.75)
    ctx.quadraticCurveTo(4, -r * 0.3, 5, r * 0.25)
    ctx.fill()
  } else if (v.pattern === 'arcs') {
    ctx.beginPath()
    ctx.moveTo(-r * 0.5, -r * 0.2)
    ctx.lineTo(-r * 0.1, r * 0.1)
    ctx.lineTo(r * 0.05, -r * 0.2)
    ctx.lineTo(r * 0.5, r * 0.2)
    ctx.stroke()
  } else if (v.pattern === 'glass') {
    ctx.beginPath()
    ctx.moveTo(-r * 0.2, -r * 0.6)
    ctx.lineTo(r * 0.5, r * 0.2)
    ctx.moveTo(r * 0.1, -r * 0.2)
    ctx.lineTo(r * 0.3, -r * 0.5)
    ctx.stroke()
  } else if (v.pattern === 'plating') {
    ctx.strokeRect(-r * 0.35, -r * 0.35, r * 0.7, r * 0.7)
  } else if (v.pattern === 'magnet') {
    ctx.lineWidth = 3
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

// -----------------------------------------------------------------------------
// Screen-space layers: vignette, danger, speed lines, flashes, cinders, iris.

function drawScreenFx(ctx: CanvasRenderingContext2D, sim: Simulation, cam: Camera, w: number, h: number, o: DrawOptions): void {
  const juice = o.juice
  const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75)
  v.addColorStop(0, 'rgba(0,0,0,0)')
  v.addColorStop(1, 'rgba(0,0,0,0.5)')
  ctx.fillStyle = v
  ctx.fillRect(0, 0, w, h)
  // Speed lines when the ball is near its top speed.
  const sp = hypot(sim.ball.vx, sim.ball.vy)
  const ratio = sp / Math.max(1, sim.stats.maxSpeed)
  if (o.motion && ratio > 0.8 && !o.contrast && !sim.done) {
    const a = clamp((ratio - 0.8) * 2.5, 0, 0.5)
    const dir = Math.sign(sim.ball.vx) || 1
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.strokeStyle = `rgba(255, 240, 220, ${a * 0.5})`
    ctx.lineWidth = 1.5
    ctx.beginPath()
    for (let i = 0; i < 14; i++) {
      const band = i % 2 ? 0.08 + ((i * 0.137) % 0.18) : 0.74 + ((i * 0.211) % 0.2)
      const y = h * band
      const speed = 1400 + (i * 97) % 600
      const len = 60 + (i * 53) % 120
      const x = ((-dir * o.time * speed + i * 211) % (w + len) + w + len) % (w + len) - len
      ctx.moveTo(x, y)
      ctx.lineTo(x + len * dir, y)
    }
    ctx.stroke()
    ctx.restore()
  }
  if (sim.lowHp && !sim.done) {
    const beat = 0.75 + 0.25 * Math.pow(Math.abs(Math.sin(o.time * 2.6)), 6)
    const g = ctx.createRadialGradient(w / 2, h / 2, w * 0.3, w / 2, h / 2, w * 0.72)
    g.addColorStop(0, 'rgba(0,0,0,0)')
    g.addColorStop(1, `rgba(110, 18, 18, ${0.5 * beat})`)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }
  if (juice.hurtFlash > 0) {
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.7)
    g.addColorStop(0, 'rgba(0,0,0,0)')
    g.addColorStop(1, `rgba(170, 60, 50, ${0.28 * juice.hurtFlash})`)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }
  juice.drawCoins(ctx, (x, y) => worldToScreen(cam, x, y, w, h), { x: w - 70, y: 24 })
  if (o.flash > 0) {
    ctx.fillStyle = `rgba(255, 240, 220, ${clamp(o.flash, 0, 0.28)})`
    ctx.fillRect(0, 0, w, h)
  }
  if (o.outro?.kind === 'dead') {
    const t = o.outro.t
    ctx.fillStyle = `rgba(10, 6, 5, ${clamp((t - 0.25) * 0.9, 0, 0.6)})`
    ctx.fillRect(0, 0, w, h)
    if (t > 0.3) {
      const a = clamp((t - 0.3) * 3, 0, 1)
      ctx.globalAlpha = a
      ctx.textAlign = 'center'
      ctx.font = `800 ${Math.round(Math.min(w, 1200) / 11)}px Syne, Outfit, sans-serif`
      ctx.lineWidth = 10
      ctx.strokeStyle = INK
      const y = h / 2 + (1 - a) * 20
      ctx.strokeText('SHELL FAILED', w / 2, y)
      ctx.fillStyle = '#ff6a5a'
      ctx.fillText('SHELL FAILED', w / 2, y)
      ctx.globalAlpha = 1
    }
  }
  if (o.iris < 1) {
    const b = worldToScreen(cam, sim.ball.x, sim.ball.y, w, h)
    const max = Math.hypot(Math.max(b.x, w - b.x), Math.max(b.y, h - b.y)) + 20
    const e = o.iris * o.iris * (3 - 2 * o.iris)
    ctx.fillStyle = '#0b0908'
    ctx.beginPath()
    ctx.rect(0, 0, w, h)
    ctx.arc(b.x, b.y, Math.max(0, max * e), 0, Math.PI * 2, true)
    ctx.fill('evenodd')
    if (e > 0 && e < 1) {
      ctx.strokeStyle = 'rgba(255, 177, 90, 0.8)'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.arc(b.x, b.y, max * e, 0, Math.PI * 2)
      ctx.stroke()
    }
  }
}

// =============================================================================
// Menus: the painted foundry behind every screen.

export function drawMenuScene(ctx: CanvasRenderingContext2D, w: number, h: number, time: number, still: boolean, variant: 'title' | 'menu', juice: Juice): void {
  const t = still ? 0 : time
  const bg = ctx.createLinearGradient(0, 0, 0, h)
  bg.addColorStop(0, '#14110f')
  bg.addColorStop(1, '#2a1c14')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, h)
  const img = art(variant === 'title' ? 'title' : 'depths')
  if (img) {
    const zoom = variant === 'title' ? 1.03 + 0.025 * Math.sin(t * 0.07) : 1.1
    const r = coverRect(img, w, h, zoom, Math.sin(t * 0.05) * 0.5, Math.cos(t * 0.04) * 0.3)
    ctx.globalAlpha = variant === 'title' ? 1 : 0.55
    ctx.drawImage(img, r.x, r.y, r.w, r.h)
    ctx.globalAlpha = 1
    if (variant === 'title') {
      // The painted ball breathes heat.
      const bx = r.x + TITLE_BALL.x * r.w
      const by = r.y + TITLE_BALL.y * r.h
      const br = TITLE_BALL.r * r.w
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = 0.16 + 0.1 * Math.sin(t * 2.1)
      ctx.drawImage(glowSprite('#ff8a3c'), bx - br * 2.2, by - br * 2.2, br * 4.4, br * 4.4)
      ctx.restore()
      const scrim = ctx.createLinearGradient(0, 0, w * 0.7, 0)
      scrim.addColorStop(0, 'rgba(10, 8, 6, 0.88)')
      scrim.addColorStop(0.55, 'rgba(10, 8, 6, 0.55)')
      scrim.addColorStop(1, 'rgba(10, 8, 6, 0)')
      ctx.fillStyle = scrim
      ctx.fillRect(0, 0, w, h)
    } else {
      ctx.fillStyle = 'rgba(12, 9, 7, 0.45)'
      ctx.fillRect(0, 0, w, h)
    }
  } else {
    drawFallbackTitle(ctx, w, h, t)
  }
  juice.drawBack(ctx)
  const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75)
  v.addColorStop(0, 'rgba(0,0,0,0)')
  v.addColorStop(1, 'rgba(0,0,0,0.55)')
  ctx.fillStyle = v
  ctx.fillRect(0, 0, w, h)
}

function drawFallbackTitle(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
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
  private trailB: { x: number; y: number }[] = []

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
    if (ground) body.spin += (body.vx / body.r) * dt
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
    this.trailB.push({ x: this.b.x, y: this.b.y })
    if (this.trailB.length > 10) this.trailB.shift()
    if (this.t > 12) {
      this.t = 0
      this.a = this.spawn(this.before)
      this.b = this.spawn(this.after)
      this.trailB = []
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const bg = ctx.createLinearGradient(0, 0, 0, h)
    bg.addColorStop(0, '#1c1612')
    bg.addColorStop(1, '#2a1a10')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, w, h)
    ctx.save()
    ctx.scale(scale, scale)
    const fg = ctx.createLinearGradient(0, 300, 0, 360)
    fg.addColorStop(0, '#4a4038')
    fg.addColorStop(1, '#1e1915')
    ctx.fillStyle = fg
    ctx.fillRect(0, 300, worldW, 60)
    ctx.fillStyle = BONE
    ctx.fillRect(0, 300, worldW, 6)
    ctx.lineCap = 'round'
    for (let i = 1; i < this.trailB.length; i++) {
      ctx.globalAlpha = 0.3 * (i / this.trailB.length)
      ctx.strokeStyle = this.afterVisual.trail
      ctx.lineWidth = this.b.r * (i / this.trailB.length)
      ctx.beginPath()
      ctx.moveTo(this.trailB[i - 1]!.x, this.trailB[i - 1]!.y)
      ctx.lineTo(this.trailB[i]!.x, this.trailB[i]!.y)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    drawPreviewBall(ctx, this.a, this.beforeVisual, true)
    drawPreviewBall(ctx, this.b, this.afterVisual, false)
    ctx.restore()
  }
}

function drawPreviewBall(ctx: CanvasRenderingContext2D, body: Body, visual: VisualDef, ghost: boolean): void {
  ctx.fillStyle = 'rgba(0,0,0,0.35)'
  ctx.beginPath()
  ctx.ellipse(body.x, 302, body.r, body.r * 0.25, 0, 0, Math.PI * 2)
  ctx.fill()
  if (ghost) {
    ctx.globalAlpha = 0.5
    ctx.setLineDash([6, 6])
    ctx.strokeStyle = visual.shell
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.arc(body.x, body.y, body.r, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.globalAlpha = 1
    return
  }
  const g = ctx.createRadialGradient(body.x - body.r * 0.35, body.y - body.r * 0.4, 1, body.x, body.y, body.r)
  g.addColorStop(0, '#fff6ea')
  g.addColorStop(0.35, visual.core)
  g.addColorStop(1, shade(visual.core, -0.7))
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(body.x, body.y, body.r, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = 7
  ctx.stroke()
  ctx.strokeStyle = visual.shell
  ctx.lineWidth = 4.5
  ctx.stroke()
  ctx.save()
  ctx.translate(body.x, body.y)
  ctx.rotate(body.spin)
  ctx.strokeStyle = 'rgba(20, 10, 6, 0.5)'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(-body.r * 0.9, 0)
  ctx.quadraticCurveTo(0, body.r * 0.4, body.r * 0.9, 0)
  ctx.stroke()
  ctx.restore()
}
