import { ROOM_MAP } from '../src/data/rooms'
import { IDLE, type FrameInput } from '../src/input'
import { buildFor, createRun, STARTER_IDS } from '../src/run'
import { Simulation, type SimListeners, type SimOptions } from '../src/sim'
import type { CompiledBuild, RoomTemplate, Slot } from '../src/types'
import { mulberry32 } from '../src/util'

export const BUILDS: Record<string, Record<Slot, string | null>> = {
  balanced: { ...STARTER_IDS },
  heavy: { core: 'heavy-core', shell: 'armored-shell', momentum: 'momentum-engine', impact: 'crush-impact', ability: 'ground-slam', passive: 'combo-engine' },
  light: { core: 'light-core', shell: 'spiked-shell', momentum: 'gyro-stabilizer', impact: 'crush-impact', ability: 'dash', passive: 'momentum-harvest' },
  rebound: { core: 'balanced-core', shell: 'rubber-shell', momentum: 'rebound-engine', impact: 'crush-impact', ability: 'dash', passive: 'combo-engine' },
  fire: { core: 'balanced-core', shell: 'flaming-shell', momentum: 'momentum-engine', impact: 'fire-impact', ability: 'dash', passive: 'chain-reaction' },
  magnetic: { core: 'magnetic-core', shell: 'rubber-shell', momentum: 'momentum-engine', impact: 'lightning-impact', ability: 'magnet-pull', passive: 'combo-engine' },
}

export function build(name: keyof typeof BUILDS | Record<Slot, string | null>): CompiledBuild {
  const ids = typeof name === 'string' ? BUILDS[name]! : name
  return buildFor(ids, [])
}

export function sim(room: string | RoomTemplate, b: CompiledBuild = build('balanced'), opts: Partial<SimOptions> = {}, listeners: SimListeners = {}): Simulation {
  const template = typeof room === 'string' ? ROOM_MAP[room]! : room
  return new Simulation(template, b, {
    hp: b.stats.maxHp, energy: 100, heat: 0, depth: 0, curse: false, gentle: false, god: false, lab: false, seed: 123,
    fx: mulberry32(999),
    ...opts,
  }, listeners)
}

export function input(p: Partial<FrameInput> = {}): FrameInput {
  return { ...IDLE, ...p }
}

export function run(s: Simulation, ticks: number, f: (tick: number) => Partial<FrameInput> = () => ({})): void {
  for (let i = 0; i < ticks && !s.done; i++) s.step(input(f(s.tick)))
}

export function seconds(n: number): number {
  return Math.round(n * 120)
}

export { createRun }
