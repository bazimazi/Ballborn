import type { KillKind, Stats, StatusId, Tag } from './types'
import type { BoundEffect, EffectDef } from './types'
import type { Rng } from './util'

export interface FxEnemy {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  hp: number
  alive: boolean
  burn: number
  burnDps: number
  shock: number
  slow: number
  mass: number
  pinned?: boolean
  uid: number
}

export interface EffectCtx {
  x: number
  y: number
  nx: number
  ny: number
  speed: number
  impact: number
  enemy?: FxEnemy
  dealt: number
  killedBy?: KillKind
  combo: number
  dt: number
}

export interface EffectApi {
  time: number
  grounded: boolean
  groundTime: number
  stats: Stats
  counters: Map<string, number>
  cooldowns: Map<string, number>
  once: Set<string>
  rng: Rng
  combo: number
  fxDepth: number
  enemies: FxEnemy[]
  discover: (synergyId: string) => void
  damageEnemy: (e: FxEnemy, amount: number, tags: Tag[], opts?: { pierce?: boolean; kind?: KillKind; source?: 'collision' | 'ability' | 'effect' }) => number
  heal: (n: number) => void
  addEnergy: (n: number) => void
  addShield: (n: number) => void
  explode: (x: number, y: number, radius: number, damage: number, hurtSelf: boolean) => void
  chain: (x: number, y: number, jumps: number, range: number, damage: number) => void
  attract: (radius: number, strength: number, target: 'projectile' | 'pickup' | 'enemy') => void
  knockback: (e: FxEnemy, nx: number, ny: number, force: number) => void
  applyStatus: (e: FxEnemy, status: StatusId, duration: number, magnitude: number) => void
  impulse: (along: 'velocity' | 'up' | 'normal', amount: number, nx: number, ny: number) => void
  controlTax: (duration: number, mul: number) => void
  addInstability: (n: number) => void
}

export function triggerEffects(effects: BoundEffect[], event: EffectDef['event'], api: EffectApi, ctx: EffectCtx): void {
  if (api.fxDepth > 3) return
  for (const bound of effects) {
    if (bound.effect.event !== event) continue
    runOne(bound, api, ctx)
  }
}

function runOne(bound: BoundEffect, api: EffectApi, ctx: EffectCtx): void {
  const effect = bound.effect
  if (effect.minSpeed !== undefined && ctx.speed < effect.minSpeed) return
  if (effect.minSpeedRatio !== undefined && ctx.speed < api.stats.maxSpeed * effect.minSpeedRatio) return
  if (effect.requiresStatus && ctx.enemy) {
    if (effect.requiresStatus === 'burn' && ctx.enemy.burn <= 0) return
    if (effect.requiresStatus === 'shock' && ctx.enemy.shock <= 0) return
    if (effect.requiresStatus === 'slow' && ctx.enemy.slow <= 0) return
  }
  if (effect.requiresStatus && !ctx.enemy) return
  if (effect.requiresKill && effect.requiresKill !== 'any' && ctx.killedBy !== effect.requiresKill) return
  if (effect.everyCombo && (ctx.combo <= 0 || ctx.combo % effect.everyCombo !== 0)) return
  if (effect.chance !== undefined && api.rng() > effect.chance) return
  if (effect.once) {
    const key = `${effect.id}:${effect.once}`
    if (api.once.has(key)) return
    api.once.add(key)
  }
  if (effect.cooldown) {
    const ready = api.cooldowns.get(effect.id) ?? 0
    if (api.time < ready) return
    api.cooldowns.set(effect.id, api.time + effect.cooldown)
  }
  if (bound.synergyId) api.discover(bound.synergyId)
  api.fxDepth++
  for (const action of effect.actions) applyAction(action, api, ctx)
  api.fxDepth--
}

function applyAction(action: EffectDef['actions'][number], api: EffectApi, ctx: EffectCtx): void {
  switch (action.type) {
    case 'damage': {
      if (!ctx.enemy) return
      const amount = magnitude(action, api, ctx)
      api.damageEnemy(ctx.enemy, amount, action.tags ?? ['impact'], { pierce: action.pierce, kind: 'impact', source: 'effect' })
      return
    }
    case 'area': {
      const amount = magnitude(action, api, ctx)
      for (const e of api.enemies) {
        if (!e.alive) continue
        if (Math.hypot(e.x - ctx.x, e.y - ctx.y) <= action.radius + e.r) {
          api.damageEnemy(e, amount, action.tags ?? ['area'], { pierce: action.pierce, kind: 'impact', source: 'effect' })
        }
      }
      return
    }
    case 'status':
      if (ctx.enemy) api.applyStatus(ctx.enemy, action.status, action.duration, action.magnitude)
      return
    case 'knockback':
      if (ctx.enemy) api.knockback(ctx.enemy, ctx.nx, ctx.ny, action.force)
      return
    case 'heal': {
      const n = action.scale === 'dealt' ? ctx.dealt * action.amount : action.amount
      api.heal(n)
      return
    }
    case 'energy':
      api.addEnergy(action.perSecond ? action.amount * ctx.dt : action.amount)
      return
    case 'explode':
      api.explode(ctx.x, ctx.y, action.radius, magnitude(action, api, ctx), !!action.hurtSelf)
      return
    case 'chain':
      api.chain(ctx.x, ctx.y, action.jumps, action.range, magnitude(action, api, ctx))
      return
    case 'shield':
      api.addShield(action.amount)
      return
    case 'instability':
      api.addInstability(action.amount)
      return
    case 'attract':
      api.attract(action.radius, action.strength, action.target)
      return
    case 'counter': {
      if (action.when === 'grounded' && api.groundTime < 0.28) return
      if (action.when === 'air' && api.grounded) return
      const cur = api.counters.get(action.id) ?? 0
      let next = cur
      if (action.op === 'add') next = cur + action.value
      else if (action.op === 'set') next = action.value
      else next = Math.max(0, cur - action.value * ctx.dt)
      if (action.max !== undefined) next = Math.min(action.max, next)
      api.counters.set(action.id, next)
      return
    }
    case 'impulse':
      api.impulse(action.along, action.amount, ctx.nx, ctx.ny)
      return
    case 'controlTax':
      api.controlTax(action.duration, action.mul)
      return
  }
}

function magnitude(
  action: { amount: number; scale: 'flat' | 'impact' | 'massSpeed' | 'dealt'; counter?: string; counterMul?: number },
  api: EffectApi,
  ctx: EffectCtx,
): number {
  let n = action.amount
  if (action.scale === 'impact') n = ctx.impact * action.amount
  else if (action.scale === 'massSpeed') n = api.stats.mass * ctx.speed * action.amount
  else if (action.scale === 'dealt') n = ctx.dealt * action.amount
  if (action.counter) {
    const c = api.counters.get(action.counter) ?? 0
    n *= 1 + c * (action.counterMul ?? 0)
  }
  return n
}
