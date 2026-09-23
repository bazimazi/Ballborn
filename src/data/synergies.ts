import type { SynergyDef } from '../types'

export const SYNERGIES: SynergyDef[] = [
  {
    id: 'mass-hammer',
    name: 'Mass Hammer',
    description: 'Weight and an impact tool agree. Collision damage gains an extra cut of your mass.',
    requires: [{ tag: 'heavy', count: 1 }, { tag: 'impact', count: 1 }],
    modifiers: [{ stat: 'impact', op: 'mul', value: 1.12 }],
    effects: [{
      id: 'mass-hammer-hit', event: 'onImpact', minSpeed: 200,
      actions: [{ type: 'damage', amount: 0.008, scale: 'massSpeed' }],
    }],
  },
  {
    id: 'burning-detonation',
    name: 'Burning Detonation',
    description: 'Fire sitting on an explosive temper. Constructs that die burning have a chance to burst.',
    requires: [{ tag: 'fire', count: 1 }, { tag: 'explosive', count: 1 }],
    effects: [{
      id: 'burn-det-kill', event: 'onKill', chance: 0.5, requiresKill: 'burn',
      actions: [{ type: 'explode', amount: 26, radius: 108, scale: 'flat' }],
    }],
  },
  {
    id: 'arc-tether',
    name: 'Arc Tether',
    description: 'Lightning follows what the magnet has claimed. Chains reach farther and jump once more.',
    requires: [{ tag: 'lightning', count: 1 }, { tag: 'magnetic', count: 1 }],
    effects: [{
      id: 'arc-tether-hit', event: 'onImpact', minSpeed: 150, cooldown: 0.2,
      actions: [{ type: 'chain', jumps: 2, range: 240, amount: 12, scale: 'flat' }],
    }],
  },
  {
    id: 'storm-bounce',
    name: 'Storm Bounce',
    description: 'A bouncing conductor. Each lively rebound throws a short arc.',
    requires: [{ tag: 'bounce', count: 1 }, { tag: 'lightning', count: 1 }],
    effects: [{
      id: 'storm-bounce-arc', event: 'onBounce', minSpeed: 130, cooldown: 0.25, chance: 0.75,
      actions: [{ type: 'chain', jumps: 2, range: 150, amount: 9, scale: 'flat' }],
    }],
  },
  {
    id: 'critical-momentum',
    name: 'Critical Momentum',
    description: 'Speed is the sight on the shot. Above a hard pace, impacts crack for critical force.',
    requires: [{ tag: 'momentum', count: 1 }, { tag: 'critical', count: 1 }],
    effects: [{
      id: 'crit-mom', event: 'onImpact', minSpeedRatio: 0.72,
      actions: [{ type: 'damage', amount: 0.55, scale: 'impact' }],
    }],
  },
  {
    id: 'wildfire',
    name: 'Wildfire',
    description: 'Two fire workings in one shell. A burn leaps to a neighbor.',
    requires: [{ tag: 'fire', count: 2 }],
    effects: [{
      id: 'wildfire-spread', event: 'onImpact', minSpeed: 140, cooldown: 0.4,
      actions: [
        { type: 'status', status: 'burn', duration: 2.2, magnitude: 8 },
        { type: 'area', amount: 6, radius: 92, scale: 'flat', tags: ['fire'] },
      ],
    }],
  },
  {
    id: 'bulwark-rhythm',
    name: 'Bulwark Rhythm',
    description: 'Armor learns the bounce. Each lively rebound plates on a sliver of shield.',
    requires: [{ tag: 'defensive', count: 1 }, { tag: 'bounce', count: 1 }],
    effects: [{
      id: 'bulwark-bounce', event: 'onBounce', minSpeed: 150, cooldown: 0.35,
      actions: [{ type: 'shield', amount: 4 }],
    }],
  },
  {
    id: 'harvest-cadence',
    name: 'Harvest Cadence',
    description: 'Combo and momentum share a ledger. Milestones return a larger gulp of energy.',
    requires: [{ tag: 'combo', count: 1 }, { tag: 'momentum', count: 1 }],
    effects: [{
      id: 'harvest-cadence', event: 'onCombo', everyCombo: 3,
      actions: [{ type: 'energy', amount: 10 }],
    }],
  },
  {
    id: 'reactor',
    name: 'Reactor',
    description: 'An explosive temper fed by pace. Fast impacts always bloom, even without a dedicated fuse.',
    requires: [{ tag: 'explosive', count: 1 }, { tag: 'momentum', count: 1 }],
    effects: [{
      id: 'reactor-blast', event: 'onImpact', minSpeedRatio: 0.66, cooldown: 0.45,
      actions: [{ type: 'explode', amount: 0.4, radius: 100, scale: 'impact' }],
    }],
  },
  {
    id: 'glass-cannon',
    name: 'Glass Cannon',
    description: 'Fragility and a critical eye. The hit that lands cleanly is vicious, and so is the reply.',
    requires: [{ tag: 'fragile', count: 1 }, { tag: 'critical', count: 1 }],
    modifiers: [{ stat: 'critMul', op: 'mul', value: 1.2 }],
    effects: [{
      id: 'glass-splash', event: 'onImpact', minSpeed: 420, chance: 0.35,
      actions: [{ type: 'area', amount: 14, radius: 80, scale: 'flat' }],
    }],
  },
  {
    id: 'vampire-circuit',
    name: 'Vampire Circuit',
    description: 'Healing wired into the strike. A greater share of the blow returns as integrity.',
    requires: [{ tag: 'healing', count: 1 }, { tag: 'impact', count: 1 }],
    effects: [{
      id: 'vamp-hit', event: 'onImpact', minSpeed: 300,
      actions: [{ type: 'heal', amount: 0.05, scale: 'dealt' }],
    }],
  },
]

export const SYNERGY_MAP: Record<string, SynergyDef> = Object.fromEntries(
  SYNERGIES.map((s) => [s.id, s]),
)
