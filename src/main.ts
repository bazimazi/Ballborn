import './styles.css'
import { Game } from './game'

const game = new Game()
let last = performance.now()

function frame(now: number): void {
  const dt = Math.min(0.033, (now - last) / 1000)
  last = now
  game.frame(dt)
  requestAnimationFrame(frame)
}

requestAnimationFrame(frame)
