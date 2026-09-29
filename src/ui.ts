import { COMPONENTS, COMPONENT_MAP } from './data/components'
import { DAMAGE_RULES } from './data/damage'
import { ENEMIES } from './data/enemies'
import { ACHIEVEMENTS, HEATS, heatOf } from './data/meta'
import { SYNERGIES } from './data/synergies'
import { feelNumbers } from './build'
import type { CompiledBuild, DamageSource, HitSource, Stats } from './types'
import { SLOTS, type Slot } from './types'
import type { GameEvent } from './events'
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
}

export interface View {
  screen: Screen
  codexTab: 'components' | 'synergies' | 'enemies' | 'achievements'
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

  private style(id: string, prop: 'width' | 'background', value: string): void {
    const key = `${id}.${prop}`
    if (this.last.get(key) === value) return
    this.last.set(key, value)
    this.el(id).style[prop] = value
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
    el.innerHTML = `<div class="banner-inner ${kind}">${portrait ? `<img class="portrait" src="${portrait}" alt="" />` : ''}<div class="banner-kicker">${kind === 'boss' ? 'Final hold' : kind === 'clear' ? 'Room clear' : kind === 'phase' ? 'The Colossus shifts' : 'The Foundry'}</div><div class="banner-title">${esc(title)}</div>${sub ? `<div class="banner-sub">${esc(sub)}</div>` : ''}</div>`
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
    this.text('hp-num', `${Math.ceil(sim.hp)}/${Math.ceil(sim.maxHp)}${sim.shield > 0 ? ` +${Math.ceil(sim.shield)}` : ''}`)
    this.attr('hp-meter', 'aria-label', `Integrity ${Math.ceil(sim.hp)} of ${Math.ceil(sim.maxHp)}${sim.shield > 0 ? `, shield ${Math.ceil(sim.shield)}` : ''}`)
    this.text('hp-warn', low ? 'CRACKED' : '')
    this.text('room-name', sim.room.name)
    const extra = sim.room.rules?.includes('survival') && !sim.exitOpen ? ` · ${Math.ceil(sim.survivalLeft)} s` : sim.room.rules?.includes('speed-gate') ? ' · keep speed' : ''
    this.text('room-obj', (sim.exitOpen ? 'Gate open →' : sim.objectiveText() + extra))
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
      this.text('boss-phase', `Phase ${boss.phase}${boss.phase === 1 ? ' · plated' : boss.phase === 2 ? ' · heart open' : ' · floor failing'}`)
      this.attr('boss-bar', 'data-phase', String(boss.phase))
    }
    const ability = build.ability
    const block = sim.abilityBlock()
    this.text('ability-name', ability ? ability.name : 'No ability')
    this.text('ability-key', keyName(save.settings.bindings.ability))
    const state = !ability ? '' : block === 'cooldown' ? `${sim.abilityCd.toFixed(1)}s` : block === 'energy' ? `⚡${Math.ceil(ability.energy)}` : 'READY'
    this.text('ability-state', state)
    const readyNow = !!ability && block === null
    if (readyNow && this.last.get('ability-readout@data-state') !== 'ready') this.pulse('ability-dial', [{ transform: 'scale(1.3)', filter: 'brightness(2)' }, { transform: 'scale(1)', filter: 'none' }], 420)
    this.attr('ability-readout', 'data-state', !ability ? 'none' : block ?? 'ready')
    this.attr('ability-dial', 'aria-label', ability ? `${ability.name}: ${state}` : 'No ability')
    const cd = ability && sim.abilityCd > 0 ? 1 - sim.abilityCd / ability.cooldown : 1
    this.prop('ability-dial', '--p', `${(Math.max(0, Math.min(1, cd)) * 100).toFixed(0)}%`)
    this.style('energy-bar', 'width', `${((sim.energy / build.stats.energyMax) * 100).toFixed(0)}%`)
    this.text('energy-num', `⚡ ${Math.floor(sim.energy)}/${Math.round(build.stats.energyMax)}${ability ? ` · −${ability.energy}` : ''}`)
    const speed = Math.round(hypot(sim.ball.vx, sim.ball.vy))
    const ratio = speed / Math.max(1, sim.stats.maxSpeed)
    const armed = ratio >= TUNE.cleanRamRatio
    this.style('speed-bar', 'width', `${(Math.min(1, ratio) * 100).toFixed(0)}%`)
    this.toggle('speed-meter', 'armed', armed)
    this.text('speed-read', armed ? `RAM ${Math.round(speed / 10) * 10}` : `${Math.round(speed / 10) * 10}`)
    // Combo: a big number that pops on every link and drains between them.
    this.show('combo', sim.combo > 1)
    if (sim.combo > 1) {
      this.text('combo-num', `×${sim.combo}`)
      if (sim.combo > this.lastCombo) this.pulse('combo', [{ transform: `scale(${1.25 + Math.min(0.4, sim.combo * 0.03)}) rotate(-4deg)` }, { transform: 'scale(1) rotate(0)' }], 300)
      this.style('combo-timer', 'width', `${(Math.max(0, sim.comboTimer / TUNE.comboWindow) * 100).toFixed(0)}%`)
      this.attr('combo', 'data-tier', sim.combo >= 10 ? '3' : sim.combo >= 6 ? '2' : '1')
    }
    this.lastCombo = sim.combo
    this.text('instability-read', sim.instability > 2 ? `⚠ ${Math.round(sim.instability)}%` : '')
    const promptEl = this.el('prompt')
    if (promptEl.hidden !== !prompt) promptEl.hidden = !prompt
    this.text('prompt', prompt)
    const sheet = this.el('sheet')
    if (sheet.hidden !== !buildOpen) sheet.hidden = !buildOpen
    const key = buildOpen ? `${SLOTS.map((s) => build.ids[s]).join(',')}|${build.archetype}` : ''
    if (buildOpen && this.last.get('sheet') !== key) {
      this.last.set('sheet', key)
      sheet.innerHTML = sheetHtml(build)
    }
  }
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

