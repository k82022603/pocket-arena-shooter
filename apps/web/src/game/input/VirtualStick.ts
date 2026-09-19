import Phaser from 'phaser';

export interface StickVector {
  x: number;
  y: number;
  magnitude: number;
}

// 화면 절반을 쓰는 플로팅 가상 스틱. 누른 자리가 스틱의 중심이 된다 (고정 위치보다 엄지가 편하다).
export class VirtualStick {
  readonly vector: StickVector = { x: 0, y: 0, magnitude: 0 };
  // 키보드·마우스 조작이 켜지면 마우스 포인터는 무시하고 터치만 받는다.
  touchOnly = false;

  private pointerId: number | null = null; // 이 스틱을 잡고 있는 손가락 (멀티터치에서 구분)
  private originX = 0; // 처음 누른 자리 = 스틱 중심
  private originY = 0;
  private readonly base: Phaser.GameObjects.Arc;
  private readonly knob: Phaser.GameObjects.Arc;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly side: 'left' | 'right',
    private readonly radius = 60, // 끝까지 민 것으로 보는 거리 (px)
    private readonly deadzone = 0.15, // 반지름의 15% 안쪽 흔들림은 무시
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
    return this.side === 'left' ? p.x < half : p.x >= half; // 왼쪽 스틱은 화면 왼쪽 절반, 조준 스틱은 오른쪽 절반
  }

  private onDown(p: Phaser.Input.Pointer): void {
    if (this.pointerId !== null || !this.inZone(p)) return; // 이미 다른 손가락이 잡고 있거나 내 구역이 아니다
    if (this.touchOnly && !p.wasTouch) return; // PC 조작 중에는 마우스 클릭을 스틱으로 쓰지 않는다
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
      // 반지름 밖으로 끌면 손잡이는 테두리에 붙어 따라간다
      dx = (dx / len) * this.radius;
      dy = (dy / len) * this.radius;
    }
    this.knob.setPosition(this.originX + dx, this.originY + dy);

    const raw = Math.min(len / this.radius, 1);
    if (raw < this.deadzone) {
      this.vector.x = this.vector.y = this.vector.magnitude = 0;
      return;
    }
    const mag = (raw - this.deadzone) / (1 - this.deadzone); // 데드존 밖을 다시 0..1로 펼친다 (데드존 경계에서 갑자기 튀지 않게)
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
