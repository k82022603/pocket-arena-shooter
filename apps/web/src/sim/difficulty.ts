// 혼자 하기 난이도. 둘이 하는 경기는 항상 'normal'이다.
//
// 혼자 하기는 두 가지다. 1:1 대전은 상대가 봇이고, 협동 방어는 혼자서 웨이브를 막는다.
// 그래서 난이도 하나가 두 곳을 바꾼다. 대전에서는 봇의 솜씨, 방어전에서는 적의 수다.
// 수치는 자동 플레이 측정으로 정했다 (npm run check:balance).

export type Difficulty = 'easy' | 'normal' | 'hard';

export const DIFFICULTY_ORDER: readonly Difficulty[] = ['easy', 'normal', 'hard']; // 타이틀 버튼 순서

// 화면에 보이는 이름
export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: '하',
  normal: '중',
  hard: '상',
};

export interface BotSkill {
  /** 조준 오차의 폭(라디안). 클수록 빗나간다 */
  aimError: number;
  /** 날아오는 탄을 봤을 때 대시로 피할 확률 (틱마다) */
  dodgeChance: number;
  /** 점사 길이와 쉬는 시간(틱). 쉬는 시간은 [최소, 최소+폭) */
  burstTicks: number;
  restMin: number;
  restSpread: number;
  /** 상대 이동을 앞질러 쏘는 정도. 0이면 지금 위치를 쏜다 */
  lead: number;
}

export const BOT_SKILL: Record<Difficulty, BotSkill> = {
  easy: { aimError: 0.7, dodgeChance: 0.08, burstTicks: 24, restMin: 45, restSpread: 40, lead: 0 }, // 많이 빗나가고 거의 안 피하며 오래 쉰다
  normal: { aimError: 0.36, dodgeChance: 0.35, burstTicks: 30, restMin: 30, restSpread: 30, lead: 0 }, // 난이도를 넣기 전의 봇 그대로
  hard: { aimError: 0.22, dodgeChance: 0.5, burstTicks: 36, restMin: 22, restSpread: 24, lead: 0.5 }, // 정확하고 절반은 피하며 앞질러 쏜다
};

/** 1인 방어의 적 수 배율. 편성은 2인 기준이다 */
export const SOLO_ENEMY_SCALE: Record<Difficulty, number> = {
  easy: 0.3, // 10웨이브 합계 53기
  normal: 0.45, // 77기
  hard: 0.65, // 116기 (2인은 175기)
};
