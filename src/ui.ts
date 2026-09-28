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
import { escapeHtml as esc, hypot } from './util'

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
  highlights: string[]
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

  update(sim: Simulation | null, run: RunState | null, build: CompiledBuild | null, save: SaveData, prompt: string, buildOpen: boolean): void {
    const playing = !!sim && !!build
    const hud = this.el('hud')
    if (hud.hidden === playing) hud.hidden = !playing
    if (!playing || !sim || !build) return
    const hpPct = Math.max(0, sim.hp / sim.maxHp) * 100
    const low = sim.lowHp
    this.style('hp-bar', 'width', `${hpPct.toFixed(1)}%`)
    this.style('hp-bar', 'background', low ? '#ff5d73' : 'linear-gradient(90deg, #ff5a1f, #ffb15a)')
    this.text('hp-num', `${Math.ceil(sim.hp)} / ${Math.ceil(sim.maxHp)}${sim.shield > 0 ? `  +${Math.ceil(sim.shield)} shield` : ''}`)
    this.text('hp-warn', low ? 'CRACKED' : '')
    this.text('room-name', sim.room.name)
    const extra = sim.room.rules?.includes('survival') && !sim.exitOpen ? ` · ${Math.ceil(sim.survivalLeft)} s` : sim.room.rules?.includes('speed-gate') ? ' · carry speed through the gate' : ''
    this.text('room-obj', (sim.exitOpen ? 'Gate open → ' : '') + sim.objectiveText() + extra)
    this.text('cinders', run ? `▲ ${run.cinders + sim.cinderPocket} cinders` : '')
    this.text('embers', `◆ ${save.embers} embers`)
    const ability = build.ability
    const block = sim.abilityBlock()
    this.text('ability-name', ability ? ability.name : 'No ability')
    const state = !ability ? '' : block === 'cooldown' ? `Cooling ${sim.abilityCd.toFixed(1)} s` : block === 'energy' ? `Needs ${Math.ceil(ability.energy)} energy` : 'READY'
    this.text('ability-state', state)
    this.attr('ability-readout', 'data-state', !ability ? 'none' : block ?? 'ready')
    const cd = ability && sim.abilityCd > 0 ? 1 - sim.abilityCd / ability.cooldown : 1
    this.style('ability-bar', 'width', `${(Math.max(0, Math.min(1, cd)) * 100).toFixed(0)}%`)
    this.style('energy-bar', 'width', `${((sim.energy / build.stats.energyMax) * 100).toFixed(0)}%`)
    this.text('energy-num', `${Math.floor(sim.energy)} / ${Math.round(build.stats.energyMax)} energy${ability ? ` · costs ${ability.energy}` : ''}`)
    const speed = Math.round(hypot(sim.ball.vx, sim.ball.vy))
    this.text('speed-read', `Speed ${Math.round(speed / 10) * 10}`)
    this.text('combo-read', sim.combo > 1 ? `Combo ×${sim.combo}` : '')
    this.text('instability-read', sim.instability > 2 ? `Instability ${Math.round(sim.instability)}%` : '')
    this.text('archetype', build.archetype)
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

function sheetHtml(build: CompiledBuild): string {
  return `
    <div class="kicker">Paused · build sheet</div>
    <h2>${esc(build.archetype)}</h2>
    <ul class="slot-list">${SLOTS.map((slot) => {
      const id = build.ids[slot]
      const comp = id ? COMPONENT_MAP[id] : undefined
      return `<li><b>${SLOT_LABEL[slot]}</b> ${comp ? esc(comp.name) : '<span class="muted">Empty</span>'}</li>`
    }).join('')}</ul>
    ${statTable(build.stats)}
    <p><b>Strengths.</b> ${esc(build.strengths.join(' ') || 'Still forming.')}</p>
    <p><b>Limits.</b> ${esc(build.weaknesses.join(' ') || 'No glaring limit.')}</p>
    <p><b>Reactions in the ball.</b> ${esc(build.synergies.map((s) => s.name).join(', ') || 'None primed.')}</p>
    <p class="muted">The game is paused while this sheet is open. Tab or Back closes it.</p>
  `
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
    ${run ? `<span class="cur cinder" title="Cinders: spent during this run">▲ ${run.cinders} cinders</span>` : ''}
    <span class="cur scrap" title="Scrap: forges new parts in the codex, between runs">■ ${save.scrap} scrap</span>
    <span class="cur ember" title="Embers: kept between runs, spent on evolutions and fusions">◆ ${save.embers} embers</span>
  </div>`
}

function titleHtml(view: View): string {
  const heat = view.save.heatUnlocked
  const picked = heatOf(view.heatPick)
  const heats = HEATS.filter((h) => h.id <= heat).map((h) =>
    `<button class="btn ${view.heatPick === h.id ? 'primary' : ''}" data-act="heat" data-arg="${h.id}" aria-pressed="${view.heatPick === h.id}">${h.name}</button>`,
  ).join('')
  return `<div class="title-wrap">
    <div class="title-lockup panel stack">
      <div class="kicker">Foundry slice</div>
      <h1>BALL<br>BORN</h1>
      <p>Build a ball. Feel the build physically. Master it. Break it. Rebuild it.</p>
      ${view.saveWarning ? `<p class="warn" role="status">${esc(view.saveWarning)}</p>` : ''}
      <div class="row">
        ${view.hasCheckpoint ? '<button class="btn primary" data-act="continue" data-autofocus>Continue run</button>' : ''}
        <button class="btn ${view.hasCheckpoint ? '' : 'primary'}" data-act="launch" data-arg="run" ${view.hasCheckpoint ? '' : 'data-autofocus'}>${view.hasCheckpoint ? 'New run' : 'Launch run'}</button>
        <button class="btn" data-act="launch" data-arg="tutorial">${view.save.seenTutorial ? 'Replay ignition' : 'First ignition'}</button>
        <button class="btn" data-act="lab">Ball lab</button>
        <button class="btn" data-act="codex">Codex</button>
        <button class="btn" data-act="settings">Settings</button>
      </div>
      ${heat > 0 ? `<div class="stack"><div class="kicker">Forge heat</div><div class="row" role="group" aria-label="Forge heat">${heats}</div>
        <ul class="heat-list">${picked.effects.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
      <label class="field seed">Seed (optional, for a repeatable route)
        <input data-seed type="text" inputmode="numeric" maxlength="10" value="${esc(view.seedText)}" placeholder="random" />
      </label>
      <p class="muted">${controlsLine(view.save)}</p>
      ${currencies(view.save, null)}
      <p class="muted">${view.save.stats.wins} wins · ${view.save.stats.runs} runs</p>
    </div>
  </div>`
}

export function controlsLine(save: SaveData): string {
  const b = save.settings.bindings
  return `Roll ${keyName(b.left)}/${keyName(b.right)} or arrows. Hop ${keyName(b.up)}, Up, or Space. Ability ${keyName(b.ability)}, F, or right click. Controller: stick, A hop, B ability, Start pause.`
}

function settingsHtml(view: View): string {
  const s = view.save.settings
  const range = (key: string, label: string, min: number, max: number, step: number, value: number, fmt = (v: number) => `${Math.round(v * 100)}%`) =>
    `<label class="field">${label} <span class="muted" data-out="${key}">${fmt(value)}</span><input data-set="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" /></label>`
  const check = (key: string, label: string, value: boolean, hint = '') =>
    `<label class="check"><input data-flag="${key}" type="checkbox" ${value ? 'checked' : ''}/> ${label}${hint ? ` <span class="muted">${hint}</span>` : ''}</label>`
  const counts = new Map<string, number>()
  for (const btn of BTNS) counts.set(s.bindings[btn], (counts.get(s.bindings[btn]) ?? 0) + 1)
  const bind = (btn: Btn) => {
    const clash = (counts.get(s.bindings[btn]) ?? 0) > 1
    return `<button class="btn bind ${clash ? 'clash' : ''}" data-act="rebind" data-arg="${btn}">${BTN_LABEL[btn]}: <b>${view.rebinding === btn ? 'press a key (Esc cancels)' : esc(keyName(s.bindings[btn]))}</b>${clash ? ' · conflict' : ''}</button>`
  }
  return `<div class="panel stack scroll">
    <div class="row spread"><div><div class="kicker">Access</div><h2>Settings</h2></div><button class="btn" data-act="close" data-autofocus>Back</button></div>
    <div class="settings-grid">
      <section class="stack">
        <h3>Motion and effects</h3>
        ${range('screenShake', 'Screen shake', 0, 1, 0.05, s.screenShake)}
        ${range('particles', 'Particles', 0, 1, 0.05, s.particles)}
        ${check('cameraMotion', 'Camera zoom and look-ahead', s.cameraMotion)}
        ${check('flashes', 'Screen flashes', s.flashes)}
        ${check('hitPause', 'Hit pause', s.hitPause, 'brief freeze on heavy hits')}
        <p class="muted">Hazard warnings, telegraphs, rings, and arcs always draw, whatever these are set to.</p>
      </section>
      <section class="stack">
        <h3>Readability</h3>
        ${check('highContrast', 'High contrast (world and menus)', s.highContrast)}
        ${check('colorblind', 'Stronger shape markers', s.colorblind, 'letters on constructs, patterns on the ball')}
        ${range('hudScale', 'Interface size', 0.8, 1.5, 0.05, s.hudScale)}
      </section>
      <section class="stack">
        <h3>Audio</h3>
        ${range('sfx', 'Effects volume', 0, 1, 0.05, s.sfx)}
        ${range('music', 'Music volume', 0, 1, 0.05, s.music)}
      </section>
      <section class="stack">
        <h3>Assists</h3>
        <label class="field">Game speed
          <select data-set="gameSpeed">
            ${[[0.7, 'Slowest (70%)'], [0.85, 'Slower (85%)'], [1, 'Normal'], [1.15, 'Faster (115%)']].map(([v, l]) => `<option value="${v}" ${s.gameSpeed === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </label>
        <label class="field">Damage taken
          <select data-set="assistDamage">
            ${[[1, 'Normal'], [0.75, '75%'], [0.5, '50%']].map(([v, l]) => `<option value="${v}" ${s.assistDamage === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </label>
        <p class="muted">Assists are noted on the run summary. They never lock anything.</p>
      </section>
      <section class="stack wide">
        <h3>Keys</h3>
        <div class="row">${BTNS.map(bind).join('')}</div>
        <p class="muted">Arrows, Space, and F always work as well. Binding a key already in use swaps the two.</p>
        <div class="row"><button class="btn" data-act="reset-keys">Reset keys to default</button></div>
      </section>
    </div>
    <div class="row"><button class="btn danger" data-act="reset-save">Erase progress…</button></div>
  </div>`
}

function codexHtml(view: View): string {
  const tab = view.codexTab
  const tabs = (['components', 'synergies', 'enemies', 'achievements'] as const).map((id) =>
    `<button class="btn ${tab === id ? 'primary' : ''}" data-act="tab" data-arg="${id}" aria-pressed="${tab === id}">${id}</button>`,
  ).join('')
  let body = ''
  if (tab === 'components') {
    body = `<div class="grid">${COMPONENTS.map((c) => {
      const standard = c.pool === 'standard'
      const unlocked = view.save.unlocked.includes(c.id)
      const known = view.save.discoveredComponents.includes(c.id) || c.startsUnlocked
      if (!standard && !known) {
        return `<article class="codex-card hidden-entry"><div class="kicker">${c.slot} · ${c.pool}</div><h3>Undiscovered forging</h3><p>${c.pool === 'fusion' ? 'A fusion. Found at the Crucible.' : 'An evolution. Found at the Annealing.'}</p></article>`
      }
      const forge = standard && !unlocked
        ? `<button class="btn tiny" data-act="unlock" data-arg="${c.id}" ${view.save.scrap < c.unlockCost ? 'disabled' : ''}>Forge · ${c.unlockCost} scrap${view.save.scrap < c.unlockCost ? ` (need ${c.unlockCost - view.save.scrap} more)` : ''}</button>`
        : standard ? '<span class="tag ok">In the pool</span>' : `<span class="tag">${c.pool}</span>`
      return `<article class="codex-card"><div class="kicker">${c.slot} · ${c.rarity}</div><h3>${esc(c.name)}</h3><p>${esc(c.description)}</p><p class="up">+ ${esc(c.upside)}</p><p class="down">− ${esc(c.downside)}</p>${forge}</article>`
    }).join('')}</div>`
  } else if (tab === 'synergies') {
    body = `<div class="grid">${SYNERGIES.map((s) => {
      const known = view.save.discoveredSynergies.includes(s.id)
      return `<article class="codex-card"><div class="kicker">${s.requires.map((r) => `${r.tag}${r.count > 1 ? ` ×${r.count}` : ''}`).join(' + ')}</div><h3>${known ? esc(s.name) : 'Undiscovered reaction'}</h3><p>${known ? esc(s.description) : 'Recorded when the ball actually does it.'}</p></article>`
    }).join('')}</div>`
  } else if (tab === 'enemies') {
    body = `<div class="grid">${ENEMIES.map((e) => {
      const known = view.save.discoveredEnemies.includes(e.id)
      const traits = [e.armorGate ? `Armor: weak rams under ${e.armorGate} damage are cut to ${Math.round((e.armorMul ?? 1) * 100)}%` : '', e.shield ? `Shield: frontal rams under ${e.shieldBreak} are blocked; hit from above or behind` : '', ...(e.resists ?? []).map((r) => `${r.tag} ×${r.mul}`)].filter(Boolean)
      return `<article class="codex-card"><h3>${known ? esc(e.name) : 'Unknown construct'}</h3><p>${known ? esc(e.codex) : 'A shape you have not met.'}</p>${known ? `<p class="muted">${esc(e.question)}</p>${traits.length ? `<p class="muted">${traits.map(esc).join('. ')}.</p>` : ''}` : ''}</article>`
    }).join('')}</div>`
  } else {
    body = `<div class="grid">${ACHIEVEMENTS.map((a) => {
      const row = view.save.achievements[a.id]
      const reward = [a.scrap ? `${a.scrap} scrap` : '', a.embers ? `${a.embers} ember` : '', a.unlocks ? `unlocks ${COMPONENT_MAP[a.unlocks]?.name ?? a.unlocks}` : ''].filter(Boolean).join(', ')
      return `<article class="codex-card"><h3>${row?.done ? '✓ ' : ''}${esc(a.name)}</h3><p>${esc(a.description)}</p><p class="muted">${row?.done ? 'Done' : `${Math.floor(row?.progress ?? 0)} / ${a.target}`} · ${reward}</p></article>`
    }).join('')}</div>`
  }
  return `<div class="panel stack scroll">
    <div class="row spread"><div><div class="kicker">Collection</div><h2>Codex</h2></div>${currencies(view.save, null)}<button class="btn" data-act="close" data-autofocus>Back</button></div>
    <div class="tabs" role="group" aria-label="Codex sections">${tabs}</div>${body}</div>`
}

const NODE_W = 150
const NODE_H = 96
const COL_GAP = 28
const ROW_GAP = 18

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
  const nodes = run.nodes.map((n) => nodeButton(n, build, run, pos.get(n.id)!)).join('')
  const hp = `${Math.ceil(run.hp)} / ${Math.round(build.stats.maxHp)}`
  return `<div class="panel stack scroll">
    <div class="row spread"><div><div class="kicker">${esc(build.archetype)} · integrity ${hp} · heat ${run.heat}</div><h2>Choose a route</h2></div>${currencies(view.save, run)}</div>
    <div class="map-scroll"><div class="map" style="width:${width}px;height:${height}px">
      <svg class="edges" width="${width}" height="${height}" aria-hidden="true">${edges}</svg>
      ${nodes}
    </div></div>
    <p class="muted">Routes only go forward. Taking a room closes the other rooms at that depth. ${esc(build.weaknesses[0] ?? '')}</p>
    <div class="row"><button class="btn" data-act="menu">Build and menu</button></div>
  </div>`
}

function nodeButton(n: MapNode, build: CompiledBuild, run: RunState, p: { x: number; y: number }): string {
  const info = routeInfo(n.type, build, run)
  const state = n.state === 'open' ? 'Available' : n.state === 'done' ? '✓ Cleared' : n.state === 'active' ? '● Here' : n.state === 'missed' ? '✕ Passed by' : 'Later'
  const detail = n.state === 'open' ? `<span class="small">Risk: ${esc(info.risk)}</span><span class="small">Reward: ${esc(info.reward)}</span>` : ''
  return `<button class="btn node ${n.state}" style="left:${p.x}px;top:${p.y}px;width:${NODE_W}px;height:${NODE_H}px" data-act="enter" data-arg="${n.id}" ${n.state === 'open' ? '' : 'disabled'} title="${esc(info.advice)}" aria-label="${esc(`${info.label}. ${state}. ${n.state === 'open' ? `Risk: ${info.risk} Reward: ${info.reward} ${info.advice}` : ''}`)}">
    <b>${esc(info.label)}</b> <span class="state">${state}</span>${detail}
  </button>`
}

function rewardHtml(view: View): string {
  const run = view.run
  const salvage = run ? salvageValue(run.offerKind) : 0
  return `<div class="panel stack scroll">
    <div class="row spread"><div><div class="kicker">One choice</div><h2>What does the ball need?</h2></div>
      <div class="row">
        <button class="btn" data-act="reroll" ${run && run.rerolls > 0 ? '' : 'disabled'}>Reroll (${run?.rerolls ?? 0} tokens)</button>
        ${run?.tutorial ? '' : `<button class="btn" data-act="salvage">Keep the ball · +${salvage} cinders</button>`}
      </div>
    </div>
    <div class="cards">${view.offers.map((o, i) => offerCard(o, i, view)).join('')}</div>
    <p class="muted">Keys 1, 2, 3 choose. Previews run the game's own movement code: the faint ball is yours now, the solid one has the new part, both given the same input.</p>
  </div>`
}

function hpLine(h: NonNullable<Offer['hp']>): string {
  if (Math.round(h.maxAfter) === Math.round(h.maxBefore)) return ''
  const cls = h.maxAfter > h.maxBefore ? 'up' : 'down'
  return `<span class="${cls}">Integrity ${Math.round(h.before)}/${Math.round(h.maxBefore)} → ${Math.round(h.after)}/${Math.round(h.maxAfter)}</span>`
}

function offerCard(o: Offer, i: number, view: View): string {
  const bars = (o.bars ?? []).map((b) => {
    const delta = b.next - b.current
    const mark = Math.abs(delta) < 0.02 ? '' : delta > 0 ? '▲' : '▼'
    return `<div class="bar-row"><span>${b.label} ${mark}</span><span class="bar" aria-hidden="true"><i style="width:${b.current * 100}%"></i><em style="width:${b.next * 100}%"></em></span></div>`
  }).join('')
  let numbers = ''
  if (o.kind === 'component' && o.componentId && o.slot && view.run && view.build) {
    const p = previewSwap(view.run, o.slot, o.componentId, view.save)
    numbers = `<details><summary>Numbers</summary>${statTable(p.current.stats, p.next.stats)}<p class="muted">Bars run from the lightest to the heaviest possible part. Grey is your ball now, orange is with this part.</p></details>`
  }
  const amount = o.kind === 'heal' ? `+${o.amount} integrity` : o.kind === 'cinders' ? `+${o.amount} cinders` : o.kind === 'reroll' ? `+${o.amount} reroll token` : o.kind === 'ember' ? `+${o.amount} ember (kept between runs)` : ''
  const tradeoff = o.kind === 'component' && o.bars?.some((b) => b.next < b.current - 0.02) && o.bars?.some((b) => b.next > b.current + 0.02)
  return `<article class="card">
    ${o.kind === 'component' ? `<canvas data-preview="${i}" width="280" height="110" aria-hidden="true"></canvas>` : ''}
    <div class="rarity ${o.rarity ?? ''}">${o.slot ? SLOT_LABEL[o.slot] : o.kind} ${o.rarity ?? ''}${tradeoff ? ' · trade-off' : ''}</div>
    <strong>${esc(o.title)}</strong>
    ${o.kind === 'component' ? `<span class="muted">${o.replaces ? `Replaces ${esc(o.replaces.name)}` : 'Fills an empty slot'}</span>` : ''}
    <span>${esc(o.description)}</span>
    ${amount ? `<span class="amount">${amount}</span>` : ''}
    ${o.upside ? `<span class="up">+ ${esc(o.upside)}</span>` : ''}
    ${o.downside ? `<span class="down">− ${esc(o.downside)}</span>` : ''}
    ${o.hp ? hpLine(o.hp) : ''}
    ${o.gained?.length ? `<span class="up">Primes: ${o.gained.map(esc).join(', ')}</span>` : ''}
    ${o.lost?.length ? `<span class="down">Breaks: ${o.lost.map(esc).join(', ')}</span>` : ''}
    ${bars}
    ${numbers}
    <button class="btn primary take" data-act="offer" data-arg="${i}" ${i === 0 ? 'data-autofocus' : ''}>${i + 1}. Take ${esc(o.title)}</button>
  </article>`
}

function shopHtml(view: View): string {
  const run = view.run
  const cinders = run?.cinders ?? 0
  const rows = view.shop.map((item) => {
    let extra = ''
    if (item.kind === 'component' && item.componentId && run) {
      const comp = COMPONENT_MAP[item.componentId]!
      const p = previewSwap(run, comp.slot, comp.id, view.save)
      extra = [
        p.replaced ? `Replaces ${esc(p.replaced.name)}.` : 'Fills an empty slot.',
        p.gained.length ? `<span class="up">Primes ${p.gained.map(esc).join(', ')}.</span>` : '',
        p.lost.length ? `<span class="down">Breaks ${p.lost.map(esc).join(', ')}.</span>` : '',
        Math.round(p.hp.maxAfter) !== Math.round(p.hp.maxBefore) ? `Integrity ${Math.round(p.hp.before)}/${Math.round(p.hp.maxBefore)} → ${Math.round(p.hp.after)}/${Math.round(p.hp.maxAfter)}.` : '',
      ].filter(Boolean).join(' ')
    }
    const short = cinders < item.cost && !item.sold ? ` · need ${item.cost - cinders} more` : ''
    return `<button class="btn shop-item" data-act="buy" data-arg="${item.id}" ${item.sold || cinders < item.cost ? 'disabled' : ''}>
      <b>${item.sold ? 'Sold · ' : ''}${esc(item.title)}</b> <span class="price">▲ ${item.cost}${short}</span><br/><span class="muted">${esc(item.detail)}</span>${extra ? `<br/><span class="small">${extra}</span>` : ''}
    </button>`
  }).join('')
  return `<div class="panel stack scroll">
    <div class="row spread"><div><div class="kicker">Shop</div><h2>Spend, or leave.</h2></div>${currencies(view.save, run)}</div>
    <div class="stack">${rows}</div>
    <button class="btn primary" data-act="leave-shop" data-autofocus>Leave the shop</button>
  </div>`
}

function eventHtml(view: View): string {
  const ev = view.event
  if (!ev) return ''
  return `<div class="panel stack scroll narrow">
    <div class="row spread"><div class="kicker">Event</div>${currencies(view.save, view.run)}</div>
    <h2>${esc(ev.title)}</h2>
    <p>${esc(ev.body)}</p>
    <div class="stack">${ev.choices.map((c, i) => `<button class="btn event-choice" data-act="event" data-arg="${c.id}" ${c.disabled ? 'disabled' : ''} ${i === 0 && !c.disabled ? 'data-autofocus' : ''}><b>${esc(c.title)}</b><br/><span class="muted">${esc(c.detail)}</span>${c.disabled ? `<br/><span class="down">${esc(c.disabled)}</span>` : ''}</button>`).join('')}</div>
  </div>`
}

function pauseHtml(view: View): string {
  const build = view.build
  if (view.confirmAbandon) {
    return `<div class="panel stack narrow" role="alertdialog" aria-labelledby="abandon-title">
      <div class="kicker">Abandon run</div>
      <h2 id="abandon-title">Leave this run?</h2>
      <p>The run ends here. ${view.run && view.run.roomsCleared > 0 ? 'You keep the scrap a death would pay.' : 'No room is cleared yet, so it pays nothing.'}</p>
      <div class="row"><button class="btn" data-act="abandon-cancel" data-autofocus>Keep playing</button><button class="btn danger" data-act="abandon-confirm">Abandon</button></div>
    </div>`
  }
  return `<div class="panel stack narrow">
    <div class="kicker">Paused</div>
    <h2>${build ? esc(build.archetype) : 'Ballborn'}</h2>
    ${build ? `<p>${build.components.map((c) => esc(c.name)).join(' · ')}</p><p class="muted">${esc(build.weaknesses.join(' '))}</p>` : ''}
    <div class="row">
      <button class="btn primary" data-act="resume" data-autofocus>Resume</button>
      <button class="btn" data-act="settings">Settings</button>
      <button class="btn" data-act="codex">Codex</button>
      <button class="btn" data-act="abandon">Abandon run…</button>
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
      : '<p class="muted">Nothing recorded.</p>'
  }
  return `<div class="panel stack scroll">
    <div class="kicker">${s.kind === 'victory' ? 'The Colossus is scrap' : s.kind === 'abandon' ? 'Run abandoned' : 'The ball breaks'}</div>
    <h2>${esc(s.title)}</h2>
    ${s.cause ? `<p><b>Cause:</b> ${esc(s.cause)}</p>` : ''}
    <p>${esc(s.tip)}</p>
    <p class="muted foreman">Foreman: “${esc(s.line)}”</p>
    <p class="idea"><b>Try next:</b> ${esc(s.idea)}</p>
    <div class="row">
      <button class="btn primary" data-act="launch" data-arg="run" data-autofocus>One more run</button>
      <button class="btn" data-act="retry-seed" data-arg="${s.seed}">Same seed again</button>
      <button class="btn" data-act="lab">Ball lab</button>
      <button class="btn" data-act="codex">Unlocks</button>
      <button class="btn" data-act="title">Title</button>
    </div>
    <div class="summary-grid">
      <section><h3>${esc(s.archetype)}</h3><ul class="plain">${s.components.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
        ${s.decisions.length ? `<p class="muted">Changes: ${s.decisions.map(esc).join(' · ')}</p>` : ''}</section>
      <section><h3>Route</h3><ol class="plain">${s.route.map((r) => `<li>${esc(r.room)} <span class="muted">(${r.type}, −${r.taken})</span>${r.result === 'death' ? ' ✕' : ''}</li>`).join('') || '<li class="muted">No rooms.</li>'}</ol></section>
      <section><h3>Damage taken</h3>${bars(s.taken)}</section>
      <section><h3>Damage dealt</h3>${bars(s.dealt)}</section>
    </div>
    <p>${s.highlights.map(esc).join(' · ')}</p>
    <p><b>+${s.scrap} scrap.</b> ${currencies(view.save, null)}</p>
    <p class="muted">Seed ${s.seed} · Heat ${s.heat}${s.assist ? ' · assists on' : ''}</p>
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
  return `<div class="lab-list ${view.labPaused ? 'active' : ''}">
    <div class="kicker">Ball lab ${view.labPaused ? '· paused, editing' : '· Esc to edit parts'}</div>
    <h2>${esc(build.archetype)}</h2>
    <p class="muted">Swap parts. The dummies come back. Nothing here touches a run or your save.</p>
    <div class="row presets">${PRESETS.map((p) => `<button class="btn tiny" data-act="preset" data-arg="${p.name}">${p.name}</button>`).join('')}</div>
    ${SLOTS.map((slot) => `<label class="field">${SLOT_LABEL[slot]}<select data-slot="${slot}">${options(slot)}</select></label>`).join('')}
    ${feel.map((b) => `<div class="bar-row"><span>${b.label}</span><span class="bar"><em style="width:${b.value * 100}%"></em></span></div>`).join('')}
    <details><summary>Numbers</summary>${statTable(build.stats)}</details>
    <p>${esc(build.strengths.join(' '))}</p>
    <p class="down">${esc(build.weaknesses.join(' '))}</p>
    <div class="row">${view.labPaused ? '<button class="btn primary" data-act="lab-resume" data-autofocus>Back to rolling</button>' : ''}<button class="btn" data-act="title">Leave lab</button></div>
  </div>`
}

export function defaultBindingsEqual(save: SaveData): boolean {
  return BTNS.every((b) => save.settings.bindings[b] === DEFAULT_BINDINGS[b])
}
