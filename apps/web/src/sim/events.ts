import type { EnemyKind } from './types';

// 시뮬레이션이 바깥에 알리는 사건. sim은 게임·기록 코드를 모르고, 쓰는 쪽이 싱크를 넣어 준다.
// 표본만으로는 "체력이 줄었다"까지만 보이고 무엇에 맞았는지가 안 보여서 추가했다.

/** 피해를 준 주체. 협동의 적 3종은 접촉과 사격을 구분한다. */
export type DamageSource =
  | 'scoutContact' // 척후병에게 닿음
  | 'gunnerContact' // 포수에게 닿음
  | 'gunnerShot' // 포수의 탄
  | 'chargerContact' // 강습병에게 닿음
  | 'peerShot'; // 대전 상대의 탄

// 적 종류 → 접촉 피해의 주체
export const ENEMY_CONTACT_SOURCE: Record<EnemyKind, DamageSource> = {
  0: 'scoutContact',
  1: 'gunnerContact',
  2: 'chargerContact',
};

export type SimEvent =
  | { kind: 'hurt'; target: 0 | 1; amount: number; by: DamageSource } // 플레이어가 맞았다
  | { kind: 'core'; amount: number; by: DamageSource } // 코어가 깎였다
  | { kind: 'down'; target: 0 | 1 } // 플레이어가 쓰러졌다
  | { kind: 'revive'; target: 0 | 1 } // 짝이 일으켜 세웠다
  | { kind: 'kill'; by: 0 | 1; enemy: EnemyKind }; // 적을 처치했다

export type SimEventSink = (event: SimEvent) => void; // 사건을 받는 함수. step()의 onEvent로 넣는다
