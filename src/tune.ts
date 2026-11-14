/** Gameplay constants. Physics feel and combat pacing live here so they can be tuned in one place. */
export const TUNE = {
  impactScale: 0.03,
  /**
   * Ram damage grows with mass to this power, not linearly. Linear mass made the
   * heavy core about five times the light one (one-shots against slogs); 0.6
   * keeps heavy clearly harder-hitting (about 1.75x a balanced core) while a
   * light core's speed and crits can still carry a fight. 0.65 is the exponent.
   */
  massImpactExp: 0.65,
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
  comboStep: 0.06,
  comboCap: 12,
  /** Combo at which the ball goes White Hot: every ram is clean, hits harder, and folds shields, for as long as the chain holds. */
  overdriveCombo: 5,
  overdriveDamage: 1.25,
  /** Hits on the Colossus or its rivets add to the combo at most this often (it stands still; it must not be a combo farm). */
  bossComboCooldown: 0.7,
  /** A rolling ball climbs a ledge up to this many px high instead of bonking off its side. */
  stepUp: 40,
  /** Speed kept when rolling up a ledge. */
  stepKeep: 0.93,
  /** Glance recoil is scaled by this. Slow bumps still cost, but a few of them no longer end a run. */
  recoilScale: 0.65,
  /** Seconds a shielded construct needs to turn its shield around after the ball crosses over it. */
  shieldTurn: 0.5,
  /** Seconds a crown hit (or a ram past the shield's break value) leaves the guard down. */
  guardBreak: 1.5,
  baseRadius: 15,
  radiusPerMass: 2.6,
  /** A ram at this share of top speed (or one that kills) is clean: no recoil. */
  cleanRamRatio: 0.55,
  /** Floor for recoil on a dirty ram, as a share of the construct's contact damage. */
  minRecoil: 0.25,
  /** How fast speed above the cap bleeds away, per second. Boosted after abilities and impulses. */
  overspeedDecay: 14,
  overspeedDecayBoosted: 2.5,
  /** Wall kick: how long after touching a wall a hop still kicks off it, the sideways speed (share of top speed), and the hop (share of a floor hop). */
  wallKickWindow: 0.12,
  wallKickSpeed: 0.62,
  wallKickHop: 0.92,
  /** Plow-through: a killing clean ram keeps this share of its speed (less for heavy wrecks). */
  plowDrag: 0.09,
  plowKeepMin: 0.62,
  plowKeepMax: 0.9,
  /** Share of the ability cooldown left after a ram kills. */
  killCooldownKeep: 0.55,
  /** Integrity share under which onLowHp effects fire. */
  lowHp: 0.32,
}
