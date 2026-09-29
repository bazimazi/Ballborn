import { artUrl, loadArt } from './assets'
import { AudioBus } from './audio'
import { COMPONENT_MAP } from './data/components'
import { SYNERGY_MAP } from './data/synergies'
import { foremanLine } from './data/lines'
import { ROOM_MAP } from './data/rooms'
import { applyEventChoice, rollEvent, type GameEvent } from './events'
import { Input, type FrameInput, type MenuInput } from './input'
import { FixedStepper } from './loop'
import { selfCheckPhysics } from './physics'
import { Juice } from './juice'
import { ballView, CardPreview, drawMenuScene, drawWorld, makeCamera, screenToWorld, updateCamera, viewRect, type Camera } from './render'
import {
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
import { Simulation, type SimListeners } from './sim'
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
import { damageLabel, HIT_LABEL, Hud, presetIds, screenHtml, type RunSummary, type Screen, type View } from './ui'
import { hypot } from './util'

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
  private toasts: { text: string; life: number; kind: string; count: number }[] = []
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
    const ctx = this.view.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D is not available in this browser.')
    this.ctx = ctx
    this.screenEl = document.getElementById('screen')!
    this.input = new Input(this.save.settings.bindings, this.view)
    this.input.onRebound = (btn, code) => this.rebound(btn, code)
    this.input.onFocusLost = () => this.onFocusLost()
    this.input.onPadChange = (connected) => {
      this.toast(connected ? 'Controller connected.' : 'Controller disconnected.')
      if (!connected) this.onFocusLost()
    }
    this.screenEl.addEventListener('click', (e) => this.onClick(e))
    this.screenEl.addEventListener('change', (e) => this.onChange(e))
    this.screenEl.addEventListener('input', (e) => this.onInput(e))
    window.addEventListener('keydown', (e) => this.onKey(e))
    window.addEventListener('pointerdown', () => this.audio.resume())
    this.screenEl.addEventListener('pointermove', (e) => this.tiltCard(e))
    this.screenEl.addEventListener('pointerout', (e) => this.untiltCard(e))
    loadArt()
    if (!this.writeSave()) this.saveWarning = 'This browser is not letting Ballborn save. Progress lasts until the tab closes.'
    this.applySettings()
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
    if (input.pausePressed && this.screen === 'play') this.pause()
    else if (input.pausePressed && this.screen === 'lab') this.toggleLabPause()
    if (input.buildPressed && this.screen === 'play') {
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
    const rect = this.view.getBoundingClientRect()
    const mouse = input.mouseThrust ? screenToWorld(this.cam, input.mx - rect.left, input.my - rect.top, rect.width, rect.height) : null
    const held = { ...input, hopPressed: false, abilityPressed: false }
    // Pressed edges belong to the first tick only; held input applies to every tick.
    const steps = this.stepper.advance(realDt, this.save.settings.gameSpeed * this.juice.timeScale, TUNE.maxFrame, (first) => {
      sim.step(first ? input : held, mouse)
      return sim.done
    })
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
    this.resize()
    const w = this.view.clientWidth
    const h = this.view.clientHeight
    const s = this.save.settings
    const juice = this.juice
    juice.settings = { shake: s.screenShake, particles: s.particles, motion: s.cameraMotion, hitPause: s.hitPause }
    const inWorld = !!this.sim && (this.screen === 'play' || this.screen === 'pause' || this.lab)
    if (inWorld && this.sim) {
      const moving = this.screen !== 'pause' && !this.buildOpen && !this.labPaused
      if (moving) {
        updateCamera(this.cam, this.sim, dt, w, h, s.cameraMotion, alpha)
        const b = ballView(this.sim, alpha)
        juice.update(dt, this.sim, viewRect(this.cam, w, h), frozen, b.x, b.y)
        const off = juice.shakeOffset()
        this.cam.shakeX = off.x
        this.cam.shakeY = off.y
        this.cam.rot = off.rot
      }
      this.sim.fxLevel = s.particles
      const outro = this.outro ? { kind: this.outro.kind, t: this.outro.t / this.outro.dur } : null
      drawWorld(this.ctx, this.sim, this.cam, w, h, {
        alpha, particles: s.particles, colorblind: s.colorblind, contrast: s.highContrast, flash: s.flashes ? this.flash : 0,
        motion: s.cameraMotion, juice, time: now / 1000, iris: s.cameraMotion ? this.iris : 1, outro,
      })
    } else {
      juice.update(dt, null, { x: 0, y: 0, w, h }, false, 0, 0)
      drawMenuScene(this.ctx, w, h, now / 1000, !s.cameraMotion, this.screen === 'title' ? 'title' : 'menu', juice)
    }
    if (juice.armedEdge) this.audio.armed()
    const hudSim = inWorld ? this.sim : null
    this.hud.update(hudSim, this.run, hudSim ? (this.run && !this.lab ? currentBuild(this.run) : hudSim.build) : null, this.save, this.prompt, this.buildOpen, dt)
    if (juice.arrivals) this.hud.bumpCinders()
    this.stepPreviews(dt)
    const sim = this.sim
    this.audio.setState(this.screen === 'play' && !this.buildOpen ? (sim?.room.type === 'boss' ? 'boss' : 'play') : this.screen === 'pause' ? 'paused' : this.lab && !this.labPaused ? 'play' : 'menu')
    const rolling = sim && sim.grounded ? Math.min(1, hypot(sim.ball.vx, sim.ball.vy) / 900) : 0
    this.audio.update(dt, rolling, sim?.stats.mass ?? 1, sim?.build.visual.material ?? 'metal', !!sim && this.screen === 'play' && sim.lowHp)
  }

  private tutorialPrompt(): string {
    if (!this.run?.tutorial || !this.sim) return ''
    const b = this.save.settings.bindings
    const keys = `${b.left.replace('Key', '')} / ${b.right.replace('Key', '')}`
    if (this.run.tutorialStep === 0) {
      if (this.sim.exitOpen) return 'Gate open. Roll into the frame on the right.'
      if (this.sim.kills === 0 && this.sim.dealt.collision > 0) return 'That was a bump. Back off, build speed, and hit it again: fill the speed ring past the notch for a clean ram.'
      if (hypot(this.sim.ball.vx, this.sim.ball.vy) < 120) return `${keys} or arrows roll. Space hops. Hold hop in the air to float. ${b.ability.replace('Left', '')} dashes.`
      return 'Speed is the weapon. The ring around the ball shows your speed. Past the notch, a ram is clean and costs you nothing.'
    }
    if (this.sim.exitOpen) return 'Same gate. Notice how the new core hops, turns, and hits.'
    return 'The floor is safe. The stairs are optional. Feel the difference in how you start, stop, and land.'
  }

  // -------------------------------------------------------------------------
  // Input routing.

  private onKey(e: KeyboardEvent): void {
    this.audio.resume()
    if (this.input.rebinding) return
    if (this.screen === 'reward' && ['Digit1', 'Digit2', 'Digit3'].includes(e.code) && !isTyping()) {
      this.pickOffer(Number(e.code.slice(5)) - 1)
      return
    }
    if (this.input.context === 'menu' && e.code === 'Escape') {
      e.preventDefault()
      this.back()
    }
  }

  /** Controller focus movement for every menu. */
  private menuNav(m: MenuInput): void {
    if (!m.up && !m.down && !m.left && !m.right && !m.confirm && !m.back) return
    if (m.back) {
      this.back()
      return
    }
    const root = this.screen === 'play' ? document.getElementById('hud')! : this.screenEl
    const items = Array.from(root.querySelectorAll<HTMLElement>('button:not([disabled]), select, input, summary')).filter((el) => el.offsetParent !== null)
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
    if (this.screen === 'play') this.pause()
    else if (this.screen === 'lab' && !this.labPaused) this.toggleLabPause()
    this.stepper.reset()
  }

  private pause(): void {
    this.pauseReturn = 'play'
    this.screen = 'pause'
    this.buildOpen = false
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
    switch (act) {
      case 'launch': return this.launch(arg === 'tutorial')
      case 'continue': return this.continueRun()
      case 'retry-seed': {
        this.seedText = arg
        return this.launch(false)
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
        return this.refresh()
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
      case 'reset-save': return this.resetSave()
      case 'enter': return this.enter(arg)
      case 'offer': return this.pickOffer(Number(arg))
      case 'salvage': return this.salvage()
      case 'reroll': return this.reroll()
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
    }
  }

  private onInput(e: Event): void {
    const t = e.target as HTMLInputElement
    if (t.dataset.seed !== undefined) {
      this.seedText = t.value.replace(/\D/g, '').slice(0, 10)
      return
    }
    if (t.dataset.set && t.type === 'range') this.onChange(e)
  }

  private onChange(e: Event): void {
    const t = e.target as HTMLInputElement
    if (t.dataset.slot && this.lab && this.run && this.sim) {
      const slot = t.dataset.slot as Slot
      const id = t.value || null
      if (id && COMPONENT_MAP[id]?.slot !== slot) return
      this.run.ids[slot] = id
      this.sim.syncBuild(currentBuild(this.run))
      this.refresh()
      return
    }
    if (t.dataset.set) {
      const key = t.dataset.set as 'screenShake' | 'sfx' | 'music' | 'gameSpeed' | 'particles' | 'hudScale' | 'assistDamage'
      const value = Number(t.value)
      if (!Number.isFinite(value)) return
      this.save.settings[key] = value
      const out = this.screenEl.querySelector(`[data-out="${key}"]`)
      if (out) out.textContent = `${Math.round(value * 100)}%`
      this.applySettings()
      this.persist()
    }
    if (t.dataset.flag) {
      const key = t.dataset.flag as 'highContrast' | 'colorblind' | 'cameraMotion' | 'flashes' | 'hitPause'
      this.save.settings[key] = t.checked
      this.applySettings()
      this.persist()
    }
  }

  private rebound(btn: Btn, code: string | null): void {
    this.rebinding = null
    if (code) {
      const b = this.save.settings.bindings
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

  launch(tutorial: boolean): void {
    this.lab = false
    this.labPaused = false
    const seed = this.seedText && !tutorial ? Number(this.seedText) >>> 0 : undefined
    this.run = createRun(this.heatPick, tutorial, seed)
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
    this.run = createRun(0, false)
    this.summary = null
    this.sim = new Simulation(ROOM_MAP['grate-crossing']!, currentBuild(this.run), {
      hp: 100, energy: 100, heat: 0, depth: 0, curse: false, gentle: true, god: true, lab: true, seed: this.run.seed,
    }, this.listeners())
    this.cam.x = 500
    this.cam.y = 420
    this.screen = 'lab'
    this.refresh()
  }

  private applyPreset(name: string): void {
    if (!this.lab || !this.run || !this.sim) return
    const ids = presetIds(name, this.save)
    if (!ids) return
    this.run.ids = { ...ids }
    this.sim.syncBuild(currentBuild(this.run))
    this.toast(`${name} build fitted.`)
    this.refresh()
  }

  private toMap(): void {
    this.screen = 'map'
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
      depth: run.roomsCleared,
      curse: run.curseNext,
      gentle,
      god: false,
      lab: false,
      seed: roomSeed(run),
      assist: this.save.settings.assistDamage,
    }, this.listeners())
    run.roomIndex++
    run.curseNext = false
    run.templatesSeen.push(template.id)
    this.stepper.reset()
    this.buildOpen = false
    this.abilityWasReady = true
    this.cam.x = template.player.x
    this.cam.y = template.player.y
    this.outro = null
    this.iris = 0
    this.hitstop = 0
    this.gateWasOpen = this.sim.exitOpen
    if (template.type === 'boss') this.hud.banner('Iron Colossus', 'Crack the rivets. Then the heart.', 'boss', artUrl('colossus'))
    else this.hud.banner(template.name, template.objective, 'room')
    this.screen = 'play'
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
        this.flash = Math.max(this.flash, s)
      },
      onHitstop: (time) => {
        if (this.save.settings.hitPause) this.hitstop = Math.max(this.hitstop, time)
      },
      onImpactSfx: (speed, kind) => this.audio.impact(speed, this.sim?.stats.mass ?? 1, this.sim?.build.visual.material ?? 'metal', kind),
      onBounceSfx: (speed) => this.audio.bounce(speed, this.sim?.build.visual.material ?? 'metal'),
      onReflectSfx: () => this.audio.reflect(),
      onHurt: (source) => this.audio.hurt(source),
      onBossPhase: (phase) => {
        this.audio.bossPhase(phase)
        this.flash = Math.max(this.flash, 0.25)
        this.hud.banner(phase === 2 ? 'The heart is open' : 'The floor is failing', phase === 2 ? 'Ram the molten core.' : 'Get off the middle floor.', 'phase')
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
    if (dead) {
      this.audio.shatter()
      this.flash = Math.max(this.flash, 0.25)
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
    this.hud.banner('Gate open', sim.room.type === 'boss' ? 'The Colossus is scrap. Roll out.' : 'Roll into the frame.', 'clear')
    this.flash = Math.max(this.flash, 0.12)
  }

  /** Reward cards lean toward the pointer. */
  private tiltCard(e: PointerEvent): void {
    if (!this.save.settings.cameraMotion) return
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
    if (commit.type === 'elite' && commit.roomDamage <= 0) this.grant(bumpAchievement(this.save, 'unmarked', 1, 'set'))
    if (commit.cinders > 0) this.toast(`+${commit.cinders} cinders collected.`)
    if (run.tutorial && run.tutorialStep === 0) {
      this.showOffers('combat')
      return
    }
    if (run.tutorial && run.tutorialStep === 1) {
      run.tutorial = false
      run.roomsCleared++
      run.nodes = generateMap(run.rng)
      this.save.seenTutorial = true
      this.toast('The foundry opens. Pick a route.')
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
        `Best ram ${Math.round(run.bestHit)}`,
        `Top speed ${Math.round(run.maxSpeed)}`,
        `Best combo ×${run.bestCombo}`,
        `${run.kills} constructs`,
        `${run.roomsCleared} rooms`,
      ],
      decisions: run.decisions,
      assist: this.save.settings.assistDamage < 1 || this.save.settings.gameSpeed < 1,
      seed: run.seed,
      heat: run.heat,
      line: foremanLine(kind, this.save.stats.deaths, this.save.stats.wins, run.seed),
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
      this.toast(`Forge Heat ${this.save.heatUnlocked} unlocked`)
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
      if (result.text) this.toast(result.text)
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
    this.showOffers(run.offerKind)
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
      this.toast(result.text)
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
    const result = applyEventChoice(run, this.save, event, choiceId)
    if ('error' in result) {
      this.audio.ui('bad')
      this.toast(result.error)
      return
    }
    this.event = null
    if (result.text) this.toast(result.text)
    this.leaveNode()
  }

  /** Finish the current node exactly once and return to the map. */
  private leaveNode(): void {
    const run = this.run
    if (!run) return
    const done = finishNode(run, this.save)
    if (done?.ember) this.toast('The elite leaves an ember. Embers keep between runs.')
    this.persist()
    this.toMap()
  }

  private abandon(): void {
    const run = this.run
    this.confirmAbandon = false
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
    this.toast(`Schematic forged: ${comp.name}`)
    this.persist()
    this.refresh()
  }

  private resetSave(): void {
    if (!confirm('Erase all Ballborn progress and settings on this machine? This cannot be undone.')) return
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
    this.toast(`New construct in the codex.`)
  }

  private onDiscovery(id: string): void {
    const syn = SYNERGY_MAP[id]
    if (!syn || this.save.discoveredSynergies.includes(id)) return
    this.save.discoveredSynergies.push(id)
    this.audio.ui('discover')
    this.toast(`Discovery — ${syn.name}. ${syn.description}`)
    this.say(`Discovery. ${syn.name}.`)
    this.grant(bumpAchievement(this.save, 'scholar', this.save.discoveredSynergies.length, 'max'))
    this.persist()
  }

  private grant(grants: { text: string }[]): void {
    // One achievement is one toast: its rewards ride along.
    if (grants.length) this.toast(grants.map((g) => g.text).join(' · '))
    if (grants.length) this.persist()
  }

  private goTitle(): void {
    this.lab = false
    this.labPaused = false
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
    this.store.set(RUN_KEY, JSON.stringify(data))
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
    this.input.bindings = { ...s.bindings }
    this.audio.setVolumes(s.sfx, s.music)
  }

  // -------------------------------------------------------------------------
  // DOM.

  private toast(text: string): void {
    const same = this.toasts.find((t) => t.text === text)
    if (same) {
      same.count++
      same.life = 3.2
    } else {
      this.toasts.push({ text, life: 3.2, kind: toastKind(text), count: 1 })
      if (this.toasts.length > 4) this.toasts.shift()
    }
    this.renderToasts()
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
      div.textContent = t.count > 1 ? `${t.text}  ×${t.count}` : t.text
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
    }
    const active = document.activeElement as HTMLElement | null
    const focusKey = active && this.screenEl.contains(active) ? focusKeyOf(active) : null
    const scrollers = Array.from(this.screenEl.querySelectorAll<HTMLElement>('.scroll, .map-scroll')).map((el) => el.scrollTop)
    const entering = this.screenEl.dataset.screen !== this.screen
    this.screenEl.dataset.screen = this.screen
    this.screenEl.className = entering ? `${this.screen} enter` : this.screen
    this.screenEl.innerHTML = screenHtml(view)
    this.screenEl.querySelectorAll<HTMLElement>('.scroll, .map-scroll').forEach((el, i) => {
      if (scrollers[i] !== undefined) el.scrollTop = scrollers[i]!
    })
    if (this.screen === 'play' || (this.screen === 'lab' && !this.labPaused)) {
      if (active && this.screenEl.contains(active) === false && active !== document.body) active.blur()
      return
    }
    const target = (focusKey && this.screenEl.querySelector<HTMLElement>(focusKey))
      || this.screenEl.querySelector<HTMLElement>('[data-autofocus]')
      || this.screenEl.querySelector<HTMLElement>('button:not([disabled]), select, input')
    target?.focus({ preventScroll: true })
  }

  private resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const w = this.view.clientWidth
    const h = this.view.clientHeight
    if (this.view.width !== Math.floor(w * dpr) || this.view.height !== Math.floor(h * dpr)) {
      this.view.width = Math.floor(w * dpr)
      this.view.height = Math.floor(h * dpr)
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }
}

function focusKeyOf(el: HTMLElement): string | null {
  const d = el.dataset
  if (d.act) return `[data-act="${d.act}"]${d.arg !== undefined ? `[data-arg="${CSS.escape(d.arg)}"]` : ''}`
  if (d.set) return `[data-set="${d.set}"]`
  if (d.flag) return `[data-flag="${d.flag}"]`
  if (d.slot) return `[data-slot="${d.slot}"]`
  if (d.seed !== undefined) return '[data-seed]'
  return null
}

function toastKind(text: string): string {
  if (text.startsWith('Achievement')) return 'gold'
  if (text.startsWith('Discovery')) return 'epic'
  if (/^\+\d+ cinders/.test(text) || /cinders collected/.test(text)) return 'cinder'
  if (/scrap/.test(text)) return 'scrap'
  if (/ember/.test(text)) return 'ember'
  if (/fitted|forged|Welded/.test(text)) return 'part'
  return 'info'
}

function isTyping(): boolean {
  const el = document.activeElement
  return el instanceof HTMLInputElement && el.type === 'text'
}
