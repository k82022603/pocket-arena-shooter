import type Phaser from 'phaser';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: number;
  drag: number;
}

interface Ring {
  x: number;
  y: number;
  maxR: number;
  life: number;
  maxLife: number;
  color: number;
  width: number;
}

interface Ghost {
  x: number;
  y: number;
  r: number;
  life: number;
  maxLife: number;
  color: number;
}

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
  private particles: Particle[] = [];
  private rings: Ring[] = [];
  private ghosts: Ghost[] = [];
  private muzzles: Muzzle[] = [];
  private shakeLeft = 0;
  private shakeTotal = 0;
  private shakeAmp = 0;

  burst(x: number, y: number, color: number, count: number, speed: number, life: number, size: number, drag = 0.92): void {
    for (let i = 0; i < count; i++) {
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
    this.ghosts.push({ x, y, r, life, maxLife: life, color });
  }

  muzzle(x: number, y: number, angle: number, color: number): void {
    this.muzzles.push({ x, y, angle, life: 70, maxLife: 70, color });
  }

  shake(amp: number, ms: number): void {
    if (amp >= this.shakeAmp || this.shakeLeft <= 0) {
      this.shakeAmp = amp;
      this.shakeLeft = ms;
      this.shakeTotal = ms;
    }
  }

  shakeOffset(): { x: number; y: number } {
    if (this.shakeLeft <= 0) return { x: 0, y: 0 };
    const k = (this.shakeLeft / this.shakeTotal) * this.shakeAmp;
    return { x: (Math.random() * 2 - 1) * k, y: (Math.random() * 2 - 1) * k };
  }

  update(dtMs: number): void {
    const dt = dtMs / 1000;
    this.shakeLeft = Math.max(0, this.shakeLeft - dtMs);
    this.particles = this.particles.filter((p) => {
      p.life -= dtMs;
      if (p.life <= 0) return false;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const d = Math.pow(p.drag, dtMs / 16);
      p.vx *= d;
      p.vy *= d;
      return true;
    });
    this.rings = this.rings.filter((r) => (r.life -= dtMs) > 0);
    this.ghosts = this.ghosts.filter((g) => (g.life -= dtMs) > 0);
    this.muzzles = this.muzzles.filter((m) => (m.life -= dtMs) > 0);
  }

  drawBehind(g: Phaser.GameObjects.Graphics): void {
    for (const gh of this.ghosts) {
      const t = 1 - gh.life / gh.maxLife;
      g.fillStyle(gh.color, 0.35 * (1 - t));
      g.fillCircle(gh.x, gh.y, gh.r * (1 - t * 0.3));
    }
  }

  drawFront(g: Phaser.GameObjects.Graphics): void {
    for (const m of this.muzzles) {
      const t = 1 - m.life / m.maxLife;
      const len = 30 * (1 - t * 0.5);
      const half = 9 * (1 - t);
      const cx = Math.cos(m.angle);
      const cy = Math.sin(m.angle);
      const px = -cy;
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
      const eased = 1 - (1 - t) * (1 - t);
      g.lineStyle(Math.max(0.5, r.width * (1 - t)), r.color, 1 - t);
      g.strokeCircle(r.x, r.y, r.maxR * eased);
    }
  }
}
