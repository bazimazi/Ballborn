import { artUrl, loadArt } from './assets'
import { AudioBus } from './audio'
import { COMPONENT_MAP } from './data/components'
import { ENEMY_MAP } from './data/enemies'
import { SYNERGY_MAP } from './data/synergies'
import { foremanLine } from './data/lines'
import { ROOM_MAP } from './data/rooms'
import { applyEventChoice, rollEvent, type GameEvent } from './events'
import { Input, type FrameInput, type MenuInput } from './input'
import { FixedStepper } from './loop'
import { dailyKey, dailySeed, GRADE_CINDERS, gradeRoom, gradeStrip, parTime, runScore } from './grade'
import { selfCheckPhysics } from './physics'
import { Juice } from './juice'
import { ballView, CardPreview, drawMenuScene, drawWorld, fitZoom, makeCamera, screenToWorld, updateCamera, viewRect, type Camera } from './render'
import {
  banishOffer,
  buildFor,
  createRun,
  currentBuild,
  currentNode,
  deathTip,
  enterNode,
  generateMap,
  makeOffers,
  makeShop,
  nextIdea,
  pickTemplate,
  restoreRun,
  roomSeed,
  serializeRun,
  type Offer,
  type RunState,
  type SavedRun,
  type ShopItem,
} from './run'
import {
  ALT_KEYS,
  BTNS,
  browserStore,
  bumpAchievement,
  DEFAULT_BINDINGS,
  defaultSave,
  loadSave,
  RUN_KEY,
  SAVE_KEY,
  writeSave,
  type Btn,
  type SaveData,
  type Store,
} from './save'
import { AFFIXES, Simulation, type Affix, type SimListeners } from './sim'
import {
  abandonScrap,
  buyItem,
  commitRoom,
  deathScrap,
  finishNode,
  takeOffer,
  takeSalvage,
  TransactionError,
  victoryScrap,
  type RoomCommit,
} from './transactions'
import { TUNE } from './tune'
import type { HitSource, RoomTemplate, Slot } from './types'
import { SLOTS } from './types'
import { damageLabel, HIT_LABEL, Hud, keyName, presetIds, screenHtml, type RunSummary, type Screen, type View } from './ui'
import { escapeHtml, hypot } from './util'
import { svg, type IconName } from './icons'
import { attachTouchControls } from './touch'

/** Longest catch-up in ticks for one rendered frame (maxFrame at 120 Hz). */
const MAX_STEPS = Math.ceil(TUNE.maxFrame / TUNE.fixedDt)

interface Checkpoint {
  run: SavedRun
  pending: { kind: 'reward'; offers: Offer[] } | { kind: 'shop'; items: ShopItem[] } | { kind: 'event'; event: GameEvent } | null
}

export class Game {
  save: SaveData
  store: Store
  screen: Screen = 'title'
  returnTo: Screen = 'title'
  pauseReturn: Screen = 'play'
  codexTab: View['codexTab'] = 'components'
  run: RunState | null = null
  sim: Simulation | null = null
  offers: Offer[] = []
  shop: ShopItem[] = []
  event: GameEvent | null = null
  prompt = ''
  buildOpen = false
  labPaused = false
  confirmAbandon = false
  confirmErase = false
  labPanel: View['labPanel'] = null
  selectedNode: string | null = null
  heatPick = 0
  seedText = ''
  rebinding: Btn | null = null
  summary: RunSummary | null = null
  cam: Camera = makeCamera()
  readonly juice = new Juice()
  flash = 0
  hitstop = 0
  /** Room entry iris, 0 closed to 1 open. */
  iris = 1
  /** The beat between a room ending and its result screen. */
  private outro: { kind: 'clear' | 'dead'; t: number; dur: number; sim: Simulation } | null = null
  private gateWasOpen = false
  saveWarning = ''
  private stepper = new FixedStepper(TUNE.fixedDt, MAX_STEPS)
  private previews: CardPreview[] = []
  private toasts: { text: string; life: number; kind: string; ico: IconName | null; count: number }[] = []
  private usesAtBoss = 0
  private lab = false
  private abilityWasReady = true
  private hud = new Hud()
  readonly input: Input
  readonly audio = new AudioBus()
  private view: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private screenEl: HTMLElement

