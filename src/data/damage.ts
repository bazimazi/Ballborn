import type { DamageRule, DamageSource } from '../types'
import { deepFreeze } from '../util'

/**
 * One table for every way the ball loses integrity. The simulation's hurt()
 * pipeline reads these rules in this order: phase, hit window, armor, gentle
 * scaling, shield, integrity, then low-integrity and lethal handling.
 *
 * Recoil (the cost of a dirty ram) is governed by the selfDamage stat instead
 * of armor, so armored shells are not counted twice.
 */
export const DAMAGE_RULES: Record<DamageSource, DamageRule> = deepFreeze({
  contact: { label: 'Construct contact', mitigated: true, phaseable: true, lock: true, dot: false, instant: false },
  recoil: { label: 'Ram recoil', mitigated: false, phaseable: true, lock: true, dot: false, instant: false },
  projectile: { label: 'Projectiles', mitigated: true, phaseable: true, lock: true, dot: false, instant: false },
  explosion: { label: 'Explosions', mitigated: true, phaseable: true, lock: true, dot: false, instant: false },
  lava: { label: 'Slag', mitigated: true, phaseable: false, lock: false, dot: true, instant: false },
  spikes: { label: 'Spikes', mitigated: true, phaseable: true, lock: true, dot: false, instant: false },
  crusher: { label: 'Stamps', mitigated: true, phaseable: false, lock: true, dot: false, instant: false },
  geyser: { label: 'Slag geysers', mitigated: true, phaseable: false, lock: false, dot: true, instant: false },
  boss: { label: 'The Colossus', mitigated: true, phaseable: true, lock: true, dot: false, instant: false },
  pit: { label: 'Falling', mitigated: false, phaseable: false, lock: false, dot: false, instant: true },
})

export const DAMAGE_SOURCES = Object.keys(DAMAGE_RULES) as DamageSource[]
