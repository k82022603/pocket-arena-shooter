import Phaser from 'phaser';
import './pwa'; // 설치 프롬프트를 일찍 붙잡으려고 가장 먼저 불러온다
import { sfx } from './game/audio/Sfx';
import { BootScene } from './game/scenes/BootScene';
import { TitleScene } from './game/scenes/TitleScene';
import { LobbyScene } from './game/scenes/LobbyScene';
import { ArenaScene } from './game/scenes/ArenaScene';
import { ResultScene } from './game/scenes/ResultScene';

// 앱의 시작점: Phaser 게임을 만들고 장면들을 등록한다. 첫 장면은 BootScene
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO, // WebGL이 되면 WebGL, 안 되면 Canvas
  parent: 'game', // index.html의 <div id="game">
  backgroundColor: '#0b0f1a',
  scale: {
    mode: Phaser.Scale.RESIZE, // 캔버스가 창 크기를 그대로 따른다 (UI 배율은 ui.ts가 맞춘다)
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: '100%',
    height: '100%',
  },
  input: { activePointers: 4 }, // 이동·조준 두 엄지 + 버튼을 동시에 누를 수 있게 멀티터치 4개
  scene: [BootScene, TitleScene, LobbyScene, ArenaScene, ResultScene], // 배열 첫 장면이 자동으로 시작된다
};

const game = new Phaser.Game(config);
if (new URLSearchParams(location.search).has('debug')) (window as unknown as { __game?: Phaser.Game }).__game = game; // 개발자 도구에서 들여다보기용

// iOS/Chrome 자동재생 정책: 첫 사용자 제스처에서 오디오 컨텍스트를 연다.
for (const type of ['pointerdown', 'touchstart', 'keydown'] as const) {
  window.addEventListener(type, () => sfx.unlock(), { passive: true }); // passive: 스크롤 등 기본 동작을 막지 않는다고 브라우저에 알린다
}