  constructor() {
    this.store = browserStore()
    const loaded = loadSave(this.store)
    this.save = loaded.save
    if (loaded.status === 'recovered') this.saveWarning = 'Your save could not be read. It was kept in a backup slot and a fresh save started.'
    if (loaded.status === 'migrated') this.toast('Save updated. Embers you had are now spendable at the Annealing and the Crucible.')
    this.view = document.getElementById('view') as HTMLCanvasElement
    // Every frame paints the whole canvas, so it can be opaque: the compositor then skips blending it with the page.
    const ctx = this.view.getContext('2d', { alpha: false }) ?? this.view.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D is not available in this browser.')
    this.ctx = ctx
    this.screenEl = document.getElementById('screen')!
    this.input = new Input(this.save.settings.bindings, this.view)
    this.input.onRebound = (btn, code) => this.rebound(btn, code)
    this.input.onFocusLost = () => this.onFocusLost()
    this.input.onTouchMode = (on) => {
      document.body.classList.toggle('touch', on)
      this.deferTouchRefresh()
    }
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-icon]'))) el.innerHTML = svg(el.dataset.icon as IconName)
    this.input.onTouchReset = attachTouchControls(this.input, document.getElementById('hud')!)
    this.input.onPadChange = (connected) => {
      this.toast(connected ? 'Controller connected.' : 'Controller disconnected.')
      if (!connected) this.onFocusLost()
    }
    this.screenEl.addEventListener('click', (e) => this.onClick(e))
    this.screenEl.addEventListener('change', (e) => this.onChange(e))
    this.screenEl.addEventListener('input', (e) => this.onInput(e))
    window.addEventListener('keydown', (e) => this.onKey(e))
    window.addEventListener('pointerdown', () => this.audio.resume())
    // Some mobile browsers only unlock audio on the end of a touch.
    window.addEventListener('touchend', () => this.audio.resume(), { passive: true })
    // A hidden tab makes no sound: the rolling hiss and the reverb would otherwise run on in the background.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.audio.suspend()
      else this.audio.resume()
    })
    // Long-press on a menu icon must not open the image menu; pinch must not zoom the page (iOS ignores user-scalable).
    window.addEventListener('contextmenu', (e) => {
      if (!(e.target instanceof HTMLInputElement && e.target.type === 'text')) e.preventDefault()
    })
    document.addEventListener('gesturestart', (e) => e.preventDefault())
    this.trapBack()
    this.screenEl.addEventListener('pointermove', (e) => this.tiltCard(e))
    this.screenEl.addEventListener('pointerout', (e) => this.untiltCard(e))
    loadArt()
    if (!this.writeSave()) this.saveWarning = 'This browser is not letting Ballborn save. Progress lasts until the tab closes.'
    this.applySettings()
    if (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) this.input.setTouchMode(true)
    const errors = selfCheckPhysics()
    if (errors.length) this.toast(errors[0] ?? 'Physics check failed')
    this.refresh()
  }

  // -------------------------------------------------------------------------
  // Frame loop.

  /** One rendered frame. Gameplay advances in fixed ticks; rendering interpolates. */
  frame(realDt: number, now: number): void {
    const playing = this.screen === 'play' && !this.buildOpen
    const labLive = this.lab && this.screen === 'lab' && !this.labPaused
    this.input.setContext(playing || labLive ? 'play' : 'menu')
    const input = this.input.sample()
    // The beat after a room ends is short and already decided: it cannot be paused into.
    if (input.pausePressed && this.screen === 'play' && !this.outro) this.pause()
    else if (input.pausePressed && this.screen === 'lab') this.toggleLabPause()
    // The pause key (or controller Start) also leaves the pause menu, as it does in the lab.
    else if (input.pausePressed && this.screen === 'pause') this.back()
    else if (input.buildPressed && this.screen === 'play' && !this.outro) {
      this.buildOpen = !this.buildOpen
      this.say(this.buildOpen ? 'Build sheet open. Game paused.' : 'Build sheet closed.')
    }
    if (this.input.context === 'menu') this.menuNav(this.input.sampleMenu(now))

    let alpha = 1
    const frozen = this.hitstop > 0
    if ((playing || labLive) && this.sim) {
      if (this.outro) {
        alpha = this.stepper.alpha
        if (playing) this.tickOutro(realDt)
      } else if (this.hitstop > 0) {
        this.hitstop -= realDt
        alpha = this.stepper.alpha
      } else alpha = this.advance(input, realDt)
      const stop = this.juice.takeHitstop()
      if (stop > 0 && this.save.settings.hitPause) this.hitstop = Math.max(this.hitstop, stop)
      this.iris = Math.min(1, this.iris + realDt / 0.6)
    }
    this.flash = Math.max(0, this.flash - realDt * 3)
    this.render(realDt, now, alpha, frozen)
    this.tickToasts(realDt)
    this.input.endFrame()
  }

  /** Run as many fixed ticks as the accumulator holds. Returns the interpolation factor. */
  private advance(input: FrameInput, realDt: number): number {
    const sim = this.sim!
    let mouse: { x: number; y: number } | null = null
    if (input.mouseThrust) {
      const rect = this.view.getBoundingClientRect()
      mouse = screenToWorld(this.cam, input.mx - rect.left, input.my - rect.top, rect.width, rect.height)
    }
    const held = { ...input, hopPressed: false, abilityPressed: false }
    // Pressed edges belong to the first tick only; held input applies to every tick.
    let froze = false
    const steps = this.stepper.advance(realDt, this.save.settings.gameSpeed * this.juice.timeScale, TUNE.maxFrame, (first) => {
      sim.step(first ? input : held, mouse)
      // A hit pause starts on the tick of the hit: the frame freezes on the impact, not a few ticks after it.
      froze = this.hitstop > 0 || (this.save.settings.hitPause && this.juice.hitstopRequest > 0)
      return sim.done || froze
    })
    // Time banked for the ticks skipped by the freeze is dropped, or it would run as a burst when the freeze ends.
    if (froze) this.stepper.acc = Math.min(this.stepper.acc, TUNE.fixedDt * 0.999)
    // Edges pressed during a frame that ran no tick stay latched for the next one.
    if (steps > 0) this.input.consumeActions()
    if (this.run && !this.lab) {
      const speed = hypot(sim.ball.vx, sim.ball.vy)
      if (speed > this.run.maxSpeed) {
        this.run.maxSpeed = speed
        this.save.stats.bestSpeed = Math.max(this.save.stats.bestSpeed, speed)
        this.grant(bumpAchievement(this.save, 'terminal-velocity', speed, 'max'))
      }
    }
    const ready = sim.abilityBlock() === null
    if (ready && !this.abilityWasReady) this.audio.abilityReady()
    this.abilityWasReady = ready
    this.prompt = this.tutorialPrompt()
    if (sim.exitOpen && !this.gateWasOpen && !this.lab && !sim.done) this.onGateOpen(sim)
    this.gateWasOpen = sim.exitOpen
    if (sim.done && !this.lab) this.startOutro(sim)
    return this.stepper.alpha
  }

  private render(dt: number, now: number, alpha: number, frozen: boolean): void {
    const resized = this.resize(dt)
    const w = this.view.clientWidth
    const h = this.view.clientHeight
    const s = this.save.settings
    const juice = this.juice
    juice.settings = { shake: s.screenShake, particles: s.particles, motion: s.cameraMotion, hitPause: s.hitPause }
    const inWorld = !!this.sim && (this.screen === 'play' || this.screen === 'pause' || this.lab)
    if (inWorld && this.sim) {
      const moving = this.screen !== 'pause' && !this.buildOpen && !this.labPaused
      // Paused, nothing moves: keep the last frame instead of repainting (and re-blurring the panel over it) every frame.
      const still = !moving && this.stillDrawn === this.sim && !resized
      this.stillDrawn = moving ? null : this.sim
      if (moving) {
        updateCamera(this.cam, this.sim, dt, w, h, s.cameraMotion, alpha, this.cameraEdgePad(w, h))
        const b = ballView(this.sim, alpha)
        juice.update(dt, this.sim, viewRect(this.cam, w, h), frozen, b.x, b.y)
        const off = juice.shakeOffset()
        this.cam.shakeX = off.x
        this.cam.shakeY = off.y
        this.cam.rot = off.rot
      }
      this.sim.fxLevel = s.particles * (this.input.touchMode ? 0.7 : 1)
      const outro = this.outro ? { kind: this.outro.kind, t: this.outro.t / this.outro.dur } : null
      if (!still) {
        drawWorld(this.ctx, this.sim, this.cam, w, h, {
          alpha, particles: s.particles, colorblind: s.colorblind, contrast: s.highContrast, flash: s.flashes ? this.flash : 0,
          motion: s.cameraMotion, juice, time: now / 1000, iris: s.cameraMotion ? this.iris : 1, outro, coinTarget: this.coinTarget(w, resized),
        })
      }
    } else {
      this.stillDrawn = null
      juice.update(dt, null, { x: 0, y: 0, w, h }, false, 0, 0)
      // The menu backdrop drifts slowly: on phones 30 frames a second is plenty, and saves battery under the panels.
      this.menuAcc += dt
      if (resized || !this.input.touchMode || this.menuAcc >= 1 / 31) {
        this.menuAcc = 0
        drawMenuScene(this.ctx, w, h, now / 1000, !s.cameraMotion, this.screen === 'title' ? 'title' : 'menu', juice)
      }
    }
    // One-frame cues: play them once, even when the world is frozen and juice.update() does not run to clear them.
    if (juice.armedEdge) this.audio.armed()
    juice.armedEdge = false
    const hudSim = inWorld ? this.sim : null
    // Banners and bar chips wait while the game is paused.
    const hudDt = this.screen === 'pause' || this.buildOpen || this.labPaused ? 0 : dt
    this.hud.update(hudSim, this.run, hudSim ? (this.run && !this.lab ? currentBuild(this.run) : hudSim.build) : null, this.save, this.prompt, this.buildOpen, hudDt)
    document.body.classList.toggle('build-open', this.buildOpen && this.screen === 'play')
    if (juice.arrivals) this.hud.bumpCinders()
    juice.arrivals = 0
    this.stepPreviews(dt)
    const sim = this.sim
    this.audio.setState(this.screen === 'play' && !this.buildOpen ? (sim?.room.type === 'boss' ? 'boss' : 'play') : this.screen === 'pause' ? 'paused' : this.lab && !this.labPaused ? 'play' : 'menu')
    const rolling = sim && sim.grounded ? Math.min(1, hypot(sim.ball.vx, sim.ball.vy) / 900) : 0
    this.audio.setIntensity(sim ? musicIntensity(sim) : 0.2, sim?.boss?.phase ?? 1)
    this.audio.update(dt, rolling, sim?.stats.mass ?? 1, sim?.build.visual.material ?? 'metal', !!sim && this.screen === 'play' && sim.lowHp)
  }

  private tutorialPrompt(): string {
    if (!this.run?.tutorial || !this.sim) return ''
    const b = this.save.settings.bindings
    const arrows: Record<string, string> = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' }
    const key = (code: string) => arrows[code] ?? code.replace(/^Key/, '').replace(/^Digit/, '').replace(/Left$|Right$/, '')
    const touch = this.input.touchMode
    // A few words at most: the gate banner and the speed ring say the rest.
    if (this.sim.exitOpen) return ''
    if (this.run.tutorialStep === 0) {
      if (this.sim.kills === 0 && this.sim.dealt.collision > 0) return 'Faster. Past the notch.'
      if (hypot(this.sim.ball.vx, this.sim.ball.vy) < 120) {
        return touch ? 'Drag to roll · ↑ hop' : `${key(b.left)} ${key(b.right)} roll · Space hop · ${key(b.ability)} dash`
      }
      return 'Speed is damage'
    }
    return 'Feel the new core'
  }

  // -------------------------------------------------------------------------
  // Input routing.

  private onKey(e: KeyboardEvent): void {
    this.audio.resume()
    if (this.input.rebinding || e.repeat) return
    if (this.screen === 'reward' && ['Digit1', 'Digit2', 'Digit3'].includes(e.code) && !isTyping()) {
      this.pickOffer(Number(e.code.slice(5)) - 1)
      return
    }
    if (this.input.context === 'menu' && e.code === 'Escape') {
      e.preventDefault()
      // Handled here; the frame must not also read it as the pause key.
      this.input.consumeKey('Escape')
      this.back()
    }
  }

  /** Controller focus movement for every menu. */
  private menuNav(m: MenuInput): void {
    if (!m.up && !m.down && !m.left && !m.right && !m.confirm && !m.back) return
    // In the build sheet there is nothing to press but close: A closes it, like B.
    if (m.back || (m.confirm && this.buildOpen)) {
      this.back()
      return
    }
    const root = this.screen === 'play' ? document.getElementById('hud')! : this.screenEl
    // The on-screen touch buttons are not menu items.
    const items = Array.from(root.querySelectorAll<HTMLElement>('button:not([disabled]), select, input, summary')).filter((el) => el.offsetParent !== null && !el.dataset.touch)
    if (!items.length) return
    const active = document.activeElement as HTMLElement | null
    const i = active ? items.indexOf(active) : -1
    if (m.confirm) {
      if (i >= 0) {
        if (active instanceof HTMLInputElement && active.type === 'checkbox') active.click()
        else if (!(active instanceof HTMLSelectElement) && !(active instanceof HTMLInputElement)) active!.click()
      } else items[0]!.focus()
      return
    }
    if ((m.left || m.right) && active instanceof HTMLInputElement && active.type === 'range') {
      const step = Number(active.step || 0.05)
      active.value = String(Math.min(Number(active.max), Math.max(Number(active.min), Number(active.value) + (m.right ? step : -step))))
      active.dispatchEvent(new Event('input', { bubbles: true }))
      active.dispatchEvent(new Event('change', { bubbles: true }))
      return
    }
    if ((m.left || m.right) && active instanceof HTMLSelectElement) {
      active.selectedIndex = Math.min(active.options.length - 1, Math.max(0, active.selectedIndex + (m.right ? 1 : -1)))
      active.dispatchEvent(new Event('change', { bubbles: true }))
      return
    }
    const next = i < 0 ? 0 : (i + (m.down || m.right ? 1 : -1) + items.length) % items.length
    items[next]!.focus()
    items[next]!.scrollIntoView({ block: 'nearest' })
    this.audio.ui('move')
  }

  /** Escape, controller B, and every Back button. */
  private back(): void {
    if (this.buildOpen) {
      this.buildOpen = false
      return
    }
    if (this.screen === 'settings' || this.screen === 'codex') {
      // Nothing armed in settings outlives it: a pending rebind would eat the next key anywhere.
      this.rebinding = null
      this.input.rebinding = null
      this.confirmErase = false
      this.screen = this.returnTo
      this.refresh()
    } else if (this.screen === 'pause') {
      if (this.confirmAbandon) {
        this.confirmAbandon = false
        this.refresh()
      } else this.resume()
    } else if (this.screen === 'lab' && this.labPaused) this.toggleLabPause()
  }

  private onFocusLost(): void {
    // The beat after a room ends plays out (rAF stops while hidden); it is never paused into.
    if (this.screen === 'play' && !this.outro) this.pause()
    else if (this.screen === 'lab' && !this.labPaused) this.toggleLabPause()
    this.stepper.reset()
  }

  private pause(): void {
    this.pauseReturn = 'play'
    this.screen = 'pause'
    this.buildOpen = false
    this.audio.setState('paused')
    this.say('Paused.')
    this.refresh()
  }

  private resume(): void {
    this.confirmAbandon = false
    this.screen = this.pauseReturn
    this.stepper.reset()
    this.input.reset()
    this.refresh()
  }

  private toggleLabPause(): void {
    this.labPaused = !this.labPaused
    this.stepper.reset()
    this.input.reset()
    this.refresh()
  }

  private onClick(e: Event): void {
    const el = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null
    if (!el || (el as HTMLButtonElement).disabled) return
    this.audio.resume()
    const act = el.dataset.act
    const arg = el.dataset.arg ?? ''
    this.audio.ui(act === 'close' || act === 'title' ? 'move' : 'ok')
    const armed = this.armedLaunch
    this.armedLaunch = null
    if (act === 'banish' && this.input.touchMode && this.armedBanish !== Number(arg)) {
      // A banish spends a limited charge: on touch the first tap arms it, the second confirms.
      this.armedBanish = Number(arg)
      this.toast('Tap × again to banish this part for the run.', 'close')
      return
    }
    this.armedBanish = null
    switch (act) {
      // A first-time player's "Play" is the tutorial: two short rooms, then the real route.
      case 'launch': {
        // Starting anything new replaces a saved run: ask once before throwing it away.
        if (this.screen === 'title' && this.store.get(RUN_KEY) && armed !== arg) {
          this.armedLaunch = arg
          this.toast(`This replaces your saved run. ${this.input.touchMode ? 'Tap' : 'Press'} again to start.`)
          return
        }
        return arg === 'daily' ? this.launch(false, true) : this.launch(arg === 'tutorial' || (arg === 'run' && !this.save.seenTutorial))
      }
      case 'share': return this.share()
      case 'continue': return this.continueRun()
      case 'retry-seed': {
        // This one run replays the seed at the heat it was played at; a Daily Forge replays as today's daily.
        const sum = this.summary
        if (sum?.daily && sum.daily === dailyKey()) return this.launch(false, true)
        const typed = this.seedText
        const heat = this.heatPick
        this.seedText = arg
        if (sum) this.heatPick = Math.min(this.save.heatUnlocked, sum.heat)
        this.launch(false)
        this.seedText = typed
        this.heatPick = heat
        return
      }
      case 'title': return this.goTitle()
      case 'lab': return this.openLab()
      case 'codex':
        this.returnTo = this.screen === 'pause' || this.screen === 'death' || this.screen === 'victory' ? this.screen : 'title'
        this.screen = 'codex'
        return this.refresh()
      case 'settings':
        this.returnTo = this.screen
        this.screen = 'settings'
        return this.refresh()
      case 'close': return this.back()
      case 'menu':
        this.pauseReturn = this.screen
        this.screen = 'pause'
        return this.refresh()
      case 'tab':
        this.codexTab = arg as View['codexTab']
        this.refresh()
        // A new tab starts at its top; the tabs themselves stay pinned above.
        this.screenEl.querySelector<HTMLElement>('.panel.scroll')?.scrollTo({ top: 0 })
        return
      case 'heat':
        this.heatPick = Math.min(this.save.heatUnlocked, Number(arg))
        return this.refresh()
      case 'unlock': return this.unlock(arg)
      case 'rebind':
        this.rebinding = arg as Btn
        this.input.rebinding = this.rebinding
        return this.refresh()
      case 'reset-keys':
        this.save.settings.bindings = { ...DEFAULT_BINDINGS }
        this.applySettings()
        this.persist()
        this.toast('Keys reset to default.')
        return this.refresh()
      case 'reset-save':
        this.confirmErase = true
        return this.refresh()
      case 'enter':
        // On a touch screen the first tap shows what the room is; the second, or Go, enters.
        if (this.input.touchMode && !el.dataset.go && this.selectedNode !== arg) {
          this.selectedNode = arg
          this.refresh()
          // On a short phone the room's details and Go sit below the map: bring them into view.
          this.screenEl.querySelector<HTMLElement>('.node-info')?.scrollIntoView({ block: 'nearest' })
          return
        }
        return this.enter(arg)
      case 'explain': return this.toast(arg)
      case 'set': return this.setChoice(arg)
      case 'erase-cancel':
        this.confirmErase = false
        return this.refresh()
      case 'erase-confirm': return this.eraseSave()
      case 'lab-panel':
        this.labPanel = this.labPanel === arg ? null : (arg as View['labPanel'])
        return this.refresh()
      case 'lab-part': return this.fitLabPart(arg)
      case 'offer': return this.pickOffer(Number(arg))
      case 'salvage': return this.salvage()
      case 'reroll': return this.reroll()
      case 'banish': return this.banish(Number(arg))
      case 'buy': return this.buy(arg)
      case 'leave-shop': return this.leaveNode()
      case 'event': return this.chooseEvent(arg)
      case 'resume': return this.resume()
      case 'abandon':
        this.confirmAbandon = true
        return this.refresh()
      case 'abandon-cancel':
        this.confirmAbandon = false
        return this.refresh()
      case 'abandon-confirm': return this.abandon()
      case 'preset': return this.applyPreset(arg)
      case 'lab-resume': return this.toggleLabPause()
      case 'fullscreen': return this.toggleFullscreen()
    }
  }

  private onInput(e: Event): void {
    const t = e.target as HTMLInputElement
    if (t.dataset.seed !== undefined) {
      const digits = t.value.replace(/\D/g, '').slice(0, 10)
      // Seeds are 32-bit; a larger number would wrap and the share card would show a different seed.
      this.seedText = digits && Number(digits) > 4294967295 ? '4294967295' : digits
      if (this.seedText !== t.value) t.value = this.seedText
      return
    }
    // While a slider is dragged, apply the value live; the save is written once, on release (change).
    if (t.dataset.set && t.type === 'range') this.onChange(e, false)
  }

  private onChange(e: Event, persist = true): void {
    const t = e.target as HTMLInputElement
    if (t.dataset.set) {
      const key = t.dataset.set as 'screenShake' | 'sfx' | 'music' | 'particles'
      const value = Number(t.value)
      if (!Number.isFinite(value)) return
      this.save.settings[key] = value
      const out = this.screenEl.querySelector(`[data-out="${key}"]`)
      if (out) out.textContent = `${Math.round(value * 100)}%`
      const min = Number(t.min)
      const max = Number(t.max)
      t.style.setProperty('--fill', `${(((value - min) / (max - min)) * 100).toFixed(1)}%`)
      this.applySettings()
      if (persist) this.persist()
    }
    if (t.dataset.flag) {
      const key = t.dataset.flag as 'highContrast' | 'colorblind' | 'cameraMotion' | 'flashes' | 'hitPause' | 'leftHanded' | 'haptics'
      this.save.settings[key] = t.checked
      this.applySettings()
      this.persist()
    }
  }

  private rebound(btn: Btn, code: string | null): void {
    this.rebinding = null
    if (code) {
      const b = this.save.settings.bindings
      // Space, the arrows, and F always keep their fixed jobs; sharing one would fire two actions.
      const fixed = BTNS.find((x) => x !== btn && ALT_KEYS[x].includes(code))
      if (fixed) {
        const job: Record<Btn, string> = { left: 'roll left', right: 'roll right', up: 'hop', down: 'drop', ability: 'the ability', pause: 'pause', build: 'the build sheet' }
        this.toast(`${keyName(code)} is always ${job[fixed]}.`)
        return this.refresh()
      }
      const other = BTNS.find((x) => x !== btn && b[x] === code)
      if (other) {
        b[other] = b[btn]
        this.toast(`Swapped with ${other}.`)
      }
      b[btn] = code
      this.applySettings()
      this.persist()
    }
    this.refresh()
  }

  // -------------------------------------------------------------------------
  // Run flow.

  launch(tutorial: boolean, daily = false): void {
    this.lab = false
    this.labPaused = false
    this.outro = null
    this.hitstop = 0
    const key = dailyKey()
    const seed = daily ? dailySeed(key) : this.seedText && !tutorial ? Number(this.seedText) >>> 0 : undefined
    // The Daily Forge is the same for everyone: heat 0, today's seed.
    this.run = createRun(daily ? 0 : this.heatPick, tutorial, seed)
    if (daily) {
      this.run.daily = key
      const d = this.save.daily?.key === key ? this.save.daily : { key, best: 0, tries: 0, won: false }
      d.tries++
      this.save.daily = d
    }
    this.summary = null
    this.save.stats.runs++
    this.toasts = []
    this.renderToasts()
    this.clearCheckpoint()
    this.persist()
    if (this.run.tutorial) this.beginRoom(ROOM_MAP['ignition-hall']!, true)
    else this.toMap()
  }

  private continueRun(): void {
    const cp = this.readCheckpoint()
    if (!cp) {
      this.toast('That run could not be restored.')
      this.clearCheckpoint()
      return this.refresh()
    }
    this.lab = false
    this.run = cp.run
    this.summary = null
    this.sim = null
    const pending = cp.pending
    if (pending?.kind === 'reward') {
      this.offers = pending.offers
      this.screen = 'reward'
      this.buildPreviews()
    } else if (pending?.kind === 'shop') {
      this.shop = pending.items
      this.screen = 'shop'
    } else if (pending?.kind === 'event') {
      this.event = pending.event
      this.screen = 'event'
    } else this.screen = 'map'
    this.toast('Run restored at the last safe point.')
    this.refresh()
  }

  private openLab(): void {
    this.lab = true
    this.labPaused = false
    this.labPanel = null
    // A beat left over from an abandoned room would freeze the lab (the outro only ticks in play).
    this.outro = null
    this.hitstop = 0
    this.run = createRun(0, false)
    this.summary = null
    this.sim = new Simulation(ROOM_MAP['grate-crossing']!, currentBuild(this.run), {
      hp: 100, energy: 100, heat: 0, depth: 0, curse: false, gentle: true, god: true, lab: true, seed: this.run.seed,
    }, this.listeners())
    this.cam.x = 500
    this.cam.y = 420
    this.cam.zoom = fitZoom(this.view.clientWidth, this.view.clientHeight)
    this.screen = 'lab'
    this.refresh()
  }

  private applyPreset(name: string): void {
    if (!this.lab || !this.run || !this.sim) return
    const ids = presetIds(name, this.save)
    if (!ids) return
    this.run.ids = { ...ids }
    this.sim.syncBuild(currentBuild(this.run))
    this.toast(name, 'wrench')
    this.refresh()
  }

  private toMap(): void {
    this.screen = 'map'
    this.selectedNode = null
    this.sim = null
    this.offers = []
    this.shop = []
    this.event = null
    this.checkpoint(null)
    this.refresh()
  }

  private enter(id: string): void {
    const run = this.run
    if (!run || this.screen !== 'map') return
    const node = enterNode(run, id)
    if (!node) return
    if (node.type === 'shop') {
      this.shop = makeShop(run, this.save)
      this.screen = 'shop'
      this.checkpoint({ kind: 'shop', items: this.shop })
      return this.refresh()
    }
    if (node.type === 'event') {
      this.event = rollEvent(run, this.save)
      this.screen = 'event'
      this.checkpoint({ kind: 'event', event: this.event })
      return this.refresh()
    }
    if (node.type === 'treasure') {
      this.showOffers('treasure')
      return
    }
    // Rooms checkpoint on entry: a reload restarts this room with the same seed.
    this.checkpoint(null)
    this.beginRoom(pickTemplate(run, currentBuild(run), node.type), false)
  }

  private beginRoom(template: RoomTemplate, gentle: boolean): void {
    const run = this.run
    if (!run) return
    const build = currentBuild(run)
    if (template.type === 'boss') this.usesAtBoss = run.abilityUses
    for (const spawn of template.spawns) this.meetEnemy(spawn.id)
    this.sim = new Simulation(template, build, {
      hp: run.hp,
      energy: run.energy,
      heat: run.heat,
      // Scaling follows the map layer, so the two tutorial rooms do not make the first real room harder.
      depth: currentNode(run)?.depth ?? run.roomsCleared,
      curse: run.curseNext,
      gentle,
      god: false,
      lab: false,
      seed: roomSeed(run),
      assist: this.save.settings.assistDamage,
    }, this.listeners())
    run.assist = Math.min(run.assist, this.save.settings.assistDamage)
    run.roomIndex++
    // The bath's curse waits for a room it can apply to.
    if (template.type === 'combat' || template.type === 'elite') run.curseNext = false
    run.templatesSeen.push(template.id)
    this.stepper.reset()
    this.buildOpen = false
    this.abilityWasReady = true
    this.cam.x = template.player.x
    this.cam.y = template.player.y
    this.cam.zoom = fitZoom(this.view.clientWidth, this.view.clientHeight)
    this.outro = null
    this.iris = 0
    this.hitstop = 0
    this.gateWasOpen = this.sim.exitOpen
    const affixes = [...new Set(this.sim.enemies.map((e) => e.affix).filter((x): x is Affix => !!x))]
    if (template.type === 'boss') this.hud.banner('Iron Colossus', '', 'boss', artUrl('colossus'))
    else this.hud.banner(template.name, affixes.length ? affixes.map((a) => `${AFFIXES[a].label}: ${AFFIXES[a].hint}`).join('  ') : template.objective, 'room')
    this.screen = 'play'
    this.announceMet()
    // The portrait "turn the phone" hint plays through once, then stays away for the session.
    if (!this.rotateTimer && typeof window !== 'undefined') this.rotateTimer = window.setTimeout(() => document.body.classList.add('rotate-seen'), 8000)
    this.say(`${template.name}. ${template.objective}`)
    this.refresh()
  }

  private listeners(): SimListeners {
    return {
      onFx: (e) => this.juice.onEvent(e),
      onDiscovery: (id) => this.onDiscovery(id),
      onToast: (text) => {
        if (text) this.toast(text)
      },
      onShake: (mag) => this.juice.addTrauma(mag / 30),
      onFlash: (s) => {
        this.flashTo(s)
      },
      // One queue for every hit pause (the renderer's too), so close pauses share a cooldown instead of stacking.
      onHitstop: (time) => this.juice.requestHitstop(time),
      onImpactSfx: (speed, kind) => this.audio.impact(speed, this.sim?.stats.mass ?? 1, this.sim?.build.visual.material ?? 'metal', kind),
      onBounceSfx: (speed) => this.audio.bounce(speed, this.sim?.build.visual.material ?? 'metal'),
      onReflectSfx: () => this.audio.reflect(),
      onHurt: (source) => {
        this.audio.hurt(source)
        if (!this.lab) this.buzz(35)
      },
      onBossPhase: (phase) => {
        this.audio.bossPhase(phase)
        this.audio.duck(0.7, 0.6)
        this.buzz([60, 40, 90])
        this.flashTo(0.25)
        this.hud.banner(phase === 2 ? 'Heart open' : 'Floor failing', '', 'phase')
        this.say(phase === 2 ? 'Colossus phase two. The heart is open.' : 'Colossus phase three. The middle floor is about to collapse.')
      },
      onAbility: (kind) => {
        if (kind !== 'slam-land' && this.run && !this.lab) this.run.abilityUses++
        this.audio.ability(kind)
      },
      onCombo: (n) => {
        if (!this.run || this.lab) return
        this.run.bestCombo = Math.max(this.run.bestCombo, n)
        this.save.stats.bestCombo = Math.max(this.save.stats.bestCombo, n)
        this.grant(bumpAchievement(this.save, 'combo-forge', n, 'max'))
      },
      onKill: (record) => {
        this.audio.kill(this.sim?.combo ?? 0)
        this.audio.duck(0.3, 0.06)
        if (!this.run || this.lab) return
        this.run.kills++
        if (record.source === 'collision') this.grant(bumpAchievement(this.save, 'first-blood', 1, 'set'))
        if (record.source === 'reflect') {
          this.run.reflectedKills++
          this.grant(bumpAchievement(this.save, 'ricochet', 1, 'set'))
        }
        if (record.ability === 'slam') {
          this.run.slamKills++
          this.grant(bumpAchievement(this.save, 'slam-poetry', 1, 'set'))
        }
      },
      onCounter: () => {
        this.flashTo(0.18)
        if (this.run && !this.lab) this.grant(bumpAchievement(this.save, 'matador', 1, 'set'))
      },
      onHit: (record) => {
        if (!this.run || this.lab) return
        // The ram itself, not the bonus effects it triggers.
        if (record.source !== 'collision' || record.effectId) return
        const dealt = record.effective + record.overkill
        this.run.bestHit = Math.max(this.run.bestHit, dealt)
        this.save.stats.bestHit = Math.max(this.save.stats.bestHit, dealt)
        this.grant(bumpAchievement(this.save, 'heavy-hand', dealt, 'max'))
      },
    }
  }

  /** The room is done: hold on the result for a beat before the next screen. */
  private startOutro(sim: Simulation): void {
    if (this.outro) return
    const dead = sim.ended === 'dead'
    this.outro = { kind: dead ? 'dead' : 'clear', t: 0, dur: dead ? 1.4 : 0.45, sim }
    this.hitstop = 0
    // The death is decided now: a reload during the beat must not bring the room back.
    if (dead && !this.lab) this.clearCheckpoint()
    if (dead) {
      this.audio.shatter()
      this.buzz([90, 50, 160])
      this.flashTo(0.25)
    } else this.audio.clear()
  }

  private tickOutro(dt: number): void {
    const o = this.outro
    if (!o) return
    if (o.sim !== this.sim) {
      this.outro = null
      return
    }
    // The first moments of a death run slower, so the break reads.
    o.t += o.kind === 'dead' && o.t < 0.5 ? dt * 0.6 : dt
    if (o.t < o.dur) return
    this.outro = null
    this.resolveRoom()
  }

  /** The last construct fell: a short slow-motion beat and a banner. */
  private onGateOpen(sim: Simulation): void {
    if (sim.room.type !== 'boss') this.juice.slowMo(0.5, 0.35)
    this.audio.clear()
    // The grade is decided when the gate opens, so the banner can say it now.
    if (this.run && !this.run.tutorial && !this.lab) {
      const f = sim.gradeFacts()
      const par = parTime(sim.room)
      const g = gradeRoom(f.time, par, f.taken, sim.maxHp)
      // The Colossus is graded too (it counts for the score); it pays no cinders, the run is over.
      const pay = sim.room.type !== 'boss' && GRADE_CINDERS[g] ? ` · +${GRADE_CINDERS[g]} cinders` : ''
      this.hud.banner(sim.room.type === 'boss' ? `Colossus down · ${g}` : `Gate open · ${g}`, `${f.time.toFixed(1)} s, par ${par}${f.taken > 0.5 ? '' : ' · untouched'}${pay}`, 'clear')
    } else this.hud.banner('Gate open', '', 'clear')
    this.flashTo(0.12)
  }

  /** Reward cards lean toward the pointer. */
  private tiltCard(e: PointerEvent): void {
    if (!this.save.settings.cameraMotion || e.pointerType !== 'mouse') return
    const card = (e.target as HTMLElement).closest<HTMLElement>('.card')
    if (!card) return
    const r = card.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width - 0.5
    const y = (e.clientY - r.top) / r.height - 0.5
    card.style.setProperty('--ry', `${(x * 12).toFixed(2)}deg`)
    card.style.setProperty('--rx', `${(-y * 10).toFixed(2)}deg`)
    card.style.setProperty('--mx', `${((x + 0.5) * 100).toFixed(1)}%`)
    card.style.setProperty('--my', `${((y + 0.5) * 100).toFixed(1)}%`)
  }

  private untiltCard(e: PointerEvent): void {
    const card = (e.target as HTMLElement).closest<HTMLElement>('.card')
    if (!card || (e.relatedTarget instanceof Node && card.contains(e.relatedTarget))) return
    card.style.removeProperty('--ry')
    card.style.removeProperty('--rx')
  }

  /** The one place a finished room turns into run state. */
  private resolveRoom(): void {
    const run = this.run
    const sim = this.sim
    if (!run || !sim) return
    const commit = commitRoom(run, sim)
    if (!commit) return
    if (commit.kind === 'death') this.onDeath(commit)
    else this.onClear(commit, sim)
  }

  private onClear(commit: Extract<RoomCommit, { kind: 'clear' }>, sim: Simulation): void {
    const run = this.run!
    this.grant(bumpAchievement(this.save, 'ignition', 1, 'set'))
    this.grant(bumpAchievement(this.save, 'perfect-pour', run.grades.filter((g) => g.grade === 'S').length, 'max'))
    if (commit.type === 'elite' && commit.roomDamage <= 0) this.grant(bumpAchievement(this.save, 'unmarked', 1, 'set'))
    if (run.tutorial && run.tutorialStep === 0) {
      this.showOffers('combat')
      return
    }
    if (run.tutorial && run.tutorialStep === 1) {
      run.tutorial = false
      // The route starts from zero: practice rooms do not count toward the score, scrap, or "fell in room N".
      run.roomsCleared = 0
      run.nodes = generateMap(run.rng)
      // The run proper starts whole: practice dents do not follow the ball onto the route.
      run.hp = currentBuild(run).stats.maxHp
      this.save.seenTutorial = true
      this.persist()
      this.toMap()
      return
    }
    if (commit.type === 'boss') {
      this.win(sim)
      return
    }
    this.showOffers(commit.type === 'elite' ? 'elite' : commit.type === 'combat' ? 'combat' : 'soft')
  }

  private showOffers(kind: 'combat' | 'elite' | 'soft' | 'treasure'): void {
    if (!this.run) return
    this.offers = makeOffers(this.run, this.save, kind)
    for (const o of this.offers) if (o.componentId) this.discoverComponent(o.componentId)
    this.screen = 'reward'
    this.sim = null
    if (!this.run.tutorial) this.checkpoint({ kind: 'reward', offers: this.offers })
    this.buildPreviews()
    this.refresh()
  }

  private summaryFor(kind: RunSummary['kind'], scrap: number, cause: string, tip: string): RunSummary {
    const run = this.run!
    const build = currentBuild(run)
    const taken = Object.entries(run.takenBySource).filter(([, n]) => n > 0.5).map(([k, n]) => [damageLabel(k), n] as [string, number]).sort((a, b) => b[1] - a[1])
    const dealt = Object.entries(run.dealtBySource).filter(([, n]) => n > 0.5).map(([k, n]) => [HIT_LABEL[k as HitSource] ?? k, n] as [string, number]).sort((a, b) => b[1] - a[1])
    return {
      kind,
      title: kind === 'victory' ? build.archetype : kind === 'abandon' ? 'Left on the floor' : 'Shell failed',
      cause,
      tip,
      scrap,
      idea: nextIdea(run, this.save),
      archetype: build.archetype,
      components: SLOTS.map((s) => `${s}: ${run.ids[s] ? COMPONENT_MAP[run.ids[s]!]?.name ?? '?' : 'empty'}`),
      route: run.route,
      taken,
      dealt,
      highlights: [
        { icon: 'impact', value: `${Math.round(run.bestHit)}`, label: 'Best ram' },
        { icon: 'gauge', value: `${Math.round(run.maxSpeed)}`, label: 'Top speed' },
        { icon: 'combo', value: `×${run.bestCombo}`, label: 'Best combo' },
        { icon: 'target', value: `${run.kills}`, label: 'Constructs' },
        { icon: 'map', value: `${run.roomsCleared}`, label: 'Rooms' },
        { icon: 'check', value: `${run.rams ? Math.round((run.cleanRams / run.rams) * 100) : 0}%`, label: 'Clean rams' },
      ],
      decisions: run.decisions,
      assist: run.assist < 1 || this.save.settings.gameSpeed < 1,
      seed: run.seed,
      heat: run.heat,
      line: foremanLine(kind, this.save.stats.deaths, this.save.stats.wins, run.seed),
      ...this.scoreRun(kind),
    }
  }

  /** Score the run, record bests, and write the share line. */
  private scoreRun(kind: RunSummary['kind']): Pick<RunSummary, 'score' | 'scoreLines' | 'newBest' | 'grades' | 'daily' | 'share'> {
    const run = this.run!
    const won = kind === 'victory'
    const { total, lines } = runScore({
      roomsCleared: run.roomsCleared, elitesKilled: run.elitesKilled, kills: run.kills, bestCombo: run.bestCombo,
      // The assist the rooms were actually played at, not whatever the setting says now.
      grades: run.grades, won, heat: run.heat, assist: Math.min(1, run.assist),
    })
    const stats = this.save.stats
    let newBest = false
    if (run.daily) {
      this.grant(bumpAchievement(this.save, 'daily-smith', total, 'max'))
      const d = this.save.daily?.key === run.daily ? this.save.daily : { key: run.daily, best: 0, tries: 1, won: false }
      if (total > d.best) {
        d.best = total
        newBest = true
      }
      d.won = d.won || won
      this.save.daily = d
    }
    if (total > stats.bestScore) {
      if (stats.bestScore > 0) newBest = true
      stats.bestScore = total
    }
    const s = run.grades.filter((g) => g.grade === 'S').length
    stats.bestGrades = Math.max(stats.bestGrades, s)
    const clean = run.rams ? Math.round((run.cleanRams / run.rams) * 100) : 0
    const head = run.daily ? `Ballborn Daily Forge ${run.daily}` : `Ballborn seed ${run.seed}${run.heat ? ` · Heat ${run.heat}` : ''}`
    const share = `${head}
${won ? 'Colossus down' : kind === 'abandon' ? `Left after ${run.roomsCleared} room${run.roomsCleared === 1 ? '' : 's'}` : `Fell in room ${run.roomsCleared + 1}`} · ${total.toLocaleString('en-US')} pts
Grades ${gradeStrip(run.grades) || '-'} · combo ×${run.bestCombo} · ${clean}% clean rams
${currentBuild(run).archetype}`
    return { score: total, scoreLines: lines, newBest, grades: run.grades.map((g) => ({ ...g })), daily: run.daily, share }
  }

  private share(): void {
    const text = this.summary?.share
    if (!text) return
    const done = () => this.toast('Result copied.', 'check')
    try {
      void navigator.clipboard.writeText(text).then(done, () => this.toast('The clipboard is not available here.'))
    } catch {
      this.toast('The clipboard is not available here.')
    }
  }

  private onDeath(commit: Extract<RoomCommit, { kind: 'death' }>): void {
    const run = this.run!
    const scrap = deathScrap(run)
    this.save.scrap += scrap
    this.save.stats.deaths++
    this.summary = this.summaryFor('death', scrap, damageLabel(commit.cause), deathTip(run, commit.cause))
    this.screen = 'death'
    this.sim = null
    this.clearCheckpoint()
    this.persist()
    this.say(`The ball breaks. ${damageLabel(commit.cause)}.`)
    this.refresh()
  }

  private win(sim: Simulation): void {
    const run = this.run!
    const build = currentBuild(run)
    const scrap = victoryScrap(run)
    this.save.scrap += scrap
    this.save.stats.wins++
    if (run.heat >= this.save.heatUnlocked && this.save.heatUnlocked < 3) {
      this.save.heatUnlocked++
      this.toast(`Heat ${this.save.heatUnlocked}`, 'flame', 'ember')
    }
    if (!run.commonBroken) this.grant(bumpAchievement(this.save, 'common-stock', 1, 'set'))
    if ((build.tags.fire ?? 0) >= 3) this.grant(bumpAchievement(this.save, 'three-flames', 1, 'set'))
    if (run.heat >= 2) this.grant(bumpAchievement(this.save, 'heat-tempered', 1, 'set'))
    if (sim.roomDamage <= 0) this.grant(bumpAchievement(this.save, 'unmarked', 1, 'set'))
    // Only the ball: nothing but ram damage (and part bonuses on the struck target) touched anything in the hold.
    const others = sim.dealt.ability + sim.dealt.effect + sim.dealt.reflect + sim.dealt.status
    if (others <= 0) this.grant(bumpAchievement(this.save, 'pure-collision', 1, 'set'))
    if (run.abilityUses <= this.usesAtBoss) this.grant(bumpAchievement(this.save, 'patient-steel', 1, 'set'))
    this.summary = this.summaryFor('victory', scrap, '', 'You built something that finished the foundry.')
    this.screen = 'victory'
    this.sim = null
    this.clearCheckpoint()
    this.persist()
    this.say(`${build.archetype} finishes the foundry.`)
    this.refresh()
  }

  private pickOffer(index: number): void {
    const run = this.run
    if (!run || this.screen !== 'reward') return
    const offer = this.offers[index]
    if (!offer) return
    // Consume the offers first so a double input cannot take two.
    this.offers = []
    try {
      const result = takeOffer(run, this.save, offer)
      if (result.text) this.toast(result.text, offer.kind === 'component' ? 'wrench' : offer.kind === 'heal' ? 'heart' : offer.kind === 'reroll' ? 'dice' : undefined)
    } catch (err) {
      if (!(err instanceof TransactionError)) throw err
      this.toast(err.message)
    }
    if (run.tutorial && run.tutorialStep === 0) {
      run.tutorialStep = 1
      run.roomsCleared = 1
      this.beginRoom(ROOM_MAP['prove-it']!, false)
      return
    }
    this.leaveNode()
  }

  private salvage(): void {
    const run = this.run
    if (!run || this.screen !== 'reward' || run.tutorial || !this.offers.length) return
    this.offers = []
    this.toast(takeSalvage(run).text)
    this.leaveNode()
  }

  private reroll(): void {
    const run = this.run
    if (!run || run.rerolls <= 0 || this.screen !== 'reward') return
    run.rerolls--
    // A fresh hand is dealt in, like entering the screen.
    delete this.screenEl.dataset.screen
    this.showOffers(run.offerKind)
  }

  /**
   * Full-screen flashes are rate limited (photosensitivity guidance: no more
   * than about three a second). A flash soon after another is mostly absorbed.
   */
  private flashTo(strength: number): void {
    const now = performance.now()
    const soon = now - this.lastFlashAt < 340
    const s = soon ? strength * 0.3 : strength
    if (s > this.flash + 0.02) {
      this.flash = s
      if (!soon) this.lastFlashAt = now
    }
  }
  private lastFlashAt = -1e9

  /** Strike one part from the run's pool and redraw that card. */
  private banish(index: number): void {
    const run = this.run
    if (!run || this.screen !== 'reward') return
    const before = this.offers[index]
    const next = banishOffer(run, this.save, this.offers, index)
    if (!next) return
    this.offers = next
    for (const o of this.offers) if (o.componentId) this.discoverComponent(o.componentId)
    this.audio.ui('bad')
    this.toast(`${before?.title ?? 'Part'} banished for this run. ${run.banishes} left.`, 'close')
    this.checkpoint({ kind: 'reward', offers: this.offers })
    this.buildPreviews()
    this.refresh()
  }

  private buy(id: string): void {
    const run = this.run
    if (!run || this.screen !== 'shop') return
    const item = this.shop.find((s) => s.id === id)
    if (!item) return
    try {
      const result = buyItem(run, this.save, item)
      if (!result) return
      this.audio.ui('buy')
      this.toast(result.text, item.kind === 'component' ? 'wrench' : item.kind === 'heal' ? 'heart' : item.kind === 'reroll' ? 'dice' : undefined)
    } catch (err) {
      if (!(err instanceof TransactionError)) throw err
      this.toast(err.message)
    }
    // Purchases and the permanent save are written together.
    this.checkpoint({ kind: 'shop', items: this.shop })
    this.refresh()
  }

  private chooseEvent(choiceId: string): void {
    const run = this.run
    if (!run || this.screen !== 'event' || !this.event) return
    const event = this.event
    let result: ReturnType<typeof applyEventChoice>
    try {
      result = applyEventChoice(run, this.save, event, choiceId)
    } catch (err) {
      if (!(err instanceof TransactionError)) throw err
      this.audio.ui('bad')
      this.toast(err.message)
      return
    }
    if ('error' in result) {
      this.audio.ui('bad')
      this.toast(result.error)
      return
    }
    this.event = null
    if (result.text) this.toast(result.text, result.report ? 'wrench' : undefined)
    this.leaveNode()
  }

  /** Finish the current node exactly once and return to the map. */
  private leaveNode(): void {
    const run = this.run
    if (!run) return
    const done = finishNode(run, this.save)
    if (done?.ember) this.toast('+1 ember')
    this.persist()
    this.toMap()
  }

  private abandon(): void {
    const run = this.run
    this.confirmAbandon = false
    this.outro = null
    this.hitstop = 0
    if (!run || this.lab) return this.goTitle()
    const scrap = abandonScrap(run)
    this.save.scrap += scrap
    this.summary = this.summaryFor('abandon', scrap, '', 'You left the ball on the floor. The idea can still be the next one.')
    this.screen = 'death'
    this.sim = null
    this.clearCheckpoint()
    this.persist()
    this.refresh()
  }

  private unlock(id: string): void {
    const comp = COMPONENT_MAP[id]
    if (!comp || comp.pool !== 'standard' || this.save.unlocked.includes(id) || this.save.scrap < comp.unlockCost) return
    this.save.scrap -= comp.unlockCost
    this.save.unlocked.push(id)
    this.discoverComponent(id)
    this.audio.ui('buy')
    this.toast(comp.name, 'wrench')
    this.persist()
    this.refresh()
  }

  /** A settings choice made with a row of buttons: `key:value`. */
  private setChoice(arg: string): void {
    const [key, raw] = arg.split(':')
    const value = Number(raw)
    const keys = ['gameSpeed', 'assistDamage', 'hudScale', 'touchSize'] as const
    const k = keys.find((x) => x === key)
    if (!k || !Number.isFinite(value)) return
    this.save.settings[k] = value
    this.applySettings()
    this.persist()
    this.refresh()
  }

  /** Swap one lab part while the ball keeps rolling. `slot:id`, with an empty id for none. */
  private fitLabPart(arg: string): void {
    if (!this.lab || !this.run || !this.sim) return
    const [slot, id] = arg.split(':') as [Slot, string]
    if (!SLOTS.includes(slot)) return
    if (id && COMPONENT_MAP[id]?.slot !== slot) return
    this.run.ids[slot] = id || null
    this.sim.syncBuild(currentBuild(this.run))
    this.refresh()
  }

  private eraseSave(): void {
    this.confirmErase = false
    this.store.remove(SAVE_KEY)
    this.store.remove(RUN_KEY)
    this.save = defaultSave()
    this.heatPick = 0
    this.applySettings()
    this.persist()
    this.toast('Progress erased.')
    this.goTitle()
  }

  private discoverComponent(id: string): void {
    if (!this.save.discoveredComponents.includes(id)) this.save.discoveredComponents.push(id)
  }

  private meetEnemy(id: string): void {
    if (this.save.discoveredEnemies.includes(id)) return
    this.save.discoveredEnemies.push(id)
    const name = ENEMY_MAP[id]?.name ?? id
    if (!this.metNames.includes(name)) this.metNames.push(name)
  }

  /** New constructs are named in one note once the room's title banner has cleared, not on top of it. */
  private announceMet(): void {
    if (!this.metNames.length) return
    const names = this.metNames.splice(0)
    clearTimeout(this.metTimer)
    const sim = this.sim
    this.metTimer = window.setTimeout(() => {
      if (this.sim !== sim) return
      this.toast(`New construct${names.length > 1 ? 's' : ''}: ${names.join(', ')}`, 'target')
    }, 2300)
  }
  private metNames: string[] = []
  private metTimer = 0

  private onDiscovery(id: string): void {
    const syn = SYNERGY_MAP[id]
    // The lab is a sandbox: nothing found there touches the save.
    if (this.lab || !syn || this.save.discoveredSynergies.includes(id)) return
    this.save.discoveredSynergies.push(id)
    this.audio.ui('discover')
    this.toast(syn.name, 'link', 'epic')
    this.say(`Discovery. ${syn.name}.`)
    this.grant(bumpAchievement(this.save, 'scholar', this.save.discoveredSynergies.length, 'max'))
    this.persist()
  }

  private grant(grants: { text: string }[]): void {
    // One achievement is one toast: its rewards ride along as icons.
    if (grants.length) this.toast(grants.map((g) => g.text.replace(/^(Achievement|Schematic forged): /, '')).join(' '), 'trophy', 'gold')
    if (grants.length) this.persist()
  }

  /** Full screen, and landscape where the browser allows locking it. */
  private toggleFullscreen(): void {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined)
      return
    }
    const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }
    void document.documentElement.requestFullscreen({ navigationUI: 'hide' })
      .then(() => orientation.lock?.('landscape'))
      .catch(() => undefined)
  }

  private goTitle(): void {
    this.lab = false
    this.labPaused = false
    this.outro = null
    this.hitstop = 0
    this.sim = null
    this.run = null
    this.summary = null
    this.screen = 'title'
    this.returnTo = 'title'
    this.refresh()
  }

  // -------------------------------------------------------------------------
  // Persistence.

  private writeSave(): boolean {
    return writeSave(this.save, this.store)
  }

  private persist(): void {
    if (!this.writeSave() && !this.saveWarning) {
      this.saveWarning = 'Saving failed. Progress lasts until the tab closes.'
      this.toast(this.saveWarning)
    }
  }

  /** Save the run at a safe point together with the permanent save. */
  private checkpoint(pending: Checkpoint['pending']): void {
    const run = this.run
    if (!run || run.tutorial || this.lab) return
    this.persist()
    const data: Checkpoint = { run: serializeRun(run), pending }
    // A checkpoint that cannot be written must not leave an older one behind: Continue would
    // replay a reward the permanent save already paid out.
    if (!this.store.set(RUN_KEY, JSON.stringify(data))) this.clearCheckpoint()
  }

  private readCheckpoint(): { run: RunState; pending: Checkpoint['pending'] } | null {
    const raw = this.store.get(RUN_KEY)
    if (!raw) return null
    try {
      const data = JSON.parse(raw) as Checkpoint
      const run = restoreRun(data.run)
      if (!run) return null
      const pending = data.pending && ['reward', 'shop', 'event'].includes(data.pending.kind) ? data.pending : null
      // Pending screens are only trusted for the node they belong to.
      if (pending && currentNode(run)?.state !== 'open') return { run, pending: null }
      if (pending) enterNode(run, run.currentId!)
      return { run, pending }
    } catch {
      return null
    }
  }

  private clearCheckpoint(): void {
    this.store.remove(RUN_KEY)
  }

  private applySettings(): void {
    const s = this.save.settings
    document.body.classList.toggle('contrast', s.highContrast)
    document.body.classList.toggle('reduce-motion', !s.cameraMotion)
    document.documentElement.style.setProperty('--ui-scale', String(s.hudScale))
    document.documentElement.style.setProperty('--touch-scale', String(s.touchSize))
    document.body.classList.toggle('left-handed', s.leftHanded)
    this.input.bindings = { ...s.bindings }
    // The HUD buttons name the keys actually bound.
    const short = (code: string) => (code === 'Escape' ? 'Esc' : keyName(code))
    for (const [act, btn, label] of [['build', 'build', 'Build sheet'], ['pause', 'pause', 'Pause']] as const) {
      const el = document.querySelector<HTMLElement>(`.hud-btn[data-touch="${act}"]`)
      if (!el) continue
      el.title = `${label} (${short(s.bindings[btn])})`
      const k = el.querySelector('.key')
      if (k) k.textContent = short(s.bindings[btn])
    }
    this.audio.setVolumes(s.sfx, s.music)
  }

  // -------------------------------------------------------------------------
  // DOM.

  /** A short pickup-style note: an icon and a few words. Currency amounts render as their icons. */
  private toast(text: string, ico?: IconName, kind?: string): void {
    const same = this.toasts.find((t) => t.text === text)
    if (same) {
      same.count++
      same.life = 3.2
    } else {
      this.toasts.push({ text, life: 3.2, kind: kind ?? (ico === 'wrench' || ico === 'heart' ? 'part' : toastKind(text)), ico: ico ?? null, count: 1 })
      if (this.toasts.length > 4) this.toasts.shift()
    }
    this.renderToasts()
  }

  /** A short buzz on a touch device, if the player wants it. */
  private buzz(pattern: number | number[]): void {
    if (!this.save.settings.haptics || !this.input.touchMode || typeof navigator.vibrate !== 'function') return
    try {
      navigator.vibrate(pattern)
    } catch {
      // Some browsers throw instead of ignoring vibration without a gesture.
    }
  }

  private say(text: string): void {
    const live = document.getElementById('live')
    if (live) live.textContent = text
  }

  private tickToasts(dt: number): void {
    if (!this.toasts.length) return
    for (const t of this.toasts) t.life -= dt
    const next = this.toasts.filter((t) => t.life > 0)
    if (next.length !== this.toasts.length) {
      this.toasts = next
      this.renderToasts()
    }
  }

  private renderToasts(): void {
    const root = document.getElementById('toasts')!
    const existing = new Map<string, HTMLElement>()
    for (const el of Array.from(root.children) as HTMLElement[]) existing.set(el.dataset.key ?? '', el)
    // Reuse live nodes so a toast does not replay its entrance on every change.
    root.replaceChildren(...this.toasts.map((t) => {
      const key = `${t.text}#${t.count}`
      const div = existing.get(key) ?? document.createElement('div')
      div.className = `toast ${t.kind}`
      div.dataset.key = key
      div.innerHTML = `${t.ico ? svg(t.ico, 18) : ''}<span>${toastHtml(t.text)}</span>${t.count > 1 ? `<b>×${t.count}</b>` : ''}`
      return div
    }))
  }

  private buildPreviews(): void {
    this.previews = []
    const run = this.run
    if (!run) return
    const now = currentBuild(run)
    this.offers.forEach((offer, i) => {
      if (offer.kind !== 'component' || !offer.componentId || !offer.slot) return
      const next = buildFor({ ...run.ids, [offer.slot]: offer.componentId }, run.mods)
      this.previews[i] = new CardPreview(now.stats, next.stats, now.visual, next.visual)
    })
  }

  private stepPreviews(dt: number): void {
    if (this.screen !== 'reward') return
    this.screenEl.querySelectorAll<HTMLCanvasElement>('canvas[data-preview]').forEach((canvas) => {
      const i = Number(canvas.dataset.preview)
      const ctx = canvas.getContext('2d')
      const preview = this.previews[i]
      if (ctx && preview) preview.step(ctx, this.save.settings.cameraMotion ? dt : dt * 0.5)
    })
  }

  /** Rebuild the menu for the current state, keeping keyboard focus where it was. */
  private refresh(): void {
    const build = this.run ? (this.lab ? buildFor(this.run.ids, []) : currentBuild(this.run)) : null
    const view: View = {
      screen: this.screen,
      codexTab: this.codexTab,
      save: this.save,
      run: this.run,
      build,
      offers: this.offers,
      shop: this.shop,
      event: this.event,
      summary: this.summary,
      rebinding: this.rebinding,
      heatPick: this.heatPick,
      hasCheckpoint: this.screen === 'title' && !!this.store.get(RUN_KEY),
      labPaused: this.labPaused,
      confirmAbandon: this.confirmAbandon,
      saveWarning: this.saveWarning,
      seedText: this.seedText,
      touch: this.input.touchMode,
      canFullscreen: !!document.fullscreenEnabled,
      labPanel: this.labPanel,
      selectedNode: this.selectedNode,
      confirmErase: this.confirmErase,
      dailyKey: dailyKey(),
    }
    const active = document.activeElement as HTMLElement | null
    const focusKey = active && this.screenEl.contains(active) ? focusKeyOf(active) : null
    // Every scroller keeps its place across a rebuild, sideways ones too (map, card carousel, part strip).
    const entering = this.screenEl.dataset.screen !== this.screen
    const scrollers = entering ? [] : Array.from(this.screenEl.querySelectorAll<HTMLElement>(SCROLLERS)).map((el) => [el.scrollLeft, el.scrollTop] as const)
    this.screenEl.dataset.screen = this.screen
    document.body.dataset.screen = this.lab && this.labPaused ? 'lab-edit' : this.screen
    this.screenEl.className = entering ? `${this.screen} enter` : this.screen
    this.screenEl.innerHTML = screenHtml(view)
    // The lab drawer slides in when it opens, not again on every part swapped inside it.
    if (this.screen === 'lab' && !entering && this.labPanel && this.labPanel === this.lastLabPanel) this.screenEl.querySelector('.lab-drawer')?.classList.add('stay')
    this.lastLabPanel = this.screen === 'lab' ? this.labPanel : null
    if (this.screen === 'map') this.fitMap()
    this.screenEl.querySelectorAll<HTMLElement>(SCROLLERS).forEach((el, i) => {
      const at = scrollers[i]
      if (!at) return
      // Restore instantly: a smooth-scrolling container would visibly sweep back from zero.
      el.style.scrollBehavior = 'auto'
      el.scrollLeft = at[0]
      el.scrollTop = at[1]
      el.style.scrollBehavior = ''
    })
    // A route wider than the screen opens on the rooms you can take next.
    if (entering && this.screen === 'map') {
      const scroller = this.screenEl.querySelector<HTMLElement>('.map-scroll')
      const node = this.screenEl.querySelector<HTMLElement>('.node.open')
      if (scroller && node && scroller.scrollWidth > scroller.clientWidth) scroller.scrollLeft = Math.max(0, node.offsetLeft - scroller.clientWidth * 0.2)
    }
    if (this.screen === 'play' || (this.screen === 'lab' && !this.labPaused)) {
      if (active && this.screenEl.contains(active) === false && active !== document.body) active.blur()
      return
    }
    // A control that just became disabled (sold, unaffordable, spent) cannot hold focus: fall through to the next best.
    const target = (focusKey && this.screenEl.querySelector<HTMLElement>(`${focusKey}:not([disabled])`))
      || this.screenEl.querySelector<HTMLElement>('[data-autofocus]')
      || this.screenEl.querySelector<HTMLElement>('button:not([disabled]), select, input')
    // On touch nothing is focused until the player reaches for a keyboard or controller:
    // a focus ring on the first card reads as a pick already made.
    if (this.input.touchMode && !focusKey) {
      if (active && active !== document.body && !this.screenEl.contains(active)) active.blur()
      return
    }
    target?.focus({ preventScroll: true })
  }

  /**
   * Switching between touch and mouse or keys changes hints and layout, but a
   * rebuild inside the very pointerdown would swap out the button before its
   * click lands. Rebuild just after the gesture instead, and never under a
   * text field that is being typed into.
   */
  private deferTouchRefresh(): void {
    if (this.touchRefreshQueued) return
    this.touchRefreshQueued = true
    const run = () => {
      window.removeEventListener('pointerup', later, true)
      window.removeEventListener('keyup', later, true)
      this.touchRefreshQueued = false
      if (this.screen === 'play' || isTyping()) return
      this.refresh()
    }
    const later = () => setTimeout(run, 0)
    window.addEventListener('pointerup', later, true)
    window.addEventListener('keyup', later, true)
    // Nothing follows (a programmatic switch): rebuild soon anyway.
    setTimeout(() => {
      if (this.touchRefreshQueued) run()
    }, 400)
  }
  private lastLabPanel: View['labPanel'] = null
  private touchRefreshQueued = false
  private rotateTimer = 0
  private armedLaunch: string | null = null
  private armedBanish: number | null = null
  private stillDrawn: Simulation | null = null
  private menuAcc = 0
  private coinAt: { x: number; y: number } | null = null

  /** Where collected cinders fly: the cinder counter in the HUD, in canvas space. */
  private coinTarget(w: number, resized: boolean): { x: number; y: number } {
    if (!this.coinAt || resized || this.coinScale !== this.save.settings.hudScale) {
      const r = document.getElementById('cinder-chip')?.getBoundingClientRect()
      // Measured once the HUD is laid out; until then (or if it is hidden) aim near the top right.
      if (!r || !r.width) return { x: w - 70, y: 24 }
      const v = this.view.getBoundingClientRect()
      this.coinAt = { x: r.left + r.width / 2 - v.left, y: r.top + r.height / 2 - v.top }
      this.coinScale = this.save.settings.hudScale
    }
    return this.coinAt
  }
  private coinScale = 0

  /**
   * The Android back gesture (and the browser back button) acts like Esc while
   * the game is open, instead of leaving the page mid-run. On the title it is
   * left alone, so back still leaves the game from there.
   */
  private trapBack(): void {
    if (typeof history === 'undefined' || !history.pushState) return
    try {
      history.pushState({ ballborn: 1 }, '')
    } catch {
      return
    }
    window.addEventListener('popstate', () => {
      if (this.screen === 'title') return
      if (this.screen === 'play') {
        if (!this.outro) this.pause()
      } else if (this.screen === 'lab' && !this.labPaused) this.toggleLabPause()
      else if (this.screen === 'settings' || this.screen === 'codex' || this.screen === 'pause' || this.buildOpen || this.labPaused) this.back()
      try {
        history.pushState({ ballborn: 1 }, '')
      } catch {
        // Some embedded browsers refuse; back then leaves as usual.
      }
    })
  }

  /**
   * Screen space the camera may look past a side wall. In landscape on a touch
   * screen the stick and the hop button cover the bottom corners, which is
   * exactly where the ball spawns and the exit gate stands. In portrait the
   * controls sit below the floor, so no margin is needed.
   */
  private cameraEdgePad(w: number, h: number): number {
    if (!this.input.touchMode || w <= h) return 0
    return Math.min(w * 0.2, 130 * this.save.settings.touchSize)
  }

  /**
   * The whole route, Colossus included, should fit on one screen. Shrink the
   * map to its panel, but not below a readable size: past that it scrolls.
   */
  private fitMap(): void {
    const scroller = this.screenEl.querySelector<HTMLElement>('.map-scroll')
    const map = this.screenEl.querySelector<HTMLElement>('.map')
    if (!scroller || !map) return
    const natural = parseFloat(map.style.width) || map.offsetWidth
    const cs = getComputedStyle(scroller)
    const avail = scroller.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
    const scale = Math.max(0.7, Math.min(1, avail / Math.max(1, natural)))
    map.style.zoom = scale < 0.999 ? scale.toFixed(3) : ''
  }

  /** Resolution scale for the canvas, lowered when frames run long (phones, big tablets) and raised again when they recover. */
  private renderScale = 1
  private frameAvg = 1 / 60
  private scaleHold = 0

  /** Size the canvas backing store; true when it changed (and was cleared). */
  private resize(dt = 0): boolean {
    if (this.screen === 'map') {
      const map = this.screenEl.querySelector<HTMLElement>('.map')
      const w = this.screenEl.clientWidth
      if (map && map.dataset.fitW !== String(w)) {
        map.dataset.fitW = String(w)
        this.fitMap()
      }
    }
    const w = this.view.clientWidth
    const h = this.view.clientHeight
    // Adaptive resolution: in play, a sustained run of long frames steps the backing store down.
    const live = this.screen === 'play' || (this.lab && !this.labPaused)
    if (live && dt > 0 && dt < 0.1) {
      this.frameAvg += (dt - this.frameAvg) * 0.05
      this.scaleHold -= dt
      if (this.scaleHold <= 0) {
        if (this.frameAvg > 1 / 45 && this.renderScale > 0.6) {
          this.renderScale = Math.max(0.6, this.renderScale - 0.15)
          this.scaleHold = 2
        } else if (this.frameAvg < 1 / 57 && this.renderScale < 1) {
          this.renderScale = Math.min(1, this.renderScale + 0.05)
          this.scaleHold = 4
        }
      }
    }
    // A pixel budget: a 2x tablet or a 4K window would otherwise fill 5-8 million pixels a frame.
    const budget = Math.sqrt(3_000_000 / Math.max(1, w * h))
    const dpr = Math.max(0.5, Math.min(2, window.devicePixelRatio || 1, budget) * this.renderScale)
    const bw = Math.max(1, Math.floor(w * dpr))
    const bh = Math.max(1, Math.floor(h * dpr))
    let changed = false
    if (this.view.width !== bw || this.view.height !== bh) {
      this.view.width = bw
      this.view.height = bh
      changed = true
    }
    // The transform maps CSS pixels onto the backing store exactly, whatever rounding did.
    this.ctx.setTransform(bw / Math.max(1, w), 0, 0, bh / Math.max(1, h), 0, 0)
    return changed
  }
}

