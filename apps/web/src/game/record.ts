import type { Outcome } from '../sim/core';

// 기기에만 남는 개인 전적 (공개 랭킹 없음 — 팬 게임 정책)
export interface LocalRecord {
  duelWins: number;
  duelLosses: number;
  coopClears: number;
  coopFails: number;
  bestWave: number;
}

const KEY = 'arena.record';

export function loadRecord(): LocalRecord {
  const empty: LocalRecord = { duelWins: 0, duelLosses: 0, coopClears: 0, coopFails: 0, bestWave: 0 };
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...empty, ...(JSON.parse(raw) as Partial<LocalRecord>) } : empty;
  } catch {
    return empty;
  }
}

// 대전은 온라인 경기만, 방어전은 솔로 포함해 기록한다. 갱신된 전적을 돌려준다.
export function applyResult(outcome: Outcome, localId: 0 | 1, online: boolean): LocalRecord {
  const record = loadRecord();
  if (outcome.mode === 'duel') {
    if (!online) return record;
    if (outcome.winner === localId) record.duelWins += 1;
    else record.duelLosses += 1;
  } else {
    if (outcome.won) record.coopClears += 1;
    else record.coopFails += 1;
    record.bestWave = Math.max(record.bestWave, outcome.wave);
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(record));
  } catch {
    /* 저장 불가 환경은 무시 */
  }
  return record;
}
