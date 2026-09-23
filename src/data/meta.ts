import type { AchievementDef, BiomeDef, FusionRecipe, RunMod } from '../types'

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

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'ignition', name: 'Ignition', description: 'Clear a room.', target: 1, scrap: 6 },
  { id: 'first-blood', name: 'First Blood', description: 'Break a construct with the ball.', target: 1, scrap: 4 },
  { id: 'combo-forge', name: 'Cadence', description: 'Reach a 10-hit combo.', target: 10, scrap: 10, unlocks: 'air-burst' },
  { id: 'terminal-velocity', name: 'Terminal Velocity', description: 'Reach extreme speed.', target: 1200, scrap: 12, unlocks: 'turbo-coil' },
  { id: 'ricochet', name: 'Returned to Sender', description: 'Break a construct with a reflected projectile.', target: 1, scrap: 14, unlocks: 'conductive-shell' },
  { id: 'patient-steel', name: 'Patient Steel', description: 'Defeat the Iron Colossus without using an ability.', target: 1, scrap: 20 },
  { id: 'pure-collision', name: 'Only the Ball', description: 'Defeat the Iron Colossus with collision damage alone.', target: 1, scrap: 20, unlocks: 'second-wind' },
  { id: 'common-stock', name: 'Common Stock', description: 'Win a run using only common components.', target: 1, scrap: 18, embers: 1 },
  { id: 'three-flames', name: 'Three Flames', description: 'Win a run with three Fire components.', target: 1, scrap: 16, embers: 1 },
  { id: 'unmarked', name: 'Unmarked', description: 'Clear an elite room or the boss without taking damage.', target: 1, scrap: 18 },
  { id: 'scholar', name: 'Field Notes', description: 'Discover 5 synergies.', target: 5, scrap: 15, unlocks: 'chain-reaction' },
  { id: 'heat-tempered', name: 'Heat Tempered', description: 'Win at Forge Heat II or higher.', target: 1, scrap: 24, embers: 1 },
  { id: 'slam-poetry', name: 'Stamp', description: 'Break a construct with a Ground Slam.', target: 1, scrap: 8 },
  { id: 'heavy-hand', name: 'Heavy Hand', description: 'Deal 100 damage in a single collision.', target: 100, scrap: 10 },
]

export const FUSIONS: FusionRecipe[] = [
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
]

export const OVERCHARGE: RunMod = {
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
}

export const HEATS = [
  { id: 0, name: 'Forge Heat 0', detail: 'The foundry as it was built. Fair rooms, fair constructs.' },
  { id: 1, name: 'Forge Heat I', detail: 'Constructs are tougher and hit harder. Room recovery is thinner.' },
  { id: 2, name: 'Forge Heat II', detail: 'Elites swell. Combat rooms weep extra slag. Shops charge more.' },
  { id: 3, name: 'Forge Heat III', detail: 'Gravity sits heavier. The Colossus is quicker. Healing is scarce.' },
]
