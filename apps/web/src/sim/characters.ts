export type CharacterId = 'lachesis' | 'clotho' | 'atropos' | 'est';

export interface CharacterStats {
  speedMul: number;
  maxHp: number;
  damage: number;
  fireIntervalTicks: number;
  dashCooldownTicks: number;
  dashTicks: number;
}

export interface Character {
  id: CharacterId;
  name: string;
  role: string;
  color: number;
  stats: CharacterStats;
}

export const CHARACTERS: Record<CharacterId, Character> = {
  lachesis: {
    id: 'lachesis',
    name: '라키시스',
    role: '올라운더',
    color: 0xf5c542,
    stats: { speedMul: 1.05, maxHp: 100, damage: 10, fireIntervalTicks: 10, dashCooldownTicks: 90, dashTicks: 12 },
  },
  clotho: {
    id: 'clotho',
    name: '클로소',
    role: '스피드형',
    color: 0x7fd7ff,
    stats: { speedMul: 1.25, maxHp: 80, damage: 9, fireIntervalTicks: 10, dashCooldownTicks: 80, dashTicks: 14 },
  },
  atropos: {
    id: 'atropos',
    name: '아트로포스',
    role: '화력형',
    color: 0xf472b6,
    stats: { speedMul: 0.95, maxHp: 100, damage: 12, fireIntervalTicks: 8, dashCooldownTicks: 120, dashTicks: 12 },
  },
  est: {
    id: 'est',
    name: '에스트',
    role: '방어형',
    color: 0xff8c42,
    stats: { speedMul: 0.85, maxHp: 130, damage: 10, fireIntervalTicks: 11, dashCooldownTicks: 140, dashTicks: 18 },
  },
};

export const CHARACTER_ORDER: readonly CharacterId[] = ['lachesis', 'clotho', 'atropos', 'est'];

export const DEFAULT_CHARACTER: CharacterId = 'lachesis';

export function characterIndex(id: CharacterId): number {
  return CHARACTER_ORDER.indexOf(id);
}

export function characterAt(index: number): CharacterId {
  return CHARACTER_ORDER[((index % CHARACTER_ORDER.length) + CHARACTER_ORDER.length) % CHARACTER_ORDER.length]!;
}
