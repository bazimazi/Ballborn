import { AudioBus } from './audio'
import { compileBuild } from './build'
import { COMPONENT_MAP } from './data/components'
import { SYNERGY_MAP } from './data/synergies'
import { ROOM_MAP } from './data/rooms'
import { Input } from './input'
import { selfCheckPhysics } from './physics'
import { drawTitleScene, drawWorld, makeCamera, screenToWorld, updateCamera, CardPreview, type Camera } from './render'
import {
  applyEvent,
  createRun,
  currentBuild,
  deathTip,
  makeOffers,
  makeShop,
  nextIdea,
  noteRarity,
  pickTemplate,
  rollEvent,
  type GameEvent,
  type Offer,
  type RunState,
  type ShopItem,
} from './run'
import { bumpAchievement, loadSave, writeSave, type Btn, type SaveData } from './save'
import { Simulation } from './sim'
import { SLOTS, type Slot } from './types'
import { screenHtml, updateHud, type Screen, type View } from './ui'
import { hypot } from './util'

export class Game {
  save: SaveData
  screen: Screen = 'title'
  returnTo: Screen = 'title'
  codexTab: View['codexTab'] = 'components'
  run: RunState | null = null
  sim: Simulation | null = null
  offers: Offer[] = []
  shop: ShopItem[] = []
  event: GameEvent | null = null
  prompt = ''
  buildOpen = false
  heatPick = 0
  rebinding: Btn | null = null
  death: View['death'] = null
  victory: View['victory'] = null
  log = ''
  cam: Camera = makeCamera()
  shake = 0
  hitstop = 0
  private shown = ''
  private previews: CardPreview[] = []
  private toasts: { text: string; life: number }[] = []
  private usesAtBoss = 0
  private resolving = false
  private lab = false
  input: Input
  audio = new AudioBus()
  private view: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private screenEl: HTMLElement

  constructor() {
    this.save = loadSave()
    this.heatPick = 0
    this.input = new Input(this.save.settings.bindings)
    this.input.onRebound = (btn, code) => {
      this.save.settings.bindings[btn] = code
      this.input.bindings = this.save.settings.bindings
      this.rebinding = null
      this.persist()
      this.refresh()
    }
    this.view = document.getElementById('view') as HTMLCanvasElement
    this.ctx = this.view.getContext('2d')!
    this.screenEl = document.getElementById('screen')!
    this.screenEl.addEventListener('click', (e) => this.onClick(e))
    this.screenEl.addEventListener('change', (e) => this.onChange(e))
    this.screenEl.addEventListener('input', (e) => this.onChange(e))
    window.addEventListener('keydown', (e) => {
      if (this.screen === 'reward' && ['Digit1', 'Digit2', 'Digit3'].includes(e.code)) {
        this.pickOffer(Number(e.code.slice(5)) - 1)
      }
    })
    window.addEventListener('pointerdown', () => this.audio.resume())
    this.applyBody()
    const errors = selfCheckPhysics()
    if (errors.length) this.toast(errors[0] ?? 'Physics check failed')
    this.refresh()
  }

  frame(dt: number): void {
    const input = this.input.sample()
    if (input.pausePressed && (this.screen === 'play' || this.screen === 'pause')) {
      this.screen = this.screen === 'pause' ? 'play' : 'pause'
      this.refresh()
    }
    if (input.buildPressed && this.screen === 'play') this.buildOpen = !this.buildOpen
    const speed = this.save.settings.gameSpeed
    if (this.hitstop > 0 && !this.save.settings.reducedEffects) this.hitstop -= dt
    else if ((this.screen === 'play' || this.lab) && this.sim && this.screen !== 'pause') {
      const rect = this.view.getBoundingClientRect()
      const mouse = screenToWorld(this.cam, input.mx - rect.left, input.my - rect.top, rect.width, rect.height)
      this.sim.update(dt * speed, input, mouse)
      if (this.run) {
        this.run.cinders += this.sim.takeCinders()
        this.run.hp = this.sim.hp
        this.run.energy = this.sim.energy
        this.run.bestCombo = Math.max(this.run.bestCombo, this.sim.bestCombo)
        this.run.maxSpeed = Math.max(this.run.maxSpeed, hypot(this.sim.ball.vx, this.sim.ball.vy))
      }
      this.prompt = this.tutorialPrompt()
    }
    this.shake *= Math.exp(-6 * dt)
    this.resize()
    const w = this.view.clientWidth
    const h = this.view.clientHeight
    if (this.sim && (this.screen === 'play' || this.screen === 'pause' || this.lab)) {
      updateCamera(this.cam, this.sim, dt, this.shake * (this.save.settings.reducedEffects ? 0 : this.save.settings.screenShake), w, h)
      drawWorld(this.ctx, this.sim, this.cam, w, h, this.save.settings.reducedEffects, this.save.settings.colorblind)
    } else {
      drawTitleScene(this.ctx, w, h, performance.now() / 1000)
    }
    updateHud(this.screen === 'play' || this.screen === 'pause' || this.lab ? this.sim : null, this.run, this.run ? currentBuild(this.run) : this.lab && this.sim ? this.sim.build : null, this.prompt, this.buildOpen)
    this.stepPreviews(dt)
    this.audio.update(dt, this.sim && this.sim.grounded ? Math.min(1, hypot(this.sim.ball.vx, this.sim.ball.vy) / 900) : 0, this.sim?.stats.mass ?? 1)
    this.tickToasts(dt)
    this.input.endFrame()
  }

