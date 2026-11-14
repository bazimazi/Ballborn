import { art, coverRect, TITLE_BALL } from './assets'
import { BIOME } from './data/meta'
import { glowSprite, shade, withAlpha, type Juice } from './juice'
import { AFFIXES, BOSS_RULES, crusherPose, FLOOR_Y, geyserPhase, SHOCK_H, type LiveEnemy, type Simulation } from './sim'
import { ENEMY_MAP } from './data/enemies'
import { TUNE } from './tune'
import type { Stats, VisualDef } from './types'
import { ballRadius, hopVelocity, horizontalAccel, resolveCircleAabb, verticalAccel, type Body } from './physics'
import { clamp, hypot, lerp, mulberry32 } from './util'
import type { Post } from './post'

export interface Camera {
  x: number
  y: number
  zoom: number
  shakeX: number
  shakeY: number
  rot: number
  /** Smoothed look-ahead offsets, so a bounce that flips the ball's velocity does not yank the camera. */
  lookX?: number
  lookY?: number
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
  /** Screen point collected cinders fly to (the HUD's cinder counter). */
  coinTarget?: { x: number; y: number }
  /** Light, bloom and grade passes; null or absent turns them off (high contrast, slow devices). */
  post?: Post | null
  /** Bloom strength, 0..1. */
  bloom?: number
  /** Impact-frame strength, 0..1 (0 when screen flashes are off). */
  impact?: number
}

const INK = '#120d0a'
const BONE = '#efe4d2'

export function makeCamera(): Camera {
  return { x: 400, y: 400, zoom: 1, shakeX: 0, shakeY: 0, rot: 0 }
}

export function ballView(sim: Simulation, alpha: number): { x: number; y: number } {
  return { x: lerp(sim.prevX, sim.ball.x, alpha), y: lerp(sim.prevY, sim.ball.y, alpha) }
}

/**
 * Small screens (phones, split windows) zoom out so enough of a room shows.
 * Not all the way to the desktop view, though: on a phone that leaves the
 * ball a few pixels wide. Off-screen arrows cover what falls outside.
 */
export function fitZoom(viewW: number, viewH: number): number {
  return clamp(Math.min(viewW / 980, viewH / 560), 0.55, 1)
}

/**
 * `edgePad` is screen space (CSS pixels) the camera may show past each side
 * wall. On touch screens the stick and the hop button sit over the corners, so
 * without it the ball spawns under a thumb and the exit gate hides under hop.
 */
export function updateCamera(cam: Camera, sim: Simulation, dt: number, viewW: number, viewH: number, motion: boolean, alpha: number, edgePad = 0): void {
  const b = ballView(sim, alpha)
  // Look ahead in the direction of travel so a fast ball can see where it will stop or land.
  const look = motion ? 0.22 : 0.1
  // The look-ahead itself eases (a ram or wall bounce flips vx in one tick), and vertical look-ahead
  // is gentler still, so a bouncing ball does not bob the whole view.
  const wantX = clamp(sim.ball.vx * look, -viewW * 0.22, viewW * 0.22)
  const wantY = clamp(sim.ball.vy * 0.05, -30, 70)
  cam.lookX = (cam.lookX ?? wantX) + (wantX - (cam.lookX ?? wantX)) * (1 - Math.exp(-3 * dt))
  cam.lookY = (cam.lookY ?? wantY) + (wantY - (cam.lookY ?? wantY)) * (1 - Math.exp(-2 * dt))
  const sp = hypot(sim.ball.vx, sim.ball.vy)
  // Close enough that the ball and the constructs read as characters; it eases out with speed so a fast ball sees further.
  const target = (motion ? clamp(1.3 - sp / 3800, 1.06, 1.3) : 1.18) * fitZoom(viewW, viewH)
  cam.zoom += (target - cam.zoom) * (1 - Math.exp(-2.4 * dt))
  const lookX = b.x + cam.lookX
  let lookY = b.y + cam.lookY - 30
  // Nearly every fight is on the floor, so the vertical framing hangs off the floor line, not the ball:
  // at rest the floor sits about 130 px above the bottom edge (the bottom HUD rides on the slab), and
  // while the ball is up on a ledge or a spring it stays above the bottom HUD (about 96 px) instead of
  // sliding under it. The ball itself always stays clear of the top HUD and the bottom edge.
  // Pads shrink on short screens (a landscape phone is ~390 px tall), where the world needs every row.
  const z = cam.zoom
  const restPad = Math.min(130, viewH * 0.18)
  const airPad = Math.min(96, viewH * 0.135)
  const topPad = Math.min(84, viewH * 0.12)
  lookY = Math.min(lookY, FLOOR_Y - (viewH / 2 - restPad) / z)
  lookY = Math.max(lookY, FLOOR_Y - (viewH / 2 - airPad) / z)
  lookY = Math.min(lookY, b.y + (viewH / 2 - topPad) / z)
  lookY = Math.max(lookY, b.y - (viewH / 2 - Math.min(70, viewH * 0.1)) / z)
  const k = 1 - Math.exp(-5.5 * dt)
  cam.x += (lookX - cam.x) * k
  cam.y += (lookY - cam.y) * k
  const halfW = viewW / (2 * cam.zoom)
  const halfH = viewH / (2 * cam.zoom)
  const padW = edgePad / cam.zoom
  cam.x = clamp(cam.x, Math.min(halfW - padW, sim.room.width / 2), Math.max(sim.room.width / 2, sim.room.width - halfW + padW))
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

/**
 * Arrows at the screen edge for constructs the camera cannot see, so a fast
 * ball never rams into something it had no chance to read. A wind-up makes
 * the arrow pulse red.
 */
function drawOffscreen(ctx: CanvasRenderingContext2D, sim: Simulation, cam: Camera, w: number, h: number, o: DrawOptions): void {
  if (sim.done) return
  const pad = 30
  for (const e of sim.enemies) {
    if (!e.alive) continue
    const p = worldToScreen(cam, e.x, e.y, w, h)
    const m = e.r * cam.zoom
    if (p.x > -m && p.x < w + m && p.y > -m && p.y < h + m) continue
    const cx = clamp(p.x, pad, w - pad)
    // Below the HUD's top row (integrity, currencies, buttons), which is about 60 px tall on every screen.
    const cy = clamp(p.y, Math.min(h / 2, pad + 64), Math.max(h / 2, h - pad - 40))
    const ang = Math.atan2(p.y - cy, p.x - cx)
    const dist = hypot(e.x - sim.ball.x, e.y - sim.ball.y) // ball position: close enough for a fade
    const near = clamp(1 - dist / 1400, 0.25, 1)
    const warn = e.windup > 0 || e.charging > 0
    const color = warn ? '#ff5d4a' : e.affix ? '#ffd15c' : e.elite ? '#ffd15c' : '#ffb15a'
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(ang)
    ctx.globalAlpha = near * (warn ? 0.6 + 0.4 * Math.sin(o.time * 18) : 0.9)
    const s = 9 + near * 6 + (e.elite ? 3 : 0)
    ctx.fillStyle = color
    ctx.strokeStyle = INK
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(s, 0)
    ctx.lineTo(-s * 0.7, -s * 0.75)
    ctx.lineTo(-s * 0.35, 0)
    ctx.lineTo(-s * 0.7, s * 0.75)
    ctx.closePath()
    ctx.stroke()
    ctx.fill()
    ctx.restore()
  }
}

// =============================================================================
// World.

type Lerpable = { x: number; y: number; px?: number; py?: number }
const lerpStash: number[] = []
const lerpList: Lerpable[] = []
/** Past this in one tick something teleported (a blink, a respawn): draw it where it is. */
const TELEPORT = 120

/**
 * Moves every entity to where it was `alpha` of the way through the latest
 * tick, for drawing only. The simulation runs in fixed ticks while frames
 * arrive at the display's own rate; without this, constructs, bolts, and
 * loot advance in uneven jumps against the smoothly interpolated camera.
 * `restoreTicks` must run before the simulation steps again.
 */
function interpolateTicks(sim: Simulation, alpha: number): void {
  lerpList.length = 0
  lerpStash.length = 0
  for (const e of sim.enemies) lerpList.push(e)
  for (const b of sim.bullets) lerpList.push(b)
  for (const w of sim.shocks) lerpList.push(w)
  for (const p of sim.pickups) lerpList.push(p)
  if (sim.boss) {
    lerpList.push(sim.boss)
    for (const r of sim.boss.rivets) lerpList.push(r)
  }
  const back = 1 - alpha
  for (const o of lerpList) {
    lerpStash.push(o.x, o.y)
    if (o.px === undefined || o.py === undefined) continue
    const dx = o.x - o.px
    const dy = o.y - o.py
    if (Math.abs(dx) + Math.abs(dy) > TELEPORT) continue
    o.x -= dx * back
    o.y -= dy * back
  }
  // Moving platforms keep their start-of-tick position in frameX/frameY.
  for (const s of sim.solids) {
    lerpStash.push(s.x, s.y)
    if (!s.move) continue
    s.x -= (s.x - s.frameX) * back
    s.y -= (s.y - s.frameY) * back
  }
  // Sparks fly in straight lines between ticks; floaters drift up at a fixed rate.
  const dt = TUNE.fixedDt * back
  for (const p of sim.particles) {
    lerpStash.push(p.x, p.y)
    p.x -= p.vx * dt
    p.y -= p.vy * dt
  }
  for (const f of sim.floaters) {
    lerpStash.push(f.y)
    f.y += 28 * dt
  }
  lerpStash.push(sim.time)
  sim.time -= dt
}

function restoreTicks(sim: Simulation): void {
  let i = 0
  for (const o of lerpList) {
    o.x = lerpStash[i++]!
    o.y = lerpStash[i++]!
  }
  for (const s of sim.solids) {
    s.x = lerpStash[i++]!
    s.y = lerpStash[i++]!
  }
  for (const p of sim.particles) {
    p.x = lerpStash[i++]!
    p.y = lerpStash[i++]!
  }
  for (const f of sim.floaters) f.y = lerpStash[i++]!
  sim.time = lerpStash[i++]!
  lerpList.length = 0
  lerpStash.length = 0
}

export function drawWorld(ctx: CanvasRenderingContext2D, sim: Simulation, cam: Camera, viewW: number, viewH: number, o: DrawOptions): void {
  interpolateTicks(sim, o.alpha)
  try {
    drawWorldAt(ctx, sim, cam, viewW, viewH, o)
  } finally {
    restoreTicks(sim)
  }
}

function drawWorldAt(ctx: CanvasRenderingContext2D, sim: Simulation, cam: Camera, viewW: number, viewH: number, o: DrawOptions): void {
  const juice = o.juice
  const post = o.contrast ? null : o.post ?? null
  post?.reset()
  drawBackdrop(ctx, sim, cam, viewW, viewH, o)

  const zoom = cam.zoom * (1 + juice.zoomPunch)
  const enter = (): void => {
    ctx.save()
    ctx.translate(viewW / 2 + cam.shakeX, viewH / 2 + cam.shakeY)
    if (cam.rot) ctx.rotate(cam.rot)
    ctx.scale(zoom, zoom)
    ctx.translate(-cam.x, -cam.y)
  }
  enter()

  if (!o.contrast) drawLamps(ctx, sim, o.time)
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
    if (!s.alive) continue
    if (s.bounds) {
      // Side walls only show when the camera looks past a room edge (touch screens).
      if (s.h > s.w) drawBoundWall(ctx, s.x, s.w, s.x < 0, sim.room.height, o.contrast)
      continue
    }
    const hot = lava.some((l) => l.x < s.x + s.w + 60 && l.x + l.w > s.x - 60 && l.y > s.y && l.y - s.y < 260)
    drawBeam(ctx, s.x, s.y, s.w, s.h, s.kind, sim.time, o.contrast, hot)
    if (collapsing && s.breakable) drawCollapseWarning(ctx, s, sim.boss!.collapse, sim.time)
  }
  for (const h of sim.hazards) if (h.type === 'crusher') drawCrusher(ctx, h, sim.time, o.contrast)
  juice.drawScorches(ctx)
  ctx.restore()

  // Light the environment; the actors drawn after this stay at full strength on top.
  if (post) {
    const light: LightFn = (x, y, r, color, a = 1) => post.add((x - cam.x) * zoom + viewW / 2 + cam.shakeX, (y - cam.y) * zoom + viewH / 2 + cam.shakeY, r * zoom, color, a)
    gatherLights(sim, o, light)
    post.applyLights(ctx, viewW, viewH)
  }
  enter()

  drawGate(ctx, sim, o)
  for (const p of sim.pickups) drawPickup(ctx, p.x, p.y, p.kind, sim.time, p.life, o.contrast)
  if (sim.boss) drawBoss(ctx, sim, o)
  drawShocks(ctx, sim, o)
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

  if (!o.contrast) drawForeground(ctx, cam, viewW, viewH)
  if (post) {
    post.bloom(ctx, ctx.canvas, viewW, viewH, o.bloom ?? 1)
    post.grade(ctx, viewW, viewH, sim.lowHp ? 1 : 0)
  }
  drawScreenFx(ctx, sim, cam, viewW, viewH, o, !!post)
}

