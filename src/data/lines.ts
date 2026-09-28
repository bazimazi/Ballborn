import { deepFreeze } from '../util'

/**
 * The Foundry's foreman speaks once per run summary. The ball is scrap that
 * keeps being recast: each failure is ore for the next pour.
 */
export const FOREMAN = deepFreeze({
  firstDeath: 'First pour cracked. They all do. Sweep it back into the crucible.',
  death: [
    'Scrap is only ore that has not decided yet.',
    'The mould remembers what broke. Pour again.',
    'Good slag. Hot enough to try something different.',
    'The Colossus was built from balls like you. So were you.',
  ],
  firstWin: 'You broke the thing that breaks balls. The foundry will run hotter now.',
  win: [
    'Another Colossus in the scrap pile. The furnace wants a stranger shape.',
    'Clean pour. Now make one that should not work.',
  ],
  abandon: 'Left on the floor. It will still melt down into something.',
} as const)

export function foremanLine(kind: 'death' | 'victory' | 'abandon', deaths: number, wins: number, seed: number): string {
  if (kind === 'abandon') return FOREMAN.abandon
  if (kind === 'victory') return wins <= 1 ? FOREMAN.firstWin : FOREMAN.win[seed % FOREMAN.win.length]!
  return deaths <= 1 ? FOREMAN.firstDeath : FOREMAN.death[seed % FOREMAN.death.length]!
}