  private tutorialPrompt(): string {
    if (!this.run?.tutorial || !this.sim) return ''
    if (this.run.tutorialStep === 0) {
      if (this.sim.exitOpen) return 'Gate open. Roll into the frame on the right.'
      if (hypot(this.sim.ball.vx, this.sim.ball.vy) < 120) return 'A / D rolls. W or Space hops. Shift dashes. The grunt is on the open floor.'
      return 'Speed is the weapon. Hit the grunt while you are actually moving.'
    }
    if (this.sim.exitOpen) return 'Same gate. Notice how the new core hops, turns, and hits.'
    return 'The floor is safe. The stairs are optional. Feel the difference.'
  }

  private onClick(e: Event): void {
    const el = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null
    if (!el) return
    this.audio.resume()
    this.audio.ui('ok')
    const act = el.dataset.act
    const arg = el.dataset.arg ?? ''
    if (act === 'launch') this.launch(arg === 'tutorial')
    else if (act === 'title') this.goTitle()
    else if (act === 'lab') this.openLab()
    else if (act === 'codex') { this.returnTo = this.screen === 'pause' ? 'pause' : 'title'; this.screen = 'codex'; this.refresh() }
    else if (act === 'settings') { this.returnTo = this.screen; this.screen = 'settings'; this.refresh() }
    else if (act === 'close') { this.screen = this.returnTo; this.refresh() }
    else if (act === 'tab') { this.codexTab = arg as View['codexTab']; this.refresh() }
    else if (act === 'heat') { this.heatPick = Math.min(this.save.heatUnlocked, Number(arg)); this.refresh() }
    else if (act === 'unlock') this.unlock(arg)
    else if (act === 'rebind') { this.rebinding = arg as Btn; this.input.rebinding = this.rebinding; this.refresh() }
    else if (act === 'reset-save') {
      if (confirm('Erase Ballborn progress on this machine?')) {
        localStorage.removeItem('ballborn-save-v1')
        this.save = loadSave()
        this.goTitle()
      }
    }
    else if (act === 'enter') this.enterNode(arg)
    else if (act === 'offer') this.pickOffer(Number(arg))
    else if (act === 'reroll') this.reroll()
    else if (act === 'buy') this.buy(arg)
    else if (act === 'leave-shop') this.finishNode()
    else if (act === 'event') this.chooseEvent(arg)
    else if (act === 'resume') { this.screen = 'play'; this.refresh() }
    else if (act === 'abandon') this.abandon()
  }

  private onChange(e: Event): void {
    const t = e.target as HTMLInputElement
    if (t.dataset.slot && this.lab && this.run && this.sim) {
      const slot = t.dataset.slot as Slot
      this.run.ids[slot] = t.value || null
      const build = currentBuild(this.run)
      this.sim.syncBuild(build)
      this.refresh()
      return
    }
    if (t.dataset.set) {
      const key = t.dataset.set as 'screenShake' | 'sfx' | 'music' | 'gameSpeed'
      this.save.settings[key] = Number(t.value)
      this.audio.setVolumes(this.save.settings.sfx, this.save.settings.music)
      this.persist()
    }
    if (t.dataset.flag) {
      const key = t.dataset.flag as 'reducedEffects' | 'highContrast' | 'colorblind'
      this.save.settings[key] = t.checked
      this.applyBody()
      this.persist()
    }
  }

