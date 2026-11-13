/**
 * The Foundry score: a small adaptive sequencer on the Web Audio clock.
 *
 * Notes are scheduled a little ahead of `currentTime` (the "two clocks"
 * pattern), so timing never depends on the frame rate. One loop plays all the
 * time; layers fade in and out with an intensity value the game sets from the
 * room (constructs alive, clean-ram speed, combo, boss phase), so the music
 * follows the fight without ever restarting.
 *
 * Everything is synthesized. The key is D minor; kill chimes and stingers in
 * audio.ts use the same scale so effects sit inside the music.
 */

export type ScoreState = 'menu' | 'play' | 'boss' | 'paused'

interface Chord {
  /** Semitones from D. The first entry is the bass root. */
  notes: number[]
  bars: number
}

interface Song {
  bpm: number
  chords: Chord[]
  /** 16-step bass pattern: semitone offset from the chord root (octave 2), or null for a rest. */
  bass: (number | null)[]
  /** Swing for odd 16ths, 0 to 0.3 of a step. */
  swing: number
}

const D2 = 73.416

const SONGS: Record<'menu' | 'play' | 'boss', Song> = {
  menu: {
    bpm: 78,
    chords: [
      { notes: [0, 7, 14, 15], bars: 2 }, // Dm(add9)
      { notes: [-4, 3, 7, 12], bars: 2 }, // Bbmaj7
      { notes: [-7, 5, 8, 12], bars: 2 }, // Gm
      { notes: [-5, 4, 7, 13], bars: 2 }, // A7(b9-ish), the pull home
    ],
    bass: [0, null, null, null, null, null, 7, null, 0, null, null, null, 12, null, null, null],
    swing: 0.12,
  },
  play: {
    bpm: 116,
    chords: [
      { notes: [0, 3, 7, 12], bars: 2 }, // Dm
      { notes: [-4, 0, 3, 8], bars: 2 }, // Bb
      { notes: [3, 7, 10, 15], bars: 2 }, // F
      { notes: [-2, 2, 5, 10], bars: 2 }, // C
    ],
    bass: [0, null, 0, 12, null, 0, null, 0, 0, null, 0, 12, null, 7, null, 10],
    swing: 0.08,
  },
  boss: {
    bpm: 128,
    chords: [
      { notes: [0, 3, 7, 12], bars: 1 }, // Dm
      { notes: [1, 5, 8, 13], bars: 1 }, // Eb: the Phrygian lurch
      { notes: [0, 3, 7, 12], bars: 1 },
      { notes: [-2, 2, 5, 10], bars: 1 }, // C
    ],
    bass: [0, 0, null, 0, 12, null, 0, 0, null, 0, 1, null, 0, 12, 0, 1],
    swing: 0,
  },
}

const hz = (semi: number, base = D2) => base * Math.pow(2, semi / 12)

/** D minor pentatonic steps, used by chimes so effects harmonize with the score. */
export const PENTA = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24, 27, 29, 31, 34]
export const KEY_D4 = 293.665

export class Score {
  private ctx: AudioContext
  private out: GainNode
  private noise: AudioBuffer
  private state: ScoreState = 'menu'
  private song: Song = SONGS.menu
  private pending: Song | null = null
  private nextTime = 0
  private step = 0
  private bar = 0
  private chordIndex = 0
  private chordBar = 0
  private intensity = 0.2
  private target = 0.2
  private danger = false
  private bossPhase = 1
  private padFilter: BiquadFilterNode
  private bassFilter: BiquadFilterNode
  private voices = 0

  constructor(ctx: AudioContext, out: GainNode, noise: AudioBuffer) {
    this.ctx = ctx
    this.out = out
    this.noise = noise
    this.padFilter = ctx.createBiquadFilter()
    this.padFilter.type = 'lowpass'
    this.padFilter.frequency.value = 900
    this.padFilter.Q.value = 0.4
    this.padFilter.connect(out)
    this.bassFilter = ctx.createBiquadFilter()
    this.bassFilter.type = 'lowpass'
    this.bassFilter.frequency.value = 420
    this.bassFilter.Q.value = 5
    this.bassFilter.connect(out)
  }

  setState(state: ScoreState): void {
    if (state === this.state) return
    this.state = state
    if (state === 'paused') return
    const next = SONGS[state]
    // Song changes land on the next bar, so a room start never stutters the beat.
    if (next !== this.song) this.pending = next
  }

  /** 0 (calm) to 1 (everything). Eased, so a single frame never jolts the mix. */
  setIntensity(v: number): void {
    this.target = Math.max(0, Math.min(1, v))
  }

  setDanger(on: boolean): void {
    this.danger = on
  }

  setBossPhase(phase: number): void {
    this.bossPhase = phase
  }

