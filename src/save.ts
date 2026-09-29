import { ACHIEVEMENTS } from './data/meta'
import { COMPONENTS, COMPONENT_MAP } from './data/components'
import { ENEMY_MAP } from './data/enemies'
import { SYNERGY_MAP } from './data/synergies'

export type Btn = 'left' | 'right' | 'up' | 'down' | 'ability' | 'pause' | 'build'

export const BTNS: Btn[] = ['left', 'right', 'up', 'down', 'ability', 'pause', 'build']

export interface Settings {
  screenShake: number
  /** Camera look-ahead and speed zoom. */
  cameraMotion: boolean
  /** Full-screen flashes on big hits and phase changes. */
  flashes: boolean
  /** Share of cosmetic particles, 0 to 1. Never changes gameplay. */
  particles: number
  hitPause: boolean
  highContrast: boolean
  /** Stronger shape and pattern markers in the world, beyond colour. */
  colorblind: boolean
  hudScale: number
  sfx: number
  music: number
  gameSpeed: number
  /** Damage taken multiplier. An assist, shown on the run summary. */
  assistDamage: number
  bindings: Record<Btn, string>
  /** Size of the on-screen touch controls. */
  touchSize: number
  /** Stick on the right, buttons on the left. */
  leftHanded: boolean
  /** Short vibrations on hits, where the device supports them. */
  haptics: boolean
}

export interface AchievementState {
  progress: number
  done: boolean
}

export interface SaveData {
  version: 2
  scrap: number
  /** One ember pool, kept between runs. Earned from elites, treasure, shops, and achievements; spent at the Annealing and the Crucible. */
  embers: number
  unlocked: string[]
  discoveredComponents: string[]
  discoveredSynergies: string[]
  discoveredEnemies: string[]
  achievements: Record<string, AchievementState>
  heatUnlocked: number
  settings: Settings
  stats: { runs: number; wins: number; deaths: number; bestCombo: number; bestSpeed: number; bestHit: number }
  seenTutorial: boolean
}

export const SAVE_KEY = 'ballborn-save-v1'
export const BACKUP_KEY = 'ballborn-save-backup'
export const RUN_KEY = 'ballborn-run-v1'
export const SAVE_VERSION = 2

export const DEFAULT_BINDINGS: Readonly<Record<Btn, string>> = Object.freeze({
  left: 'KeyA',
  right: 'KeyD',
  up: 'KeyW',
  down: 'KeyS',
  ability: 'ShiftLeft',
  pause: 'Escape',
  build: 'Tab',
})

/** Always-on alternates. Rebinding changes the primary key; these stay. */
export const ALT_KEYS: Readonly<Record<Btn, readonly string[]>> = Object.freeze({
  left: ['ArrowLeft'],
  right: ['ArrowRight'],
  up: ['ArrowUp', 'Space'],
  down: ['ArrowDown'],
  ability: ['KeyF'],
  pause: [],
  build: [],
})

export function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

export function defaultSettings(reduced = prefersReducedMotion()): Settings {
  return {
    screenShake: reduced ? 0 : 0.65,
    cameraMotion: !reduced,
    flashes: !reduced,
    particles: reduced ? 0.35 : 1,
    hitPause: !reduced,
    highContrast: false,
    colorblind: false,
    hudScale: 1,
    sfx: 0.75,
    music: 0.35,
    gameSpeed: 1,
    assistDamage: 1,
    bindings: { ...DEFAULT_BINDINGS },
    touchSize: 1,
    leftHanded: false,
    haptics: true,
  }
}

export function defaultSave(): SaveData {
  const unlocked = COMPONENTS.filter((c) => c.startsUnlocked).map((c) => c.id)
  const achievements: SaveData['achievements'] = {}
  for (const a of ACHIEVEMENTS) achievements[a.id] = { progress: 0, done: false }
  return {
    version: 2,
    scrap: 0,
    embers: 0,
    unlocked,
    discoveredComponents: [...unlocked],
    discoveredSynergies: [],
    discoveredEnemies: [],
    achievements,
    heatUnlocked: 0,
    settings: defaultSettings(),
    stats: { runs: 0, wins: 0, deaths: 0, bestCombo: 0, bestSpeed: 0, bestHit: 0 },
    seenTutorial: false,
  }
}

// ---------------------------------------------------------------------------
// Storage. Browsers can refuse localStorage (privacy modes, quotas, sandboxed
// frames). Every access is guarded; the game keeps running from memory.

export interface Store {
  get(key: string): string | null
  set(key: string, value: string): boolean
  remove(key: string): void
}

export function browserStore(): Store {
  const ls = (): Storage | null => {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage
    } catch {
      return null
    }
  }
  return {
    get(key) {
      try {
        return ls()?.getItem(key) ?? null
      } catch {
        return null
      }
    },
    set(key, value) {
      try {
        const s = ls()
        if (!s) return false
        s.setItem(key, value)
        return true
      } catch {
        return false
      }
    },
    remove(key) {
      try {
        ls()?.removeItem(key)
      } catch {
        // Nothing to clean up when storage is unavailable.
      }
    },
  }
}

export function memoryStore(seed: Record<string, string> = {}): Store & { data: Record<string, string> } {
  const data = { ...seed }
  return {
    data,
    get: (k) => (k in data ? data[k]! : null),
    set: (k, v) => {
      data[k] = v
      return true
    },
    remove: (k) => {
      delete data[k]
    },
  }
}

// ---------------------------------------------------------------------------
// Validation and migration.

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v: unknown, lo: number, hi: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback)
const ids = (v: unknown, known: (id: string) => boolean): string[] =>
  Array.isArray(v) ? Array.from(new Set(v.filter((x): x is string => typeof x === 'string' && known(x)))) : []