/** Containers whose scroll position survives a screen rebuild. */
const SCROLLERS = '.scroll, .map-scroll, .cards, .part-row, .lab-slots, .lab-drawer'

function focusKeyOf(el: HTMLElement): string | null {
  const d = el.dataset
  if (d.act) return `[data-act="${d.act}"]${d.arg !== undefined ? `[data-arg="${CSS.escape(d.arg)}"]` : ''}`
  if (d.set) return `[data-set="${d.set}"]`
  if (d.flag) return `[data-flag="${d.flag}"]`
  if (d.seed !== undefined) return '[data-seed]'
  return null
}

function toastKind(text: string): string {
  if (/^\+\d+ cinders/.test(text)) return 'cinder'
  if (/scrap/.test(text)) return 'scrap'
  if (/ember/.test(text)) return 'ember'
  return 'info'
}

const CURRENCY_ICON: Record<string, string> = { cinder: 'currency-cinders', scrap: 'currency-scrap', ember: 'currency-embers' }

/** "+10 scrap" becomes "+10" and the scrap icon. */
function toastHtml(text: string): string {
  return escapeHtml(text).replace(/([+−-]?\d+) (cinders?|scrap|embers?)\b/g, (_, n: string, word: string) =>
    `${n}<img class="ico" src="art/foundry-v1/icons/${CURRENCY_ICON[word.replace(/s$/, '')]}.svg" alt="${word}" width="18" height="18" />`)
}

function isTyping(): boolean {
  const el = document.activeElement
  return el instanceof HTMLInputElement && el.type === 'text'
}

/** How hot the room is for the score: constructs alive, clean-ram speed, combo, and the boss phase. */
function musicIntensity(sim: Simulation): number {
  if (sim.done) return 0.15
  const speed = hypot(sim.ball.vx, sim.ball.vy) / Math.max(1, sim.stats.maxSpeed)
  const armed = speed >= TUNE.cleanRamRatio ? 0.14 : speed * 0.12
  const combo = Math.min(0.28, sim.combo * 0.035)
  if (sim.boss && sim.boss.alive) return 0.55 + (sim.boss.phase - 1) * 0.14 + armed * 0.5 + combo * 0.5
  if (sim.exitOpen) return 0.22
  const alive = sim.enemies.filter((e) => e.alive).length
  const base = alive ? 0.42 + Math.min(0.12, alive * 0.025) : 0.3
  return base + armed + combo
}
