import Phaser from 'phaser';
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
