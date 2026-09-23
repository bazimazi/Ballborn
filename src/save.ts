import { ACHIEVEMENTS } from './data/meta'
import { COMPONENTS } from './data/components'
import { COMPONENT_MAP } from './data/components'

export type Btn = 'left' | 'right' | 'up' | 'down' | 'ability' | 'pause' | 'build'

export interface Settings {
  screenShake: number
  reducedEffects: boolean
  highContrast: boolean
  colorblind: boolean
  sfx: number
  music: number
  gameSpeed: number
  bindings: Record<Btn, string>
}

export interface AchievementState {
  progress: number
  done: boolean
}

export interface SaveData {
  version: 1
  scrap: number
  embers: number
  unlocked: string[]
  discoveredComponents: string[]
  discoveredSynergies: string[]
  discoveredEnemies: string[]
  achievements: Record<string, AchievementState>
  heatUnlocked: number
  settings: Settings
  stats: { runs: number; wins: number; bestCombo: number; bestSpeed: number; bestHit: number }
  seenTutorial: boolean
}

const KEY = 'ballborn-save-v1'

export const DEFAULT_BINDINGS: Record<Btn, string> = {
  left: 'KeyA',
  right: 'KeyD',
  up: 'KeyW',
  down: 'KeyS',
  ability: 'ShiftLeft',
  pause: 'Escape',
  build: 'Tab',
}

export function defaultSave(): SaveData {
  const unlocked = COMPONENTS.filter((c) => c.startsUnlocked).map((c) => c.id)
  const achievements: SaveData['achievements'] = {}
  for (const a of ACHIEVEMENTS) achievements[a.id] = { progress: 0, done: false }
  return {
    version: 1,
    scrap: 0,
    embers: 0,
    unlocked,
    discoveredComponents: [...unlocked],
    discoveredSynergies: [],
    discoveredEnemies: [],
    achievements,
    heatUnlocked: 0,
    settings: {
      screenShake: 0.65,
      reducedEffects: false,
      highContrast: false,
      colorblind: false,
      sfx: 0.75,
      music: 0.35,
      gameSpeed: 1,
      bindings: { ...DEFAULT_BINDINGS },
    },
    stats: { runs: 0, wins: 0, bestCombo: 0, bestSpeed: 0, bestHit: 0 },
    seenTutorial: false,
  }
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return defaultSave()
    const parsed = JSON.parse(raw) as SaveData
    const base = defaultSave()
    const save: SaveData = {
      ...base,
      ...parsed,
      settings: { ...base.settings, ...parsed.settings, bindings: { ...base.settings.bindings, ...parsed.settings?.bindings } },
      stats: { ...base.stats, ...parsed.stats },
      achievements: { ...base.achievements, ...parsed.achievements },
      unlocked: Array.from(new Set([...(parsed.unlocked ?? []), ...base.unlocked.filter((id) => COMPONENT_MAP[id]?.startsUnlocked)])),
      discoveredComponents: Array.from(new Set([...(parsed.discoveredComponents ?? []), ...base.unlocked.filter((id) => COMPONENT_MAP[id]?.startsUnlocked)])),
    }
    return save
  } catch {
    return defaultSave()
  }
}

export function writeSave(save: SaveData): void {
  localStorage.setItem(KEY, JSON.stringify(save))
}

export interface Grant {
  text: string
}

/** Raise an achievement. Returns newly completed grants. */
export function bumpAchievement(save: SaveData, id: string, value: number, mode: 'max' | 'set' | 'add' = 'max'): Grant[] {
  const def = ACHIEVEMENTS.find((a) => a.id === id)
  const row = save.achievements[id]
  if (!def || !row || row.done) return []
  if (mode === 'max') row.progress = Math.max(row.progress, value)
  else if (mode === 'add') row.progress += value
  else row.progress = value
  if (row.progress < def.target) return []
  row.done = true
  row.progress = def.target
  const grants: Grant[] = [{ text: `Achievement: ${def.name}` }]
  if (def.scrap) {
    save.scrap += def.scrap
    grants.push({ text: `+${def.scrap} scrap` })
  }
  if (def.embers) {
    save.embers += def.embers
    grants.push({ text: `+${def.embers} ember` })
  }
  if (def.unlocks && !save.unlocked.includes(def.unlocks)) {
    save.unlocked.push(def.unlocks)
    save.discoveredComponents.push(def.unlocks)
    const comp = COMPONENT_MAP[def.unlocks]
    grants.push({ text: `Schematic forged: ${comp?.name ?? def.unlocks}` })
  }
  return grants
}
