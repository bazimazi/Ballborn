import './styles.css'
import { Game } from './game'

function fail(message: string): void {
  const screen = document.getElementById('screen')
  if (screen) {
    screen.innerHTML = `<div class="panel stack"><div class="kicker">Ballborn cannot start</div><h2>Something in this browser is missing</h2><p></p></div>`
    screen.querySelector('p')!.textContent = message
  }
}

try {
  const game = new Game()
  // Automation hook for the browser smoke test only.
  if (new URLSearchParams(location.search).has('debug')) (window as unknown as { ballborn: Game }).ballborn = game
  let last = performance.now()
  const frame = (now: number): void => {
    // Very long gaps (a backgrounded tab) are dropped; the game pauses on focus loss anyway.
    const dt = Math.min(0.25, Math.max(0, (now - last) / 1000))
    last = now
    game.frame(dt, now)
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
} catch (err) {
  fail(err instanceof Error ? err.message : String(err))
}
