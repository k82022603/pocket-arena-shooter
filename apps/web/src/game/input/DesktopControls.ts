import Phaser from 'phaser';

export interface DesktopFrame {
  moveX: number;
  moveY: number;
  // 마우스 조준 방향(단위 벡터). 마우스 조작이 아직 켜지지 않았으면 null.
  aimX: number;
  aimY: number;
  fire: boolean;
  dash: boolean;
}

// 노트북/데스크톱용: WASD·방향키 이동, 마우스 위치로 조준, 왼쪽 버튼 발사, Shift/Space 대시.
// 키보드를 누르거나 마우스 포인터를 쓰는 순간 켜지고, 터치를 쓰면 다시 꺼진다.
export class DesktopControls {
  active = false;

  private readonly keys: Record<string, Phaser.Input.Keyboard.Key> | null;
  private readonly onKeyDown = (): void => this.enable();
  private readonly onPointer = (p: Phaser.Input.Pointer): void => {
    if (p.wasTouch) this.disable();
    else this.enable();
  };

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly onChange: (active: boolean) => void = () => {},
  ) {
    const kb = scene.input.keyboard;
    this.keys = kb
      ? (kb.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,SHIFT,SPACE') as Record<string, Phaser.Input.Keyboard.Key>)
      : null;
    kb?.on('keydown', this.onKeyDown);
    scene.input.on('pointermove', this.onPointer);
    scene.input.on('pointerdown', this.onPointer);
  }

  private enable(): void {
    if (this.active) return;
    this.active = true;
    // 아레나가 자체 레티클을 그리므로 시스템 커서는 숨긴다
    this.scene.input.setDefaultCursor('none');
    this.onChange(true);
  }

  private disable(): void {
    if (!this.active) return;
    this.active = false;
    this.scene.input.setDefaultCursor('default');
    this.onChange(false);
  }

  // originX/Y: 조준 기준이 되는 내 캐릭터의 화면 좌표
  read(originX: number, originY: number): DesktopFrame | null {
    if (!this.active || !this.keys) return null;
    const k = this.keys;
    let moveX = (k.D!.isDown || k.RIGHT!.isDown ? 1 : 0) - (k.A!.isDown || k.LEFT!.isDown ? 1 : 0);
    let moveY = (k.S!.isDown || k.DOWN!.isDown ? 1 : 0) - (k.W!.isDown || k.UP!.isDown ? 1 : 0);
    const len = Math.hypot(moveX, moveY);
    if (len > 1) {
      moveX /= len;
      moveY /= len;
    }
    const pointer = this.scene.input.activePointer;
    const dx = pointer.x - originX;
    const dy = pointer.y - originY;
    const dist = Math.hypot(dx, dy) || 1;
    const dash = Phaser.Input.Keyboard.JustDown(k.SHIFT!) || Phaser.Input.Keyboard.JustDown(k.SPACE!);
    return {
      moveX,
      moveY,
      aimX: dx / dist,
      aimY: dy / dist,
      fire: pointer.leftButtonDown() && !pointer.wasTouch,
      dash,
    };
  }

  destroy(): void {
    this.scene.input.keyboard?.off('keydown', this.onKeyDown);
    this.scene.input.off('pointermove', this.onPointer);
    this.scene.input.off('pointerdown', this.onPointer);
    this.scene.input.setDefaultCursor('default');
  }
}
