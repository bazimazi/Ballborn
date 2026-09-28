/** Gameplay constants. Physics feel and combat pacing live here so they can be tuned in one place. */
export const TUNE = {
  impactScale: 0.03,
  massAccelExp: 0.8,
  massHopExp: 0.38,
  /** Every gameplay tick is exactly this long, whatever the display refresh rate. */
  fixedDt: 1 / 120,
  /** Longest real frame the loop will catch up on. Longer hitches drop time instead of spiralling. */
  maxFrame: 1 / 10,
  coyote: 0.12,
  jumpBuffer: 0.11,
  playerHurtLock: 0.42,
  enemyHitLock: 0.16,
  comboWindow: 2.35,
  comboStep: 0.08,
  comboCap: 12,
  baseRadius: 15,
  radiusPerMass: 2.6,
  /** A ram at this share of top speed (or one that kills) is clean: no recoil. */
  cleanRamRatio: 0.55,
  /** Floor for recoil on a dirty ram, as a share of the construct's contact damage. */
  minRecoil: 0.25,
  /** How fast speed above the cap bleeds away, per second. Boosted after abilities and impulses. */
  overspeedDecay: 14,
  overspeedDecayBoosted: 2.5,
  /** Integrity share under which onLowHp effects fire. */
  lowHp: 0.32,
}