  launch(tutorial: boolean): void {
    this.lab = false
    this.run = createRun(this.heatPick, tutorial || !this.save.seenTutorial && tutorial)
    if (!tutorial) this.run.tutorial = false
    this.save.stats.runs++
    this.persist()
    this.resolving = false
    if (this.run.tutorial) this.beginRoom(ROOM_MAP['ignition-hall']!, true)
    else { this.screen = 'map'; this.sim = null; this.refresh() }
  }

  private openLab(): void {
    this.lab = true
    this.run = createRun(0, false)
    this.sim = new Simulation(ROOM_MAP['grate-crossing']!, currentBuild(this.run), {
      hp: 100, energy: 100, heat: 0, depth: 0, curse: false, gentle: true, god: true, lab: true, rng: this.run.rng,
    }, {})
    this.cam.x = 500
    this.cam.y = 420
    this.screen = 'lab'
    this.refresh()
  }

  private enterNode(id: string): void {
    if (!this.run) return
    const node = this.run.nodes.find((n) => n.id === id)
    if (!node || node.state !== 'open') return
    this.run.currentId = id
    const build = currentBuild(this.run)
    if (node.type === 'shop') {
      this.shop = makeShop(this.run, this.save)
      this.screen = 'shop'
      this.refresh()
      return
    }
    if (node.type === 'event') {
      this.event = rollEvent(this.run)
      this.screen = 'event'
      this.refresh()
      return
    }
    if (node.type === 'treasure') {
      this.offers = makeOffers(this.run, this.save, 'treasure')
      this.screen = 'reward'
      this.refresh()
      return
    }
    const template = pickTemplate(this.run, build, node.type)
    this.beginRoom(template, false)
  }

  private beginRoom(template: (typeof ROOM_MAP)[string], gentle: boolean): void {
    if (!this.run) return
    const build = currentBuild(this.run)
    if (template.type === 'boss') this.usesAtBoss = this.run.abilityUses
    for (const spawn of template.spawns) this.meetEnemy(spawn.id)
    this.sim = new Simulation(template, build, {
      hp: this.run.hp,
      energy: this.run.energy,
      heat: this.run.heat,
      depth: this.run.roomsCleared,
      curse: this.run.curseNext,
      gentle,
      god: false,
      lab: false,
      rng: this.run.rng,
    }, this.listeners())
    this.run.curseNext = false
    this.run.templatesSeen.push(template.id)
    this.run.roomDamage = 0
    this.resolving = false
    this.cam.x = template.player.x
    this.cam.y = template.player.y
    this.screen = 'play'
    this.say(`${template.name}. ${template.objective}`)
    this.refresh()
  }

  private listeners() {
    return {
      onDeath: (cause: string) => this.onDeath(cause),
      onClear: () => this.onClear(),
      onDiscovery: (id: string) => this.onDiscovery(id),
      onToast: (text: string) => { if (text) this.toast(text) },
      onShake: (mag: number) => { this.shake = Math.min(16, this.shake + mag) },
      onHitstop: (time: number) => { if (!this.save.settings.reducedEffects) this.hitstop = Math.max(this.hitstop, time) },
      onImpactSfx: (speed: number) => this.audio.impact(speed, this.sim?.stats.mass ?? 1, this.sim?.build.visual.material ?? 'metal'),
      onBounceSfx: (speed: number) => this.audio.bounce(speed, this.sim?.build.visual.material ?? 'metal'),
      onHurt: () => this.audio.hurt(),
      onAbility: (kind: string) => {
        if (kind !== 'slam-land' && this.run) this.run.abilityUses++
        this.audio.ability(kind)
      },
      onCombo: (n: number) => {
        if (!this.run) return
        this.run.bestCombo = Math.max(this.run.bestCombo, n)
        this.grant(bumpAchievement(this.save, 'combo-forge', n, 'max'))
        this.save.stats.bestCombo = Math.max(this.save.stats.bestCombo, n)
      },
      onKill: (info: { reflected: boolean; slam: boolean }) => {
        if (!this.run) return
        this.run.kills++
        this.grant(bumpAchievement(this.save, 'first-blood', 1, 'set'))
        if (info.reflected) {
          this.run.reflectedKills++
          this.grant(bumpAchievement(this.save, 'ricochet', 1, 'set'))
        }
        if (info.slam) this.grant(bumpAchievement(this.save, 'slam-poetry', 1, 'set'))
      },
      onSpeed: (speed: number) => {
        if (!this.run) return
        this.run.maxSpeed = Math.max(this.run.maxSpeed, speed)
        this.save.stats.bestSpeed = Math.max(this.save.stats.bestSpeed, speed)
        this.grant(bumpAchievement(this.save, 'terminal-velocity', speed, 'max'))
      },
      onHit: (damage: number) => {
        if (!this.run) return
        this.run.bestHit = Math.max(this.run.bestHit, damage)
        this.run.damageDealt += damage
        this.save.stats.bestHit = Math.max(this.save.stats.bestHit, damage)
        this.grant(bumpAchievement(this.save, 'heavy-hand', damage, 'max'))
      },
    }
  }