  update(dt: number): void {
    const ease = 1 - Math.exp(-dt * (this.target > this.intensity ? 3 : 1.2))
    this.intensity += (this.target - this.intensity) * ease
    const now = this.ctx.currentTime
    // After a hidden tab or a long hitch, rejoin the clock instead of machine-gunning the backlog.
    if (this.nextTime < now - 0.12) this.nextTime = now + 0.06
    // A 300 ms lookahead rides out main-thread stalls (a screen rebuild, a GC) on phones; intensity changes lag a little, which is fine.
    const horizon = now + 0.3
    let guard = 0
    while (this.nextTime < horizon && guard++ < 32) {
      this.schedule(this.nextTime)
      this.advance()
    }
    // Filter sweeps only need a few updates a second, not one per frame.
    this.filterAcc += dt
    if (this.filterAcc >= 0.05) {
      this.filterAcc = 0
      const cutoff = 260 + this.intensity * 1400 + (this.state === 'boss' ? 300 : 0)
      this.bassFilter.frequency.setTargetAtTime(cutoff, now, 0.15)
      this.padFilter.frequency.setTargetAtTime(this.state === 'paused' ? 500 : 700 + this.intensity * 900, now, 0.3)
    }
  }
  private filterAcc = 1

  private stepDur(): number {
    const phaseLift = this.song === SONGS.boss ? (this.bossPhase - 1) * 6 : 0
    return 60 / (this.song.bpm + phaseLift) / 4
  }

  private advance(): void {
    const dur = this.stepDur()
    const swing = this.step % 2 === 0 ? this.song.swing : -this.song.swing
    this.nextTime += dur * (1 + swing)
    this.step++
    // A new song starts on the next beat, not the next bar: at menu tempo a bar is three seconds.
    if (this.pending && this.step % 4 === 0) {
      this.song = this.pending
      this.pending = null
      this.step = 0
      this.chordIndex = 0
      this.chordBar = 0
      return
    }
    if (this.step < 16) return
    this.step = 0
    this.bar++
    this.chordBar++
    const chord = this.song.chords[this.chordIndex]!
    if (this.chordBar >= chord.bars) {
      this.chordBar = 0
      this.chordIndex = (this.chordIndex + 1) % this.song.chords.length
    }
  }

  private schedule(t: number): void {
    const s = this.step
    const chord = this.song.chords[this.chordIndex]!
    const root = chord.notes[0]!
    const I = this.state === 'paused' ? Math.min(0.15, this.intensity) : this.intensity
    const menu = this.song === SONGS.menu
    const boss = this.song === SONGS.boss

    // Pad: one long chord at each change, always present but quiet in fights.
    if (s === 0 && this.chordBar === 0) {
      const len = chord.bars * 16 * this.stepDur()
      const vol = menu ? 0.05 : 0.03 + (1 - I) * 0.02
      for (const n of chord.notes.slice(1)) this.pad(hz(n, D2 * 2), t, len, vol)
    }

    // Bass: the engine of the room. Enters as soon as anything is at stake.
    const b = this.song.bass[s]
    if (b !== null && b !== undefined && (menu ? true : I > 0.12)) {
      const accent = s % 4 === 0 ? 1 : 0.7
      const vol = (menu ? 0.06 : 0.05 + I * 0.07) * accent
      this.bassNote(hz(root + b), t, this.stepDur() * (menu ? 3.5 : 0.9), vol)
    }

    if (menu) {
      // A slow music-box line over the pad.
      if (s % 4 === 2) {
        const tones = chord.notes
        const n = tones[(this.bar * 2 + s / 2) % tones.length]!
        this.bell(hz(n, D2 * 4), t, 0.9, 0.02)
      }
      return
    }

    // Kick: half time when calm, four on the floor when the room is hot.
    const four = I > 0.55
    if (s === 0 || s === 8 || (four && (s === 4 || s === 12)) || (boss && s === 14 && I > 0.7)) {
      this.kick(t, 0.16 + I * 0.1)
      if (this.danger && (s === 0 || s === 8)) this.kick(t + this.stepDur() * 1.6, 0.12)
    }

    // The anvil: the Foundry's backbeat.
    if ((s === 4 || s === 12) && I > 0.25) this.anvil(t, 0.04 + I * 0.05, boss)

    // Hats: eighths, then sixteenths.
    if (I > 0.3 && s % 2 === 0) this.hat(t, s % 4 === 2 ? 0.028 : 0.016)
    else if (I > 0.62 && s % 2 === 1) this.hat(t, 0.01)

    // Arpeggio: the reward for staying fast and chaining.
    if (I > 0.66) {
      const tones = chord.notes
      const up = Math.floor(s / 4) % 2 === 0
      const idx = up ? s % tones.length : tones.length - 1 - (s % tones.length)
      const n = tones[idx]! + (s >= 8 ? 12 : 0)
      this.lead(hz(n, D2 * 4), t, this.stepDur() * 0.8, 0.012 + (I - 0.66) * 0.05)
    }

    // Boss drone: a ship's horn on each bar from phase two.
    if (boss && s === 0 && this.bossPhase >= 2) this.horn(hz(root, D2), t, this.stepDur() * 12, 0.05)
  }

