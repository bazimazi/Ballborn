import { COMPONENTS, COMPONENT_MAP } from './data/components'
import { ENEMIES } from './data/enemies'
import { ACHIEVEMENTS, HEATS } from './data/meta'
import { SYNERGIES } from './data/synergies'
import { archetypeOf } from './build'
import type { CompiledBuild } from './types'
import { SLOTS, type Slot } from './types'
import type { Offer, RunState, ShopItem, GameEvent, MapNode } from './run'
import { routeAdvice, currentBuild } from './run'
import type { SaveData, Btn } from './save'
import type { Simulation } from './sim'
import { hypot } from './util'

export type Screen =
  | 'title' | 'settings' | 'codex' | 'lab' | 'map' | 'play'
  | 'reward' | 'shop' | 'event' | 'pause' | 'death' | 'victory'

export interface View {
  screen: Screen
  codexTab: 'components' | 'synergies' | 'enemies' | 'achievements'
  save: SaveData
  run: RunState | null
  build: CompiledBuild | null
  offers: Offer[]
  shop: ShopItem[]
  event: GameEvent | null
  prompt: string
  buildOpen: boolean
  death: { cause: string; tip: string; scrap: number; idea: string } | null
  victory: { scrap: number; idea: string; archetype: string } | null
  rebinding: Btn | null
  heatPick: number
  log: string
}

export function updateHud(sim: Simulation | null, run: RunState | null, build: CompiledBuild | null, prompt: string, buildOpen: boolean): void {
  const hud = document.getElementById('hud')!
  const playing = !!sim && !!build
  hud.hidden = !playing
  if (!playing || !sim || !build || !run) return
  const hpPct = Math.max(0, sim.hp / sim.maxHp) * 100
  const bar = document.getElementById('hp-bar')!
  bar.style.width = `${hpPct}%`
  bar.style.background = hpPct < 32 ? '#ff5d73' : 'linear-gradient(90deg, #ff5a1f, #ffb15a)'
  document.getElementById('hp-num')!.textContent = `${Math.ceil(sim.hp)} / ${Math.ceil(sim.maxHp)}${sim.shield > 0 ? ` +${Math.ceil(sim.shield)}` : ''}`
  document.getElementById('room-name')!.textContent = sim.room.name
  const extra = sim.room.rules?.includes('survival') ? ` · ${Math.ceil(sim.survivalLeft)}s` : sim.room.rules?.includes('speed-gate') ? ' · carry speed through the gate' : ''
  document.getElementById('room-obj')!.textContent = (sim.exitOpen ? 'Gate open. ' : '') + sim.room.objective + extra
  document.getElementById('cinders')!.textContent = `${run.cinders} cinders`
  document.getElementById('embers')!.textContent = `${run.embers} embers`
  const speed = Math.round(hypot(sim.ball.vx, sim.ball.vy))
  document.getElementById('speed-read')!.textContent = `Speed ${speed}`
  document.getElementById('combo-read')!.textContent = sim.combo > 1 ? `Combo ${sim.combo}` : 'Combo —'
  document.getElementById('instability-read')!.textContent = sim.instability > 2 ? `Instability ${Math.round(sim.instability)}` : ''
  const ability = build.ability
  document.getElementById('ability-name')!.textContent = ability ? `${ability.name} · ${Math.ceil(ability.energy)} energy` : 'No ability'
  const cd = ability && sim.abilityCd > 0 ? 1 - sim.abilityCd / ability.cooldown : sim.energy / build.stats.energyMax
  document.getElementById('ability-bar')!.style.width = `${Math.max(0, Math.min(1, cd)) * 100}%`
  document.getElementById('energy-num')!.textContent = `${Math.ceil(sim.energy)} energy`
  document.getElementById('slots')!.innerHTML = SLOTS.map((slot) => {
    const id = build.ids[slot]
    const comp = id ? COMPONENT_MAP[id] : undefined
    return `<div class="slot-pip"><b>${slot}</b>${comp ? comp.name : 'Empty'}</div>`
  }).join('')
  const promptEl = document.getElementById('prompt')!
  promptEl.hidden = !prompt
  promptEl.textContent = prompt
  const sheet = document.getElementById('sheet')!
  sheet.hidden = !buildOpen
  if (buildOpen) sheet.innerHTML = sheetHtml(build, run)
}

