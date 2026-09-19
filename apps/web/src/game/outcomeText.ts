import type { MatchSummary, Outcome } from '../sim/core';
import { COOP } from '../sim/types';

export interface ResultText {
  title: string;
  subtitle: string;
}

// 협동 모드의 패배는 원인이 두 가지다. 코어가 파괴된 것과 플레이어가 전부 다운된 것.
// 둘을 구분하지 않으면 코어가 만피인데 "코어 함락"이라고 적히는 일이 생긴다.
// 화면 없이 검사할 수 있도록 Phaser를 쓰지 않는 순수 함수로 둔다.
export function coopResultText(outcome: Outcome, summary: MatchSummary | null, interrupted: boolean): ResultText {
  if (outcome.mode !== 'coop') return { title: '', subtitle: '' }; // 대전 제목(승리!/패배)은 ResultScene이 정한다
  const at = `웨이브 ${outcome.wave}/${COOP.waves}에서`;

  if (outcome.won) {
    return { title: '방어 성공!', subtitle: `${COOP.waves}웨이브 전부 막아냈습니다` };
  }
  // 연결이 끊겨 끝난 경우. 구체적인 사유는 별도 문구가 설명한다.
  if (interrupted) {
    return { title: '방어 중단', subtitle: `${at} 종료` };
  }
  if (!summary?.coop) {
    return { title: '방어 실패', subtitle: `${at} 패배` };
  }
  // 코어가 남아 있는데 졌다면 사람이 다 쓰러진 것이다
  if (summary.coop.coreHp <= 0) {
    return { title: '코어 함락', subtitle: `${at} 코어 파괴` };
  }
  const solo = summary.playerCount === 1;
  return {
    title: solo ? '전투 불능' : '전멸',
    subtitle: `${at} ${solo ? '다운' : '전원 다운'}`,
  };
}
