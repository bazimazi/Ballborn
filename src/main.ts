import './styles.css'
import { Game } from './game'
import { ROOM_MAP } from './data/rooms'

function fail(message: string): void {
  const screen = document.getElementById('screen')
  if (screen) {
    screen.innerHTML = `<div class="panel stack"><div class="kicker">Ballborn cannot start</div><h2>Something in this browser is missing</h2><p></p></div>`
    screen.querySelector('p')!.textContent = message
  }
}

/** `roundRect` is missing on iOS 15 and older Android WebViews; without it the first damaged construct would throw. */
function polyfillRoundRect(): void {
  const P = (typeof CanvasRenderingContext2D !== 'undefined' ? CanvasRenderingContext2D.prototype : null) as
    | (CanvasRenderingContext2D & { roundRect?: unknown })
    | null
  if (!P || typeof P.roundRect === 'function') return
  P.roundRect = function (this: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radii?: number | number[]) {
    const r0 = Array.isArray(radii) ? (radii[0] ?? 0) : (radii ?? 0)
    const r = Math.max(0, Math.min(+r0 || 0, Math.abs(w) / 2, Math.abs(h) / 2))
    this.moveTo(x + r, y)
    this.arcTo(x + w, y, x + w, y + h, r)
    this.arcTo(x + w, y + h, x, y + h, r)
    this.arcTo(x, y + h, x, y, r)
    this.arcTo(x, y, x + w, y, r)
    this.closePath()
  } as CanvasRenderingContext2D['roundRect']
}

try {
  polyfillRoundRect()
  const game = new Game()
  // Automation hook for the browser smoke test only.
  if (new URLSearchParams(location.search).has('debug')) {
    const w = window as unknown as { ballborn: Game; ballbornRooms: typeof ROOM_MAP }
    w.ballborn = game
    w.ballbornRooms = ROOM_MAP
  }
  let last = performance.now()
  let errors = 0
  const frame = (now: number): void => {
    // Re-arm first: one bad frame must never stop the loop for good.
    requestAnimationFrame(frame)
    // Very long gaps (a backgrounded tab) are dropped; the game pauses on focus loss anyway.
    const dt = Math.min(0.25, Math.max(0, (now - last) / 1000))
    last = now
    try {
      game.frame(dt, now)
    } catch (err) {
      if (errors++ < 5) console.error(err)
    }
  }
  requestAnimationFrame(frame)
} catch (err) {
  fail(err instanceof Error ? err.message : String(err))
}
