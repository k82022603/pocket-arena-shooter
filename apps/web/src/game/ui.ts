import Phaser from 'phaser';

export const FONT = 'system-ui, -apple-system, "Noto Sans KR", sans-serif';

// 화면 크기에 맞춘 UI 배율. 폰 가로(844×390)에서 보기 좋게 잡은 크기를 기준 1로 두고,
// 큰 화면에서는 그만큼 키우고 작은 폰에서는 조금 줄인다. 글자·버튼·간격은 모두 이 값을 곱해 쓴다.
// 캔버스는 이미 화면을 가득 채우므로(Phaser RESIZE), 배율만 맞추면 어느 화면에서든 같은 모양이 된다.
const DESIGN_W = 844;
const DESIGN_H = 390;
const MIN_SCALE = 0.85;
const MAX_SCALE = 1.7;
// 기준보다 큰 화면에서는 늘어난 만큼의 절반만 키운다. 화면에 비례해 그대로 키우면
// PC 모니터에서 버튼이 손바닥만 해진다. 가까이 보는 폰과 멀리서 보는 모니터는 필요한 크기가 다르다.
const GROWTH = 0.5;

export function uiScale(scene: Phaser.Scene): number {
  const { width, height } = scene.scale;
  const raw = Math.min(width / DESIGN_W, height / DESIGN_H);
  const eased = raw <= 1 ? raw : 1 + (raw - 1) * GROWTH;
  return Phaser.Math.Clamp(eased, MIN_SCALE, MAX_SCALE);
}

// 글자 크기 단계. 화면마다 제각각 숫자를 쓰지 않고 여기서 고른다(기준 크기, 배율은 헬퍼가 곱한다).
export const TYPE = {
  display: 34, // 게임 제목, 결과 제목
  heading: 24, // 파티마 이름
  button: 17, // 주요 버튼
  body: 14, // 선택 버튼, 표 본문
  caption: 12, // 보조 설명
  micro: 11, // 진단·안내
} as const;

/**
 * 버튼을 기준 크기(w×h)로 맞춘다. 같은 줄·같은 열의 버튼이 글자 길이와 상관없이 같은 크기가 된다.
 * Phaser 텍스트는 세로 가운데 정렬이 없어서 위아래 여백으로 높이를 맞춘다.
 */
export function sizeButton(button: Phaser.GameObjects.Text, w: number, h: number): Phaser.GameObjects.Text {
  const s = uiScale(button.scene);
  button.setPadding(0, 0, 0, 0).setFixedSize(0, 0);
  const py = Math.max(0, Math.round((h * s - button.height) / 2));
  button.setPadding(0, py, 0, py);
  button.setFixedSize(Math.max(Math.round(w * s), Math.ceil(button.width + 12 * s)), 0);
  return button;
}

/** 기준 크기(px)를 지금 화면의 크기로 바꾼다 */
export function px(scene: Phaser.Scene, n: number): number {
  return Math.round(n * uiScale(scene));
}

// ── 스킨 ─────────────────────────────────────────────────────────────
// 색은 버튼마다 적지 않고 역할(배경·표면·테두리·강조)로 여기 모은다. 스킨은 이 묶음을 바꿔 끼우는 것이다.
// accent가 null이면 강조색이 지금 고른 파티마의 색을 따른다(일러스트 카드 테두리와 같은 색).
export interface Skin {
  id: string;
  name: string;
  bg: string;
  surface: number;
  surfaceHover: number;
  border: number;
  text: string;
  textDim: string;
  onAccent: string;
  accent: number | null;
}

export const SKINS: readonly Skin[] = [
  { id: 'fatima', name: '파티마', bg: '#0b0f1a', surface: 0x172039, surfaceHover: 0x1f2b4b, border: 0x2d3a5c, text: '#e3e8f5', textDim: '#8fa3c8', onAccent: '#0b0f1a', accent: null },
  { id: 'mirage', name: '미라주', bg: '#08080b', surface: 0x17161c, surfaceHover: 0x221f29, border: 0x3a3340, text: '#efe9dc', textDim: '#a39a8a', onAccent: '#140f05', accent: 0xd8b25a },
  { id: 'neon', name: '네온', bg: '#070b16', surface: 0x10203a, surfaceHover: 0x163056, border: 0x1f4a78, text: '#e2f4ff', textDim: '#7fb2d6', onAccent: '#04121f', accent: 0x4cc9f0 },
];

const SKIN_KEY = 'arena.skin';
let currentSkin: Skin = SKINS[0]!;
try {
  const saved = localStorage.getItem(SKIN_KEY);
  currentSkin = SKINS.find((k) => k.id === saved) ?? currentSkin;
} catch {
  /* 저장 불가 환경 */
}

export function skin(): Skin {
  return currentSkin;
}

export function cycleSkin(): Skin {
  currentSkin = SKINS[(SKINS.indexOf(currentSkin) + 1) % SKINS.length]!;
  try {
    localStorage.setItem(SKIN_KEY, currentSkin.id);
  } catch {
    /* 저장 불가 환경 */
  }
  return currentSkin;
}

/** 이 화면의 강조색. 스킨이 정하지 않으면 파티마의 색 */
export function accentOf(characterColor: number): number {
  return currentSkin.accent ?? characterColor;
}

export function applySkinBackground(scene: Phaser.Scene): void {
  scene.cameras.main.setBackgroundColor(currentSkin.bg);
}

const hex = (c: number): string => '#' + c.toString(16).padStart(6, '0');

function mix(a: number, b: number, t: number): number {
  const ch = (c: number, sh: number) => (c >> sh) & 0xff;
  const m = (sh: number) => Math.round(ch(a, sh) * (1 - t) + ch(b, sh) * t) << sh;
  return m(16) | m(8) | m(0);
}