  private onClear(): void {
    if (!this.run || !this.sim || this.resolving) return
    this.resolving = true
    this.run.hp = this.sim.hp
    this.run.energy = this.sim.energy
    this.run.damageTaken += this.sim.roomDamage
    const regen = this.run.hp + Math.max(6, this.sim.maxHp * (0.1 - this.run.heat * 0.022))
    this.run.hp = Math.min(this.sim.maxHp, regen)
    this.grant(bumpAchievement(this.save, 'ignition', 1, 'set'))
    if (this.sim.room.type === 'elite' && this.sim.roomDamage <= 0) this.grant(bumpAchievement(this.save, 'unmarked', 1, 'set'))
    if (this.run.tutorial && this.run.tutorialStep === 0) {
      this.offers = makeOffers(this.run, this.save, 'combat')
      this.screen = 'reward'
      this.refresh()
      return
    }
    if (this.run.tutorial && this.run.tutorialStep === 1) {
      this.run.tutorial = false
      this.save.seenTutorial = true
      this.run.nodes = createRun(this.run.heat, false, this.run.seed).nodes
      this.screen = 'map'
      this.toast('The foundry opens. Pick a route.')
      this.persist()
      this.refresh()
      return
    }
    if (this.sim.room.type === 'boss') {
      this.win()
      return
    }
    const kind = this.sim.room.type === 'elite' ? 'elite' : this.sim.room.type === 'combat' ? 'combat' : 'soft'
    this.offers = makeOffers(this.run, this.save, kind)
    for (const o of this.offers) if (o.componentId) this.discoverComponent(o.componentId)
    this.screen = 'reward'
    this.refresh()
  }

  private onDeath(cause: string): void {
    if (!this.run || this.resolving) return
    this.resolving = true
    const scrap = 4 + this.run.roomsCleared * 3 + this.run.elitesKilled * 6
    this.save.scrap += scrap
    this.death = { cause, tip: deathTip(this.run, cause), scrap, idea: nextIdea(this.run, this.save) }
    this.screen = 'death'
    this.lab = false
    this.persist()
    this.say('The ball breaks.')
    this.refresh()
  }

  private win(): void {
    if (!this.run || !this.sim) return
    const build = currentBuild(this.run)
    const scrap = 24 + this.run.roomsCleared * 4 + this.run.heat * 10
    this.save.scrap += scrap
    this.save.embers += 1
    this.save.stats.wins++
    if (this.run.heat >= this.save.heatUnlocked && this.save.heatUnlocked < 3) {
      this.save.heatUnlocked++
      this.toast(`Forge Heat ${this.save.heatUnlocked} unlocked`)
    }
    if (!this.run.commonBroken) this.grant(bumpAchievement(this.save, 'common-stock', 1, 'set'))
    if ((build.tags.fire ?? 0) >= 3) this.grant(bumpAchievement(this.save, 'three-flames', 1, 'set'))
    if (this.run.heat >= 2) this.grant(bumpAchievement(this.save, 'heat-tempered', 1, 'set'))
    if (this.sim.roomDamage <= 0) this.grant(bumpAchievement(this.save, 'unmarked', 1, 'set'))
    if (this.sim.abilityDamage <= 0) this.grant(bumpAchievement(this.save, 'pure-collision', 1, 'set'))
    if (this.run.abilityUses <= this.usesAtBoss) this.grant(bumpAchievement(this.save, 'patient-steel', 1, 'set'))
    this.victory = { scrap, idea: nextIdea(this.run, this.save), archetype: build.archetype }
    this.screen = 'victory'
    this.persist()
    this.say(`${build.archetype} finishes the foundry.`)
    this.refresh()
  }

