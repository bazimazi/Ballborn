import type { Material } from './types'

export class AudioBus {
  ctx: AudioContext | null = null
  master!: GainNode
  musicGain!: GainNode
  sfxGain!: GainNode
  rollGain: GainNode | null = null
  private started = false
  private musicTimer = 0
  private step = 0
  sfx = 0.75
  music = 0.35
  private noise: AudioBuffer | null = null

  ensure(): void {
    if (this.ctx) return
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    this.ctx = new Ctx()
    this.master = this.ctx.createGain()
    this.master.gain.value = 0.9
    this.master.connect(this.ctx.destination)
    this.musicGain = this.ctx.createGain()
    this.musicGain.gain.value = this.music
    this.musicGain.connect(this.master)
    this.sfxGain = this.ctx.createGain()
    this.sfxGain.gain.value = this.sfx
    this.sfxGain.connect(this.master)
    const len = this.ctx.sampleRate * 1
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    this.noise = buf
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    src.loop = true
    const filter = this.ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = 280
    filter.Q.value = 0.7
    this.rollGain = this.ctx.createGain()
    this.rollGain.gain.value = 0
    src.connect(filter)
    filter.connect(this.rollGain)
    this.rollGain.connect(this.sfxGain)
    src.start()
    this.started = true
  }

  resume(): void {
    this.ensure()
    void this.ctx?.resume()
  }

  setVolumes(sfx: number, music: number): void {
    this.sfx = sfx
    this.music = music
    if (!this.ctx) return
    this.sfxGain.gain.value = sfx
    this.musicGain.gain.value = music
  }

  update(dt: number, rolling: number, mass: number): void {
    if (!this.started || !this.ctx || !this.rollGain) return
    const target = Math.max(0, Math.min(0.18, rolling)) * (0.6 + mass * 0.25)
    this.rollGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.05)
    this.musicTimer -= dt
    if (this.musicTimer <= 0) {
      this.musicTimer = 0.48
      this.pulse()
      this.step = (this.step + 1) % 8
    }
  }

  private pulse(): void {
    if (!this.ctx || this.music <= 0.01) return
    const t = this.ctx.currentTime
    const notes = [55, 55, 65.4, 73.4, 55, 82.4, 65.4, 49]
    if (this.step % 2 === 0) this.tone(notes[this.step] ?? 55, t, 0.18, 'sine', 0.045, this.musicGain)
    if (this.step % 2 === 1) this.noiseBurst(t, 0.03, 1800, 0.012, this.musicGain)
    if (this.step === 0 || this.step === 4) this.tone(80, t, 0.08, 'triangle', 0.05, this.musicGain)
  }

  impact(speed: number, mass: number, material: Material): void {
    if (!this.ctx || this.sfx <= 0.01) return
    const t = this.ctx.currentTime
    const vol = Math.max(0.04, Math.min(0.35, speed / 1400))
    const base = material === 'heavy' ? 70 : material === 'glass' ? 240 : material === 'rubber' ? 140 : material === 'electric' ? 320 : material === 'fire' ? 110 : 160
    const freq = base / Math.sqrt(Math.max(0.4, mass))
    this.tone(freq, t, 0.09 + mass * 0.03, material === 'glass' ? 'triangle' : 'sine', vol, this.sfxGain)
    this.noiseBurst(t, 0.06 + Math.min(0.08, speed / 8000), material === 'electric' ? 2400 : 900, vol * 0.7, this.sfxGain)
    if (material === 'fire') this.noiseBurst(t, 0.12, 600, vol * 0.4, this.sfxGain)
    if (material === 'electric') this.tone(880, t, 0.05, 'square', vol * 0.25, this.sfxGain)
  }

  bounce(speed: number, material: Material): void {
    if (!this.ctx) return
    const vol = Math.max(0.03, Math.min(0.16, speed / 1800))
    const freq = material === 'rubber' ? 220 : material === 'glass' ? 520 : 180
    this.tone(freq, this.ctx.currentTime, 0.05, 'triangle', vol, this.sfxGain)
  }

  ability(kind: string): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    if (kind === 'dash') this.noiseBurst(t, 0.12, 500, 0.12, this.sfxGain)
    else if (kind === 'slam') this.tone(60, t, 0.16, 'sine', 0.2, this.sfxGain)
    else if (kind === 'burst') this.tone(300, t, 0.1, 'triangle', 0.12, this.sfxGain)
    else this.tone(180, t, 0.12, 'sawtooth', 0.06, this.sfxGain)
  }

  ui(kind: 'move' | 'ok' | 'bad' = 'move'): void {
    if (!this.ctx) return
    const f = kind === 'ok' ? 520 : kind === 'bad' ? 140 : 340
    this.tone(f, this.ctx.currentTime, 0.04, 'square', 0.04, this.sfxGain)
  }

  hurt(): void {
    if (!this.ctx) return
    this.tone(90, this.ctx.currentTime, 0.12, 'sawtooth', 0.08, this.sfxGain)
  }

  private tone(freq: number, t: number, dur: number, type: OscillatorType, vol: number, dest: AudioNode): void {
    if (!this.ctx) return
    const o = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    o.type = type
    o.frequency.value = freq
    g.gain.setValueAtTime(vol, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + dur)
    o.connect(g)
    g.connect(dest)
    o.start(t)
    o.stop(t + dur + 0.02)
  }

  private noiseBurst(t: number, dur: number, freq: number, vol: number, dest: AudioNode): void {
    if (!this.ctx || !this.noise) return
    const src = this.ctx.createBufferSource()
    src.buffer = this.noise
    const filter = this.ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = freq
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(vol, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + dur)
    src.connect(filter)
    filter.connect(g)
    g.connect(dest)
    src.start(t)
    src.stop(t + dur + 0.02)
  }
}
