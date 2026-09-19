// 파티마 로스터와 능력치. 원작 파워게이지를 게임 수치로 옮긴 방식은 docs/02.캐릭터_설정.md에 있다.

export type CharacterId = 'lachesis' | 'clotho' | 'atropos' | 'est';

export interface CharacterStats {
  speedMul: number; // 기준 이동 속도(260px/s)에 곱하는 배율
  maxHp: number; // 최대 체력
  damage: number; // 기본 탄 위력 (무기 배율을 곱한다)
  fireIntervalTicks: number; // 기본 연사 간격 (틱, 무기 배율을 곱한다)
  dashCooldownTicks: number; // 대시 재사용 대기 (틱)
  dashTicks: number; // 대시 지속 = 무적 시간 (틱)
}

export interface Character {
  id: CharacterId;
  name: string; // 화면에 보이는 이름
  role: string; // 한 줄 역할 설명
  color: number; // 고유색: HP 바, 초상 카드 테두리, 기본 스킨의 강조색
  stats: CharacterStats;
}

export const CHARACTERS: Record<CharacterId, Character> = {
  lachesis: {
    id: 'lachesis',
    name: '라키시스',
    role: '올라운더',
    color: 0xf5c542,
    stats: { speedMul: 1.05, maxHp: 100, damage: 10, fireIntervalTicks: 10, dashCooldownTicks: 90, dashTicks: 12 }, // 전부 평균 이상, 대시가 자주 돈다
  },
  clotho: {
    id: 'clotho',
    name: '클로소',
    role: '스피드형',
    color: 0x7fd7ff,
    stats: { speedMul: 1.25, maxHp: 80, damage: 9, fireIntervalTicks: 10, dashCooldownTicks: 80, dashTicks: 14 }, // 가장 빠르고 가장 약하다
  },
  atropos: {
    id: 'atropos',
    name: '아트로포스',
    role: '화력형',
    color: 0xf472b6,
    stats: { speedMul: 0.95, maxHp: 100, damage: 12, fireIntervalTicks: 8, dashCooldownTicks: 120, dashTicks: 12 }, // 가장 세게, 가장 빨리 쏜다
  },
  est: {
    id: 'est',
    name: '에스트',
    role: '방어형',
    color: 0xff8c42,
    stats: { speedMul: 0.85, maxHp: 130, damage: 10, fireIntervalTicks: 11, dashCooldownTicks: 140, dashTicks: 18 }, // 느리지만 단단하고 무적이 길다
  },
};

// 타이틀에서 ◀ ▶로 넘기는 순서. 패킷에는 이 목록의 번호로 싣는다
export const CHARACTER_ORDER: readonly CharacterId[] = ['lachesis', 'clotho', 'atropos', 'est'];

export const DEFAULT_CHARACTER: CharacterId = 'lachesis';

export function characterIndex(id: CharacterId): number {
  return CHARACTER_ORDER.indexOf(id);
}

// 번호 → 파티마. 범위를 벗어나거나 음수여도 목록 길이로 감아 돌린다 (◀로 처음에서 끝으로)
export function characterAt(index: number): CharacterId {
  return CHARACTER_ORDER[((index % CHARACTER_ORDER.length) + CHARACTER_ORDER.length) % CHARACTER_ORDER.length]!;
}