type LightFn = (x: number, y: number, r: number, color: string, a?: number) => void

/** Everything that gives off light this frame, in world space. */
function gatherLights(sim: Simulation, o: DrawOptions, light: LightFn): void {
  const t = o.time
  for (const l of lampsFor(sim)) light(l.x, l.y + 40, 430, '#ffcf9a', 0.42 + 0.03 * Math.sin(t * 7 + l.x))
  for (const h of sim.hazards) {
    if (h.type === 'lava') {
      for (let px = h.x + 40; px < h.x + h.w; px += 130) light(px, h.y + 4, 230, '#ff6a24', 0.85 + 0.12 * Math.sin(t * 2.2 + px * 0.01))
    } else if (h.type === 'geyser') {
      const g = geyserPhase(h, sim.time)
      if (g.erupt) light(h.x + h.w / 2, h.y - 50, 240, '#ff9a4a', 0.9)
      else if (g.warn) light(h.x + h.w / 2, h.y - 6, 110, '#ff5d3a', 0.6)
    }
  }
  const e = sim.room.exit
  if (sim.exitOpen) light(e.x + e.w / 2, e.y + e.h / 2, 340, '#ffb15a', 0.95)
  else light(e.x + e.w / 2, e.y - 6, 110, '#ff5d3a', 0.7)
  for (const b of sim.bullets) light(b.x, b.y, 110, b.friendly ? '#b8ffe0' : b.color.startsWith('#') ? b.color : '#ffb15a', 0.75)
  for (const p of sim.pickups) light(p.x, p.y, 70, p.kind === 'heal' ? '#7dffb3' : '#ffb15a', 0.45)
  for (const en of sim.enemies) {
    if (!en.alive) continue
    if (en.windup > 0 || en.charging > 0) light(en.x, en.y, 130, '#ff5d3a', 0.6)
    if (en.elite) light(en.x, en.y, 170, en.affix ? AFFIXES[en.affix].color : '#ffd15c', 0.45)
    if (en.shape === 'wisp') light(en.x, en.y, 160, en.accent, 0.6)
    if (en.burn > 0) light(en.x, en.y, 110, '#ff7a32', 0.6)
  }
  const boss = sim.boss
  if (boss && boss.alive) {
    light(boss.x, boss.y - 10, boss.phase > 1 ? 420 : 260, '#ff8a3c', boss.phase > 1 ? 0.9 : 0.5)
    for (const r of boss.rivets) if (r.alive) light(r.x, r.y, 120, '#ffd15c', 0.6)
    if (boss.attack === 'wave') light(boss.x - boss.r, FLOOR_Y - 10, 260, '#ff8a3c', 0.8)
  }
  for (const w of sim.shocks) light(w.x, w.y - 16, 220, '#ffb15a', 0.95)
  for (const f of o.juice.flares) light(f.x, f.y, f.r, f.color, f.a * (f.life / f.max))
  if (!o.juice.shattered && !sim.done) {
    const b = ballView(sim, o.alpha)
    const ratio = clamp(hypot(sim.ball.vx, sim.ball.vy) / Math.max(1, sim.stats.maxSpeed), 0, 1.4)
    const hot = sim.overdrive
    light(b.x, b.y, (hot ? 300 : 200) + ratio * 120, hot ? '#ffb347' : sim.build.visual.trail, hot ? 0.95 : 0.4 + 0.35 * ratio)
    light(b.x, b.y, 90, '#fff1df', 0.35)
  }
}

