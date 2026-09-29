import type { Btn } from './save'
import { ALT_KEYS, DEFAULT_BINDINGS } from './save'

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

export interface MenuInput {
  up: boolean
  down: boolean
  left: boolean
  right: boolean
  confirm: boolean
  back: boolean
}

export const IDLE: Readonly<FrameInput> = Object.freeze({
  x: 0, y: 0, hopHeld: false, hopPressed: false, abilityPressed: false, pausePressed: false,
  buildPressed: false, confirmPressed: false, mx: 0, my: 0, mouseThrust: false,
})

const STICK_DEADZONE = 0.25

/** Radial deadzone with rescaling, so small drift is ignored and full tilt still reaches 1. */
export function applyDeadzone(x: number, y: number, dz = STICK_DEADZONE): { x: number; y: number } {
  const mag = Math.hypot(x, y)
  if (mag < dz) return { x: 0, y: 0 }
  const scaled = Math.min(1, (mag - dz) / (1 - dz))
  return { x: (x / mag) * scaled, y: (y / mag) * scaled }
}

type PadState = { hop: boolean; ability: boolean; pause: boolean; build: boolean; up: boolean; down: boolean; left: boolean; right: boolean; a: boolean; b: boolean }

const EMPTY_PAD: PadState = { hop: false, ability: false, pause: false, build: false, up: false, down: false, left: false, right: false, a: false, b: false }

export type TouchAction = 'hop' | 'ability' | 'pause' | 'build'

/**
 * Keyboard, mouse, and gamepad sampling with two contexts. In 'play', held
 * keys steer and pressed actions are latched until a simulation tick consumes
 * them. In 'menu', the browser owns focus and Tab; the gamepad drives focus.
 */
export class Input {
  context: 'play' | 'menu' = 'menu'
  keys = new Set<string>()
  private edges = new Set<string>()
  /** Gameplay actions pressed since the last simulation tick. */
  private latched = { hop: false, ability: false }
  mx = 0
  my = 0
  mouseLeft = false
  private pad: PadState = { ...EMPTY_PAD }
  private padPrev: PadState = { ...EMPTY_PAD }
  private menuRepeat = { dir: '', t: 0 }
  private lastFrame = 0
  stick = { x: 0, y: 0 }
  padConnected = false
  rebinding: Btn | null = null
  bindings: Record<Btn, string>
  onRebound: ((btn: Btn, code: string | null) => void) | null = null
  onFocusLost: (() => void) | null = null
  onPadChange: ((connected: boolean) => void) | null = null
  /** On-screen controls: an analog stick and a held hop button. */
  touch = { x: 0, y: 0, hop: false }
  private touchEdges = new Set<TouchAction>()
  /** True while the player is on a touch screen; the last input device decides. */
  touchMode = false
  onTouchMode: ((on: boolean) => void) | null = null
  /** Keys the browser should not act on during play (scrolling, focus moves). */
  private static PLAY_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab']