function sheetHtml(build: CompiledBuild, run: RunState): string {
  const s = build.stats
  return `
    <div class="kicker">${build.archetype}</div>
    <h2>${build.archetype}</h2>
    <p class="muted">Mass ${s.mass.toFixed(2)} · speed ${Math.round(s.maxSpeed)} · bounce ${s.restitution.toFixed(2)} · impact ${s.impact.toFixed(2)}</p>
    <p><b>Strengths.</b> ${build.strengths.join(' ') || 'Still forming.'}</p>
    <p><b>Limits.</b> ${build.weaknesses.join(' ') || 'No glaring limit.'}</p>
    <p><b>Reactions in the ball.</b></p>
    <ul>${build.synergies.map((syn) => `<li>${run ? syn.name : syn.name}</li>`).join('') || '<li>None primed.</li>'}</ul>
    <p class="muted">Tab closes this sheet. The numbers are the ball you are steering.</p>
  `
}

export function screenHtml(view: View): string {
  switch (view.screen) {
    case 'play':
    case 'lab':
      return view.screen === 'lab' ? labHtml(view) : ''
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
      return deathHtml(view)
    case 'victory':
      return victoryHtml(view)
    default:
      return ''
  }
}

function titleHtml(view: View): string {
  const heat = view.save.heatUnlocked
  const heats = HEATS.filter((h) => h.id <= heat).map((h) =>
    `<button class="btn ${view.heatPick === h.id ? 'primary' : ''}" data-act="heat" data-arg="${h.id}">${h.name}</button>`,
  ).join('')
  return `<div class="panel" style="display:grid;grid-template-columns:1.1fr .9fr;gap:24px;background:transparent;border:0;box-shadow:none">
    <div class="title-lockup">
      <div class="kicker">Foundry slice</div>
      <h1>BALL<br>BORN</h1>
      <p>Build a ball. Feel the build physically. Master it. Break it. Rebuild it.</p>
      <div class="row">
        <button class="btn primary" data-act="launch" data-arg="run">Launch run</button>
        <button class="btn" data-act="launch" data-arg="tutorial">${view.save.seenTutorial ? 'Replay ignition' : 'First ignition'}</button>
        <button class="btn" data-act="lab">Ball lab</button>
        <button class="btn" data-act="codex">Codex</button>
        <button class="btn" data-act="settings">Settings</button>
      </div>
      <p class="muted">Move A/D or arrows. Hop with W or Space. Ability on Shift, F, or right click. A controller works: stick, A to hop, B to use the ability.</p>
      <p class="muted">${view.save.scrap} scrap · ${view.save.embers} embers · ${view.save.stats.wins} wins</p>
      ${heat > 0 ? `<div class="stack"><div class="kicker">Forge heat</div><div class="row">${heats}</div><p class="muted">${HEATS[view.save.heatUnlocked]?.detail ?? ''}</p></div>` : ''}
    </div>
  </div>`
}

