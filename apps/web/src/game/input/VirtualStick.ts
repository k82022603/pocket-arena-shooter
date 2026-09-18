import Phaser from 'phaser';

export interface StickVector {
  x: number;
  y: number;
  magnitude: number;
}

export class VirtualStick {
  readonly vector: StickVector = { x: 0, y: 0, magnitude: 0 };
  // 키보드·마우스 조작이 켜지면 마우스 포인터는 무시하고 터치만 받는다.
  touchOnly = false;

  private pointerId: number | null = null;
  private originX = 0;
  private originY = 0;
  private readonly base: Phaser.GameObjects.Arc;
  private readonly knob: Phaser.GameObjects.Arc;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly side: 'left' | 'right',
    private readonly radius = 60,
    private readonly deadzone = 0.15,
  ) {
    this.base = scene.add.circle(0, 0, radius, 0xffffff, 0.08).setVisible(false).setDepth(100);
    this.knob = scene.add.circle(0, 0, radius * 0.4, 0xffffff, 0.25).setVisible(false).setDepth(101);
    scene.input.on('pointerdown', this.onDown, this);
    scene.input.on('pointermove', this.onMove, this);
    scene.input.on('pointerup', this.onUp, this);
    scene.input.on('pointerupoutside', this.onUp, this);
  }

  get active(): boolean {
    return this.pointerId !== null;
  }

  private inZone(p: Phaser.Input.Pointer): boolean {
    const half = this.scene.scale.width / 2;
    return this.side === 'left' ? p.x < half : p.x >= half;
  }

  private onDown(p: Phaser.Input.Pointer): void {
    if (this.pointerId !== null || !this.inZone(p)) return;
    if (this.touchOnly && !p.wasTouch) return;
    this.pointerId = p.id;
    this.originX = p.x;
    this.originY = p.y;
    this.base.setPosition(p.x, p.y).setVisible(true);
    this.knob.setPosition(p.x, p.y).setVisible(true);
  }

  private onMove(p: Phaser.Input.Pointer): void {
    if (p.id !== this.pointerId) return;
    let dx = p.x - this.originX;
    let dy = p.y - this.originY;
    const len = Math.hypot(dx, dy);
    if (len > this.radius) {
      dx = (dx / len) * this.radius;
      dy = (dy / len) * this.radius;
    }
    this.knob.setPosition(this.originX + dx, this.originY + dy);

    const raw = Math.min(len / this.radius, 1);
    if (raw < this.deadzone) {
      this.vector.x = this.vector.y = this.vector.magnitude = 0;
      return;
    }
    const mag = (raw - this.deadzone) / (1 - this.deadzone);
    this.vector.x = (dx / (len || 1)) * mag;
    this.vector.y = (dy / (len || 1)) * mag;
    this.vector.magnitude = mag;
  }

  private onUp(p: Phaser.Input.Pointer): void {
    if (p.id !== this.pointerId) return;
    this.pointerId = null;
    this.vector.x = this.vector.y = this.vector.magnitude = 0;
    this.base.setVisible(false);
    this.knob.setVisible(false);
  }

  destroy(): void {
    this.scene.input.off('pointerdown', this.onDown, this);
    this.scene.input.off('pointermove', this.onMove, this);
    this.scene.input.off('pointerup', this.onUp, this);
    this.scene.input.off('pointerupoutside', this.onUp, this);
    this.base.destroy();
    this.knob.destroy();
  }
}
