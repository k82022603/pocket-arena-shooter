// Web Audio로 합성하는 효과음. 에셋 파일 없이 동작하며, 첫 사용자 제스처에서 unlock 해야 iOS에서 소리가 난다.
const MUTED_KEY = 'arena.muted';

// 소리는 두 가지 재료로 만든다: 주파수가 미끄러지는 음(tone)과 걸러낸 잡음(noise).
class SfxEngine {
  private ctx: AudioContext | null = null; // 첫 터치 전에는 만들 수 없다 (브라우저 자동 재생 정책)
  private master: GainNode | null = null; // 전체 음량 (음소거는 이것을 0으로)
  private noiseBuffer: AudioBuffer | null = null; // 1초짜리 흰 잡음. 폭발·발사음의 재료
  private lastPlayed = new Map<string, number>(); // 소리 종류별 마지막 재생 시각 (연사 때 겹침 방지)
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

  // 첫 사용자 제스처(터치·클릭·키)에서 불러야 한다. 그 전에 만든 오디오는 iOS에서 소리가 나지 않는다
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext; // 옛 Safari는 접두사 이름
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.mutedFlag ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      const seconds = 1;
      this.noiseBuffer = this.ctx.createBuffer(1, this.ctx.sampleRate * seconds, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1; // -1..1 무작위 = 흰 잡음
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume(); // 탭을 오간 뒤 멈춰 있으면 깨운다
  }

  // 재생해도 되는가: 오디오가 준비됐고, 음소거가 아니고, 같은 소리를 너무 자주 내지 않았다
  private ready(key: string, minGapMs: number): boolean {
    if (!this.ctx || !this.master || this.mutedFlag) return false;
    const now = performance.now();
    const last = this.lastPlayed.get(key) ?? -Infinity;
    if (now - last < minGapMs) return false;
    this.lastPlayed.set(key, now);
    return true;
  }

  // freq에서 freqEnd로 미끄러지며 사라지는 음. type은 파형(square 거칠게, sine 부드럽게, sawtooth 날카롭게)
  private tone(freq: number, freqEnd: number, duration: number, type: OscillatorType, gain: number, delay = 0): void {
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + duration); // 지수 곡선은 0을 못 가므로 최소 20Hz
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + duration); // 소리가 자연스럽게 잦아든다
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02); // 멈춘 노드는 브라우저가 알아서 치운다
  }

  // 잡음을 저역 통과 필터로 걸러 낸다. 필터가 닫혀 갈수록 '쉬익'에서 '쿵'으로 변한다
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

  // 아래는 게임이 부르는 소리들. 괄호 안 숫자는 같은 소리 사이 최소 간격(ms)
  shot(): void {
    if (!this.ready('shot', 40)) return;
    this.tone(880, 220, 0.07, 'square', 0.12);
    this.noise(0.05, 0.15, 4000, 800);
  }

  shotgun(): void {
    if (!this.ready('shotgun', 80)) return;
    this.noise(0.18, 0.45, 2500, 300);
    this.tone(180, 60, 0.16, 'square', 0.18);
  }

  snipe(): void {
    if (!this.ready('snipe', 120)) return;
    this.noise(0.12, 0.4, 5000, 400);
    this.tone(600, 90, 0.22, 'square', 0.16);
  }

  laser(): void {
    if (!this.ready('laser', 60)) return;
    this.tone(1400, 400, 0.16, 'sawtooth', 0.12);
    this.tone(2200, 900, 0.1, 'sine', 0.08);
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
    if (!this.ready('pickup', 100)) return; // 두 음을 이어 '띠링'
    this.tone(660, 660, 0.08, 'sine', 0.15);
    this.tone(990, 990, 0.12, 'sine', 0.15, 0.08);
  }

  revive(): void {
    if (!this.ready('revive', 200)) return; // 올라가는 세 음
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

export const sfx = new SfxEngine(); // 앱 전체가 하나를 같이 쓴다