function settingsHtml(view: View): string {
  const s = view.save.settings
  const bind = (btn: Btn, label: string) =>
    `<button class="btn" data-act="rebind" data-arg="${btn}">${label}: ${view.rebinding === btn ? 'press a key' : s.bindings[btn]}</button>`
  return `<div class="panel stack">
    <div class="kicker">Access</div>
    <h2>Settings</h2>
    <label class="field">Screen shake <input data-set="screenShake" type="range" min="0" max="1" step="0.05" value="${s.screenShake}" /></label>
    <label class="field">Effects <input data-set="sfx" type="range" min="0" max="1" step="0.05" value="${s.sfx}" /></label>
    <label class="field">Music <input data-set="music" type="range" min="0" max="1" step="0.05" value="${s.music}" /></label>
    <label class="field">Game speed
      <select data-set="gameSpeed">
        <option value="0.85" ${s.gameSpeed === 0.85 ? 'selected' : ''}>Slower</option>
        <option value="1" ${s.gameSpeed === 1 ? 'selected' : ''}>Normal</option>
        <option value="1.15" ${s.gameSpeed === 1.15 ? 'selected' : ''}>Faster</option>
      </select>
    </label>
    <label><input data-flag="reducedEffects" type="checkbox" ${s.reducedEffects ? 'checked' : ''}/> Reduced effects and no hit pause</label>
    <label><input data-flag="highContrast" type="checkbox" ${s.highContrast ? 'checked' : ''}/> High contrast</label>
    <label><input data-flag="colorblind" type="checkbox" ${s.colorblind ? 'checked' : ''}/> Stronger shape markers</label>
    <div class="row">${bind('left', 'Left')}${bind('right', 'Right')}${bind('up', 'Hop')}${bind('down', 'Drop')}${bind('ability', 'Ability')}${bind('pause', 'Pause')}${bind('build', 'Build sheet')}</div>
    <div class="row">
      <button class="btn" data-act="close">Back</button>
      <button class="btn" data-act="reset-save">Reset save</button>
    </div>
  </div>`
}

function codexHtml(view: View): string {
  const tab = view.codexTab
  const tabs = (['components', 'synergies', 'enemies', 'achievements'] as const).map((id) =>
    `<button class="btn ${tab === id ? 'primary' : ''}" data-act="tab" data-arg="${id}">${id}</button>`,
  ).join('')
  let body = ''
  if (tab === 'components') {
    body = `<div class="grid">${COMPONENTS.map((c) => {
      const unlocked = view.save.unlocked.includes(c.id) || c.pool !== 'standard'
      const known = view.save.discoveredComponents.includes(c.id) || c.startsUnlocked
      if (c.pool !== 'standard' && !known) {
        return `<article class="codex-card hidden-entry"><div class="kicker">${c.slot}</div><h3>Undiscovered forging</h3><p>A silhouette in the kiln.</p></article>`
      }
      if (!known && !unlocked) {
        return `<article class="codex-card"><div class="kicker">${c.slot} · ${c.rarity}</div><h3>${c.name}</h3><p>${c.upside}</p><p class="down">${c.downside}</p><button class="btn tiny" data-act="unlock" data-arg="${c.id}" ${view.save.scrap < c.unlockCost ? 'disabled' : ''}>Forge ${c.unlockCost} scrap</button></article>`
      }
      return `<article class="codex-card"><div class="kicker">${c.slot} · ${c.rarity}</div><h3>${c.name}</h3><p>${c.description}</p><p class="up">${c.upside}</p><p class="down">${c.downside}</p>${c.pool === 'standard' && !view.save.unlocked.includes(c.id) ? `<button class="btn tiny" data-act="unlock" data-arg="${c.id}">Forge ${c.unlockCost} scrap</button>` : ''}</article>`
    }).join('')}</div>`
  } else if (tab === 'synergies') {
    body = `<div class="grid">${SYNERGIES.map((s) => {
      const known = view.save.discoveredSynergies.includes(s.id)
      return `<article class="codex-card"><div class="kicker">${s.requires.map((r) => r.tag).join(' + ')}</div><h3>${known ? s.name : 'Undiscovered reaction'}</h3><p>${known ? s.description : 'Seen when the ball actually does it.'}</p></article>`
    }).join('')}</div>`
  } else if (tab === 'enemies') {
    body = `<div class="grid">${ENEMIES.map((e) => {
      const known = view.save.discoveredEnemies.includes(e.id)
      return `<article class="codex-card"><h3>${known ? e.name : 'Unknown construct'}</h3><p>${known ? e.codex : 'A shape you have not met.'}</p>${known ? `<p class="muted">${e.question}</p>` : ''}</article>`
    }).join('')}</div>`
  } else {
    body = `<div class="grid">${ACHIEVEMENTS.map((a) => {
      const row = view.save.achievements[a.id]
      return `<article class="codex-card"><h3>${a.name}</h3><p>${a.description}</p><p class="muted">${row?.done ? 'Done' : `${Math.floor(row?.progress ?? 0)} / ${a.target}`}</p></article>`
    }).join('')}</div>`
  }
  return `<div class="panel"><div class="row"><div><div class="kicker">Collection</div><h2>Codex</h2></div><button class="btn" data-act="close">Back</button></div><div class="tabs">${tabs}</div>${body}</div>`
}

