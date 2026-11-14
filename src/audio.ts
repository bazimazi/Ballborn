import { KEY_D4, PENTA, Score } from './music'
import type { DamageSource, Material } from './types'

type Priority = 0 | 1 | 2
/** 2 = warnings (damage, telegraphs) always play; 1 = impacts; 0 = ambience and flourish. */
const P_WARN: Priority = 2
const P_HIT: Priority = 1
const P_LOW: Priority = 0

/** Phones crackle long before desktops do: a smaller budget for coarse-pointer devices. */
const COARSE = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
const VOICE_BUDGET = COARSE ? 16 : 24

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
  private state: MusicState = 'menu'
  private lastDot = 0
  private score: Score | null = null
  private duckGain: GainNode | null = null
  private reverb: GainNode | null = null
  /** Last values sent to the per-frame params, so a steady value is not re-scheduled every frame. */
  private lastRoll = -1
  private lastRollFreq = -1
  private suspended = false
  available = true
  sfx = 0.75
  music = 0.35

  ensure(): void {
    if (this.ctx || !this.available) return
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctx) throw new Error('no audio')
      // On iPhone, Web Audio follows the ring/silent switch unless the session says this is playback.
      const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession
      if (session) {
        try {
          session.type = 'playback'
        } catch {
          // Older Safari: the switch wins.
        }
      }
      const ctx = new Ctx({ latencyHint: 'interactive' })
      this.ctx = ctx
      // A gentle bus compressor keeps a chain reaction from clipping.
      const comp = ctx.createDynamicsCompressor()
      comp.threshold.value = -14
      comp.knee.value = 10
      comp.ratio.value = 4
      comp.attack.value = 0.004
      comp.release.value = 0.18
      comp.connect(ctx.destination)
      this.master = ctx.createGain()
      this.master.gain.value = 0.9
      this.master.connect(comp)
      // A generated hall: the Foundry is a big iron room.
      const verb = ctx.createConvolver()
      verb.buffer = hallImpulse(ctx, COARSE ? 1.2 : 1.9)
      const verbOut = ctx.createGain()
      verbOut.gain.value = 0.32
      verb.connect(verbOut)
      verbOut.connect(this.master)
      this.reverb = ctx.createGain()
      this.reverb.gain.value = 1
      this.reverb.connect(verb)
      this.duckGain = ctx.createGain()
      this.duckGain.gain.value = 1
      this.duckGain.connect(this.master)
      this.musicGain = ctx.createGain()
      this.musicGain.gain.value = this.music
      this.musicGain.connect(this.duckGain)
      const musicSend = ctx.createGain()
      musicSend.gain.value = 0.5
      this.musicGain.connect(musicSend)
      musicSend.connect(this.reverb)
      this.sfxGain = ctx.createGain()
      this.sfxGain.gain.value = this.sfx
      this.sfxGain.connect(this.master)
      const sfxSend = ctx.createGain()
      sfxSend.gain.value = 0.22
      this.sfxGain.connect(sfxSend)
      sfxSend.connect(this.reverb)
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
      this.score = new Score(ctx, this.musicGain, buf)
      this.score.setState(this.state)
    } catch {
      this.available = false
      this.ctx = null
    }
  }

  /** Browsers only allow audio after a gesture; call from key and pointer handlers. */
  resume(): void {
    if (typeof document !== 'undefined' && document.hidden) return
    this.ensure()
    this.suspended = false
    if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume().catch(() => undefined)
  }

  /** The tab is hidden: stop the whole graph (rolling noise, reverb, scheduled music) until it returns. */
  suspend(): void {
    if (!this.ctx || this.suspended) return
    this.suspended = true
    this.rollGain?.gain.setValueAtTime(0, this.ctx.currentTime)
    this.lastRoll = 0
    void this.ctx.suspend().catch(() => undefined)
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
    this.score?.setState(state)
    if (!this.ctx || !this.musicGain || !this.rollGain) return
    const t = this.ctx.currentTime
    this.musicGain.gain.setTargetAtTime(this.musicLevel(), t, 0.15)
    if (state !== 'play' && state !== 'boss') this.rollGain.gain.setTargetAtTime(0, t, 0.05)
  }

  /** Rolling noise follows ground speed and the shell material; the score follows the room. */
  update(dt: number, rolling: number, mass: number, material: Material, danger: boolean): void {
    if (!this.ctx || !this.rollGain || !this.rollFilter) return
    const t = this.ctx.currentTime
    const live = this.state === 'play' || this.state === 'boss'
    const target = live ? Math.max(0, Math.min(0.18, rolling)) * (0.6 + mass * 0.25) : 0
    // Automation events pile up when sent every frame (hundreds a second at 144 Hz); only send real changes.
    if (Math.abs(target - this.lastRoll) > 0.004 || (target === 0 && this.lastRoll !== 0)) {
      this.rollGain.gain.setTargetAtTime(target, t, 0.05)
      this.lastRoll = target
    }
    const base = material === 'rubber' ? 200 : material === 'glass' ? 520 : material === 'heavy' ? 150 : 280
    const freq = base / Math.sqrt(Math.max(0.4, mass))
    if (Math.abs(freq - this.lastRollFreq) > 1) {
      this.rollFilter.frequency.setTargetAtTime(freq, t, 0.1)
      this.lastRollFreq = freq
    }
    if (!this.score) return
    this.score.setDanger(danger)
    if (this.music > 0.01) this.score.update(dt)
  }

  /** How hot the room is, 0 to 1. Layers of the score enter and leave with it. */
  setIntensity(v: number, bossPhase = 1): void {
    this.score?.setIntensity(v)
    this.score?.setBossPhase(bossPhase)
  }

  /** Pull the music down for a moment so a big hit owns the mix. */
  duck(amount = 0.45, holdFor = 0.12): void {
    if (!this.ctx || !this.duckGain) return
    const t = this.ctx.currentTime
    const g = this.duckGain.gain
    // Hold the live value where the engine can (reading .value mid-ramp is stale on some engines and clicks).
    const hold = g as AudioParam & { cancelAndHoldAtTime?: (t: number) => void }
    if (typeof hold.cancelAndHoldAtTime === 'function') hold.cancelAndHoldAtTime(t)
    else {
      g.cancelScheduledValues(t)
      g.setValueAtTime(g.value, t)
    }
    g.linearRampToValueAtTime(1 - amount, t + 0.02)
    g.setTargetAtTime(1, t + 0.02 + holdFor, 0.18)
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
    // A little pitch drift per hit: twenty identical rams should not sound identical.
    const freq = (base / Math.sqrt(Math.max(0.4, mass))) * (0.94 + Math.random() * 0.12)
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

  /** The ball tore through a wreck and kept going: an airy rip with a low thump under it. */
  plow(speed: number): void {
    if (!this.ctx || !this.sfxGain) return
    const t = this.ctx.currentTime
    const k = Math.min(1, speed / 1200)
    this.noiseBurst(t, 0.18, 900 + 900 * k, 0.1 + 0.06 * k, this.sfxGain, P_HIT)
    this.tone(90, t, 0.12, 'sine', 0.12, this.sfxGain, P_HIT)
  }

  /** A kick off a wall: a tight knock and a short rising lift. */
  wallKick(): void {
    if (!this.ctx || !this.sfxGain) return
    const t = this.ctx.currentTime
    this.noiseBurst(t, 0.05, 1400, 0.08, this.sfxGain, P_HIT)
    this.tone(330, t, 0.06, 'triangle', 0.06, this.sfxGain, P_LOW)
    this.tone(495, t + 0.04, 0.08, 'triangle', 0.05, this.sfxGain, P_LOW)
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
    // Each link of a combo climbs the score's own scale.
    const step = PENTA[Math.min(PENTA.length - 1, Math.max(0, combo - 1))]!
    this.tone(KEY_D4 * Math.pow(2, step / 12), t + 0.02, 0.16, 'triangle', 0.055, this.sfxGain, P_LOW)
    if (combo >= 6) this.tone(KEY_D4 * 2 * Math.pow(2, step / 12), t + 0.05, 0.12, 'sine', 0.025, this.sfxGain, P_LOW)
  }

  /** The gate opened, or the ball went through it. */
  clear(): void {
    if (!this.ctx || !this.sfxGain) return
    const t = this.ctx.currentTime
    // D major over a D minor score: the gate opening is the one bright chord.
    const notes = [293.66, 369.99, 440, 587.33]
    for (let i = 0; i < notes.length; i++) this.tone(notes[i]!, t + i * 0.055, 0.42 - i * 0.05, 'triangle', 0.055, this.sfxGain, P_LOW)
    this.tone(146.83, t, 0.5, 'sine', 0.06, this.sfxGain, P_LOW)
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

  /** White Hot ignites: a rising whoosh and a bright fifth; when the chain breaks, a short falling hiss. */
  overdrive(on: boolean): void {
    if (!this.ctx || !this.sfxGain) return
    const t = this.ctx.currentTime
    if (on) {
      this.noiseBurst(t, 0.28, 2200, 0.1, this.sfxGain, P_WARN)
      this.tone(293.66, t, 0.18, 'sawtooth', 0.05, this.sfxGain, P_WARN)
      this.tone(440, t + 0.06, 0.2, 'triangle', 0.07, this.sfxGain, P_WARN)
      this.tone(587.33, t + 0.12, 0.32, 'triangle', 0.07, this.sfxGain, P_WARN)
    } else {
      this.noiseBurst(t, 0.18, 700, 0.05, this.sfxGain, P_LOW)
      this.tone(220, t, 0.16, 'triangle', 0.03, this.sfxGain, P_LOW)
    }
  }

  /** A shield's guard drops: a hard metallic clang with a ring on top. */
  guardBreak(): void {
    if (!this.ctx || !this.sfxGain) return
    const t = this.ctx.currentTime
    this.noiseBurst(t, 0.08, 4200, 0.1, this.sfxGain, P_HIT)
    this.tone(880, t, 0.22, 'square', 0.035, this.sfxGain, P_HIT)
    this.tone(1318.5, t + 0.02, 0.3, 'triangle', 0.04, this.sfxGain, P_HIT)
  }

  /** The Colossus sends a shockwave along the floor: a low thud and a grinding rumble. */
  shock(): void {
    if (!this.ctx || !this.sfxGain) return
    const t = this.ctx.currentTime
    this.tone(48, t, 0.4, 'sine', 0.16, this.sfxGain, P_WARN)
    this.noiseBurst(t, 0.45, 260, 0.12, this.sfxGain, P_WARN)
  }

  bossPhase(phase: number): void {
    if (!this.ctx || !this.sfxGain) return
    const t = this.ctx.currentTime
    this.tone(55, t, 0.6, 'sawtooth', 0.12, this.sfxGain, P_WARN)
    this.noiseBurst(t, 0.5, 300, 0.12, this.sfxGain, P_WARN)
    if (phase === 3) this.warn()
  }

  private claim(priority: Priority): boolean {
    // Muted effects build no nodes at all.
    if (this.sfx <= 0.01 || this.suspended) return false
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
    return this.voices + (this.score?.activeVoices ?? 0)
  }
}

/** Decaying stereo noise with a darkened tail: a cheap, convincing hall. */
function hallImpulse(ctx: AudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(2, len, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    let lp = 0
    for (let i = 0; i < len; i++) {
      const k = i / len
      lp += (Math.random() * 2 - 1 - lp) * (0.5 - k * 0.42)
      d[i] = lp * Math.pow(1 - k, 2.6) * (i < 90 ? i / 90 : 1)
    }
  }
  return buf
}
