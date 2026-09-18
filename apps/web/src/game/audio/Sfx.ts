// Web Audio로 합성하는 효과음. 에셋 파일 없이 동작하며, 첫 사용자 제스처에서 unlock 해야 iOS에서 소리가 난다.
const MUTED_KEY = 'arena.muted';

class SfxEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private lastPlayed = new Map<string, number>();
  private mutedFlag = false;

  constructor() {
    try {
      this.mutedFlag = localStorage.getItem(MUTED_KEY) === '1';
    } catch {
      this.mutedFlag = false;
    }
  }

  get muted(): boolean {
    return this.mutedFlag;
  }

  setMuted(muted: boolean): void {
    this.mutedFlag = muted;
    try {
      localStorage.setItem(MUTED_KEY, muted ? '1' : '0');
    } catch {
      /* 저장 불가 환경은 무시 */
    }
    if (this.master) this.master.gain.value = muted ? 0 : 0.5;
  }

  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.mutedFlag ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      const seconds = 1;
      this.noiseBuffer = this.ctx.createBuffer(1, this.ctx.sampleRate * seconds, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private ready(key: string, minGapMs: number): boolean {
    if (!this.ctx || !this.master || this.mutedFlag) return false;
    const now = performance.now();
    const last = this.lastPlayed.get(key) ?? -Infinity;
    if (now - last < minGapMs) return false;
    this.lastPlayed.set(key, now);
    return true;
  }

  private tone(freq: number, freqEnd: number, duration: number, type: OscillatorType, gain: number, delay = 0): void {
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + duration);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  private noise(duration: number, gain: number, filterFrom: number, filterTo: number, delay = 0): void {
    if (!this.ctx || !this.master || !this.noiseBuffer) return;
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(filterFrom, t0);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, filterTo), t0 + duration);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + duration + 0.02);
  }

  shot(): void {
    if (!this.ready('shot', 40)) return;
    this.tone(880, 220, 0.07, 'square', 0.12);
    this.noise(0.05, 0.15, 4000, 800);
  }

  enemyShot(): void {
    if (!this.ready('enemyShot', 60)) return;
    this.tone(420, 160, 0.12, 'sawtooth', 0.08);
  }

  hit(): void {
    if (!this.ready('hit', 50)) return;
    this.noise(0.08, 0.25, 1500, 300);
    this.tone(300, 120, 0.06, 'triangle', 0.1);
  }

  hurt(): void {
    if (!this.ready('hurt', 80)) return;
    this.tone(220, 90, 0.18, 'sawtooth', 0.18);
    this.noise(0.12, 0.2, 900, 200);
  }

  explode(big: boolean): void {
    if (!this.ready(big ? 'explodeBig' : 'explode', 60)) return;
    this.noise(big ? 0.5 : 0.28, big ? 0.5 : 0.3, big ? 2400 : 1800, 80);
    this.tone(big ? 140 : 200, 40, big ? 0.45 : 0.25, 'sine', big ? 0.35 : 0.2);
  }

  dash(): void {
    if (!this.ready('dash', 100)) return;
    this.tone(300, 1200, 0.14, 'sine', 0.12);
    this.noise(0.1, 0.08, 3000, 6000);
  }

  pickup(): void {
    if (!this.ready('pickup', 100)) return;
    this.tone(660, 660, 0.08, 'sine', 0.15);
    this.tone(990, 990, 0.12, 'sine', 0.15, 0.08);
  }

  revive(): void {
    if (!this.ready('revive', 200)) return;
    this.tone(440, 440, 0.1, 'triangle', 0.15);
    this.tone(660, 660, 0.1, 'triangle', 0.15, 0.1);
    this.tone(880, 1320, 0.25, 'triangle', 0.15, 0.2);
  }

  wave(): void {
    if (!this.ready('wave', 300)) return;
    this.tone(330, 330, 0.12, 'square', 0.1);
    this.tone(440, 440, 0.12, 'square', 0.1, 0.12);
    this.tone(660, 660, 0.3, 'square', 0.12, 0.24);
  }

  coreHit(): void {
    if (!this.ready('coreHit', 120)) return;
    this.tone(110, 60, 0.3, 'sine', 0.3);
    this.noise(0.2, 0.2, 600, 100);
  }

  down(): void {
    if (!this.ready('down', 300)) return;
    this.tone(400, 60, 0.5, 'sawtooth', 0.2);
    this.noise(0.4, 0.3, 2000, 100);
  }

  ui(): void {
    if (!this.ready('ui', 40)) return;
    this.tone(1200, 900, 0.05, 'sine', 0.08);
  }
}

export const sfx = new SfxEngine();