function kbd(text: string): string {
  return `<kbd class="kbd">${esc(text)}</kbd>`
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
    ${run ? chip(icon('currency-cinders'), `${run.cinders}`, `${run.cinders} cinders: spent during this run`, 'cur cinder') : ''}
    ${chip(icon('currency-scrap'), `${save.scrap}`, `${save.scrap} scrap: forges new parts in the codex, between runs`, 'cur scrap')}
    ${chip(icon('currency-embers'), `${save.embers}`, `${save.embers} embers: kept between runs, spent on evolutions and fusions`, 'cur ember')}
  </div>`
}

function titleHtml(view: View): string {
  const heat = view.save.heatUnlocked
  const picked = heatOf(view.heatPick)
  const heats = HEATS.filter((h) => h.id <= heat).map((h) =>
    `<button class="btn heat-chip ${view.heatPick === h.id ? 'on' : ''}" data-act="heat" data-arg="${h.id}" aria-pressed="${view.heatPick === h.id}" aria-label="${esc(h.name)}" title="${esc(h.name)}">${svg('flame', 18)}<b>${h.id}</b></button>`,
  ).join('')
  const letters = (word: string, from: number) => word.split('').map((c, i) => `<span style="--i:${from + i}">${c}</span>`).join('')
  const cont = view.hasCheckpoint
  return `<div class="title-wrap">
    <div class="title-lockup">
      <div class="title-brand">
        <div class="kicker">Foundry slice</div>
        <h1 aria-label="Ballborn"><span class="logo-line">${letters('BALL', 0)}</span><span class="logo-line hot">${letters('BORN', 4)}</span></h1>
        <p class="tagline">Build a ball. Feel it. Break it. Rebuild it.</p>
      </div>
      <div class="title-actions">
        ${view.saveWarning ? `<p class="warn" role="status">${svg('warning', 18)} ${esc(view.saveWarning)}</p>` : ''}
        <nav class="title-menu" aria-label="Main menu">
          ${cont ? `<button class="btn primary big" data-act="continue" data-autofocus>${svg('resume', 24)}<span>Continue</span></button>` : ''}
          <button class="btn big ${cont ? '' : 'primary'}" data-act="launch" data-arg="run" ${cont ? '' : 'data-autofocus'}>${svg(cont ? 'plus' : 'play', 24)}<span>${cont ? 'New run' : 'Launch run'}</span></button>
        </nav>
        <div class="tiles" role="group" aria-label="More">
          ${tile('launch', 'flame', view.save.seenTutorial ? 'Tutorial' : 'Ignition', view.save.seenTutorial ? 'Replay first ignition' : 'First ignition', 'data-arg="tutorial"')}
          ${tile('lab', 'flask', 'Lab', 'Ball lab')}
          ${tile('codex', 'book', 'Codex')}
          ${tile('settings', 'gear', 'Settings')}
          ${view.canFullscreen && view.touch ? tile('fullscreen', 'fullscreen', 'Full', 'Full screen') : ''}
        </div>
        ${heat > 0 ? `<div class="heat-row"><div class="row" role="group" aria-label="Forge heat">${heats}</div>
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
        </div>
        <p class="muted small kbd-only">${controlsLine(view.save)}</p>
      </div>
    </div>
  </div>`
}

export function controlsLine(save: SaveData): string {
  const b = save.settings.bindings
  return `Roll ${keyName(b.left)}/${keyName(b.right)} or arrows. Hop ${keyName(b.up)}, Up, or Space. Ability ${keyName(b.ability)}, F, or right click. Controller: stick, A hop, B ability, Start pause.`
}

function settingsHtml(view: View): string {
  const s = view.save.settings
  const range = (key: string, ico: IconName, label: string, min: number, max: number, step: number, value: number, fmt = (v: number) => `${Math.round(v * 100)}%`) =>
    `<label class="field range">
      <span class="field-head">${svg(ico, 18)}<span>${label}</span><output data-out="${key}">${fmt(value)}</output></span>
      <input data-set="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" />
    </label>`
  const toggle = (key: string, label: string, value: boolean, hint = '') =>
    `<label class="toggle"><span>${label}${hint ? `<small class="muted">${hint}</small>` : ''}</span><input data-flag="${key}" type="checkbox" role="switch" ${value ? 'checked' : ''}/></label>`
  const segment = (key: string, options: [number, string][], value: number) =>
    `<select data-set="${key}">${options.map(([v, l]) => `<option value="${v}" ${value === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`
  const counts = new Map<string, number>()
  for (const btn of BTNS) counts.set(s.bindings[btn], (counts.get(s.bindings[btn]) ?? 0) + 1)
  const bind = (btn: Btn) => {
    const clash = (counts.get(s.bindings[btn]) ?? 0) > 1
    return `<button class="btn bind ${clash ? 'clash' : ''}" data-act="rebind" data-arg="${btn}"><span>${BTN_LABEL[btn]}</span><b>${view.rebinding === btn ? 'press a key…' : esc(keyName(s.bindings[btn]))}</b>${clash ? svg('warning', 16) : ''}</button>`
  }
  return `<div class="panel stack scroll settings">
    ${header('Settings', '', { back: 'close' })}
    <div class="settings-grid">
      <section class="stack">
        <h3>${svg('motion', 20)} Motion</h3>
        ${range('screenShake', 'impact', 'Shake', 0, 1, 0.05, s.screenShake)}
        ${range('particles', 'spark', 'Particles', 0, 1, 0.05, s.particles)}
        ${toggle('cameraMotion', 'Camera motion', s.cameraMotion, 'zoom, look-ahead, animations')}
        ${toggle('flashes', 'Screen flashes', s.flashes)}
        ${toggle('hitPause', 'Hit pause', s.hitPause, 'brief freeze on heavy hits')}
      </section>
      <section class="stack">
        <h3>${svg('eye', 20)} Readability</h3>
        ${toggle('highContrast', 'High contrast', s.highContrast)}
        ${toggle('colorblind', 'Shape markers', s.colorblind, 'letters on constructs, patterns on the ball')}
        ${range('hudScale', 'info', 'Interface size', 0.8, 1.5, 0.05, s.hudScale)}
      </section>
      <section class="stack">
        <h3>${svg('volume', 20)} Audio</h3>
        ${range('sfx', 'impact', 'Effects', 0, 1, 0.05, s.sfx)}
        ${range('music', 'volume', 'Music', 0, 1, 0.05, s.music)}
      </section>
      <section class="stack">
        <h3>${svg('assist', 20)} Assists</h3>
        <label class="field row-field"><span>${svg('gauge', 18)} Game speed</span>${segment('gameSpeed', [[0.7, '70%'], [0.85, '85%'], [1, '100%'], [1.15, '115%']], s.gameSpeed)}</label>
        <label class="field row-field"><span>${svg('shield', 18)} Damage taken</span>${segment('assistDamage', [[1, '100%'], [0.75, '75%'], [0.5, '50%']], s.assistDamage)}</label>
        <p class="muted small">Assists are noted on the run summary. They never lock anything.</p>
      </section>
      <section class="stack wide kbd-only">
        <h3>${svg('keyboard', 20)} Keys</h3>
        <div class="bind-grid">${BTNS.map(bind).join('')}</div>
        <p class="muted small">Arrows, Space, and F always work. Binding a key in use swaps the two. Esc cancels.</p>
        <div class="row"><button class="btn tiny" data-act="reset-keys">${svg('refresh', 16)} Reset keys</button></div>
      </section>
    </div>
    <div class="row"><button class="btn danger tiny" data-act="reset-save">${svg('trash', 16)} Erase progress…</button></div>
  </div>`
}

const CODEX_TABS: { id: View['codexTab']; ico: IconName; word: string }[] = [
  { id: 'components', ico: 'wrench', word: 'Parts' },
  { id: 'synergies', ico: 'link', word: 'Reactions' },
  { id: 'enemies', ico: 'target', word: 'Constructs' },
  { id: 'achievements', ico: 'trophy', word: 'Feats' },
]

function codexHtml(view: View): string {
  const tab = view.codexTab
  const tabs = CODEX_TABS.map((t) =>
    `<button class="btn tab ${tab === t.id ? 'on' : ''}" data-act="tab" data-arg="${t.id}" aria-pressed="${tab === t.id}">${svg(t.ico, 20)}<span>${t.word}</span></button>`,
  ).join('')
  let body = ''
  if (tab === 'components') {
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
      return `<article class="codex-card" data-rarity="${c.rarity}">
        <div class="cc-head">${slotIcon(c.slot, 30)}<div><h3>${esc(c.name)}</h3><div class="rarity ${c.rarity}">${SLOT_LABEL[c.slot]} · ${c.rarity}</div></div></div>
        <p class="desc">${esc(c.description)}</p>
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
      return `<article class="codex-card"><div class="cc-head">${svg('target', 28)}<h3>${esc(e.name)}</h3></div><p class="desc">${esc(e.codex)}</p><p class="small muted">${esc(e.question)}</p>${traits ? `<div class="chips">${traits}</div>` : ''}</article>`
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
    ${header('Codex', '', { back: 'close', right: currencies(view.save, null) })}
    <div class="tabs" role="group" aria-label="Codex sections">${tabs}</div>${body}</div>`
}

const NODE_W = 116
const NODE_H = 78
const COL_GAP = 30
const ROW_GAP = 14

const NODE_ICON: Record<MapNode['type'], IconName> = {
  combat: 'star', elite: 'crown', shop: 'tag', event: 'question', treasure: 'chest', traversal: 'wave', challenge: 'hourglass', boss: 'colossus',
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

function mapHtml(view: View): string {
  const run = view.run
  const build = view.build
  if (!run || !build) return ''
  const depth = Math.max(...run.nodes.map((n) => n.depth))
  const maxRows = Math.max(...Array.from({ length: depth + 1 }, (_, d) => run.nodes.filter((n) => n.depth === d).length))
  const height = maxRows * NODE_H + (maxRows - 1) * ROW_GAP
  const width = (depth + 1) * NODE_W + depth * COL_GAP
  const pos = new Map<string, { x: number; y: number }>()
  for (let d = 0; d <= depth; d++) {
    const col = run.nodes.filter((n) => n.depth === d)
    const colH = col.length * NODE_H + (col.length - 1) * ROW_GAP
    col.forEach((n, i) => pos.set(n.id, { x: d * (NODE_W + COL_GAP), y: (height - colH) / 2 + i * (NODE_H + ROW_GAP) }))
  }
  const onPath = new Set(run.nodes.filter((n) => n.state === 'done' || n.state === 'active').map((n) => n.id))
  let edges = ''
  for (const n of run.nodes) {
    const a = pos.get(n.id)!
    for (const id of n.next) {
      const m = run.nodes.find((x) => x.id === id)
      const b = pos.get(id)
      if (!m || !b) continue
      const cls = onPath.has(n.id) && onPath.has(id) ? 'taken' : n.state === 'done' && m.state === 'open' ? 'reachable' : n.state === 'missed' || m.state === 'missed' ? 'missed' : 'future'
      edges += `<line class="${cls}" x1="${a.x + NODE_W}" y1="${a.y + NODE_H / 2}" x2="${b.x}" y2="${b.y + NODE_H / 2}" />`
    }
  }
  const first = run.nodes.find((n) => n.state === 'open')
  const nodes = run.nodes.map((n) => nodeButton(n, build, run, pos.get(n.id)!, n === first)).join('')
  const stats = `${chip(svg('heart', 18), `${Math.ceil(run.hp)}/${Math.round(build.stats.maxHp)}`, `Integrity ${Math.ceil(run.hp)} of ${Math.round(build.stats.maxHp)}`, 'hp')}${run.heat ? chip(svg('flame', 18), `${run.heat}`, `Forge heat ${run.heat}`, 'heat') : ''}`
  return `<div class="panel stack scroll route">
    ${header('Choose a route', build.archetype, { right: `${stats}${currencies(view.save, run)}${iconBtn('menu', 'menu', 'Build and menu')}` })}
    <div class="map-scroll"><div class="map" style="width:${width}px;height:${height}px">
      <svg class="edges" width="${width}" height="${height}" aria-hidden="true">${edges}</svg>
      ${nodes}
    </div></div>
    <div class="map-legend" aria-hidden="true"><span>${svg('warning', 14)} risk</span><span>${icon('slot-core', 14)} part</span><span>${icon('currency-cinders', 14)} cinders</span><span>${icon('currency-embers', 14)} ember</span></div>
  </div>`
}

function nodeButton(n: MapNode, build: CompiledBuild, run: RunState, p: { x: number; y: number }, focus: boolean): string {
  const info = routeInfo(n.type, build, run)
  const state = n.state === 'open' ? 'Available' : n.state === 'done' ? 'Cleared' : n.state === 'active' ? 'Here' : n.state === 'missed' ? 'Passed by' : 'Later'
  const risk = riskLevel(info.risk)
  const meta = n.state === 'open'
    ? `<span class="node-meta"><span class="risk" data-level="${risk}" aria-hidden="true"><i></i><i></i><i></i></span><span class="pays">${NODE_REWARD[n.type].map((r) => icon(r, 16)).join('')}${n.type === 'boss' ? svg('trophy', 16) : n.type === 'event' ? svg('question', 16) : ''}</span></span>`
    : n.state === 'done' ? `<span class="node-state">${svg('check', 16)}</span>` : n.state === 'missed' ? `<span class="node-state">${svg('close', 14)}</span>` : ''
  const here = run.currentId === n.id && (n.state === 'done' || n.state === 'active')
  return `<button class="btn node ${n.state} type-${n.type}${here ? ' here' : ''}" style="left:${p.x}px;top:${p.y}px;width:${NODE_W}px;height:${NODE_H}px;--d:${n.depth}" data-act="enter" data-arg="${n.id}" ${n.state === 'open' ? '' : 'disabled'} ${focus ? 'data-autofocus' : ''} title="${esc(`${info.label}. Risk: ${info.risk} Reward: ${info.reward} ${info.advice}`)}" aria-label="${esc(`${info.label}. ${state}. ${n.state === 'open' ? `Risk: ${info.risk} Reward: ${info.reward} ${info.advice}` : ''}`)}">
    <span class="node-head"><span class="glyph" aria-hidden="true">${svg(NODE_ICON[n.type] ?? 'star', 18)}</span><b>${esc(info.label)}</b></span>${meta}
  </button>`
}

function rewardHtml(view: View): string {
  const run = view.run
  const salvage = run ? salvageValue(run.offerKind) : 0
  const rerolls = run?.rerolls ?? 0
  const actions = `<button class="btn icon-btn badge-btn" data-act="reroll" ${rerolls > 0 ? '' : 'disabled'} aria-label="Reroll (${rerolls} tokens)" title="Reroll (${rerolls} tokens)">${svg('dice')}<span class="badge">${rerolls}</span></button>
    ${run?.tutorial ? '' : `<button class="btn salvage" data-act="salvage" aria-label="Keep the ball and take ${salvage} cinders" title="Keep the ball: +${salvage} cinders">${svg('recycle', 20)}${icon('currency-cinders', 18)}<b>+${salvage}</b></button>`}`
  return `<div class="panel stack scroll reward">
    ${header('Choose one', 'Reward', { right: actions })}
    <div class="cards">${view.offers.map((o, i) => offerCard(o, i, view)).join('')}</div>
    <p class="muted small kbd-only">Keys 1, 2, 3 choose. Faint ball: yours now. Solid ball: with the new part, same input.</p>
  </div>`
}

function hpLine(h: NonNullable<Offer['hp']>): string {
  if (Math.round(h.maxAfter) === Math.round(h.maxBefore)) return ''
  const cls = h.maxAfter > h.maxBefore ? 'up' : 'down'
  return `<span class="${cls} hp-line" aria-label="Integrity ${Math.round(h.before)} of ${Math.round(h.maxBefore)} becomes ${Math.round(h.after)} of ${Math.round(h.maxAfter)}">${svg('heart', 16)} ${Math.round(h.maxBefore)} → <b>${Math.round(h.maxAfter)}</b></span>`
}

function offerCard(o: Offer, i: number, view: View): string {
  const bars = (o.bars ?? []).map((b) => {
    const delta = b.next - b.current
    const mark = Math.abs(delta) < 0.02 ? '' : delta > 0 ? `<span class="up">${svg('up', 10)}</span>` : `<span class="down">${svg('down', 10)}</span>`
    return `<div class="bar-row"><span>${b.label}${mark}</span><span class="bar" aria-hidden="true"><i style="width:${b.current * 100}%"></i><em style="width:${b.next * 100}%"></em></span></div>`
  }).join('')
  let numbers = ''
  if (o.kind === 'component' && o.componentId && o.slot && view.run && view.build) {
    const p = previewSwap(view.run, o.slot, o.componentId, view.save)
    numbers = `<details><summary>${svg('info', 16)} Numbers</summary>${statTable(p.current.stats, p.next.stats)}</details>`
  }
  const amount = o.kind === 'heal' ? `${svg('heart', 20)} +${o.amount}` : o.kind === 'cinders' ? `${icon('currency-cinders', 20)} +${o.amount}` : o.kind === 'reroll' ? `${svg('dice', 20)} +${o.amount}` : o.kind === 'ember' ? `${icon('currency-embers', 20)} +${o.amount}` : ''
  const tradeoff = o.kind === 'component' && o.bars?.some((b) => b.next < b.current - 0.02) && o.bars?.some((b) => b.next > b.current + 0.02)
  const art = o.slot ? `slot-${o.slot}` : o.kind === 'cinders' ? 'currency-cinders' : o.kind === 'ember' ? 'currency-embers' : o.kind === 'heal' ? 'core-balanced' : 'slot-passive'
  const chips = [
    ...(o.gained ?? []).map((g) => `<span class="tag up">${svg('link', 14)}${esc(g)}</span>`),
    ...(o.lost ?? []).map((l) => `<span class="tag down">${svg('unlink', 14)}${esc(l)}</span>`),
  ].join('')
  return `<article class="card kind-${o.kind}" data-rarity="${o.rarity ?? 'common'}" style="--i:${i}">
    <div class="card-head">${icon(art, 30)}<div class="rarity ${o.rarity ?? ''}">${o.slot ? SLOT_LABEL[o.slot] : o.kind}${o.rarity ? ` · ${o.rarity}` : ''}</div>${tradeoff ? `<span class="trade" title="Trade-off">${svg('swap', 16)}</span>` : ''}<span class="card-key kbd" aria-hidden="true">${i + 1}</span></div>
    <div class="card-body">
    ${o.kind === 'component' ? `<canvas data-preview="${i}" width="280" height="110" aria-hidden="true"></canvas>` : ''}
    <strong class="card-title">${esc(o.title)}</strong>
    ${o.kind === 'component' ? `<span class="small muted swap-line">${o.replaces ? `${svg('swap', 14)} ${esc(o.replaces.name)}` : `${svg('plus', 14)} Empty slot`}</span>` : ''}
    <span class="desc">${esc(o.description)}</span>
    ${amount ? `<span class="amount">${amount}</span>` : ''}
    ${o.upside ? `<span class="up">${svg('up', 12)} ${esc(o.upside)}</span>` : ''}
    ${o.downside ? `<span class="down">${svg('down', 12)} ${esc(o.downside)}</span>` : ''}
    ${o.hp ? hpLine(o.hp) : ''}
    ${chips ? `<div class="chips">${chips}</div>` : ''}
    ${bars ? `<div class="bars">${bars}</div>` : ''}
    ${numbers}
    </div>
    <button class="btn primary take" data-act="offer" data-arg="${i}" ${i === 0 ? 'data-autofocus' : ''} aria-label="Take ${esc(o.title)}">${svg('check', 20)}<span>Take</span></button>
  </article>`
}

function shopIcon(item: ShopItem): string {
  if (item.kind === 'component' && item.componentId) {
    const comp = COMPONENT_MAP[item.componentId]
    if (comp) return slotIcon(comp.slot, 34)
  }
  if (item.kind === 'heal') return svg('heart', 34)
  if (item.kind === 'reroll') return svg('dice', 34)
  if (item.kind === 'ember') return icon('currency-embers', 34)
  return svg('tag', 34)
}

function shopHtml(view: View): string {
  const run = view.run
  const cinders = run?.cinders ?? 0
  const rows = view.shop.map((item) => {
    const chips: string[] = []
    let rarity = ''
    if (item.kind === 'component' && item.componentId && run) {
      const comp = COMPONENT_MAP[item.componentId]!
      rarity = comp.rarity
      const p = previewSwap(run, comp.slot, comp.id, view.save)
      chips.push(`<span class="tag">${svg(p.replaced ? 'swap' : 'plus', 14)}${p.replaced ? esc(p.replaced.name) : 'Empty slot'}</span>`)
      for (const g of p.gained) chips.push(`<span class="tag up">${svg('link', 14)}${esc(g)}</span>`)
      for (const l of p.lost) chips.push(`<span class="tag down">${svg('unlink', 14)}${esc(l)}</span>`)
      if (Math.round(p.hp.maxAfter) !== Math.round(p.hp.maxBefore)) chips.push(`<span class="tag ${p.hp.maxAfter > p.hp.maxBefore ? 'up' : 'down'}">${svg('heart', 14)}${Math.round(p.hp.maxBefore)} → ${Math.round(p.hp.maxAfter)}</span>`)
    }
    const short = cinders < item.cost && !item.sold ? item.cost - cinders : 0
    const label = `${item.title}. ${item.sold ? 'Sold.' : `${item.cost} cinders${short ? `, need ${short} more` : ''}.`} ${item.detail}`
    return `<button class="btn shop-item kind-${item.kind} ${item.sold ? 'sold' : ''}" data-rarity="${rarity}" data-act="buy" data-arg="${item.id}" ${item.sold || short ? 'disabled' : ''} aria-label="${esc(label)}">
      <span class="si-icon">${shopIcon(item)}</span>
      <span class="si-body"><b>${esc(item.title)}</b><span class="small muted">${esc(item.detail)}</span>${chips.length ? `<span class="chips">${chips.join('')}</span>` : ''}</span>
      <span class="price">${item.sold ? svg('check', 18) : `${short ? svg('lock', 14) : ''}${icon('currency-cinders', 18)}<b>${item.cost}</b>`}</span>
    </button>`
  }).join('')
  return `<div class="panel stack scroll shop">
    ${header('Shop', 'Spend, or leave', { right: currencies(view.save, run) })}
    <div class="shop-grid">${rows}</div>
    <button class="btn primary leave" data-act="leave-shop" data-autofocus>${svg('exit', 20)}<span>Leave</span></button>
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
  return `<div class="panel stack scroll narrow event">
    ${header(ev.title, 'Event', { right: currencies(view.save, view.run) })}
    <p class="event-body">${esc(ev.body)}</p>
    <div class="stack">${ev.choices.map((c, i) => `<button class="btn event-choice" data-act="event" data-arg="${c.id}" ${c.disabled ? 'disabled' : ''} ${i === 0 && !c.disabled ? 'data-autofocus' : ''}>
      <span class="ec-head"><b>${esc(c.title)}</b>${cost(c)}</span>
      <span class="small muted">${esc(c.detail)}</span>
      ${c.disabled ? `<span class="small down">${svg('lock', 14)} ${esc(c.disabled)}</span>` : ''}
    </button>`).join('')}</div>
  </div>`
}

function pauseHtml(view: View): string {
  const build = view.build
  if (view.confirmAbandon) {
    return `<div class="panel stack narrow" role="alertdialog" aria-labelledby="abandon-title">
      <div class="kicker">Abandon run</div>
      <h2 id="abandon-title">${svg('flag', 26)} Leave this run?</h2>
      <p>${view.run && view.run.roomsCleared > 0 ? 'You keep the scrap a death would pay.' : 'No room cleared yet: it pays nothing.'}</p>
      <div class="row two"><button class="btn" data-act="abandon-cancel" data-autofocus>${svg('back', 20)}<span>Keep playing</span></button><button class="btn danger" data-act="abandon-confirm">${svg('flag', 20)}<span>Abandon</span></button></div>
    </div>`
  }
  return `<div class="panel stack narrow pause">
    <div class="kicker">Paused</div>
    <h2>${build ? esc(build.archetype) : 'Ballborn'}</h2>
    ${build ? slotGrid(build) : ''}
    <button class="btn primary big resume" data-act="resume" data-autofocus>${svg('resume', 24)}<span>Resume</span></button>
    <div class="tiles">
      ${tile('settings', 'gear', 'Settings')}
      ${tile('codex', 'book', 'Codex')}
      ${tile('abandon', 'flag', 'Abandon', 'Abandon run', '', 'danger')}
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
  return `<div class="panel stack scroll summary ${s.kind}">
    <div class="kicker">${s.kind === 'victory' ? 'The Colossus is scrap' : s.kind === 'abandon' ? 'Run abandoned' : 'The ball breaks'}</div>
    <h2 class="summary-title">${svg(s.kind === 'victory' ? 'trophy' : s.kind === 'abandon' ? 'flag' : 'skull', 34)} ${esc(s.title)}</h2>
    ${s.cause ? `<p class="cause" aria-label="Cause: ${esc(s.cause)}">${svg('skull', 18)}<b>${esc(s.cause)}</b></p>` : ''}
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
    <p class="tip">${esc(s.tip)}</p>
    <p class="idea">${svg('spark', 18)} ${esc(s.idea)}</p>
    <p class="muted foreman small">“${esc(s.line)}” — Foreman</p>
    <div class="reward-line">${chip(icon('currency-scrap', 22), `+${s.scrap}`, `${s.scrap} scrap earned`, 'cur scrap big')}${currencies(view.save, null)}</div>
    <div class="summary-grid">
      <section><h3>${svg('wrench', 18)} ${esc(s.archetype)}</h3><ul class="plain parts">${s.components.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
        ${s.decisions.length ? `<p class="muted small">${s.decisions.map(esc).join(' · ')}</p>` : ''}</section>
      <section><h3>${svg('map', 18)} Route</h3><ol class="plain route-list">${s.route.map((r) => `<li class="${r.result}">${svg(NODE_ICON[r.type] ?? 'star', 16)}<span>${esc(r.room)}</span>${r.taken ? `<span class="down small">−${r.taken}</span>` : ''}${r.result === 'death' ? svg('skull', 14) : ''}</li>`).join('') || '<li class="muted">No rooms.</li>'}</ol></section>
      <section><h3>${svg('heart', 18)} Taken</h3>${bars(s.taken)}</section>
      <section><h3>${svg('impact', 18)} Dealt</h3>${bars(s.dealt)}</section>
    </div>
    <p class="muted small">${svg('hash', 14)} ${s.seed} · ${svg('flame', 14)} ${s.heat}${s.assist ? ` · ${svg('assist', 14)} assists` : ''}</p>
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

function labHtml(view: View): string {
  const build = view.build
  if (!build) return ''
  const options = (slot: Slot) => {
    const list = COMPONENTS.filter((c) => c.slot === slot && (c.pool === 'standard' ? view.save.unlocked.includes(c.id) : view.save.discoveredComponents.includes(c.id)))
    return ['<option value="">Empty</option>'].concat(list.map((c) => `<option value="${c.id}" ${build.ids[slot] === c.id ? 'selected' : ''}>${esc(c.name)}</option>`)).join('')
  }
  const feel = feelNumbers(build.stats)
  const paused = view.labPaused
  return `<div class="lab-list ${paused ? 'active' : ''}">
    <div class="lab-bar">
      <div class="head-text"><div class="kicker">Ball lab${paused ? '' : `<span class="kbd-only"> · ${kbd('Esc')} edit</span>`}</div><h2>${esc(build.archetype)}</h2></div>
      ${paused
        ? `<button class="btn primary icon-btn" data-act="lab-resume" data-autofocus aria-label="Back to rolling" title="Back to rolling">${svg('play')}</button>`
        : iconBtn('lab-edit', 'wrench', 'Edit parts')}
      ${iconBtn('title', 'exit', 'Leave lab')}
    </div>
    <div class="lab-body">
      <div class="presets" role="group" aria-label="Presets">${PRESETS.map((p) => `<button class="btn preset" data-act="preset" data-arg="${p.name}" aria-label="${p.name} preset" title="${p.name}">${icon(PRESET_ICON[p.name] ?? 'core-balanced', 22)}<span>${p.name}</span></button>`).join('')}</div>
      <div class="slot-fields">${SLOTS.map((slot) => `<label class="field slot-field" title="${SLOT_LABEL[slot]}">${slotIcon(slot, 24)}<span class="sr-only">${SLOT_LABEL[slot]}</span><select data-slot="${slot}">${options(slot)}</select></label>`).join('')}</div>
      <div class="bars">${feel.map((b) => `<div class="bar-row"><span>${b.label}</span><span class="bar"><em style="width:${b.value * 100}%"></em></span></div>`).join('')}</div>
      <details><summary>${svg('info', 16)} Numbers</summary>${statTable(build.stats)}</details>
      ${build.strengths.length ? `<p class="up small">${svg('up', 12)} ${esc(build.strengths.join(' '))}</p>` : ''}
      ${build.weaknesses.length ? `<p class="down small">${svg('down', 12)} ${esc(build.weaknesses.join(' '))}</p>` : ''}
    </div>
  </div>`
}

export function defaultBindingsEqual(save: SaveData): boolean {
  return BTNS.every((b) => save.settings.bindings[b] === DEFAULT_BINDINGS[b])
}
