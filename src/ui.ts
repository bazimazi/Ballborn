import { COMPONENTS, COMPONENT_MAP } from './data/components'
import { DAMAGE_RULES } from './data/damage'
import { ENEMIES } from './data/enemies'
import { ACHIEVEMENTS, HEATS, heatOf } from './data/meta'
import { SYNERGIES } from './data/synergies'
import { feelNumbers } from './build'
import type { CompiledBuild, DamageSource, HitSource, Stats } from './types'
import { SLOTS, type Slot } from './types'
import type { GameEvent } from './events'
import type { RoomGrade } from './grade'
import { previewSwap, routeInfo, salvageValue, type MapNode, type Offer, type RouteStep, type RunState, type ShopItem } from './run'
import type { SaveData, Btn } from './save'
import { BTNS, DEFAULT_BINDINGS } from './save'
import type { Simulation } from './sim'
import { TUNE } from './tune'
import { escapeHtml as esc, hypot } from './util'
import { svg, type IconName } from './icons'

const ICONS = 'art/foundry-v1/icons/'
const icon = (name: string, size = 22): string => `<img class="ico" src="${ICONS}${name}.svg" alt="" width="${size}" height="${size}" />`

export type Screen =
  | 'title' | 'settings' | 'codex' | 'lab' | 'map' | 'play'
  | 'reward' | 'shop' | 'event' | 'pause' | 'death' | 'victory'

export interface RunSummary {
  kind: 'death' | 'victory' | 'abandon'
  title: string
  cause: string
  tip: string
  scrap: number
  idea: string
  archetype: string
  components: string[]
  route: RouteStep[]
  taken: [string, number][]
  dealt: [string, number][]
  highlights: { icon: IconName; value: string; label: string }[]
  decisions: string[]
  assist: boolean
  seed: number
  heat: number
  line: string
  score: number
  scoreLines: { label: string; points: number }[]
  newBest: boolean
  grades: RoomGrade[]
  daily: string | null
  /** Plain text for the clipboard: the day, the score, the grade strip. */
  share: string
}

export interface View {
  screen: Screen
  codexTab: 'rules' | 'components' | 'synergies' | 'enemies' | 'achievements'
  save: SaveData
  run: RunState | null
  build: CompiledBuild | null
  offers: Offer[]
  shop: ShopItem[]
  event: GameEvent | null
  summary: RunSummary | null
  rebinding: Btn | null
  heatPick: number
  hasCheckpoint: boolean
  labPaused: boolean
  confirmAbandon: boolean
  saveWarning: string
  seedText: string
  /** The player is on a touch screen: no key hints, touch wording. */
  touch: boolean
  canFullscreen: boolean
  /** Which lab drawer is open: a slot's parts, the presets, or the numbers. */
  labPanel: Slot | 'presets' | 'stats' | null
  /** Map room picked on a touch screen, shown before entering. */
  selectedNode: string | null
  confirmErase: boolean
  /** Today's Daily Forge key. */
  dailyKey: string
}

export const SLOT_LABEL: Record<Slot, string> = {
  core: 'Core', shell: 'Shell', momentum: 'Momentum', impact: 'Impact', ability: 'Ability', passive: 'Passive',
}

export const HIT_LABEL: Record<HitSource, string> = {
  collision: 'Rams', ability: 'Abilities', effect: 'Part effects', reflect: 'Reflected shots', status: 'Burns', hazard: 'Hazards',
}

const BTN_LABEL: Record<Btn, string> = {
  left: 'Roll left', right: 'Roll right', up: 'Hop', down: 'Drop', ability: 'Ability', pause: 'Pause', build: 'Build sheet',
}

export function keyName(code: string): string {
  return code.replace(/^Key/, '').replace(/^Digit/, '').replace(/Left$|Right$/, (m) => ` ${m}`).replace('Arrow', 'Arrow ')
}

export function damageLabel(source: string): string {
  return DAMAGE_RULES[source as DamageSource]?.label ?? source
}

// ---------------------------------------------------------------------------
// HUD. Element references are cached and text is only written when it changes.

export class Hud {
  private els = new Map<string, HTMLElement>()
  private sheetBuild: CompiledBuild | null = null
  private last = new Map<string, string>()

  private el(id: string): HTMLElement {
    let el = this.els.get(id)
    if (!el) {
      el = document.getElementById(id)!
      this.els.set(id, el)
    }
    return el
  }

  private text(id: string, value: string): void {
    if (this.last.get(id) === value) return
    this.last.set(id, value)
    this.el(id).textContent = value
  }

  private html(id: string, value: string): void {
    if (this.last.get(`${id}#html`) === value) return
    this.last.set(`${id}#html`, value)
    this.el(id).innerHTML = value
  }

  private style(id: string, prop: 'width' | 'background', value: string): void {
    const key = `${id}.${prop}`
    if (this.last.get(key) === value) return
    this.last.set(key, value)
    // Bars fill with a transform, not a width: no layout every frame, and the compositor animates it.
    if (prop === 'width') this.el(id).style.transform = `scaleX(${(Math.max(0, Math.min(100, parseFloat(value) || 0)) / 100).toFixed(3)})`
    else this.el(id).style[prop] = value
  }

  private attr(id: string, name: string, value: string): void {
    const key = `${id}@${name}`
    if (this.last.get(key) === value) return
    this.last.set(key, value)
    this.el(id).setAttribute(name, value)
  }

  private prop(id: string, name: string, value: string): void {
    const key = `${id}--${name}`
    if (this.last.get(key) === value) return
    this.last.set(key, value)
    this.el(id).style.setProperty(name, value)
  }

  private toggle(id: string, cls: string, on: boolean): void {
    const key = `${id}.${cls}`
    const v = on ? '1' : ''
    if (this.last.get(key) === v) return
    this.last.set(key, v)
    this.el(id).classList.toggle(cls, on)
  }

  private show(id: string, on: boolean): void {
    const el = this.el(id)
    if (el.hidden === on) el.hidden = !on
  }

