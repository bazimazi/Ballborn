import { COMPONENT_MAP } from './data/components'
import { FUSIONS } from './data/meta'
import { availableComponents, currentBuild, RUN_MODS, type RunState } from './run'
import type { SaveData } from './save'
import { describeReport, evolve, equip, fuse, fusionConsumes, fusionFor, type EquipReport } from './transactions'
import { choice } from './util'

/** Everything an event choice can do. Copy and execution both read these. */
export type Outcome =
  | { kind: 'cinders'; amount: number }
  | { kind: 'heal-full' }
  | { kind: 'mod'; id: string }
  | { kind: 'curse-next' }
  | { kind: 'equip'; componentId: string }
  | { kind: 'evolve'; from: string; to: string }
  | { kind: 'fuse'; recipe: string }

export interface Cost {
  hp?: number
  embers?: number
  /** The Annealing's one free use per run. */
  freeAnneal?: boolean
}

export interface EventChoice {
  id: string
  title: string
  outcomes: Outcome[]
  cost?: Cost
  /** Why the choice cannot be taken right now. */
  disabled?: string
  detail: string
}

export interface GameEvent {
  id: string
  title: string
  body: string
  choices: EventChoice[]
}

function describeOutcome(run: RunState, o: Outcome): string {
  switch (o.kind) {
    case 'cinders':
      return `Gain ${o.amount} cinders.`
    case 'heal-full': {
      const max = currentBuild(run).stats.maxHp
      return `Restore integrity to full (${Math.round(max)}).`
    }
    case 'mod': {
      const mod = RUN_MODS[o.id]
      return mod ? `${mod.name}: ${mod.description}` : ''
    }
    case 'curse-next':
      return 'The next combat room gains two slag geysers.'
    case 'equip': {
      const comp = COMPONENT_MAP[o.componentId]!
      const old = run.ids[comp.slot] ? COMPONENT_MAP[run.ids[comp.slot]!] : null
      return `Fit ${comp.name} (${comp.slot}, ${comp.rarity})${old ? `, replacing ${old.name}` : ''}. ${comp.upside}`
    }
    case 'evolve': {
      const to = COMPONENT_MAP[o.to]!
      return `${COMPONENT_MAP[o.from]!.name} becomes ${to.name}. ${to.upside}`
    }
    case 'fuse': {
      const recipe = FUSIONS.find((f) => f.id === o.recipe)!
      const result = COMPONENT_MAP[recipe.result]!
      const consumed = fusionConsumes(run, recipe).map((slot) => `${COMPONENT_MAP[run.ids[slot]!]!.name} is consumed and the ${slot} slot is left empty`)
      return `${result.name} fills the ${recipe.into}. ${consumed.join('. ')}.`
    }
  }
}

function describeCost(cost: Cost | undefined): string {
  if (!cost) return ''
  if (cost.freeAnneal) return 'Free (the one free anneal this run).'
  const parts: string[] = []
  if (cost.embers) parts.push(`${cost.embers} ember`)
  if (cost.hp) parts.push(`${cost.hp} integrity`)
  return parts.length ? `Costs ${parts.join(' and ')}.` : ''
}

function makeChoice(run: RunState, id: string, title: string, outcomes: Outcome[], cost?: Cost, disabled?: string): EventChoice {
  const detail = [describeCost(cost), ...outcomes.map((o) => describeOutcome(run, o))].filter(Boolean).join(' ')
  return { id, title, outcomes, cost, disabled, detail }
}

/** Cost for an anneal right now: an ember if you have one, otherwise the free use. */
function annealCost(run: RunState, save: SaveData): { cost?: Cost; disabled?: string } {
  if (save.embers > 0) return { cost: { embers: 1 } }
  if (!run.annealFreeUsed) return { cost: { freeAnneal: true } }
  return { cost: { embers: 1 }, disabled: 'Needs an ember. The free anneal is spent.' }
}

