import type { RoomTemplate } from './types'

/**
 * Room grades and the run score. Speed is the weapon, so a fast, clean clear
 * pays: a grade, a few cinders, and score. Pure functions, so tests and the
 * summary can use them without a simulation.
 */

export type Grade = 'S' | 'A' | 'B' | 'C'

export interface RoomGrade {
  room: string
  grade: Grade
  /** Seconds from the room start to the gate opening (or to the exit for open rooms). */
  time: number
  par: number
  /** Integrity lost before the gate opened. */
  taken: number
  bonus: number
}

/** Target time for a room: its length, its constructs, and any timer it imposes. */
export function parTime(room: RoomTemplate): number {
  if (room.rules?.includes('survival')) return (room.survival ?? 20) + 4
  const spawns = room.spawns.reduce((n, s) => n + (s.elite ? 2.5 : 1), 0)
  const boss = room.type === 'boss' ? 70 : 0
  return Math.round(6 + room.width / 240 + spawns * 3.2 + boss)
}

/** Two points for pace, two for a clean shell. S needs both; C means neither. */
export function gradeRoom(time: number, par: number, taken: number, maxHp: number): Grade {
  const pace = time <= par ? 2 : time <= par * 1.5 ? 1 : 0
  const share = taken / Math.max(1, maxHp)
  const shell = taken <= 0.5 ? 2 : share <= 0.12 ? 1 : 0
  const pts = pace + shell
  return pts >= 4 ? 'S' : pts === 3 ? 'A' : pts === 2 ? 'B' : 'C'
}

export const GRADE_CINDERS: Record<Grade, number> = { S: 10, A: 6, B: 3, C: 0 }
const GRADE_SCORE: Record<Grade, number> = { S: 160, A: 100, B: 45, C: 10 }

export interface ScoreInput {
  roomsCleared: number
  elitesKilled: number
  kills: number
  bestCombo: number
  grades: RoomGrade[]
  won: boolean
  heat: number
  /** Damage-taken assist multiplier; below 1 the score says so rather than hiding it. */
  assist: number
}

export interface ScoreLine {
  label: string
  points: number
}

export function runScore(i: ScoreInput): { total: number; lines: ScoreLine[] } {
  const lines: ScoreLine[] = [
    { label: 'Rooms', points: i.roomsCleared * 100 },
    { label: 'Elites', points: i.elitesKilled * 150 },
    { label: 'Constructs', points: i.kills * 10 },
    { label: 'Best combo', points: i.bestCombo * 15 },
    { label: 'Grades', points: i.grades.reduce((n, g) => n + GRADE_SCORE[g.grade], 0) },
  ]
  if (i.won) lines.push({ label: 'Colossus', points: 1000 })
  let total = lines.reduce((n, l) => n + l.points, 0)
  const heatMul = 1 + i.heat * 0.25
  if (heatMul > 1) {
    lines.push({ label: `Heat ×${heatMul.toFixed(2)}`, points: Math.round(total * (heatMul - 1)) })
    total = Math.round(total * heatMul)
  }
  if (i.assist < 1) {
    const cut = Math.round(total * (1 - i.assist) * 0.5)
    lines.push({ label: 'Assist', points: -cut })
    total -= cut
  }
  return { total: Math.max(0, total), lines }
}

/** One glyph per room for the share card. */
export function gradeStrip(grades: RoomGrade[]): string {
  return grades.map((g) => g.grade).join('')
}

/** The day's seed: the same route for everyone on the same date (local time). */
export function dailyKey(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function dailySeed(key: string): number {
  // FNV-1a: stable across engines, which a shared daily route needs.
  let h = 0x811c9dc5
  const s = `ballborn-daily-${key}`
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}