  private pickOffer(index: number): void {
    if (!this.run || this.screen !== 'reward') return
    const offer = this.offers[index]
    if (!offer) return
    const node = this.run.nodes.find((n) => n.id === this.run?.currentId)
    if (offer.kind === 'component' && offer.componentId && offer.slot) {
      const comp = COMPONENT_MAP[offer.componentId]
      if (comp) {
        const before = this.run.hp / Math.max(1, currentBuild(this.run).stats.maxHp)
        this.run.ids[offer.slot] = offer.componentId
        noteRarity(this.run, comp.rarity)
        this.discoverComponent(offer.componentId)
        const next = currentBuild(this.run)
        this.run.hp = Math.max(1, next.stats.maxHp * before)
        this.toast(`${comp.name} locks into the ${offer.slot}.`)
      }
    } else if (offer.kind === 'heal') {
      const max = currentBuild(this.run).stats.maxHp
      this.run.hp = Math.min(max, this.run.hp + (offer.amount ?? 20))
      this.toast('The shell is welded.')
    } else if (offer.kind === 'cinders') {
      this.run.cinders += offer.amount ?? 0
    } else if (offer.kind === 'reroll') this.run.rerolls += offer.amount ?? 1
    else if (offer.kind === 'ember') this.run.embers += offer.amount ?? 1
    if (this.run.tutorial && this.run.tutorialStep === 0) {
      this.run.tutorialStep = 1
      this.run.roomsCleared = 1
      this.beginRoom(ROOM_MAP['prove-it']!, false)
      return
    }
    if (node?.type === 'treasure' || node?.type === 'combat' || node?.type === 'elite' || node?.type === 'challenge' || node?.type === 'traversal') {
      this.finishNode()
    }
  }

  private reroll(): void {
    if (!this.run || this.run.rerolls <= 0 || this.screen !== 'reward') return
    this.run.rerolls--
    const node = this.run.nodes.find((n) => n.id === this.run?.currentId)
    const kind = node?.type === 'treasure' ? 'treasure' : node?.type === 'elite' ? 'elite' : 'combat'
    this.offers = makeOffers(this.run, this.save, kind)
    this.refresh()
  }

  private buy(id: string): void {
    if (!this.run) return
    const item = this.shop.find((s) => s.id === id)
    if (!item || item.sold || this.run.cinders < item.cost) return
    this.run.cinders -= item.cost
    item.sold = true
    if (item.kind === 'heal') this.run.hp = Math.min(currentBuild(this.run).stats.maxHp, this.run.hp + currentBuild(this.run).stats.maxHp * 0.45)
    if (item.kind === 'reroll') this.run.rerolls++
    if (item.kind === 'ember') this.run.embers++
    if (item.kind === 'component' && item.componentId) {
      const comp = COMPONENT_MAP[item.componentId]
      if (comp) {
        this.run.ids[comp.slot] = comp.id
        noteRarity(this.run, comp.rarity)
        this.discoverComponent(comp.id)
        this.toast(`${comp.name} is fitted.`)
      }
    }
    this.refresh()
  }

  private chooseEvent(id: string): void {
    if (!this.run) return
    const text = applyEvent(this.run, id, this.save)
    if (id === 'rubber') this.discoverComponent('reinforced-rubber')
    if (id === 'inferno') this.discoverComponent('inferno-impact')
    if (id === 'combust') this.discoverComponent('combustion-impact')
    if (id === 'fuse-ember') {
      for (const slot of SLOTS) {
        const cid = this.run.ids[slot]
        if (cid) this.discoverComponent(cid)
      }
    }
    this.toast(text)
    this.finishNode()
  }

  private finishNode(): void {
    if (!this.run) return
    const node = this.run.nodes.find((n) => n.id === this.run?.currentId)
    if (node && node.state !== 'done') {
      node.state = 'done'
      this.run.roomsCleared++
      if (node.type === 'elite') {
        this.run.elitesKilled++
        this.run.embers += 1
        this.toast('An ember from the elite.')
      }
      for (const id of node.next) {
        const nxt = this.run.nodes.find((n) => n.id === id)
        if (nxt && nxt.state === 'locked') nxt.state = 'open'
      }
    }
    this.screen = 'map'
    this.sim = null
    this.refresh()
  }

  private abandon(): void {
    if (!this.run) return this.goTitle()
    this.save.scrap += 2
    this.death = { cause: 'abandon', tip: 'You left the ball on the floor. The idea can still be the next one.', scrap: 2, idea: nextIdea(this.run, this.save) }
    this.screen = 'death'
    this.sim = null
    this.persist()
    this.refresh()
  }

  private unlock(id: string): void {
    const comp = COMPONENT_MAP[id]
    if (!comp || this.save.unlocked.includes(id) || this.save.scrap < comp.unlockCost) return
    this.save.scrap -= comp.unlockCost
    this.save.unlocked.push(id)
    this.discoverComponent(id)
    this.toast(`Schematic forged: ${comp.name}`)
    this.persist()
    this.refresh()
  }