/** Every event the run could offer now, with outcomes resolved in advance. */
export function eventCandidates(run: RunState, save: SaveData): GameEvent[] {
  const seen = new Set(run.eventsSeen)
  const options: GameEvent[] = []
  if (!seen.has('overcharge') && !run.mods.some((m) => m.id === 'overcharge')) {
    options.push({
      id: 'overcharge',
      title: 'Overcharge the Core',
      body: 'The heart of the ball can be driven past its temper. You will be faster for the rest of the run, and less able to settle.',
      choices: [
        makeChoice(run, 'accept', 'Overcharge', [{ kind: 'mod', id: 'overcharge' }]),
        makeChoice(run, 'decline', 'Leave it', [{ kind: 'cinders', amount: 18 }]),
      ],
    })
  }
  const rare = availableComponents(run, save).filter((c) => c.rarity === 'rare' || c.rarity === 'epic')
  if (!seen.has('blood-forge') && run.hp > 36 && rare.length) {
    const pick = choice(run.rng, rare)
    options.push({
      id: 'blood-forge',
      title: 'The Blood Forge',
      body: 'A smith offers a rare schematic in exchange for a cut of your shell.',
      choices: [
        makeChoice(run, 'pay', 'Give 24 integrity', [{ kind: 'equip', componentId: pick.id }], { hp: 24 }),
        makeChoice(run, 'decline', 'Refuse', [{ kind: 'cinders', amount: 10 }]),
      ],
    })
  }
  if (!seen.has('molten-bath')) {
    options.push({
      id: 'molten-bath',
      title: 'Molten Bath',
      body: 'The slag will close every crack. The next room remembers the favor and grows teeth.',
      choices: [
        makeChoice(run, 'bathe', 'Bathe', [{ kind: 'heal-full' }, { kind: 'curse-next' }]),
        makeChoice(run, 'decline', 'Stay cracked', [{ kind: 'cinders', amount: 12 }]),
      ],
    })
  }
  if (!seen.has('anneal') && (run.ids.shell === 'rubber-shell' || run.ids.impact === 'fire-impact')) {
    const { cost, disabled } = annealCost(run, save)
    const choices: EventChoice[] = []
    if (run.ids.shell === 'rubber-shell') {
      choices.push(makeChoice(run, 'rubber', 'Reinforce the rubber', [{ kind: 'evolve', from: 'rubber-shell', to: 'reinforced-rubber' }], cost, disabled))
    }
    if (run.ids.impact === 'fire-impact') {
      choices.push(makeChoice(run, 'inferno', 'Inferno branch', [{ kind: 'evolve', from: 'fire-impact', to: 'inferno-impact' }], cost, disabled))
      choices.push(makeChoice(run, 'combust', 'Combustion branch', [{ kind: 'evolve', from: 'fire-impact', to: 'combustion-impact' }], cost, disabled))
    }
    choices.push(makeChoice(run, 'decline', 'Walk away', [{ kind: 'cinders', amount: 12 }]))
    options.push({
      id: 'anneal',
      title: 'The Annealing',
      body: 'A quiet kiln. One component can be pushed into a specialized shape. It drinks an ember if you carry one. Once per run, it works for free.',
      choices,
    })
  }
  const fusion = fusionFor(run)
  if (fusion && !seen.has('crucible')) {
    const cost: Cost = save.embers > 0 ? { embers: 1 } : { hp: 24 }
    const disabled = !save.embers && run.hp <= 25 ? 'Your shell cannot pay 24 integrity.' : undefined
    options.push({
      id: 'crucible',
      title: 'The Crucible',
      body: `${fusion.description} This is the sort of choice a run is remembered for.`,
      choices: [
        makeChoice(run, 'fuse', `Fuse into ${fusion.name}`, [{ kind: 'fuse', recipe: fusion.id }], cost, disabled),
        makeChoice(run, 'decline', 'Not yet', [{ kind: 'cinders', amount: 15 }]),
      ],
    })
  }
  return options
}

/** Roll one event for the current node and mark it seen for this run. */
export function rollEvent(run: RunState, save: SaveData): GameEvent {
  const options = eventCandidates(run, save)
  const event = options.length
    ? choice(run.rng, options)
    : { id: 'quiet', title: 'A Quiet Bay', body: 'Nobody is working this bay. A few cinders sit in the tray.', choices: [makeChoice(run, 'decline', 'Take them', [{ kind: 'cinders', amount: 12 }])] }
  run.eventsSeen.push(event.id)
  return event
}

export type EventResult = { text: string; report?: EquipReport } | { error: string }

/** Pay and execute one choice of the event on screen. Exactly what the card said. */
export function applyEventChoice(run: RunState, save: SaveData, event: GameEvent, choiceId: string): EventResult {
  const pick = event.choices.find((c) => c.id === choiceId)
  if (!pick) return { error: 'That choice is not on offer.' }
  if (pick.disabled) return { error: pick.disabled }
  const cost = pick.cost
  if (cost?.embers && save.embers < cost.embers) return { error: 'Not enough embers.' }
  if (cost?.hp && run.hp <= cost.hp) return { error: 'Your shell cannot pay that.' }
  if (cost?.freeAnneal && run.annealFreeUsed) return { error: 'The free anneal is spent.' }
  if (cost?.embers) save.embers -= cost.embers
  if (cost?.hp) run.hp = Math.max(1, run.hp - cost.hp)
  if (cost?.freeAnneal) run.annealFreeUsed = true
  const texts: string[] = []
  let report: EquipReport | undefined
  for (const o of pick.outcomes) {
    switch (o.kind) {
      case 'cinders':
        run.cinders += o.amount
        texts.push(`+${o.amount} cinders.`)
        break
      case 'heal-full':
        run.hp = currentBuild(run).stats.maxHp
        texts.push('The cracks close.')
        break
      case 'mod': {
        const mod = RUN_MODS[o.id]
        if (mod && !run.mods.some((m) => m.id === mod.id)) {
          const before = currentBuild(run).stats.maxHp
          run.mods = [...run.mods, mod]
          const after = currentBuild(run).stats.maxHp
          run.hp = Math.max(1, Math.min(after, (run.hp / before) * after))
          run.decisions.push(mod.name)
          texts.push('The core screams and runs hot.')
        }
        break
      }
      case 'curse-next':
        run.curseNext = true
        texts.push('The next room will not be kind.')
        break
      case 'equip':
        report = equip(run, save, o.componentId, ['standard'])
        texts.push(describeReport(report))
        break
      case 'evolve':
        report = evolve(run, save, o.from, o.to)
        texts.push(describeReport(report))
        break
      case 'fuse': {
        const recipe = FUSIONS.find((f) => f.id === o.recipe)
        if (recipe) {
          report = fuse(run, save, recipe)
          texts.push(describeReport(report))
        }
        break
      }
    }
  }
  return { text: texts.join(' '), report }
}