// ── 버튼 ─────────────────────────────────────────────────────────────
// 역할별 모양:
//  action  실행(혼자 하기·방 만들기·다시 하기): 강조색으로 채운다. 화면에서 가장 먼저 눈에 들어와야 한다
//  neutral 일반(모드 전환, 게임 중 버튼): 차분한 표면색
//  ghost   보조(화살표·음소거·뒤로·기록 저장): 테두리만
//  chip    고를 수 있는 항목(무기·난이도), chipOn은 고른 것: 강조색 테두리와 글자
export type ButtonVariant = 'action' | 'neutral' | 'ghost' | 'chip' | 'chipOn';

interface ButtonLook {
  variant: ButtonVariant;
  accent: number;
  hover: boolean;
  bg: Phaser.GameObjects.Graphics;
  key: string;
}

const LOOK = 'look';

function paintButton(btn: Phaser.GameObjects.Text): void {
  const look = btn.getData(LOOK) as ButtonLook | undefined;
  if (!look) return;
  const k = currentSkin;
  const w = btn.displayWidth;
  const h = btn.displayHeight;
  const key = [look.variant, look.accent, look.hover, w, h, k.id].join('|');
  if (key !== look.key) {
    look.key = key;
    const g = look.bg;
    g.clear();
    const r = Math.min(10 * uiScale(btn.scene), h / 2);
    let fill = k.surface;
    let fillAlpha = 1;
    let stroke = k.border;
    let strokeW = 1;
    let color = k.text;
    switch (look.variant) {
      case 'action':
        fill = look.hover ? mix(look.accent, 0xffffff, 0.15) : look.accent;
        stroke = mix(look.accent, 0xffffff, 0.35);
        color = k.onAccent;
        break;
      case 'neutral':
        fill = look.hover ? k.surfaceHover : k.surface;
        break;
      case 'ghost':
        fill = k.surfaceHover;
        fillAlpha = look.hover ? 0.6 : 0;
        color = k.textDim;
        break;
      case 'chip':
        fill = look.hover ? k.surfaceHover : mix(k.surface, 0x000000, 0.25);
        color = k.textDim;
        break;
      case 'chipOn':
        fill = mix(k.surface, look.accent, 0.22);
        stroke = look.accent;
        strokeW = 2;
        color = hex(mix(look.accent, 0xffffff, 0.35));
        break;
    }
    g.fillStyle(fill, fillAlpha);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, r);
    g.lineStyle(strokeW * Math.max(1, uiScale(btn.scene)), stroke, 1);
    g.strokeRoundedRect(-w / 2, -h / 2, w, h, r);
    btn.setColor(color);
  }
  look.bg
    .setPosition(btn.x, btn.y)
    .setVisible(btn.visible)
    .setAlpha(btn.alpha)
    .setDepth(btn.depth - 0.01)
    .setScrollFactor(btn.scrollFactorX, btn.scrollFactorY);
}

/** 버튼의 역할을 바꾼다. 강조색은 action·chipOn에만 쓰인다 */
export function styleButton(btn: Phaser.GameObjects.Text, variant: ButtonVariant, accent?: number): Phaser.GameObjects.Text {
  const look = btn.getData(LOOK) as ButtonLook | undefined;
  if (!look) return btn;
  look.variant = variant;
  if (accent !== undefined) look.accent = accent;
  paintButton(btn);
  return btn;
}

export function makeButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  onTap: () => void,
  size = 28,
  variant: ButtonVariant = 'neutral',
): Phaser.GameObjects.Text {
  const s = uiScale(scene);
  // 배경은 둥근 모서리를 그리려고 따로 그린 도형이다. 글자와 같이 움직이도록 매 프레임 맞춘다.
  const bg = scene.add.graphics();
  const text = scene.add
    .text(x, y, label, {
      fontFamily: FONT,
      fontSize: `${Math.round(size * s)}px`,
      color: currentSkin.text,
      align: 'center',
      padding: { x: Math.round(28 * s), y: Math.round(14 * s) },
    })
    .setOrigin(0.5)
    .setInteractive({ useHandCursor: true });
  const look: ButtonLook = { variant, accent: currentSkin.accent ?? 0x4cc9f0, hover: false, bg, key: '' };
  text.setData(LOOK, look);
  const sync = (): void => paintButton(text);
  scene.events.on('postupdate', sync);
  text.once('destroy', () => {
    scene.events.off('postupdate', sync);
    bg.destroy();
  });
  text.on('pointerover', () => {
    look.hover = true;
    paintButton(text);
  });
  text.on('pointerdown', () => text.setAlpha(0.7));
  text.on('pointerup', () => {
    text.setAlpha(1);
    onTap();
  });
  text.on('pointerout', () => {
    text.setAlpha(1);
    look.hover = false;
    paintButton(text);
  });
  paintButton(text);
  return text;
}
/** 버튼 안쪽 여백을 기준 크기로 바꾼다 */
export function padButton(button: Phaser.GameObjects.Text, x: number, y: number): Phaser.GameObjects.Text {
  const s = uiScale(button.scene);
  return button.setPadding(Math.round(x * s), Math.round(y * s), Math.round(x * s), Math.round(y * s));
}

export function makeLabel(scene: Phaser.Scene, x: number, y: number, label: string, size = 22): Phaser.GameObjects.Text {
  return scene.add
    .text(x, y, label, { fontFamily: FONT, fontSize: `${px(scene, size)}px`, color: '#c9d1e3', align: 'center' })
    .setOrigin(0.5);
}

/** 기준 크기의 글자 스타일 (makeLabel을 쓰지 않는 텍스트용) */
export function fontPx(scene: Phaser.Scene, size: number): string {
  return `${px(scene, size)}px`;
}
