import type { AchievementDef, BiomeDef, FusionRecipe, HeatDef, RunMod } from '../types'
import { deepFreeze } from '../util'

export const BIOME: BiomeDef = {
  id: 'foundry',
  name: 'The Foundry',
  mechanic: 'Crushers, slag pits, and conveyor lines. Heat is a hazard you can bounce out of if you do not sit in it.',
  skyTop: '#14110f',
  skyBottom: '#2a2118',
  girder: '#3a332c',
  metal: '#6a6258',
  metalHi: '#d9cbb8',
  lava: '#ff4a1c',
  ember: '#ffb15a',
}

export const ACHIEVEMENTS: AchievementDef[] = deepFreeze([
  { id: 'ignition', name: 'Ignition', description: 'Clear a room.', target: 1, scrap: 6 },
  { id: 'first-blood', name: 'First Blood', description: 'Break a construct with the ball.', target: 1, scrap: 4 },
  { id: 'combo-forge', name: 'Cadence', description: 'Reach a 10-hit combo.', target: 10, scrap: 10, unlocks: 'air-burst' },
  { id: 'terminal-velocity', name: 'Terminal Velocity', description: 'Reach extreme speed.', target: 1200, scrap: 12, unlocks: 'turbo-coil' },
  { id: 'ricochet', name: 'Returned to Sender', description: 'Break a construct with a reflected projectile.', target: 1, scrap: 14, unlocks: 'conductive-shell' },
  { id: 'patient-steel', name: 'Patient Steel', description: 'Defeat the Iron Colossus without using an ability.', target: 1, scrap: 20 },
  { id: 'pure-collision', name: 'Only the Ball', description: 'Defeat the Iron Colossus with ram damage alone: no ability, explosion, chain, burn, or reflected shot may hurt anything in the hold.', target: 1, scrap: 20, unlocks: 'second-wind' },
  { id: 'common-stock', name: 'Common Stock', description: 'Win a run without ever fitting a non-common component (evolutions and fusions count).', target: 1, scrap: 18, embers: 1 },
  { id: 'three-flames', name: 'Three Flames', description: 'Win a run with three Fire components.', target: 1, scrap: 16, embers: 1 },
  { id: 'unmarked', name: 'Unmarked', description: 'Clear an elite room or the boss without taking damage.', target: 1, scrap: 18 },
  { id: 'scholar', name: 'Field Notes', description: 'Discover 5 synergies.', target: 5, scrap: 15, unlocks: 'chain-reaction' },
  { id: 'heat-tempered', name: 'Heat Tempered', description: 'Win at Forge Heat II or higher.', target: 1, scrap: 24, embers: 1 },
  { id: 'slam-poetry', name: 'Stamp', description: 'Break a construct with a Ground Slam.', target: 1, scrap: 8 },
  { id: 'heavy-hand', name: 'Heavy Hand', description: 'Deal 100 damage in a single collision.', target: 100, scrap: 10 },
])

export const FUSIONS: FusionRecipe[] = deepFreeze([
  {
    id: 'singularity',
    name: 'Singularity Mass',
    requires: ['heavy-core', 'crush-impact'],
    result: 'singularity-mass',
    into: 'core',
    description: 'Fold the Heavy Core and Crush Impact into one siege heart. The impact slot is consumed.',
  },
  {
    id: 'electromagnetic',
    name: 'Electromagnetic Heart',
    requires: ['magnetic-core', 'lightning-impact'],
    result: 'electromagnetic-heart',
    into: 'core',
    description: 'Fuse the Magnetic Core with Lightning Impact. Shots and sparks share a spine.',
  },
  {
    id: 'pinball',
    name: 'Pinball Heart',
    requires: ['rubber-shell', 'rebound-engine'],
    result: 'pinball-heart',
    into: 'shell',
    description: 'Anneal the Rubber Shell with the Rebound Engine. The momentum slot is consumed.',
  },
])

export const OVERCHARGE: RunMod = deepFreeze({
  id: 'overcharge',
  name: 'Overcharged Core',
  description: 'Enormous top speed for the rest of the run. The ball is harder to settle.',
  modifiers: [
    { stat: 'maxSpeed', op: 'mul', value: 1.26 },
    { stat: 'airControl', op: 'mul', value: 0.72 },
    { stat: 'friction', op: 'mul', value: 0.7 },
    { stat: 'accel', op: 'mul', value: 1.08 },
  ],
  effects: [],
  tags: ['momentum'],
})

export const HEATS: HeatDef[] = deepFreeze([
  {
    id: 0, name: 'Forge Heat 0', detail: 'The foundry as it was built. Fair rooms, fair constructs.',
    effects: ['No modifiers.'],
    enemyHp: 1, enemyDamage: 1, attackRate: 1, eliteHp: 1, roomRecovery: 0.1, geysers: false,
    shopPrice: 1, gravity: 1, bossHp: 1, bossTempo: 0, healDrops: 1,
  },
  {
    id: 1, name: 'Forge Heat I', detail: 'Constructs work faster. Recovery between rooms is thinner.',
    effects: ['Constructs shoot and attack 15% more often.', 'Room recovery drops from 10% to 8% of integrity.', 'Construct integrity +5%.'],
    enemyHp: 1.05, enemyDamage: 1, attackRate: 1.15, eliteHp: 1, roomRecovery: 0.08, geysers: false,
    shopPrice: 1, gravity: 1, bossHp: 1.1, bossTempo: 0.12, healDrops: 1,
  },
  {
    id: 2, name: 'Forge Heat II', detail: 'Combat rooms weep slag. Elites are heavier. Shops charge more.',
    effects: ['Everything in Heat I.', 'Combat and elite rooms gain two slag geysers.', 'Elites +15% integrity. Constructs hit 8% harder.', 'Shop prices +18%.'],
    enemyHp: 1.05, enemyDamage: 1.08, attackRate: 1.15, eliteHp: 1.15, roomRecovery: 0.07, geysers: true,
    shopPrice: 1.18, gravity: 1, bossHp: 1.2, bossTempo: 0.24, healDrops: 1,
  },
  {
    id: 3, name: 'Forge Heat III', detail: 'Gravity sits heavier. The Colossus is quicker. Healing is scarce.',
    effects: ['Everything in Heat II.', 'Gravity +8%: shorter hops for every build.', 'The Colossus attacks 0.36 s sooner.', 'Healing drops are halved. Room recovery 6%.'],
    enemyHp: 1.1, enemyDamage: 1.12, attackRate: 1.2, eliteHp: 1.2, roomRecovery: 0.06, geysers: true,
    shopPrice: 1.3, gravity: 1.08, bossHp: 1.3, bossTempo: 0.36, healDrops: 0.5,
  },
])

export function heatOf(id: number): HeatDef {
  return HEATS[Math.max(0, Math.min(HEATS.length - 1, Math.floor(id)))]!
}
