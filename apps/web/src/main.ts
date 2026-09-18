import Phaser from 'phaser';
import './pwa';
import { sfx } from './game/audio/Sfx';
import { BootScene } from './game/scenes/BootScene';
import { TitleScene } from './game/scenes/TitleScene';
import { LobbyScene } from './game/scenes/LobbyScene';
import { ArenaScene } from './game/scenes/ArenaScene';
import { ResultScene } from './game/scenes/ResultScene';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#0b0f1a',
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: '100%',
    height: '100%',
  },
  input: { activePointers: 4 },
  scene: [BootScene, TitleScene, LobbyScene, ArenaScene, ResultScene],
};

new Phaser.Game(config);

// iOS/Chrome 자동재생 정책: 첫 사용자 제스처에서 오디오 컨텍스트를 연다.
for (const type of ['pointerdown', 'touchstart', 'keydown'] as const) {
  window.addEventListener(type, () => sfx.unlock(), { passive: true });
}
