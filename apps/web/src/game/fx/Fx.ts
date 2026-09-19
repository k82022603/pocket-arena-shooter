import type Phaser from 'phaser';

// 파티클: 폭발·피격 파편. 퍼져 나가며 느려지고 사라진다
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: number;
  drag: number; // 16ms마다 속도에 곱하는 감속 (1이면 감속 없음)
}

// 링: 퍼져 나가며 얇아지는 원 (등장·처치·피격 표시)
interface Ring {
  x: number;
  y: number;
  maxR: number;
  life: number;
  maxLife: number;
  color: number;
  width: number;
}

// 잔상: 대시·부스트 중 몸 뒤에 남는 흐린 원
interface Ghost {
  x: number;
  y: number;
  r: number;
  life: number;
  maxLife: number;
  color: number;
}

// 총구 화염: 쏜 방향으로 짧게 번쩍이는 삼각형
interface Muzzle {
  x: number;
  y: number;
  angle: number;
  life: number;
  maxLife: number;
  color: number;
}

// 시각 효과 전용 파티클 시스템. 시뮬레이션과 무관하므로 비결정적 난수를 써도 된다.
export class Fx {
  // 저사양 기기에서 파티클 수를 줄이는 배율 (0.3~1)
  quality = 1;

  private particles: Particle[] = [];
  private rings: Ring[] = [];
  private ghosts: Ghost[] = [];
  private muzzles: Muzzle[] = [];
  private shakeLeft = 0; // 남은 흔들림 시간 (ms)
  private shakeTotal = 0; // 이번 흔들림의 전체 길이
  private shakeAmp = 0; // 흔들림 세기 (px)

  // 한 점에서 사방으로 파편을 뿌린다. 속도와 수명에 무작위 폭을 줘 자연스럽게 흩어진다
  burst(x: number, y: number, color: number, count: number, speed: number, life: number, size: number, drag = 0.92): void {
    const n = Math.max(1, Math.round(count * this.quality)); // 저사양이면 줄인다
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      const l = life * (0.6 + Math.random() * 0.6);
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: l, maxLife: l, size, color, drag });
    }
  }

  ring(x: number, y: number, color: number, maxR: number, life: number, width = 3): void {
    this.rings.push({ x, y, maxR, life, maxLife: life, color, width });
  }

  ghost(x: number, y: number, r: number, color: number, life = 220): void {
    if (this.quality < 0.6 && this.ghosts.length > 6) return; // 저사양 기기에서는 잔상을 적게
    this.ghosts.push({ x, y, r, life, maxLife: life, color });
  }

  muzzle(x: number, y: number, angle: number, color: number): void {
    this.muzzles.push({ x, y, angle, life: 70, maxLife: 70, color });
  }

  // 화면 흔들림. 진행 중인 것보다 약한 흔들림은 무시한다 (큰 폭발이 작은 피격에 덮이지 않게)
  shake(amp: number, ms: number): void {
    if (amp >= this.shakeAmp || this.shakeLeft <= 0) {
      this.shakeAmp = amp;
      this.shakeLeft = ms;
      this.shakeTotal = ms;
    }
  }

  shakeOffset(): { x: number; y: number } {
    if (this.shakeLeft <= 0) return { x: 0, y: 0 };
    const k = (this.shakeLeft / this.shakeTotal) * this.shakeAmp; // 끝날수록 약해진다
    return { x: (Math.random() * 2 - 1) * k, y: (Math.random() * 2 - 1) * k };
  }

  // 실제 경과 시간(ms)만큼 효과를 진행하고 수명이 다한 것은 뺀다
  update(dtMs: number): void {
    const dt = dtMs / 1000;
    this.shakeLeft = Math.max(0, this.shakeLeft - dtMs);
    this.particles = this.particles.filter((p) => {
      p.life -= dtMs;
      if (p.life <= 0) return false;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const d = Math.pow(p.drag, dtMs / 16); // 프레임률이 달라도 같은 비율로 감속
      p.vx *= d;
      p.vy *= d;
      return true;
    });
    this.rings = this.rings.filter((r) => (r.life -= dtMs) > 0);
    this.ghosts = this.ghosts.filter((g) => (g.life -= dtMs) > 0);
    this.muzzles = this.muzzles.filter((m) => (m.life -= dtMs) > 0);
  }

  // 캐릭터보다 먼저(아래에) 그릴 것: 잔상
  drawBehind(g: Phaser.GameObjects.Graphics): void {
    for (const gh of this.ghosts) {
      const t = 1 - gh.life / gh.maxLife; // 진행도 0(막 생김)..1(사라짐)
      g.fillStyle(gh.color, 0.35 * (1 - t));
      g.fillCircle(gh.x, gh.y, gh.r * (1 - t * 0.3));
    }
  }

  // 캐릭터 위에 그릴 것: 총구 화염, 파편, 링
  drawFront(g: Phaser.GameObjects.Graphics): void {
    for (const m of this.muzzles) {
      const t = 1 - m.life / m.maxLife;
      const len = 30 * (1 - t * 0.5);
      const half = 9 * (1 - t);
      const cx = Math.cos(m.angle);
      const cy = Math.sin(m.angle);
      const px = -cy; // 쏜 방향에 수직인 벡터 (삼각형 밑변 방향)
      const py = cx;
      g.fillStyle(0xfff3b0, 0.9 * (1 - t));
      g.fillTriangle(m.x + px * half, m.y + py * half, m.x - px * half, m.y - py * half, m.x + cx * len, m.y + cy * len);
      g.fillStyle(m.color, 0.5 * (1 - t));
      g.fillCircle(m.x, m.y, 7 * (1 - t));
    }
    for (const p of this.particles) {
      const t = 1 - p.life / p.maxLife;
      g.fillStyle(p.color, 1 - t);
      g.fillCircle(p.x, p.y, p.size * (1 - t * 0.6));
    }
    for (const r of this.rings) {
      const t = 1 - r.life / r.maxLife;
      const eased = 1 - (1 - t) * (1 - t); // 처음엔 빨리, 끝으로 갈수록 천천히 커진다
      g.lineStyle(Math.max(0.5, r.width * (1 - t)), r.color, 1 - t);
      g.strokeCircle(r.x, r.y, r.maxR * eased);
    }
  }
}
