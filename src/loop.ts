/**
 * Fixed-step accumulator. Real time (scaled by game speed) accumulates and is
 * spent in whole ticks, at most `maxSteps` per rendered frame; anything beyond
 * that is dropped so a long hitch never spirals. The same inputs per tick give
 * the same result whatever the display refresh rate.
 */
export class FixedStepper {
  acc = 0

  constructor(readonly dt: number, readonly maxSteps: number) {}

  /**
   * Add a frame's worth of time and run ticks. `tick(first)` is told whether it
   * is the first tick of this frame (the only one that sees pressed edges) and
   * returns true to stop early (for example when a room ends).
   */
  advance(frameDt: number, speed: number, maxFrame: number, tick: (first: boolean) => boolean): number {
    this.acc += Math.min(Math.max(0, frameDt), maxFrame) * speed
    let steps = 0
    while (this.acc >= this.dt && steps < this.maxSteps) {
      const stop = tick(steps === 0)
      this.acc -= this.dt
      steps++
      if (stop) break
    }
    if (steps >= this.maxSteps) this.acc = Math.min(this.acc, this.dt)
    return steps
  }

  /** Interpolation factor for rendering between the last two ticks. */
  get alpha(): number {
    return Math.max(0, Math.min(1, this.acc / this.dt))
  }

  reset(): void {
    this.acc = 0
  }
}