function mapHtml(view: View): string {
  const run = view.run
  const build = view.build
  if (!run || !build) return ''
  const depths = Math.max(...run.nodes.map((n) => n.depth))
  let cols = ''
  for (let d = 0; d <= depths; d++) {
    const nodes = run.nodes.filter((n) => n.depth === d)
    cols += `<div class="map-col">${nodes.map((n) => nodeButton(n, build)).join('')}</div>`
  }
  return `<div class="panel stack">
    <div class="row"><div><div class="kicker">${build.archetype} · integrity ${Math.ceil(run.hp)} · ${run.cinders} cinders</div><h2>Choose a route</h2></div></div>
    <div class="map">${cols}</div>
    <p class="muted">${build.weaknesses[0] ?? 'The ball is balanced enough to take any open door.'}</p>
  </div>`
}

function nodeButton(n: MapNode, build: CompiledBuild): string {
  const advice = routeAdvice(n.type, build)
  return `<button class="btn node ${n.state}" data-act="enter" data-arg="${n.id}" ${n.state === 'open' ? '' : 'disabled'}>
    <b>${n.type}</b><br/><span class="muted">${n.state === 'locked' ? 'Later' : advice}</span>
  </button>`
}

function rewardHtml(view: View): string {
  return `<div class="panel stack">
    <div class="row"><div><div class="kicker">One choice</div><h2>What does the ball need?</h2></div>
      <button class="btn" data-act="reroll" ${view.run && view.run.rerolls > 0 ? '' : 'disabled'}>Reroll (${view.run?.rerolls ?? 0})</button>
    </div>
    <div class="cards">${view.offers.map((o, i) => offerCard(o, i)).join('')}</div>
    <p class="muted">Keys 1, 2, and 3 choose. The preview is the same hop and bounce the real ball uses.</p>
  </div>`
}

function offerCard(o: Offer, i: number): string {
  const bars = (o.bars ?? []).map((b) => `<div class="bar-row"><span>${b.label}</span><span class="bar"><i style="width:${b.current * 100}%"></i><em style="width:${b.next * 100}%"></em></span></div>`).join('')
  return `<button class="card" data-act="offer" data-arg="${i}">
    <canvas data-preview="${i}" width="280" height="88"></canvas>
    <div class="rarity ${o.rarity ?? ''}">${o.slot ?? o.kind} ${o.rarity ?? ''}</div>
    <strong>${o.title}</strong>
    <span>${o.description}</span>
    ${o.upside ? `<span class="up">${o.upside}</span>` : ''}
    ${o.downside ? `<span class="down">${o.downside}</span>` : ''}
    ${bars}
    ${(o.hints ?? []).map((h) => `<span class="muted">${h}</span>`).join('')}
  </button>`
}