// -----------------------------------------------------------------------------
// Work lamps: hung along each room's ceiling. They give the light pass a rhythm
// to work with and make long rooms read as places, not corridors.

interface Lamp { x: number; y: number; i: number }
const lampCache = new WeakMap<Simulation, Lamp[]>()

function lampsFor(sim: Simulation): Lamp[] {
  let lamps = lampCache.get(sim)
  if (lamps) return lamps
  lamps = []
  const y = 70
  let i = 0
  for (let x = 280; x < sim.room.width - 120; x += 560) {
    // Never inside a platform.
    const blocked = sim.solids.some((s) => !s.bounds && x > s.x - 50 && x < s.x + s.w + 50 && y + 50 > s.y && y - 90 < s.y + s.h)
    if (!blocked) lamps.push({ x, y, i: i++ })
  }
  lampCache.set(sim, lamps)
  return lamps
}

function drawLamps(ctx: CanvasRenderingContext2D, sim: Simulation, time: number): void {
  for (const l of lampsFor(sim)) {
    const sway = Math.sin(time * 0.7 + l.i * 1.7) * 0.035
    ctx.save()
    ctx.translate(l.x, -48)
    ctx.rotate(sway)
    const len = l.y + 48
    ctx.strokeStyle = '#0b0c10'
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(0, len - 14)
    ctx.stroke()
    // Volumetric cone.
    ctx.globalCompositeOperation = 'lighter'
    const cone = ctx.createLinearGradient(0, len, 0, len + 420)
    cone.addColorStop(0, 'rgba(255, 205, 150, 0.16)')
    cone.addColorStop(1, 'rgba(255, 205, 150, 0)')
    ctx.fillStyle = cone
    ctx.beginPath()
    ctx.moveTo(-14, len)
    ctx.lineTo(14, len)
    ctx.lineTo(150, len + 420)
    ctx.lineTo(-150, len + 420)
    ctx.closePath()
    ctx.fill()
    ctx.globalAlpha = 0.9
    ctx.drawImage(glowSprite('#ffd9a8'), -34, len - 26, 68, 68)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    // Shade.
    ctx.fillStyle = '#14161c'
    ctx.beginPath()
    ctx.moveTo(-6, len - 16)
    ctx.lineTo(6, len - 16)
    ctx.lineTo(18, len)
    ctx.lineTo(-18, len)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = '#fff3dc'
    ctx.beginPath()
    ctx.ellipse(0, len, 11, 3.5, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
}

// -----------------------------------------------------------------------------
// Foreground: dark girders and chains between the camera and the room, moving
// faster than the playfield. Kept to the top edge so they never hide the play.

let fgLayer: HTMLCanvasElement | null = null
const FG_W = 2200

function buildForeground(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = FG_W
  c.height = 200
  const g = c.getContext('2d')!
  const rnd = mulberry32(31)
  g.fillStyle = '#050608'
  // A heavy truss across the very top, broken in places.
  for (let x = 0; x < FG_W; x += 700 + rnd() * 300) {
    const w = 260 + rnd() * 380
    g.fillRect(x, 0, w, 16)
    g.fillRect(x, 30, w, 6)
    g.lineWidth = 4
    g.strokeStyle = '#050608'
    g.beginPath()
    for (let px = x; px < x + w - 20; px += 30) {
      g.moveTo(px, 16)
      g.lineTo(px + 15, 32)
      g.lineTo(px + 30, 16)
    }
    g.stroke()
  }
  // Chains hanging into view.
  for (let i = 0; i < 7; i++) {
    const x = rnd() * FG_W
    const len = 50 + rnd() * 130
    g.lineWidth = 5
    for (let y = 0; y < len; y += 16) {
      g.beginPath()
      if ((y / 16) % 2) g.ellipse(x, y, 3, 9, 0, 0, Math.PI * 2)
      else g.ellipse(x, y, 7, 9, 0, 0, Math.PI * 2)
      g.stroke()
    }
    if (rnd() < 0.5) {
      g.beginPath()
      g.moveTo(x - 14, len)
      g.lineTo(x + 14, len)
      g.lineTo(x + 8, len + 22)
      g.lineTo(x - 8, len + 22)
      g.fill()
    }
  }
  const soft = document.createElement('canvas')
  soft.width = c.width
  soft.height = c.height
  const sg = soft.getContext('2d')!
  sg.filter = 'blur(2px)'
  sg.drawImage(c, 0, 0)
  return soft
}

function drawForeground(ctx: CanvasRenderingContext2D, cam: Camera, w: number, h: number): void {
  if (!fgLayer) fgLayer = buildForeground()
  let off = -((cam.x * 1.35) % FG_W)
  if (off > 0) off -= FG_W
  const y = clamp(-(cam.y - 380) * 0.25, -120, 10) - 6
  ctx.save()
  ctx.globalAlpha = 0.92
  const k = clamp(Math.min(w, h) / 720, 0.6, 1.2)
  for (let x = off * k; x < w; x += FG_W * k) ctx.drawImage(fgLayer, x, y * k, FG_W * k, 200 * k)
  ctx.restore()
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
  bg.addColorStop(0, o.contrast ? '#000' : '#0c1018')
  bg.addColorStop(1, o.contrast ? '#0a0806' : '#2a1a12')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, h)
  if (o.contrast) return
  const img = art('depths')
  if (img) {
    const panX = clamp((cam.x / Math.max(1, sim.room.width)) * 2 - 1, -1, 1) * 0.8
    const panY = clamp((cam.y / Math.max(1, sim.room.height)) * 2 - 1, -1, 1) * 0.5
    const r = coverRect(img, w, h, 1.14, panX, panY)
    ctx.globalAlpha = 0.82
    ctx.drawImage(img, r.x, r.y, r.w, r.h)
    ctx.globalAlpha = 1
  }
  // Built a little taller than needed and in steps, so a phone's URL bar sliding in and out does not rebuild it.
  if (!midLayer || midLayer.h < h || midLayer.h > h + 192) {
    const mh = Math.ceil(h / 96) * 96 + 96
    midLayer = { canvas: buildMidLayer(mh), h: mh }
  }
  // The first tile starts at or left of the screen edge, never a whole tile off-screen.
  let off = -((cam.x * 0.28) % MID_W)
  if (off > 0) off -= MID_W
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
  haze.addColorStop(0, 'rgba(8, 12, 20, 0.45)')
  haze.addColorStop(0.45, 'rgba(30, 40, 58, 0.12)')
  haze.addColorStop(0.8, 'rgba(70, 60, 60, 0.12)')
  haze.addColorStop(1, 'rgba(120, 40, 10, 0.3)')
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

/** The foundry wall past a room's edge: solid iron, a lit inner face, and depth that fades out. */
function drawBoundWall(ctx: CanvasRenderingContext2D, x: number, w: number, left: boolean, roomH: number, contrast: boolean): void {
  const depth = 1600
  const face = left ? x + w : x
  const x0 = left ? face - depth : face
  const top = -600
  const bottom = roomH + 600
  if (contrast) {
    ctx.fillStyle = '#000'
    ctx.fillRect(x0, top, depth, bottom - top)
  } else {
    const g = ctx.createLinearGradient(face, 0, left ? face - 260 : face + 260, 0)
    g.addColorStop(0, '#2a231d')
    g.addColorStop(0.25, '#1a1511')
    g.addColorStop(1, '#0d0a08')
    ctx.fillStyle = g
    ctx.fillRect(x0, top, depth, bottom - top)
    // Rivet seams so the wall reads as built, not as missing art.
    ctx.fillStyle = 'rgba(0,0,0,0.45)'
    for (let y = top + 40; y < bottom; y += 96) ctx.fillRect(left ? face - 90 : face, y, 90, 2)
  }
  ctx.fillStyle = BONE
  ctx.globalAlpha = 0.5
  ctx.fillRect(left ? face - 3 : face, top, 3, bottom - top)
  ctx.globalAlpha = 1
}

let grime: CanvasPattern | null | undefined

/** A neutral-grey speckle and scratch texture; drawn with 'overlay' it gives plates wear without changing their colour. */
function grimePattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (grime !== undefined) return grime
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const g = c.getContext('2d')
  if (!g) return (grime = null)
  const rnd = mulberry32(11)
  g.fillStyle = 'rgb(128,128,128)'
  g.fillRect(0, 0, 256, 256)
  for (let i = 0; i < 2200; i++) {
    const v = (96 + rnd() * 70) | 0
    g.fillStyle = `rgb(${v},${v},${v})`
    g.fillRect(rnd() * 256, rnd() * 256, 1 + rnd() * 2, 1 + rnd() * 2)
  }
  g.lineWidth = 1
  for (let i = 0; i < 46; i++) {
    const x = rnd() * 256
    const y = rnd() * 256
    const l = 6 + rnd() * 34
    const a = rnd() * 0.7 - 0.35
    g.strokeStyle = rnd() < 0.5 ? 'rgba(210,210,210,0.55)' : 'rgba(60,60,60,0.5)'
    g.beginPath()
    g.moveTo(x, y)
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l)
    g.stroke()
  }
  for (let i = 0; i < 14; i++) {
    const x = rnd() * 256
    const y = rnd() * 256
    const r = 10 + rnd() * 34
    const gr = g.createRadialGradient(x, y, 0, x, y, r)
    gr.addColorStop(0, 'rgba(50,50,50,0.4)')
    gr.addColorStop(1, 'rgba(50,50,50,0)')
    g.fillStyle = gr
    g.fillRect(x - r, y - r, r * 2, r * 2)
  }
  grime = ctx.createPattern(c, 'repeat')
  return grime
}