  constructor(bindings: Record<Btn, string> | undefined, canvas: HTMLCanvasElement | null) {
    this.bindings = { ...DEFAULT_BINDINGS, ...bindings }
    window.addEventListener('keydown', (e) => this.keydown(e))
    window.addEventListener('keyup', (e) => this.keys.delete(e.code))
    window.addEventListener('blur', () => this.loseFocus())
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.loseFocus()
    })
    window.addEventListener('pointerdown', (e) => this.setTouchMode(e.pointerType === 'touch'), true)
    window.addEventListener('mousemove', (e) => {
      this.mx = e.clientX
      this.my = e.clientY
    })
    if (canvas) {
      canvas.addEventListener('pointerdown', (e) => {
        this.mx = e.clientX
        this.my = e.clientY
        // Fingers steer with the on-screen stick; only a mouse or pen steers toward the pointer.
        if (e.pointerType === 'touch') return
        if (e.button === 0) {
          this.mouseLeft = true
          try {
            canvas.setPointerCapture(e.pointerId)
          } catch {
            // Capture is a nicety; thrust still works without it.
          }
        }
        if (e.button === 2 && this.context === 'play') {
          this.latched.ability = true
        }
      })
      const release = (e: PointerEvent) => {
        if (e.button === 0 || e.type === 'pointercancel' || e.type === 'lostpointercapture') this.mouseLeft = false
      }
      canvas.addEventListener('pointerup', release)
      canvas.addEventListener('pointercancel', release)
      canvas.addEventListener('lostpointercapture', release)
      canvas.addEventListener('contextmenu', (e) => e.preventDefault())
    }
    window.addEventListener('gamepadconnected', () => {
      this.padConnected = true
      this.onPadChange?.(true)
    })
    window.addEventListener('gamepaddisconnected', () => {
      this.padConnected = !!this.firstPad()
      this.pad = { ...EMPTY_PAD }
      this.stick = { x: 0, y: 0 }
      this.onPadChange?.(false)
    })
  }

  private keydown(e: KeyboardEvent): void {
    if (this.rebinding) {
      e.preventDefault()
      const btn = this.rebinding
      this.rebinding = null
      // Escape cancels a rebind (unless the pause key itself is being bound).
      if (e.code === 'Escape' && btn !== 'pause') {
        this.onRebound?.(btn, null)
        return
      }
      this.onRebound?.(btn, e.code)
      return
    }
    if (this.context === 'play' && Input.PLAY_KEYS.includes(e.code)) e.preventDefault()
    if (e.repeat) return
    this.setTouchMode(false)
    if (!this.keys.has(e.code)) {
      this.edges.add(e.code)
      if (this.context === 'play') {
        if (this.matches('up', e.code)) this.latched.hop = true
        if (this.matches('ability', e.code)) this.latched.ability = true
      }
    }
    this.keys.add(e.code)
  }

  private matches(btn: Btn, code: string): boolean {
    return this.bindings[btn] === code || ALT_KEYS[btn].includes(code)
  }

  private held(btn: Btn): boolean {
    if (this.keys.has(this.bindings[btn])) return true
    return ALT_KEYS[btn].some((k) => this.keys.has(k))
  }

  private pressed(btn: Btn): boolean {
    if (this.edges.has(this.bindings[btn])) return true
    return ALT_KEYS[btn].some((k) => this.edges.has(k))
  }

  /** Forget everything held or pressed: focus loss, pausing, and screen changes. */
  reset(): void {
    this.keys.clear()
    this.edges.clear()
    this.latched = { hop: false, ability: false }
    this.mouseLeft = false
    this.touch = { x: 0, y: 0, hop: false }
    this.touchEdges.clear()
  }

  setTouchMode(on: boolean): void {
    if (this.touchMode === on) return
    this.touchMode = on
    this.onTouchMode?.(on)
  }

  /** A touch button went down or up. Pause and build act on press only. */
  touchButton(action: TouchAction, down: boolean): void {
    if (action === 'hop') {
      if (down && !this.touch.hop && this.context === 'play') this.latched.hop = true
      this.touch.hop = down
    } else if (down) {
      if (action === 'ability') {
        if (this.context === 'play') this.latched.ability = true
      } else this.touchEdges.add(action)
    }
  }

  /** The on-screen stick, each axis in -1..1 with the deadzone already applied. */
  touchStick(x: number, y: number): void {
    this.touch.x = x
    this.touch.y = y
  }

  private loseFocus(): void {
    this.reset()
    this.onFocusLost?.()
  }

  setContext(context: 'play' | 'menu'): void {
    if (this.context === context) return
    this.context = context
    this.reset()
  }

  sample(): FrameInput {
    this.pollPad()
    const t = this.touch
    const left = this.held('left') || this.stick.x < -0.3 || this.pad.left
    const right = this.held('right') || this.stick.x > 0.3 || this.pad.right
    const up = this.held('up') || this.pad.hop || t.hop
    const down = this.held('down') || this.stick.y > 0.55 || this.pad.down || t.y > 0.6
    // Pushing the touch stick up aims abilities upward without hopping.
    const aimUp = t.y < -0.6
    let x = (right ? 1 : 0) - (left ? 1 : 0)
    // Analog steering wins when a stick is the only input.
    const analog = t.x !== 0 ? t.x : this.stick.x
    if (analog !== 0 && (x === 0 || Math.sign(analog) === x) && !this.held('left') && !this.held('right')) x = analog
    return {
      x,
      y: (down ? 1 : 0) - (up || aimUp ? 1 : 0),
      hopHeld: up,
      hopPressed: this.latched.hop,
      abilityPressed: this.latched.ability,
      pausePressed: this.pressed('pause') || (this.pad.pause && !this.padPrev.pause) || this.touchEdges.has('pause'),
      buildPressed: this.pressed('build') || (this.pad.build && !this.padPrev.build) || this.touchEdges.has('build'),
      confirmPressed: this.edges.has('Enter'),
      mx: this.mx,
      my: this.my,
      mouseThrust: this.mouseLeft,
    }
  }

  /** Called after at least one simulation tick has seen the latched actions. */
  consumeActions(): void {
    this.latched = { hop: false, ability: false }
  }

  /** Gamepad-driven menu navigation, with hold-to-repeat on directions. */
  sampleMenu(now: number): MenuInput {
    const dt = this.lastFrame ? Math.min(0.1, (now - this.lastFrame) / 1000) : 0
    this.lastFrame = now
    const out: MenuInput = { up: false, down: false, left: false, right: false, confirm: false, back: false }
    const p = this.pad
    const prev = this.padPrev
    const dir = p.up || this.stick.y < -0.5 ? 'up' : p.down || this.stick.y > 0.5 ? 'down' : p.left || this.stick.x < -0.5 ? 'left' : p.right || this.stick.x > 0.5 ? 'right' : ''
    if (dir && dir !== this.menuRepeat.dir) {
      out[dir as 'up'] = true
      this.menuRepeat = { dir, t: 0.38 }
    } else if (dir) {
      this.menuRepeat.t -= dt
      if (this.menuRepeat.t <= 0) {
        out[dir as 'up'] = true
        this.menuRepeat.t = 0.11
      }
    } else this.menuRepeat = { dir: '', t: 0 }
    out.confirm = p.a && !prev.a
    out.back = p.b && !prev.b
    return out
  }

  endFrame(): void {
    this.edges.clear()
    this.touchEdges.clear()
    this.padPrev = { ...this.pad }
  }

  private firstPad(): Gamepad | null {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []
    for (const p of pads ?? []) if (p && p.connected) return p
    return null
  }

  private pollPad(): void {
    const pad = this.firstPad()
    if (!pad) {
      this.stick = { x: 0, y: 0 }
      this.pad = { ...EMPTY_PAD }
      return
    }
    this.padConnected = true
    const stick = applyDeadzone(pad.axes[0] ?? 0, pad.axes[1] ?? 0)
    this.stick = stick
    const b = (i: number) => !!pad.buttons[i]?.pressed
    const next: PadState = {
      hop: b(0) || b(12),
      ability: b(1) || b(2) || b(5),
      pause: b(9),
      build: b(8),
      up: b(12),
      down: b(13),
      left: b(14),
      right: b(15),
      a: b(0),
      b: b(1),
    }
    if (this.context === 'play') {
      if (next.hop && !this.pad.hop) this.latched.hop = true
      if (next.ability && !this.pad.ability) this.latched.ability = true
    }
    this.pad = next
  }
}
