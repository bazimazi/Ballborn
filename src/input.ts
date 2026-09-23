import type { Btn } from './save'
import { DEFAULT_BINDINGS } from './save'

export interface FrameInput {
  x: number
  y: number
  hopHeld: boolean
  hopPressed: boolean
  abilityPressed: boolean
  pausePressed: boolean
  buildPressed: boolean
  confirmPressed: boolean
  mx: number
  my: number
  mouseThrust: boolean
}

export class Input {
  keys = new Set<string>()
  private edges = new Set<string>()
  mx = 0
  my = 0
  mouseLeft = false
  mouseRightEdge = false
  private padPrev = { hop: false, ability: false, pause: false, build: false }
  stick = { x: 0, y: 0 }
  padHop = false
  padHopEdge = false
  padAbilityEdge = false
  padPauseEdge = false
  padBuildEdge = false
  rebinding: Btn | null = null
  bindings: Record<Btn, string>
  onRebound: ((btn: Btn, code: string) => void) | null = null

  constructor(bindings?: Record<Btn, string>) {
    this.bindings = { ...DEFAULT_BINDINGS, ...bindings }
    window.addEventListener('keydown', (e) => {
      if (this.rebinding) {
        e.preventDefault()
        const btn = this.rebinding
        this.rebinding = null
        this.bindings[btn] = e.code
        this.onRebound?.(btn, e.code)
        return
      }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'].includes(e.code)) e.preventDefault()
      if (!this.keys.has(e.code)) this.edges.add(e.code)
      this.keys.add(e.code)
    })
    window.addEventListener('keyup', (e) => this.keys.delete(e.code))
    window.addEventListener('blur', () => {
      this.keys.clear()
      this.mouseLeft = false
    })
    window.addEventListener('mousemove', (e) => {
      this.mx = e.clientX
      this.my = e.clientY
    })
    window.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mouseLeft = true
      if (e.button === 2) this.mouseRightEdge = true
    })
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseLeft = false
    })
    window.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  sample(): FrameInput {
    this.pollPad()
    const b = this.bindings
    const left = this.keys.has(b.left) || this.keys.has('ArrowLeft') || this.stick.x < -0.35
    const right = this.keys.has(b.right) || this.keys.has('ArrowRight') || this.stick.x > 0.35
    const up = this.keys.has(b.up) || this.keys.has('ArrowUp') || this.keys.has('Space') || this.padHop
    const down = this.keys.has(b.down) || this.keys.has('ArrowDown') || this.stick.y > 0.55
    let x = (right ? 1 : 0) - (left ? 1 : 0)
    if (Math.abs(this.stick.x) > 0.35 && x === 0) x = this.stick.x
    if (Math.abs(this.stick.x) > 0.35 && Math.sign(this.stick.x) === x) x = this.stick.x
    const hopPressed = this.edges.has(b.up) || this.edges.has('ArrowUp') || this.edges.has('Space') || this.padHopEdge
    const abilityPressed = this.edges.has(b.ability) || this.edges.has('KeyF') || this.mouseRightEdge || this.padAbilityEdge
    const pausePressed = this.edges.has(b.pause) || this.padPauseEdge
    const buildPressed = this.edges.has(b.build) || this.padBuildEdge
    const confirmPressed = this.edges.has('Enter')
    return {
      x,
      y: (down ? 1 : 0) - (up ? 1 : 0),
      hopHeld: up,
      hopPressed,
      abilityPressed,
      pausePressed,
      buildPressed,
      confirmPressed,
      mx: this.mx,
      my: this.my,
      mouseThrust: this.mouseLeft,
    }
  }

  endFrame(): void {
    this.edges.clear()
    this.mouseRightEdge = false
    this.padHopEdge = false
    this.padAbilityEdge = false
    this.padPauseEdge = false
    this.padBuildEdge = false
  }

  private pollPad(): void {
    const pads = navigator.getGamepads?.()
    const pad = pads ? Array.from(pads).find((p) => p && p.connected) : null
    if (!pad) {
      this.stick.x = 0
      this.stick.y = 0
      this.padHop = false
      return
    }
    const ax = pad.axes[0] ?? 0
    const ay = pad.axes[1] ?? 0
    this.stick.x = Math.abs(ax) > 0.28 ? ax : 0
    this.stick.y = Math.abs(ay) > 0.28 ? ay : 0
    const hop = !!(pad.buttons[0]?.pressed || pad.buttons[12]?.pressed)
    const ability = !!(pad.buttons[1]?.pressed || pad.buttons[2]?.pressed || pad.buttons[5]?.pressed)
    const pause = !!pad.buttons[9]?.pressed
    const build = !!pad.buttons[8]?.pressed
    this.padHop = hop
    this.padHopEdge = hop && !this.padPrev.hop
    this.padAbilityEdge = ability && !this.padPrev.ability
    this.padPauseEdge = pause && !this.padPrev.pause
    this.padBuildEdge = build && !this.padPrev.build
    this.padPrev = { hop, ability, pause, build }
  }
}
