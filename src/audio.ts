import type { DamageSource, Material } from './types'

type Priority = 0 | 1 | 2
/** 2 = warnings (damage, telegraphs) always play; 1 = impacts; 0 = ambience and flourish. */
const P_WARN: Priority = 2
const P_HIT: Priority = 1
const P_LOW: Priority = 0

const VOICE_BUDGET = 24

export type MusicState = 'menu' | 'play' | 'boss' | 'paused'

/**
 * Synthesized Web Audio. Every sound is optional: if the browser refuses an
 * AudioContext the game keeps running silently. A voice budget drops low
 * priority sounds first, so warnings survive a busy chain reaction.
 */
export class AudioBus {
  ctx: AudioContext | null = null
  private master: GainNode | null = null
  private musicGain: GainNode | null = null
  private sfxGain: GainNode | null = null
  private rollGain: GainNode | null = null
  private rollFilter: BiquadFilterNode | null = null
  private noise: AudioBuffer | null = null
  private voices = 0
  private musicTimer = 0
  private step = 0
  private state: MusicState = 'menu'
  private lastDot = 0
  private danger = false
  available = true
  sfx = 0.75
  music = 0.35

  ensure(): void {
    if (this.ctx || !this.available) return
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctx) throw new Error('no audio')
      const ctx = new Ctx()
      this.ctx = ctx
      this.master = ctx.createGain()
      this.master.gain.value = 0.9
      this.master.connect(ctx.destination)
      this.musicGain = ctx.createGain()
      this.musicGain.gain.value = this.music
      this.musicGain.connect(this.master)
      this.sfxGain = ctx.createGain()
      this.sfxGain.gain.value = this.sfx
      this.sfxGain.connect(this.master)
      const len = ctx.sampleRate
      const buf = ctx.createBuffer(1, len, ctx.sampleRate)
      const data = buf.getChannelData(0)
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
      this.noise = buf
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.loop = true
      this.rollFilter = ctx.createBiquadFilter()
      this.rollFilter.type = 'bandpass'
      this.rollFilter.frequency.value = 280
      this.rollFilter.Q.value = 0.7
      this.rollGain = ctx.createGain()
      this.rollGain.gain.value = 0
      src.connect(this.rollFilter)
      this.rollFilter.connect(this.rollGain)
      this.rollGain.connect(this.sfxGain)
      src.start()
    } catch {
      this.available = false
      this.ctx = null
    }
  }

  /** Browsers only allow audio after a gesture; call from key and pointer handlers. */
  resume(): void {
    this.ensure()
    if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume().catch(() => undefined)
  }

  setVolumes(sfx: number, music: number): void {
    this.sfx = sfx
    this.music = music
    if (!this.ctx || !this.sfxGain || !this.musicGain) return
    const t = this.ctx.currentTime
    this.sfxGain.gain.setTargetAtTime(sfx, t, 0.03)
    this.musicGain.gain.setTargetAtTime(this.musicLevel(), t, 0.1)
  }

  private musicLevel(): number {
    return this.music * (this.state === 'paused' ? 0.25 : this.state === 'menu' ? 0.6 : 1)
  }

  setState(state: MusicState): void {
    if (this.state === state) return
    this.state = state
    if (!this.ctx || !this.musicGain || !this.rollGain) return
    const t = this.ctx.currentTime
    this.musicGain.gain.setTargetAtTime(this.musicLevel(), t, 0.15)
    if (state !== 'play' && state !== 'boss') this.rollGain.gain.setTargetAtTime(0, t, 0.05)
  }

  /** Rolling noise follows ground speed and the shell material; music follows the room state. */
  update(dt: number, rolling: number, mass: number, material: Material, danger: boolean): void {
    if (!this.ctx || !this.rollGain || !this.rollFilter) return
    const t = this.ctx.currentTime
    const live = this.state === 'play' || this.state === 'boss'
    const target = live ? Math.max(0, Math.min(0.18, rolling)) * (0.6 + mass * 0.25) : 0
    this.rollGain.gain.setTargetAtTime(target, t, 0.05)
    const freq = material === 'rubber' ? 200 : material === 'glass' ? 520 : material === 'heavy' ? 150 : 280
    this.rollFilter.frequency.setTargetAtTime(freq / Math.sqrt(Math.max(0.4, mass)), t, 0.1)
    this.danger = danger
    this.musicTimer -= dt
    if (this.musicTimer <= 0) {
      this.musicTimer = this.state === 'boss' ? 0.36 : this.state === 'menu' ? 0.62 : 0.48
      this.pulse()
      this.step = (this.step + 1) % 8
    }
  }

  private pulse(): void {
    if (!this.ctx || !this.musicGain || this.music <= 0.01 || this.state === 'paused') return
    const t = this.ctx.currentTime
    const dest = this.musicGain
    const notes = this.state === 'boss' ? [49, 49, 58.3, 49, 65.4, 49, 58.3, 73.4] : [55, 55, 65.4, 73.4, 55, 82.4, 65.4, 49]
    if (this.step % 2 === 0) this.tone(notes[this.step] ?? 55, t, 0.18, 'sine', 0.045, dest, P_LOW)
    if (this.state !== 'menu' && this.step % 2 === 1) this.noiseBurst(t, 0.03, 1800, 0.012, dest, P_LOW)
    if (this.step === 0 || this.step === 4) this.tone(80, t, 0.08, 'triangle', 0.05, dest, P_LOW)
    if (this.state === 'boss' && this.step % 4 === 2) this.tone(98, t, 0.12, 'sawtooth', 0.02, dest, P_LOW)
    if (this.danger && this.step % 4 === 0) {
      // Low integrity heartbeat, alongside the red vignette and CRACKED label.
      this.tone(52, t, 0.1, 'sine', 0.08, dest, P_WARN)
      this.tone(52, t + 0.16, 0.1, 'sine', 0.06, dest, P_WARN)
    }
  }

  impact(speed: number, mass: number, material: Material, kind: 'clean' | 'glance' | 'block'): void {
    if (!this.ctx || !this.sfxGain || this.sfx <= 0.01) return
    const t = this.ctx.currentTime
    const dest = this.sfxGain
    if (kind === 'block') {
      this.tone(420, t, 0.06, 'square', 0.08, dest, P_HIT)
      this.noiseBurst(t, 0.05, 3000, 0.06, dest, P_HIT)
      return
    }
    const vol = Math.max(0.04, Math.min(0.35, speed / 1400)) * (kind === 'glance' ? 0.55 : 1)
    const base = material === 'heavy' ? 70 : material === 'glass' ? 240 : material === 'rubber' ? 140 : material === 'electric' ? 320 : material === 'fire' ? 110 : 160
    const freq = base / Math.sqrt(Math.max(0.4, mass))
    this.tone(freq, t, 0.09 + mass * 0.03, material === 'glass' ? 'triangle' : 'sine', vol, dest, P_HIT)
    this.noiseBurst(t, 0.06 + Math.min(0.08, speed / 8000), material === 'electric' ? 2400 : 900, vol * 0.7, dest, P_HIT)
    if (kind === 'clean') this.tone(freq * 0.5, t, 0.16, 'sine', vol * 0.8, dest, P_HIT)
    if (material === 'fire') this.noiseBurst(t, 0.12, 600, vol * 0.4, dest, P_LOW)
    if (material === 'electric') this.tone(880, t, 0.05, 'square', vol * 0.25, dest, P_LOW)
  }

  bounce(speed: number, material: Material): void {
    if (!this.ctx || !this.sfxGain) return
    const vol = Math.max(0.03, Math.min(0.16, speed / 1800))
    const freq = material === 'rubber' ? 220 : material === 'glass' ? 520 : 180
    this.tone(freq, this.ctx.currentTime, 0.05, 'triangle', vol, this.sfxGain, P_LOW)
  }

  reflect(): void {
    if (!this.ctx || !this.sfxGain) return
    const t = this.ctx.currentTime
    this.tone(1320, t, 0.07, 'triangle', 0.08, this.sfxGain, P_HIT)
    this.tone(1760, t + 0.04, 0.06, 'triangle', 0.06, this.sfxGain, P_HIT)
  }

  ability(kind: string): void {
    if (!this.ctx || !this.sfxGain) return
    const t = this.ctx.currentTime
    const d = this.sfxGain
    if (kind === 'dash') this.noiseBurst(t, 0.12, 500, 0.12, d, P_HIT)
    else if (kind === 'slam') this.tone(60, t, 0.16, 'sine', 0.2, d, P_HIT)
    else if (kind === 'slam-land') this.noiseBurst(t, 0.2, 200, 0.2, d, P_HIT)
    else if (kind === 'burst') this.tone(300, t, 0.1, 'triangle', 0.12, d, P_HIT)
    else this.tone(180, t, 0.12, 'sawtooth', 0.06, d, P_HIT)
  }

  /** The ball just reached clean-ram speed: a short rising chirp. */
  armed(): void {
    if (!this.ctx || !this.sfxGain) return
    const t = this.ctx.currentTime
    this.tone(660, t, 0.05, 'triangle', 0.035, this.sfxGain, P_LOW)
    this.tone(990, t + 0.04, 0.07, 'triangle', 0.03, this.sfxGain, P_LOW)
  }

  /** A construct breaks. Each link of a combo rings a step higher. */
  kill(combo: number): void {
    if (!this.ctx || !this.sfxGain) return
    const t = this.ctx.currentTime
    this.noiseBurst(t, 0.14, 420, 0.14, this.sfxGain, P_HIT)
    this.tone(55, t, 0.18, 'sine', 0.16, this.sfxGain, P_HIT)
    const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31, 33]
    const step = scale[Math.min(scale.length - 1, Math.max(0, combo - 1))]!
    this.tone(392 * Math.pow(2, step / 12), t + 0.02, 0.14, 'triangle', 0.05, this.sfxGain, P_LOW)
  }

  /** The gate opened, or the ball went through it. */
  clear(): void {
    if (!this.ctx || !this.sfxGain) return
    const t = this.ctx.currentTime
    for (let i = 0; i < 3; i++) this.tone([392, 523, 659][i]!, t + i * 0.06, 0.22, 'triangle', 0.05, this.sfxGain, P_LOW)
  }

  /** The ball breaks apart. */
  shatter(): void {
    if (!this.ctx || !this.sfxGain) return
    const t = this.ctx.currentTime
    this.noiseBurst(t, 0.5, 1600, 0.2, this.sfxGain, P_WARN)
    this.noiseBurst(t, 0.35, 300, 0.2, this.sfxGain, P_WARN)
    this.tone(110, t, 0.5, 'sawtooth', 0.08, this.sfxGain, P_WARN)
    this.tone(55, t + 0.1, 0.7, 'sine', 0.14, this.sfxGain, P_WARN)
  }

  abilityReady(): void {
    if (!this.ctx || !this.sfxGain) return
    this.tone(990, this.ctx.currentTime, 0.05, 'sine', 0.03, this.sfxGain, P_LOW)
  }

  ui(kind: 'move' | 'ok' | 'bad' | 'buy' | 'discover' = 'move'): void {
    if (!this.ctx || !this.sfxGain) return
    const t = this.ctx.currentTime
    const d = this.sfxGain
    if (kind === 'buy') {
      this.tone(660, t, 0.05, 'square', 0.04, d, P_LOW)
      this.tone(990, t + 0.06, 0.08, 'square', 0.04, d, P_LOW)
      return
    }
    if (kind === 'discover') {
      for (let i = 0; i < 3; i++) this.tone([523, 659, 784][i]!, t + i * 0.07, 0.12, 'triangle', 0.06, d, P_HIT)
      return
    }
    const f = kind === 'ok' ? 520 : kind === 'bad' ? 140 : 340
    this.tone(f, t, 0.04, 'square', 0.04, d, P_LOW)
  }

  hurt(source: DamageSource): void {
    if (!this.ctx || !this.sfxGain) return
    const t = this.ctx.currentTime
    if (source === 'lava' || source === 'geyser') {
      if (t - this.lastDot < 0.22) return
      this.lastDot = t
      this.noiseBurst(t, 0.12, 700, 0.08, this.sfxGain, P_WARN)
      return
    }
    this.tone(90, t, 0.12, 'sawtooth', 0.09, this.sfxGain, P_WARN)
  }

  warn(): void {
    if (!this.ctx || !this.sfxGain) return
    const t = this.ctx.currentTime
    this.tone(220, t, 0.1, 'square', 0.06, this.sfxGain, P_WARN)
    this.tone(180, t + 0.14, 0.14, 'square', 0.06, this.sfxGain, P_WARN)
  }

  bossPhase(phase: number): void {
    if (!this.ctx || !this.sfxGain) return
    const t = this.ctx.currentTime
    this.tone(55, t, 0.6, 'sawtooth', 0.12, this.sfxGain, P_WARN)
    this.noiseBurst(t, 0.5, 300, 0.12, this.sfxGain, P_WARN)
    if (phase === 3) this.warn()
  }

  private claim(priority: Priority): boolean {
    if (this.voices >= VOICE_BUDGET && priority < P_WARN) return false
    if (this.voices >= VOICE_BUDGET * 0.75 && priority === P_LOW) return false
    this.voices++
    return true
  }

  private tone(freq: number, t: number, dur: number, type: OscillatorType, vol: number, dest: AudioNode, priority: Priority): void {
    if (!this.ctx || !this.claim(priority)) return
    const o = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    o.type = type
    o.frequency.value = freq
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(vol, t + 0.005)
    g.gain.exponentialRampToValueAtTime(0.001, t + dur)
    o.connect(g)
    g.connect(dest)
    o.onended = () => {
      this.voices--
      g.disconnect()
    }
    o.start(t)
    o.stop(t + dur + 0.02)
  }

  private noiseBurst(t: number, dur: number, freq: number, vol: number, dest: AudioNode, priority: Priority): void {
    if (!this.ctx || !this.noise || !this.claim(priority)) return
    const src = this.ctx.createBufferSource()
    src.buffer = this.noise
    const filter = this.ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = freq
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(vol, t + 0.004)
    g.gain.exponentialRampToValueAtTime(0.001, t + dur)
    src.connect(filter)
    filter.connect(g)
    g.connect(dest)
    src.onended = () => {
      this.voices--
      g.disconnect()
    }
    src.start(t, Math.random() * 0.5)
    src.stop(t + dur + 0.02)
  }

  get activeVoices(): number {
    return this.voices
  }
}
