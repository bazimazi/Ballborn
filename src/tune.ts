/** Gameplay constants. Physics feel and combat pacing live here so they can be tuned in one place. */
export const TUNE = {
  impactScale: 0.03,
  massAccelExp: 0.8,
  massHopExp: 0.38,
  fixedDt: 1 / 120,
  maxFrame: 1 / 20,
  coyote: 0.12,
  jumpBuffer: 0.11,
  playerHurtLock: 0.42,
  enemyHitLock: 0.16,
  comboWindow: 2.35,
  comboStep: 0.08,
  comboCap: 12,
  roomRegen: 0.08,
  cinderValue: 1,
  baseRadius: 15,
  radiusPerMass: 2.6,
}