function drawBeam(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, kind: string, time: number, contrast: boolean, hot: boolean): void {
  const floor = h >= 80
  const face = Math.min(h, floor ? 240 : h)
  const base = kind === 'spring' ? '#7a5640' : kind === 'conveyor' ? '#3f4d4c' : kind === 'ice' ? '#5f8396' : floor ? '#3a404c' : '#4c5462'
  // Soft drop shadow under floating platforms.
  if (!floor && !contrast) {
    const sh = ctx.createLinearGradient(0, y + h, 0, y + h + 28)
    sh.addColorStop(0, 'rgba(0,0,0,0.45)')
    sh.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = sh
    ctx.fillRect(x + 4, y + h, w - 8, 28)
  }
  const g = ctx.createLinearGradient(0, y, 0, y + face)
  g.addColorStop(0, shade(base, 0.22))
  g.addColorStop(0.18, base)
  g.addColorStop(1, shade(base, -0.62))
  ctx.fillStyle = g
  ctx.fillRect(x, y, w, h)
  if (!contrast) {
    const pat = grimePattern(ctx)
    if (pat) {
      ctx.save()
      ctx.globalCompositeOperation = 'overlay'
      ctx.globalAlpha = 0.7
      ctx.fillStyle = pat
      ctx.fillRect(x, y, w, face)
      ctx.restore()
    }
  }
  if (hot && !contrast) {
    const hg = ctx.createLinearGradient(0, y + h - Math.min(h, 60), 0, y + h)
    hg.addColorStop(0, 'rgba(255, 90, 30, 0)')
    hg.addColorStop(1, 'rgba(255, 110, 40, 0.42)')
    ctx.fillStyle = hg
    ctx.fillRect(x, y + h - Math.min(h, 60), w, Math.min(h, 60))
  }
  // Plate seams with a lit edge.
  const seam = floor ? 128 : 72
  ctx.fillStyle = 'rgba(0,0,0,0.42)'
  for (let px = x + seam; px < x + w - 8; px += seam) ctx.fillRect(px, y + 4, 2, face - 4)
  ctx.fillStyle = 'rgba(220,235,255,0.08)'
  for (let px = x + seam + 2; px < x + w - 8; px += seam) ctx.fillRect(px, y + 4, 1, face - 4)
  if (floor) {
    // A horizontal band and bolted strip a little under the walkway: the floor reads as built.
    ctx.fillStyle = 'rgba(0,0,0,0.35)'
    ctx.fillRect(x, y + 34, w, 3)
    ctx.fillStyle = 'rgba(220,235,255,0.06)'
    ctx.fillRect(x, y + 37, w, 1)
  }
  // Lit top lip (the walkable edge), and a dark underside.
  const lip = kind === 'spring' ? '#ffb15a' : kind === 'ice' ? '#d5f4f6' : '#f6e2c8'
  ctx.fillStyle = shade(base, -0.5)
  ctx.fillRect(x, y, w, floor ? 7 : 5)
  ctx.fillStyle = lip
  ctx.fillRect(x, y, w, floor ? 4 : 3)
  ctx.fillStyle = 'rgba(255,255,255,0.6)'
  ctx.fillRect(x, y, w, 1)
  if (!floor) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.fillRect(x, y + h - 3, w, 3)
    // Bevelled ends.
    ctx.fillStyle = 'rgba(255,240,220,0.12)'
    ctx.fillRect(x, y + 3, 2, h - 6)
    ctx.fillStyle = 'rgba(0,0,0,0.4)'
    ctx.fillRect(x + w - 2, y + 3, 2, h - 6)
  }
  if (contrast) {
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 2
    ctx.strokeRect(x + 1, y + 1, w - 2, Math.min(h, 200) - 2)
  }
  // Rivets with a highlight.
  const rivets = Math.max(2, Math.floor(w / 48))
  const ry = y + (floor ? 20 : Math.min(h, 40) * 0.58)
  for (let i = 0; i < rivets; i++) {
    const rx = x + 12 + ((w - 24) * i) / Math.max(1, rivets - 1)
    ctx.fillStyle = '#15171c'
    ctx.beginPath()
    ctx.arc(rx, ry, 3, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = 'rgba(230,240,255,0.4)'
    ctx.fillRect(rx - 1.5, ry - 1.8, 1.5, 1.3)
  }
  // Floating metal platforms: hazard chevrons on the ends and amber running lights underneath.
  if (!floor && kind === 'metal' && !contrast && w >= 80 && h >= 16) {
    for (const ex of [x + 3, x + w - 15]) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(ex, y + 6, 12, h - 10)
      ctx.clip()
      ctx.fillStyle = '#16181d'
      ctx.fillRect(ex, y + 6, 12, h - 10)
      ctx.fillStyle = '#e6b44a'
      for (let k = -2; k < h / 6; k++) {
        ctx.beginPath()
        ctx.moveTo(ex, y + 6 + k * 8)
        ctx.lineTo(ex + 12, y + 6 + k * 8 - 8)
        ctx.lineTo(ex + 12, y + 6 + k * 8 - 4)
        ctx.lineTo(ex, y + 6 + k * 8 + 4)
        ctx.fill()
      }
      ctx.restore()
    }
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (let px = x + 40; px < x + w - 30; px += 80) {
      const on = 0.55 + 0.45 * Math.sin(time * 2.2 + px * 0.05)
      ctx.globalAlpha = on
      ctx.fillStyle = '#ffb35a'
      ctx.fillRect(px - 3, y + h - 3, 6, 2)
      ctx.globalAlpha = on * 0.6
      ctx.drawImage(glowSprite('#ff9a3c'), px - 12, y + h - 14, 24, 24)
    }
    ctx.restore()
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
    if (!o.contrast) {
      // Slow light rays turning behind the open gate.
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.translate(cx, e.y + e.h / 2)
      ctx.rotate(t * 0.35)
      ctx.fillStyle = 'rgba(255, 200, 130, 0.07)'
      for (let k = 0; k < 8; k++) {
        ctx.rotate(Math.PI / 4)
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.lineTo(-22, -e.h * 1.6)
        ctx.lineTo(22, -e.h * 1.6)
        ctx.closePath()
        ctx.fill()
      }
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
  // The particles setting already scales how many the simulation spawns (sim.fxLevel).
  const limit = sim.particles.length
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
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  for (const f of sim.floaters) {
    const age = 0.7 - f.life
    const n = parseFloat(f.text)
    const numeric = Number.isFinite(n)
    const big = numeric ? clamp(n / 7, 0, 20) : 1
    const crit = f.text.includes('!')
    const size = (numeric ? 17 : 13) + big + (crit ? 6 : 0)
    // Slam in large, overshoot, settle, then rise and fade. A little sideways scatter per number.
    const pop = o.motion ? (age < 0.06 ? lerp(2.1, 0.9, age / 0.06) : age < 0.14 ? lerp(0.9, 1, (age - 0.06) / 0.08) : 1) : 1
    let hash = 0
    for (let i = 0; i < f.text.length; i++) hash = (hash * 31 + f.text.charCodeAt(i)) % 997
    const drift = o.motion ? ((((f.x * 7.31 + hash * 0.37) % 1) + 1) % 1 - 0.5) * 70 * age : 0
    // An eased extra rise: numbers spawned a beat apart pull away from each other.
    const rise = o.motion ? Math.sqrt(Math.max(0, age)) * 46 : 0
    ctx.globalAlpha = clamp(f.life * 2.6, 0, 1)
    ctx.save()
    ctx.translate(f.x + drift, f.y - rise)
    ctx.scale(pop, pop)
    if (crit) ctx.rotate(-0.08)
    ctx.font = `800 ${size}px Syne, Outfit, Segoe UI, sans-serif`
    // Drop shadow, heavy ink outline, then the fill with a light top.
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.fillText(f.text, 2, 3)
    ctx.lineWidth = Math.max(4, size * 0.28)
    ctx.strokeStyle = INK
    ctx.strokeText(f.text, 0, 0)
    const g = ctx.createLinearGradient(0, -size * 0.5, 0, size * 0.5)
    g.addColorStop(0, '#ffffff')
    g.addColorStop(0.55, f.color)
    g.addColorStop(1, shade(f.color.startsWith('#') ? f.color : '#ffb15a', -0.25))
    ctx.fillStyle = g
    ctx.fillText(f.text, 0, 0)
    ctx.restore()
  }
  ctx.globalAlpha = 1
  ctx.textBaseline = 'alphabetic'
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
  } else if (shape === 'hound') {
    // A low battering wedge: heavy brow forward, haunches back.
    ctx.moveTo(-r * 1.1, r * 0.75)
    ctx.lineTo(-r * 1.05, -r * 0.35)
    ctx.quadraticCurveTo(-r * 0.6, -r * 0.95, r * 0.25, -r * 0.8)
    ctx.lineTo(r * 1.15, -r * 0.2)
    ctx.lineTo(r * 1.1, r * 0.75)
    ctx.closePath()
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
  // Victim shake: the struck construct rattles during the hit pause (real time, since the sim is frozen).
  const struck = o.motion && e.hitFlash > 0 ? Math.sin(o.time * 95 + e.uid) * 3.2 * clamp(e.hitFlash / 0.08, 0, 1) : 0
  ctx.translate(shake + (e.flying ? 0 : struck), e.flying ? struck : 0)
  ctx.rotate(clamp(e.vx / 900, -0.22, 0.22))
  // Squash on hit, a slow breath at rest.
  const hf = clamp(e.hitFlash / 0.08, 0, 1)
  const breath = 1 + Math.sin(time * 2.4 + e.uid) * 0.025
  // Walkers squash on each footfall (the low point of the bob), feet kept on the floor.
  const footfall = moving && !e.flying && o.motion ? Math.pow(1 - Math.abs(Math.sin(time * 9 + e.uid)), 4) * 0.1 : 0
  // Anticipation: a shooter rears up before it fires; a hound crouches lower and lower, then stretches into the charge.
  const rear = e.shot && e.windup > 0 && o.motion ? (1 - clamp(e.windup / 0.35, 0, 1)) * 0.12 : 0
  const crouch = e.shape === 'hound' && o.motion ? (e.windup > 0 ? (1 - clamp(e.windup / 0.62, 0, 1)) * 0.16 : 0) - (e.charging > 0 ? 0.1 : 0) : 0
  const sy = 1 - footfall + rear - crouch
  const sx = 1 + footfall - rear * 0.6 + crouch
  if (!e.flying) ctx.translate(0, r * (1 - sy))
  ctx.scale(pop * (1 + 0.3 * hf) * breath * sx, (pop * (1 - 0.24 * hf) / breath) * sy)
  // The hound's wedge points where it will run.
  if (e.shape === 'hound') ctx.scale(e.facing < 0 ? -1 : 1, 1)
  if (e.elite && !o.contrast) {
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = 0.35 + 0.1 * Math.sin(time * 4)
    ctx.drawImage(glowSprite(e.affix ? AFFIXES[e.affix].color : '#ffd15c'), -r * 2, -r * 2, r * 4, r * 4)
    ctx.restore()
  }
  if (e.affix) {
    // The affix reads by shape too: a rotating dashed ring in the affix colour.
    ctx.save()
    ctx.rotate(time * (e.affix === 'hasted' ? 3 : 1.2))
    ctx.setLineDash(e.affix === 'plated' ? [10, 4] : e.affix === 'volatile' ? [3, 5] : e.affix === 'magnetic' ? [14, 8] : [6, 6])
    ctx.lineWidth = 2.5
    ctx.strokeStyle = AFFIXES[e.affix].color
    ctx.globalAlpha = 0.85
    ctx.beginPath()
    ctx.arc(0, 0, r + 7 + (e.affix === 'volatile' ? Math.sin(time * 9) * 2 : 0), 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }
  if (e.shape === 'wisp' && !o.contrast) {
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = 0.5
    ctx.drawImage(glowSprite(e.accent), -r * 2.2, -r * 2.2, r * 4.4, r * 4.4)
    ctx.restore()
  }
  if (e.shape === 'spark') {
    // Wings: two fast-beating blades behind the body. Loot never has wings.
    const flap = Math.sin(time * 34 + e.uid) * 0.7
    ctx.fillStyle = 'rgba(255, 236, 214, 0.85)'
    ctx.strokeStyle = INK
    ctx.lineWidth = 1.5
    for (const side of [-1, 1]) {
      ctx.save()
      ctx.rotate(side * (0.5 + flap))
      ctx.beginPath()
      ctx.ellipse(side * r * 0.95, -r * 0.35, r * 0.75, r * 0.32, side * 0.3, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.restore()
    }
  }
  if (!o.contrast) {
    // A dark halo separates the silhouette from a busy backdrop.
    ctx.globalAlpha = 0.55
    ctx.drawImage(glowSprite('#05060a'), -r * 1.9, -r * 1.9, r * 3.8, r * 3.8)
    ctx.globalAlpha = 1
  }
  enemyPath(ctx, e.shape, r, time)
  const body = ctx.createLinearGradient(0, -r, 0, r)
  body.addColorStop(0, shade(e.color, 0.34))
  body.addColorStop(0.5, e.color)
  body.addColorStop(1, shade(e.color, -0.5))
  ctx.fillStyle = body
  ctx.fill()
  if (!o.contrast) {
    // Warm bounce light from the slag below.
    ctx.save()
    ctx.clip()
    const rim = ctx.createLinearGradient(0, r * 0.25, 0, r)
    rim.addColorStop(0, 'rgba(255, 130, 60, 0)')
    rim.addColorStop(1, 'rgba(255, 140, 70, 0.45)')
    ctx.fillStyle = rim
    ctx.fillRect(-r * 1.6, r * 0.25, r * 3.2, r)
    ctx.restore()
    enemyPath(ctx, e.shape, r, time)
  }
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
  if (e.shape === 'hound') {
    // Horns forward; chevrons ahead of it while it winds up, so the charge is never a surprise.
    ctx.fillStyle = '#e7d6bf'
    ctx.strokeStyle = INK
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(r * 0.55, -r * 0.62)
    ctx.quadraticCurveTo(r * 1.5, -r * 1.05, r * 1.55, -r * 0.35)
    ctx.quadraticCurveTo(r * 1.15, -r * 0.55, r * 0.8, -r * 0.35)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    if (e.windup > 0 || e.charging > 0) {
      const t = e.charging > 0 ? 1 : 1 - clamp(e.windup / 0.62, 0, 1)
      ctx.strokeStyle = e.charging > 0 ? '#ffd15c' : '#ff5d4a'
      ctx.lineWidth = 3.5
      for (let i = 0; i < 3; i++) {
        const x = r * 1.7 + i * 13 + (time * 60) % 13
        ctx.globalAlpha = (0.35 + t * 0.65) * (1 - i * 0.25)
        ctx.beginPath()
        ctx.moveTo(x, -r * 0.45)
        ctx.lineTo(x + 8, 0)
        ctx.lineTo(x, r * 0.45)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    }
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
    // The plate's angle: facing the ball, swinging round while it turns, hanging low while the guard is down.
    const turn = TUNE.shieldTurn * (e.defId === 'knight' ? 1.25 : 1)
    const swing = clamp(e.turnT / turn, 0, 1)
    let mid = e.facing > 0 ? 0 : Math.PI
    if (swing > 0) mid += (e.facing > 0 ? -1 : 1) * swing * Math.PI * 0.9
    const down = e.guard > 0
    if (down) mid = Math.PI / 2 + e.facing * 0.5
    const a0 = mid - (down ? 0.6 : 1)
    const a1 = mid + (down ? 0.6 : 1)
    const cx = Math.cos(mid) * r * 0.2
    const cy = Math.sin(mid) * r * 0.2
    ctx.globalAlpha = down ? 0.55 : 1
    ctx.strokeStyle = INK
    ctx.lineWidth = 8
    ctx.beginPath()
    ctx.arc(cx, cy, r + 5, a0, a1)
    ctx.stroke()
    ctx.strokeStyle = down ? '#9aa4b2' : '#f3efe6'
    ctx.lineWidth = 4.5
    ctx.stroke()
    ctx.globalAlpha = 1
    if (!down) {
      ctx.strokeStyle = 'rgba(154, 215, 255, 0.8)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(cx, cy, r + 9, a0 + 0.2, a1 - 0.2)
      ctx.stroke()
    } else {
      // Guard down: the opening reads as a ring of light, draining with the time left to punish it.
      ctx.strokeStyle = '#8dffc0'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.arc(0, 0, r + 11, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (e.guard / TUNE.guardBreak))
      ctx.stroke()
    }
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
    const letter = (ENEMY_MAP[e.defId]?.name ?? e.name).slice(0, 1)
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
    if (e.affix) {
      // Two affixed elites shoulder to shoulder: stagger the labels so both stay readable.
      const crowded = sim.enemies.some((o) => o !== e && o.alive && o.affix && o.uid < e.uid && Math.abs(o.x - e.x) < 96 && Math.abs(o.y - e.y) < 60)
      worldText(ctx, AFFIXES[e.affix].label, e.x, y - 8 - (crowded ? 15 : 0), 11, AFFIXES[e.affix].color)
    }
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
  // The shockwave wind-up: the whole body rears up on its pedestals before it drops.
  const rear = b.attack === 'wave' ? Math.sin(clamp(1 - b.telegraph / 0.75, 0, 1) * Math.PI * 0.5) * 18 : 0
  if (b.attack === 'wave') drawWaveTelegraph(ctx, b.x - b.r * 0.8, FLOOR_Y, b.telegraph, t)
  ctx.translate(b.x + stuck + winding, b.y - rear)
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
  if (open && b.recover <= 0) {
    // Guarded: two iron shutters close over the heart, leaving a hot slit. Rams are turned (half damage).
    ctx.save()
    ctx.beginPath()
    ctx.arc(0, -10, hr + 6, 0, Math.PI * 2)
    ctx.clip()
    for (const side of [-1, 1]) {
      const sg = ctx.createLinearGradient(0, -10 + side * (hr + 6), 0, -10 + side * 4)
      sg.addColorStop(0, '#2a241e')
      sg.addColorStop(1, '#6a6058')
      ctx.fillStyle = sg
      ctx.fillRect(-hr - 8, side < 0 ? -10 - hr - 8 : -6, hr * 2 + 16, hr + 4)
      ctx.strokeStyle = INK
      ctx.lineWidth = 2.5
      ctx.strokeRect(-hr - 8, side < 0 ? -10 - hr - 8 : -6, hr * 2 + 16, hr + 4)
    }
    ctx.restore()
  }
  ctx.strokeStyle = INK
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.arc(0, -10, hr + 8, 0, Math.PI * 2)
  ctx.stroke()
  if (b.recover > 0) {
    // The punish window: a green ring draining with the time left. Hits land at 130%.
    const pulse = 1 + 0.08 * Math.sin(t * 22)
    if (!o.contrast) {
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = 0.45
      ctx.drawImage(glowSprite('#8dffc0'), -hr * 2.4, -10 - hr * 2.4, hr * 4.8, hr * 4.8)
      ctx.restore()
    }
    ctx.strokeStyle = '#8dffc0'
    ctx.lineWidth = 5
    ctx.beginPath()
    ctx.arc(0, -10, (hr + 15) * pulse, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(b.recover / BOSS_RULES.windowWave, 0, 1))
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

/** Floor chevrons running away from the Colossus while it rears up: a shockwave is coming along the floor. */
function drawWaveTelegraph(ctx: CanvasRenderingContext2D, x: number, y: number, left: number, time: number): void {
  const k = clamp(1 - left / 0.75, 0, 1)
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (let i = 0; i < 7; i++) {
    const cx = x - 40 - i * 64 - ((time * 140) % 64)
    const a = (0.25 + 0.75 * k) * (1 - i / 8)
    ctx.globalAlpha = a
    ctx.strokeStyle = INK
    ctx.lineWidth = 7
    ctx.beginPath()
    ctx.moveTo(cx + 12, y - 30)
    ctx.lineTo(cx, y - 16)
    ctx.lineTo(cx + 12, y - 2)
    ctx.stroke()
    ctx.strokeStyle = k > 0.7 && Math.sin(time * 30) > 0 ? '#fff1c2' : '#ff8a3c'
    ctx.lineWidth = 3.5
    ctx.stroke()
  }
  ctx.restore()
}

/** A shockwave crest rolling along the floor: a hot hump of light with a smear behind it. */
function drawShocks(ctx: CanvasRenderingContext2D, sim: Simulation, o: DrawOptions): void {
  if (!sim.shocks.length) return
  for (const w of sim.shocks) {
    const flick = 1 + Math.sin(o.time * 40 + w.x * 0.05) * 0.08
    const h = SHOCK_H * flick
    ctx.save()
    if (!o.contrast) {
      ctx.globalCompositeOperation = 'lighter'
      // Smear behind the crest.
      const tail = ctx.createLinearGradient(w.x, 0, w.x - w.dir * 160, 0)
      tail.addColorStop(0, 'rgba(255, 170, 90, 0.55)')
      tail.addColorStop(1, 'rgba(255, 120, 40, 0)')
      ctx.fillStyle = tail
      ctx.beginPath()
      ctx.moveTo(w.x, w.y - h * 0.7)
      ctx.quadraticCurveTo(w.x - w.dir * 60, w.y - h * 0.25, w.x - w.dir * 160, w.y)
      ctx.lineTo(w.x, w.y)
      ctx.closePath()
      ctx.fill()
      ctx.drawImage(glowSprite('#ffb15a'), w.x - 60, w.y - 70, 120, 120)
    }
    ctx.globalCompositeOperation = 'source-over'
    // The crest.
    const g = ctx.createLinearGradient(0, w.y - h, 0, w.y)
    g.addColorStop(0, '#fff6dc')
    g.addColorStop(0.45, '#ffb15a')
    g.addColorStop(1, '#c43a10')
    ctx.fillStyle = o.contrast ? '#ffd15c' : g
    ctx.strokeStyle = INK
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(w.x - 26, w.y)
    ctx.quadraticCurveTo(w.x - w.dir * 4, w.y - h * 1.5, w.x + 22, w.y)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    ctx.restore()
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
  // White Hot: the combo chain has set the ball alight.
  const hot = sim.overdrive && !sim.done
  groundShadow(ctx, juice, view.x, view.y + b.r, b.r * scale)
  ctx.save()
  // Tapered trail, hotter once the ball is fast enough to ram cleanly.
  if (sim.trail.length > 2 && (sp > 80 || hot)) {
    // The newest trail point is the end of the latest tick; the drawn ball is between ticks.
    const pts = [...sim.trail.slice(0, -1), view]
    const width = b.r * (hot ? 1.35 : armed ? 1.05 : 0.8)
    if (!o.contrast) ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = (hot ? 0.75 : armed ? 0.55 : 0.32) * scale * clamp((sp - 80) / 300, hot ? 0.5 : 0, 1)
    ribbon(ctx, pts, width, hot ? '#ffb347' : v.trail)
    if (armed || hot) {
      ctx.globalAlpha = 0.5 * scale
      ribbon(ctx, pts, width * 0.38, '#fff6ea')
    }
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
  }
  if (armed && !o.contrast && !hot) {
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = (0.2 + 0.06 * Math.sin(o.time * 14)) * scale
    ctx.drawImage(glowSprite(v.trail), view.x - b.r * 2.4, view.y - b.r * 2.4, b.r * 4.8, b.r * 4.8)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
  }
  if (hot) drawWhiteHot(ctx, view.x, view.y, b.r * scale, b.vx, b.vy, o)
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
  g.addColorStop(0.28, hot ? '#fff1c2' : shade(v.core, 0.2))
  g.addColorStop(0.7, hot ? '#ffb347' : v.core)
  g.addColorStop(1, hot ? '#a8401a' : shade(v.core, -0.7))
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.fill()
  // Rolling detail: a seam and two bolts turn with the ball.
  ctx.save()
  ctx.beginPath()
  ctx.arc(0, 0, r - 1, 0, Math.PI * 2)
  ctx.clip()
  ctx.rotate(lerp(sim.prevSpin, b.spin, o.alpha))
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
  if (!o.contrast) {
    // Warm bounce light on the underside, cool sky light on top: the ball sits in the room's light.
    ctx.save()
    ctx.beginPath()
    ctx.arc(0, 0, r, 0, Math.PI * 2)
    ctx.clip()
    const rim = ctx.createLinearGradient(0, -r, 0, r)
    rim.addColorStop(0, 'rgba(150, 200, 255, 0.18)')
    rim.addColorStop(0.45, 'rgba(0,0,0,0)')
    rim.addColorStop(0.78, 'rgba(0,0,0,0)')
    rim.addColorStop(1, 'rgba(255, 140, 70, 0.45)')
    ctx.fillStyle = rim
    ctx.fillRect(-r, -r, r * 2, r * 2)
    ctx.restore()
  }
  // Shell ring, rim light, and a fixed specular glint.
  ctx.strokeStyle = INK
  ctx.lineWidth = 6
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = o.contrast ? '#ffffff' : hot ? '#fff1c2' : v.shell
  ctx.lineWidth = 3.5
  ctx.stroke()
  if (v.pattern === 'spikes') drawSpikeRing(ctx, v, r, lerp(sim.prevSpin, b.spin, o.alpha))
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
  if (armed && !o.contrast) {
    // Armed: two arcs of charge circling the ball.
    ctx.save()
    ctx.translate(view.x, view.y)
    ctx.rotate(o.time * 9)
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineCap = 'round'
    for (let k = 0; k < 2; k++) {
      ctx.rotate(Math.PI)
      ctx.strokeStyle = hot ? 'rgba(255, 226, 140, 0.9)' : 'rgba(141, 255, 210, 0.85)'
      ctx.lineWidth = 2.5
      ctx.beginPath()
      ctx.arc(0, 0, b.r + 4, 0, 1.1)
      ctx.stroke()
      ctx.strokeStyle = hot ? 'rgba(255, 190, 90, 0.35)' : 'rgba(141, 255, 210, 0.3)'
      ctx.lineWidth = 6
      ctx.stroke()
    }
    ctx.restore()
  }
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

/**
 * White Hot: a flickering aura and tongues of flame streaming off the back of
 * the ball, so the state reads from across the room and in a screenshot.
 */
function drawWhiteHot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, vx: number, vy: number, o: DrawOptions): void {
  const t = o.time
  ctx.save()
  if (!o.contrast) {
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = 0.5 + 0.12 * Math.sin(t * 23)
    ctx.drawImage(glowSprite('#ffb347'), x - r * 3.4, y - r * 3.4, r * 6.8, r * 6.8)
    ctx.globalAlpha = 0.35
    ctx.drawImage(glowSprite('#fff1c2'), x - r * 1.9, y - r * 1.9, r * 3.8, r * 3.8)
  }
  // Flames lean away from the direction of travel (straight up at rest).
  const sp = Math.hypot(vx, vy)
  const back = sp > 60 ? Math.atan2(-vy, -vx) : -Math.PI / 2
  const lean = clamp(sp / 900, 0, 1)
  ctx.globalCompositeOperation = o.contrast ? 'source-over' : 'lighter'
  for (let i = 0; i < 6; i++) {
    const spread = (i / 5 - 0.5) * (1.6 - lean * 0.7)
    const a = back * lean + (-Math.PI / 2) * (1 - lean) + spread
    const len = r * (1.1 + 0.5 * Math.sin(t * 19 + i * 1.7) + lean * 0.9)
    const bx = x + Math.cos(a) * r * 0.7
    const by = y + Math.sin(a) * r * 0.7
    const tx = x + Math.cos(a) * (r + len)
    const ty = y + Math.sin(a) * (r + len)
    const nx = -Math.sin(a) * r * 0.32
    const ny = Math.cos(a) * r * 0.32
    ctx.globalAlpha = 0.55
    ctx.fillStyle = i % 2 ? '#ff8a3d' : '#ffd27a'
    ctx.beginPath()
    ctx.moveTo(bx + nx, by + ny)
    ctx.quadraticCurveTo(x + Math.cos(a) * (r + len * 0.5) + nx * 0.6, y + Math.sin(a) * (r + len * 0.5) + ny * 0.6, tx, ty)
    ctx.quadraticCurveTo(x + Math.cos(a) * (r + len * 0.5) - nx * 0.6, y + Math.sin(a) * (r + len * 0.5) - ny * 0.6, bx - nx, by - ny)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
}

/** A smooth tapered ribbon through points, widest at the newest end. */
function ribbon(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[], width: number, color: string): void {
  const n = pts.length
  if (n < 2) return
  const left: [number, number][] = []
  const right: [number, number][] = []
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)]!
    const c = pts[Math.min(n - 1, i + 1)]!
    let dx = c.x - a.x
    let dy = c.y - a.y
    const len = Math.hypot(dx, dy) || 1
    dx /= len
    dy /= len
    const f = i / (n - 1)
    const hw = width * f * f
    left.push([pts[i]!.x - dy * hw, pts[i]!.y + dx * hw])
    right.push([pts[i]!.x + dy * hw, pts[i]!.y - dx * hw])
  }
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(left[0]![0], left[0]![1])
  for (let i = 1; i < n; i++) ctx.lineTo(left[i]![0], left[i]![1])
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(right[i]![0], right[i]![1])
  ctx.closePath()
  ctx.fill()
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

function drawScreenFx(ctx: CanvasRenderingContext2D, sim: Simulation, cam: Camera, w: number, h: number, o: DrawOptions, graded = false): void {
  const juice = o.juice
  if (!graded) {
    const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75)
    v.addColorStop(0, 'rgba(0,0,0,0)')
    v.addColorStop(1, 'rgba(0,0,0,0.5)')
    ctx.fillStyle = v
    ctx.fillRect(0, 0, w, h)
  }
  drawOffscreen(ctx, sim, cam, w, h, o)
  // Speed lines when the ball is near its top speed.
  const sp = hypot(sim.ball.vx, sim.ball.vy)
  const ratio = sp / Math.max(1, sim.stats.maxSpeed)
  if (o.motion && ratio > 0.82 && !o.contrast && !sim.done) {
    // Radial speed lines converging on the ball, re-drawn a few times a second like hand-drawn frames.
    const a = clamp((ratio - 0.82) * 2.4, 0, 0.4)
    const bv = ballView(sim, o.alpha)
    const c = worldToScreen(cam, bv.x, bv.y, w, h)
    const outer = Math.hypot(w, h) * 0.62
    const rnd = mulberry32(Math.floor(o.time * 18))
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = `rgba(255, 244, 228, ${a * 0.32})`
    ctx.beginPath()
    for (let i = 0; i < 34; i++) {
      const ang = (i / 34) * Math.PI * 2 + rnd() * 0.15
      const inner = outer * (0.66 + rnd() * 0.18)
      const half = 0.004 + rnd() * 0.01
      ctx.moveTo(c.x + Math.cos(ang) * inner, c.y + Math.sin(ang) * inner)
      ctx.lineTo(c.x + Math.cos(ang - half) * outer, c.y + Math.sin(ang - half) * outer)
      ctx.lineTo(c.x + Math.cos(ang + half) * outer, c.y + Math.sin(ang + half) * outer)
      ctx.closePath()
    }
    ctx.fill()
    ctx.restore()
  }
  if (sim.lowHp && !sim.done) {
    const beat = 0.75 + 0.25 * Math.pow(Math.abs(Math.sin(o.time * 2.6)), 6)
    // Sized to the screen's diagonal, so a portrait phone gets a vignette rather than solid red bands.
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.hypot(w, h) * 0.5)
    g.addColorStop(0, 'rgba(0,0,0,0)')
    g.addColorStop(1, `rgba(110, 18, 18, ${0.5 * beat})`)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }
  if ((sim.overdrive || juice.overdriveFlash > 0) && !sim.done && !o.contrast) {
    // White Hot: the edges of the screen run warm, flaring as the state ignites.
    const k = (sim.overdrive ? 0.22 + 0.06 * Math.sin(o.time * 9) : 0) + juice.overdriveFlash * 0.35
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.42, w / 2, h / 2, Math.hypot(w, h) * 0.55)
    g.addColorStop(0, 'rgba(0,0,0,0)')
    g.addColorStop(1, `rgba(255, 150, 50, ${clamp(k, 0, 0.5)})`)
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
    ctx.restore()
  }
  if (juice.hurtFlash > 0) {
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.7)
    g.addColorStop(0, 'rgba(0,0,0,0)')
    g.addColorStop(1, `rgba(170, 60, 50, ${0.28 * juice.hurtFlash})`)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }
  juice.drawCoins(ctx, (x, y) => worldToScreen(cam, x, y, w, h), o.coinTarget ?? { x: w - 70, y: 24 })
  if (o.flash > 0) {
    ctx.fillStyle = `rgba(255, 240, 220, ${clamp(o.flash, 0, 0.28)})`
    ctx.fillRect(0, 0, w, h)
  }
  const impact = o.impact ?? 0
  if (impact > 0 && !o.contrast) {
    // Impact frame: one beat of inverted, crushed contrast, then a warm afterglow.
    ctx.save()
    if (impact > 0.55) {
      ctx.globalCompositeOperation = 'difference'
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, w, h)
      ctx.globalCompositeOperation = 'saturation'
      ctx.fillStyle = '#000000'
      ctx.globalAlpha = 0.8
      ctx.fillRect(0, 0, w, h)
    } else {
      ctx.globalCompositeOperation = 'lighter'
      ctx.fillStyle = `rgba(255, 210, 160, ${impact * 0.35})`
      ctx.fillRect(0, 0, w, h)
    }
    ctx.restore()
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
    const bv = ballView(sim, o.alpha)
    const b = worldToScreen(cam, bv.x, bv.y, w, h)
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
 * your current ball, the solid one is the ball with the offered part. The view
 * follows the new ball over a floor marked every 100 px, so acceleration, top
 * speed, hop height, and bounce read at a glance even in a small card.
 */
export class CardPreview {
  private a: Body
  private b: Body
  private t = 0
  private groundA = false
  private groundB = false
  private trailB: { x: number; y: number }[] = []
  /** Real time not yet simulated: the preview runs at the same pace on 60, 90, and 144 Hz screens. */
  private acc = 0
  private camX = 0
  private camY = 0

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
    return { x: 0, y: -r, vx: 0, vy: 0, r, spin: 0 }
  }

  /** Scripted input, every 3.4 s: roll right, hop at 0.85 s and float a moment, let go at 1.9 s, rest, start over. */
  private input(t: number): { x: number; hop: boolean; hold: boolean } {
    const local = t % 3.4
    if (local < 1.9) return { x: 1, hop: local > 0.85 && local < 0.9, hold: local > 0.85 && local < 1.2 }
    return { x: 0, hop: false, hold: false }
  }

  private advance(body: Body, stats: Stats, grounded: boolean, dt: number, input: { x: number; hop: boolean; hold: boolean }): boolean {
    let ax = horizontalAccel(stats, input.x, body.vx, grounded)
    if (Math.abs(body.vx) >= stats.maxSpeed && Math.sign(ax) === Math.sign(body.vx)) ax = 0
    body.vx += ax * dt
    body.vy += verticalAccel(stats, input.hold, false, grounded) * dt
    if (Math.abs(body.vx) > stats.maxSpeed) body.vx = Math.sign(body.vx) * stats.maxSpeed
    if (grounded && input.x === 0 && Math.abs(body.vx) < 10) body.vx = 0
    if (input.hop && grounded) body.vy = hopVelocity(stats)
    body.x += body.vx * dt
    body.y += body.vy * dt
    let ground = false
    const c = resolveCircleAabb(body, { x: -1e5, y: 0, w: 2e5, h: 200 }, stats.restitution, 1)
    if (c.hit && c.ny < -0.55) {
      ground = true
      if (c.impactSpeed < 300 && body.vy < 0) body.vy *= clamp((c.impactSpeed - 110) / 190, 0, 1)
      if (Math.abs(body.vy) < 48) body.vy = 0
    }
    body.spin += (ground ? body.vx / body.r : 0) * dt
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
    // About 120 world px tall: a balanced ball is ~28 px across in a 96 px strip.
    const scale = h / 120
    const viewW = w / scale
    const viewH = h / scale
    this.acc = Math.min(this.acc + Math.max(0, dt), 8 / 120)
    while (this.acc >= 1 / 120) {
      this.acc -= 1 / 120
      this.t += 1 / 120
      const input = this.input(this.t)
      this.groundA = this.advance(this.a, this.before, this.groundA, 1 / 120, input)
      this.groundB = this.advance(this.b, this.after, this.groundB, 1 / 120, input)
      if (this.t % 3.4 < 1 / 120) {
        this.a = this.spawn(this.before)
        this.b = this.spawn(this.after)
        this.trailB = []
      }
    }
    if (this.t > 34) this.t -= 34
    this.trailB.push({ x: this.b.x, y: this.b.y })
    if (this.trailB.length > 12) this.trailB.shift()
    // Follow the new ball: it sits a third of the way in, and the view lifts only when a hop would leave the frame.
    const wantX = this.b.x - viewW * 0.36
    const wantY = Math.min(-(viewH - 18 / scale), this.b.y - this.b.r - 10)
    const k = 1 - Math.exp(-10 * Math.max(dt, 1 / 240))
    this.camX = Math.abs(wantX - this.camX) > viewW ? wantX : this.camX + (wantX - this.camX) * k
    this.camY = Math.abs(wantY - this.camY) > viewH ? wantY : this.camY + (wantY - this.camY) * k * 0.8
    // Never lose the new ball: a fast light core or a big hop outruns the easing, so the frame is also a hard bound.
    const m = this.b.r + 6
    this.camX = clamp(this.camX, this.b.x + m - viewW, this.b.x - m)
    this.camY = clamp(this.camY, this.b.y + m + 6 - viewH, this.b.y - m)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const bg = ctx.createLinearGradient(0, 0, 0, h)
    bg.addColorStop(0, '#141922')
    bg.addColorStop(1, '#2a1a10')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, w, h)
    ctx.save()
    ctx.scale(scale, scale)
    ctx.translate(-this.camX, -this.camY)
    // Far pillars drift at half speed, so motion reads even between floor marks.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.035)'
    const far = this.camX * 0.5
    for (let x = Math.floor((this.camX - far) / 140) * 140 - 140; x < this.camX + viewW + 140; x += 140) {
      ctx.fillRect(x + far, this.camY, 26, viewH)
    }
    const fg = ctx.createLinearGradient(0, 0, 0, 40)
    fg.addColorStop(0, '#4a4038')
    fg.addColorStop(1, '#1e1915')
    ctx.fillStyle = fg
    ctx.fillRect(this.camX - 10, 0, viewW + 20, 60)
    ctx.fillStyle = BONE
    ctx.fillRect(this.camX - 10, 0, viewW + 20, 2.5)
    // Distance marks every 100 px.
    ctx.fillStyle = 'rgba(239, 228, 210, 0.45)'
    for (let x = Math.floor(this.camX / 100) * 100; x < this.camX + viewW + 100; x += 100) {
      ctx.fillRect(x - 1, 2.5, 2, 7)
    }
    ctx.lineCap = 'round'
    for (let i = 1; i < this.trailB.length; i++) {
      ctx.globalAlpha = 0.35 * (i / this.trailB.length)
      ctx.strokeStyle = this.afterVisual.trail
      ctx.lineWidth = this.b.r * 1.1 * (i / this.trailB.length)
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
  const lift = clamp(1 - (-body.y - body.r) / 160, 0.25, 1)
  ctx.fillStyle = `rgba(0,0,0,${0.4 * lift})`
  ctx.beginPath()
  ctx.ellipse(body.x, 2, body.r * lift, body.r * 0.25 * lift, 0, 0, Math.PI * 2)
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