  private claim(): boolean {
    if (this.voices > 28) return false
    this.voices++
    return true
  }

  private release(node: AudioScheduledSourceNode, g: GainNode): void {
    node.onended = () => {
      this.voices--
      g.disconnect()
    }
  }

  private pad(freq: number, t: number, len: number, vol: number): void {
    for (const detune of [-7, 7]) {
      if (!this.claim()) return
      const o = this.ctx.createOscillator()
      const g = this.ctx.createGain()
      o.type = 'sawtooth'
      o.frequency.value = freq
      o.detune.value = detune
      g.gain.setValueAtTime(0.0001, t)
      g.gain.linearRampToValueAtTime(vol, t + Math.min(0.6, len * 0.3))
      g.gain.setValueAtTime(vol, t + len * 0.75)
      g.gain.exponentialRampToValueAtTime(0.0005, t + len + 0.4)
      o.connect(g)
      g.connect(this.padFilter)
      this.release(o, g)
      o.start(t)
      o.stop(t + len + 0.45)
    }
  }

  private bassNote(freq: number, t: number, dur: number, vol: number): void {
    if (!this.claim()) return
    const o = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    o.type = 'sawtooth'
    o.frequency.value = freq
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(vol, t + 0.008)
    g.gain.exponentialRampToValueAtTime(vol * 0.4, t + dur * 0.5)
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur)
    o.connect(g)
    g.connect(this.bassFilter)
    this.release(o, g)
    o.start(t)
    o.stop(t + dur + 0.02)
  }

  private kick(t: number, vol: number): void {
    if (!this.claim()) return
    const o = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    o.type = 'sine'
    o.frequency.setValueAtTime(130, t)
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12)
    g.gain.setValueAtTime(vol, t)
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.26)
    o.connect(g)
    g.connect(this.out)
    this.release(o, g)
    o.start(t)
    o.stop(t + 0.28)
  }

  /** Two inharmonic partials and a scrape of noise: a hammer on an anvil. */
  private anvil(t: number, vol: number, boss: boolean): void {
    const base = boss ? 440 : 523
    for (const [ratio, v] of [[1, 1], [2.76, 0.5], [5.4, 0.25]] as const) {
      if (!this.claim()) return
      const o = this.ctx.createOscillator()
      const g = this.ctx.createGain()
      o.type = 'triangle'
      o.frequency.value = base * ratio
      g.gain.setValueAtTime(vol * v, t)
      g.gain.exponentialRampToValueAtTime(0.0005, t + 0.22 / ratio + 0.05)
      o.connect(g)
      g.connect(this.out)
      this.release(o, g)
      o.start(t)
      o.stop(t + 0.3)
    }
    this.noiseHit(t, 0.05, 3200, 'bandpass', vol * 0.8)
  }

  private hat(t: number, vol: number): void {
    this.noiseHit(t, 0.035, 8000, 'highpass', vol)
  }

  private noiseHit(t: number, dur: number, freq: number, type: BiquadFilterType, vol: number): void {
    if (!this.claim()) return
    const src = this.ctx.createBufferSource()
    src.buffer = this.noise
    const f = this.ctx.createBiquadFilter()
    f.type = type
    f.frequency.value = freq
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(vol, t)
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur)
    src.connect(f)
    f.connect(g)
    g.connect(this.out)
    this.release(src, g)
    src.start(t, (this.step * 0.031) % 0.8)
    src.stop(t + dur + 0.02)
  }

  private lead(freq: number, t: number, dur: number, vol: number): void {
    if (!this.claim()) return
    const o = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    o.type = 'square'
    o.frequency.value = freq
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(vol, t + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur)
    o.connect(g)
    g.connect(this.padFilter)
    this.release(o, g)
    o.start(t)
    o.stop(t + dur + 0.02)
  }

  private bell(freq: number, t: number, dur: number, vol: number): void {
    for (const [ratio, v] of [[1, 1], [3.01, 0.25]] as const) {
      if (!this.claim()) return
      const o = this.ctx.createOscillator()
      const g = this.ctx.createGain()
      o.type = 'sine'
      o.frequency.value = freq * ratio
      g.gain.setValueAtTime(0.0001, t)
      g.gain.linearRampToValueAtTime(vol * v, t + 0.01)
      g.gain.exponentialRampToValueAtTime(0.0005, t + dur / ratio)
      o.connect(g)
      g.connect(this.out)
      this.release(o, g)
      o.start(t)
      o.stop(t + dur + 0.02)
    }
  }

  private horn(freq: number, t: number, dur: number, vol: number): void {
    if (!this.claim()) return
    const o = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    o.type = 'sawtooth'
    o.frequency.setValueAtTime(freq * 0.97, t)
    o.frequency.linearRampToValueAtTime(freq, t + 0.3)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(vol, t + 0.25)
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur)
    o.connect(g)
    g.connect(this.bassFilter)
    this.release(o, g)
    o.start(t)
    o.stop(t + dur + 0.02)
  }

  get activeVoices(): number {
    return this.voices
  }
}
