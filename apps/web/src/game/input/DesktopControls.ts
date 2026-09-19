import Phaser from 'phaser';

export interface DesktopFrame {
  moveX: number;
  moveY: number;
  // 마우스 조준 방향(단위 벡터)
  aimX: number;
  aimY: number;
  fire: boolean;
  dash: boolean;
  // 1~3 키를 누른 프레임에만 그 번호, 아니면 0
  swapTo: number;
}

// 노트북/데스크톱용: WASD·방향키 이동, 마우스 위치로 조준, 왼쪽 버튼 발사, Shift/Space 대시.
// 키보드를 누르거나 마우스 포인터를 쓰는 순간 켜지고, 터치를 쓰면 다시 꺼진다.
//
// 키는 event.code(키보드의 물리적 위치)로 읽는다. Phaser 키보드는 keyCode를 쓰는데,
// 한글 입력 상태에서는 글자 키의 keyCode가 229(조합 중)로 들어와 WASD가 전혀 먹지 않는다.
// 한/영 상태를 신경 쓰지 않고 움직일 수 있어야 한다.
const MOVE_CODES = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ShiftLeft',
  'ShiftRight',
  'Space',
  'Digit1',
  'Digit2',
  'Digit3',
]);

export class DesktopControls {
  active = false;

  private readonly down = new Set<string>();
  // 지난 read() 이후 새로 눌린 키. 대시·무기 교체처럼 한 번만 반응해야 하는 키에 쓴다.
  private readonly pressed = new Set<string>();

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!MOVE_CODES.has(e.code)) return;
    // 방향키·스페이스가 페이지를 스크롤하지 않게
    e.preventDefault();
    if (!this.down.has(e.code)) this.pressed.add(e.code);
    this.down.add(e.code);
    this.enable();
  };
  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
  };
  // 창이 포커스를 잃으면 keyup이 오지 않는다. 누른 채로 남지 않게 비운다.
  private readonly onBlur = (): void => {
    this.down.clear();
    this.pressed.clear();
  };
  private readonly onPointer = (p: Phaser.Input.Pointer): void => {
    if (p.wasTouch) this.disable();
    else this.enable();
  };

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly onChange: (active: boolean) => void = () => {},
  ) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    scene.input.on('pointermove', this.onPointer);
    scene.input.on('pointerdown', this.onPointer);
  }

  /** 키보드 입력이 이 페이지로 들어오고 있는가. 주소창이나 다른 창을 누르면 false가 된다. */
  get hasFocus(): boolean {
    return document.hasFocus();
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

  private is(...codes: string[]): boolean {
    return codes.some((c) => this.down.has(c));
  }

  private took(...codes: string[]): boolean {
    return codes.some((c) => this.pressed.has(c));
  }

  // originX/Y: 조준 기준이 되는 내 캐릭터의 화면 좌표
  read(originX: number, originY: number): DesktopFrame | null {
    if (!this.active) return null;
    let moveX = (this.is('KeyD', 'ArrowRight') ? 1 : 0) - (this.is('KeyA', 'ArrowLeft') ? 1 : 0);
    let moveY = (this.is('KeyS', 'ArrowDown') ? 1 : 0) - (this.is('KeyW', 'ArrowUp') ? 1 : 0);
    const len = Math.hypot(moveX, moveY);
    if (len > 1) {
      moveX /= len;
      moveY /= len;
    }
    const pointer = this.scene.input.activePointer;
    const dx = pointer.x - originX;
    const dy = pointer.y - originY;
    const dist = Math.hypot(dx, dy) || 1;
    const dash = this.took('ShiftLeft', 'ShiftRight', 'Space');
    const swapTo = this.took('Digit1') ? 1 : this.took('Digit2') ? 2 : this.took('Digit3') ? 3 : 0;
    this.pressed.clear();
    return {
      moveX,
      moveY,
      aimX: dx / dist,
      aimY: dy / dist,
      fire: pointer.leftButtonDown() && !pointer.wasTouch,
      dash,
      swapTo,
    };
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.scene.input.off('pointermove', this.onPointer);
    this.scene.input.off('pointerdown', this.onPointer);
    this.scene.input.setDefaultCursor('default');
  }
}