  private discoverComponent(id: string): void {
    if (!this.save.discoveredComponents.includes(id)) this.save.discoveredComponents.push(id)
  }

  private meetEnemy(id: string): void {
    if (this.save.discoveredEnemies.includes(id)) return
    this.save.discoveredEnemies.push(id)
    this.toast(`Seen: ${id.replace('-', ' ')}`)
  }

  private onDiscovery(id: string): void {
    const syn = SYNERGY_MAP[id]
    if (!syn || this.save.discoveredSynergies.includes(id)) return
    this.save.discoveredSynergies.push(id)
    this.toast(`Discovery — ${syn.name}. ${syn.description}`)
    this.say(`Discovery. ${syn.name}.`)
    this.grant(bumpAchievement(this.save, 'scholar', this.save.discoveredSynergies.length, 'max'))
    this.persist()
  }

  private grant(grants: { text: string }[]): void {
    for (const g of grants) this.toast(g.text)
    if (grants.length) this.persist()
  }

  private goTitle(): void {
    this.lab = false
    this.sim = null
    this.run = null
    this.screen = 'title'
    this.returnTo = 'title'
    this.refresh()
  }

  private applyBody(): void {
    document.body.classList.toggle('contrast', this.save.settings.highContrast)
    document.body.classList.toggle('reduce-motion', this.save.settings.reducedEffects)
    this.audio.setVolumes(this.save.settings.sfx, this.save.settings.music)
  }

  private persist(): void {
    writeSave(this.save)
  }

  private toast(text: string): void {
    this.toasts.push({ text, life: 2.6 })
  }

  private say(text: string): void {
    const live = document.getElementById('live')
    if (live) live.textContent = text
  }

  private tickToasts(dt: number): void {
    const root = document.getElementById('toasts')!
    this.toasts.forEach((t) => { t.life -= dt })
    const next = this.toasts.filter((t) => t.life > 0)
    if (next.length !== this.toasts.length || root.childElementCount !== next.length) {
      root.innerHTML = next.map((t) => `<div class="toast">${t.text}</div>`).join('')
    }
    this.toasts = next
  }

  private stepPreviews(dt: number): void {
    if (this.screen !== 'reward') return
    const canvases = this.screenEl.querySelectorAll('canvas[data-preview]')
    canvases.forEach((node, i) => {
      const canvas = node as HTMLCanvasElement
      const ctx = canvas.getContext('2d')
      const preview = this.previews[i]
      if (!ctx || !preview) return
      preview.step(ctx, dt)
    })
  }

  private refresh(): void {
    const build = this.run ? currentBuild(this.run) : null
    const view: View = {
      screen: this.screen,
      codexTab: this.codexTab,
      save: this.save,
      run: this.run,
      build,
      offers: this.offers,
      shop: this.shop,
      event: this.event,
      prompt: this.prompt,
      buildOpen: this.buildOpen,
      death: this.death,
      victory: this.victory,
      rebinding: this.rebinding,
      heatPick: this.heatPick,
      log: this.log,
    }
    const loadout = this.run ? SLOTS.map((slot) => this.run?.ids[slot] ?? '').join(',') : ''
    const key = `${this.screen}|${this.codexTab}|${this.offers.map((o) => o.title).join(',')}|${this.shop.map((s) => `${s.id}:${s.sold}`).join(',')}|${this.event?.id}|${this.rebinding}|${this.heatPick}|${this.run?.cinders}|${this.run?.hp}|${loadout}|${this.run?.nodes.map((n) => n.state).join('')}`
    if (key !== this.shown) {
      this.shown = key
      this.screenEl.className = this.screen
      this.screenEl.innerHTML = screenHtml(view)
      this.previews = []
      if (this.screen === 'reward' && build) {
        this.offers.forEach((offer, i) => {
          const canvas = this.screenEl.querySelector(`canvas[data-preview="${i}"]`) as HTMLCanvasElement | null
          if (!canvas) return
          let stats = build.stats
          let visual = build.visual
          if (offer.componentId && offer.slot && this.run) {
            const next = compileBuild({ ...this.run.ids, [offer.slot]: offer.componentId }, this.run.mods)
            stats = next.stats
            visual = next.visual
          }
          this.previews[i] = new CardPreview(stats, visual)
          void canvas
        })
      }
    }
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