function shopHtml(view: View): string {
  const run = view.run
  return `<div class="panel stack">
    <div class="kicker">Shop · ${run?.cinders ?? 0} cinders</div>
    <h2>Spend, or leave.</h2>
    <div class="stack">${view.shop.map((item) => `<button class="btn" data-act="buy" data-arg="${item.id}" ${item.sold || (run?.cinders ?? 0) < item.cost ? 'disabled' : ''}>${item.sold ? 'Sold' : `${item.title} — ${item.cost}`}<br/><span class="muted">${item.detail}</span></button>`).join('')}</div>
    <button class="btn primary" data-act="leave-shop">Leave</button>
  </div>`
}

function eventHtml(view: View): string {
  const ev = view.event
  if (!ev) return ''
  return `<div class="panel stack">
    <div class="kicker">Event</div>
    <h2>${ev.title}</h2>
    <p>${ev.body}</p>
    <div class="stack">${ev.choices.map((c) => `<button class="btn" data-act="event" data-arg="${c.id}"><b>${c.title}</b><br/><span class="muted">${c.detail}</span></button>`).join('')}</div>
  </div>`
}

function pauseHtml(view: View): string {
  const build = view.build
  return `<div class="panel stack">
    <div class="kicker">Paused</div>
    <h2>${build ? build.archetype : 'Ballborn'}</h2>
    ${build ? `<p>${build.components.map((c) => c.name).join(' · ')}</p><p class="muted">${build.weaknesses.join(' ')}</p>` : ''}
    <div class="row">
      <button class="btn primary" data-act="resume">Resume</button>
      <button class="btn" data-act="settings">Settings</button>
      <button class="btn" data-act="abandon">Abandon run</button>
    </div>
  </div>`
}

function deathHtml(view: View): string {
  const d = view.death
  return `<div class="panel stack">
    <div class="kicker">The ball breaks</div>
    <h2>Shell failed</h2>
    <p>${d?.tip ?? ''}</p>
    <p class="muted">+${d?.scrap ?? 0} scrap. ${d?.idea ?? ''}</p>
    <div class="row">
      <button class="btn primary" data-act="launch" data-arg="run">One more run</button>
      <button class="btn" data-act="lab">Ball lab</button>
      <button class="btn" data-act="title">Title</button>
    </div>
  </div>`
}

function victoryHtml(view: View): string {
  const v = view.victory
  return `<div class="panel stack">
    <div class="kicker">The Colossus is scrap</div>
    <h2>${v?.archetype ?? 'A ball'}</h2>
    <p>You built something that finished the foundry. +${v?.scrap ?? 0} scrap.</p>
    <p class="muted">${v?.idea ?? ''}</p>
    <div class="row">
      <button class="btn primary" data-act="launch" data-arg="run">Run again</button>
      <button class="btn" data-act="codex">Codex</button>
      <button class="btn" data-act="title">Title</button>
    </div>
  </div>`
}

function labHtml(view: View): string {
  const build = view.build
  if (!build) return ''
  const options = (slot: Slot) => {
    const list = COMPONENTS.filter((c) => c.slot === slot && (c.pool === 'standard' ? view.save.unlocked.includes(c.id) : view.save.discoveredComponents.includes(c.id) || view.save.unlocked.includes(c.id)))
    return [`<option value="">Empty</option>`].concat(list.map((c) => `<option value="${c.id}" ${build.ids[slot] === c.id ? 'selected' : ''}>${c.name}</option>`)).join('')
  }
  return `<div class="lab-list">
    <div class="kicker">Ball lab</div>
    <h2>${build.archetype}</h2>
    <p class="muted">Swap parts. The dummies come back. Nothing here is saved into a run.</p>
    ${SLOTS.map((slot) => `<label class="field">${slot}<select data-slot="${slot}">${options(slot)}</select></label>`).join('')}
    <p>${build.strengths.join(' ')}</p>
    <p class="down">${build.weaknesses.join(' ')}</p>
    <button class="btn" data-act="title">Leave lab</button>
  </div>`
}

export function selectedHeatLabel(id: number): string {
  return HEATS.find((h) => h.id === id)?.name ?? 'Forge Heat 0'
}

export { archetypeOf, currentBuild }