const keyCode = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9]{1,32}$/.test(v)

export interface LoadResult {
  save: SaveData
  /** What happened, for a one-time notice. */
  status: 'fresh' | 'ok' | 'migrated' | 'recovered'
}

/**
 * Turn anything found in storage into a valid save. Unknown IDs are dropped,
 * numbers are clamped, and missing fields take defaults. Older versions are
 * migrated; data from a newer version is kept in the backup slot untouched.
 */
export function sanitizeSave(raw: unknown): { save: SaveData; migrated: boolean } {
  const base = defaultSave()
  if (!isObj(raw)) throw new Error('save is not an object')
  const version = num(raw.version, 0, 1e6, 1)
  if (version > SAVE_VERSION) throw new Error(`save version ${version} is newer than ${SAVE_VERSION}`)
  const s = isObj(raw.settings) ? raw.settings : {}
  const legacyReduced = bool(s.reducedEffects, false)
  const def = base.settings
  const bindings = { ...DEFAULT_BINDINGS } as Record<Btn, string>
  if (isObj(s.bindings)) for (const b of BTNS) if (keyCode(s.bindings[b])) bindings[b] = s.bindings[b] as string
  const settings: Settings = {
    screenShake: num(s.screenShake, 0, 1, legacyReduced ? 0 : def.screenShake),
    cameraMotion: bool(s.cameraMotion, legacyReduced ? false : def.cameraMotion),
    flashes: bool(s.flashes, legacyReduced ? false : def.flashes),
    particles: num(s.particles, 0, 1, legacyReduced ? 0.35 : def.particles),
    hitPause: bool(s.hitPause, legacyReduced ? false : def.hitPause),
    highContrast: bool(s.highContrast, false),
    colorblind: bool(s.colorblind, false),
    hudScale: num(s.hudScale, 0.8, 1.5, 1),
    sfx: num(s.sfx, 0, 1, def.sfx),
    music: num(s.music, 0, 1, def.music),
    gameSpeed: num(s.gameSpeed, 0.7, 1.15, 1),
    assistDamage: num(s.assistDamage, 0.4, 1, 1),
    bindings,
    touchSize: num(s.touchSize, 0.8, 1.3, 1),
    leftHanded: bool(s.leftHanded, false),
    haptics: bool(s.haptics, true),
  }
  const achievements: SaveData['achievements'] = {}
  const rawAch = isObj(raw.achievements) ? raw.achievements : {}
  for (const a of ACHIEVEMENTS) {
    const row = isObj(rawAch[a.id]) ? (rawAch[a.id] as Record<string, unknown>) : {}
    achievements[a.id] = { progress: num(row.progress, 0, 1e9, 0), done: bool(row.done, false) }
  }
  const st = isObj(raw.stats) ? raw.stats : {}
  const starters = base.unlocked
  const save: SaveData = {
    version: 2,
    scrap: Math.floor(num(raw.scrap, 0, 1e7, 0)),
    embers: Math.floor(num(raw.embers, 0, 999, 0)),
    unlocked: Array.from(new Set([...ids(raw.unlocked, (id) => COMPONENT_MAP[id]?.pool === 'standard'), ...starters])),
    discoveredComponents: Array.from(new Set([...ids(raw.discoveredComponents, (id) => !!COMPONENT_MAP[id]), ...starters])),
    discoveredSynergies: ids(raw.discoveredSynergies, (id) => !!SYNERGY_MAP[id]),
    discoveredEnemies: ids(raw.discoveredEnemies, (id) => !!ENEMY_MAP[id]),
    achievements,
    heatUnlocked: Math.floor(num(raw.heatUnlocked, 0, 3, 0)),
    settings,
    stats: {
      runs: Math.floor(num(st.runs, 0, 1e7, 0)),
      wins: Math.floor(num(st.wins, 0, 1e7, 0)),
      deaths: Math.floor(num(st.deaths, 0, 1e7, 0)),
      bestCombo: num(st.bestCombo, 0, 1e6, 0),
      bestSpeed: num(st.bestSpeed, 0, 1e6, 0),
      bestHit: num(st.bestHit, 0, 1e7, 0),
    },
    seenTutorial: bool(raw.seenTutorial, false),
  }
  // Achievement unlocks are part of progress: reapply them in case the list was edited.
  for (const a of ACHIEVEMENTS) {
    if (achievements[a.id]!.done && a.unlocks && COMPONENT_MAP[a.unlocks] && !save.unlocked.includes(a.unlocks)) save.unlocked.push(a.unlocks)
  }
  return { save, migrated: version < SAVE_VERSION }
}

export function loadSave(store: Store = browserStore()): LoadResult {
  const raw = store.get(SAVE_KEY)
  if (!raw) return { save: defaultSave(), status: 'fresh' }
  try {
    const { save, migrated } = sanitizeSave(JSON.parse(raw))
    if (migrated) {
      // Keep the pre-migration data once, in case the migration was wrong.
      store.set(BACKUP_KEY, raw)
      store.set(SAVE_KEY, JSON.stringify(save))
    }
    return { save, status: migrated ? 'migrated' : 'ok' }
  } catch {
    // Unreadable or from a newer build: never overwrite it silently.
    store.set(BACKUP_KEY, raw)
    return { save: defaultSave(), status: 'recovered' }
  }
}

export function writeSave(save: SaveData, store: Store = browserStore()): boolean {
  return store.set(SAVE_KEY, JSON.stringify(save))
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
    if (!save.discoveredComponents.includes(def.unlocks)) save.discoveredComponents.push(def.unlocks)
    const comp = COMPONENT_MAP[def.unlocks]
    grants.push({ text: `Schematic forged: ${comp?.name ?? def.unlocks}` })
  }
  return grants
}
