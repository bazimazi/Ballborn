/**
 * Component audit. Prints the role matrix used in docs/design-and-tuning.md and
 * checks that every part states an upside and a real cost.
 */
import { describe, expect, it } from 'vitest'
import { COMPONENTS } from '../src/data/components'
import { SYNERGIES } from '../src/data/synergies'
import { buildFor, STARTER_IDS } from '../src/run'
import type { ComponentDef } from '../src/types'

function mechanic(c: ComponentDef): string {
  const actions = new Set(c.effects.flatMap((e) => e.actions.map((a) => a.type)))
  if (c.ability) return `ability: ${c.ability.kind}`
  if (c.projectile) return `projectiles: ${c.projectile}`
  if (actions.size) return [...actions].join('+')
  return 'stats only'
}

function boss(c: ComponentDef): string {
  const actions = new Set(c.effects.flatMap((e) => e.actions.map((a) => a.type)))
  if (actions.has('status')) return 'burns boss and rivets (x0.6)'
  if (actions.has('chain')) return 'arcs reach rivets and heart (x0.8)'
  if (actions.has('explode')) return 'blasts reach boss (x0.65)'
  if (actions.has('area')) return 'area reaches boss (x0.8)'
  if (actions.has('damage')) return 'bonus counts as ram damage'
  if (c.projectile) return 'returns barrage shots'
  if (c.ability?.kind === 'slam' || c.ability?.kind === 'burst') return 'ability blast hits boss'
  return 'movement/stat change only'
}

describe('component audit', () => {
  it('every part states an upside and a downside, and changes the ball', () => {
    for (const c of COMPONENTS) {
      expect(c.upside.length, c.id).toBeGreaterThan(5)
      expect(c.downside.length, c.id).toBeGreaterThan(5)
      if (c.slot !== 'ability') {
        const base = buildFor({ ...STARTER_IDS, [c.slot]: null }, [])
        const withIt = buildFor({ ...STARTER_IDS, [c.slot]: c.id }, [])
        const statsChanged = JSON.stringify(base.stats) !== JSON.stringify(withIt.stats)
        expect(statsChanged || c.effects.length > 0 || !!c.projectile, c.id).toBe(true)
      }
    }
  })

  it('prints the role matrix', () => {
    const rows = COMPONENTS.map((c) => {
      const enables = SYNERGIES.filter((s) => s.requires.some((r) => c.tags.includes(r.tag))).map((s) => s.name)
      return `| ${c.name} | ${c.slot} | ${c.rarity}${c.pool !== 'standard' ? ` (${c.pool})` : ''} | ${mechanic(c)} | ${c.downside} | ${enables.slice(0, 3).join(', ') || '-'} | ${boss(c)} |`
    })
    console.log(['| Part | Slot | Rarity | Mechanic | Cost | Enables | Versus the Colossus |', '| --- | --- | --- | --- | --- | --- | --- |', ...rows].join('\n'))
  })
})