  /** Play a short Web Animation unless the player asked for reduced motion. */
  private pulse(id: string, frames: Keyframe[], ms: number): void {
    if (document.body.classList.contains('reduce-motion')) return
    this.el(id).animate(frames, { duration: ms, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' })
  }

  private sim: Simulation | null = null
  private hpChip = 100
  private chipHold = 0
  private bossChip = 100
  private lastHp = 0
  private lastCombo = 0
  private bannerLeft = 0

  /** A big title that slams in and fades: room names, the boss, the open gate. */
  banner(title: string, sub: string, kind: 'room' | 'boss' | 'clear' | 'phase', portrait = ''): void {
    const el = this.el('banner')
    el.innerHTML = `<div class="banner-inner ${kind}">${portrait ? `<img class="portrait" src="${portrait}" alt="" />` : ''}<div class="banner-title">${esc(title)}</div>${sub ? `<div class="banner-sub">${esc(sub)}</div>` : ''}</div>`
    this.bannerLeft = kind === 'boss' ? 3.2 : kind === 'room' ? 2.4 : 1.6
  }

  /** Cinders reached the counter. */
  bumpCinders(): void {
    this.pulse('cinder-chip', [{ transform: 'scale(1.35)' }, { transform: 'scale(1)' }], 260)
  }

  update(sim: Simulation | null, run: RunState | null, build: CompiledBuild | null, save: SaveData, prompt: string, buildOpen: boolean, dt = 0): void {
    const playing = !!sim && !!build
    const hud = this.el('hud')
    if (hud.hidden === playing) hud.hidden = !playing
    if (this.bannerLeft > 0) {
      this.bannerLeft -= dt
      if (this.bannerLeft <= 0) this.el('banner').replaceChildren()
    }
    if (!playing || !sim || !build) return
    if (sim !== this.sim) {
      this.sim = sim
      this.hpChip = (sim.hp / sim.maxHp) * 100
      this.lastHp = sim.hp
      this.lastCombo = 0
      this.bossChip = 100
    }
    const hpPct = Math.max(0, sim.hp / sim.maxHp) * 100
    const low = sim.lowHp
    // The chip bar trails behind damage so the size of a hit stays readable.
    if (sim.hp < this.lastHp - 0.4) {
      this.chipHold = 0.45
      if (this.lastHp - sim.hp >= 3) {
        this.pulse('hp-meter', [{ transform: 'translate(-6px, 2px)' }, { transform: 'translate(5px, -2px)' }, { transform: 'translate(-3px, 1px)' }, { transform: 'none' }], 260)
        this.toggle('hp-meter', 'hurt', true)
      }
    } else if (sim.hp > this.lastHp + 0.4) {
      this.pulse('hp-meter', [{ filter: 'brightness(1.8)' }, { filter: 'none' }], 400)
    }
    this.lastHp = sim.hp
    this.chipHold -= dt
    if (this.chipHold <= 0) this.hpChip = Math.max(hpPct, this.hpChip - dt * 70)
    if (this.hpChip < hpPct) this.hpChip = hpPct
    if (this.chipHold < 0.2) this.toggle('hp-meter', 'hurt', false)
    this.style('hp-bar', 'width', `${hpPct.toFixed(1)}%`)
    this.style('hp-chip', 'width', `${this.hpChip.toFixed(1)}%`)
    this.style('shield-bar', 'width', `${Math.min(100, (sim.shield / sim.maxHp) * 100).toFixed(1)}%`)
    this.toggle('hp-meter', 'low', low)
    this.html('hp-num', `<b>${Math.ceil(sim.hp)}</b><small>/${Math.ceil(sim.maxHp)}</small>${sim.shield > 0 ? `<em>+${Math.ceil(sim.shield)}</em>` : ''}`)
    this.attr('hp-meter', 'aria-label', `Integrity ${Math.ceil(sim.hp)} of ${Math.ceil(sim.maxHp)}${sim.shield > 0 ? `, shield ${Math.ceil(sim.shield)}` : ''}`)
    this.text('room-name', sim.room.name)
    // The objective reads as an icon and a count; the sentence is for hover and screen readers.
    this.html('room-obj', objectiveBadge(sim))
    const goal = sim.exitOpen ? 'Gate open' : sim.objectiveText()
    this.attr('room-obj', 'aria-label', goal)
    this.attr('room-obj', 'title', goal)
    this.toggle('room-obj', 'open', sim.exitOpen)
    const cinders = run ? run.cinders + sim.cinderPocket : 0
    this.text('cinders', run ? `${cinders}` : '')
    this.attr('cinder-chip', 'aria-label', `${cinders} cinders`)
    this.text('embers', `${save.embers}`)
    // Boss integrity lives in the HUD, like every other health bar that matters.
    const boss = sim.boss
    this.show('boss-bar', !!boss && boss.alive)
    if (boss && boss.alive) {
      const pct = Math.max(0, boss.hp / boss.maxHp) * 100
      this.bossChip = this.bossChip > pct ? Math.max(pct, this.bossChip - dt * 30) : pct
      this.style('boss-fill', 'width', `${pct.toFixed(1)}%`)
      this.style('boss-chip', 'width', `${this.bossChip.toFixed(1)}%`)
      this.text('boss-phase', `${boss.phase}/3`)
      this.attr('boss-bar', 'data-phase', String(boss.phase))
    }
    const ability = build.ability
    const block = sim.abilityBlock()
    this.text('ability-key', keyName(save.settings.bindings.ability))
    const state = !ability ? '' : block === 'cooldown' ? `${sim.abilityCd.toFixed(1)}s` : block === 'energy' ? `⚡${Math.ceil(ability.energy)}` : 'Ready'
    this.text('ability-state', state)
    const readyNow = !!ability && block === null
    if (readyNow && this.last.get('ability-readout@data-state') !== 'ready') this.pulse('ability-dial', [{ transform: 'scale(1.3)', filter: 'brightness(2)' }, { transform: 'scale(1)', filter: 'none' }], 420)
    this.attr('ability-readout', 'data-state', !ability ? 'none' : block ?? 'ready')
    this.attr('ability-dial', 'aria-label', ability ? `${ability.name}: ${state || 'ready'}` : 'No ability')
    const cd = ability && sim.abilityCd > 0 ? 1 - sim.abilityCd / ability.cooldown : 1
    this.prop('ability-dial', '--p', `${(Math.max(0, Math.min(1, cd)) * 100).toFixed(0)}%`)
    this.style('energy-bar', 'width', `${((sim.energy / build.stats.energyMax) * 100).toFixed(0)}%`)
    const speed = Math.round(hypot(sim.ball.vx, sim.ball.vy))
    const ratio = speed / Math.max(1, sim.stats.maxSpeed)
    const armed = ratio >= TUNE.cleanRamRatio
    this.style('speed-bar', 'width', `${(Math.min(1, ratio) * 100).toFixed(0)}%`)
    this.toggle('speed-meter', 'armed', armed && !sim.overdrive)
    this.toggle('speed-meter', 'hot', sim.overdrive)
    this.text('ram-tag', sim.overdrive ? 'Hot' : 'Ram')
    // Combo: a big number that pops on every link and drains between them.
    this.show('combo', sim.combo > 1)
    if (sim.combo > 1) {
      this.text('combo-num', `×${sim.combo}`)
      if (sim.combo > this.lastCombo) this.pulse('combo', [{ transform: `scale(${1.25 + Math.min(0.4, sim.combo * 0.03)}) rotate(-4deg)` }, { transform: 'scale(1) rotate(0)' }], 300)
      this.style('combo-timer', 'width', `${(Math.max(0, sim.comboTimer / TUNE.comboWindow) * 100).toFixed(0)}%`)
      this.attr('combo', 'data-tier', sim.combo >= 10 ? '3' : sim.combo >= 6 ? '2' : '1')
      this.toggle('combo', 'hot', sim.overdrive)
      this.text('combo-label', sim.overdrive ? 'White hot' : 'Combo')
    }
    this.lastCombo = sim.combo
    this.text('instability-read', sim.instability > 2 ? `⚠ ${Math.round(sim.instability)}%` : '')
    const promptEl = this.el('prompt')
    if (promptEl.hidden !== !prompt) promptEl.hidden = !prompt
    this.text('prompt', prompt)
    const sheet = this.el('sheet')
    if (sheet.hidden !== !buildOpen) sheet.hidden = !buildOpen
    // Compiled builds are cached per loadout and run modifiers, so the object itself says when the sheet is stale.
    if (buildOpen && this.sheetBuild !== build) {
      this.sheetBuild = build
      sheet.innerHTML = sheetHtml(build)
    }
  }
}


/** What the room wants, as an icon and a number: constructs left, seconds left, or the open gate. */
function objectiveBadge(sim: Simulation): string {
  if (sim.exitOpen) return `${svg('door', 18)}<b>→</b>`
  const boss = sim.boss
  if (boss && boss.alive) return boss.phase === 1 ? `${svg('target', 18)}<b>${boss.rivets.filter((r) => r.alive).length}</b>` : ''
  if (sim.room.rules?.includes('survival')) return `${svg('hourglass', 18)}<b>${Math.ceil(sim.survivalLeft)}</b>`
  if (sim.room.rules?.includes('speed-gate')) return svg('gauge', 18)
  const left = sim.enemies.filter((e) => e.alive).length
  return left ? `${svg('target', 18)}<b>${left}</b>` : ''
}

// ---------------------------------------------------------------------------
// Small shared pieces.

/** An icon-only button. The label is for screen readers and the hover tooltip. */
function iconBtn(act: string, ico: IconName, label: string, extra = ''): string {
  return `<button class="btn icon-btn" data-act="${act}" aria-label="${esc(label)}" title="${esc(label)}" ${extra}>${svg(ico)}</button>`
}

/** A big square button: icon on top, one short word under it. */
function tile(act: string, ico: IconName, word: string, label = word, extra = '', cls = ''): string {
  return `<button class="btn tile ${cls}" data-act="${act}" aria-label="${esc(label)}" ${extra}>${svg(ico, 28)}<span>${esc(word)}</span></button>`
}

/** Screen header: optional back button, kicker and title, and anything on the right. */
function header(title: string, kicker: string, opts: { back?: string; right?: string } = {}): string {
  return `<div class="screen-head">
    ${opts.back ? iconBtn(opts.back, 'back', 'Back', 'data-autofocus') : ''}
    <div class="head-text">${kicker ? `<div class="kicker">${esc(kicker)}</div>` : ''}<h2>${esc(title)}</h2></div>
    ${opts.right ? `<div class="head-right">${opts.right}</div>` : ''}
  </div>`
}

/** A number with an icon, like "♥ 104". */
function chip(ico: string, value: string, label: string, cls = ''): string {
  return `<span class="chip-stat ${cls}" title="${esc(label)}" aria-label="${esc(label)}">${ico}<b>${value}</b></span>`
}

/** A chip that says what it means when tapped, since touch screens have no hover. */
function infoChip(ico: string, value: string, label: string, cls = ''): string {
  return `<span class="chip-stat tappable ${cls}" data-act="explain" data-arg="${esc(label)}" title="${esc(label)}" aria-label="${esc(label)}">${ico}<b>${value}</b></span>`
}

/** A part's colour behind its slot icon, so parts in the same slot tell apart. */
function swatch(id: string | null | undefined, slot: Slot, size = 26): string {
  const v = id ? COMPONENT_MAP[id]?.visual : undefined
  const color = v?.core ?? v?.shell ?? v?.trail ?? '#3a2e25'
  return `<span class="swatch${id ? '' : ' empty'}" style="--c:${color}">${slotIcon(slot, size)}</span>`
}

function slotIcon(slot: Slot, size = 22): string {
  return icon(`slot-${slot}`, size)
}

function sheetHtml(build: CompiledBuild): string {
  return `
    <div class="sheet-head">
      <div><div class="kicker">Paused · build</div><h2>${esc(build.archetype)}</h2></div>
      <button class="hud-btn" data-touch="build" tabindex="-1" aria-label="Close build sheet">${svg('close')}</button>
    </div>
    ${slotGrid(build)}
    ${statTable(build.stats)}
    ${build.strengths.length ? `<p class="up">${svg('up', 12)} ${esc(build.strengths.join(' '))}</p>` : ''}
    ${build.weaknesses.length ? `<p class="down">${svg('down', 12)} ${esc(build.weaknesses.join(' '))}</p>` : ''}
    ${build.synergies.length ? `<div class="chips">${build.synergies.map((s) => `<span class="tag syn">${svg('link', 14)}${esc(s.name)}</span>`).join('')}</div>` : ''}
  `
}

/** The six slots as icon tiles, so a build reads at a glance. */
function slotGrid(build: CompiledBuild): string {
  return `<ul class="slot-grid">${SLOTS.map((slot) => {
    const id = build.ids[slot]
    const comp = id ? COMPONENT_MAP[id] : undefined
    return `<li class="${comp ? '' : 'empty'}" data-rarity="${comp?.rarity ?? ''}" title="${SLOT_LABEL[slot]}">${slotIcon(slot, 26)}<span>${comp ? esc(comp.name) : '—'}</span></li>`
  }).join('')}</ul>`
}

/** Numbers a player can check against the feel. */
export function statRows(s: Stats): [string, string][] {
  const accel = s.accel / Math.pow(s.mass, 0.8)
  const hop = s.hop / Math.pow(s.mass, 0.38)
  const hopHeight = (hop * hop) / (2 * s.gravity)
  return [
    ['Mass', s.mass.toFixed(2)],
    ['Top speed', `${Math.round(s.maxSpeed)}`],
    ['Acceleration', `${Math.round(accel)}`],
    ['Hop height', `${Math.round(hopHeight)} px`],
    ['Bounce', s.restitution.toFixed(2)],
    ['Ram power', (s.mass * s.impact).toFixed(2)],
    ['Armor', `${Math.round(s.damageReduction * 100)}%`],
    ['Recoil taken', `${Math.round(s.selfDamage * 100)}%`],
    ['Integrity', `${Math.round(s.maxHp)}`],
    ['Energy', `${Math.round(s.energyMax)} (+${s.energyRegen.toFixed(0)}/s)`],
  ]
}

function statTable(s: Stats, next?: Stats): string {
  const a = statRows(s)
  const b = next ? statRows(next) : null
  return `<table class="stats"><tbody>${a.map(([label, value], i) => {
    const after = b?.[i]?.[1]
    const changed = after !== undefined && after !== value
    return `<tr><th scope="row">${label}</th><td>${value}</td>${b ? `<td class="${changed ? 'changed' : 'muted'}">${changed ? `→ ${after}` : '—'}</td>` : ''}</tr>`
  }).join('')}</tbody></table>`
}

// ---------------------------------------------------------------------------
// Screens.

export function screenHtml(view: View): string {
  switch (view.screen) {
    case 'play':
      return ''
    case 'lab':
      return labHtml(view)
    case 'title':
      return titleHtml(view)
    case 'settings':
      return settingsHtml(view)
    case 'codex':
      return codexHtml(view)
    case 'map':
      return mapHtml(view)
    case 'reward':
      return rewardHtml(view)
    case 'shop':
      return shopHtml(view)
    case 'event':
      return eventHtml(view)
    case 'pause':
      return pauseHtml(view)
    case 'death':
    case 'victory':
      return summaryHtml(view)
    default:
      return ''
  }
}

function currencies(save: SaveData, run: RunState | null): string {
  return `<div class="currencies">
    ${run ? infoChip(icon('currency-cinders'), `${run.cinders}`, `${run.cinders} cinders: spent during this run`, 'cur cinder') : ''}
    ${infoChip(icon('currency-scrap'), `${save.scrap}`, `${save.scrap} scrap: forges new parts in the codex, between runs`, 'cur scrap')}
    ${infoChip(icon('currency-embers'), `${save.embers}`, `${save.embers} embers: kept between runs, spent on evolutions and fusions`, 'cur ember')}
  </div>`
}

function titleHtml(view: View): string {
  const heat = view.save.heatUnlocked
  const picked = heatOf(view.heatPick)
  const heats = HEATS.filter((h) => h.id <= heat).map((h) =>
    `<button class="btn heat-chip ${view.heatPick === h.id ? 'on' : ''}" data-act="heat" data-arg="${h.id}" aria-pressed="${view.heatPick === h.id}" aria-label="${esc(h.name)}" title="${esc(h.name)}" style="--h:${h.id}">${svg('flame', 16)}<b>${h.id}</b></button>`,
  ).join('')
  const letters = (word: string, from: number) => word.split('').map((c, i) => `<span style="--i:${from + i}">${c}</span>`).join('')
  const cont = view.hasCheckpoint
  const runSub = view.seedText ? `Seed ${esc(view.seedText)}` : view.heatPick > 0 ? `${esc(picked.name)} · fresh route` : 'A fresh route to the Colossus'
  const cta = (word: string, sub: string) => `<span class="cta-text"><b>${word}</b><small>${sub}</small></span>${svg('back', 18, 'cta-arrow')}`
  return `<div class="title-wrap">
    <div class="title-lockup">
      <div class="title-brand">
        <div class="title-eyebrow" aria-hidden="true"><span>Foundry roguelite</span></div>
        <h1 aria-label="Ballborn"><span class="logo-line">${letters('BALL', 0)}</span><span class="logo-line hot">${letters('BORN', 4)}</span></h1>
        <p class="tagline">Build a ball. Feel it. Break it. Rebuild it.</p>
      </div>
      <div class="title-actions">
        ${view.saveWarning ? `<p class="warn" role="status">${svg('warning', 18)} ${esc(view.saveWarning)}</p>` : ''}
        <nav class="title-menu" aria-label="Main menu">
          ${cont ? `<button class="btn primary big cta" data-act="continue" data-autofocus><span class="cta-ico">${svg('resume', 22)}</span>${cta('Continue', 'Back to the last safe point')}</button>` : ''}
          <button class="btn big cta ${cont ? 'secondary' : 'primary'}" data-act="launch" data-arg="run" ${cont ? '' : 'data-autofocus'}><span class="cta-ico">${svg(cont ? 'plus' : 'play', 22)}</span>${cta(cont ? 'New run' : view.save.seenTutorial ? 'Launch run' : 'Play', view.save.seenTutorial ? runSub : 'First ignition: learn to roll')}</button>
          ${view.save.seenTutorial ? dailyButton(view) : ''}
        </nav>
        <div class="tiles" role="group" aria-label="More">
          ${tile('launch', 'flame', view.save.seenTutorial ? 'Tutorial' : 'Ignition', view.save.seenTutorial ? 'Replay first ignition' : 'First ignition', 'data-arg="tutorial" style="--i:0"')}
          ${tile('lab', 'flask', 'Lab', 'Ball lab', 'style="--i:1"')}
          ${tile('codex', 'book', 'Codex', 'Codex', 'style="--i:2"')}
          ${tile('settings', 'gear', 'Settings', 'Settings', 'style="--i:3"')}
        </div>
        ${heat > 0 ? `<div class="heat-row">
          <div class="heat-head"><span class="heat-label">${svg('flame', 14)} Forge heat</span><b>${esc(picked.name)}</b></div>
          <div class="heat-seg" role="group" aria-label="Forge heat">${heats}</div>
          <ul class="heat-list">${picked.effects.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
        <details class="seed" ${view.seedText ? 'open' : ''}>
          <summary aria-label="Seed">${svg('hash', 18)}<span>Seed</span></summary>
          <label class="field">
            <span class="sr-only">Seed (optional, for a repeatable route)</span>
            <input data-seed type="text" inputmode="numeric" maxlength="10" value="${esc(view.seedText)}" placeholder="random" />
          </label>
        </details>
        <div class="title-foot">
          ${currencies(view.save, null)}
          ${chip(svg('trophy', 18), `${view.save.stats.wins}`, `${view.save.stats.wins} wins`)}
          ${chip(svg('flag', 18), `${view.save.stats.runs}`, `${view.save.stats.runs} runs`)}
          ${view.canFullscreen && view.touch ? iconBtn('fullscreen', 'fullscreen', 'Full screen', 'data-fs') : ''}
        </div>
      </div>
    </div>
  </div>`
}

/** The Daily Forge: one shared route per day, scored. */
function dailyButton(view: View): string {
  const key = view.dailyKey
  const d = view.save.daily?.key === key ? view.save.daily : null
  const best = d && d.tries ? `best ${d.best.toLocaleString('en-US')}${d.won ? ' ★' : ''}` : 'not yet run'
  return `<button class="btn big cta daily" data-act="launch" data-arg="daily" aria-label="${esc(`Daily Forge for ${key}, ${best}`)}"><span class="cta-ico">${svg('star', 20)}</span><span class="cta-text"><b>Daily Forge</b><small>${esc(key)} · ${esc(best)}</small></span>${d?.won ? `<span class="daily-badge">${svg('check', 14)}</span>` : `<span class="daily-badge new">Today</span>`}</button>`
}

function settingsHtml(view: View): string {
  const s = view.save.settings
  const range = (key: string, ico: IconName, label: string, min: number, max: number, step: number, value: number) =>
    `<label class="field range">
      <span class="field-head">${svg(ico, 18)}<span>${label}</span><output data-out="${key}">${Math.round(value * 100)}%</output></span>
      <input data-set="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" style="--fill:${(((value - min) / (max - min)) * 100).toFixed(1)}%" />
    </label>`
  const toggle = (key: string, label: string, value: boolean, hint = '') =>
    `<label class="toggle"><span>${label}${hint ? `<small class="muted">${hint}</small>` : ''}</span><input data-flag="${key}" type="checkbox" role="switch" ${value ? 'checked' : ''}/></label>`
  // Choices are a row of buttons, not drop-downs.
  const segment = (key: string, ico: IconName, label: string, options: [number, string][], value: number) =>
    `<div class="field"><span class="field-head">${svg(ico, 18)}<span>${label}</span></span>
      <div class="segmented" role="radiogroup" aria-label="${label}">${options.map(([v, l]) =>
        `<button class="btn seg ${value === v ? 'on' : ''}" role="radio" aria-checked="${value === v}" data-act="set" data-arg="${key}:${v}">${l}</button>`).join('')}</div></div>`
  const counts = new Map<string, number>()
  for (const btn of BTNS) counts.set(s.bindings[btn], (counts.get(s.bindings[btn]) ?? 0) + 1)
  const bind = (btn: Btn) => {
    const clash = (counts.get(s.bindings[btn]) ?? 0) > 1
    return `<button class="btn bind ${clash ? 'clash' : ''}" data-act="rebind" data-arg="${btn}"><span>${BTN_LABEL[btn]}</span><b>${view.rebinding === btn ? 'press a key…' : esc(keyName(s.bindings[btn]))}</b>${clash ? svg('warning', 16) : ''}</button>`
  }
  const erase = view.confirmErase
    ? `<div class="confirm-row" role="alertdialog" aria-label="Erase progress">
        <span class="down">${svg('warning', 18)} Erase everything? No undo.</span>
        <div class="row two"><button class="btn" data-act="erase-cancel" data-autofocus>${svg('back', 18)}<span>Keep</span></button><button class="btn danger" data-act="erase-confirm">${svg('trash', 18)}<span>Erase</span></button></div>
      </div>`
    : `<div class="row"><button class="btn danger tiny" data-act="reset-save">${svg('trash', 16)} Erase progress…</button></div>`
  return `<div class="panel stack scroll settings">
    <div class="sticky-head">${header('Settings', '', { back: 'close' })}</div>
    <div class="settings-grid">
      <section class="stack">
        <h3>${svg('motion', 20)} Motion</h3>
        ${range('screenShake', 'impact', 'Shake', 0, 1, 0.05, s.screenShake)}
        ${range('particles', 'spark', 'Particles', 0, 1, 0.05, s.particles)}
        ${toggle('cameraMotion', 'Camera motion', s.cameraMotion)}
        ${toggle('flashes', 'Screen flashes', s.flashes)}
        ${toggle('hitPause', 'Hit pause', s.hitPause)}
      </section>
      <section class="stack">
        <h3>${svg('eye', 20)} Readability</h3>
        ${toggle('highContrast', 'High contrast', s.highContrast)}
        ${toggle('colorblind', 'Shape markers', s.colorblind)}
        ${segment('hudScale', 'info', 'Interface size', [[0.85, 'S'], [1, 'M'], [1.15, 'L'], [1.3, 'XL']], s.hudScale)}
      </section>
      <section class="stack">
        <h3>${svg('volume', 20)} Audio</h3>
        ${range('sfx', 'impact', 'Effects', 0, 1, 0.05, s.sfx)}
        ${range('music', 'volume', 'Music', 0, 1, 0.05, s.music)}
      </section>
      <section class="stack">
        <h3>${svg('hop', 20)} Touch</h3>
        ${segment('touchSize', 'target', 'Control size', [[0.85, 'S'], [1, 'M'], [1.15, 'L'], [1.3, 'XL']], s.touchSize)}
        ${toggle('leftHanded', 'Left-handed', s.leftHanded)}
        ${toggle('haptics', 'Vibration', s.haptics)}
      </section>
      <section class="stack">
        <h3>${svg('assist', 20)} Assists</h3>
        ${segment('gameSpeed', 'gauge', 'Game speed', [[0.7, '70%'], [0.85, '85%'], [1, '100%'], [1.15, '115%']], s.gameSpeed)}
        ${segment('assistDamage', 'shield', 'Damage taken', [[1, '100%'], [0.75, '75%'], [0.5, '50%']], s.assistDamage)}
      </section>
      <section class="stack wide kbd-only">
        <h3>${svg('keyboard', 20)} Keys</h3>
        <div class="bind-grid">${BTNS.map(bind).join('')}</div>
        <div class="row"><button class="btn tiny" data-act="reset-keys">${svg('refresh', 16)} Reset keys</button></div>
      </section>
    </div>
    ${erase}
  </div>`
}

const CODEX_TABS: { id: View['codexTab']; ico: IconName; word: string }[] = [
  { id: 'rules', ico: 'book', word: 'Rules' },
  { id: 'components', ico: 'wrench', word: 'Parts' },
  { id: 'synergies', ico: 'link', word: 'Reactions' },
  { id: 'enemies', ico: 'target', word: 'Constructs' },
  { id: 'achievements', ico: 'trophy', word: 'Feats' },
]

/** The game's rules in one place: what a new player needs, with the numbers behind them. */
const RULES: { ico: IconName; title: string; text: string; numbers?: string; color: string }[] = [
  { ico: 'gauge', title: 'Speed is damage', color: '#ffb347', text: 'A ram hurts by how fast you close in and how heavy the ball is. The ring around the ball is your speed.', numbers: 'Heavy cores hit harder; light cores arrive sooner and crit more.' },
  { ico: 'check', title: 'Clean ram', color: '#5cf2c2', text: 'Past the notch on the ring, a ram is clean: it costs you nothing. A ram that breaks a construct is always clean.', numbers: `Clean at ${Math.round(TUNE.cleanRamRatio * 100)}% of top speed.` },
  { ico: 'warning', title: 'Glance', color: '#ff8a7a', text: 'A slow bump glances and kicks back some of the construct’s weight as recoil. Back off, build speed, come again.' },
  { ico: 'impact', title: 'Plow through', color: '#ffd27a', text: 'A clean ram that breaks a construct keeps most of your speed: a fast ball can carry through a whole line.', numbers: `Keeps ${Math.round(TUNE.plowKeepMin * 100)}-${Math.round(TUNE.plowKeepMax * 100)}% of its speed.` },
  { ico: 'flame', title: 'White hot', color: '#ffcf70', text: 'Chain hits and kills without a gap and the ball ignites. While the chain holds, every ram is clean, hits harder, and folds shields.', numbers: `At a ×${TUNE.overdriveCombo} combo: +${Math.round((TUNE.overdriveDamage - 1) * 100)}% damage.` },
  { ico: 'shield', title: 'Guard break', color: '#9ad7ff', text: 'Shields face you and turn slowly. Come down on the crown, hit from behind before it turns, or ram hard enough to fold it: the guard drops and the next rams land.', numbers: `Guard down for ${TUNE.guardBreak} s; a shield takes ${TUNE.shieldTurn} s to turn.` },
  { ico: 'hop', title: 'Hop, float, wall kick', color: '#7fe8ff', text: 'Hold hop in the air to float. Press hop as you touch a wall in the air to kick off it. A rolling ball climbs low ledges by itself.' },
  { ico: 'bolt', title: 'Ability', color: '#7fe8ff', text: 'Dash, slam, burst, or magnet. A ram kill winds the cooldown back by almost half: aggression feeds the next one.' },
  { ico: 'colossus', title: 'The Colossus', color: '#ff4d6a', text: 'Crack the rivets first. Then the heart opens, but its shutters turn rams between attacks. Dodge the attack, then punish the green window. Hop the shockwaves.' },
  { ico: 'flame', title: 'Slag', color: '#ff6a2a', text: 'Slag burns and spits you back up. It only wins if you stay in it. Constructs that fall in melt.' },
]

function codexHtml(view: View): string {
  const tab = view.codexTab
  const sv = view.save
  const counts: Record<View['codexTab'], [number, number] | null> = {
    rules: null,
    components: [COMPONENTS.filter((c) => (c.pool === 'standard' ? sv.unlocked.includes(c.id) : sv.discoveredComponents.includes(c.id))).length, COMPONENTS.length],
    synergies: [SYNERGIES.filter((s) => sv.discoveredSynergies.includes(s.id)).length, SYNERGIES.length],
    enemies: [ENEMIES.filter((e) => sv.discoveredEnemies.includes(e.id)).length, ENEMIES.length],
    achievements: [ACHIEVEMENTS.filter((a) => sv.achievements[a.id]?.done).length, ACHIEVEMENTS.length],
  }
  const tabs = CODEX_TABS.map((t) =>
    `<button class="btn tab ${tab === t.id ? 'on' : ''}" data-act="tab" data-arg="${t.id}" aria-pressed="${tab === t.id}">${svg(t.ico, 20)}<span>${t.word}</span>${counts[t.id] ? `<small class="tab-count">${counts[t.id]![0]}/${counts[t.id]![1]}</small>` : ''}</button>`,
  ).join('')
  let body = ''
  if (tab === 'rules') {
    body = `<div class="grid rules">${RULES.map((r) => `<article class="codex-card rule" style="--accent:${r.color}">
      <div class="cc-head"><span class="rule-ico">${svg(r.ico, 22)}</span><h3>${esc(r.title)}</h3></div>
      <p class="desc">${esc(r.text)}</p>
      ${r.numbers ? `<p class="small muted rule-num">${esc(r.numbers)}</p>` : ''}
    </article>`).join('')}</div>`
  } else if (tab === 'components') {
    body = `<div class="grid">${COMPONENTS.map((c) => {
      const standard = c.pool === 'standard'
      const unlocked = view.save.unlocked.includes(c.id)
      const known = view.save.discoveredComponents.includes(c.id) || c.startsUnlocked
      if (!standard && !known) {
        return `<article class="codex-card hidden-entry"><div class="cc-head">${slotIcon(c.slot, 30)}<div><h3>???</h3><div class="rarity">${c.pool}</div></div></div><p class="small muted">${c.pool === 'fusion' ? 'Found at the Crucible.' : 'Found at the Annealing.'}</p></article>`
      }
      const short = Math.max(0, c.unlockCost - view.save.scrap)
      const forge = standard && !unlocked
        ? `<button class="btn tiny forge" data-act="unlock" data-arg="${c.id}" ${short ? 'disabled' : ''} aria-label="Forge for ${c.unlockCost} scrap${short ? `, need ${short} more` : ''}">${svg(short ? 'lock' : 'wrench', 16)}${icon('currency-scrap', 18)}<b>${c.unlockCost}</b></button>`
        : standard ? `<span class="tag ok">${svg('check', 14)} In pool</span>` : `<span class="tag">${c.pool}</span>`
      return `<article class="codex-card" data-rarity="${c.rarity}" title="${esc(c.description)}">
        <div class="cc-head">${swatch(c.id, c.slot, 26)}<div><h3>${esc(c.name)}</h3><div class="rarity ${c.rarity}">${SLOT_LABEL[c.slot]} · ${c.rarity}</div></div></div>
        <p class="up">${svg('up', 12)} ${esc(c.upside)}</p>
        <p class="down">${svg('down', 12)} ${esc(c.downside)}</p>
        <div class="cc-foot">${forge}</div>
      </article>`
    }).join('')}</div>`
  } else if (tab === 'synergies') {
    body = `<div class="grid">${SYNERGIES.map((s) => {
      const known = view.save.discoveredSynergies.includes(s.id)
      const recipe = s.requires.map((r) => `<span class="tag">${esc(r.tag)}${r.count > 1 ? ` ×${r.count}` : ''}</span>`).join('<span class="muted">+</span>')
      return `<article class="codex-card ${known ? '' : 'hidden-entry'}"><div class="cc-head">${svg(known ? 'link' : 'question', 28)}<h3>${known ? esc(s.name) : '???'}</h3></div><div class="chips">${recipe}</div><p class="desc">${known ? esc(s.description) : 'Recorded when the ball does it.'}</p></article>`
    }).join('')}</div>`
  } else if (tab === 'enemies') {
    body = `<div class="grid">${ENEMIES.map((e) => {
      const known = view.save.discoveredEnemies.includes(e.id)
      if (!known) return `<article class="codex-card hidden-entry"><div class="cc-head">${svg('question', 28)}<h3>???</h3></div><p class="small muted">Not met yet.</p></article>`
      const traits = [
        e.armorGate ? `<span class="tag" title="Rams under ${e.armorGate} damage are cut to ${Math.round((e.armorMul ?? 1) * 100)}%">${svg('shield', 14)} Armor ${e.armorGate}</span>` : '',
        e.shield ? `<span class="tag" title="Frontal rams under ${e.shieldBreak} are blocked; hit from above or behind">${svg('shield', 14)} Front shield</span>` : '',
        ...(e.resists ?? []).map((r) => `<span class="tag ${r.mul < 1 ? 'resist' : 'weak'}">${esc(r.tag)} ×${r.mul}</span>`),
      ].filter(Boolean).join('')
      return `<article class="codex-card" title="${esc(e.codex)}"><div class="cc-head">${svg('target', 28)}<h3>${esc(e.name)}</h3></div><p class="desc">${esc(e.question)}</p>${traits ? `<div class="chips">${traits}</div>` : ''}</article>`
    }).join('')}</div>`
  } else {
    body = `<div class="grid">${ACHIEVEMENTS.map((a) => {
      const row = view.save.achievements[a.id]
      const done = !!row?.done
      const pct = done ? 100 : Math.min(100, ((row?.progress ?? 0) / a.target) * 100)
      const reward = [
        a.scrap ? chip(icon('currency-scrap', 16), `${a.scrap}`, `${a.scrap} scrap`) : '',
        a.embers ? chip(icon('currency-embers', 16), `${a.embers}`, `${a.embers} ember`) : '',
        a.unlocks ? `<span class="tag">${svg('wrench', 14)} ${esc(COMPONENT_MAP[a.unlocks]?.name ?? a.unlocks)}</span>` : '',
      ].filter(Boolean).join('')
      return `<article class="codex-card ${done ? 'done' : ''}"><div class="cc-head">${svg(done ? 'check' : 'trophy', 28)}<h3>${esc(a.name)}</h3></div><p class="desc">${esc(a.description)}</p>
        <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${a.target}" aria-valuenow="${Math.floor(done ? a.target : row?.progress ?? 0)}"><i style="width:${pct.toFixed(0)}%"></i></div>
        <div class="chips">${reward}</div></article>`
    }).join('')}</div>`
  }
  return `<div class="panel stack scroll codex">
    <div class="sticky-head">${header('Codex', '', { back: 'close', right: currencies(view.save, null) })}
    <div class="tabs" role="group" aria-label="Codex sections">${tabs}</div></div>${body}</div>`
}

/** Route map geometry, in CSS pixels at interface size M. */
const COL_W = 96
const COL_GAP = 30
const NODE_H = 106
const ROW_GAP = 14
const MEDAL = 56
const BOSS_MEDAL = 92
const RAIL_H = 34

const NODE_ICON: Record<MapNode['type'], IconName> = {
  combat: 'swords', elite: 'crown', shop: 'tag', event: 'question', treasure: 'chest', traversal: 'wave', challenge: 'hourglass', boss: 'colossus',
}

/** What a room pays, as icons. */
const NODE_REWARD: Record<MapNode['type'], string[]> = {
  combat: ['slot-core', 'currency-cinders'],
  elite: ['slot-core', 'currency-cinders', 'currency-embers'],
  challenge: ['slot-core'],
  traversal: ['slot-core'],
  shop: ['currency-cinders'],
  treasure: ['slot-core', 'currency-cinders'],
  event: [],
  boss: [],
}

function riskLevel(risk: string): number {
  if (/^(High|Final)/.test(risk)) return 3
  if (/^Medium/.test(risk)) return 2
  if (/^Low/.test(risk)) return 1
  return 0
}

const RISK_WORD = ['Safe', 'Low risk', 'Medium risk', 'High risk']

function riskPips(level: number): string {
  return `<span class="risk" data-level="${level}" aria-hidden="true"><i></i><i></i><i></i></span>`
}

function payIcons(type: MapNode['type'], size = 16): string {
  return `${NODE_REWARD[type].map((r) => icon(r, size)).join('')}${type === 'boss' ? svg('trophy', size) : type === 'event' ? svg('question', size) : ''}`
}

interface NodePos { x: number; y: number; w: number; h: number; m: number; cx: number; cy: number }

function mapHtml(view: View): string {
  const run = view.run
  const build = view.build
  if (!run || !build) return ''
  // Nodes grow with the interface size so their labels still fit at L and XL.
  const k = Math.max(1, view.save.settings.hudScale)
  // Short screens (landscape phones, zoomed windows) get a tighter graph so the whole route fits without a vertical scroll.
  const compact = typeof window !== 'undefined' && window.innerHeight < 540
  const c = compact ? 0.68 : 1
  const CW = Math.round(COL_W * k * (compact ? 0.88 : 1))
  const NH = Math.round(NODE_H * k * c)
  const GAP = Math.round(COL_GAP * k * c)
  const RG = Math.round(ROW_GAP * k * c)
  const RAIL = Math.round(RAIL_H * k * (compact ? 0.82 : 1))
  const medalOf = (n: MapNode) => Math.round((n.type === 'boss' ? BOSS_MEDAL : MEDAL) * k * (compact ? 0.72 : 1))
  const heightOf = (n: MapNode) => (n.type === 'boss' ? medalOf(n) + Math.round(40 * k) : NH)
  const depth = Math.max(...run.nodes.map((n) => n.depth))
  const cols = Array.from({ length: depth + 1 }, (_, d) => run.nodes.filter((n) => n.depth === d))
  const colH = (col: MapNode[]) => col.reduce((s, n) => s + heightOf(n), 0) + Math.max(0, col.length - 1) * RG
  const body = Math.max(...cols.map(colH))
  const height = RAIL + body
  const width = (depth + 1) * CW + depth * GAP
  const pos = new Map<string, NodePos>()
  cols.forEach((col, d) => {
    let y = RAIL + (body - colH(col)) / 2
    for (const n of col) {
      const h = heightOf(n)
      const m = medalOf(n)
      const x = d * (CW + GAP)
      pos.set(n.id, { x, y, w: CW, h, m, cx: x + CW / 2, cy: y + 4 + m / 2 })
      y += h + RG
    }
  })
  const cur = run.nodes.find((n) => n.id === run.currentId)
  const curDepth = cur ? cur.depth : -1
  const onPath = new Set(run.nodes.filter((n) => n.state === 'done' || n.state === 'active').map((n) => n.id))
  // Edges are cubic curves from medal edge to medal edge; live ones draw last so they sit on top.
  const order = { missed: 0, future: 1, taken: 2, reachable: 3 } as const
  const edges: { cls: keyof typeof order; d: string }[] = []
  for (const n of run.nodes) {
    const a = pos.get(n.id)!
    for (const id of n.next) {
      const m = run.nodes.find((x) => x.id === id)
      const b = pos.get(id)
      if (!m || !b) continue
      const cls = onPath.has(n.id) && onPath.has(id) ? 'taken' : n.state === 'done' && m.state === 'open' ? 'reachable' : n.state === 'missed' || m.state === 'missed' ? 'missed' : 'future'
      const sx = a.cx + a.m / 2 + 3
      const ex = b.cx - b.m / 2 - 3
      const bend = (ex - sx) * 0.55
      edges.push({ cls, d: `M${sx.toFixed(1)} ${a.cy.toFixed(1)}C${(sx + bend).toFixed(1)} ${a.cy.toFixed(1)} ${(ex - bend).toFixed(1)} ${b.cy.toFixed(1)} ${ex.toFixed(1)} ${b.cy.toFixed(1)}` })
    }
  }
  edges.sort((p, q) => order[p.cls] - order[q.cls])
  const paths = edges.map((e) => `${e.cls === 'reachable' || e.cls === 'taken' ? `<path class="halo ${e.cls}" d="${e.d}" />` : ''}<path class="${e.cls}" d="${e.d}" />`).join('')
  // The depth rail: one tick per layer, filled up to where the ball is.
  const tickX = (d: number) => d * (CW + GAP) + CW / 2
  const rail = `<div class="depth-rail" aria-hidden="true" style="left:${tickX(0)}px;width:${tickX(depth) - tickX(0)}px;--prog:${depth ? (Math.max(0, curDepth) / depth) * 100 : 0}%"></div>${cols.map((_, d) => {
    const st = d < curDepth ? 'past' : d === curDepth ? 'here' : d === curDepth + 1 ? 'next' : ''
    return `<span class="depth-tick ${st}${d === depth ? ' boss' : ''}" style="left:${tickX(d)}px" aria-hidden="true">${d === depth ? svg('skull', 13) : d + 1}</span>`
  }).join('')}`
  const picked = run.nodes.find((n) => n.id === view.selectedNode && n.state === 'open')
  const open = run.nodes.filter((n) => n.state === 'open')
  const first = picked ?? open[0]
  const nodes = run.nodes.map((n) => nodeButton(n, build, run, pos.get(n.id)!, n === first, n === picked, open.indexOf(n))).join('')
  const stats = `${chip(svg('heart', 18), `${Math.ceil(run.hp)}/${Math.round(build.stats.maxHp)}`, `Integrity ${Math.ceil(run.hp)} of ${Math.round(build.stats.maxHp)}`, 'hp')}${run.heat ? chip(svg('flame', 18), `${run.heat}`, `Forge heat ${run.heat}`, 'heat') : ''}`
  const kicker = curDepth < 0 ? 'The foundry route' : `Depth ${curDepth + 1} of ${depth + 1}`
  // Touch picks a room first and confirms with Go; with a pointer or keys, the hovered or focused room is described below the map.
  const foot = view.touch
    ? picked ? nodeInfo(picked, build, run) : `<p class="map-hint">${svg('info', 16)} Tap a glowing room to see what it holds.</p>`
    : `<div class="peeks">${open.map((n, i) => `<div class="node-peek${n === first ? ' first' : ''}" data-for="${i}" aria-hidden="true">${nodeSummary(n, build, run)}</div>`).join('')}</div>`
  return `<div class="panel stack scroll route${compact ? ' compact' : ''}">
    ${header('Route', kicker, { right: `${stats}${currencies(view.save, run)}${iconBtn('menu', 'menu', 'Build and menu')}` })}
    <div class="map-scroll"><div class="map" style="width:${width}px;height:${height}px">
      ${rail}
      <svg class="edges" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true">${paths}</svg>
      ${nodes}
    </div></div>
    <div class="map-foot">
      ${foot}
      <div class="map-legend" aria-hidden="true"><span>${riskPips(2)} risk</span><span>${icon('slot-core', 14)} part</span><span>${icon('currency-cinders', 14)} cinders</span><span>${icon('currency-embers', 14)} ember</span></div>
    </div>
  </div>`
}

/** A room described: medallion, name, risk, pay, and advice. */
function nodeSummary(n: MapNode, build: CompiledBuild, run: RunState): string {
  const info = routeInfo(n.type, build, run)
  const risk = riskLevel(info.risk)
  return `<span class="medal big type-${n.type}" aria-hidden="true"><span class="medal-face">${svg(NODE_ICON[n.type] ?? 'star', 24)}</span></span>
    <div class="ni-text">
      <span class="ni-kicker">Depth ${n.depth + 1} · ${n.type === 'boss' ? 'Final hold' : 'Available'}</span>
      <b>${esc(info.label)}</b>
      <div class="ni-facts">
        <span class="ni-risk" data-level="${risk}">${riskPips(risk)}<span><em>${RISK_WORD[risk]}</em> ${esc(info.risk.replace(/^(None|Low|Medium|High|Final)[.,]?\s*/, ''))}</span></span>
        <span class="ni-reward"><span class="pays">${payIcons(n.type)}</span><span>${esc(info.reward)}</span></span>
      </div>
      ${info.advice ? `<span class="small advice">${svg('spark', 13)} ${esc(info.advice)}</span>` : ''}
    </div>`
}

/** The picked room, spelled out, with a big button to go. */
function nodeInfo(n: MapNode, build: CompiledBuild, run: RunState): string {
  const info = routeInfo(n.type, build, run)
  return `<div class="node-info" role="region" aria-label="${esc(info.label)}">
    ${nodeSummary(n, build, run)}
    <button class="btn primary go" data-act="enter" data-arg="${n.id}" data-go="1" aria-label="Enter ${esc(info.label)}">${svg('play', 20)}<span>Go</span></button>
  </div>`
}

function nodeButton(n: MapNode, build: CompiledBuild, run: RunState, p: NodePos, focus: boolean, selected: boolean, pick: number): string {
  const info = routeInfo(n.type, build, run)
  const state = n.state === 'open' ? 'Available' : n.state === 'done' ? 'Cleared' : n.state === 'active' ? 'Here' : n.state === 'missed' ? 'Passed by' : 'Later'
  const risk = riskLevel(info.risk)
  const meta = n.state === 'open' ? `<span class="node-meta">${riskPips(risk)}<span class="pays">${payIcons(n.type, 14)}</span></span>` : ''
  const here = run.currentId === n.id && (n.state === 'done' || n.state === 'active')
  const badge = n.state === 'done' ? `<span class="medal-badge">${svg('check', 12)}</span>` : n.state === 'missed' ? `<span class="medal-badge">${svg('close', 10)}</span>` : ''
  return `<button class="btn node ${n.state} type-${n.type}${here ? ' here' : ''}${selected ? ' selected' : ''}" style="left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px;--m:${p.m}px;--d:${n.depth}" data-act="enter" data-arg="${n.id}" ${pick >= 0 ? `data-pick="${pick}"` : ''} ${n.state === 'open' ? '' : 'disabled'} ${focus ? 'data-autofocus' : ''} aria-label="${esc(`${info.label}. ${state}. ${n.state === 'open' ? `Risk: ${info.risk} Reward: ${info.reward} ${info.advice}` : ''}`)}">
    <span class="medal" aria-hidden="true"><span class="medal-face">${svg(NODE_ICON[n.type] ?? 'star', Math.round(p.m * 0.44))}</span>${badge}${here ? '<span class="here-mark"></span>' : ''}</span>
    <span class="node-label">${esc(info.label)}</span>${meta}
  </button>`
}

function rewardHtml(view: View): string {
  const run = view.run
  const salvage = run ? salvageValue(run.offerKind) : 0
  const rerolls = run?.rerolls ?? 0
  const actions = `<button class="btn icon-btn badge-btn" data-act="reroll" ${rerolls > 0 ? '' : 'disabled'} aria-label="Reroll (${rerolls} tokens)" title="Reroll (${rerolls} tokens)">${svg('dice')}<span class="badge">${rerolls}</span></button>
    ${run?.tutorial ? '' : `<button class="btn salvage" data-act="salvage" aria-label="Keep the ball and take ${salvage} cinders" title="Keep the ball: +${salvage} cinders">${svg('recycle', 20)}<span class="salvage-word">Skip</span>${icon('currency-cinders', 18)}<b>+${salvage}</b></button>`}`
  const g = run && !run.tutorial && run.offerKind !== 'treasure' ? run.grades[run.grades.length - 1] : undefined
  const gradeLine = g ? gradeBadge(g) : ''
  const kicker = !run ? '' : run.offerKind === 'elite' ? 'Elite spoils' : run.offerKind === 'treasure' ? 'Treasure' : run.tutorial ? 'First spoils' : 'Room spoils'
  return `<div class="panel stack scroll reward">
    ${header('Choose one', kicker, { right: actions })}
    ${gradeLine}
    <div class="cards">${view.offers.map((o, i) => offerCard(o, i, view)).join('')}</div>
  </div>`
}

/** The room's grade, stamped on the reward screen: pace against par, and the shell. */
export function gradeBadge(g: RoomGrade): string {
  const pace = g.time <= g.par ? 'up' : 'down'
  const shell = g.taken <= 0 ? 'up' : 'down'
  return `<div class="grade-line" data-grade="${g.grade}" role="status" aria-label="${esc(`${g.room}: grade ${g.grade}. ${g.time} seconds, par ${g.par}. ${g.taken ? `${g.taken} integrity lost` : 'No damage'}.${g.bonus ? ` ${g.bonus} bonus cinders.` : ''}`)}">
    <span class="grade-stamp" aria-hidden="true">${g.grade}</span>
    <span class="grade-facts"><b>${esc(g.room)}</b>
      <span class="${pace}">${svg('hourglass', 14)} ${g.time.toFixed(1)} s <span class="muted">/ par ${g.par}</span></span>
      <span class="${shell}">${svg('heart', 14)} ${g.taken ? `−${g.taken}` : 'untouched'}</span>
      ${g.bonus ? `<span class="pay">${icon('currency-cinders', 14)} +${g.bonus}</span>` : ''}
    </span>
  </div>`
}

function hpLine(h: NonNullable<Offer['hp']>): string {
  if (Math.round(h.maxAfter) === Math.round(h.maxBefore)) return ''
  const cls = h.maxAfter > h.maxBefore ? 'up' : 'down'
  return `<span class="${cls} hp-line" aria-label="Integrity ${Math.round(h.before)} of ${Math.round(h.maxBefore)} becomes ${Math.round(h.after)} of ${Math.round(h.maxAfter)}">${svg('heart', 15)}<span class="muted">Integrity</span> ${Math.round(h.maxBefore)} <span class="arrow">→</span> <b>${Math.round(h.maxAfter)}</b></span>`
}

const KIND_WORD: Record<Offer['kind'], string> = { component: 'Part', heal: 'Weld', cinders: 'Cinders', reroll: 'Reroll', ember: 'Ember' }

function offerCard(o: Offer, i: number, view: View): string {
  const bars = (o.bars ?? []).map((b) => {
    const delta = b.next - b.current
    const dir = Math.abs(delta) < 0.02 ? 'same' : delta > 0 ? 'gain' : 'loss'
    const lo = Math.max(0, Math.min(1, Math.min(b.current, b.next))) * 100
    const hi = Math.max(0, Math.min(1, Math.max(b.current, b.next))) * 100
    const mark = dir === 'same' ? '' : `<span class="${dir === 'gain' ? 'up' : 'down'}">${svg(dir === 'gain' ? 'up' : 'down', 10)}</span>`
    return `<div class="bar-row ${dir}"><span>${b.label}${mark}</span><span class="bar delta" aria-hidden="true" style="--a:${lo.toFixed(1)}%;--b:${hi.toFixed(1)}%"><i></i><em></em></span></div>`
  }).join('')
  let numbers = ''
  if (o.kind === 'component' && o.componentId && o.slot && view.run && view.build) {
    const p = previewSwap(view.run, o.slot, o.componentId, view.save)
    numbers = `<details><summary>${svg('info', 16)} Numbers</summary>${statTable(p.current.stats, p.next.stats)}</details>`
  }
  const amount = o.kind === 'heal' ? `${svg('heart', 22)} +${o.amount}` : o.kind === 'cinders' ? `${icon('currency-cinders', 22)} +${o.amount}` : o.kind === 'reroll' ? `${svg('dice', 22)} +${o.amount}` : o.kind === 'ember' ? `${icon('currency-embers', 22)} +${o.amount}` : ''
  const tradeoff = o.kind === 'component' && o.bars?.some((b) => b.next < b.current - 0.02) && o.bars?.some((b) => b.next > b.current + 0.02)
  const art = o.slot ? `slot-${o.slot}` : o.kind === 'cinders' ? 'currency-cinders' : o.kind === 'ember' ? 'currency-embers' : o.kind === 'heal' ? 'core-balanced' : 'slot-passive'
  const bigArt = o.kind === 'heal' ? healArt(o.amount ?? 0, view) : o.kind === 'reroll' ? svg('dice', 56) : icon(art, 64)
  const chips = [
    ...(o.gained ?? []).map((g) => `<span class="tag up">${svg('link', 14)}${esc(g)}</span>`),
    ...(o.lost ?? []).map((l) => `<span class="tag down">${svg('unlink', 14)}${esc(l)}</span>`),
    ...(o.near ?? []).map((n) => `<span class="tag near" title="One part away from this reaction">${svg('link', 14)}${esc(n)}</span>`),
  ].join('')
  const banishes = view.run?.banishes ?? 0
  const banish = o.kind === 'component' && view.run && !view.run.tutorial
    ? `<button class="btn icon-btn banish" data-act="banish" data-arg="${i}" ${banishes > 0 ? '' : 'disabled'} aria-label="Banish ${esc(o.title)} for this run (${banishes} left)" title="Banish for this run (${banishes} left)">${svg('close', 16)}</button>`
    : ''
  const rarity = o.rarity ?? 'common'
  return `<article class="card kind-${o.kind}" data-rarity="${rarity}" style="--i:${i}" title="${esc(o.description)}">
    <div class="card-head">
      <span class="card-key kbd" aria-hidden="true">${i + 1}</span>
      <div class="rarity ${o.rarity ?? ''}">${o.slot ? `${SLOT_LABEL[o.slot]}<i></i>${o.rarity ?? ''}` : KIND_WORD[o.kind]}</div>
      ${tradeoff ? `<span class="trade" title="Trade-off">${svg('swap', 14)}<span>Trade-off</span></span>` : ''}
      ${banish}
    </div>
    <div class="card-art${o.kind === 'component' ? ' live' : ''}">
      ${o.kind === 'component' ? `<canvas data-preview="${i}" width="280" height="110" aria-hidden="true"></canvas>` : `<span class="art-big" aria-hidden="true">${bigArt}</span>`}
      <span class="art-badge" aria-hidden="true">${icon(art, 26)}</span>
    </div>
    <div class="card-body">
      <strong class="card-title">${esc(o.title)}</strong>
      ${o.kind === 'component' ? `<span class="small muted swap-line">${o.replaces ? `${svg('swap', 14)} Replaces <b>${esc(o.replaces.name)}</b>` : `${svg('plus', 14)} Fills an empty slot`}</span>` : ''}
      ${amount ? `<span class="amount">${amount}</span>` : ''}
      ${o.upside || o.downside ? `<div class="effects">${o.upside ? `<span class="up">${svg('up', 12)} ${esc(o.upside)}</span>` : ''}${o.downside ? `<span class="down">${svg('down', 12)} ${esc(o.downside)}</span>` : ''}</div>` : ''}
      ${o.hp ? hpLine(o.hp) : ''}
      ${chips ? `<div class="chips">${chips}</div>` : ''}
      ${bars ? `<div class="bars">${bars}</div>` : ''}
      ${numbers}
    </div>
    <button class="btn primary take" data-act="offer" data-arg="${i}" ${i === 0 ? 'data-autofocus' : ''} aria-label="Take ${esc(o.title)}">${svg('check', 20)}<span>Take</span></button>
  </article>`
}

/** A weld shown as what it does: the integrity bar now, and the part it fills back in. */
function healArt(amount: number, view: View): string {
  const max = view.build?.stats.maxHp ?? 100
  const cur = Math.min(max, view.run?.hp ?? max)
  const after = Math.min(max, cur + amount)
  const a = (cur / max) * 100
  const b = (after / max) * 100
  const whole = cur >= max - 0.5
  return `<span class="heal-art${whole ? ' whole' : ''}">
    <span class="heal-heart">${svg('heart', 44)}</span>
    <span class="heal-bar"><i style="width:${a.toFixed(1)}%"></i><em style="left:${a.toFixed(1)}%;width:${(b - a).toFixed(1)}%"></em></span>
    <span class="heal-nums">${whole ? 'Already whole' : `${Math.ceil(cur)} <span class="arrow">→</span> <b>${Math.ceil(after)}</b> <span class="muted">/ ${Math.ceil(max)}</span>`}</span>
  </span>`
}

function shopIcon(item: ShopItem, size = 40): string {
  if (item.kind === 'component' && item.componentId) {
    const comp = COMPONENT_MAP[item.componentId]
    if (comp) return slotIcon(comp.slot, size)
  }
  if (item.kind === 'heal') return svg('heart', size)
  if (item.kind === 'reroll') return svg('dice', size)
  if (item.kind === 'ember') return icon('currency-embers', size)
  return svg('tag', size)
}

function shopHtml(view: View): string {
  const run = view.run
  const cinders = run?.cinders ?? 0
  const rows = view.shop.map((item, i) => {
    const chips: string[] = []
    let rarity = ''
    let kind = item.kind === 'heal' ? 'Weld' : item.kind === 'reroll' ? 'Token' : item.kind === 'ember' ? 'Ember' : 'Part'
    let swatchColor = ''
    if (item.kind === 'component' && item.componentId && run) {
      const comp = COMPONENT_MAP[item.componentId]!
      rarity = comp.rarity
      kind = `${SLOT_LABEL[comp.slot]} · ${comp.rarity}`
      const v = comp.visual
      swatchColor = v?.core ?? v?.shell ?? v?.trail ?? ''
      const p = previewSwap(run, comp.slot, comp.id, view.save)
      chips.push(`<span class="tag">${svg(p.replaced ? 'swap' : 'plus', 14)}${p.replaced ? esc(p.replaced.name) : 'Empty slot'}</span>`)
      for (const g of p.gained) chips.push(`<span class="tag up">${svg('link', 14)}${esc(g)}</span>`)
      for (const l of p.lost) chips.push(`<span class="tag down">${svg('unlink', 14)}${esc(l)}</span>`)
      if (Math.round(p.hp.maxAfter) !== Math.round(p.hp.maxBefore)) chips.push(`<span class="tag ${p.hp.maxAfter > p.hp.maxBefore ? 'up' : 'down'}">${svg('heart', 14)}${Math.round(p.hp.maxBefore)} → ${Math.round(p.hp.maxAfter)}</span>`)
    }
    const short = cinders < item.cost && !item.sold ? item.cost - cinders : 0
    const whole = item.kind === 'heal' && !item.sold && !!view.run && !!view.build && view.run.hp >= view.build.stats.maxHp - 0.5
    const label = `${item.title}. ${item.sold ? 'Sold.' : whole ? 'Your shell is already whole.' : `${item.cost} cinders${short ? `, need ${short} more` : ''}.`} ${item.detail}`
    const state = item.sold ? 'sold' : whole ? 'whole' : short ? 'short' : 'can'
    const price = item.sold
      ? `<span class="price sold">${svg('check', 16)}<b>Sold</b></span>`
      : `<span class="price ${state}">${short ? svg('lock', 14) : ''}${icon('currency-cinders', 18)}<b>${item.cost}</b>${short ? `<small>need ${short}</small>` : whole ? '<small>whole</small>' : ''}</span>`
    return `<button class="btn shop-item kind-${item.kind} ${item.sold ? 'sold' : ''} ${state}" data-rarity="${rarity}" data-act="buy" data-arg="${item.id}" style="--i:${i}${swatchColor ? `;--c:${swatchColor}` : ''}" ${item.sold || short || whole ? 'disabled' : ''} aria-label="${esc(label)}">
      <span class="si-top"><span class="si-icon">${shopIcon(item)}</span><span class="si-kind rarity ${rarity}">${esc(kind)}</span></span>
      <span class="si-body"><b class="si-title">${esc(item.title)}</b>${item.kind === 'component' ? '' : `<span class="small muted">${esc(item.detail)}</span>`}${chips.length ? `<span class="chips">${chips.join('')}</span>` : ''}</span>
      ${price}
      ${item.sold ? '<span class="sold-stamp" aria-hidden="true">Sold</span>' : ''}
    </button>`
  }).join('')
  return `<div class="panel stack scroll shop">
    ${header('Shop', 'Foundry market', { right: currencies(view.save, run) })}
    <div class="shop-grid">${rows}</div>
    <div class="shop-foot">
      <span class="wallet">${icon('currency-cinders', 22)}<b>${cinders}</b><span class="muted">to spend</span></span>
      <button class="btn primary leave" data-act="leave-shop" data-autofocus>${svg('exit', 20)}<span>Leave</span></button>
    </div>
  </div>`
}

function eventHtml(view: View): string {
  const ev = view.event
  if (!ev) return ''
  const cost = (c: GameEvent['choices'][number]) => {
    const out: string[] = []
    if (c.cost?.hp) out.push(`<span class="tag down">${svg('heart', 14)}−${c.cost.hp}</span>`)
    if (c.cost?.embers) out.push(`<span class="tag down">${icon('currency-embers', 14)}−${c.cost.embers}</span>`)
    if (c.cost?.freeAnneal) out.push(`<span class="tag up">${svg('check', 14)} Free</span>`)
    return out.join('')
  }
  return `<div class="panel stack scroll event">
    ${header(ev.title, 'Event', { right: currencies(view.save, view.run) })}
    <div class="event-story"><span class="event-glyph" aria-hidden="true">${svg('sparkle', 30)}</span><p class="event-body">${esc(ev.body)}</p></div>
    <div class="event-choices">${ev.choices.map((c, i) => {
      const price = cost(c)
      return `<button class="btn event-choice" style="--i:${i}" data-act="event" data-arg="${c.id}" ${c.disabled ? 'disabled' : ''} ${i === 0 && !c.disabled ? 'data-autofocus' : ''}>
      <span class="ec-head"><b>${esc(c.title)}</b>${svg('back', 16, 'ec-arrow')}</span>
      ${price ? `<span class="chips ec-cost">${price}</span>` : ''}
      <span class="ec-detail">${esc(c.detail)}</span>
      ${c.disabled ? `<span class="small down ec-lock">${svg('lock', 14)} ${esc(c.disabled)}</span>` : ''}
    </button>`
    }).join('')}</div>
  </div>`
}

function pauseHtml(view: View): string {
  const build = view.build
  if (view.confirmAbandon) {
    return `<div class="panel stack narrow confirm" role="alertdialog" aria-labelledby="abandon-title">
      <span class="confirm-glyph" aria-hidden="true">${svg('flag', 30)}</span>
      <div class="kicker">Abandon run</div>
      <h2 id="abandon-title">Leave this run?</h2>
      <p class="muted">${view.run && view.run.roomsCleared > 0 ? 'You keep the scrap a death would pay.' : 'No room cleared yet: it pays nothing.'}</p>
      <div class="row two"><button class="btn" data-act="abandon-cancel" data-autofocus>${svg('back', 20)}<span>Keep playing</span></button><button class="btn danger" data-act="abandon-confirm">${svg('flag', 20)}<span>Abandon</span></button></div>
    </div>`
  }
  return `<div class="panel stack narrow pause">
    <div class="pause-head"><div><div class="kicker">Paused</div><h2>${build ? esc(build.archetype) : 'Ballborn'}</h2></div></div>
    ${build ? slotGrid(build) : ''}
    <button class="btn primary big resume" data-act="resume" data-autofocus>${svg('resume', 24)}<span>Resume</span></button>
    <div class="tiles">
      ${tile('settings', 'gear', 'Settings', 'Settings', 'style="--i:0"')}
      ${tile('codex', 'book', 'Codex', 'Codex', 'style="--i:1"')}
      ${tile('abandon', 'flag', 'Abandon', 'Abandon run', 'style="--i:2"', 'danger')}
    </div>
  </div>`
}

function summaryHtml(view: View): string {
  const s = view.summary
  if (!s) return ''
  const bars = (rows: [string, number][]) => {
    const max = Math.max(1, ...rows.map((r) => r[1]))
    return rows.length
      ? `<ul class="breakdown">${rows.map(([label, n]) => `<li><span>${esc(label)}</span><span class="bar" aria-hidden="true"><em style="width:${(n / max) * 100}%"></em></span><b>${Math.round(n)}</b></li>`).join('')}</ul>`
      : '<p class="muted small">Nothing recorded.</p>'
  }
  const emblem = s.kind === 'victory' ? 'trophy' : s.kind === 'abandon' ? 'flag' : 'skull'
  return `<div class="panel stack scroll summary ${s.kind}">
    <div class="summary-hero">
      <span class="hero-emblem" aria-hidden="true">${svg(emblem, 40)}</span>
      <div class="hero-text">
        <div class="kicker">${s.kind === 'victory' ? 'The Colossus is scrap' : s.kind === 'abandon' ? 'Run abandoned' : 'The ball breaks'}</div>
        <h2 class="summary-title">${esc(s.title)}</h2>
        ${s.cause ? `<p class="cause" aria-label="Cause: ${esc(s.cause)}">${svg('skull', 16)}<b>${esc(s.cause)}</b></p>` : ''}
      </div>
    </div>
    <div class="score-block${s.newBest ? ' best' : ''}" aria-label="${esc(`Score ${s.score}${s.newBest ? ', a new best' : ''}`)}">
      <div class="score-main"><span class="kicker">${s.daily ? `Daily Forge · ${esc(s.daily)}` : 'Score'}</span><b class="score-num"><span class="score-text">${s.score.toLocaleString('en-US')}</span></b>${s.newBest ? `<span class="new-best">${svg('crown', 16)} New best</span>` : ''}</div>
      ${s.grades.length ? `<div class="grade-strip" aria-label="Room grades ${esc(s.grades.map((g) => g.grade).join(' '))}">${s.grades.map((g, i) => `<i data-g="${g.grade}" style="--i:${i}" title="${esc(`${g.room}: ${g.grade}, ${g.time.toFixed(1)} s of par ${g.par}`)}">${g.grade}</i>`).join('')}</div>` : ''}
      <button class="btn small share" data-act="share" aria-label="Copy the result to the clipboard">${svg('link', 16)}<span>Copy result</span></button>
      <ul class="score-lines">${s.scoreLines.filter((l) => l.points !== 0).map((l) => `<li><span>${esc(l.label)}</span><b>${l.points > 0 ? '+' : ''}${l.points.toLocaleString('en-US')}</b></li>`).join('')}</ul>
    </div>
    <ul class="highlights">${s.highlights.map((h, i) => `<li style="--i:${i}" aria-label="${esc(`${h.label} ${h.value}`)}">${svg(h.icon, 22)}<b>${esc(h.value)}</b><span>${esc(h.label)}</span></li>`).join('')}</ul>
    <div class="summary-actions">
      <button class="btn primary big" data-act="launch" data-arg="run" data-autofocus>${svg('play', 24)}<span>One more run</span></button>
      <div class="tiles">
        ${tile('retry-seed', 'refresh', 'Same seed', 'Same seed again', `data-arg="${s.seed}"`)}
        ${tile('lab', 'flask', 'Lab', 'Ball lab')}
        ${tile('codex', 'book', 'Unlocks')}
        ${tile('title', 'home', 'Title')}
      </div>
    </div>
    <div class="reward-line"><span class="earned">${chip(icon('currency-scrap', 24), `+${s.scrap}`, `${s.scrap} scrap earned`, 'cur scrap big')}<span class="muted small">scrap earned</span></span>${currencies(view.save, null)}</div>
    <p class="idea" title="${esc(s.line)}">${svg('spark', 18)} ${esc(s.kind === 'death' ? s.tip : s.idea)}</p>
    <details class="run-details"><summary>${svg('info', 16)} Run details</summary>
    <div class="summary-grid">
      <section><h3>${svg('wrench', 18)} ${esc(s.archetype)}</h3><ul class="plain parts">${s.components.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
        ${s.decisions.length ? `<p class="muted small">${s.decisions.map(esc).join(' · ')}</p>` : ''}</section>
      <section><h3>${svg('map', 18)} Route</h3><ol class="plain route-list">${s.route.map((r) => `<li class="${r.result}">${svg(NODE_ICON[r.type] ?? 'star', 16)}<span>${esc(r.room)}</span>${r.taken ? `<span class="down small">−${r.taken}</span>` : ''}${r.result === 'death' ? svg('skull', 14) : ''}</li>`).join('') || '<li class="muted">No rooms.</li>'}</ol></section>
      <section><h3>${svg('heart', 18)} Taken</h3>${bars(s.taken)}</section>
      <section><h3>${svg('impact', 18)} Dealt</h3>${bars(s.dealt)}</section>
    </div>
    <p class="muted small seed-line">${svg('hash', 14)} ${s.seed} · ${svg('flame', 14)} ${s.heat}${s.assist ? ` · ${svg('assist', 14)}` : ''}</p>
    </details>
  </div>`
}

const PRESETS: { name: string; ids: Record<Slot, string> }[] = [
  { name: 'Balanced', ids: { core: 'balanced-core', shell: 'rubber-shell', momentum: 'momentum-engine', impact: 'crush-impact', ability: 'dash', passive: 'combo-engine' } },
  { name: 'Heavy', ids: { core: 'heavy-core', shell: 'armored-shell', momentum: 'momentum-engine', impact: 'crush-impact', ability: 'ground-slam', passive: 'combo-engine' } },
  { name: 'Light', ids: { core: 'light-core', shell: 'spiked-shell', momentum: 'gyro-stabilizer', impact: 'crush-impact', ability: 'dash', passive: 'momentum-harvest' } },
  { name: 'Rebound', ids: { core: 'balanced-core', shell: 'rubber-shell', momentum: 'rebound-engine', impact: 'crush-impact', ability: 'dash', passive: 'combo-engine' } },
  { name: 'Fire', ids: { core: 'balanced-core', shell: 'flaming-shell', momentum: 'momentum-engine', impact: 'fire-impact', ability: 'dash', passive: 'chain-reaction' } },
  { name: 'Magnetic', ids: { core: 'magnetic-core', shell: 'rubber-shell', momentum: 'momentum-engine', impact: 'lightning-impact', ability: 'magnet-pull', passive: 'combo-engine' } },
]

const PRESET_ICON: Record<string, string> = {
  Balanced: 'core-balanced', Heavy: 'core-heavy', Light: 'core-light', Rebound: 'slot-momentum', Fire: 'currency-embers', Magnetic: 'slot-ability',
}

export function presetIds(name: string, save: SaveData): Record<Slot, string> | null {
  const p = PRESETS.find((x) => x.name === name)
  if (!p) return null
  const ids = { ...p.ids }
  for (const slot of SLOTS) if (!save.unlocked.includes(ids[slot])) ids[slot] = PRESETS[0]!.ids[slot]
  return ids
}

/**
 * The lab is a dock over a live room: a strip of the six slots on top, and at
 * most one drawer under it. Swapping a part never pauses, so the ball can be
 * tried the moment it changes. Closing the drawer leaves only the strip.
 */
function labHtml(view: View): string {
  const build = view.build
  if (!build) return ''
  const panel = view.labPanel
  const paused = view.labPaused
  const slots = SLOTS.map((slot) => {
    const id = build.ids[slot]
    const comp = id ? COMPONENT_MAP[id] : undefined
    const label = `${SLOT_LABEL[slot]}: ${comp ? comp.name : 'empty'}`
    return `<button class="btn lab-slot ${panel === slot ? 'on' : ''}" data-act="lab-panel" data-arg="${slot}" aria-pressed="${panel === slot}" aria-label="${esc(label)}" title="${esc(label)}" data-rarity="${comp?.rarity ?? ''}">${swatch(id, slot, 22)}<span class="slot-name">${comp ? esc(comp.name) : SLOT_LABEL[slot]}</span></button>`
  }).join('')
  const toggle = (id: 'presets' | 'stats', ico: IconName, label: string) =>
    `<button class="btn icon-btn ${panel === id ? 'on' : ''}" data-act="lab-panel" data-arg="${id}" aria-pressed="${panel === id}" aria-label="${label}" title="${label}">${svg(ico)}</button>`
  return `<div class="lab-dock ${panel ? 'open' : ''} ${paused ? 'paused' : ''}">
    <div class="lab-bar">
      ${iconBtn('title', 'exit', 'Leave lab')}
      <div class="lab-name"><div class="kicker">Ball lab${paused ? ' · paused' : ''}</div><b>${esc(build.archetype)}</b></div>
      <div class="lab-slots" role="group" aria-label="Parts">${slots}</div>
      <div class="lab-tools">
        ${toggle('presets', 'star', 'Preset builds')}
        ${toggle('stats', 'gauge', 'How it handles')}
        ${paused ? `<button class="btn primary icon-btn" data-act="lab-resume" data-autofocus aria-label="Back to rolling" title="Back to rolling">${svg('play')}</button>` : ''}
      </div>
    </div>
    ${panel ? `<div class="lab-drawer">${labDrawer(view, build, panel)}</div>` : ''}
  </div>`
}

function labDrawer(view: View, build: CompiledBuild, panel: Slot | 'presets' | 'stats'): string {
  const close = iconBtn('lab-panel', 'close', 'Close', `data-arg="${panel}"`)
  if (panel === 'presets') {
    return `<div class="drawer-head"><h3>${svg('star', 18)} Presets</h3>${close}</div>
      <div class="part-row">${PRESETS.map((p) => `<button class="btn part-tile" data-act="preset" data-arg="${p.name}">${icon(PRESET_ICON[p.name] ?? 'core-balanced', 30)}<b>${p.name}</b></button>`).join('')}</div>`
  }
  if (panel === 'stats') {
    const feel = feelNumbers(build.stats)
    return `<div class="drawer-head"><h3>${svg('gauge', 18)} ${esc(build.archetype)}</h3>${close}</div>
      <div class="lab-stats">
        <div class="bars">${feel.map((b) => `<div class="bar-row"><span>${b.label}</span><span class="bar"><em style="width:${b.value * 100}%"></em></span></div>`).join('')}</div>
        <div class="stack">
          ${build.strengths.length ? `<p class="up small">${svg('up', 12)} ${esc(build.strengths.join(' '))}</p>` : ''}
          ${build.weaknesses.length ? `<p class="down small">${svg('down', 12)} ${esc(build.weaknesses.join(' '))}</p>` : ''}
          <details><summary>${svg('info', 16)} Numbers</summary>${statTable(build.stats)}</details>
        </div>
      </div>`
  }
  const slot = panel
  const current = build.ids[slot]
  const list = COMPONENTS.filter((c) => c.slot === slot && (c.pool === 'standard' ? view.save.unlocked.includes(c.id) : view.save.discoveredComponents.includes(c.id)))
  const locked = COMPONENTS.filter((c) => c.slot === slot && c.pool === 'standard' && !view.save.unlocked.includes(c.id))
  const comp = current ? COMPONENT_MAP[current] : undefined
  const tiles = [
    `<button class="btn part-tile ${current ? '' : 'on'}" data-act="lab-part" data-arg="${slot}:" aria-pressed="${!current}">${swatch(null, slot, 30)}<b>Empty</b></button>`,
    ...list.map((c) => `<button class="btn part-tile ${c.id === current ? 'on' : ''}" data-rarity="${c.rarity}" data-act="lab-part" data-arg="${slot}:${c.id}" aria-pressed="${c.id === current}">${swatch(c.id, slot, 30)}<b>${esc(c.name)}</b><span class="rarity ${c.rarity}">${c.rarity}</span></button>`),
    ...locked.map((c) => `<button class="btn part-tile locked" disabled aria-label="${esc(c.name)}: forge it in the codex">${swatch(c.id, slot, 30)}<b>${esc(c.name)}</b><span class="small muted">${svg('lock', 12)} ${c.unlockCost}</span></button>`),
  ].join('')
  return `<div class="drawer-head"><h3>${slotIcon(slot, 20)} ${SLOT_LABEL[slot]}</h3>${close}</div>
    <div class="part-row">${tiles}</div>
    ${comp ? `<div class="part-info"><p class="up small">${svg('up', 12)} ${esc(comp.upside)}</p><p class="down small">${svg('down', 12)} ${esc(comp.downside)}</p></div>` : ''}`
}

export function defaultBindingsEqual(save: SaveData): boolean {
  return BTNS.every((b) => save.settings.bindings[b] === DEFAULT_BINDINGS[b])
}
